select
    lease_id,
    count(*) filter (where entry_type = 'charge_rent') as n_rent_charges,
    coalesce(sum(amount) filter (where entry_type = 'charge_rent'), 0) as rent_charged,
    coalesce(sum(amount) filter (where entry_type = 'late_fee'), 0) as late_fees,
    -coalesce(sum(amount) filter (where entry_type = 'payment'), 0) as payments,
    count(*) filter (where entry_type = 'late_fee') as n_late_payments,
    coalesce(sum(amount), 0) as balance
from {{ ref('stg_ledger_entries') }}
group by lease_id
