-- M5a API roles. Run once per database by the owner role, on a Neon BRANCH first. Idempotent.
-- Needs Postgres 16+ (GRANT ... WITH INHERIT FALSE, SET TRUE).
--
-- Five NOLOGIN group roles, one per API role, and one LOGIN role (api_login) the API connects as.
-- api_login has no privileges of its own and does not inherit from the group roles: each request does
-- SET LOCAL ROLE api_<role> inside a transaction. No password here; set it out of band:
--   ALTER ROLE api_login PASSWORD '<from your secret store>';

do $$
declare r text;
begin
    foreach r in array array['api_owner', 'api_property_manager', 'api_maintenance_coordinator',
                             'api_leasing_manager', 'api_data_owner'] loop
        if not exists (select 1 from pg_roles where rolname = r) then
            execute format('create role %I nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls', r);
        end if;
        -- Re-assert the attributes a non-superuser owner may change. SUPERUSER and BYPASSRLS can only be
        -- changed by a superuser (Neon's owner is not one); CREATE ROLE above leaves both off, and the
        -- leak tests assert it.
        execute format('alter role %I nologin nocreatedb nocreaterole noinherit', r);
    end loop;

    if not exists (select 1 from pg_roles where rolname = 'api_login') then
        create role api_login login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 20;
    end if;
    alter role api_login login nocreatedb nocreaterole noinherit connection limit 20;
end $$;

-- api_login may SET ROLE into each group role but inherits nothing from them.
grant api_owner to api_login with inherit false, set true;
grant api_property_manager to api_login with inherit false, set true;
grant api_maintenance_coordinator to api_login with inherit false, set true;
grant api_leasing_manager to api_login with inherit false, set true;
grant api_data_owner to api_login with inherit false, set true;

-- Belt and braces: the API session is read-only and bounded.
alter role api_login set default_transaction_read_only = on;
alter role api_login set statement_timeout = '5s';
alter role api_login set idle_in_transaction_session_timeout = '10s';

-- Nothing outside `serving` is reachable. These revokes are explicit (including from PUBLIC) for the schemas this
-- project knows about. A schema added later is covered by the leak test, which enumerates pg_namespace; it does
-- not rely on this list. ground_truth is also closed to PUBLIC below.
do $$
declare s text;
begin
    foreach s in array array['ground_truth', 'raw', 'staging', 'intermediate', 'marts', 'signals', 'risk', 'ops'] loop
        if exists (select 1 from pg_namespace where nspname = s) then
            execute format('revoke all on all tables in schema %I from api_login, api_owner, api_property_manager, '
                           'api_maintenance_coordinator, api_leasing_manager, api_data_owner', s);
            execute format('revoke all on schema %I from public', s);
            execute format('revoke all on all tables in schema %I from public', s);
            execute format('revoke all on schema %I from api_login, api_owner, api_property_manager, '
                           'api_maintenance_coordinator, api_leasing_manager, api_data_owner', s);
        end if;
    end loop;
end $$;
revoke all on schema ground_truth from public;
revoke all on all tables in schema ground_truth from public;

-- The public schema: no API role may use it, directly or through PUBLIC. (Nothing in this project lives
-- there; the dbt and ingest roles use their own schemas.)
revoke all on schema public from public;
revoke all on all tables in schema public from public;
revoke all on schema public from api_login, api_owner, api_property_manager, api_maintenance_coordinator,
    api_leasing_manager, api_data_owner;
