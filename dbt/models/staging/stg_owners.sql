select owner_id, owner_name, mgmt_fee_pct::numeric as mgmt_fee_pct, spend_limit::integer as spend_limit,
       source_tag
from {{ source('raw', 'sim_owners') }}
