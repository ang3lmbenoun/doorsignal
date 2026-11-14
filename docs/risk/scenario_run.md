# M4 stress scenario run

Snapshot date: 2026-10-31. Evidence grade C (synthetic calibrated). Digest (sha256, first 12): `742e9f9f1a55`.
Loss parameters learned from data: mean turnover cost 4,031, mean vacancy days 31.2, LGD 0.026 (from 462 move-outs).

| scenario | what changes | leases | non-renewal EL | delinquency EL | total EL | vs base |
|---|---|---|---|---|---|---|
| base | No stress | 277 | 318,917 | 5,562 | 324,479 | +0 (+0.0%) |
| delinquency_up_50 | Delinquency probability 50 percent higher | 277 | 318,917 | 8,286 | 327,203 | +2,724 (+0.8%) |
| repair_time_up_25 | Repair and assignment times 25 percent slower | 277 | 327,880 | 5,562 | 333,442 | +8,963 (+2.8%) |
| vacancy_up_3pt | Vacancy rate up 3 points: about 11 more vacant days per turnover (0.03 x 365) | 277 | 354,273 | 5,562 | 359,835 | +35,357 (+10.9%) |
| combined | All three stresses together | 277 | 364,254 | 8,286 | 372,540 | +48,062 (+14.8%) |

Scenario knobs live in `dbt/seeds/risk_scenarios.csv`. The stress values are assumptions, not forecasts. Non-renewal EL covers only leases within 120 days of expiry (the S04 scope); delinquency EL is over the next 90 days.
