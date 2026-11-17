// M5b: approval inbox through the HTTP API. Needs a Neon BRANCH with 30-33 applied and the serving layer built.
// Skips cleanly when no branch URL is set. TRUNCATEs the three inbox tables (use a test branch only).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { ADMIN_URL, SECRET, adminClientConfig, agentUrlFromAdmin, apiUrlFromAdmin, guardNotMain, mint, pg } from './helpers.js';

if (!ADMIN_URL) {
  test('approvals api', { skip: 'NEON_TEST_DATABASE_URL / NEON_CI_DATABASE_URL not set; skipping' }, () => {});
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
  const app = createApp({ pool, jwtSecret: SECRET });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  after(async () => {
    await reset();
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.end();
  });

  const agentUrl = agentUrlFromAdmin();
  const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  async function seed(org, text) {
    const t = text ?? `Draft for ${crypto.randomUUID().slice(0, 8)}. Rebuttable presumption, not a legal finding.`;
    const ids = { run: crypto.randomUUID(), t2: crypto.randomUUID(), approval: crypto.randomUUID(), text: t };
    const c = new pg.Client({ connectionString: agentUrl });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query("select set_config('app.org_id', $1, true)", [org]);
      await c.query("insert into ops.agent_runs (run_id, org_id, mode, status, n_drafts) values ($1,$2,'rules','ok',1)", [ids.run, org]);
      await c.query(
        `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text)
         values ($1,$2,$3,'T2','tenant_status_message','work_order','WO1','{}',$4)`, [ids.t2, ids.run, org, t]);
      await c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'pending')", [ids.approval, ids.t2, org]);
      await c.query('COMMIT');
    } finally {
      await c.end();
    }
    return ids;
  }
  const dbStatus = async (id) => (await admin.query('select status, decided_by from ops.approvals where approval_id = $1', [id])).rows[0];

  const claimsFor = (role, org, sub) => ({ role, ...(role === 'data_owner' ? {} : { org_id: org }), ...(role === 'owner' ? { owner_id: 'O01' } : {}), ...(sub ? { sub } : {}) });
  const call = async (method, path, role, org, sub, extra = {}) => {
    const token = role === null ? null : await mint(claimsFor(role, org, sub));
    return fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extra.headers || {}) } });
  };

  const APPROVERS = ['property_manager', 'maintenance_coordinator'];
  const ORGS = [ORG1, ORG2];
  const otherOf = (org) => (org === ORG1 ? ORG2 : ORG1);

  describe('approvers, per role and org', () => {
    for (const role of APPROVERS) {
      for (const org of ORGS) {
        const label = `${role}/${org}`;
        test(`${label}: list shows only own org, with draft text, grade and lineage`, async () => {
          await reset();
          const mine = await seed(org); const theirs = await seed(otherOf(org));
          const res = await call('GET', '/v1/approvals', role, org, 'alice');
          assert.equal(res.status, 200);
          const rows = (await res.json()).rows;
          assert.deepEqual(rows.map((r) => r.approval_id), [mine.approval]);
          assert.ok(!JSON.stringify(rows).includes(theirs.approval));
          assert.equal(rows[0].draft_text, mine.text);
          assert.ok(rows.every((r) => r.evidence_grade && r.lineage_ref && r.org_id === org));
        });

        test(`${label}: GET by id own = 200, other org = 404`, async () => {
          const mine = await seed(org); const theirs = await seed(otherOf(org));
          const ok = await call('GET', `/v1/approvals/${mine.approval}`, role, org, 'alice');
          assert.equal(ok.status, 200);
          assert.equal((await ok.json()).rows[0].draft_text, mine.text);
          assert.equal((await call('GET', `/v1/approvals/${theirs.approval}`, role, org, 'alice')).status, 404);
        });

        test(`${label}: approve records who, role, when, exact text and hash`, async () => {
          const s = await seed(org);
          const res = await call('POST', `/v1/approvals/${s.approval}/approve`, role, org, `user.${role}`);
          assert.equal(res.status, 200);
          const row = (await res.json()).rows[0];
          assert.equal(row.status, 'approved');
          assert.equal(row.decided_by, `user.${role}`);
          assert.equal(row.decided_role, role);
          assert.ok(row.decided_at);
          assert.equal(row.draft_text_at_decision, s.text);
          assert.equal(row.draft_sha256, sha(s.text));
          assert.ok(row.evidence_grade && row.lineage_ref);
          assert.deepEqual(await dbStatus(s.approval), { status: 'approved', decided_by: `user.${role}` });
        });

        test(`${label}: reject records the decision`, async () => {
          const s = await seed(org);
          const res = await call('POST', `/v1/approvals/${s.approval}/reject`, role, org, 'bob');
          assert.equal(res.status, 200);
          assert.equal((await res.json()).rows[0].status, 'rejected');
          assert.deepEqual(await dbStatus(s.approval), { status: 'rejected', decided_by: 'bob' });
        });

        test(`${label}: cannot approve another org's draft (404, still pending)`, async () => {
          const theirs = await seed(otherOf(org));
          for (const action of ['approve', 'reject']) {
            assert.equal((await call('POST', `/v1/approvals/${theirs.approval}/${action}`, role, org, 'mallory')).status, 404);
          }
          assert.deepEqual(await dbStatus(theirs.approval), { status: 'pending', decided_by: null });
        });
      }
    }
  });

  describe('decision rules', () => {
    for (const role of APPROVERS) {
      test(`${role}: a token without sub cannot decide (403, still pending)`, async () => {
        const s = await seed(ORG1);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/approve`, role, ORG1, null)).status, 403);
        assert.deepEqual(await dbStatus(s.approval), { status: 'pending', decided_by: null });
      });
      test(`${role}: a decision is final (second approve and reject give 409, nothing changes)`, async () => {
        const s = await seed(ORG1);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/approve`, role, ORG1, 'first')).status, 200);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/approve`, role, ORG1, 'second')).status, 409);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/reject`, role, ORG1, 'third')).status, 409);
        assert.deepEqual(await dbStatus(s.approval), { status: 'approved', decided_by: 'first' });
      });
    }

    test('the decider is the token sub; a body or header cannot change it', async () => {
      const s = await seed(ORG1);
      const token = await mint(claimsFor('property_manager', ORG1, 'real.user'));
      const res = await fetch(`${base}/v1/approvals/${s.approval}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-user-id': 'spoofed', 'x-forwarded-user': 'spoofed' },
        body: JSON.stringify({ decided_by: 'spoofed', status: 'rejected', draft_text_at_decision: 'forged' }),
      });
      assert.equal(res.status, 200);
      const row = (await res.json()).rows[0];
      assert.equal(row.decided_by, 'real.user');
      assert.equal(row.status, 'approved');
      assert.equal(row.draft_text_at_decision, s.text);
    });

    test('an agent-actor token cannot read or decide the inbox, even with an approver role', async () => {
      const s = await seed(ORG1);
      const token = await mint({ role: 'maintenance_coordinator', org_id: ORG1, sub: 'agent.triage', actor: 'agent' });
      const h = { authorization: `Bearer ${token}` };
      assert.equal((await fetch(`${base}/v1/approvals`, { headers: h })).status, 403);
      assert.equal((await fetch(`${base}/v1/approvals/${s.approval}`, { headers: h })).status, 403);
      assert.equal((await fetch(`${base}/v1/approvals/${s.approval}/approve`, { method: 'POST', headers: h })).status, 403);
      assert.equal((await fetch(`${base}/v1/approvals/${s.approval}/reject`, { method: 'POST', headers: h })).status, 403);
      assert.deepEqual(await dbStatus(s.approval), { status: 'pending', decided_by: null });
    });

    test('an unknown actor value is a bad token', async () => {
      const token = await mint({ role: 'maintenance_coordinator', org_id: ORG1, actor: 'superuser' });
      assert.equal((await fetch(`${base}/v1/leases`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    });

    test('an agent-actor token can still read the data endpoints it needs (T0)', async () => {
      const token = await mint({ role: 'maintenance_coordinator', org_id: ORG1, sub: 'agent.triage', actor: 'agent' });
      const res = await fetch(`${base}/v1/work-orders?limit=1`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
    });

    test('status filter returns only that status', async () => {
      await reset();
      const a = await seed(ORG1); await seed(ORG1);
      await call('POST', `/v1/approvals/${a.approval}/approve`, 'property_manager', ORG1, 'u');
      const rows = (await (await call('GET', '/v1/approvals?status=approved', 'property_manager', ORG1, 'u')).json()).rows;
      assert.deepEqual(rows.map((r) => r.approval_id), [a.approval]);
      const pending = (await (await call('GET', '/v1/approvals?status=pending', 'property_manager', ORG1, 'u')).json()).rows;
      assert.equal(pending.length, 1);
    });

    test('a write transaction does not leave the pooled connection writable', async () => {
      const s = await seed(ORG1);
      await call('POST', `/v1/approvals/${s.approval}/approve`, 'property_manager', ORG1, 'u');
      const c = await pool.connect();
      try {
        assert.equal((await c.query('show transaction_read_only')).rows[0].transaction_read_only, 'on');
        assert.equal((await c.query('select current_user as u')).rows[0].u, 'api_login');
      } finally {
        c.release();
      }
    });
  });

  describe('roles that must not touch the inbox', () => {
    for (const role of ['owner', 'leasing_manager', 'data_owner']) {
      test(`${role}: list, get and decide are 403 and nothing changes`, async () => {
        const s = await seed(ORG1);
        assert.equal((await call('GET', '/v1/approvals', role, ORG1, 'u')).status, 403);
        assert.equal((await call('GET', `/v1/approvals/${s.approval}`, role, ORG1, 'u')).status, 403);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/approve`, role, ORG1, 'u')).status, 403);
        assert.equal((await call('POST', `/v1/approvals/${s.approval}/reject`, role, ORG1, 'u')).status, 403);
        assert.deepEqual(await dbStatus(s.approval), { status: 'pending', decided_by: null });
      });
    }
  });

  describe('bad input and auth', () => {
    test('no token: 401 on GET and POST', async () => {
      const s = await seed(ORG1);
      assert.equal((await call('GET', '/v1/approvals', null)).status, 401);
      assert.equal((await call('POST', `/v1/approvals/${s.approval}/approve`, null)).status, 401);
    });
    test('sub with unexpected characters is rejected as a bad token', async () => {
      const token = await mint({ role: 'property_manager', org_id: ORG1, sub: "a b'; drop" });
      assert.equal((await fetch(`${base}/v1/approvals`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    });
    for (const id of ['not-a-uuid', "' OR '1'='1", '1; DROP TABLE ops.approvals;--', '00000000-0000-0000-0000-00000000000g']) {
      test(`malformed id ${JSON.stringify(id).slice(0, 24)} is 400 on GET and POST`, async () => {
        const enc = encodeURIComponent(id);
        assert.equal((await call('GET', `/v1/approvals/${enc}`, 'property_manager', ORG1, 'u')).status, 400);
        assert.equal((await call('POST', `/v1/approvals/${enc}/approve`, 'property_manager', ORG1, 'u')).status, 400);
      });
    }
    test('well-formed but unknown id is 404', async () => {
      const id = crypto.randomUUID();
      assert.equal((await call('GET', `/v1/approvals/${id}`, 'property_manager', ORG1, 'u')).status, 404);
      assert.equal((await call('POST', `/v1/approvals/${id}/approve`, 'property_manager', ORG1, 'u')).status, 404);
    });
    test('bad status filter, unknown parameter and oversized limit are 400', async () => {
      for (const q of ['status=sent', 'status[]=approved', 'org_id=ORG2', 'limit=501', 'offset=100001']) {
        assert.equal((await call('GET', `/v1/approvals?${q}`, 'property_manager', ORG1, 'u')).status, 400, q);
      }
    });
    test('only approve and reject exist: other methods and actions are refused', async () => {
      const s = await seed(ORG1);
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        assert.equal((await call(method, `/v1/approvals/${s.approval}`, 'property_manager', ORG1, 'u')).status, 405, method);
      }
      assert.equal((await call('POST', '/v1/approvals', 'property_manager', ORG1, 'u')).status, 405);
      assert.equal((await call('POST', `/v1/approvals/${s.approval}/send`, 'property_manager', ORG1, 'u')).status, 405);
      assert.equal((await call('POST', `/v1/approvals/${s.approval}/edit`, 'property_manager', ORG1, 'u')).status, 405);
      assert.deepEqual(await dbStatus(s.approval), { status: 'pending', decided_by: null });
    });
    test('the rest of the API is still read-only (POST on a data endpoint is 405)', async () => {
      assert.equal((await call('POST', '/v1/leases', 'data_owner', null, 'u')).status, 405);
    });
  });
}
