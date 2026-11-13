-- Probabilities in [0,1], losses non-negative, total equals the sum of its parts.
select lease_id
from {{ ref('expected_loss_by_lease') }}
where p_nonrenew < 0 or p_nonrenew > 1
   or pd_delinquency < 0 or pd_delinquency > 1
   or lgd < 0 or lgd > 1
   or el_nonrenewal < 0 or el_delinquency < 0
   or abs(el_total - (el_nonrenewal + el_delinquency)) > 0.005
