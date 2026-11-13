-- S12 (part 3) How far the newest record sits behind the snapshot date.
with newest as (
    select 'marts.fct_work_orders' as entity_id, max(submitted_at)::date as newest_date
    from {{ ref('fct_work_orders') }}
    union all
    select 'marts.fct_ledger_entries', max(entry_date) from {{ ref('fct_ledger_entries') }}
)
select
    entity_id,
    'dataset' as entity_type,
    'S12' as signal_id,
    ({{ as_of_date() }} - newest_date)::numeric as value,
    case when {{ as_of_date() }} - newest_date > 7 then 'stale' else 'fresh' end as band,
    {{ as_of_ts() }} as computed_at,
    'A' as evidence_grade,
    'marts newest record date -> signals.s12_staleness' as lineage_ref,
    jsonb_build_object('check', 'staleness_days', 'newest_date', newest_date) as detail
from newest
