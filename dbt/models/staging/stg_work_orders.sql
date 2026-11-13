select work_order_id, unit_id, lease_id, tenant_id, category, severity, notice_type,
       submitted_at, assigned_at, vendor_id, completed_at, cost::numeric as cost,
       satisfaction::integer as satisfaction, status, source_tag
from {{ source('raw', 'sim_work_orders') }}
