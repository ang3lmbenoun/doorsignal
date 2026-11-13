-- S01 must fire at 7 days and never before.
select entity_id, value, band from {{ ref('s01_texas_repair_clock') }}
where (band = 'breach_presumed' and value < 7) or (band <> 'breach_presumed' and value >= 7)
