select e.entry_id, e.lease_id, l.unit_id, u.property_id, u.owner_id, e.entry_date, e.entry_type, e.amount
from {{ ref('stg_ledger_entries') }} e
join {{ ref('stg_leases') }} l using (lease_id)
join {{ ref('dim_unit') }} u on u.unit_id = l.unit_id
