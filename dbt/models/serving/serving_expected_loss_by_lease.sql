{{ config(
    alias='expected_loss_by_lease',
    indexes=[{'columns': ['lease_id'], 'unique': True}, {'columns': ['org_id', 'lease_id']}, {'columns': ['owner_id', 'lease_id']}]
) }}
-- risk.expected_loss_by_lease plus the owner's org, explicit column list (a new risk column is not served
-- until it is added here and in api/src/endpoints.js). Grade and lineage come from the risk model.
select m.org_id, e.lease_id, e.unit_id, e.property_id, e.owner_id, e.zip, e.monthly_rent, e.end_date,
       e.p_nonrenew, e.loss_if_nonrenewal, e.el_nonrenewal, e.late_bucket, e.pd_delinquency, e.ead, e.lgd,
       e.el_delinquency, e.el_total, e.evidence_grade, e.lineage_ref, e.computed_at
from {{ ref('expected_loss_by_lease') }} e
join {{ ref('org_map') }} m on m.owner_id = e.owner_id
