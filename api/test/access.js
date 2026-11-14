// The access rules from docs/api.md, written independently of ingest/sql/31_serving_rls.sql.
// The leak tests compute the rows each caller may see from these rules (using the owner connection) and
// require the API to return exactly that set. If the policy SQL and this file disagree, a test fails.
export const ROLE_NAMES = ['owner', 'property_manager', 'maintenance_coordinator', 'leasing_manager', 'data_owner'];

const own = (r, c) => r.owner_id === c.owner && r.org_id === c.org;
const org = (r, c) => r.org_id === c.org;
const all = () => true;

// endpoint path -> { table, key(row), id (by-id column or null), rules: role -> predicate | undefined (no access) }
export const ACCESS = {
  '/v1/signals': {
    table: 'all_signals',
    key: (r) => [r.signal_id, r.entity_id, r.org_id, r.owner_id].join('|'),
    id: 'entity_id',
    rules: {
      owner: own,
      property_manager: org,
      maintenance_coordinator: (r, c) => org(r, c) && ['S01', 'S02', 'S08'].includes(r.signal_id),
      leasing_manager: (r, c) => org(r, c) && ['S03', 'S04'].includes(r.signal_id),
      data_owner: all,
    },
  },
  '/v1/expected-loss': {
    table: 'expected_loss_by_lease',
    key: (r) => r.lease_id,
    id: 'lease_id',
    rules: { owner: own, property_manager: org, data_owner: all },
  },
  '/v1/stress': {
    table: 'stress_summary',
    key: (r) => [r.scenario_id, r.owner_id].join('|'),
    id: null,
    rules: { owner: own, property_manager: org, data_owner: all },
  },
  '/v1/risk-register': {
    table: 'risk_register',
    key: (r) => r.risk_id,
    id: null,
    // Rows assigned to the caller's role; data_owner sees all. (owner has none: no risk is assigned to it.)
    rules: Object.fromEntries(
      ROLE_NAMES.map((role) => [role, role === 'data_owner' ? all : (r) => r.owner_role === role]),
    ),
    emptyFor: ['owner'],
  },
  '/v1/work-orders': {
    table: 'work_orders',
    key: (r) => r.work_order_id,
    id: 'work_order_id',
    rules: { owner: own, property_manager: org, maintenance_coordinator: org, data_owner: all },
  },
  '/v1/leases': {
    table: 'leases',
    key: (r) => r.lease_id,
    id: 'lease_id',
    rules: { owner: own, property_manager: org, leasing_manager: org, data_owner: all },
  },
};
