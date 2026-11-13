-- S01 Texas repair clock. Rule is a simplification of the Tex. Prop. Code 92.056 seven-day presumption.
select
    work_order_id as entity_id,
    'work_order' as entity_type,
    'S01' as signal_id,
    round((extract(epoch from ({{ as_of_ts() }} - submitted_at)) / 86400.0)::numeric, 3) as value,
    case
        when extract(epoch from ({{ as_of_ts() }} - submitted_at)) / 86400.0 >= 7 then 'breach_presumed'
        when extract(epoch from ({{ as_of_ts() }} - submitted_at)) / 86400.0 >= 5 then 'at_risk'
        when severity = 'emergency'
             and extract(epoch from ({{ as_of_ts() }} - submitted_at)) / 86400.0 >= 1 then 'emergency_watch'
        else 'ok'
    end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_work_orders(submitted_at, completed_at, severity, is_written_notice) -> signals.s01_texas_repair_clock' as lineage_ref,
    jsonb_build_object('severity', severity, 'unit_id', unit_id) as detail
from {{ ref('fct_work_orders') }}
where is_written_notice
  and submitted_at < {{ as_of_ts() }}
  and (completed_at is null or completed_at >= {{ as_of_ts() }})
