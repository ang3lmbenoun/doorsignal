-- Qualitative risk register. Likelihood and impact are judgment inputs (1-5), not measurements.
-- Linked signals are checked against the signal registry by a singular test.
select
    risk_id, category, description, likelihood, impact,
    likelihood * impact as score,
    case when likelihood * impact >= 15 then 'high'
         when likelihood * impact >= 8 then 'medium' else 'low' end as band,
    controls, owner_role, review_date::date as review_date, linked_signals, score_basis
from {{ ref('risk_register_input') }}
