select entity_id, signal_id, count(*) as n
from {{ ref('all_signals') }}
group by entity_id, signal_id
having count(*) > 1
