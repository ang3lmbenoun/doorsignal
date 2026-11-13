select
    l.lease_id, l.unit_id, u.property_id, u.owner_id, u.zip, u.bedrooms, l.tenant_id,
    l.start_date, l.end_date, l.monthly_rent, l.prior_lease_id, l.status,
    (l.prior_lease_id is not null) as is_renewal_lease,
    case when coalesce(o.is_renewed, false) then 'renewed'
         when coalesce(o.is_moved_out, false) then 'moved_out' else 'open' end
        as outcome,
    o.offered_increase_pct, o.turnover_cost, o.vacancy_days,
    e.early_wo_count, e.early_avg_assign_hours, e.early_avg_ln_assign_hours, e.early_has_priority,
    b.n_rent_charges, b.rent_charged, b.late_fees, b.payments, b.n_late_payments,
    b.balance as ledger_balance,
    h.safmr_rent,
    l.monthly_rent / nullif(h.safmr_rent, 0) as rent_to_safmr
from {{ ref('stg_leases') }} l
join {{ ref('dim_unit') }} u using (unit_id)
left join {{ ref('int_lease_outcomes') }} o using (lease_id)
join {{ ref('int_lease_early_90') }} e using (lease_id)
left join {{ ref('int_lease_balance') }} b using (lease_id)
left join {{ ref('stg_hud_safmr') }} h on h.zip = u.zip and h.bedrooms = u.bedrooms
