-- Known-truth check: vendors not planted slow must not be labeled slow_vs_peers.
select s.entity_id
from {{ ref('s08_vendor_drift') }} s
join ground_truth.vendor_speed v on v.vendor_id = s.entity_id
where not v.planted and s.band = 'slow_vs_peers'
