-- Portfolio expected loss by scenario, with change versus base.
with per_lease as (
    select scenario_id, lease_id,
           coalesce(p_nonrenew, 0) * loss_if_nonrenewal as el_nonrenewal,
           pd_delinquency * ead * lgd as el_delinquency
    from {{ ref('stress_results') }}
),
agg as (
    select scenario_id, count(*) as n_leases,
           sum(el_nonrenewal) as el_nonrenewal, sum(el_delinquency) as el_delinquency,
           sum(el_nonrenewal + el_delinquency) as el_total
    from per_lease group by 1
)
select a.scenario_id, s.description, a.n_leases,
       round(a.el_nonrenewal::numeric, 2) as el_nonrenewal,
       round(a.el_delinquency::numeric, 2) as el_delinquency,
       round(a.el_total::numeric, 2) as el_total,
       round((a.el_total - b.el_total)::numeric, 2) as delta_vs_base,
       round((100 * (a.el_total / nullif(b.el_total, 0) - 1))::numeric, 1) as pct_vs_base,
       {{ as_of_ts() }} as computed_at
from agg a
join {{ ref('risk_scenarios') }} s using (scenario_id)
cross join (select el_total from agg where scenario_id = 'base') b
