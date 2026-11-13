select tenant_id, first_seen_date, source_tag
from {{ source('raw', 'sim_tenants') }}
