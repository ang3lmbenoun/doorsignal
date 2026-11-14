{{ config(
    alias='all_signals',
    indexes=[{'columns': ['entity_id']}, {'columns': ['org_id', 'signal_id']}, {'columns': ['owner_id', 'signal_id']}],
    post_hook="create unique index on {{ this }} (signal_id, entity_type, entity_id, org_id, owner_id) nulls not distinct"
) }}
-- Every signal with the org and owner it belongs to, for row-level security.
--   lease / unit / work_order rows: owner resolved through the marts, org through org_map.
--   vendor rows: replaced by the per-org S08 in vendor_signals (org set, owner null).
--   dataset rows (S12): no owner, no org; only data_owner matches them.
-- A row whose owner cannot be resolved keeps null org and owner, so no scoped role sees it.
with ent as (
    select 'lease' as entity_type, lease_id::text as entity_id, owner_id from {{ ref('fct_leases') }}
    union all
    select 'unit', unit_id::text, owner_id from {{ ref('dim_unit') }}
    union all
    select 'work_order', work_order_id::text, owner_id from {{ ref('fct_work_orders') }}
),
scoped as (
    select s.entity_id::text as entity_id, s.entity_type, s.signal_id, s.value, s.band, s.computed_at,
           s.evidence_grade, s.lineage_ref, s.detail, e.owner_id
    from {{ ref('all_signals') }} s
    left join ent e on e.entity_type = s.entity_type and e.entity_id = s.entity_id::text
    where s.entity_type <> 'vendor'
      -- S12 also watches the ground_truth tables. Their names and row counts are not served (M5a rule).
      and s.entity_id::text not like 'ground\_truth.%'
)
select m.org_id, c.owner_id, c.entity_id, c.entity_type, c.signal_id, c.value, c.band, c.computed_at,
       c.evidence_grade, c.lineage_ref, c.detail
from scoped c
left join {{ ref('org_map') }} m on m.owner_id = c.owner_id
union all
select v.org_id, null::text, v.entity_id::text, v.entity_type, v.signal_id, v.value, v.band, v.computed_at,
       v.evidence_grade, v.lineage_ref, v.detail
from {{ ref('serving_vendor_signals') }} v
