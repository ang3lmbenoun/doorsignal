-- Signed amounts: charges and fees are positive, payments are negative.
select entry_id, lease_id, entry_date, entry_type, amount::numeric as amount, source_tag
from {{ source('raw', 'sim_ledger_entries') }}
