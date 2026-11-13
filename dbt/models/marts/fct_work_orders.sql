select
    t.work_order_id, t.lease_id, t.unit_id, u.property_id, u.owner_id, u.zip,
    t.category, t.severity, t.notice_type, t.vendor_id,
    t.submitted_at, t.assigned_at, t.completed_at,
    t.assign_hours, t.repair_days, t.vendor_days, t.cost, t.satisfaction, t.status,
    (t.notice_type = 'written') as is_written_notice,
    (t.status = 'open') as is_open
from {{ ref('int_work_order_timing') }} t
join {{ ref('dim_unit') }} u using (unit_id)
