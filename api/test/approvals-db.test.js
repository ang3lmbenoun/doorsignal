// M5b database-level tests for the approval inbox: the agent's writer role, the human approvers and the triggers.
// Runs against a Neon BRANCH (never main) after 30-33 are applied. Skips cleanly when no branch URL is set.
// These tests TRUNCATE the three inbox tables (owner-only) before and after: use a test branch only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, test } from 'node:test';
import { ADMIN_URL, adminClientConfig, agentUrlFromAdmin, apiUrlFromAdmin, guardNotMain, pg } from './helpers.js';

if (!ADMIN_URL) {
  test('approvals db', { skip: 'NEON_TEST_DATABASE_URL / NEON_CI_DATABASE_URL not set; skipping' }, () => {});
} else {
  await run();
}

async function run() {
  guardNotMain();
  const agentUrl = agentUrlFromAdmin(); // never printed
  const apiUrl = apiUrlFromAdmin();
  const admin = new pg.Client(adminClientConfig());
  await admin.connect();
  const orgs = (await admin.query('select distinct org_id from ops.org_map order by 1')).rows.map((r) => r.org_id);
  assert.ok(orgs.length >= 2, 'need two orgs');
  const [ORG1, ORG2] = orgs;
  const reset = () => admin.query('truncate ops.approvals, ops.agent_actions, ops.agent_runs');
  await reset();
  after(async () => {
    await reset();
    await admin.end();
  });

  const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  const uuid = () => crypto.randomUUID();
  const T2_KIND = 'tenant_status_message';

  // ---- connection helpers -------------------------------------------------------------------------------
  async function inTx(url, setup, fn) {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await c.query('BEGIN');
      await setup(c);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw e;
    } finally {
      await c.end();
    }
  }
  const asWriter = (org, fn) =>
    inTx(agentUrl, (c) => c.query("select set_config('app.org_id', $1, true)", [org ?? '']), fn);
  const asRole = (role, ctx, fn) =>
    inTx(
      apiUrl,
      async (c) => {
        await c.query('SET TRANSACTION READ WRITE');
        await c.query(`SET LOCAL ROLE ${role}`);
        await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor', $3, true)", [
          ctx.org ?? '', ctx.user ?? '', ctx.actor ?? 'human',
        ]);
      },
      fn,
    );
  const denied = ['42501'];
  async function fails(promise, codes, msg) {
    await assert.rejects(promise, (e) => codes.includes(e.code), msg);
  }

  // One run with a T1 flag and a T2 draft awaiting approval, written through the real writer role.
  async function seed(org, text = `Status update for work order ${uuid().slice(0, 8)}. This clock is a rebuttable presumption, not a legal finding.`) {
    const ids = { run: uuid(), t1: uuid(), t2: uuid(), approval: uuid(), text };
    await asWriter(org, async (c) => {
      await c.query("insert into ops.agent_runs (run_id, org_id, mode, status, n_flags, n_drafts) values ($1,$2,'rules','ok',1,1)", [ids.run, org]);
      await c.query(
        `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload)
         values ($1,$2,$3,'T1','repair_at_risk','work_order','WO1','{}')`, [ids.t1, ids.run, org]);
      await c.query(
        `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text)
         values ($1,$2,$3,'T2',$4,'work_order','WO1','{}',$5)`, [ids.t2, ids.run, org, T2_KIND, text]);
      await c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'pending')", [ids.approval, ids.t2, org]);
    });
    return ids;
  }
  const decide = (role, ctx, approvalId, status) =>
    asRole(role, ctx, (c) =>
      c.query(
        `update ops.approvals set status = $1 where approval_id = $2
         returning approval_id, status, decided_by, decided_role, decided_at, draft_text_at_decision, draft_sha256`,
        [status, approvalId]));

  // ======================================================================================================
  describe('writer role (api_agent_writer)', () => {
    test('can insert a run, T1 flag, T2 draft and a pending approval in its own org', async () => {
      const s = await seed(ORG1);
      const r = await admin.query('select status from ops.approvals where approval_id = $1', [s.approval]);
      assert.equal(r.rows[0].status, 'pending');
    });

    test('a forged draft hash is overwritten by the trigger (T2)', async () => {
      const text = 'Hello tenant. Rebuttable presumption, not a legal finding.';
      const id = uuid(); const run = uuid();
      await asWriter(ORG1, async (c) => {
        await c.query("insert into ops.agent_runs (run_id, org_id, mode, status) values ($1,$2,'rules','ok')", [run, ORG1]);
        await c.query(
          `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text, draft_sha256)
           values ($1,$2,$3,'T2',$4,'work_order','WO9','{}',$5,$6)`, [id, run, ORG1, T2_KIND, text, 'deadbeef'.repeat(8)]);
      });
      const r = await admin.query('select draft_sha256 from ops.agent_actions where action_id = $1', [id]);
      assert.equal(r.rows[0].draft_sha256, sha(text));
      assert.notEqual(r.rows[0].draft_sha256, 'deadbeef'.repeat(8));
    });

    test('a hash supplied with no draft text is overwritten with NULL (T1)', async () => {
      const id = uuid(); const run = uuid();
      await asWriter(ORG1, async (c) => {
        await c.query("insert into ops.agent_runs (run_id, org_id, mode, status) values ($1,$2,'rules','ok')", [run, ORG1]);
        await c.query(
          `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_sha256)
           values ($1,$2,$3,'T1','repeat_issue','work_order','WO9','{}','cafe')`, [id, run, ORG1]);
      });
      const r = await admin.query('select draft_sha256 from ops.agent_actions where action_id = $1', [id]);
      assert.equal(r.rows[0].draft_sha256, null);
    });

    test('a second approval for the same action fails (unique on approvals.action_id), for the writer and the owner', async () => {
      const s = await seed(ORG1);
      const again = (c) => c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'pending')", [uuid(), s.t2, ORG1]);
      await fails(asWriter(ORG1, again), ['23505']);
      await fails(inTx(adminClientConfig().connectionString, async () => {}, again), ['23505']);
      const n = await admin.query('select count(*)::int as n from ops.approvals where action_id = $1', [s.t2]);
      assert.equal(n.rows[0].n, 1);
      const u = await admin.query(
        `select count(*)::int as n from pg_constraint
         where conrelid = 'ops.approvals'::regclass and contype = 'u'
           and conkey = array[(select attnum from pg_attribute where attrelid = 'ops.approvals'::regclass and attname = 'action_id')]`);
      assert.equal(u.rows[0].n, 1, 'unique constraint on approvals(action_id) is missing');
    });

    for (const [name, sql] of [
      ['UPDATE approvals (self-approve)', "update ops.approvals set status = 'approved'"],
      ['DELETE approvals', 'delete from ops.approvals'],
      ['UPDATE agent_actions', "update ops.agent_actions set draft_text = 'changed'"],
      ['DELETE agent_actions', 'delete from ops.agent_actions'],
      ['UPDATE agent_runs', "update ops.agent_runs set status = 'error'"],
      ['DELETE agent_runs', 'delete from ops.agent_runs'],
      ['TRUNCATE approvals', 'truncate ops.approvals'],
      ['SELECT approvals', 'select * from ops.approvals'],
      ['SELECT agent_actions', 'select * from ops.agent_actions'],
      ['SELECT agent_runs', 'select * from ops.agent_runs'],
      ['SELECT ops.load_log', 'select * from ops.load_log'],
      ['SELECT serving.leases', 'select * from serving.leases'],
      ['INSERT serving.leases', "insert into serving.leases (lease_id) values ('x')"],
      ['UPDATE marts.fct_leases (lease data)', 'update marts.fct_leases set monthly_rent = 0'],
      ['UPDATE marts.fct_ledger_entries (ledger)', 'update marts.fct_ledger_entries set amount = 0'],
      ['DELETE raw.sim_leases', 'delete from raw.sim_leases'],
      ['SELECT ground_truth', 'select * from ground_truth.vendor_speed'],
      ['CREATE TABLE in ops', 'create table ops.x (a int)'],
      ['CREATE TABLE in public', 'create table public.x (a int)'],
    ]) {
      test(`cannot: ${name}`, async () => {
        await fails(asWriter(ORG1, (c) => c.query(sql)), denied);
      });
    }

    test('cannot SET ROLE to any other role', async () => {
      for (const r of ['api_property_manager', 'api_data_owner', 'api_login']) {
        await fails(asWriter(ORG1, (c) => c.query(`set role ${r}`)), ['42501']);
      }
    });

    test('cannot insert an approval that is already approved (RLS check), or with decision fields', async () => {
      const s = await seed(ORG1);
      // the seeded T2 action already has an approval, so each attempt uses a fresh action
      const fresh = async () => {
        const id = uuid();
        await asWriter(ORG1, (c) => c.query(
          `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text)
           values ($1,$2,$3,'T2',$4,'work_order','WO2','{}','x')`, [id, s.run, ORG1, T2_KIND]));
        return id;
      };
      const f1 = await fresh();
      await fails(asWriter(ORG1, (c) => c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'approved')", [uuid(), f1, ORG1])), ['42501', '23514']);
      const f2 = await fresh();
      await fails(asWriter(ORG1, (c) => c.query("insert into ops.approvals (approval_id, action_id, org_id, status, decided_by) values ($1,$2,$3,'pending','me')", [uuid(), f2, ORG1])), ['23514']);
    });

    test('cannot write into another org, or with no org set', async () => {
      const run = uuid();
      const ins = (c) => c.query("insert into ops.agent_runs (run_id, org_id, mode, status) values ($1,$2,'rules','ok')", [run, ORG2]);
      await fails(asWriter(ORG1, ins), denied); // app.org_id = ORG1, row says ORG2
      await fails(asWriter('', ins), denied); // nothing set
      await fails(asWriter(null, ins), denied);
    });

    test('an approval cannot point at an action of another org, or at a T1 flag (foreign key)', async () => {
      const s = await seed(ORG1);
      // a T2 draft in ORG1 that has no approval yet (the seeded one already has one)
      const fresh = uuid();
      await asWriter(ORG1, (c) => c.query(
        `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text)
         values ($1,$2,$3,'T2',$4,'work_order','WO4','{}','draft')`, [fresh, s.run, ORG1, T2_KIND]));
      // org mismatch: writer is acting as ORG2, the action belongs to ORG1
      await fails(asWriter(ORG2, (c) => c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'pending')", [uuid(), fresh, ORG2])), ['23503']);
      // tier mismatch: T1 flag cannot have an approval
      await fails(asWriter(ORG1, (c) => c.query("insert into ops.approvals (approval_id, action_id, org_id, status) values ($1,$2,$3,'pending')", [uuid(), s.t1, ORG1])), ['23503']);
    });

    test('check constraints: T2 needs text, T1 cannot have text, kinds match tiers', async () => {
      const run = uuid();
      await asWriter(ORG1, (c) => c.query("insert into ops.agent_runs (run_id, org_id, mode, status) values ($1,$2,'rules','ok')", [run, ORG1]));
      const base = (tier, kind, text) => (c) => c.query(
        `insert into ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text)
         values ($1,$2,$3,$4,$5,'work_order','WO3','{}',$6)`, [uuid(), run, ORG1, tier, kind, text]);
      await fails(asWriter(ORG1, base('T2', T2_KIND, null)), ['23514']);
      await fails(asWriter(ORG1, base('T1', 'repair_at_risk', 'text')), ['23514']);
      await fails(asWriter(ORG1, base('T1', T2_KIND, null)), ['23514']);
      await fails(asWriter(ORG1, base('T2', 'repair_at_risk', 'text')), ['23514']);
      await fails(asWriter(ORG1, base('T1', 'send_email', null)), ['23514']);
    });

    test('role attributes: no superuser, no BYPASSRLS, no createrole, no memberships, limit 5', async () => {
      const r = await admin.query(
        `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolconnlimit,
                (select count(*) from pg_auth_members m where m.member = r.oid)::int as memberships
         from pg_roles r where rolname = 'api_agent_writer'`);
      assert.deepEqual(r.rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 5, memberships: 0 });
    });

    test('exactly INSERT on the three inbox tables and nothing else on any table', async () => {
      const r = await admin.query(
        `select n.nspname || '.' || c.relname as rel,
                has_table_privilege('api_agent_writer', c.oid, 'INSERT') as i,
                has_table_privilege('api_agent_writer', c.oid, 'SELECT') as s,
                has_table_privilege('api_agent_writer', c.oid, 'UPDATE') as u,
                has_table_privilege('api_agent_writer', c.oid, 'DELETE') as d,
                has_table_privilege('api_agent_writer', c.oid, 'TRUNCATE') as t
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r','v','m','p','f') and n.nspname not in ('pg_catalog','information_schema')
           and n.nspname not like 'pg_toast%'
           and (has_table_privilege('api_agent_writer', c.oid, 'INSERT') or has_table_privilege('api_agent_writer', c.oid, 'SELECT')
             or has_table_privilege('api_agent_writer', c.oid, 'UPDATE') or has_table_privilege('api_agent_writer', c.oid, 'DELETE')
             or has_table_privilege('api_agent_writer', c.oid, 'TRUNCATE'))
         order by 1`);
      assert.deepEqual(r.rows.map((x) => x.rel), ['ops.agent_actions', 'ops.agent_runs', 'ops.approvals']);
      for (const x of r.rows) assert.deepEqual([x.i, x.s, x.u, x.d, x.t], [true, false, false, false, false]);
    });
  });

  // ======================================================================================================
  describe('human approvers (property_manager, maintenance_coordinator)', () => {
    for (const role of ['api_property_manager', 'api_maintenance_coordinator']) {
      const short = role.replace('api_', '');
      test(`${short}: sees only its own org's inbox`, async () => {
        await reset();
        const a = await seed(ORG1); const b = await seed(ORG2);
        const mine = await asRole(role, { org: ORG1, user: 'u1' }, (c) => c.query('select approval_id from ops.approvals'));
        assert.deepEqual(mine.rows.map((r) => r.approval_id), [a.approval]);
        const other = await asRole(role, { org: ORG2, user: 'u1' }, (c) => c.query('select approval_id from ops.approvals'));
        assert.deepEqual(other.rows.map((r) => r.approval_id), [b.approval]);
        const runs = await asRole(role, { org: ORG1, user: 'u1' }, (c) => c.query('select run_id from ops.agent_runs'));
        assert.deepEqual(runs.rows.map((r) => r.run_id), [a.run]);
      });

      test(`${short}: approve records who, role, when and the exact draft text and hash`, async () => {
        const s = await seed(ORG1, `Exact text for ${short}. Rebuttable presumption, not a legal finding.`);
        const r = await decide(role, { org: ORG1, user: `user-${short}` }, s.approval, 'approved');
        assert.equal(r.rowCount, 1);
        const row = r.rows[0];
        assert.equal(row.status, 'approved');
        assert.equal(row.decided_by, `user-${short}`);
        assert.equal(row.decided_role, short);
        assert.ok(row.decided_at);
        assert.equal(row.draft_text_at_decision, s.text);
        assert.equal(row.draft_sha256, sha(s.text));
      });

      test(`${short}: reject works and records the same fields`, async () => {
        const s = await seed(ORG1);
        const r = await decide(role, { org: ORG1, user: 'rejecter' }, s.approval, 'rejected');
        assert.equal(r.rows[0].status, 'rejected');
        assert.equal(r.rows[0].decided_by, 'rejecter');
        assert.equal(r.rows[0].draft_text_at_decision, s.text);
      });

      test(`${short}: cannot decide another org's approval (0 rows, still pending)`, async () => {
        const s = await seed(ORG1);
        const r = await decide(role, { org: ORG2, user: 'intruder' }, s.approval, 'approved');
        assert.equal(r.rowCount, 0);
        const st = await admin.query('select status, decided_by from ops.approvals where approval_id = $1', [s.approval]);
        assert.deepEqual(st.rows[0], { status: 'pending', decided_by: null });
      });

      test(`${short}: a second decision changes nothing`, async () => {
        const s = await seed(ORG1);
        await decide(role, { org: ORG1, user: 'first' }, s.approval, 'approved');
        const again = await decide(role, { org: ORG1, user: 'second' }, s.approval, 'rejected');
        assert.equal(again.rowCount, 0);
        const st = await admin.query('select status, decided_by from ops.approvals where approval_id = $1', [s.approval]);
        assert.deepEqual(st.rows[0], { status: 'approved', decided_by: 'first' });
      });

      test(`${short}: no approver identity means no decision`, async () => {
        const s = await seed(ORG1);
        await fails(decide(role, { org: ORG1, user: '' }, s.approval, 'approved'), denied);
        const st = await admin.query('select status from ops.approvals where approval_id = $1', [s.approval]);
        assert.equal(st.rows[0].status, 'pending');
      });

      test(`${short}: can change status only, to approved or rejected only`, async () => {
        const s = await seed(ORG1);
        const ctx = { org: ORG1, user: 'u' };
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set decided_by = 'forged' where approval_id = $1", [s.approval])), denied);
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set draft_text_at_decision = 'forged' where approval_id = $1", [s.approval])), denied);
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set org_id = $2 where approval_id = $1", [s.approval, ORG2])), denied);
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set status = 'pending' where approval_id = $1", [s.approval])), ['23514', '42501']);
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set status = 'sent' where approval_id = $1", [s.approval])), ['23514']);
      });

      test(`${short}: cannot insert, delete or edit anything else in the inbox, or read ops.load_log`, async () => {
        const s = await seed(ORG1);
        const ctx = { org: ORG1, user: 'u' };
        for (const sql of [
          "insert into ops.agent_runs (run_id, org_id, mode, status) values (gen_random_uuid(), 'ORG1', 'rules', 'ok')",
          'delete from ops.approvals', 'delete from ops.agent_actions', 'delete from ops.agent_runs',
          "update ops.agent_actions set draft_text = 'changed'", "update ops.agent_runs set status = 'error'",
          'truncate ops.approvals', 'select * from ops.load_log',
        ]) {
          await fails(asRole(role, ctx, (c) => c.query(sql)), denied, sql);
        }
        const st = await admin.query('select draft_text from ops.agent_actions where action_id = $1', [s.t2]);
        assert.equal(st.rows[0].draft_text, s.text);
      });
    }

    test('roles without a grant (owner, leasing_manager, data_owner, api_login) cannot touch the inbox', async () => {
      const s = await seed(ORG1);
      for (const role of ['api_owner', 'api_leasing_manager', 'api_data_owner']) {
        const ctx = { org: ORG1, user: 'u' };
        await fails(asRole(role, ctx, (c) => c.query('select * from ops.approvals')), denied, role);
        await fails(asRole(role, ctx, (c) => c.query('select * from ops.agent_actions')), denied, role);
        await fails(asRole(role, ctx, (c) => c.query("update ops.approvals set status = 'approved'")), denied, role);
      }
      const c = new pg.Client({ connectionString: apiUrl });
      await c.connect();
      try {
        await fails(c.query('select * from ops.approvals'), denied);
      } finally {
        await c.end();
      }
      const st = await admin.query('select status from ops.approvals where approval_id = $1', [s.approval]);
      assert.equal(st.rows[0].status, 'pending');
    });
  });

  // ======================================================================================================
  describe('triggers (owner connection)', () => {
    test('UPDATE and DELETE on agent_actions and agent_runs are refused even for the owner', async () => {
      const s = await seed(ORG1);
      await fails(admin.query("update ops.agent_actions set draft_text = 'x' where action_id = $1", [s.t2]), denied);
      await fails(admin.query('delete from ops.agent_actions where action_id = $1', [s.t2]), denied);
      await fails(admin.query("update ops.agent_runs set status = 'error' where run_id = $1", [s.run]), denied);
      await fails(admin.query('delete from ops.agent_runs where run_id = $1', [s.run]), denied);
    });

    test('approvals are never deleted, and a decided approval cannot be changed, even by the owner', async () => {
      const s = await seed(ORG1);
      await fails(admin.query('delete from ops.approvals where approval_id = $1', [s.approval]), denied);
      await decide('api_property_manager', { org: ORG1, user: 'u' }, s.approval, 'approved');
      await fails(admin.query("update ops.approvals set status = 'rejected' where approval_id = $1", [s.approval]), ['23514']);
    });

    test('TRUNCATE is owner-only: the owner can reset, no API role holds the privilege', async () => {
      const r = await admin.query(
        `select r.rolname from pg_roles r, unnest(array['ops.agent_runs','ops.agent_actions','ops.approvals']) t
         where r.rolname like 'api\\_%' and has_table_privilege(r.rolname, t, 'TRUNCATE')`);
      assert.deepEqual(r.rows, []);
    });

    test('the actor check fails closed: a missing, empty or unknown app.actor cannot decide', async () => {
      const s = await seed(ORG1);
      for (const actor of ['', 'admin', 'Human', 'agent']) {
        await fails(decide('api_property_manager', { org: ORG1, user: 'u', actor }, s.approval, 'approved'), denied, `actor=${JSON.stringify(actor)}`);
      }
      // no app.actor setting at all
      await fails(
        inTx(apiUrl, async (c) => {
          await c.query('SET TRANSACTION READ WRITE');
          await c.query('SET LOCAL ROLE api_property_manager');
          await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', 'u', true)", [ORG1]);
        }, (c) => c.query("update ops.approvals set status = 'approved' where approval_id = $1", [s.approval])),
        denied);
      const st = await admin.query('select status from ops.approvals where approval_id = $1', [s.approval]);
      assert.equal(st.rows[0].status, 'pending');
      assert.equal((await decide('api_property_manager', { org: ORG1, user: 'u', actor: 'human' }, s.approval, 'approved')).rowCount, 1);
    });

    test('the writer has no access to ops tables other than the three inbox tables', async () => {
      const r = await admin.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'ops' and c.relkind in ('r','v','m','p','f')
           and c.relname not in ('agent_runs','agent_actions','approvals')
           and (has_table_privilege('api_agent_writer', c.oid, 'SELECT') or has_table_privilege('api_agent_writer', c.oid, 'INSERT')
                or has_table_privilege('api_agent_writer', c.oid, 'UPDATE') or has_table_privilege('api_agent_writer', c.oid, 'DELETE'))`);
      assert.deepEqual(r.rows, []);
    });

    test('the inbox list index exists and is used for the org/status/requested_at order', async () => {
      const r = await admin.query("select indexname from pg_indexes where schemaname = 'ops' and tablename = 'approvals'");
      const names = r.rows.map((x) => x.indexname);
      assert.ok(names.includes('approvals_org_status_requested_idx') && names.includes('approvals_org_requested_idx'), names.join(','));
      assert.ok(!names.includes('approvals_org_status_idx'));
    });

    test('an agent identity (app.actor = agent) cannot decide, whatever its role', async () => {
      const s = await seed(ORG1);
      await fails(
        inTx(apiUrl, async (c) => {
          await c.query('SET TRANSACTION READ WRITE');
          await c.query('SET LOCAL ROLE api_property_manager');
          await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', 'agent.triage', true), set_config('app.actor', 'agent', true)", [ORG1]);
        }, (c) => c.query("update ops.approvals set status = 'approved' where approval_id = $1", [s.approval])),
        denied);
      const st = await admin.query('select status from ops.approvals where approval_id = $1', [s.approval]);
      assert.equal(st.rows[0].status, 'pending');
    });

    test('the decision snapshot equals the stored draft even if a caller tries to supply other values', async () => {
      const s = await seed(ORG1, 'Snapshot test. Rebuttable presumption, not a legal finding.');
      const r = await decide('api_maintenance_coordinator', { org: ORG1, user: 'snap' }, s.approval, 'approved');
      const stored = await admin.query('select draft_text, draft_sha256 from ops.agent_actions where action_id = $1', [s.t2]);
      assert.equal(r.rows[0].draft_text_at_decision, stored.rows[0].draft_text);
      assert.equal(r.rows[0].draft_sha256, stored.rows[0].draft_sha256);
    });
  });
}
