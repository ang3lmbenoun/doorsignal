-- S09 Repeat issue: same unit and category requested again within 30 days.
select
    w.work_order_id as entity_id,
    'work_order' as entity_type,
    'S09' as signal_id,
    count(p.work_order_id)::numeric as value,
    case when count(p.work_order_id) >= 2 then 'chronic' else 'repeat' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_work_orders(unit_id, category, submitted_at) -> signals.s09_repeat_issue' as lineage_ref,
    jsonb_build_object('unit_id', w.unit_id, 'category', w.category,
                       'days_since_prior', round(
                           (extract(epoch from (w.submitted_at - max(p.submitted_at))) / 86400.0)::numeric, 2)
                       ) as detail
from {{ ref('fct_work_orders') }} w
join {{ ref('fct_work_orders') }} p
    on p.unit_id = w.unit_id and p.category = w.category
   and p.submitted_at < w.submitted_at
   and p.submitted_at >= w.submitted_at - interval '30 days'
where w.submitted_at < {{ as_of_ts() }}
  and w.submitted_at >= {{ as_of_ts() }} - interval '30 days'
group by w.work_order_id, w.unit_id, w.category, w.submitted_at
