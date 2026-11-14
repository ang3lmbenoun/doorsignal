{{ config(
    alias='leases',
    indexes=[{'columns': ['lease_id'], 'unique': True}, {'columns': ['org_id', 'lease_id']}, {'columns': ['owner_id', 'lease_id']}]
) }}
-- Leases for leasing, scoped by org. Explicit column list. Not served: tenant id, ledger balances and
-- payments (delinquency detail), turnover cost. No tenant attributes exist in fct_leases (rule 5).
select l.lease_id, l.unit_id, l.property_id, l.owner_id, m.org_id, l.zip, l.bedrooms,
       l.start_date, l.end_date, l.monthly_rent, l.prior_lease_id, l.status,
       l.is_renewal_lease, l.outcome, l.offered_increase_pct,
       l.early_wo_count, l.early_has_priority,
       l.safmr_rent, l.rent_to_safmr,
       'C' as evidence_grade,
       'raw.sim_leases (synthetic) + raw.ref_hud_safmr (REAL_PUBLIC rent) -> marts.fct_leases -> serving.leases' as lineage_ref,
       {{ as_of_ts() }} as computed_at
from {{ ref('fct_leases') }} l
join {{ ref('org_map') }} m on m.owner_id = l.owner_id
