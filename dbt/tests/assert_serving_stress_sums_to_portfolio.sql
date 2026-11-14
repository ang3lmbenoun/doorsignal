-- Per-owner stress rows must add up to the portfolio stress_summary (to the cent, allowing rounding of
-- at most half a cent per owner). Guards against losing an owner in the org join.
with s as (
    select scenario_id, sum(el_total) as el_total from {{ ref('serving_stress_summary') }} group by 1
)
select p.scenario_id, p.el_total as portfolio, s.el_total as by_owner
from {{ ref('stress_summary') }} p
left join s using (scenario_id)
where s.el_total is null or abs(p.el_total - s.el_total) > 0.05
