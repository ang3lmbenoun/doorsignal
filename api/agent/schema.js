// Closed output contract for the triage agent, and the checks that stand between a model and the inbox.
// Anything outside the contract is rejected whole: unknown keys, unknown kinds, ids not in the input, links,
// contact details, legal conclusions, or a flag that contradicts the signal values it was given.
// The same checks run on every provider's output, so no provider can widen what the agent may do.

export const FLAG_KINDS = Object.freeze([
  'repair_breach_presumed', 'repair_at_risk', 'emergency_watch', 'slow_assignment', 'repeat_issue',
]);
export const DRAFT_KINDS = Object.freeze(['tenant_status_message', 'vendor_reassignment_suggestion']);
export const MAX_REASON = 200;
export const MAX_TEXT = 1200;
export const MAX_ITEMS = 200;

// Appended in code (never left to the model) to every draft about a work order that has an S01 reading.
export const DISCLAIMER =
  'Internal note for the approver (remove before anything is sent): the seven-day repair clock shown by S01 is a ' +
  'simplified rebuttable presumption, not a legal finding or legal advice. A person must review this draft.';

const FLAG_KEYS = ['kind', 'reason', 'work_order_id'];
const DRAFT_KEYS = ['kind', 'text', 'work_order_id'];

// Legal conclusions are out of scope for the agent. Matching is deliberately broad: a false reject only costs a
// fallback to the rule-based triage, a miss would put legal wording in front of a tenant.
const LEGAL = new RegExp(
  [
    'violat\\w*', 'illegal\\w*', 'unlawful\\w*', 'liab\\w*', 'negligen\\w*', 'lawsuit\\w*', '\\bsue\\b', '\\bsuing\\b',
    'legal action', 'legal right\\w*', 'entitled', 'you have the right', 'withhold(ing)? (the )?rent',
    'repair[- ]and[- ]deduct', 'terminate (the |your )?lease', 'constructive eviction', 'habitab\\w*',
    'breach(ed)? of (the )?(law|statute|code|lease|contract)', 'statut\\w*', 'property code', '\\b92\\.0\\d+',
    'court', 'attorney', 'penalt\\w*', 'fines?\\b',
  ].join('|'),
  'i',
);
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|app|dev)\b)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/;
// North-American style numbers and long digit runs; plain dates such as 2026-11-13 do not match.
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\b\d{10,}\b/;
// Characters that hide or reorder text.
const HIDDEN_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/;
// Simulator id shapes: work order W, unit U, lease L, tenant T, vendor V, property P, owner O, plus org names.
const ID_RE = /\b(?:[WULTVPO]\d{2,8}|ORG\d+)\b/g;

// The model may mention only ids that were in its input.
export function scanText(text, allowedIds) {
  if (HIDDEN_RE.test(text)) return 'hidden_chars';
  if (EMAIL_RE.test(text)) return 'forbidden:email'; // before URL: an address contains a domain
  if (URL_RE.test(text)) return 'forbidden:url';
  if (PHONE_RE.test(text)) return 'forbidden:phone';
  if (LEGAL.test(text)) return 'forbidden:legal';
  for (const id of text.match(ID_RE) || []) if (!allowedIds.has(id)) return 'forbidden:foreign_id';
  return null;
}

// Accepts a bare JSON object, or exactly one fenced block containing it. Nothing else.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.startsWith('{') && t.endsWith('}')) return t;
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(t);
  return m ? m[1].trim() : null;
}

const exactKeys = (o, keys) =>
  o !== null && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && Object.keys(o).sort().every((k, i) => k === keys[i]);

// text: raw model output. cases: array of case objects (see cases.js). Returns {ok, value} or {ok:false, code}.
export function validateOutput(text, cases) {
  const json = extractJson(text);
  if (json === null) return { ok: false, code: 'not_json' };
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return { ok: false, code: 'not_json' };
  }
  if (!exactKeys(obj, ['drafts', 'flags'])) return { ok: false, code: obj && typeof obj === 'object' ? 'extra_or_missing_key' : 'not_object' };
  if (!Array.isArray(obj.flags) || !Array.isArray(obj.drafts)) return { ok: false, code: 'not_array' };
  if (obj.flags.length > MAX_ITEMS || obj.drafts.length > MAX_ITEMS) return { ok: false, code: 'too_many_items' };

  const byId = new Map(cases.map((c) => [c.work_order_id, c]));
  const allowedIds = new Set();
  for (const c of cases) for (const id of [c.work_order_id, c.unit_id, c.vendor_id]) if (id) allowedIds.add(id);

  const flags = [];
  const seen = new Set();
  for (const f of obj.flags) {
    if (!exactKeys(f, FLAG_KEYS)) return { ok: false, code: 'bad_flag_item' };
    if (typeof f.work_order_id !== 'string' || !byId.has(f.work_order_id)) return { ok: false, code: 'unknown_work_order' };
    if (!FLAG_KINDS.includes(f.kind)) return { ok: false, code: 'unknown_flag_kind' };
    if (typeof f.reason !== 'string' || f.reason.length < 1 || f.reason.length > MAX_REASON) return { ok: false, code: 'bad_reason' };
    const bad = scanText(f.reason, allowedIds);
    if (bad) return { ok: false, code: `reason:${bad}` };
    const key = `${f.work_order_id}|${f.kind}`;
    if (seen.has(key)) continue; // a repeated flag is harmless: keep the first
    seen.add(key);
    flags.push({ work_order_id: f.work_order_id, kind: f.kind, reason: f.reason });
  }
  const drafts = [];
  const seenDraft = new Set();
  for (const d of obj.drafts) {
    if (!exactKeys(d, DRAFT_KEYS)) return { ok: false, code: 'bad_draft_item' };
    if (typeof d.work_order_id !== 'string' || !byId.has(d.work_order_id)) return { ok: false, code: 'unknown_work_order' };
    if (!DRAFT_KINDS.includes(d.kind)) return { ok: false, code: 'unknown_draft_kind' };
    if (typeof d.text !== 'string' || d.text.trim().length < 1 || d.text.length > MAX_TEXT) return { ok: false, code: 'bad_text' };
    const bad = scanText(d.text, allowedIds);
    if (bad) return { ok: false, code: `draft:${bad}` };
    const key = `${d.work_order_id}|${d.kind}`;
    if (seenDraft.has(key)) continue;
    seenDraft.add(key);
    drafts.push({ work_order_id: d.work_order_id, kind: d.kind, text: d.text.trim() });
  }
  const contradiction = crossCheck({ flags, drafts }, byId);
  if (contradiction) return { ok: false, code: `contradicts_inputs:${contradiction}` };
  return { ok: true, value: { flags, drafts } };
}

// A flag is allowed only if the signal values in the input support it. The S01 thresholds are the registry
// rule: at_risk from 5 days, breach_presumed at 7.0 days and not before.
export function flagSupported(kind, c) {
  const s01 = c.s01;
  switch (kind) {
    case 'repair_breach_presumed': return !!s01 && s01.value >= 7;
    case 'repair_at_risk': return !!s01 && s01.value >= 5 && s01.value < 7;
    case 'emergency_watch': return !!s01 && s01.band === 'emergency_watch';
    case 'slow_assignment': return !!c.s02 && ['elevated', 'high'].includes(c.s02.band);
    case 'repeat_issue': return !!c.s09 && ['repeat', 'chronic'].includes(c.s09.band);
    default: return false;
  }
}

export function draftSupported(kind, c) {
  const s01Flagged = !!c.s01 && c.s01.band !== 'ok';
  if (kind === 'tenant_status_message') return s01Flagged;
  if (kind === 'vendor_reassignment_suggestion') return !!c.vendor_id && !!c.s02 && ['elevated', 'high'].includes(c.s02.band);
  return false;
}

export function crossCheck(value, byId) {
  for (const f of value.flags) if (!flagSupported(f.kind, byId.get(f.work_order_id))) return `flag:${f.kind}`;
  for (const d of value.drafts) if (!draftSupported(d.kind, byId.get(d.work_order_id))) return `draft:${d.kind}`;
  return null;
}

// Adds the fixed disclaimer to a draft about a work order that has an S01 reading.
export function finalizeDraftText(text, c) {
  return c.s01 && c.s01.band !== 'ok' ? `${text}\n\n${DISCLAIMER}` : text;
}
