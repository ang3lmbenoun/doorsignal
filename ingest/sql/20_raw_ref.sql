-- Real public reference data (evidence grade A). Loaded by ingest/load_hud.py.
CREATE TABLE IF NOT EXISTS ops.load_log (
    load_id     bigserial PRIMARY KEY,
    loaded_at   timestamptz NOT NULL DEFAULT now(),
    source      text NOT NULL,
    seed        integer,
    table_name  text NOT NULL,
    row_count   integer NOT NULL
);
CREATE TABLE IF NOT EXISTS raw.ref_hud_safmr (
    zip text NOT NULL, hud_area_name text, bedrooms integer NOT NULL, safmr_rent numeric NOT NULL,
    fiscal_year integer NOT NULL,
    source_tag text NOT NULL DEFAULT 'REAL_PUBLIC',
    PRIMARY KEY (zip, bedrooms));
