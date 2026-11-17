# API (M5a read API, M5b approval inbox)

Express API in `api/`. Who sees which rows is decided by Postgres roles and row-level security, not by application code. The data endpoints are read-only (agent tier T0). The only write is a human's decision on a pending draft in the approval inbox (M5b, below). The API makes no LLM calls and sends nothing. The triage agent is described in `docs/agents.md`.

## Org model (assumption)
Orgs do not exist in the simulator. `dbt/seeds/org_map.csv` maps owners O01-O03 to ORG1 and O04-O06 to ORG2 (basis: assumption, `sim/config.yaml` `n_orgs`). A test requires every owner to appear exactly once.

## Roles
| Role | Postgres role | Sees |
|---|---|---|
| owner | `api_owner` | own `owner_id` (and org) |
| property_manager | `api_property_manager` | own org |
| maintenance_coordinator | `api_maintenance_coordinator` | own org; work orders and signals S01/S02/S08/S09 (S09 added in M5b so the triage agent can read as this role) |
| leasing_manager | `api_leasing_manager` | own org; leases and signals S03/S04 |
| data_owner | `api_data_owner` | all rows of every served table (the only cross-org role); `ground_truth` is never served |

| Endpoint | owner | property_manager | maintenance | leasing | data_owner |
|---|---|---|---|---|---|
| `/v1/signals`, `/v1/signals/:entity_id` | own | org | org, S01/S02/S08/S09 | org, S03/S04 | all |
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
Bearer JWT, HS256 only, secret from `JWT_SECRET` (at least 32 characters). Required: `exp`, `iat`, `iss` = `doorsignal`, `aud` = `doorsignal-api`; a token older than 1 hour is refused whatever its `exp` (5 s clock tolerance). Claims: `role`, `org_id` (all roles except data_owner), `owner_id` (owner only), `sub` (optional; the person or service; pattern `^[A-Za-z0-9_.@-]{1,64}$`; required to decide an approval), `actor` (optional; only the value `agent` is accepted). `org_id` and `owner_id` must match `^[A-Za-z0-9_-]{1,32}$`. A token with `actor: "agent"` is minted by the operator for the triage agent: it can read like its role but can never read or decide the approval inbox (API and database both refuse). A shared HS256 secret means anyone holding it can mint any role; real identity is out of scope for M5a (ADR 0003).

## Responses
`GET` only. `{ "rows": [...], "meta": { "count", "limit", "offset" } }`. Every row carries `evidence_grade` (A/B/C) and `lineage_ref`; the API returns 500 (and logs the table) rather than a row without them. Columns come from a reviewed list per endpoint (`api/src/endpoints.js`), not `SELECT *`. `limit` 1-500 (default 100), `offset` 0-100000. Unknown query parameters give 400.

| Status | Meaning |
|---|---|
| 401 | missing, malformed, expired or forged token; role or claims invalid |
| 403 | role has no grant on that table (logged with role and table; after a dbt rebuild that did not re-apply grants this is what every call returns, see `docs/runbook-api.md`) |
| 404 | id does not exist or is not visible to the caller (the same answer for both) |
| 405 | any non-GET/HEAD method (after authentication), except the two approval decisions below |
| 409 | the approval was already decided |

`GET /health` returns `ok` without touching the database. `GET /ready` runs one query as `api_data_owner` against `serving.all_signals` and returns 200 or 503; use it for probes.

## Approval inbox (M5b)
The triage agent writes flags (T1) and drafts (T2) into schema `ops`; every T2 draft gets a pending approval. A human then approves or rejects it. **"Approved" is a status in a table: nothing is sent, and no code path can send.**

| Endpoint | Who | What |
|---|---|---|
| `GET /v1/approvals?status=pending\|approved\|rejected` | property_manager, maintenance_coordinator, own org | inbox rows with the exact draft text, tier, kind, agent run, mode, provider and model |
| `GET /v1/approvals/:id` | same | one row; another org's or an unknown id is 404 |
| `POST /v1/approvals/:id/approve`, `POST /v1/approvals/:id/reject` | same, token must carry `sub`, must not be `actor: agent` | records the decision; 404 unknown or other org, 409 already decided |

Everyone else (owner, leasing_manager, data_owner) gets 403 on all four. Only the status is taken from the request; the body is ignored. The database trigger `ops.approvals_guard` fills `decided_by` (the token `sub`), `decided_role`, `decided_at`, and copies the draft text and its SHA-256 from the immutable action, so the approval records exactly what was approved. A decision happens once.

Tables (`ingest/sql/32_ops_approvals.sql`, `33_ops_rls.sql`; not dbt-managed):
- `ops.agent_runs`, `ops.agent_actions`: written only by `api_agent_writer`; UPDATE and DELETE are refused for every role by row triggers (not owner-proof: the owner could drop a trigger; TRUNCATE is owner-only and used for test resets). The draft hash is set by a trigger and overwrites whatever the caller supplies.
- `ops.approvals`: the writer can only INSERT a `pending` row in its own org; the human roles can only UPDATE `status`, for pending rows of their own org.
- `api_agent_writer` (LOGIN, no inherit, connection limit 5): INSERT on those three tables only. No SELECT, UPDATE or DELETE anywhere, and no access to `serving`, `marts`, `raw` or `ground_truth`. It therefore cannot approve its own draft (ADR 0004).
- The writer sets `app.org_id` itself. An agent that lies about its org can only add pending rows to that org's inbox, where a human still decides.

## Known limits
- Evidence grade is C everywhere (synthetic data, assumed parameters). Per-org S08 values differ from the global S08 by design: the peer baseline is computed inside each org (`serving.vendor_signals`).
- Orgs are an assumption. The matrix proves the policies match the access table above; it does not prove the table itself is the right policy for a real business.
- The catalog (`pg_class`) is readable by any role, so API roles can list table names. Tests assert they cannot select anything outside `serving`.
- There is no rate limiting in M5a. Bounds: pool of 5, `api_login` connection limit 20, `statement_timeout` 5 s, `limit` 500, `offset` 100000.
- RLS reads `app.org_id` / `app.owner_id`, which any SQL run as an API role could `set_config`. This is safe only because the API issues fixed queries in a read-only transaction. Do not add an endpoint that runs caller-supplied SQL.
- Risk R10 is assigned to `owner_accountant`, which is not an API role, so only data_owner sees it.
- Action pins: workflow actions are pinned to tags, not commit SHAs (not done in M5a or M5b).
- `decided_by` trusts the `sub` claim of a shared-secret JWT: anyone holding `JWT_SECRET` can mint a token that decides approvals as any person.
- The test oracle runs as the table owner, which is not forced under RLS (FORCE would hide rows from dbt and the oracle).

## Run
```
# one-time, on a Neon BRANCH (never main). NEON_TEST_DATABASE_URL and API_LOGIN_PASSWORD in .env
python -m ingest.api_sql roles
python -m ingest.api_sql ops                              # M5b: inbox tables, api_agent_writer, policies
python -m ingest.api_sql password
python -m ingest.api_sql password --role api_agent_writer  # AGENT_WRITER_PASSWORD in .env
DATABASE_URL=<branch url> python -m ingest.run_dbt build   # builds serving and re-applies RLS
npm ci --prefix api
npm run test:leaks --prefix api                             # the pass command
JWT_SECRET=... API_DATABASE_URL=<api_login url> npm start --prefix api
```
The leak harness derives the direct (non-pooled) host from the branch URL, refuses to run if its host equals `DATABASE_URL`'s, and skips cleanly when neither `NEON_TEST_DATABASE_URL` nor `NEON_CI_DATABASE_URL` is set. CI job `api-leaks` needs secrets `NEON_CI_DATABASE_URL` (the api-ci branch), `API_LOGIN_PASSWORD` and `AGENT_WRITER_PASSWORD`; it rebuilds that branch from scratch (raw load and the full dbt chain) each run.

## Policy-mutation check (does the matrix notice a weakened policy?)
Run on the Neon branch `m5a-rls-test` only (host checked against main first). Each mutation was applied, the 182-case matrix run, then `30_api_roles.sql` and `31_serving_rls.sql` re-applied and the restored state verified (policy count and text, no `ground_truth` usage, no inherited membership). 31 alone does not undo mutations 5 and 6, which change a schema grant and a role membership, so 30 was re-run as well.

| # | Mutation | Cases failed | Caught | Failing cases |
|---|---|---|---|---|
| 1 | `all_signals`, property_manager: `org_id = org` replaced by `true` | 5 (834 leaked rows counted) | yes | property_manager/ORG1 and ORG2 `GET /v1/signals`, both foreign-id cases, summary |
| 2 | `all_signals`, owner: owner_id condition dropped (org only) | 4 (632 leaked rows) | yes | owner/ORG1 and ORG2 `GET /v1/signals`, owner/ORG2 foreign id, summary |
| 3 | `leases`, leasing_manager: policy removed, `select` granted anyway | 2 (0 leaked rows) | yes | leasing_manager/ORG1 and ORG2 `GET /v1/leases` |
| 4 | `all_signals`, maintenance_coordinator: all signal_ids allowed | 4 (484 leaked rows) | yes | maintenance_coordinator/ORG1 and ORG2 `GET /v1/signals`, ORG2 foreign id, summary |
| 5 | `grant usage on schema ground_truth to api_data_owner` | 2 | yes | api_data_owner schema/table privilege case, "every schema except serving is closed" |
| 6 | `grant api_data_owner to api_login with inherit true, set true` | 1 | yes | "api_login does not inherit the group roles" |

Final run after the last restore: 182 cases, 182 passed, 0 cross-org leaks.

What the table shows, and does not:
- Every mutation failed at least one case, so none of these six weakenings goes unnoticed. Six mutations are a sample, not a proof that every possible weakening is caught.
- Mutation 3 leaks no rows: with RLS on and no policy, Postgres denies everything, and the test fails because the visible set differs from the expected one. A missing policy is therefore caught as an outage, not as a leak.
- Mutation 5 grants schema usage but no table privilege, so the live `SELECT` against `ground_truth` still failed with permission denied. Only the privilege checks caught it. That is correct (usage alone exposes no rows), but it shows the privilege checks, not the live queries, are what guard this case.
- Mutation 6 is caught by exactly one case. If that case were removed, the matrix would stay green while `api_login` could read everything `api_data_owner` can, because the API itself always does `SET LOCAL ROLE`.
- Mutations 1, 2 and 4 are caught by several cases each, so they have more than one line of defence.

## Test matrix (Neon branch run: 182 cases, 0 cross-org leaks)
Exact allowed row set per role and org for every endpoint (the access rules live in `api/test/access.js`, separate from the policy SQL); guessed ids (other org, sibling owner); SQL-looking inputs in filters, ids, limit and signed claims; missing, expired, forged, `alg: none`, wrong-algorithm and wrong-type tokens; `ground_truth` unreachable (schema and table privileges, live queries, nothing else selectable, nothing served mentions it); `api_login` cannot `SET ROLE` to the owner role, `neon_superuser`, `pg_read_all_data` and others, and cannot `SET SESSION AUTHORIZATION`; API roles are not superuser or BYPASSRLS and own no tables; non-GET methods are 405 and writes fail at the database.

Also asserted: every schema except `serving` is closed to every API role (enumerated from `pg_namespace`), JWT issuer/audience/max-age, the offset cap and `/ready`.

First run on the branch found one real leak, fixed before the pass above: S12 row-drift rows for `ground_truth.*` tables (names and row counts) were served to data_owner.

## Policy-mutation check, all 16 mutations (M5b)
Run with `python -m ingest.mutation_check` on Neon branch `m5b-verify` (direct host, not main), serially, one test process at a time. Each mutation was applied, the full suite (521 tests, 36 suites) run, the branch restored with `30`-`33`, the restored state compared against a snapshot taken before any mutation (policies, grants, column grants, schema usage, memberships, triggers), and the suite run again. **For all 16 the restored state was identical to the baseline and the re-run was 521/521 green.** Raw results: `docs/api-mutations.json`. A mutation is "caught" when at least one test fails with it applied.

| # | What changed | Result | Tests failing | Notes |
|---|---|---|---|---|
| 1 | `all_signals`, property_manager: org filter replaced by `true` | caught | 5 | 833 cross-org leaks counted |
| 2 | `all_signals`, owner: owner_id condition dropped | caught | 3 | 631 leaks counted |
| 3 | `leases`, leasing_manager: policy removed, SELECT granted | caught | 2 | |
| 4 | `all_signals`, maintenance_coordinator: signal filter removed | caught | 4 | 480 leaks counted |
| 5 | USAGE on schema `ground_truth` to data_owner | caught | 2 | |
| 6 | `api_data_owner` granted to `api_login` with inherit and set | caught | 1 | |
| 7 | `api_agent_writer` gets UPDATE on `ops.approvals` | caught | 2 | |
| 8 | approver read policy on approvals: org filter replaced by `true` | caught | 7 | |
| 9 | approver decide policy on approvals: org filter removed | **equivalent (defence in depth)** | 0 | Not "caught". An UPDATE also needs the SELECT policy `h_approvals_read` (still org-filtered) and the guard trigger reads the action through the org-filtered `h_actions`, so the decide policy's org filter is a redundant layer. Not a leak, and not observable without also removing those layers |
| 10 | leasing_manager gets SELECT on `ops.approvals` | caught | 1 | |
| 11 | `approvals_guard` trigger dropped | caught | 26 | |
| 12 | writer insert policy on approvals: `status = 'pending'` condition removed | caught after fix (was a survivor) | 1 | Gap closed by a new test (forged approved/rejected approval with every decision field set; must fail with 42501). Verified on scratch Postgres 16, not re-run on Neon; see below |
| 13 | `api_agent_writer` gets INSERT on `serving.leases` | caught | 1 | |
| 14 | writer insert policy on agent_actions: org check removed (`with check (true)`) | caught after fix (was a survivor) | 1 | Gap closed by a new test (action for another org's existing run, plus an approval for another org's action; must fail with 42501). Verified on scratch Postgres 16, not re-run on Neon; see below |
| 15 | `agent_actions` append-only trigger dropped | caught | 1 | |
| 16 | data_owner gets SELECT on `ops.agent_actions` plus schema usage | caught | 3 | |

**Counts:** 15 caught (13 in the Neon run, 12 and 14 after the fix), 1 equivalent (9), 0 survivors.

**What survivors 12 and 14 were.** In the Neon run, with either policy weakened all 521 tests still passed. Mutation 12 was a real single-layer gap: the writer has table-level INSERT on `ops.approvals`, there is no insert trigger, and the CHECK constraints only reject an `approved` row that is missing decision fields. A row with status `approved` and all decision fields filled in satisfies every CHECK, so the policy's `status = 'pending'` condition is the only thing that stops the agent from inserting its own approved approval. The earlier test accepted either 42501 or 23514, so it could not tell the layers apart. Mutation 14 was an untested org check: only `agent_runs` had a cross-org insert test.

**How they were closed and what is not shown.** Three tests were added to `api/test/approvals-db.test.js`. Each requires error 42501 (the RLS check) exactly. On a scratch Postgres 16 (SQL 00, 30, 32, 33 applied; no `serving` schema) they pass on the real SQL and fail under mutations 12 and 14 respectively. They have not been re-run on the Neon `m5b-verify` branch, and the full 16-mutation run was not repeated; CI (`api-leaks`) will run them on the `api-ci` branch. Six M5a mutations plus ten M5b mutations are a sample, not a proof that every possible weakening is caught.
