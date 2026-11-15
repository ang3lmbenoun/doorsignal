-- M5b approval inbox: agent runs, agent actions (T1 flags, T2 drafts) and approvals. Idempotent.
-- Run by the owner role. Not managed by dbt, so dbt rebuilds never touch these tables.
-- Nothing here sends anything: "approved" is a status, nothing more.
--   agent_runs     one row per triage run (written once, never updated)
--   agent_actions  what the agent produced; append-only (triggers refuse UPDATE and DELETE)
--   approvals      one pending row per T2 draft; only a human can move it to approved/rejected

create table if not exists ops.agent_runs (
    run_id      uuid primary key,
    org_id      text not null,
    mode        text not null check (mode in ('llm', 'rules')),
    provider    text,
    model       text,
    status      text not null check (status in ('ok', 'fallback', 'rejected_output', 'error')),
    n_flags     integer not null default 0 check (n_flags >= 0),
    n_drafts    integer not null default 0 check (n_drafts >= 0),
    error_code  text,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    unique (run_id, org_id)
);

create table if not exists ops.agent_actions (
    action_id    uuid primary key,
    run_id       uuid not null,
    org_id       text not null,
    tier         text not null check (tier in ('T1', 'T2')),
    kind         text not null,
    entity_type  text not null check (entity_type = 'work_order'),
    entity_id    text not null,
    payload      jsonb not null,
    draft_text   text check (draft_text is null or length(draft_text) between 1 and 2000),
    -- The hash is computed by the database from the stored text; the writer cannot supply or forge it.
    draft_sha256 text generated always as (encode(sha256(convert_to(draft_text, 'UTF8')), 'hex')) stored,
    created_at   timestamptz not null default now(),
    -- A draft exists exactly for T2; T1 flags and T2 drafts use disjoint kinds.
    check ((tier = 'T2') = (draft_text is not null)),
    check ((tier = 'T1' and kind in ('repair_breach_presumed', 'repair_at_risk', 'emergency_watch',
                                     'slow_assignment', 'repeat_issue'))
        or (tier = 'T2' and kind in ('tenant_status_message', 'vendor_reassignment_suggestion'))),
    foreign key (run_id, org_id) references ops.agent_runs (run_id, org_id),
    unique (action_id, org_id, tier)
);
create index if not exists agent_actions_run_idx on ops.agent_actions (run_id);
create index if not exists agent_actions_org_entity_idx on ops.agent_actions (org_id, entity_id);

create table if not exists ops.approvals (
    approval_id            uuid primary key,
    action_id              uuid not null unique,
    org_id                 text not null,
    tier                   text not null default 'T2' check (tier = 'T2'),
    status                 text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    requested_at           timestamptz not null default now(),
    decided_by             text,
    decided_role           text,
    decided_at             timestamptz,
    draft_text_at_decision text,
    draft_sha256           text,
    check ((status = 'pending') = (decided_by is null)),
    check ((status = 'pending') = (decided_role is null)),
    check ((status = 'pending') = (decided_at is null)),
    check (status = 'pending' or (draft_text_at_decision is not null and draft_sha256 is not null)),
    -- Same org as the action, and the action must be a T2 draft (tier is part of the key).
    foreign key (action_id, org_id, tier) references ops.agent_actions (action_id, org_id, tier)
);
create index if not exists approvals_org_status_idx on ops.approvals (org_id, status);

-- agent_runs and agent_actions are append-only for every role, the owner included.
create or replace function ops.refuse_change() returns trigger language plpgsql as $$
begin
    raise exception '% on ops.% is not allowed (append-only)', tg_op, tg_table_name using errcode = '42501';
end $$;
drop trigger if exists agent_runs_append_only on ops.agent_runs;
create trigger agent_runs_append_only before update or delete on ops.agent_runs
    for each row execute function ops.refuse_change();
drop trigger if exists agent_actions_append_only on ops.agent_actions;
create trigger agent_actions_append_only before update or delete on ops.agent_actions
    for each row execute function ops.refuse_change();

-- Approvals: never deleted; a decision happens once (pending -> approved|rejected) and the database, not the
-- caller, fills who, in which role, when, and the exact draft text and hash copied from the immutable action.
create or replace function ops.approvals_guard() returns trigger language plpgsql as $$
declare
    uid text := nullif(current_setting('app.user_id', true), '');
    act ops.agent_actions%rowtype;
begin
    if tg_op = 'DELETE' then
        raise exception 'approvals are never deleted' using errcode = '42501';
    end if;
    if old.status <> 'pending' then
        raise exception 'approval already decided' using errcode = '23514';
    end if;
    if new.status not in ('approved', 'rejected') then
        raise exception 'an approval can only move to approved or rejected' using errcode = '23514';
    end if;
    if uid is null then
        raise exception 'approver identity (app.user_id) is missing' using errcode = '42501';
    end if;
    select * into act from ops.agent_actions where action_id = old.action_id and org_id = old.org_id;
    if not found then
        raise exception 'draft not visible to this approver' using errcode = '42501';
    end if;
    new.approval_id := old.approval_id;
    new.action_id := old.action_id;
    new.org_id := old.org_id;
    new.tier := old.tier;
    new.requested_at := old.requested_at;
    new.decided_by := uid;
    new.decided_role := regexp_replace(current_user, '^api_', '');
    new.decided_at := now();
    new.draft_text_at_decision := act.draft_text;
    new.draft_sha256 := act.draft_sha256;
    return new;
end $$;
drop trigger if exists approvals_guard_trg on ops.approvals;
create trigger approvals_guard_trg before update or delete on ops.approvals
    for each row execute function ops.approvals_guard();
