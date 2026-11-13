-- Raw landing tables for the simulator (M1). No FKs in raw; integrity is checked after load.
-- source_tag marks provenance on every row (REAL_PUBLIC / SYNTHETIC_CALIBRATED / USER_EXPORT).

CREATE TABLE IF NOT EXISTS ops.load_log (
    load_id     bigserial PRIMARY KEY,
    loaded_at   timestamptz NOT NULL DEFAULT now(),
    source      text NOT NULL,
    seed        integer,
    table_name  text NOT NULL,
    row_count   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.sim_owners (
    owner_id text PRIMARY KEY, owner_name text, mgmt_fee_pct numeric, spend_limit integer,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_properties (
    property_id text PRIMARY KEY, owner_id text, property_type text, zip text, area_label text,
    year_built integer, n_units integer,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_units (
    unit_id text PRIMARY KEY, property_id text, unit_number text, beds integer, sqft integer,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_vendors (
    vendor_id text PRIMARY KEY, vendor_name text,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_tenants (
    tenant_id text PRIMARY KEY, first_seen_date date,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_leases (
    lease_id text PRIMARY KEY, unit_id text, tenant_id text, start_date date, end_date date,
    monthly_rent numeric, prior_lease_id text, status text,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_lease_events (
    event_id text PRIMARY KEY, lease_id text, event_date date, event_type text,
    value_numeric numeric,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_work_orders (
    work_order_id text PRIMARY KEY, unit_id text, lease_id text, tenant_id text, category text,
    severity text, notice_type text, submitted_at timestamp, assigned_at timestamp,
    vendor_id text, completed_at timestamp, cost numeric, satisfaction integer, status text,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');
CREATE TABLE IF NOT EXISTS raw.sim_ledger_entries (
    entry_id text PRIMARY KEY, lease_id text, entry_date date, entry_type text, amount numeric,
    source_tag text NOT NULL DEFAULT 'SYNTHETIC_CALIBRATED');

-- Hidden ground truth: never exposed to the API, agents or BI.
CREATE TABLE IF NOT EXISTS ground_truth.tenant_traits (
    tenant_id text PRIMARY KEY, reliability numeric, price_sensitivity numeric);
CREATE TABLE IF NOT EXISTS ground_truth.lease_outcomes (
    lease_id text PRIMARY KEY, renewal_prob numeric, renewed boolean, delay_z numeric,
    early_priority boolean, offered_increase_z numeric, censored boolean);
CREATE TABLE IF NOT EXISTS ground_truth.vendor_speed (
    vendor_id text PRIMARY KEY, speed_factor numeric, planted boolean);
CREATE TABLE IF NOT EXISTS ground_truth.params (key text PRIMARY KEY, value text);
