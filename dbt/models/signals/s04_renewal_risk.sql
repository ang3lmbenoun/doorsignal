-- S04 Renewal risk at 120/90/60 days before expiry. Value is P(non-renewal).
-- The offered increase is used only once the offer event exists as of the snapshot date.
with coef as (
    select
        max(value) filter (where term = 'intercept') as b0,
        max(value) filter (where term = 'b_has_early_wo') as b_has_wo,
        max(value) filter (where term = 'b_delay_ln_hours') as b_delay,
        max(value) filter (where term = 'b_early_priority') as b_priority,
        max(value) filter (where term = 'b_offer_z') as b_offer,
        max(value) filter (where term = 'center_ln_delay') as c_delay,
        max(value) filter (where term = 'center_offer_pct') as c_offer,
        max(value) filter (where term = 'scale_offer_pct') as s_offer
    from {{ ref('s04_coefficients') }}
),
active as (
    select lease_id, end_date, end_date - {{ as_of_date() }} as days_to_expiry,
           early_wo_count, early_avg_ln_assign_hours, early_has_priority
    from {{ ref('fct_leases') }}
    where start_date <= {{ as_of_date() }}
      and {{ as_of_date() }} < end_date
      and end_date - {{ as_of_date() }} <= 120
),
offer as (
    select lease_id, max(value_numeric) as offered_pct
    from {{ ref('stg_lease_events') }}
    where event_type = 'renewal_offer' and event_date <= {{ as_of_date() }}
    group by lease_id
),
terms as (
    select a.lease_id, a.days_to_expiry, o.offered_pct is not null as offer_known,
           c.b0,
           case when a.early_wo_count > 0 then c.b_has_wo else 0 end as t_has_wo,
           case when a.early_wo_count > 0
                then c.b_delay * (a.early_avg_ln_assign_hours - c.c_delay) else 0 end as t_delay,
           c.b_priority * (a.early_has_priority::int) as t_priority,
           case when o.offered_pct is not null
                then c.b_offer * (o.offered_pct - c.c_offer) / c.s_offer else 0 end as t_offer
    from active a cross join coef c left join offer o using (lease_id)
),
scored as (
    select *, 1 / (1 + exp(-(b0 + t_has_wo + t_delay + t_priority + t_offer))) as p_nonrenew from terms
)
select
    lease_id as entity_id,
    'lease' as entity_type,
    'S04' as signal_id,
    round(p_nonrenew::numeric, 4) as value,
    case when p_nonrenew >= 0.55 then 'high' when p_nonrenew >= 0.40 then 'medium' else 'low' end as band,
    {{ as_of_ts() }} as computed_at,
    'C' as evidence_grade,
    'marts.fct_leases(early-90 features) + stg_lease_events(offer) + seed s04_coefficients -> signals.s04_renewal_risk' as lineage_ref,
    jsonb_build_object(
        'days_to_expiry', days_to_expiry,
        'horizon', case when days_to_expiry > 90 then 120 when days_to_expiry > 60 then 90 else 60 end,
        'offer_known', offer_known,
        'drivers', jsonb_build_object('any_request', round(t_has_wo::numeric, 3),
                                      'delay', round(t_delay::numeric, 3),
                                      'priority', round(t_priority::numeric, 3),
                                      'offer', round(t_offer::numeric, 3))
    ) as detail
from scored
