select lease_id, offered_increase_pct from {{ ref('fct_leases') }}
where offered_increase_pct is not null and offered_increase_pct not between 0 and 0.12
