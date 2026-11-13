-- S02 Assignment delay vs category and severity baseline (z-score of ln hours).
with t as (
    select work_order_id, unit_id, vendor_id, category, severity, submitted_at,
           ln(greatest(assign_hours, 0.05)) as lnh
    from {{ ref('fct_work_orders') }}
    where assigned_at is not null and assigned_at < {{ as_of_ts() }}
),
base as (
    select category, severity, avg(lnh) as mu, stddev_samp(lnh) as sd, count(*) as n
    from t group by category, severity
)
select
    t.work_order_id as entity_id,
    'work_order' as entity_type,
    'S02' as signal_id,
    round(((t.lnh - b.mu) / nullif(b.sd, 0))::numeric, 3) as value,
    case
        when b.n < {{ var('s02_min_baseline') }} then 'insufficient_baseline'
        when (t.lnh - b.mu) / nullif(b.sd, 0) >= 2 then 'high'
        when (t.lnh - b.mu) / nullif(b.sd, 0) >= 1 then 'elevated'
        else 'normal'
    end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_work_orders(assign_hours, category, severity) -> signals.s02_assignment_delay' as lineage_ref,
    jsonb_build_object('vendor_id', t.vendor_id, 'category', t.category, 'severity', t.severity,
                       'baseline_n', b.n) as detail
from t
join base b using (category, severity)
where t.submitted_at >= {{ as_of_ts() }} - interval '90 days'
