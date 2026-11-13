# Milestones

| M | Deliverable | Pass command / criterion |
|---|---|---|
| M0 | Repo, CLAUDE.md, Neon project, CI skeleton | CI green on empty tests |
| M1 | Simulator v0 + raw load + ground truth | Seeded run reproduces identical row counts; FK integrity test passes |
| M2 | Staging + marts + dbt tests + public data pulls | dbt build passes; ledger reconciliation test passes |
| M3 | Signals S01-S09 + S12 + registry table | Unit test per signal; known-truth test recovers planted renewal effect within tolerance |
| M4 | Risk layer: register, expected loss, stress scenarios, backtest | Calibration table produced; scenario run reproducible |
| M5 | API with RLS, approval inbox, triage agent, eval suite | 0 cross-org leaks across N cases; S01 fires at day 7, not before |
| M6 | Tableau dashboards, README, demo | Another person runs it from README |
| M7 | Fair-housing audit harness, renewal ranker, narrators | Planted disparity detected; null scenario not flagged |

Current: M4 built on branch `m4-risk-layer` and passing on local Postgres 16 (dbt PASS=171, pytest 24 passed). Waiting on Angel to review the PR and run it against Neon.
Done: M0 (CI green), M1 (load clean in Neon), M2 (dbt PASS=91 in Neon), M3 (pushed; CI green; Neon build not yet confirmed).
