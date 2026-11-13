select
    lease_id,
    max(value_numeric) filter (where event_type = 'renewal_offer') as offered_increase_pct,
    coalesce(bool_or(event_type = 'renewed'), false) as is_renewed,
    coalesce(bool_or(event_type = 'move_out'), false) as is_moved_out,
    max(value_numeric) filter (where event_type = 'turnover_cost') as turnover_cost,
    max(value_numeric) filter (where event_type = 'vacancy_days') as vacancy_days
from {{ ref('stg_lease_events') }}
group by lease_id
