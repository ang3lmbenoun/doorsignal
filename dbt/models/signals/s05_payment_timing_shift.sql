-- S05 Payment timing shift: average days after due date, last 90 days vs the 90 before.
with active as (
    select lease_id from {{ ref('fct_leases') }}
    where start_date <= {{ as_of_date() }} and {{ as_of_date() }} < end_date
),
pay as (
    select p.entry_id, p.lease_id, p.entry_date as pay_date, max(c.entry_date) as due_date
    from {{ ref('fct_ledger_entries') }} p
    join {{ ref('fct_ledger_entries') }} c
        on c.lease_id = p.lease_id and c.entry_type = 'charge_rent' and c.entry_date <= p.entry_date
    where p.entry_type = 'payment' and p.entry_date <= {{ as_of_date() }}
    group by p.entry_id, p.lease_id, p.entry_date
),
agg as (
    select a.lease_id,
           avg(pay_date - due_date) filter (where pay_date > {{ as_of_date() }} - 90) as recent_avg,
           count(*) filter (where pay_date > {{ as_of_date() }} - 90) as recent_n,
           avg(pay_date - due_date) filter (
               where pay_date <= {{ as_of_date() }} - 90 and pay_date > {{ as_of_date() }} - 180) as prior_avg,
           count(*) filter (
               where pay_date <= {{ as_of_date() }} - 90 and pay_date > {{ as_of_date() }} - 180) as prior_n
    from active a join pay using (lease_id)
    group by a.lease_id
)
select
    lease_id as entity_id,
    'lease' as entity_type,
    'S05' as signal_id,
    round((recent_avg - prior_avg)::numeric, 2) as value,
    case when recent_avg - prior_avg >= 3 then 'shifting_late'
         when recent_avg - prior_avg <= -3 then 'improving'
         else 'stable' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_ledger_entries(payments, rent charges) -> signals.s05_payment_timing_shift' as lineage_ref,
    jsonb_build_object('recent_avg_days', round(recent_avg::numeric, 2),
                       'prior_avg_days', round(prior_avg::numeric, 2),
                       'recent_n', recent_n, 'prior_n', prior_n) as detail
from agg
where recent_n >= 2 and prior_n >= 2
