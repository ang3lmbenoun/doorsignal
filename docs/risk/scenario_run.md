# M4 stress scenario run

Snapshot date: 2026-10-31. Evidence grade C (synthetic calibrated). Digest (sha256, first 12): `8d130fae5de9`.
Loss parameters learned from data: mean turnover cost 4,031, mean vacancy days 31.2, LGD 0.025 (from 462 move-outs).

| scenario | what changes | leases | non-renewal EL | delinquency EL | total EL | vs base |
|---|---|---|---|---|---|---|
| base | No stress | 277 | 303,562 | 4,544 | 308,106 | +0 (+0.0%) |
| delinquency_up_50 | Delinquency probability 50 percent higher | 277 | 303,562 | 6,769 | 310,331 | +2,225 (+0.7%) |
| repair_time_up_25 | Repair and assignment times 25 percent slower | 277 | 312,067 | 4,544 | 316,611 | +8,505 (+2.8%) |
| vacancy_up_3pt | Vacancy rate up 3 points: about 11 more vacant days per turnover (0.03 x 365) | 277 | 333,505 | 4,544 | 338,049 | +29,943 (+9.7%) |
| combined | All three stresses together | 277 | 342,866 | 6,769 | 349,635 | +41,529 (+13.5%) |

Scenario knobs live in `dbt/seeds/risk_scenarios.csv`. The stress values are assumptions, not forecasts. Non-renewal EL covers only leases within 120 days of expiry (the S04 scope); delinquency EL is over the next 90 days.
