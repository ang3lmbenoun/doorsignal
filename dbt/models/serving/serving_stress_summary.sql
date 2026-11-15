{{ config(
    alias='stress_summary',
    indexes=[{'columns': ['owner_id', 'scenario_id'], 'unique': True}, {'columns': ['org_id']}]
) }}
-- Stress totals per scenario and per owner (with the owner's org). Portfolio-wide totals are not served:
-- they would add up other orgs' leases. Callers see only their own rows; an org total is the sum of the
-- rows they may already read. delta_vs_base is computed per owner against that owner's base scenario.
with per_lease as (
    select scenario_id, owner_id,
           coalesce(p_nonrenew, 0) * loss_if_nonrenewal as el_nonrenewal,
           pd_delinquency * ead * lgd as el_delinquency
    from {{ ref('stress_results') }}
),
agg as (
    select scenario_id, owner_id, count(*) as n_leases,
           sum(el_nonrenewal) as el_nonrenewal, sum(el_delinquency) as el_delinquency,
           sum(el_nonrenewal + el_delinquency) as el_total
    from per_lease group by 1, 2
)
select m.org_id, a.owner_id, a.scenario_id, s.description, a.n_leases,
       round(a.el_nonrenewal::numeric, 2) as el_nonrenewal,
       round(a.el_delinquency::numeric, 2) as el_delinquency,
       round(a.el_total::numeric, 2) as el_total,
       round((a.el_total - b.el_total)::numeric, 2) as delta_vs_base,
       round((100 * (a.el_total / nullif(b.el_total, 0) - 1))::numeric, 1) as pct_vs_base,
       'C' as evidence_grade,
       'risk.stress_results (scenario knobs are assumptions) -> serving.stress_summary' as lineage_ref,
       {{ as_of_ts() }} as computed_at
from agg a
join {{ ref('risk_scenarios') }} s using (scenario_id)
join agg b on b.owner_id = a.owner_id and b.scenario_id = 'base'
join {{ ref('org_map') }} m on m.owner_id = a.owner_id
