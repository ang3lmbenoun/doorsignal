select zip, hud_area_name, bedrooms::integer as bedrooms, safmr_rent::numeric as safmr_rent,
       fiscal_year, source_tag
from {{ source('raw', 'ref_hud_safmr') }}
