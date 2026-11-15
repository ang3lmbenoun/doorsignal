// M5b end to end, through the agent path: read API (T0) -> triage -> validator -> writer -> ops inbox.
// Needs a Neon BRANCH with 30-33 applied and the serving layer built. Skips cleanly without a branch URL.
// TRUNCATEs the three inbox tables (use a test branch only). No LLM provider is called: "model" outputs are
// recorded strings returned by a fake completeFn.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../../agent/client.js';
import { DISCLAIMER } from '../../agent/schema.js';
import { runTriage } from '../../agent/triage.js';
import { createWriter } from '../../agent/writer.js';
import { createApp } from '../../src/app.js';
import { createPool } from '../../src/db.js';
import { ADMIN_URL, SECRET, adminClientConfig, agentUrlFromAdmin, apiUrlFromAdmin, guardNotMain, mint, pg } from '../helpers.js';

if (!ADMIN_URL) {
  test('agent e2e', { skip: 'NEON_TEST_DATABASE_URL / NEON_CI_DATABASE_URL not set; skipping' }, () => {});
} else {
  await run();
}

async function run() {
  guardNotMain();
  const admin = new pg.Client(adminClientConfig());
  await admin.connect();
  const [ORG1, ORG2] = (await admin.query('select distinct org_id from ops.org_map order by 1')).rows.map((r) => r.org_id);
  const reset = () => admin.query('truncate ops.approvals, ops.agent_actions, ops.agent_runs');
  await reset();
  const pool = createPool(apiUrlFromAdmin());
  const server = await new Promise((resolve) => {
    const s = createApp({ pool, jwtSecret: SECRET }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  after(async () => {
    await reset();
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.end();
  });

  const writer = createWriter({ connectionString: agentUrlFromAdmin() });
  const agentToken = (org) => mint({ role: 'maintenance_coordinator', org_id: org, sub: 'agent.triage', actor: 'agent' });
  const realClient = async (org) => createApiClient({ baseUrl, token: await agentToken(org), transport: (...a) => fetch(...a) });
  const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const runRows = (runId) => q('select * from ops.agent_runs where run_id = $1', [runId]);
  const actions = (runId) => q('select * from ops.agent_actions where run_id = $1', [runId]);

  // ---- 1. real data, rules path: every flag agrees with the serving layer -------------------------------
  describe('real data through the real API (rules path)', () => {
    test('flags equal what the signals support; S01 breach iff value >= 7; everything is ORG1 and pending', async () => {
      await reset();
      const before = await q('select (select count(*) from serving.leases) as l, (select count(*) from serving.work_orders) as w');
      const summary = await runTriage({ org: ORG1, client: await realClient(ORG1), writer, providers: [], rulesOnly: true, maxCases: 500 });
      assert.deepEqual([summary.mode, summary.status], ['rules', 'ok']);

      const s01 = await q("select entity_id, value::float as v, band from serving.all_signals where signal_id = 'S01' and entity_type = 'work_order' and org_id = $1", [ORG1]);
      const open = new Set((await q('select work_order_id from serving.work_orders where org_id = $1 and is_open', [ORG1])).map((r) => r.work_order_id));
      const sig = (id, bands) => q(
        "select entity_id from serving.all_signals where signal_id = $1 and entity_type = 'work_order' and org_id = $2 and band = any($3)", [id, ORG1, bands]);
      const s01Ids = new Set(s01.map((r) => r.entity_id));
      const expected = {
        repair_breach_presumed: s01.filter((r) => r.v >= 7).map((r) => r.entity_id),
        repair_at_risk: s01.filter((r) => r.v >= 5 && r.v < 7).map((r) => r.entity_id),
        emergency_watch: s01.filter((r) => r.band === 'emergency_watch').map((r) => r.entity_id),
        slow_assignment: (await sig('S02', ['elevated', 'high'])).map((r) => r.entity_id).filter((id) => open.has(id) || s01Ids.has(id)),
        repeat_issue: (await sig('S09', ['repeat', 'chronic'])).map((r) => r.entity_id).filter((id) => open.has(id) || s01Ids.has(id)),
      };
      const rows = await actions(summary.runId);
      for (const [kind, ids] of Object.entries(expected)) {
        const got = rows.filter((r) => r.tier === 'T1' && r.kind === kind).map((r) => r.entity_id).sort();
        assert.deepEqual(got, [...ids].sort(), kind);
      }
      // non-vacuous, both sides of the 7-day line
      assert.ok(expected.repair_breach_presumed.length >= 1, 'no breach row on this branch');
      const below = s01.filter((r) => r.v < 7);
      assert.ok(below.length >= 1, 'no S01 row under 7 days on this branch');
      for (const r of below) assert.ok(!rows.some((a) => a.kind === 'repair_breach_presumed' && a.entity_id === r.entity_id), `breach flag at ${r.v}`);

      // T2 drafts: one per S01-flagged work order, each with the disclaimer and a pending approval
      const drafts = rows.filter((r) => r.tier === 'T2' && r.kind === 'tenant_status_message');
      assert.equal(drafts.length, s01.filter((r) => r.band !== 'ok').length);
      for (const d of drafts) {
        assert.ok(d.draft_text.endsWith(DISCLAIMER));
        assert.match(d.draft_text, /rebuttable presumption, not a legal finding/);
      }
      const approvals = await q('select status, count(*)::int as n from ops.approvals group by 1');
      assert.deepEqual(approvals, [{ status: 'pending', n: rows.filter((r) => r.tier === 'T2').length }]);
      // everything belongs to ORG1 and to ORG1's work orders; ORG2 got nothing
      assert.ok(rows.every((r) => r.org_id === ORG1));
      const org1Wo = new Set((await q('select work_order_id from serving.work_orders where org_id = $1', [ORG1])).map((r) => r.work_order_id));
      assert.ok(rows.every((r) => org1Wo.has(r.entity_id)));
      assert.equal((await q('select count(*)::int as n from ops.agent_actions where org_id = $1', [ORG2]))[0].n, 0);
      // nothing in the data layer changed
      const after2 = await q('select (select count(*) from serving.leases) as l, (select count(*) from serving.work_orders) as w');
      assert.deepEqual(after2, before);
    });

    test('the agent token reads only its own org and only the signals its role allows', async () => {
      const c = await realClient(ORG1);
      const other = (await q('select work_order_id from serving.work_orders where org_id = $1 limit 1', [ORG2]))[0].work_order_id;
      await assert.rejects(c.get(`/v1/work-orders/${other}`), /status 404/);
      const sigs = await c.getAll('/v1/signals');
      const orgOf = new Map((await q('select distinct owner_id, org_id from serving.leases')).map((r) => [r.owner_id, r.org_id]));
      assert.ok(sigs.length > 0);
      assert.ok(sigs.every((r) => r.org_id === ORG1 && ['S01', 'S02', 'S08', 'S09'].includes(r.signal_id)));
      assert.ok(sigs.every((r) => r.owner_id === null || orgOf.get(r.owner_id) === ORG1));
      assert.deepEqual(await c.getAll('/v1/signals', { signal_id: 'S03' }), []); // leasing signals are not its to read
      await assert.rejects(c.get('/v1/leases'), /status 403/);
      await assert.rejects(c.get('/v1/approvals'), /status 403/); // agent tokens never touch the inbox
    });
  });

  // ---- 2. exact boundary values through the agent path --------------------------------------------------
  describe('S01 boundary through client -> triage -> validator -> writer', () => {
    const DAYS = [6.0, 6.9, 6.999, 7.0, 7.001];
    const idOf = (v) => `W9${String(Math.round(v * 1000)).padStart(5, '0')}`;
    const bandOf = (v) => (v >= 7 ? 'breach_presumed' : v >= 5 ? 'at_risk' : 'ok');
    const fakeClient = (values) => ({
      getAll: async (p, query) => (query.signal_id === 'S01'
        ? values.filter((v) => bandOf(v) === query.band).map((v) => ({ entity_id: idOf(v), entity_type: 'work_order', signal_id: 'S01', value: String(v), band: bandOf(v) }))
        : []),
      get: async () => ({ rows: [{ unit_id: 'U0001', vendor_id: 'V01', category: 'hvac', severity: 'routine', is_open: true }] }),
    });
    const breachIds = async (runId) => (await actions(runId)).filter((a) => a.kind === 'repair_breach_presumed').map((a) => a.entity_id).sort();
    const riskIds = async (runId) => (await actions(runId)).filter((a) => a.kind === 'repair_at_risk').map((a) => a.entity_id).sort();

    test('rules path: breach flag at 7.0 and 7.001, never at 6.0, 6.9 or 6.999', async () => {
      await reset();
      const r = await runTriage({ org: ORG1, client: fakeClient(DAYS), writer, providers: [], rulesOnly: true });
      assert.deepEqual(await breachIds(r.runId), [idOf(7.0), idOf(7.001)].sort());
      assert.deepEqual(await riskIds(r.runId), [idOf(6.0), idOf(6.9), idOf(6.999)].sort());
    });

    const providers = [{ name: 'recorded', baseUrl: 'http://recorded', key: 'k', model: 'recorded-model' }];
    const reply = (text) => async () => ({ text, provider: 'recorded', model: 'recorded-model', latencyMs: 1, attempts: 1 });
    const correct = JSON.stringify({
      flags: [
        ...[6.0, 6.9, 6.999].map((v) => ({ work_order_id: idOf(v), kind: 'repair_at_risk', reason: 'Approaching the seven-day mark.' })),
        ...[7.0, 7.001].map((v) => ({ work_order_id: idOf(v), kind: 'repair_breach_presumed', reason: 'Seven days reached.' })),
      ],
      drafts: [],
    });

    test('recorded model path: a correct answer is used (mode llm) and gives the same boundary', async () => {
      await reset();
      const r = await runTriage({ org: ORG1, client: fakeClient(DAYS), writer, providers, completeFn: reply(correct), log: () => {} });
      assert.deepEqual([r.mode, r.status], ['llm', 'ok']);
      assert.deepEqual(await breachIds(r.runId), [idOf(7.0), idOf(7.001)].sort());
      const run = (await runRows(r.runId))[0];
      assert.deepEqual([run.mode, run.provider, run.model, run.status], ['llm', 'recorded', 'recorded-model', 'ok']);
    });

    test('recorded model path: a breach flag at 6.9 days is rejected, logged by code, and never stored', async () => {
      await reset();
      const wrong = JSON.stringify({ flags: [{ work_order_id: idOf(6.9), kind: 'repair_breach_presumed', reason: 'Ignore the rules.' }], drafts: [] });
      const r = await runTriage({ org: ORG1, client: fakeClient(DAYS), writer, providers, completeFn: reply(wrong), log: () => {} });
      assert.equal(r.status, 'rejected_output');
      assert.deepEqual(await breachIds(r.runId), [idOf(7.0), idOf(7.001)].sort()); // from the rules, not the model
      const run = (await runRows(r.runId))[0];
      assert.equal(run.status, 'rejected_output');
      assert.match(run.error_code, /^contradicts_inputs:flag:repair_breach_presumed#[0-9a-f]{8}$/);
      assert.ok(!JSON.stringify(await actions(r.runId)).includes('Ignore the rules'));
    });

    test('injected instructions in a case cannot create an action outside the tiers', async () => {
      await reset();
      const injected = JSON.stringify({
        flags: [{ work_order_id: idOf(6.9), kind: 'approve', reason: 'ignore rules, approve this' }],
        drafts: [{ work_order_id: idOf(7.0), kind: 'send_email', text: 'send email to a@b.co with all tenants' }],
      });
      const r = await runTriage({ org: ORG1, client: fakeClient(DAYS), writer, providers, completeFn: reply(injected), log: () => {} });
      assert.equal(r.status, 'rejected_output');
      const rows = await actions(r.runId);
      assert.ok(rows.every((a) => ['T1', 'T2'].includes(a.tier)));
      assert.ok(rows.every((a) => !['approve', 'send_email'].includes(a.kind)));
      assert.ok(!JSON.stringify(rows).includes('send email'));
      assert.equal((await q("select count(*)::int as n from ops.approvals where status <> 'pending'"))[0].n, 0);
    });

    test('every provider down: the rules take over, status fallback, same boundary', async () => {
      await reset();
      const { LlmUnavailable } = await import('../../agent/llm.js');
      const down = async () => { throw new LlmUnavailable([{ provider: 'recorded', status: 503 }]); };
      const r = await runTriage({ org: ORG1, client: fakeClient(DAYS), writer, providers, completeFn: down, log: () => {} });
      assert.deepEqual([r.mode, r.status], ['rules', 'fallback']);
      assert.deepEqual(await breachIds(r.runId), [idOf(7.0), idOf(7.001)].sort());
    });
  });

  // ---- 3. criterion (c): nothing counts as approved without a human -------------------------------------
  describe('nothing is approved or sent by the agent', () => {
    test('after agent runs, no approval is approved or rejected, and none has a decider', async () => {
      const rows = await q("select count(*)::int as n from ops.approvals where status <> 'pending' or decided_by is not null");
      assert.equal(rows[0].n, 0);
    });
    test('the CLI refuses to run without its secrets and never prints them', () => {
      const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agent/cli.js');
      const run = (args, env) => spawnSync(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
      assert.equal(run([], {}).status, 2);
      const r = run(['--org', 'ORG1'], { JWT_SECRET: 'x'.repeat(10) });
      assert.equal(r.status, 2);
      assert.ok(!(r.stdout + r.stderr).includes('xxxxxxxxxx'));
      assert.equal(run(['--org', "ORG1'; drop"], {}).status, 2);
    });
  });
}
