select unit_id, property_id, unit_number, beds::integer as bedrooms, sqft::integer as sqft, source_tag
from {{ source('raw', 'sim_units') }}
