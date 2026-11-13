{% set parts = ['s01_texas_repair_clock', 's02_assignment_delay', 's03_first_90_day_experience',
                's04_renewal_risk', 's05_payment_timing_shift', 's06_delinquency_aging',
                's07_vacancy_loss', 's08_vendor_drift', 's09_repeat_issue',
                's12_row_drift', 's12_null_rate', 's12_staleness'] %}
{% for p in parts %}
select entity_id, entity_type, signal_id, value, band, computed_at, evidence_grade, lineage_ref, detail
from {{ ref(p) }}
{% if not loop.last %}union all{% endif %}
{% endfor %}
