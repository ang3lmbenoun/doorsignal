select vendor_id, vendor_name, source_tag
from {{ source('raw', 'sim_vendors') }}
