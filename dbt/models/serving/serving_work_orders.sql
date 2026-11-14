{{ config(alias='work_orders') }}
-- Work orders for maintenance, scoped by org. Explicit column list: tenant satisfaction is not served.
select w.work_order_id, w.lease_id, w.unit_id, w.property_id, w.owner_id, m.org_id, w.zip,
       w.category, w.severity, w.notice_type, w.vendor_id,
       w.submitted_at, w.assigned_at, w.completed_at,
       w.assign_hours, w.repair_days, w.vendor_days, w.cost, w.status,
       w.is_written_notice, w.is_open,
       'C' as evidence_grade,
       'raw.sim_work_orders (synthetic) -> marts.fct_work_orders -> serving.work_orders' as lineage_ref,
       {{ as_of_ts() }} as computed_at
from {{ ref('fct_work_orders') }} w
join {{ ref('org_map') }} m on m.owner_id = w.owner_id
