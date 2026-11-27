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

## Triage agent (M5b)
The agent is run by an operator: `node agent/cli.js --org ORG1 [--rules-only]` (needs `JWT_SECRET`, `AGENT_DATABASE_URL`, a running API at `API_BASE_URL`). Exit codes: 0 ok, 1 failed, 2 bad usage, 3 finished on the rules after a provider failure or a rejected model answer. Every run leaves a row in `ops.agent_runs`: `status` ok, fallback, rejected_output or error, and `error_code` with the reasons.

**Run says `fallback` or exit 3.** Read `error_code`: `no_provider` (no key or model configured), `unavailable:nvidia:410,...` (provider and status per attempt; 410 or 404 means the model is retired or not served: check the id with `node eval/catalog.js nvidia <text>`, the catalog listing alone is not enough, try a trivial call), `deadline` (a slow provider; the rest used the rules), `<reason>#<hash>` (model output rejected; `batches=..;llm=..;rejected=..;rules=..` at the end). Flags are still correct (the rules are the baseline); only draft wording came from rules. If more than about 20% of batches are rejected over a few runs, change the model. Use `--rules-only` to run without a model.

**Run failed (exit 1).** An `error` run row is written when the writer is reachable. API 403 after a dbt rebuild means grants were not re-applied: confirm the dbt run passed, run `python -m ingest.api_sql rls`, check `/ready`, rerun. A rejected writer password (28P01) or missing grants (42501): see below.

**Zero cases.** Can mean a quiet org or an empty or broken serving layer. The CLI logs "triage found no cases". Check `serving.all_signals` S01 counts for the org before trusting it.

**Duplicate pending drafts.** Nothing de-duplicates across runs: running the agent twice creates a second pending draft for the same work order. Rows cannot be deleted (append-only triggers), so reject the extras through the API. Find them with `select org_id, entity_id, kind, count(*) from ops.agent_actions a join ops.approvals p using (action_id) where p.status = 'pending' group by 1,2,3 having count(*) > 1;`. Operator rule until a scheduler and an idempotency key exist: check the pending count before running, do not run twice in the same hour.

**Stale drafts.** A draft is frozen at run time; the work order may have closed or moved from at-risk to breach before a human decides, and approving does not check the work order. Reviewers compare with the live work order. `requested_at` and `decided_at` give age. Nothing is sent in M5b, so the impact is a record of advice that is no longer true; stale-draft handling must be solved before any send path is built.

**Writer password rotation or Neon reset.** Put the new password in `.env` / the secret store (`AGENT_WRITER_PASSWORD` and `AGENT_DATABASE_URL`), then `python -m ingest.api_sql password --role api_agent_writer`. After a branch reset or restore, re-apply everything: `roles`, `ops`, `password` (api_login), `password --role api_agent_writer`, `rls`. `all` does not set passwords. A branch whose owner password stops working (28P01 for the owner) needs a new connection string from the Neon console; none of these commands can run until then.

**Inbox growth.** The three inbox tables are append-only and never pruned (TRUNCATE is owner-only). Page with `?status=pending&limit=100`. A retention rule is not decided yet.

**CI `api-leaks` shows cancelled.** GitHub keeps only one pending run per concurrency group, so a run can be cancelled by a newer one. Cancelled is not a pass: rerun it. It rebuilds the api-ci branch from scratch, so do not run local tests against the same branch while it runs.

**Model eval is stale.** `docs/agents-eval/results.json` is from 2026-11-14 on three free-tier models. Rerun `node eval/run.js` when the model changes, a model returns 404 or 410, or every few weeks.

**Applying migration 34 to an existing database (M5c).** Order: `python -m ingest.api_sql ops --url-env <ENV>` (applies 32, 33, 34 in order; each is safe to repeat). Apply it to a throwaway Neon branch first. It fails on the unique index if one work order already has two pending drafts of the same kind in one org; check first with `select a.org_id, x.entity_id, x.kind, count(*) from ops.approvals a join ops.agent_actions x on x.action_id = a.action_id and x.org_id = a.org_id where a.status = 'pending' group by 1,2,3 having count(*) > 1`. It also fails on `finished_at` if an old run row has none. Both cases need a human decision, because the tables are append-only. To read why a model answer was rejected: `select started_at, jsonb_pretty(rejections) from ops.agent_runs where jsonb_array_length(rejections) > 0 order by started_at desc limit 5` (field paths and character classes, never text).
