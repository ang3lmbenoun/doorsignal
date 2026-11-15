-- Nothing in the serving layer may name or describe the ground_truth schema (tables, row counts, lineage).
select 'all_signals' as served_in, entity_id::text as what from {{ ref('serving_all_signals') }}
where entity_id::text ilike '%ground_truth%' or lineage_ref ilike '%ground_truth%' or detail::text ilike '%ground_truth%'
union all
select 'expected_loss_by_lease', lease_id::text from {{ ref('serving_expected_loss_by_lease') }} t where t::text ilike '%ground_truth%'
union all
select 'stress_summary', scenario_id::text from {{ ref('serving_stress_summary') }} t where t::text ilike '%ground_truth%'
union all
select 'risk_register', risk_id::text from {{ ref('serving_risk_register') }} t where t::text ilike '%ground_truth%'
union all
select 'work_orders', work_order_id::text from {{ ref('serving_work_orders') }} t where t::text ilike '%ground_truth%'
union all
select 'leases', lease_id::text from {{ ref('serving_leases') }} t where t::text ilike '%ground_truth%'
