-- S08 Vendor drift and peer gap. Days and cost are normalized by category and severity.
with done as (
    select work_order_id, vendor_id, category, severity, completed_at, vendor_days, cost
    from {{ ref('fct_work_orders') }}
    where completed_at is not null and completed_at < {{ as_of_ts() }} and vendor_id is not null
),
ref_avg as (
    select category, severity, avg(vendor_days) as ref_days, avg(cost) as ref_cost
    from done group by category, severity
),
norm as (
    select d.vendor_id, d.completed_at,
           d.vendor_days / nullif(r.ref_days, 0) as nd,
           d.cost / nullif(r.ref_cost, 0) as nc
    from done d join ref_avg r using (category, severity)
),
agg as (
    select vendor_id,
           avg(nd) as peer_ratio,
           avg(nd) filter (where completed_at >= {{ as_of_ts() }} - interval '90 days') as recent_nd,
           avg(nd) filter (where completed_at < {{ as_of_ts() }} - interval '90 days') as base_nd,
           avg(nc) filter (where completed_at >= {{ as_of_ts() }} - interval '90 days') as recent_nc,
           avg(nc) filter (where completed_at < {{ as_of_ts() }} - interval '90 days') as base_nc,
           count(*) filter (where completed_at >= {{ as_of_ts() }} - interval '90 days') as recent_n,
           count(*) filter (where completed_at < {{ as_of_ts() }} - interval '90 days') as base_n
    from norm group by vendor_id
),
scored as (
    select *, recent_nd / nullif(base_nd, 0) - 1 as drift_days,
           recent_nc / nullif(base_nc, 0) - 1 as drift_cost
    from agg
)
select
    vendor_id as entity_id,
    'vendor' as entity_type,
    'S08' as signal_id,
    round(coalesce(drift_days, 0)::numeric, 3) as value,
    case
        when peer_ratio >= 1.5 then 'slow_vs_peers'
        when recent_n >= {{ var('s08_min_recent') }} and base_n >= {{ var('s08_min_baseline') }}
             and greatest(drift_days, drift_cost) >= 0.35 then 'drifting'
        else 'normal'
    end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_work_orders(vendor_days, cost, category, severity) -> signals.s08_vendor_drift' as lineage_ref,
    jsonb_build_object('peer_ratio', round(peer_ratio::numeric, 3),
                       'drift_days', round(drift_days::numeric, 3),
                       'drift_cost', round(drift_cost::numeric, 3),
                       'recent_n', recent_n, 'base_n', base_n) as detail
from scored
