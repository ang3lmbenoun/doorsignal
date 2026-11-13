-- Known-truth check (reads ground_truth, test use only): the planted slow vendor must be flagged.
select v.vendor_id
from ground_truth.vendor_speed v
left join {{ ref('s08_vendor_drift') }} s on s.entity_id = v.vendor_id
where v.planted and coalesce(s.band, '') <> 'slow_vs_peers'
