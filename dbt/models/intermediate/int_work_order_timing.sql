select
    work_order_id, lease_id, unit_id, severity, category, notice_type, vendor_id,
    submitted_at, assigned_at, completed_at, cost, satisfaction, status,
    extract(epoch from (assigned_at - submitted_at)) / 3600.0 as assign_hours,
    extract(epoch from (completed_at - submitted_at)) / 86400.0 as repair_days,
    extract(epoch from (completed_at - assigned_at)) / 86400.0 as vendor_days
from {{ ref('stg_work_orders') }}
