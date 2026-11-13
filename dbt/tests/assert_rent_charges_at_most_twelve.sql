select lease_id, n_rent_charges from {{ ref('fct_leases') }} where n_rent_charges not between 1 and 12
