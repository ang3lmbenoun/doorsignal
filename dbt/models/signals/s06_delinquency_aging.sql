-- S06 Delinquency aging and exposure. Payments are applied first-in first-out to charges and late fees.
with active as (
    select lease_id from {{ ref('fct_leases') }}
    where start_date <= {{ as_of_date() }} and {{ as_of_date() }} < end_date
),
e as (
    select lease_id, entry_id, entry_date, entry_type, amount
    from {{ ref('fct_ledger_entries') }} where entry_date <= {{ as_of_date() }}
),
paid as (
    select lease_id, -coalesce(sum(amount) filter (where entry_type = 'payment'), 0) as total_paid
    from e group by lease_id
),
charges as (
    select lease_id, entry_date, amount,
           sum(amount) over (partition by lease_id order by entry_date, entry_id) as cum_charged
    from e where amount > 0
),
agg as (
    select a.lease_id,
           (select coalesce(sum(amount), 0) from charges c where c.lease_id = a.lease_id)
               - coalesce(p.total_paid, 0) as open_balance,
           (select min(c.entry_date) from charges c
             where c.lease_id = a.lease_id and c.cum_charged > coalesce(p.total_paid, 0)) as oldest_unpaid
    from active a left join paid p using (lease_id)
),
aged as (
    select lease_id, open_balance, oldest_unpaid, {{ as_of_date() }} - oldest_unpaid as age_days
    from agg where open_balance > 0.01 and oldest_unpaid is not null
)
select
    lease_id as entity_id,
    'lease' as entity_type,
    'S06' as signal_id,
    round(open_balance::numeric, 2) as value,
    case when age_days > 60 then '61+' when age_days > 30 then '31-60' else '0-30' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_ledger_entries -> signals.s06_delinquency_aging' as lineage_ref,
    jsonb_build_object('age_days', age_days, 'oldest_unpaid', oldest_unpaid) as detail
from aged
where age_days > 3
