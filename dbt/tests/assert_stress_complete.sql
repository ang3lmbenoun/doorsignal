-- One row per scenario per active lease, no duplicates, and S04 probabilities survive stress
-- wherever the base case has one (a missing s04 coefficient would null them).
with expected as (
    select s.scenario_id, count(*) as n
    from {{ ref('risk_scenarios') }} s cross join {{ ref('expected_loss_by_lease') }} e
    group by 1
),
actual as (
    select scenario_id, count(*) as n, count(distinct lease_id) as n_distinct,
           count(*) filter (where p_nonrenew is null) as n_null_p
    from {{ ref('stress_results') }} group by 1
),
base_nulls as (
    select count(*) filter (where p_nonrenew is null) as n from {{ ref('expected_loss_by_lease') }}
)
select a.scenario_id, a.n, e.n as expected_n, a.n_distinct, a.n_null_p
from actual a join expected e using (scenario_id) cross join base_nulls b
where a.n <> e.n or a.n_distinct * 1 <> (select count(*) from {{ ref('expected_loss_by_lease') }})
   or a.n_null_p <> b.n
