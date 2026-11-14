-- Serving tables must not lose or duplicate rows relative to their sources.
select 'expected_loss_by_lease' as what from (
    select (select count(*) from {{ ref('expected_loss_by_lease') }}) a,
           (select count(*) from {{ ref('serving_expected_loss_by_lease') }}) b) t where a <> b
union all
select 'work_orders' from (
    select (select count(*) from {{ ref('fct_work_orders') }}) a,
           (select count(*) from {{ ref('serving_work_orders') }}) b) t where a <> b
union all
select 'leases' from (
    select (select count(*) from {{ ref('fct_leases') }}) a,
           (select count(*) from {{ ref('serving_leases') }}) b) t where a <> b
union all
select 'risk_register' from (
    select (select count(*) from {{ ref('risk_register') }}) a,
           (select count(*) from {{ ref('serving_risk_register') }}) b) t where a <> b
