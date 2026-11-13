-- S07 Vacancy loss run-rate. Last lease rent stands in for asking rent.
with last_lease as (
    select distinct on (unit_id) unit_id, end_date, monthly_rent
    from {{ ref('fct_leases') }}
    where end_date <= {{ as_of_date() }}
    order by unit_id, end_date desc
),
occupied as (
    select distinct unit_id from {{ ref('fct_leases') }}
    where start_date <= {{ as_of_date() }} and {{ as_of_date() }} < end_date
),
vacant as (
    select l.unit_id, l.monthly_rent,
           {{ as_of_date() }} - l.end_date as vacant_days,
           l.monthly_rent / 30.4375 as daily_rent
    from last_lease l
    where l.unit_id not in (select unit_id from occupied)
)
select
    unit_id as entity_id,
    'unit' as entity_type,
    'S07' as signal_id,
    round((vacant_days * daily_rent)::numeric, 2) as value,
    case when vacant_days > 45 then 'high' when vacant_days > 30 then 'elevated' else 'normal' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_leases(end_date, monthly_rent) -> signals.s07_vacancy_loss' as lineage_ref,
    jsonb_build_object('vacant_days', vacant_days, 'daily_rent', round(daily_rent::numeric, 2)) as detail
from vacant
