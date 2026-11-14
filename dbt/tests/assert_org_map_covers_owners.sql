-- Every owner has exactly one org, and org_map names no owner that does not exist (a typo would hide rows).
select o.owner_id from {{ ref('stg_owners') }} o
left join {{ ref('org_map') }} m using (owner_id)
where m.owner_id is null
union all
select m.owner_id from {{ ref('org_map') }} m
left join {{ ref('stg_owners') }} o using (owner_id)
where o.owner_id is null
