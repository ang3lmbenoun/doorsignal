-- Layer schemas. Idempotent.
create schema if not exists raw;
create schema if not exists staging;
create schema if not exists intermediate;
create schema if not exists marts;
create schema if not exists signals;
create schema if not exists risk;
create schema if not exists ops;
create schema if not exists ground_truth;

comment on schema raw is 'Immutable landed data. Every row has load_id and source_tag.';
comment on schema ground_truth is 'Simulator planted effects. Never exposed to the API, agents, or BI.';
comment on schema ops is 'Pipeline run logs and data-trust inputs (signal S12).';
