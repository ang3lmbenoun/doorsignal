-- PLANNED migration 34 (M5c). NOT applied by anything: ingest.api_sql does not list this file, and no CI step runs it.
-- It collects the hardening items found in the M5b schema and security reviews that need ALTER steps (the 32 file
-- uses `create table if not exists`, which never alters a table that already exists).
-- Before it is wired in: apply it to a throwaway Neon branch, run the full DB suite, add a DB test per constraint,
-- and decide the two design items marked DECISION.
-- All constraints are added NOT VALID then VALIDATEd, so adding them takes no long lock; the append-only triggers
-- on agent_runs / agent_actions only refuse UPDATE and DELETE, so no row is rewritten.

begin;

-- 1. agent_runs.finished_at is always supplied by the writer; the table is append-only, so a NULL can never be
--    filled in later. Require it, and require a sane order.
alter table ops.agent_runs
    add constraint agent_runs_finished_chk check (finished_at is not null and finished_at >= started_at) not valid;
alter table ops.agent_runs validate constraint agent_runs_finished_chk;

-- 2. The draft hash is set by the BEFORE INSERT trigger. Nothing checked that a T2 row has one or that it is
--    well formed (CHECKs run after BEFORE triggers, so these are valid).
alter table ops.agent_actions
    add constraint agent_actions_hash_chk check (
        (tier = 'T2') = (draft_sha256 is not null) and (draft_sha256 is null or draft_sha256 ~ '^[0-9a-f]{64}$')
    ) not valid;
alter table ops.agent_actions validate constraint agent_actions_hash_chk;

-- 3. A pending approval carries no decision snapshot (the writer could otherwise park junk there; it is
--    overwritten on decision, but the row should not hold it).
alter table ops.approvals
    add constraint approvals_pending_snapshot_chk check (
        status <> 'pending' or (draft_text_at_decision is null and draft_sha256 is null)
    ) not valid;
alter table ops.approvals validate constraint approvals_pending_snapshot_chk;

-- 4. Size caps. draft_text is already capped at 2000 characters; payload and error_code were not, and the rows can
--    never be deleted.
alter table ops.agent_actions
    add constraint agent_actions_payload_chk check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 16384) not valid;
alter table ops.agent_actions validate constraint agent_actions_payload_chk;
alter table ops.agent_runs
    add constraint agent_runs_error_code_chk check (error_code is null or length(error_code) <= 500) not valid;
alter table ops.agent_runs validate constraint agent_runs_error_code_chk;

-- 5. DECISION (duplicate-run protection). Each run mints a random run_id and nothing de-duplicates across runs, so
--    running the agent twice creates a second pending draft per work order, and a retry after a lost COMMIT
--    duplicates a whole run. Options to choose between:
--      a) a run-level idempotency key:  alter table ops.agent_runs add column idempotency_key text;
--         create unique index on ops.agent_runs (org_id, idempotency_key) where idempotency_key is not null;
--         (the CLI derives the key from org + as-of date, or accepts one from a scheduler)
--      b) at most one PENDING draft per (org_id, entity_id, kind): needs entity/kind on approvals (or a partial
--         unique index on a denormalised column) so the database, not the agent, refuses the duplicate.
--    Also DECISION: a DEFERRABLE INITIALLY DEFERRED constraint trigger so every T2 action has an approvals row at
--    COMMIT (today only writer.js guarantees it). It must be SECURITY DEFINER with a fixed search_path because the
--    writer has no SELECT on approvals; review that surface before adding it.

-- 6. DECISION (retention). The three inbox tables only grow and refuse DELETE; TRUNCATE is owner-only. Options:
--    partition agent_runs/agent_actions by month and detach old partitions to an archive schema, or an owner-only
--    archive function that copies then removes rows with the append-only triggers disabled inside it, logged.

commit;
