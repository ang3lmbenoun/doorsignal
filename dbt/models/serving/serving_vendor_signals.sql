{{ config(alias='vendor_signals') }}
-- S08 computed inside each org (no cross-org peer baseline). Feeds serving.all_signals.
-- Vendor rows have an org but no single owner, so the owner role never sees them.
select org_id, entity_id, entity_type, signal_id, value, band, computed_at, evidence_grade, lineage_ref, detail
from ({{ s08_vendor_drift(by_org=true) }}) v
