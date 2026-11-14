-- Every signal named in the risk register must exist in the signal registry.
with linked as (
    select risk_id, unnest(string_to_array(linked_signals, ';')) as signal_id
    from {{ ref('risk_register') }}
)
select l.risk_id, l.signal_id
from linked l
left join {{ ref('signal_registry') }} r using (signal_id)
where r.signal_id is null
