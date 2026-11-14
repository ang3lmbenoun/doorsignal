# API (M5a)

Read-only Express API in `api/` (agent tier T0: read). Who sees which rows is decided by Postgres roles and row-level security on the `serving` schema, not by application code. No write endpoints, no approval inbox, no agents, no LLM calls.

## Org model (assumption)
Orgs do not exist in the simulator. `dbt/seeds/org_map.csv` maps owners O01-O03 to ORG1 and O04-O06 to ORG2 (basis: assumption, `sim/config.yaml` `n_orgs`). A test requires every owner to appear exactly once.

## Roles
| Role | Postgres role | Sees |
|---|---|---|
| owner | `api_owner` | own `owner_id` (and org) |
| property_manager | `api_property_manager` | own org |
| maintenance_coordinator | `api_maintenance_coordinator` | own org; work orders and signals S01/S02/S08 |
| leasing_manager | `api_leasing_manager` | own org; leases and signals S03/S04 |
| data_owner | `api_data_owner` | all rows of every served table (the only cross-org role); `ground_truth` is never served |

| Endpoint | owner | property_manager | maintenance | leasing | data_owner |
|---|---|---|---|---|---|
| `/v1/signals`, `/v1/signals/:entity_id` | own | org | org, S01/S02/S08 | org, S03/S04 | all |
| `/v1/expected-loss`, `/:lease_id` | own | org | 403 | 403 | all |
| `/v1/stress` | own | org | 403 | 403 | all |
| `/v1/risk-register` | none (no risk is assigned to owner) | rows assigned to the role | same | same | all |
| `/v1/work-orders`, `/:id` | own | org | org | 403 | all |
| `/v1/leases`, `/:id` | own | org | 403 | org | all |

S12 (data trust) rows have no owner or org, so only data_owner sees them. S12 checks on `ground_truth` tables are removed from the serving layer.

## How isolation works
1. dbt builds `serving.*` tables (`dbt/models/serving/`), each with `org_id`, `owner_id`, `evidence_grade`, `lineage_ref`, `computed_at`. They are tables because RLS attaches to tables.
2. `ingest/sql/30_api_roles.sql` creates five NOLOGIN group roles and one LOGIN role `api_login` that inherits nothing. `ingest/sql/31_serving_rls.sql` enables RLS, grants SELECT per role and creates the policies. dbt recreates tables on every build, which drops policies and grants (the API then gets "permission denied", i.e. closed); `python -m ingest.run_dbt build` re-applies 31 automatically when `api_login` exists.
3. Each request: verify the JWT, then in one `BEGIN READ ONLY` transaction run `SET LOCAL ROLE api_<role>` and set `app.org_id` / `app.owner_id` with `set_config(..., true)`. A missing setting matches no rows. `SET LOCAL` ends with the transaction, so nothing carries over to the next request on that connection.
4. The API role name comes from a fixed map; every request value is a bound parameter after a pattern check.

## Auth
Bearer JWT, HS256 only, `exp` required, secret from `JWT_SECRET` (at least 32 characters). Claims: `role`, `org_id` (all roles except data_owner), `owner_id` (owner only). `org_id` and `owner_id` must match `^[A-Za-z0-9_-]{1,32}$`. A shared HS256 secret means anyone holding it can mint any role; real identity is out of scope for M5a (ADR 0003).

## Responses
`GET` only. `{ "rows": [...], "meta": { "count", "limit", "offset" } }`. Every row carries `evidence_grade` (A/B/C) and `lineage_ref`; the API returns 500 rather than a row without them. `limit` 1-500 (default 100), `offset`. Unknown query parameters give 400.

| Status | Meaning |
|---|---|
| 401 | missing, malformed, expired or forged token; role or claims invalid |
| 403 | role has no grant on that table |
| 404 | id does not exist or is not visible to the caller (the same answer for both) |
| 405 | any non-GET/HEAD method (after authentication) |

## Known limits
- Evidence grade is C everywhere (synthetic data, assumed parameters). Per-org S08 values differ from the global S08 by design: the peer baseline is computed inside each org (`serving.vendor_signals`).
- Orgs are an assumption. The matrix proves the policies match the access table above; it does not prove the table itself is the right policy for a real business.
- The catalog (`pg_class`) is readable by any role, so API roles can list table names. Tests assert they cannot select anything outside `serving`.
- `api_login`, the group roles and the connection limit are not rate limiting. There is none in M5a.
- The test oracle runs as the table owner, which is not forced under RLS (FORCE would hide rows from dbt and the oracle).

## Run
```
# one-time, on a Neon BRANCH (never main). NEON_TEST_DATABASE_URL and API_LOGIN_PASSWORD in .env
python -m ingest.api_sql roles
python -m ingest.api_sql password
DATABASE_URL=<branch url> python -m ingest.run_dbt build   # builds serving and re-applies RLS
npm ci --prefix api
npm run test:leaks --prefix api                             # the pass command
JWT_SECRET=... API_DATABASE_URL=<api_login url> npm start --prefix api
```
The leak harness derives the direct (non-pooled) host from the branch URL, refuses to run if its host equals `DATABASE_URL`'s, and skips cleanly when neither `NEON_TEST_DATABASE_URL` nor `NEON_CI_DATABASE_URL` is set. CI job `api-leaks` needs secrets `NEON_CI_DATABASE_URL` (a branch) and `API_LOGIN_PASSWORD`.

## Test matrix (Neon branch run: 175 cases, 0 cross-org leaks)
Exact allowed row set per role and org for every endpoint (the access rules live in `api/test/access.js`, separate from the policy SQL); guessed ids (other org, sibling owner); SQL-looking inputs in filters, ids, limit and signed claims; missing, expired, forged, `alg: none`, wrong-algorithm and wrong-type tokens; `ground_truth` unreachable (schema and table privileges, live queries, nothing else selectable, nothing served mentions it); `api_login` cannot `SET ROLE` to the owner role, `neon_superuser`, `pg_read_all_data` and others, and cannot `SET SESSION AUTHORIZATION`; API roles are not superuser or BYPASSRLS and own no tables; non-GET methods are 405 and writes fail at the database.

First run on the branch found one real leak, fixed before the pass above: S12 row-drift rows for `ground_truth.*` tables (names and row counts) were served to data_owner.
