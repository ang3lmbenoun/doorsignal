-- S12 (part 1) Row-count drift between the two most recent loads of each table.
with ranked as (
    select table_name, row_count,
           row_number() over (partition by table_name order by loaded_at desc, load_id desc) as rn
    from {{ source('ops', 'load_log') }}
),
pair as (
    select table_name,
           max(row_count) filter (where rn = 1) as latest_rows,
           max(row_count) filter (where rn = 2) as previous_rows
    from ranked where rn <= 2 group by table_name
)
select
    table_name as entity_id,
    'dataset' as entity_type,
    'S12' as signal_id,
    round(((latest_rows - previous_rows)::numeric / nullif(previous_rows, 0)), 4) as value,
    case when previous_rows is null then 'insufficient_history'
         when abs((latest_rows - previous_rows)::numeric / nullif(previous_rows, 0)) > 0.10 then 'drift'
         else 'ok' end as band,
    {{ as_of_ts() }} as computed_at,
    'A' as evidence_grade,
    'ops.load_log(row_count) -> signals.s12_row_drift' as lineage_ref,
    jsonb_build_object('check', 'row_count_drift', 'latest_rows', latest_rows,
                       'previous_rows', previous_rows) as detail
from pair
