// Maintenance triage: T0 read (API) -> model or rules -> validated flags (T1) and drafts (T2) -> inbox.
// There is no tool, function or code path here that sends a message or edits ledger or lease data (tier T3).
// A draft only ever becomes a pending approval; a human decides, and "approved" is a status, nothing more.
import crypto from 'node:crypto';
import { loadCases } from './cases.js';
import { complete, LlmUnavailable } from './llm.js';
import { messagesFor } from './prompt.js';
import { triageRules } from './rules.js';
import { finalizeDraftText, validateOutput } from './schema.js';

export const BATCH_SIZE = 10;

const sha8 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

// Decide flags and drafts for a list of cases. Model output is used only if it validates; otherwise the batch
// is handled by the deterministic rules. Returns the merged result plus how it was produced.
export async function triageCases({
  cases, providers = [], rulesOnly = false, batchSize = BATCH_SIZE, completeFn = complete,
  transport, sleep, log = (m, d) => console.error(m, d),
}) {
  const flags = [];
  const drafts = [];
  const codes = [];
  let usedLlm = false; let rejected = false; let unavailable = false;
  let provider = null; let model = null;

  for (let i = 0; i < cases.length; i += batchSize) {
    const batch = cases.slice(i, i + batchSize);
    const tag = (x, source) => x.map((e) => ({ ...e, source }));
    if (rulesOnly || providers.length === 0) {
      const r = triageRules(batch);
      flags.push(...tag(r.flags, 'rules')); drafts.push(...tag(r.drafts, 'rules'));
      if (!rulesOnly) unavailable = true;
      continue;
    }
    let out;
    try {
      out = await completeFn({ providers, messages: messagesFor(batch), transport, sleep });
    } catch (e) {
      if (!(e instanceof LlmUnavailable)) throw e;
      unavailable = true;
      codes.push('unavailable');
      const r = triageRules(batch);
      flags.push(...tag(r.flags, 'rules')); drafts.push(...tag(r.drafts, 'rules'));
      continue;
    }
    const v = validateOutput(out.text, batch);
    if (!v.ok) {
      // Rejected output is logged (reason code and a short hash only, never the content) and never executed.
      rejected = true;
      codes.push(`${v.code}#${sha8(out.text)}`);
      log('agent output rejected', { code: v.code, provider: out.provider, model: out.model });
      const r = triageRules(batch);
      flags.push(...tag(r.flags, 'rules')); drafts.push(...tag(r.drafts, 'rules'));
      continue;
    }
    usedLlm = true;
    provider = provider === null || provider === out.provider ? out.provider : 'mixed';
    model = model === null || model === out.model ? out.model : 'mixed';
    flags.push(...tag(v.value.flags, 'llm')); drafts.push(...tag(v.value.drafts, 'llm'));
  }

  const mode = usedLlm ? 'llm' : 'rules';
  const status = rulesOnly ? 'ok' : rejected ? 'rejected_output' : unavailable ? 'fallback' : 'ok';
  return { mode, status, provider, model, errorCode: codes.length ? codes.join(';').slice(0, 300) : null, flags, drafts };
}

// Turns a triage result into inbox rows: flags are T1, drafts are T2 (each gets a pending approval in the writer).
export function buildActions(result, cases) {
  const byId = new Map(cases.map((c) => [c.work_order_id, c]));
  const signals = (c) => ({ s01: c.s01, s02: c.s02, s09: c.s09 });
  const actions = [];
  for (const f of result.flags) {
    const c = byId.get(f.work_order_id);
    actions.push({ tier: 'T1', kind: f.kind, entityId: f.work_order_id, payload: { reason: f.reason, source: f.source, signals: signals(c) } });
  }
  for (const d of result.drafts) {
    const c = byId.get(d.work_order_id);
    actions.push({
      tier: 'T2', kind: d.kind, entityId: d.work_order_id, draftText: finalizeDraftText(d.text, c),
      payload: { source: d.source, signals: signals(c) },
    });
  }
  return actions;
}

export async function runTriage({
  org, client, writer, providers, rulesOnly = false, maxCases, now = () => new Date(), ...rest
}) {
  const startedAt = now();
  const cases = await loadCases(client, maxCases ? { maxCases } : {});
  const result = await triageCases({ cases, providers, rulesOnly, ...rest });
  const actions = buildActions(result, cases);
  const { runId } = await writer.write({
    run: {
      org, mode: result.mode, provider: result.provider, model: result.model, status: result.status,
      errorCode: result.errorCode, startedAt, finishedAt: now(),
    },
    actions,
  });
  return {
    runId, mode: result.mode, status: result.status, cases: cases.length,
    flags: result.flags.length, drafts: result.drafts.length,
  };
}
