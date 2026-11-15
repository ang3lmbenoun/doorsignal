{{ config(
    alias='risk_register',
    indexes=[{'columns': ['risk_id'], 'unique': True}, {'columns': ['owner_role']}]
) }}
-- Risk register rows. Global reference data: no org or owner. Each role sees the rows whose owner_role
-- is that role; data_owner sees all (policy in ingest/sql/31_serving_rls.sql). Scores are judgment inputs.
select risk_id, category, description, likelihood, impact, score, band, controls, owner_role,
       review_date, linked_signals, score_basis,
       'C' as evidence_grade,
       'seeds.risk_register_input (judgment) -> risk.risk_register -> serving.risk_register' as lineage_ref,
       {{ as_of_ts() }} as computed_at
from {{ ref('risk_register') }}
