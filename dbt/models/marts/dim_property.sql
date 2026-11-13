select p.property_id, p.owner_id, o.owner_name, o.mgmt_fee_pct, o.spend_limit, p.property_type,
       p.zip, p.area_label, p.year_built, p.n_units
from {{ ref('stg_properties') }} p
join {{ ref('stg_owners') }} o using (owner_id)
