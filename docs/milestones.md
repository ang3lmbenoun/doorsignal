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
| M5c | Inbox hardening (moved out of M5b): duplicate-run protection, retention rule, `finished_at NOT NULL`, draft-hash and payload/error_code caps (planned migration `ingest/sql/34_ops_hardening_PLANNED.sql`), GitHub Actions pinned to commit SHAs | migration 34 applied on a branch and the full DB suite passes with one test per constraint; duplicate runs create no second pending draft; Actions pinned (not started) |
| M6 | Tableau dashboards, README, demo | Another person runs it from README |
| M7 | Fair-housing audit harness, renewal ranker, narrators | Planted disparity detected; null scenario not flagged |

Current: M5b built on branch `m5b-approval-triage`, pushed; PR open. Verified on a fresh Neon branch `m5b-verify` (SQL 30-33, full dbt build PASS=234): 521 JS tests green (36 suites; 182-case M5a matrix with 0 cross-org leaks; approvals DB tests 56/56 including the unique approval-per-action constraint). The S01 boundary (breach at 7.0 days, not at 6.9) holds through the agent path. Policy mutations: 16 run, 13 caught, mutation 9 equivalent (defence in depth), survivors 12 and 14 were real test gaps; closed with three new tests (verified on scratch Postgres 16, not re-run on Neon; CI runs them) (docs/api.md). Agent runs on m5b-verify: rules-only run ok; provider run (NVIDIA) answered but the validator rejected the output (markup) and the rules took over (exit 3). CI job `api-leaks` has never run (needs secrets `NEON_CI_DATABASE_URL`, `API_LOGIN_PASSWORD`, `AGENT_WRITER_PASSWORD`). M5c holds the hardening items (docs: ingest/sql/34_ops_hardening_PLANNED.sql).
Done: M0 (CI green), M1 (load clean in Neon), M2 (dbt PASS=91 in Neon), M3 (CI green; Neon build not separately confirmed), M4 (merged, PR #1), M5a (merged, PR #2: 182-case leak matrix on Neon branch `m5a-rls-test`, 0 cross-org leaks; 6/6 policy mutations caught; see docs/api.md).
