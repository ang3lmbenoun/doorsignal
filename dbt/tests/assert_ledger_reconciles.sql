-- M2 gate: mart ledger must reconcile exactly to the raw ledger, per lease and in total.
with raw_totals as (
    select lease_id, sum(amount) as amt, count(*) as n
    from {{ source('raw', 'sim_ledger_entries') }} group by lease_id
),
mart_totals as (
    select lease_id, sum(amount) as amt, count(*) as n
    from {{ ref('fct_ledger_entries') }} group by lease_id
)
select coalesce(r.lease_id, m.lease_id) as lease_id, r.amt as raw_amt, m.amt as mart_amt
from raw_totals r
full join mart_totals m on m.lease_id = r.lease_id
where r.amt is distinct from m.amt or r.n is distinct from m.n

union all

select l.lease_id, r.amt as raw_amt, l.ledger_balance as mart_amt
from {{ ref('fct_leases') }} l
left join (
    select lease_id, sum(amount) as amt from {{ source('raw', 'sim_ledger_entries') }}
    group by lease_id
) r on r.lease_id = l.lease_id
where r.amt is distinct from l.ledger_balance
