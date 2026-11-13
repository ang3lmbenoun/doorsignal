select lease_id, unit_id, end_date, next_start
from (
    select lease_id, unit_id, end_date,
           lead(start_date) over (partition by unit_id order by start_date) as next_start
    from {{ ref('stg_leases') }}
) s
where next_start < end_date
