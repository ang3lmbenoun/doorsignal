-- Offset paging and the by-id endpoints need these keys to be unique. (The serving tables also carry unique
-- indexes; this test names the failure clearly and also covers a build where an index step was skipped.)
select 'all_signals' as t, count(*) as dupes from (
    select signal_id, entity_type, entity_id, org_id, owner_id from {{ ref('serving_all_signals') }}
    group by 1, 2, 3, 4, 5 having count(*) > 1) a
having count(*) > 0
union all
select 'stress_summary', count(*) from (
    select owner_id, scenario_id from {{ ref('serving_stress_summary') }} group by 1, 2 having count(*) > 1) b
having count(*) > 0
union all
select 'vendor_signals', count(*) from (
    select org_id, entity_id from {{ ref('serving_vendor_signals') }} group by 1, 2 having count(*) > 1) c
having count(*) > 0
