# Signals (M3)

Registry: `dbt/seeds/signal_registry.csv` (one row per signal, written before the code).
Outputs: `signals.s01_...` to `signals.s12_...`, unioned in `signals.all_signals` with
`entity_id, entity_type, signal_id, value, band, computed_at, evidence_grade, lineage_ref, detail`.
Snapshot date is the dbt var `as_of_date` (default 2026-10-31, the end of the simulation), never
`current_date`, so runs are reproducible.

## How each signal is tested
- A dbt unit test per signal with hand-computed inputs (`_signals_unit_tests.yml`). S01 is tested
  at exactly 7.0 days (fires) and 6 days 23 hours 59 minutes (does not).
- Data tests: every signal row has a registry row with the same grade; one row per entity and
  signal; S01 band agrees with its 7-day threshold.
- Known-truth checks against the simulator (reads `ground_truth`, test use only): S08 flags the
  planted slow vendor and no unplanted vendor.

## S04 renewal risk: planted-effect recovery
`python -m evals.s04_recovery 20` fits the same model on 20 simulated datasets. Results (renewal
effects planted in `sim/config.yaml`, shown on the non-renewal log-odds scale):

| term | planted | mean of 20 fits | sd |
|---|---|---|---|
| delay_ln_hours | 0.55 | 0.51 | 0.11 |
| early_priority | 0.45 | 0.48 | 0.18 |
| offer_z | 0.70 | 0.69 | 0.04 |

The model recovers the planted effects on average. A single dataset is noisy: on the shipped
dataset (seed 20261112) the priority term is estimated at -0.11 (se 0.21), about 3 standard
errors below the planted 0.45, which is a rare draw. The fitted coefficients in
`s04_coefficients.csv` come from that dataset as they are. Planted effects prove the pipeline can
find an effect that exists; they say nothing about real-world effect sizes.

## Run
```
python -m ingest.run_dbt build      # seeds, models, unit tests, data tests
python -m signals.fit_s04           # optional: refit S04 and rewrite the seed
```
