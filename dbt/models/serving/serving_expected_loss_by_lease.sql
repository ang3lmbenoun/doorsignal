{{ config(alias='expected_loss_by_lease') }}
-- risk.expected_loss_by_lease plus the owner's org. Grade and lineage come from the risk model.
select m.org_id, e.*
from {{ ref('expected_loss_by_lease') }} e
join {{ ref('org_map') }} m on m.owner_id = e.owner_id
