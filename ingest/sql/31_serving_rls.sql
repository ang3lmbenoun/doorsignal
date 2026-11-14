-- M5a row-level security and grants for the serving schema. Idempotent. Re-run after EVERY dbt build:
-- dbt drops and recreates the serving tables, which removes their policies and grants. A freshly built
-- table has no grants, so until this runs the API gets "permission denied" (closed, not open).
-- Requires 30_api_roles.sql first. Run by `python -m ingest.run_dbt` after a build, or by `python -m ingest.api_sql rls`.
--
-- The API sets two transaction-local settings per request: app.org_id and app.owner_id. A missing or
-- empty setting matches no row. Policies are per role; a role with no policy on a table sees nothing.
--   owner                   own owner_id and org
--   property_manager        own org
--   maintenance_coordinator own org; work orders, signals S01/S02/S08
--   leasing_manager         own org; leases, signals S03/S04
--   data_owner              all rows (the only cross-org role)
-- Table owner (the dbt role) is not forced under RLS, so dbt tests and the leak-test oracle can read all rows.
-- API roles do not own tables and cannot bypass RLS (asserted in the tests).

grant usage on schema serving to api_owner, api_property_manager, api_maintenance_coordinator,
                                 api_leasing_manager, api_data_owner;

do $$
declare
    t text;
    r text;
    org   text := 'nullif(current_setting(''app.org_id'', true), '''')';
    own   text := 'nullif(current_setting(''app.owner_id'', true), '''')';
    -- (table, role, USING expression). Anything not listed has no grant and no policy.
    rules text[][] := array[
        ['all_signals', 'owner',                   format('owner_id = %s and org_id = %s', own, org)],
        ['all_signals', 'property_manager',        format('org_id = %s', org)],
        ['all_signals', 'maintenance_coordinator', format('org_id = %s and signal_id in (''S01'', ''S02'', ''S08'')', org)],
        ['all_signals', 'leasing_manager',         format('org_id = %s and signal_id in (''S03'', ''S04'')', org)],
        ['all_signals', 'data_owner',              'true'],

        ['expected_loss_by_lease', 'owner',            format('owner_id = %s and org_id = %s', own, org)],
        ['expected_loss_by_lease', 'property_manager', format('org_id = %s', org)],
        ['expected_loss_by_lease', 'data_owner',       'true'],

        ['stress_summary', 'owner',            format('owner_id = %s and org_id = %s', own, org)],
        ['stress_summary', 'property_manager', format('org_id = %s', org)],
        ['stress_summary', 'data_owner',       'true'],

        -- Risk register: each role sees the rows assigned to it (owner_role = role name); data_owner sees all.
        ['risk_register', 'owner',                   'owner_role = ''owner'''],
        ['risk_register', 'property_manager',        'owner_role = ''property_manager'''],
        ['risk_register', 'maintenance_coordinator', 'owner_role = ''maintenance_coordinator'''],
        ['risk_register', 'leasing_manager',         'owner_role = ''leasing_manager'''],
        ['risk_register', 'data_owner',              'true'],

        ['work_orders', 'owner',                   format('owner_id = %s and org_id = %s', own, org)],
        ['work_orders', 'property_manager',        format('org_id = %s', org)],
        ['work_orders', 'maintenance_coordinator', format('org_id = %s', org)],
        ['work_orders', 'data_owner',              'true'],

        ['leases', 'owner',            format('owner_id = %s and org_id = %s', own, org)],
        ['leases', 'property_manager', format('org_id = %s', org)],
        ['leases', 'leasing_manager',  format('org_id = %s', org)],
        ['leases', 'data_owner',       'true']
    ];
    i int;
    pol record;
begin
    -- Tables exposed to the API. serving.vendor_signals is an internal helper and is never granted.
    -- Remove EVERY policy in serving, not only the ones named here: policies are permissive and OR together,
    -- so one added by hand would silently widen access.
    for pol in select policyname, tablename from pg_policies where schemaname = 'serving' loop
        execute format('drop policy %I on serving.%I', pol.policyname, pol.tablename);
    end loop;

    foreach t in array array['all_signals', 'expected_loss_by_lease', 'stress_summary', 'risk_register',
                             'work_orders', 'leases'] loop
        if to_regclass(format('serving.%I', t)) is null then
            raise notice 'serving.% does not exist; skipped (no grants, so it is closed)', t;
            continue;
        end if;
        execute format('alter table serving.%I enable row level security', t);
        execute format('revoke all on serving.%I from public, api_login, api_owner, api_property_manager, '
                       'api_maintenance_coordinator, api_leasing_manager, api_data_owner', t);
    end loop;
    if to_regclass('serving.vendor_signals') is not null then
        revoke all on serving.vendor_signals from public, api_login, api_owner, api_property_manager,
            api_maintenance_coordinator, api_leasing_manager, api_data_owner;
    end if;

    for i in 1 .. array_length(rules, 1) loop
        continue when to_regclass(format('serving.%I', rules[i][1])) is null;
        execute format('grant select on serving.%I to %I', rules[i][1], 'api_' || rules[i][2]);
        execute format('create policy %I on serving.%I for select to %I using (%s)',
                       'p_' || rules[i][2], rules[i][1], 'api_' || rules[i][2], rules[i][3]);
    end loop;
end $$;
