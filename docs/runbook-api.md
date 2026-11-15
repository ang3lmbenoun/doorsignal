# API runbook (M5a)

Short recovery notes for the failure modes found in the incident review. Commands use the Neon branch URL in `NEON_TEST_DATABASE_URL` as the example; for another database pass `--url-env <VAR>` (the helper refuses a URL whose host equals `DATABASE_URL`'s, pooled or direct).

## All requests return 403, `/ready` returns 503
Cause: serving tables were rebuilt without re-applying grants (a bare `dbt build`, `dbt retry`, a scheduler), or `run_dbt` skipped the re-apply because dbt failed. The API log shows `permission denied {role, table}`. Fails closed: no data is exposed.
Fix: confirm the dbt run passed, then `python -m ingest.api_sql rls`. Always build through `python -m ingest.run_dbt`.

## Database auth errors (28P01, 28000) or "too many connections" (53300)
Rotation order: put the new password in the secret store and API env first, then `python -m ingest.api_sql password`, then restart the API at once (there is no dual password). A Neon reset or point-in-time restore reverts roles: re-run `roles`, `password`, then `rls`. Budget: instances x 5 pool connections must stay at or below the `api_login` limit of 20.

## Slow queries (57014)
`statement_timeout` is 5 s. Serving tables have indexes on the filter and key columns; check `EXPLAIN` before raising limits.

## JWT secret leaked
Set a new `JWT_SECRET` and restart; every outstanding token stops working. There is no request log of who read what yet (known gap).

## CI shows `api-leaks` skipped
It means no isolation test ran. On main the skip fails the run. Add secrets `NEON_CI_DATABASE_URL` (a branch, not main) and `API_LOGIN_PASSWORD`. Runs are serialised because they share one branch; a flaky red from overlapping runs is not a reason to edit policies.

## Stale serving data
Rebuild: `python -m ingest.run_dbt build --select org_map path:models/serving`. `computed_at` is the as-of date, not the build time, so it does not show freshness (known gap).
