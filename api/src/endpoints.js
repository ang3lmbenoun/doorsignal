// Read-only endpoints over the serving tables. Table, column and ORDER BY names are fixed here; request values
// are only ever bound parameters, and each filter value must match its pattern before it reaches the query.
// Which rows a caller sees is decided by Postgres (role grants and row-level security), not by this list.
export const ENDPOINTS = [
  {
    path: '/v1/signals',
    table: 'all_signals',
    orderBy: 'signal_id, entity_id, org_id, owner_id', // unique per row, so offset paging is stable
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
    orderBy: 'lease_id',
    idColumn: 'lease_id',
    filters: {},
  },
  {
    path: '/v1/stress',
    table: 'stress_summary',
    orderBy: 'owner_id, scenario_id',
    filters: { scenario_id: /^[a-z0-9_]{1,40}$/ },
  },
  {
    path: '/v1/risk-register',
    table: 'risk_register',
    orderBy: 'risk_id',
    filters: {},
  },
  {
    path: '/v1/work-orders',
    table: 'work_orders',
    orderBy: 'work_order_id',
    idColumn: 'work_order_id',
    filters: { status: /^[a-z_]{1,20}$/, category: /^[a-z_]{1,30}$/ },
  },
  {
    path: '/v1/leases',
    table: 'leases',
    orderBy: 'lease_id',
    idColumn: 'lease_id',
    filters: { status: /^[a-z_]{1,20}$/, outcome: /^[a-z_]{1,20}$/ },
  },
];
