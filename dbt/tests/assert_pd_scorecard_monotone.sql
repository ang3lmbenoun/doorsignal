-- More recent late fees must never lower the PD. A break means the bucket data is too thin or the feature is wrong.
select a.late_bucket as lower_bucket, b.late_bucket as higher_bucket, a.pd, b.pd as pd_higher
from {{ ref('delinquency_pd_scorecard') }} a
join {{ ref('delinquency_pd_scorecard') }} b
  on (a.late_bucket = '0' and b.late_bucket = '1')
  or (a.late_bucket = '1' and b.late_bucket = '2')
  or (a.late_bucket = '2' and b.late_bucket = '3+')
where b.pd < a.pd
