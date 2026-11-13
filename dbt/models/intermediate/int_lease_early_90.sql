-- Work-order behaviour in the first 90 days of each lease (Property Meld: predicts renewal).
select
    l.lease_id,
    count(w.work_order_id) as early_wo_count,
    avg(t.assign_hours) as early_avg_assign_hours,
    avg(ln(greatest(t.assign_hours, 0.05))) as early_avg_ln_assign_hours,
    coalesce(bool_or(w.severity <> 'routine'), false) as early_has_priority
from {{ ref('stg_leases') }} l
left join {{ ref('stg_work_orders') }} w
    on w.lease_id = l.lease_id
   and (w.submitted_at::date - l.start_date) < 90
left join {{ ref('int_work_order_timing') }} t on t.work_order_id = w.work_order_id
group by l.lease_id
