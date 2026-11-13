select property_id, owner_id, property_type, zip, area_label, year_built::integer as year_built,
       n_units::integer as n_units, source_tag
from {{ source('raw', 'sim_properties') }}
