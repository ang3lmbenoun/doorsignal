-- The base scenario must reproduce expected_loss_by_lease to the cent.
select r.lease_id, r.el_total as stress_base, e.el_total as direct
from (
    select lease_id,
           coalesce(p_nonrenew, 0) * loss_if_nonrenewal + pd_delinquency * ead * lgd as el_total
    from {{ ref('stress_results') }} where scenario_id = 'base'
) r
join {{ ref('expected_loss_by_lease') }} e using (lease_id)
where abs(r.el_total - e.el_total) > 0.005
