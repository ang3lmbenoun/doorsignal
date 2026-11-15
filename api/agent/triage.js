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
export const DEFAULT_DEADLINE_MS = 10 * 60 * 1000; // after this, remaining batches use the rules

const sha8 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

// "nvidia:404,nvidia:404,google:timeout" without bodies or keys: enough to tell a retired model from an outage.
export function summarizeAttempts(attempts) {
  const seen = [];
  for (const a of attempts || []) {
    const tag = `${a.provider}:${a.status ?? a.error}`;
    if (!seen.includes(tag)) seen.push(tag);
  }
  return seen.slice(0, 6).join(',');
}

// Decide flags and drafts for a list of cases. Model output is used only if it validates; otherwise the batch
// is handled by the deterministic rules. Returns the merged result plus how it was produced.
export async function triageCases({
  cases, providers = [], rulesOnly = false, batchSize = BATCH_SIZE, completeFn = complete,
  transport, sleep, deadlineMs = DEFAULT_DEADLINE_MS, now = () => Date.now(),
  log = (m, d) => console.error(m, d),
}) {
  const flags = [];
  const drafts = [];
  const codes = [];
  let usedLlm = false; let rejected = false; let unavailable = false;
  let provider = null; let model = null;
  const t0 = now();
  const total = Math.ceil(cases.length / batchSize);
  const counts = { batches: total, rejected: 0, rules: 0, llm: 0 };
  const tag = (x, source) => x.map((e) => ({ ...e, source }));
  const useRules = (batch) => {
    const r = triageRules(batch);
    flags.push(...tag(r.flags, 'rules')); drafts.push(...tag(r.drafts, 'rules'));
    counts.rules += 1;
  };

  for (let i = 0, n = 1; i < cases.length; i += batchSize, n++) {
    const batch = cases.slice(i, i + batchSize);
    if (rulesOnly) { useRules(batch); continue; }
    if (providers.length === 0) {
      if (!codes.includes('no_provider')) codes.push('no_provider');
      unavailable = true;
      useRules(batch);
      continue;
    }
    if (now() - t0 > deadlineMs) {
      // A slow provider must not hold the run (and make its data stale) indefinitely.
      if (!codes.includes('deadline')) codes.push('deadline');
      unavailable = true;
      useRules(batch);
      continue;
    }
    log('triage batch', { batch: n, of: total, cases: batch.length });
    let out;
    try {
      out = await completeFn({ providers, messages: messagesFor(batch), transport, sleep });
    } catch (e) {
      if (!(e instanceof LlmUnavailable)) throw e;
      unavailable = true;
      codes.push(`unavailable:${summarizeAttempts(e.attempts)}`);
      log('no provider answered', { batch: n, attempts: summarizeAttempts(e.attempts) });
      useRules(batch);
      continue;
    }
    const v = validateOutput(out.text, batch);
    if (!v.ok) {
      // Rejected output is logged (reason code and a short hash only, never the content) and never executed.
      rejected = true;
      counts.rejected += 1;
      codes.push(`${v.code}#${sha8(out.text)}`);
      log('agent output rejected', { code: v.code, provider: out.provider, model: out.model });
      useRules(batch);
      continue;
    }
    usedLlm = true;
    counts.llm += 1;
    provider = provider === null || provider === out.provider ? out.provider : 'mixed';
    model = model === null || model === out.model ? out.model : 'mixed';
    flags.push(...tag(v.value.flags, 'llm')); drafts.push(...tag(v.value.drafts, 'llm'));
  }

  const mode = usedLlm ? 'llm' : 'rules';
  const status = rulesOnly ? 'ok' : rejected ? 'rejected_output' : unavailable ? 'fallback' : 'ok';
  // The run row keeps the reasons and the batch counts, so a systematically bad model shows up in the inbox data.
  let errorCode = null;
  if (codes.length) {
    errorCode = `${codes.join(';')};batches=${counts.batches};llm=${counts.llm};rejected=${counts.rejected};rules=${counts.rules}`.slice(0, 400);
  }
  return { mode, status, provider, model, errorCode, flags, drafts, counts };
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
  org, client, writer, providers, rulesOnly = false, maxCases, now = () => new Date(),
  log = (m, d) => console.error(m, d), ...rest
}) {
  const startedAt = now();
  try {
    let stats = null;
    const cases = await loadCases(client, { ...(maxCases ? { maxCases } : {}), onStats: (s) => { stats = s; } });
    if (cases.length === 0) {
      // "No cases" can mean a quiet org or an empty or broken serving layer. Say so instead of looking healthy.
      log('triage found no cases to look at', { candidates: stats && stats.candidates });
    }
    if (stats && stats.truncated) log('case list truncated', stats);
    const result = await triageCases({ cases, providers, rulesOnly, log, ...rest });
    const actions = buildActions(result, cases);
    const { runId } = await writer.write({
      run: {
        org, mode: result.mode, provider: result.provider, model: result.model, status: result.status,
        errorCode: result.errorCode, startedAt, finishedAt: now(),
      },
      actions,
    });
    return {
      runId, mode: result.mode, status: result.status, cases: cases.length, candidates: stats ? stats.candidates : null,
      truncated: stats ? stats.truncated : null, flags: result.flags.length, drafts: result.drafts.length, batches: result.counts,
    };
  } catch (e) {
    // A crash must leave a trace: best-effort run row with status 'error' and a short reason (no message bodies).
    const reason = `error:${(e && e.name) || 'Error'}:${String((e && e.message) || '').replace(/[^A-Za-z0-9 :/._-]/g, '').slice(0, 100)}`;
    try {
      await writer.write({ run: { org, mode: 'rules', status: 'error', errorCode: reason, startedAt, finishedAt: now() }, actions: [] });
    } catch {
      log('could not record the failed run', { reason });
    }
    throw e;
  }
}
