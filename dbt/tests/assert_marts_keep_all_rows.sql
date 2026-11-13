-- Guards against silent row loss in joins: every staged row must reach its mart.
select 'fct_leases' as model, s.n as staged_rows, m.n as mart_rows
from (select count(*) n from {{ ref('stg_leases') }}) s, (select count(*) n from {{ ref('fct_leases') }}) m
where s.n <> m.n
union all
select 'fct_work_orders', s.n, m.n
from (select count(*) n from {{ ref('stg_work_orders') }}) s, (select count(*) n from {{ ref('fct_work_orders') }}) m
where s.n <> m.n
union all
select 'fct_ledger_entries', s.n, m.n
from (select count(*) n from {{ ref('stg_ledger_entries') }}) s, (select count(*) n from {{ ref('fct_ledger_entries') }}) m
where s.n <> m.n
union all
select 'dim_unit', s.n, m.n
from (select count(*) n from {{ ref('stg_units') }}) s, (select count(*) n from {{ ref('dim_unit') }}) m
where s.n <> m.n
