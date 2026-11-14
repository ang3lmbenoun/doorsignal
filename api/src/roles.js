// The only place a Postgres role name is chosen. The role comes from this fixed map, never from user text.
export const ROLES = Object.freeze({
  owner: 'api_owner',
  property_manager: 'api_property_manager',
  maintenance_coordinator: 'api_maintenance_coordinator',
  leasing_manager: 'api_leasing_manager',
  data_owner: 'api_data_owner',
});

// Claims each role must carry. Row filtering itself is done by Postgres policies, not here.
export const REQUIRED_CLAIMS = Object.freeze({
  owner: ['org_id', 'owner_id'],
  property_manager: ['org_id'],
  maintenance_coordinator: ['org_id'],
  leasing_manager: ['org_id'],
  data_owner: [],
});
