-- The seed must contain base and only positive multipliers.
select 'missing base' as problem where not exists (select 1 from {{ ref('risk_scenarios') }} where scenario_id = 'base')
union all
select scenario_id from {{ ref('risk_scenarios') }}
where delay_multiplier <= 0 or pd_multiplier <= 0 or extra_vacancy_days < 0
