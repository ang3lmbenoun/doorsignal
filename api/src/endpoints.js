// Read-only endpoints over the serving tables. `columns` is the reviewed list of served columns: a column
// added to a dbt model is not served until it is added here. Table, column and ORDER BY names are fixed here; request values
// are only ever bound parameters, and each filter value must match its pattern before it reaches the query.
// Which rows a caller sees is decided by Postgres (role grants and row-level security), not by this list.
export const ENDPOINTS = [
  {
    path: '/v1/signals',
    table: 'all_signals',
    columns: ['org_id', 'owner_id', 'entity_id', 'entity_type', 'signal_id', 'value', 'band', 'computed_at', 'evidence_grade', 'lineage_ref', 'detail'],
    orderBy: 'signal_id, entity_type, entity_id, org_id, owner_id', // unique per row (dbt test), so offset paging is stable
    idColumn: 'entity_id',
    filters: {
      signal_id: /^S\d{2}$/,
      entity_type: /^(lease|unit|work_order|vendor|dataset)$/,
      band: /^[a-z_]{1,32}$/,
    },
  },
  {
    path: '/v1/expected-loss',
    table: 'expected_loss_by_lease',
    columns: ['org_id', 'lease_id', 'unit_id', 'property_id', 'owner_id', 'zip', 'monthly_rent', 'end_date', 'p_nonrenew', 'loss_if_nonrenewal', 'el_nonrenewal', 'late_bucket', 'pd_delinquency', 'ead', 'lgd', 'el_delinquency', 'el_total', 'evidence_grade', 'lineage_ref', 'computed_at'],
    orderBy: 'lease_id',
    idColumn: 'lease_id',
    filters: {},
  },
  {
    path: '/v1/stress',
    table: 'stress_summary',
    columns: ['org_id', 'owner_id', 'scenario_id', 'description', 'n_leases', 'el_nonrenewal', 'el_delinquency', 'el_total', 'delta_vs_base', 'pct_vs_base', 'evidence_grade', 'lineage_ref', 'computed_at'],
    orderBy: 'owner_id, scenario_id',
    filters: { scenario_id: /^[a-z0-9_]{1,40}$/ },
  },
  {
    path: '/v1/risk-register',
    table: 'risk_register',
    columns: ['risk_id', 'category', 'description', 'likelihood', 'impact', 'score', 'band', 'controls', 'owner_role', 'review_date', 'linked_signals', 'score_basis', 'evidence_grade', 'lineage_ref', 'computed_at'],
    orderBy: 'risk_id',
    filters: {},
  },
  {
    path: '/v1/work-orders',
    table: 'work_orders',
    columns: ['work_order_id', 'lease_id', 'unit_id', 'property_id', 'owner_id', 'org_id', 'zip', 'category', 'severity', 'notice_type', 'vendor_id', 'submitted_at', 'assigned_at', 'completed_at', 'assign_hours', 'repair_days', 'vendor_days', 'cost', 'status', 'is_written_notice', 'is_open', 'evidence_grade', 'lineage_ref', 'computed_at'],
    orderBy: 'work_order_id',
    idColumn: 'work_order_id',
    filters: { status: /^[a-z_]{1,20}$/, category: /^[a-z_]{1,30}$/ },
  },
  {
    path: '/v1/leases',
    table: 'leases',
    columns: ['lease_id', 'unit_id', 'property_id', 'owner_id', 'org_id', 'zip', 'bedrooms', 'start_date', 'end_date', 'monthly_rent', 'prior_lease_id', 'status', 'is_renewal_lease', 'outcome', 'offered_increase_pct', 'early_wo_count', 'early_has_priority', 'safmr_rent', 'rent_to_safmr', 'evidence_grade', 'lineage_ref', 'computed_at'],
    orderBy: 'lease_id',
    idColumn: 'lease_id',
    filters: { status: /^[a-z_]{1,20}$/, outcome: /^[a-z_]{1,20}$/ },
  },
];
