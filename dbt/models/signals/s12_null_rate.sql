-- S12 (part 2) Null rate of key columns against an allowed maximum.
with checks as (
    select 'marts.fct_leases.safmr_rent' as entity_id, 0.0 as max_rate,
           avg((safmr_rent is null)::int)::numeric as rate, count(*) as n
    from {{ ref('fct_leases') }}
    union all
    select 'marts.fct_leases.monthly_rent', 0.0, avg((monthly_rent is null)::int)::numeric, count(*)
    from {{ ref('fct_leases') }}
    union all
    select 'marts.fct_work_orders.assigned_at', 0.05, avg((assigned_at is null)::int)::numeric, count(*)
    from {{ ref('fct_work_orders') }}
)
select
    entity_id,
    'dataset' as entity_type,
    'S12' as signal_id,
    round(rate, 4) as value,
    case when rate > max_rate then 'breach' else 'ok' end as band,
    {{ as_of_ts() }} as computed_at,
    'A' as evidence_grade,
    'marts null rates -> signals.s12_null_rate' as lineage_ref,
    jsonb_build_object('check', 'null_rate', 'max_rate', max_rate, 'rows', n) as detail
from checks
