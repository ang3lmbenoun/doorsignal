-- Monthly observation panel for the delinquency PD scorecard.
-- One row per active lease per month-end. Feature: late fees in the trailing lookback window.
-- Label: any late fee in the next horizon days. Only rows whose label window closed by the
-- snapshot date are kept, so no future information leaks into a score.
with obs as (
    select (date_trunc('month', d) + interval '1 month - 1 day')::date as obs_date
    from generate_series(date '2023-01-01', {{ as_of_date() }}, interval '1 month') d
),
late as (
    select lease_id, entry_date from {{ ref('fct_ledger_entries') }} where entry_type = 'late_fee'
),
panel as (
    select o.obs_date, l.lease_id, l.monthly_rent,
           (select count(*) from late x where x.lease_id = l.lease_id
              and x.entry_date > o.obs_date - {{ var('risk_lookback_days') }}
              and x.entry_date <= o.obs_date) as late_lookback,
           exists (select 1 from late x where x.lease_id = l.lease_id
              and x.entry_date > o.obs_date
              and x.entry_date <= o.obs_date + {{ var('risk_pd_horizon_days') }}) as defaulted
    from obs o
    join {{ ref('fct_leases') }} l
      on l.start_date <= o.obs_date
     and o.obs_date < l.end_date - {{ var('risk_pd_horizon_days') }}
    where o.obs_date <= {{ as_of_date() }} - {{ var('risk_pd_horizon_days') }}
)
select obs_date, lease_id, monthly_rent,
       case when late_lookback >= 3 then '3+' else late_lookback::text end as late_bucket,
       defaulted
from panel
