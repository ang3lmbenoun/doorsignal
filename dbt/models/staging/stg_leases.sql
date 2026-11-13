select lease_id, unit_id, tenant_id, start_date, end_date, monthly_rent::numeric as monthly_rent,
       prior_lease_id, status, source_tag
from {{ source('raw', 'sim_leases') }}
