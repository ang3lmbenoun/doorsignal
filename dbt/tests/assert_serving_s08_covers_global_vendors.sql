-- Every vendor with completed work in the global S08 must have a per-org S08 row in at least one org.
-- (Values differ from the global signal by design: the peer baseline is computed inside each org.)
select g.entity_id, g.band as global_band
from {{ ref('s08_vendor_drift') }} g
left join {{ ref('serving_vendor_signals') }} v on v.entity_id = g.entity_id
where v.entity_id is null
