-- Expected loss per active lease at the snapshot date.
--   non-renewal  = P(non-renewal) x (turnover cost + vacancy days x daily rent)   [S04, leases within 120 days of expiry]
--   delinquency  = PD x EAD x LGD   over the next risk_pd_horizon_days             [scorecard]
-- EAD is one month of rent plus any open balance (S06). Daily rent = monthly rent / 30.4375, as in S07.
with active as (
    select l.lease_id, l.unit_id, l.property_id, l.owner_id, l.zip, l.monthly_rent, l.end_date,
           l.start_date, l.early_wo_count, l.early_avg_ln_assign_hours
    from {{ ref('fct_leases') }} l
    where l.start_date <= {{ as_of_date() }} and {{ as_of_date() }} < l.end_date
),
late_now as (
    select e.lease_id,
           case when count(*) >= 3 then '3+' else count(*)::text end as late_bucket
    from {{ ref('fct_ledger_entries') }} e
    where e.entry_type = 'late_fee'
      and e.entry_date > {{ as_of_date() }} - {{ var('risk_lookback_days') }}
      and e.entry_date <= {{ as_of_date() }}
    group by e.lease_id
),
s04 as (
    select entity_id as lease_id, value as p_nonrenew from {{ ref('s04_renewal_risk') }}
),
s06 as (
    select entity_id as lease_id, value as open_balance from {{ ref('s06_delinquency_aging') }}
),
p as (select * from {{ ref('risk_loss_params') }}),
joined as (
    select a.*,
           s04.p_nonrenew,
           coalesce(n.late_bucket, '0') as late_bucket,
           coalesce(s06.open_balance, 0) as open_balance
    from active a
    left join s04 on s04.lease_id = a.lease_id
    left join late_now n on n.lease_id = a.lease_id
    left join s06 on s06.lease_id = a.lease_id
)
select
    j.lease_id, j.unit_id, j.property_id, j.owner_id, j.zip, j.monthly_rent, j.end_date,
    j.p_nonrenew,
    p.mean_turnover_cost + p.mean_vacancy_days * j.monthly_rent / 30.4375 as loss_if_nonrenewal,
    coalesce(j.p_nonrenew, 0)
        * (p.mean_turnover_cost + p.mean_vacancy_days * j.monthly_rent / 30.4375) as el_nonrenewal,
    j.late_bucket,
    coalesce(sc.pd, 0) as pd_delinquency,
    j.monthly_rent + j.open_balance as ead,
    p.lgd,
    coalesce(sc.pd, 0) * (j.monthly_rent + j.open_balance) * p.lgd as el_delinquency,
    coalesce(j.p_nonrenew, 0) * (p.mean_turnover_cost + p.mean_vacancy_days * j.monthly_rent / 30.4375)
        + coalesce(sc.pd, 0) * (j.monthly_rent + j.open_balance) * p.lgd as el_total,
    'C' as evidence_grade,
    'signals.s04_renewal_risk + signals.s06_delinquency_aging + risk.delinquency_pd_scorecard + risk.risk_loss_params -> risk.expected_loss_by_lease' as lineage_ref,
    {{ as_of_ts() }} as computed_at
from joined j
cross join p
left join {{ ref('delinquency_pd_scorecard') }} sc on sc.late_bucket = j.late_bucket
