-- Each model term must appear exactly once; stress and S04 pick terms with max().
select term, count(*) from {{ ref('s04_coefficients') }} group by 1 having count(*) <> 1
