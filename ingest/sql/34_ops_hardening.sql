-- M5c hardening of the approval inbox (ops schema). Idempotent: safe to run on a fresh database and again on an
-- existing one. Run by the owner role after 32 and 33. Nothing here sends anything.
-- Constraints are added NOT VALID then VALIDATEd, so adding them takes no long lock. The append-only triggers
-- on agent_runs / agent_actions refuse UPDATE and DELETE, so no row of those tables is rewritten.
-- Still open (decisions recorded in docs/milestones.md): a deferred "every T2 action has an approval" trigger,
-- and a retention/archive rule for the inbox tables.

-- Helper: add a CHECK once.
create or replace function ops.add_check_once(tbl regclass, cname text, expr text) returns void
language plpgsql as $$
begin
    if not exists (select 1 from pg_constraint where conrelid = tbl and conname = cname) then
        execute format('alter table %s add constraint %I check (%s) not valid', tbl, cname, expr);
    end if;
    execute format('alter table %s validate constraint %I', tbl, cname);
end $$;

revoke all on function ops.add_check_once(regclass, text, text) from public;

-- 1. finished_at: the writer always supplies it and the table is append-only, so a NULL could never be filled in.
--    No ordering check against started_at: the two clocks are not guaranteed to agree.
alter table ops.agent_runs alter column finished_at set default now();
select ops.add_check_once('ops.agent_runs', 'agent_runs_finished_chk', 'finished_at is not null');

-- 2. Draft hash: set by the BEFORE INSERT trigger; require it on every T2 row and nowhere else, and well formed.
select ops.add_check_once('ops.agent_actions', 'agent_actions_hash_chk',
    $c$(tier = 'T2') = (draft_sha256 is not null) and (draft_sha256 is null or draft_sha256 ~ '^[0-9a-f]{64}$')$c$);

-- 3. A pending approval carries no decision snapshot.
select ops.add_check_once('ops.approvals', 'approvals_pending_snapshot_chk',
    $c$status <> 'pending' or (draft_text_at_decision is null and draft_sha256 is null)$c$);

-- 4. Size caps (the rows can never be deleted): payload is a small JSON object, error_code is short.
select ops.add_check_once('ops.agent_actions', 'agent_actions_payload_chk',
    $c$jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 16384$c$);
select ops.add_check_once('ops.agent_runs', 'agent_runs_error_code_chk',
    $c$error_code is null or length(error_code) <= 500$c$);

-- 5. Rejection log and duplicate counter on the run row. rejections holds one small object per rejected model
--    answer: batch number, rule code, field path, character class labels, text length, 8-char hash. No content.
alter table ops.agent_runs add column if not exists rejections jsonb not null default '[]'::jsonb;
alter table ops.agent_runs add column if not exists n_duplicates_skipped integer not null default 0;
select ops.add_check_once('ops.agent_runs', 'agent_runs_rejections_chk',
    $c$jsonb_typeof(rejections) = 'array' and pg_column_size(rejections) < 16384$c$);
select ops.add_check_once('ops.agent_runs', 'agent_runs_dup_chk', 'n_duplicates_skipped >= 0');

-- 6. Duplicate protection: at most one PENDING draft per (org, work order, kind). entity_id and kind are copied
--    onto the approval by a trigger from the immutable action row, so the caller cannot supply or forge them.
--    The writer has no SELECT, so the lookup runs as the owner (SECURITY DEFINER, fixed search_path) and returns
--    nothing to the caller: it only fills two columns of the row being inserted, for the same action and org.
alter table ops.approvals add column if not exists entity_id text;
alter table ops.approvals add column if not exists kind text;

create or replace function ops.approvals_fill_entity() returns trigger
language plpgsql security definer set search_path = pg_catalog, ops as $$
begin
    select a.entity_id, a.kind into new.entity_id, new.kind
      from ops.agent_actions a
     where a.action_id = new.action_id and a.org_id = new.org_id;
    return new;   -- no match leaves them NULL; the foreign key then rejects the row
end $$;
revoke all on function ops.approvals_fill_entity() from public;
drop trigger if exists approvals_fill_entity_trg on ops.approvals;
create trigger approvals_fill_entity_trg before insert on ops.approvals
    for each row execute function ops.approvals_fill_entity();

-- Backfill rows written before this migration. The guard trigger would refuse an UPDATE, so it is switched off
-- for this one statement inside this transaction. Only rows still missing the two columns are touched.
alter table ops.approvals disable trigger approvals_guard_trg;
update ops.approvals p set entity_id = a.entity_id, kind = a.kind
  from ops.agent_actions a
 where a.action_id = p.action_id and a.org_id = p.org_id and (p.entity_id is null or p.kind is null);
alter table ops.approvals enable trigger approvals_guard_trg;

create unique index if not exists approvals_one_pending_idx
    on ops.approvals (org_id, entity_id, kind) where status = 'pending';

-- 7. Because duplicates are skipped inside a savepoint after the action row is inserted, the run row is written
--    last in the same transaction. Its foreign key therefore has to be checked at COMMIT.
alter table ops.agent_actions drop constraint if exists agent_actions_run_id_org_id_fkey;
alter table ops.agent_actions add constraint agent_actions_run_id_org_id_fkey
    foreign key (run_id, org_id) references ops.agent_runs (run_id, org_id) deferrable initially deferred;
