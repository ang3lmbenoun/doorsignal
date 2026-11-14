-- Only dataset signals (S12) may lack an org. Vendor rows must have an org and no owner. Every other row
-- must carry both owner and org. Anything else would be invisible to scoped roles, or ambiguous.
select entity_type, entity_id, signal_id from {{ ref('serving_all_signals') }}
where (entity_type = 'dataset' and (org_id is not null or owner_id is not null))
   or (entity_type = 'vendor' and (org_id is null or owner_id is not null))
   or (entity_type not in ('dataset', 'vendor') and (org_id is null or owner_id is null))
