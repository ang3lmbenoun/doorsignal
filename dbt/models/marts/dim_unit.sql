select u.unit_id, u.property_id, u.unit_number, u.bedrooms, u.sqft,
       p.owner_id, p.property_type, p.zip, p.area_label, p.year_built
from {{ ref('stg_units') }} u
join {{ ref('dim_property') }} p using (property_id)
