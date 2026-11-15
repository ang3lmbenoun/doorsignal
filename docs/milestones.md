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
| M6 | Tableau dashboards, README, demo | Another person runs it from README |
| M7 | Fair-housing audit harness, renewal ranker, narrators | Planted disparity detected; null scenario not flagged |

Current: M5b built on branch `m5b-approval-triage`; PR not opened (gate). On Neon branch `m5a-rls-test` before its owner password stopped working: 428 JS tests passed (182-case M5a matrix with 0 cross-org leaks, 50 inbox DB tests, 44 inbox API tests, 143 offline agent tests, 9 agent end-to-end tests), the S01 boundary (breach at 7.0 days, not at 6.9) held through the agent path. Since then, not verified against a database: the review-fix SQL (32/33), the DB tests changed for it, and the full-chain CI job. Offline: 231 JS tests and 32 Python tests pass. Model eval: 36 cases, three substitute models (docs/agents.md). CI job `api-leaks` has not run (needs secrets `NEON_CI_DATABASE_URL`, `API_LOGIN_PASSWORD`, `AGENT_WRITER_PASSWORD`).
Done: M0 (CI green), M1 (load clean in Neon), M2 (dbt PASS=91 in Neon), M3 (CI green; Neon build not separately confirmed), M4 (merged, PR #1), M5a (merged, PR #2: 182-case leak matrix on Neon branch `m5a-rls-test`, 0 cross-org leaks; 6/6 policy mutations caught; see docs/api.md).
