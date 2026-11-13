select event_id, lease_id, event_date, event_type, value_numeric::numeric as value_numeric, source_tag
from {{ source('raw', 'sim_lease_events') }}
