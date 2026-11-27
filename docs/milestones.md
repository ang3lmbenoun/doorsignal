# Milestones

| M | Deliverable | Pass command / criterion |
|---|---|---|
| M0 | Repo, CLAUDE.md, Neon project, CI skeleton | CI green on empty tests |
| M1 | Simulator v0 + raw load + ground truth | Seeded run reproduces identical row counts; FK integrity test passes |
| M2 | Staging + marts + dbt tests + public data pulls | dbt build passes; ledger reconciliation test passes |
| M3 | Signals S01-S09 + S12 + registry table | Unit test per signal; known-truth test recovers planted renewal effect within tolerance |
| M4 | Risk layer: register, expected loss, stress scenarios, backtest | Calibration table produced; scenario run reproducible |
| M5a | Read-only API with RLS (5 roles as Postgres roles, serving layer, leak matrix) | `npm run test:leaks --prefix api`: 0 cross-org leaks across at least 40 cases |
| M5b | Approval inbox, maintenance triage agent, model-selection eval | S01 breach flag at day 7.0 and not at 6.9, end to end through the agent path; agent cannot send or write ledger/lease data (tests); nothing counts as approved without a human |
| M5c | Inbox hardening (moved out of M5b): duplicate-run protection, retention rule, `finished_at NOT NULL`, draft-hash and payload/error_code caps (migration `ingest/sql/34_ops_hardening.sql`), rejection log, GitHub Actions pinned to commit SHAs | migration 34 applied and the full DB suite passes with one test per constraint; duplicate runs create no second pending draft; Actions pinned. **M5c-1 (rejection log, migration 34, duplicate-draft protection) built on branch `m5c-hardening-rejection-log`; PR open, CI pending.** Still open in M5c: Actions pinned to SHAs, retention rule, deferred "every T2 action has an approval" trigger, larger eval with draft quality |
| M6 | Tableau dashboards, README, demo | Another person runs it from README |
| M7 | Fair-housing audit harness, renewal ranker, narrators | Planted disparity detected; null scenario not flagged |

Current: M5b merged (PR #3, 51e3b62; 521 JS tests, 182-case leak matrix 0 cross-org leaks, S01 boundary at 7.0 not 6.9, 15 of 16 policy mutations caught and 1 equivalent). Known caveat: no provider answer has yet passed the validator (one run rejected as `reason:forbidden:markup`); draft quality is unmeasured; S01 wording needs attorney review before real use. M5c-1 in progress on `m5c-hardening-rejection-log`: the prompt no longer contains `<`, `>` or backticks (it taught them to the model), every rejected answer now logs rule, field path, character class and hash in `agent_runs.rejections` (no content), a repeated run skips a draft that already has a pending one instead of failing, and migration 34 adds the constraints. Verified on scratch Postgres 16 (upgrade path and fresh path, applied twice); CI on Neon pending.
Done: M0 (CI green), M1 (load clean in Neon), M2 (dbt PASS=91 in Neon), M3 (CI green; Neon build not separately confirmed), M4 (merged, PR #1), M5a (merged, PR #2: 182-case leak matrix on Neon branch `m5a-rls-test`, 0 cross-org leaks; 6/6 policy mutations caught; see docs/api.md).
