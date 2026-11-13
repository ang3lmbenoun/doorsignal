select lease_id, status, outcome from {{ ref('fct_leases') }}
where (status = 'ended' and outcome = 'open') or (status = 'active' and outcome <> 'open')
