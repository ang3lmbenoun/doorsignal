-- Stress scenarios applied to every active lease. Scenario knobs live in the risk_scenarios seed.
--   repair times x k : the S04 delay term shifts by ln(k) for leases that had early requests
--   vacancy up       : extra vacant days added to every non-renewal outcome
--   delinquency up   : PD multiplied (capped at 1)
-- The base scenario must reproduce risk.expected_loss_by_lease exactly (singular test).
with coef as (
    select max(value) filter (where term = 'b_delay_ln_hours') as b_delay
    from {{ ref('s04_coefficients') }}
),
p as (select * from {{ ref('risk_loss_params') }}),
lease as (
    select e.*, f.early_wo_count > 0 as had_early_wo
    from {{ ref('expected_loss_by_lease') }} e
    join {{ ref('fct_leases') }} f using (lease_id)
)
select
    s.scenario_id, l.lease_id, l.owner_id, l.zip,
    case when l.p_nonrenew is null then null
         else 1 / (1 + exp(-(ln(l.p_nonrenew / (1 - l.p_nonrenew))
                              + case when l.had_early_wo then c.b_delay * ln(s.delay_multiplier) else 0 end)))
    end as p_nonrenew,
    p.mean_turnover_cost + (p.mean_vacancy_days + s.extra_vacancy_days) * l.monthly_rent / 30.4375
        as loss_if_nonrenewal,
    least(l.pd_delinquency * s.pd_multiplier, 1) as pd_delinquency,
    l.ead, p.lgd
from lease l
cross join {{ ref('risk_scenarios') }} s
cross join coef c
cross join p
