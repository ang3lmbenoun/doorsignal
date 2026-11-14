-- serving.all_signals keeps every non-vendor signal row and one vendor row per (org, vendor) that has work.
-- A join that silently dropped rows would hide signals from every role.
select 'non_vendor_rows' as what, a.n as expected, b.n as served
from (select count(*) as n from {{ ref('all_signals') }} where entity_type <> 'vendor') a,
     (select count(*) as n from {{ ref('serving_all_signals') }} where entity_type <> 'vendor') b
where a.n <> b.n
