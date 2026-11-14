# Risk layer (M4)

Schema `risk`, built by `dbt build`, plus two Python commands that produce the evidence.

## What exists
| Object | Kind | Purpose |
|---|---|---|
| `risk.risk_register` (seed `risk_register_input`) | table | Qualitative register: category, likelihood 1-5, impact 1-5, score, controls, owner role, review date, linked signals. Scores are judgment inputs, not measurements. |
| `risk.risk_loss_params` | table, 1 row | Mean turnover cost, mean vacancy days and LGD, estimated from data on or before the snapshot date. Nothing is read from `sim/config.yaml`. |
| `risk.delinquency_pd_panel` | table | Lease-month observations. Feature: late fees in the trailing 180 days. Label: a late fee in the next 90 days. Only rows whose label window closed by the snapshot. |
| `risk.delinquency_pd_scorecard` | table | Observed PD by late-fee bucket (0, 1, 2, 3+). A lookup, not a fitted model. Buckets under 30 observations fall back to the portfolio rate. |
| `risk.expected_loss_by_lease` | table | Expected loss for every active lease. |
| `risk.stress_results`, `risk.stress_summary` | tables | Every active lease under every scenario in seed `risk_scenarios`; portfolio totals and change versus base. |

## Formulas
- Non-renewal: `P(non-renewal) x (mean turnover cost + mean vacancy days x monthly rent / 30.4375)`. P comes from S04, so it exists only for leases within 120 days of expiry. Other leases carry 0 here and are marked by a null `p_nonrenew`.
- Delinquency: `PD x EAD x LGD` over the next 90 days.
  - PD: scorecard lookup on late fees in the last 180 days.
  - EAD: one month of rent plus any open balance (S06).
  - LGD: unrecovered rent divided by rent that went delinquent, over ended leases.
- Total: the sum of the two.

## Known limits (read before quoting any number)
- **LGD definition.** A "delinquent event" is a late fee. Most late fees are paid late, not lost, so LGD is small (about 0.03 on the local run). It is not the share of missed payments that are never recovered.
- **Delinquency EL is small** in this simulator because few late payments end unrecovered. That is a property of the simulator assumptions (`payments:` in `sim/config.yaml`), not a finding about real portfolios.
- **S04 scope.** Non-renewal loss ignores leases more than 120 days from expiry. The total understates a full-year view.
- **Stress knobs are assumptions.** `vacancy_up_3pt` converts 3 points of annual vacancy into 11 extra vacant days per turnover (0.03 x 365). That is a modelling choice, not a measured response.
- **Evidence grade C** everywhere: synthetic data, parameters we chose.
- **Production S04 coefficients** are fitted on all decided leases. The backtest below refits on early leases and scores later ones so the reported skill is out of time.

## Evidence
```
python -m ingest.run_dbt build      # builds the risk schema and runs its tests
python -m risk.backtest             # docs/risk/backtest.md + calibration_table.csv
python -m risk.scenarios            # docs/risk/scenario_run.md
```
Both commands are deterministic. Same database and `as_of_date` give byte-identical files; each file carries a digest so a rerun can be compared at a glance.

Backtest design:
- Renewal: fit on decided leases that ended before 2025-07-01, score the rest, compare with outcomes and with the simulator's true renewal probability from `ground_truth` (tests and evals only; never served to the API, agents or BI).
- Loss: predicted versus realized turnover cost plus vacancy loss on the test leases.
- Delinquency: scorecard built through 2025-06-30, tested from 2025-09-30 (one 90-day horizon apart so labels do not overlap).

## Tests
dbt: base scenario equals direct expected loss to the cent; stress never lowers loss; probabilities in [0,1]; PD monotone in late-fee bucket; register links only to real signals. pytest: AUC and Brier math, renewal backtest beats a constant on three seeds and tracks the true probability, predicted loss within a band of realized, PD scorecard recovers planted rates, results are deterministic.
