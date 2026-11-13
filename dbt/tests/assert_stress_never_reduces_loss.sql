-- Every scenario in the seed only makes things worse, so no scenario total may fall below base.
select scenario_id, el_total, delta_vs_base
from {{ ref('stress_summary') }}
where delta_vs_base < -0.005
