-- M5b role, grants and row-level security for the approval inbox. Idempotent; run after 30, 31 and 32.
--
-- api_agent_writer  the triage agent's database role. It can INSERT agent_runs, agent_actions and a PENDING
--                   approvals row, in its own org. It has no SELECT, UPDATE or DELETE anywhere, so it cannot
--                   approve anything, edit what it wrote, or read other data.
-- human approvers   api_property_manager and api_maintenance_coordinator read the inbox and may change only
--                   approvals.status (column grant), for pending rows in their own org. The decision fields are
--                   filled by the approvals_guard trigger, not by the caller.
-- Every other API role has no grant on these tables. The table owner (dbt/migration role) is not forced
-- under RLS, as in M5a.
-- The writer sets app.org_id itself, like the API does for reads. An agent process that lies about its org can
-- only write rows into that org's inbox, where a human must still approve them; it cannot read or change
-- anything. Per-org agent logins would remove even that and are out of scope for M5b.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'api_agent_writer') then
        create role api_agent_writer login nosuperuser nocreatedb nocreaterole noinherit nobypassrls
            connection limit 5;
    end if;
    -- Attributes a non-superuser owner may change; SUPERUSER and BYPASSRLS stay off from CREATE ROLE and are
    -- asserted by the tests. No password here: ingest.api_sql sets it from AGENT_WRITER_PASSWORD.
    alter role api_agent_writer login nocreatedb nocreaterole noinherit connection limit 5;
end $$;
alter role api_agent_writer set statement_timeout = '10s';
alter role api_agent_writer set idle_in_transaction_session_timeout = '10s';

-- Start closed: nothing outside the three inbox tables is reachable by the writer.
do $$
declare s text;
begin
    foreach s in array array['ground_truth', 'raw', 'staging', 'intermediate', 'marts', 'signals', 'risk',
                             'serving', 'public'] loop
        if exists (select 1 from pg_namespace where nspname = s) then
            execute format('revoke all on all tables in schema %I from api_agent_writer', s);
            execute format('revoke all on schema %I from api_agent_writer', s);
        end if;
    end loop;
end $$;

grant usage on schema ops to api_agent_writer, api_property_manager, api_maintenance_coordinator;

alter table ops.agent_runs enable row level security;
alter table ops.agent_actions enable row level security;
alter table ops.approvals enable row level security;

revoke all on ops.agent_runs, ops.agent_actions, ops.approvals
    from public, api_login, api_owner, api_property_manager, api_maintenance_coordinator,
         api_leasing_manager, api_data_owner, api_agent_writer;

-- Remove EVERY policy on the three tables first (permissive policies OR together).
do $$
declare pol record;
begin
    for pol in select policyname, tablename from pg_policies
               where schemaname = 'ops' and tablename in ('agent_runs', 'agent_actions', 'approvals') loop
        execute format('drop policy %I on ops.%I', pol.policyname, pol.tablename);
    end loop;
end $$;

grant insert on ops.agent_runs, ops.agent_actions, ops.approvals to api_agent_writer;
grant select on ops.agent_runs, ops.agent_actions, ops.approvals
    to api_property_manager, api_maintenance_coordinator;
grant update (status) on ops.approvals to api_property_manager, api_maintenance_coordinator;

-- Writer: insert into its own org only; an approvals row can only be inserted as pending.
create policy w_runs on ops.agent_runs for insert to api_agent_writer
    with check (org_id = nullif(current_setting('app.org_id', true), ''));
create policy w_actions on ops.agent_actions for insert to api_agent_writer
    with check (org_id = nullif(current_setting('app.org_id', true), ''));
create policy w_approvals on ops.approvals for insert to api_agent_writer
    with check (org_id = nullif(current_setting('app.org_id', true), '') and status = 'pending');

-- Human approvers: read their org's inbox; decide pending rows of their org.
create policy h_runs on ops.agent_runs for select to api_property_manager, api_maintenance_coordinator
    using (org_id = nullif(current_setting('app.org_id', true), ''));
create policy h_actions on ops.agent_actions for select to api_property_manager, api_maintenance_coordinator
    using (org_id = nullif(current_setting('app.org_id', true), ''));
create policy h_approvals_read on ops.approvals for select to api_property_manager, api_maintenance_coordinator
    using (org_id = nullif(current_setting('app.org_id', true), ''));
create policy h_approvals_decide on ops.approvals for update to api_property_manager, api_maintenance_coordinator
    using (org_id = nullif(current_setting('app.org_id', true), '') and status = 'pending')
    with check (org_id = nullif(current_setting('app.org_id', true), '') and status in ('approved', 'rejected'));
