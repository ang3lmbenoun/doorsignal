{# Snapshot time for every signal: the end of as_of_date. Deterministic, never current_date. #}
{% macro as_of_date() -%}date '{{ var("as_of_date") }}'{%- endmacro %}
{% macro as_of_ts() -%}(date '{{ var("as_of_date") }}' + 1)::timestamp{%- endmacro %}
