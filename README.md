# DoorSignal

Signal and risk platform for small property-management firms: data pipeline, business-intelligence layer, risk layer, and role-scoped agents that draft work for a human to approve.

**Data.** Tenants, leases, work orders and ledgers are **synthetic**, calibrated to published benchmarks (every parameter in `sim/config.yaml` carries a source or the label "assumption"). Rents come from **real public** HUD Small Area Fair Market Rents. A CSV adapter contract exists for real PMS exports, not yet exercised with a real file. Every source carries a tag: `REAL_PUBLIC`, `SYNTHETIC_CALIBRATED` or `USER_EXPORT`.

**What it is not.** It has no applicant accept/deny or scoring logic, and it never uses protected-class attributes as features. Nothing the agent produces is sent: "approved" is a status, and a human decides it.

## Layers

```
sim (synthetic) + HUD rents -> raw -> staging -> intermediate -> marts -> signals -> risk -> serving (RLS by org and role)
                                                                                                  |
                                                  Express API (JWT, Postgres roles, RLS) <--------+---> Tableau (read-only)
                                                  triage agent (T0 read, T1 flag, T2 draft) -> ops inbox -> human approves
```
Stack: Postgres on Neon, dbt-core, Python (simulator, ingest, risk), Node/Express API, GitHub Actions. Details: `docs/architecture.md`, `docs/signals.md`, `docs/risk.md`, `docs/api.md`, `docs/agents.md`.

## Run it (Windows PowerShell; full steps in `docs/SETUP.md`)

1. Create a free Neon project. Copy the connection string.
2. `python -m venv .venv`, `.venv\Scripts\Activate.ps1`, `pip install -r requirements-dev.txt`
3. `copy .env.example .env`, then set `DATABASE_URL` (never commit `.env`).
4. `python -m ingest.init_db`, then `python -m ingest.load_hud` (needs `data/reference/fy2026_safmrs_revised.xlsx`, a free HUD download), then load the simulator output and `python -m ingest.run_dbt build`.
5. `pytest -q` and `ruff check .`
6. API and agent: `docs/api.md` and `docs/runbook-api.md`. Use a Neon **branch** for tests, never main.

You have it working when `run_dbt build` ends with all tests passing and `pytest -q` is green. The CI workflow does the same on a throwaway Neon branch.

## Signals (v1)

S01 Texas repair clock (a rebuttable 7.0-day presumption, not a legal finding; attorney review before real use) · S02 assignment delay · S03 first-90-day experience · S04 renewal risk · S05 payment timing shift · S06 delinquency aging · S07 vacancy loss · S08 vendor drift · S09 repeat issues · S12. Each has a registry row (inputs, refresh, threshold, evidence grade A/B/C, action tier, known failure modes). Grades show next to every value with a lineage link.

## Status and known limits

Milestones and what each proved: `docs/milestones.md`. Honest caveats:
- Synthetic data means results show the machinery works, not how a real portfolio behaves.
- No live model answer has yet passed the agent's output validator; the rules-based triage is the fallback and matches the best model on flags. Draft quality is unmeasured.
- The Dallas eviction-filing data undercounts for 2022-2024; filings are not displacements.
- Dashboards: `extracts/` has Tableau-ready CSVs and `docs/tableau.md` the build spec; the workbook is not built yet.
- Fair-housing audit: `python -m audit.run` (report in `docs/fair_housing_audit.md`).
