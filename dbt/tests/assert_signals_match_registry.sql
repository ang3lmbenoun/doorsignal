-- Every signal row must have a registry row with the same evidence grade.
select s.signal_id, s.evidence_grade, r.evidence_grade as registry_grade
from {{ ref('all_signals') }} s
left join {{ ref('signal_registry') }} r using (signal_id)
where r.signal_id is null or r.evidence_grade <> s.evidence_grade
