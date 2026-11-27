// Deterministic triage (no model). Used when the agent runs with --rules-only, when every provider fails, and
// for any batch whose model output is rejected. Thresholds follow the signal registry; S01 is a simplified
// rebuttable presumption, never a legal finding.
import { flagSupported } from './schema.js';

const sentence = (n) => (n === 1 ? '1 day' : `${n} days`);

export function reasonFor(kind, c) {
  switch (kind) {
    case 'repair_breach_presumed': return `Open written-notice repair is ${c.s01.value.toFixed(1)} days old (S01: presumption threshold of 7 days reached).`;
    case 'repair_at_risk': return `Open written-notice repair is ${c.s01.value.toFixed(1)} days old (S01: at risk from 5 days).`;
    case 'emergency_watch': return `Emergency request open for ${sentence(Math.floor(c.s01.value))} or more (S01 emergency watch).`;
    case 'slow_assignment': return `Assignment took longer than usual for ${c.category} / ${c.severity} requests (S02: ${c.s02.band}).`;
    case 'repeat_issue': return `Same unit and category requested again within 30 days (S09: ${c.s09.band}).`;
    default: return '';
  }
}

export function tenantMessage(c) {
  return (
    `Hello. This is an update on the repair request for unit ${c.unit_id} (work order ${c.work_order_id}, ${c.category}). ` +
    'The repair is not yet recorded as completed and we are working on the next step. ' +
    'We will confirm the plan with you as soon as it is scheduled.'
  );
}

export function vendorSuggestion(c) {
  return (
    `Suggestion for the coordinator: work order ${c.work_order_id} (${c.category}, ${c.severity}) with vendor ${c.vendor_id} ` +
    `showed a slower-than-usual assignment (S02: ${c.s02.band}). Consider whether to assign a different vendor.`
  );
}

export function triageRules(cases) {
  const flags = [];
  const drafts = [];
  for (const c of cases) {
    for (const kind of ['repair_breach_presumed', 'repair_at_risk', 'emergency_watch', 'slow_assignment', 'repeat_issue']) {
      if (flagSupported(kind, c)) flags.push({ work_order_id: c.work_order_id, kind, reason: reasonFor(kind, c) });
    }
    if (c.s01 && c.s01.band !== 'ok') drafts.push({ work_order_id: c.work_order_id, kind: 'tenant_status_message', text: tenantMessage(c) });
    if (c.vendor_id && c.s02 && c.s02.band === 'high') {
      drafts.push({ work_order_id: c.work_order_id, kind: 'vendor_reassignment_suggestion', text: vendorSuggestion(c) });
    }
  }
  return { flags, drafts };
}
