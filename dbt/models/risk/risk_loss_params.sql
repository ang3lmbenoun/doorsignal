-- Loss-given-event parameters, estimated from data observed on or before the snapshot date.
-- One row. Nothing here is read from sim/config.yaml: the pipeline must learn these from the ledger.
with moved as (
    select turnover_cost, vacancy_days
    from {{ ref('fct_leases') }}
    where outcome = 'moved_out' and end_date <= {{ as_of_date() }}
      and turnover_cost is not null and vacancy_days is not null
),
sev as (
    select count(*) as n_moved_out,
           avg(turnover_cost) as mean_turnover_cost,
           avg(vacancy_days) as mean_vacancy_days
    from moved
),
lgd as (
    -- Ended leases only (ledger complete). Unrecovered rent over rent that went delinquent.
    select count(*) as n_delinquent_leases,
           sum(greatest(rent_charged - payments, 0)) as unrecovered_rent,
           sum(n_late_payments * monthly_rent) as delinquent_rent
    from {{ ref('fct_leases') }}
    where end_date <= {{ as_of_date() }} - 60 and n_late_payments > 0
)
select
    s.n_moved_out, s.mean_turnover_cost, s.mean_vacancy_days,
    g.n_delinquent_leases, g.unrecovered_rent, g.delinquent_rent,
    g.unrecovered_rent / nullif(g.delinquent_rent, 0) as lgd_raw,
    least(greatest(g.unrecovered_rent / nullif(g.delinquent_rent, 0), 0), 1) as lgd,
    {{ as_of_ts() }} as computed_at
from sev s cross join lgd g
