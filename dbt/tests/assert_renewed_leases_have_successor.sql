select l.lease_id
from {{ ref('fct_leases') }} l
where l.outcome = 'renewed'
  and not exists (select 1 from {{ ref('stg_leases') }} s where s.prior_lease_id = l.lease_id)
