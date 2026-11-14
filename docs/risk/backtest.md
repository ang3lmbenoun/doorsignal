# M4 backtest and calibration

Snapshot date: 2026-10-31. Data: simulator output (SYNTHETIC_CALIBRATED), evidence grade C.
Calibration table digest (sha256, first 12): `201fe021fa92`.

## Renewal model (S04), out of time
Fit on 415 decided leases that ended before 2025-07-01; scored 372 decided leases that ended on or after.

| metric | value |
|---|---|
| mean predicted P(non-renewal) | 0.5908 |
| observed non-renewal rate | 0.5538 |
| Brier, model | 0.1958 |
| Brier, constant base rate | 0.2511 |
| AUC, model | 0.7712 |
| AUC, true simulator probability (ceiling) | 0.8018 |
| Brier, true simulator probability (floor) | 0.1813 |
| mean abs error vs true probability | 0.1114 |
| correlation with true probability | 0.8798 |
| predicted expected loss, test leases | 1,297,348 |
| realized loss, test leases | 1,186,884 |
| predicted / realized | 1.093 |

## Delinquency PD scorecard, out of time
Lookup built on 5430 lease-months through 2025-06-30; tested on 2305 lease-months from 2025-09-30.

| metric | value |
|---|---|
| mean predicted PD | 0.3395 |
| observed late-fee rate | 0.3544 |
| Brier, scorecard | 0.2124 |
| Brier, constant base rate | 0.2293 |
| AUC, scorecard | 0.6415 |

## Calibration table

| model | group | n | predicted | observed | gap |
|---|---|---|---|---|---|
| nonrenewal | Q1 | 75 | 0.2393 | 0.2800 | +0.0407 |
| nonrenewal | Q2 | 74 | 0.4410 | 0.3243 | -0.1166 |
| nonrenewal | Q3 | 75 | 0.6131 | 0.5467 | -0.0664 |
| nonrenewal | Q4 | 74 | 0.7621 | 0.7432 | -0.0189 |
| nonrenewal | Q5 | 74 | 0.9027 | 0.8784 | -0.0243 |
| delinquency_pd | late_0 | 1358 | 0.2633 | 0.2577 | -0.0056 |
| delinquency_pd | late_1 | 599 | 0.3821 | 0.4274 | +0.0453 |
| delinquency_pd | late_2 | 240 | 0.5084 | 0.5583 | +0.0499 |
| delinquency_pd | late_3+ | 108 | 0.6870 | 0.7130 | +0.0260 |

## Reading this
- Q1 to Q5 are equal-size groups by predicted risk, lowest to highest. A calibrated model has predicted close to observed in every row.
- The true-probability rows are the best any model could do on this synthetic data. Real data has no such ceiling.
- Loss figures use turnover cost and vacancy days learned from the training leases, never from sim/config.yaml.
- Small test sets are noisy. Treat gaps under about 0.05 in a group of 50 or fewer as noise.
