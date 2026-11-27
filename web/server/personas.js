// Synthetic demo people. Roles, orgs and owners follow sim/config.yaml (O01-O03 -> ORG1, O04-O06 -> ORG2).
// `sub` is what the approval log records as the decider.
export const PERSONAS = Object.freeze([
  { id: 'pat', name: 'Pat Rivera', title: 'Property manager, ORG1', role: 'property_manager', org_id: 'ORG1', sub: 'pat.rivera' },
  { id: 'maya', name: 'Maya Chen', title: 'Maintenance coordinator, ORG1', role: 'maintenance_coordinator', org_id: 'ORG1', sub: 'maya.chen' },
  { id: 'leo', name: 'Leo Ortiz', title: 'Leasing manager, ORG1', role: 'leasing_manager', org_id: 'ORG1', sub: 'leo.ortiz' },
  { id: 'olivia', name: 'Olivia Grant', title: 'Owner O01, ORG1', role: 'owner', org_id: 'ORG1', owner_id: 'O01', sub: 'olivia.grant' },
  { id: 'sam', name: 'Sam Patel', title: 'Property manager, ORG2', role: 'property_manager', org_id: 'ORG2', sub: 'sam.patel' },
  { id: 'dana', name: 'Dana Wu', title: 'Data owner (all orgs)', role: 'data_owner', sub: 'dana.wu' },
]);

export const personaById = (id) => PERSONAS.find((p) => p.id === id) ?? null;
export const publicPersona = (p) => ({ id: p.id, name: p.name, title: p.title, role: p.role, org_id: p.org_id ?? null, owner_id: p.owner_id ?? null });
