-- S03 First-90-day experience score (0-100). Window follows Property Meld; weights are an assumption.
with leases as (
    select lease_id, unit_id, start_date
    from {{ ref('fct_leases') }}
    where start_date <= {{ as_of_date() }} and {{ as_of_date() }} < start_date + 90
),
w as (
    select l.lease_id,
           count(f.work_order_id) as n_requests,
           avg(f.assign_hours) filter (where f.assigned_at < {{ as_of_ts() }}) as avg_assign_hours,
           coalesce(bool_or(f.severity <> 'routine'), false) as has_priority,
           count(f.work_order_id) filter (
               where (f.completed_at is null or f.completed_at >= {{ as_of_ts() }})
                 and f.submitted_at < {{ as_of_ts() }} - interval '7 days'
           ) as n_open_over_7d
    from leases l
    left join {{ ref('fct_work_orders') }} f
        on f.lease_id = l.lease_id
       and f.submitted_at < {{ as_of_ts() }}
       and (f.submitted_at::date - l.start_date) < 90
    group by l.lease_id
),
scored as (
    select lease_id, n_requests, avg_assign_hours, has_priority, n_open_over_7d,
           greatest(0,
               100
               - case when has_priority then 25 else 0 end
               - least(25, 5 * n_requests)
               - least(30, coalesce(avg_assign_hours, 0))
               - case when n_open_over_7d > 0 then 20 else 0 end
           ) as score
    from w
)
select
    lease_id as entity_id,
    'lease' as entity_type,
    'S03' as signal_id,
    round(score::numeric, 2) as value,
    case when score < 60 then 'at_risk' when score < 80 then 'watch' else 'good' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_leases + marts.fct_work_orders (first 90 days) -> signals.s03_first_90_day_experience' as lineage_ref,
    jsonb_build_object('n_requests', n_requests, 'has_priority', has_priority,
                       'avg_assign_hours', round(avg_assign_hours::numeric, 2),
                       'n_open_over_7d', n_open_over_7d) as detail
from scored
