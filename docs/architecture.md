# Architecture (condensed; full version in the Claude project doc property-mgmt-architecture-v1.md)

## Layers
raw -> staging -> intermediate -> marts -> signals -> risk -> serving (RLS by org and role)

## Sources (tagged in a source registry)
- REAL_PUBLIC: HUD Small Area FMR by ZIP, Census ACS, Zillow ZORI, BLS rent CPI, Eviction Lab / CPAL filings (Dallas undercount 2022-2024 caveat; filings are not displacements)
- SYNTHETIC_CALIBRATED: simulator (tenants, leases, work orders, ledger, inquiries), parameters in sim/config.yaml
- USER_EXPORT: CSV adapters for AppFolio-style and Buildium-style exports, same staging contract

## Evidence grades
A real data. B synthetic calibrated to a cited benchmark. C synthetic with an assumption we chose. Shown as a badge next to every signal with a lineage link.

## Signals (v1)
S01 Texas repair clock | S02 assignment delay | S03 first-90-day experience | S04 renewal risk 120/90/60 | S05 payment timing shift | S06 delinquency aging | S07 vacancy loss run-rate | S08 vendor drift | S09 repeat issue | S10 market stress by ZIP (real) | S11 owner-statement anomaly | S12 data trust | S13 fair-housing audit

Common signal output: entity_id, signal_id, value, band, computed_at, evidence_grade, lineage_ref

## Risk layer
- Risk register: category, likelihood 1-5, impact 1-5, controls, owner, review date, linked signals (scores are judgment inputs)
- Expected loss: non-renewal = P x (turnover cost + vacancy days x daily rent); delinquency = PD x EAD x LGD
- Stress scenarios and backtest against simulator ground truth

## Agent tiers
T0 read | T1 internal flag | T2 draft for approval | T3 never
