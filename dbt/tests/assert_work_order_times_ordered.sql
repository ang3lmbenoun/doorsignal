select work_order_id from {{ ref('fct_work_orders') }}
where assigned_at < submitted_at or completed_at < assigned_at
