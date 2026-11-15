-- S08 Vendor drift and peer gap. Days and cost are normalized by category and severity.
-- Logic lives in macros/s08_vendor_drift.sql so the per-org serving version cannot drift from it.
{{ s08_vendor_drift(by_org=false) }}
