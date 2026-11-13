-- PD scorecard: observed probability of at least one late fee in the next horizon days,
-- by trailing late-fee bucket. Transparent lookup table, not a fitted model.
-- Buckets with fewer than risk_min_bucket_n observations fall back to the portfolio rate.
with buckets as (
    select unnest(array['0', '1', '2', '3+']) as late_bucket
),
agg as (
    select b.late_bucket, count(p.lease_id) as n_obs, avg(p.defaulted::int) as pd_observed
    from buckets b
    left join {{ ref('delinquency_pd_panel') }} p using (late_bucket)
    group by 1
),
overall as (
    select avg(defaulted::int) as pd_portfolio from {{ ref('delinquency_pd_panel') }}
)
select a.late_bucket, a.n_obs, a.pd_observed,
       case when a.n_obs >= {{ var('risk_min_bucket_n') }} then a.pd_observed
            else o.pd_portfolio end as pd,
       a.n_obs < {{ var('risk_min_bucket_n') }} as used_fallback,
       {{ as_of_ts() }} as computed_at
from agg a cross join overall o
