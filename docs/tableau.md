# Tableau (M6): build specification

Status: **not built.** Tableau needs Tableau Desktop or Public on Angel's machine; it cannot be produced from the cloud workspace. This file is the specification so the build is mechanical.

## Connection
- Postgres connector to the Neon **direct** host, database `neondb`, schema `serving`, using a read-only login created for Tableau. Do not use the API roles and never main's owner login. Creating that login needs a decision (see "Open decision").
- Tag the workbook source: `SYNTHETIC_CALIBRATED` (rents `REAL_PUBLIC`).

## Sheets (one data source each, from `serving`)
| Sheet | Source | Marks | How you know it is right |
|---|---|---|---|
| Repair clock | `serving_work_orders` (S01 value, band) | histogram of days open, band color, reference line at 7.0 | no work order is colored "breach" below 7.0 |
| Renewal risk | `serving_all_signals` where signal_id = S04 | bar by band, table by lease | band counts equal `select band, count(*)` in Neon |
| Delinquency aging | `serving_all_signals` S06 | stacked bars by aging bucket | bucket totals equal the API result for one org |
| Expected loss | `serving_expected_loss_by_lease` | top 20 leases by expected loss, grade badge | sum matches `docs/risk/calibration_table.csv` totals |
| Stress scenarios | `serving_stress_summary` | scenario vs loss | scenario names equal `docs/risk/scenario_run.md` |
| Risk register | `serving_risk_register` | 5x5 likelihood-impact heat map | scores are judgment inputs; say so in the caption |

Every sheet shows `evidence_grade` and the `lineage_ref` in the tooltip. Add a caption "Synthetic data calibrated to benchmarks".

## Open decision (needs Angel)
A read-only Postgres login for Tableau on the serving schema. Row-level security applies to API roles; a Tableau login would see all orgs, which is fine for synthetic data and wrong for real data. Choose: (a) a login granted select on `serving` for the demo only, or (b) extract to CSV and use Tableau Public.
