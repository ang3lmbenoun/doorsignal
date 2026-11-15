// Model-selection eval. Sends the fixed synthetic cases to each model through the provider-neutral LLM module and
// scores the answers. Manual run with a live key; never part of CI.
//   node eval/run.js --provider nvidia --models id1,id2,id3 [--out ../docs/agents-eval.json]
//        [--concurrency 3] [--max-tokens 4000] [--timeout-ms 180000]
// Only synthetic data is sent (see eval/cases.js). Keys come from .env and are never printed.
// Models run in parallel; within a model, `concurrency` cases are in flight at once. Latency is the wall time of
// each call including retries, measured under that load (so it is not an idle-system benchmark).
import fs from 'node:fs';
import { complete, LlmUnavailable, providerFor } from '../agent/llm.js';
import { messagesFor } from '../agent/prompt.js';
import { triageRules } from '../agent/rules.js';
import { EVAL_CASES } from './cases.js';
import { analyze, compare, summarize } from './score.js';

try {
  process.loadEnvFile?.('../.env');
} catch {
  /* rely on the process environment */
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const providerName = arg('provider', 'nvidia');
const models = (arg('models', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const outFile = arg('out', null);
const concurrency = Number.parseInt(arg('concurrency', '3'), 10);
const maxTokens = Number.parseInt(arg('max-tokens', '4000'), 10);
const timeoutMs = Number.parseInt(arg('timeout-ms', '180000'), 10);
if (models.length === 0) {
  console.error('usage: node eval/run.js --provider nvidia --models id1,id2 [--out file.json]');
  process.exit(2);
}

const rowFor = (c, analysis, extra) => {
  const cmp = compare(analysis.flags, c.expected);
  return {
    case: c.id, group: c.group, jsonValid: analysis.jsonValid, schemaValid: analysis.schemaValid, code: analysis.code,
    exact: analysis.schemaValid && cmp.exact, tp: analysis.schemaValid ? cmp.tp : 0, fp: analysis.schemaValid ? cmp.fp : 0,
    fn: analysis.schemaValid ? cmp.fn : c.expected.length, wrongActions: analysis.wrongActions,
    contradictions: analysis.contradictions, ...extra,
  };
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function evalModel(model) {
  const provider = providerFor(providerName, model);
  if (!provider) {
    console.error(`no key configured for ${providerName}`);
    process.exit(2);
  }
  const rows = await mapLimit(EVAL_CASES, concurrency, async (c) => {
    const started = Date.now();
    let row;
    try {
      const out = await complete({ providers: [provider], messages: messagesFor(c.cases), maxAttempts: 3, timeoutMs, maxTokens });
      row = rowFor(c, analyze(out.text, c.cases), { wallMs: Date.now() - started, retries: out.attempts - 1, failed: false, sample: out.text.slice(0, 400) });
    } catch (e) {
      if (!(e instanceof LlmUnavailable)) throw e;
      row = rowFor(c, { jsonValid: false, schemaValid: false, code: 'call_failed', flags: [], wrongActions: 0, contradictions: 0 },
        { wallMs: Date.now() - started, retries: e.attempts.length, failed: true, statuses: e.attempts.map((a) => a.status || a.error) });
    }
    process.stderr.write('.');
    return row;
  });
  process.stderr.write(`\n${model} done\n`);
  return { summary: summarize(rows), rows };
}

const results = {};

// Baseline: the deterministic rules, no model.
{
  const rows = EVAL_CASES.map((c) => {
    const flags = triageRules(c.cases).flags.map((f) => `${f.work_order_id}:${f.kind}`);
    const cmp = compare(flags, c.expected);
    return { case: c.id, group: c.group, jsonValid: true, schemaValid: true, code: null, exact: cmp.exact, tp: cmp.tp, fp: cmp.fp, fn: cmp.fn,
      wrongActions: 0, contradictions: 0, wallMs: 0, retries: 0, failed: false };
  });
  results.rules = { summary: summarize(rows), rows };
}

const done = await Promise.all(models.map(async (m) => [m, await evalModel(m)]));
for (const [m, r] of done) results[m] = r;

console.table(Object.entries(results).map(([model, r]) => ({
  model, cases: r.summary.cases, failed: r.summary.callFailures, 'valid JSON %': r.summary.validJsonPct,
  'schema valid %': r.summary.schemaValidPct, 'correct flags %': r.summary.correctFlagsPct, 'boundary %': r.summary.boundaryCorrectPct,
  'injection %': r.summary.injectionCorrectPct, 'wrong actions': r.summary.wrongActions,
  'p50 ms': r.summary.latencyMsP50, 'p95 ms': r.summary.latencyMsP95,
})));
if (outFile) {
  fs.writeFileSync(outFile, `${JSON.stringify({
    provider: providerName, date: new Date().toISOString().slice(0, 10), settings: { concurrency, maxTokens, timeoutMs, temperature: 0, runsPerCase: 1 }, results,
  }, null, 1)}\n`);
}
