// M5a leak test matrix. Pass criterion: 0 cross-org leaks across >= 40 cases.
// Needs a Neon BRANCH (never main) with the serving schema built and the API roles applied.
// Skips cleanly when NEON_TEST_DATABASE_URL / NEON_CI_DATABASE_URL is unset.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { ACCESS, ROLE_NAMES } from './access.js';
import {
  ADMIN_URL, SECRET, adminClientConfig, adminUser, apiUrlFromAdmin, claimsFor, guardNotMain, mint, noneToken, pg,
} from './helpers.js';

if (!ADMIN_URL) {
  test('leak matrix', { skip: 'NEON_TEST_DATABASE_URL / NEON_CI_DATABASE_URL not set; skipping' }, () => {});
} else {
  await runMatrix();
}

async function runMatrix() {
  guardNotMain();
  const apiUrl = apiUrlFromAdmin(); // never printed
  let admin;
  let apiClientFactory;
  let pool;
  let server;
  let base;
  let tables = {}; // table -> rows (as read by the owner connection, all orgs)
  let orgs = []; // [{ org, owner }] one owner per org, plus second owner in each org
  const stats = { cases: 0, leaks: 0 };

  // One case = one node test. Counted so the final summary can state the matrix size.
  const kase = (name, fn) =>
    test(name, async () => {
      stats.cases += 1;
      await fn();
    });

  const get = (path, token, headers = {}) =>
    fetch(`${base}${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

  async function fetchAll(path, token, query = '') {
    const rows = [];
    for (let offset = 0; offset < 200000; offset += 500) {
      const res = await get(`${path}?limit=500&offset=${offset}${query}`, token);
      assert.equal(res.status, 200, `${path} status`);
      const body = await res.json();
      rows.push(...body.rows);
      if (body.rows.length < 500) return rows;
    }
    throw new Error('too many pages');
  }

  const expectedRows = (path, role, ctx) => {
    const spec = ACCESS[path];
    const rule = spec.rules[role];
    return rule ? tables[spec.table].filter((r) => rule(r, ctx)) : null;
  };

  // Setup runs at load time (top-level await) because the cases below are generated from the data.
  await (async () => {
    admin = new pg.Client(adminClientConfig());
    await admin.connect();
    const reg = await admin.query("select to_regclass('serving.leases') as t");
    assert.ok(reg.rows[0].t, 'serving.leases is missing: run dbt build on this branch first');
    const role = await admin.query("select 1 from pg_roles where rolname = 'api_login'");
    assert.equal(role.rowCount, 1, 'api_login is missing: apply 30_api_roles.sql on this branch first');
    for (const spec of Object.values(ACCESS)) {
      tables[spec.table] = (await admin.query(`select * from serving.${spec.table}`)).rows;
    }
    // Two owners per org (one in each org is used as the "owner" caller), read from the data itself.
    const byOrg = new Map();
    for (const r of tables.leases) {
      if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, new Set());
      byOrg.get(r.org_id).add(r.owner_id);
    }
    assert.ok(byOrg.size >= 2, 'need at least two orgs in the data');
    orgs = [...byOrg.entries()].sort().map(([org, owners]) => ({ org, owner: [...owners].sort()[0], owners: [...owners].sort() }));
    pool = createPool(apiUrl);
    const app = createApp({ pool, jwtSecret: SECRET });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
    apiClientFactory = async () => {
      const c = new pg.Client({ connectionString: apiUrl });
      await c.connect();
      return c;
    };
  })();

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
    if (admin) await admin.end();
    console.log(`\nLEAK MATRIX SUMMARY: cases=${stats.cases} cross_org_leaks=${stats.leaks}`);
  });

  // A refusal to change identity: Postgres codes 42501 / 22023, or Neon's own wording for managed roles.
  const isDenied = (e) =>
    ['42501', '22023'].includes(e.code) || /not allowed to change role|permission denied|does not exist/.test(e.message);

  const gtTables = (
    await admin.query("select table_name from information_schema.tables where table_schema = 'ground_truth'")
  ).rows.map((r) => r.table_name);

  const contexts = () => {
    const list = [];
    for (const role of ROLE_NAMES) {
      if (role === 'data_owner') list.push({ role, ctx: { org: undefined, owner: undefined }, label: 'all' });
      else for (const o of orgs) list.push({ role, ctx: o, label: o.org });
    }
    return list;
  };

  describe('1. role x org x endpoint: exact visible set, 0 rows outside it', () => {
    kase('setup sanity: two orgs, owners per org, tables non-empty', () => {
      for (const t of Object.keys(tables)) assert.ok(tables[t].length > 0, `${t} is empty`);
      assert.ok(orgs.every((o) => o.owners.length >= 1));
    });
    for (const [path, spec] of Object.entries(ACCESS)) {
      for (const { role, ctx, label } of contexts()) {
        kase(`${role}/${label} GET ${path}`, async () => {
          const token = await mint(claimsFor(role, ctx));
          const expected = expectedRows(path, role, ctx);
          if (expected === null) {
            const res = await get(`${path}?limit=5`, token);
            assert.equal(res.status, 403);
            return;
          }
          const got = await fetchAll(path, token);
          const want = new Set(expected.map(spec.key));
          const leaked = got.filter((r) => !want.has(spec.key(r)));
          stats.leaks += leaked.length;
          assert.equal(leaked.length, 0, `${leaked.length} rows outside the allowed set`);
          assert.equal(new Set(got.map(spec.key)).size, want.size, 'row set differs from the allowed set');
          if (!(spec.emptyFor || []).includes(role)) assert.ok(want.size > 0, 'vacuous: nothing to see');
          assert.ok(got.every((r) => r.evidence_grade && r.lineage_ref), 'evidence_grade/lineage_ref missing');
        });
      }
    }
  });

  describe('2. guessing other callers ids', () => {
    for (const path of ['/v1/signals', '/v1/expected-loss', '/v1/work-orders', '/v1/leases']) {
      const spec = ACCESS[path];
      for (const { role, ctx, label } of contexts().filter((c) => c.role !== 'data_owner')) {
        kase(`${role}/${label} foreign id on ${path}`, async () => {
          const rule = spec.rules[role];
          const token = await mint(claimsFor(role, ctx));
          const foreign = tables[spec.table].find((r) => !(rule ? rule(r, ctx) : false) && r[spec.id]);
          assert.ok(foreign, 'no foreign row to try');
          const res = await get(`${path}/${encodeURIComponent(foreign[spec.id])}`, token);
          if (!rule) {
            assert.equal(res.status, 403);
          } else {
            // Rows the caller may see under the same id (e.g. an entity with several signals) are fine;
            // any returned row must be inside the allowed set.
            assert.ok([200, 404].includes(res.status));
            if (res.status === 200) {
              const rows = (await res.json()).rows;
              const bad = rows.filter((r) => !rule(r, ctx));
              stats.leaks += bad.length;
              assert.equal(bad.length, 0, 'guessed id returned a row outside the allowed set');
            }
          }
          if (rule && !tables[spec.table].some((r) => r[spec.id] === foreign[spec.id] && rule(r, ctx))) {
            assert.equal(res.status, 404, 'invisible id must look like a missing id');
          }
        });
      }
    }
    kase('owner of one owner id in the same org cannot read a sibling owner row', async () => {
      const o = orgs.find((x) => x.owners.length > 1);
      assert.ok(o, 'need an org with two owners');
      const token = await mint(claimsFor('owner', { org: o.org, owner: o.owners[0] }));
      const sibling = tables.leases.find((r) => r.org_id === o.org && r.owner_id === o.owners[1]);
      const res = await get(`/v1/leases/${sibling.lease_id}`, token);
      assert.equal(res.status, 404);
    });
    kase('own id is readable (guards against a test that only ever sees 404)', async () => {
      const o = orgs[0];
      const token = await mint(claimsFor('property_manager', o));
      const mine = tables.leases.find((r) => r.org_id === o.org);
      assert.equal((await get(`/v1/leases/${mine.lease_id}`, token)).status, 200);
    });
  });

  describe('3. SQL-looking inputs', () => {
    const payloads = [
      "' OR '1'='1",
      '1; DROP TABLE serving.leases;--',
      "' UNION SELECT * FROM ground_truth.vendor_speed--",
      "x' OR owner_id <> 'x",
      '1 OR 1=1',
      '%27%20OR%201%3D1--',
    ];
    const spots = (p) => [
      `/v1/signals?signal_id=${encodeURIComponent(p)}`,
      `/v1/leases?status=${encodeURIComponent(p)}`,
      `/v1/leases/${encodeURIComponent(p)}`,
      `/v1/work-orders?limit=${encodeURIComponent(p)}`,
    ];
    for (const p of payloads) {
      for (let i = 0; i < 4; i++) {
        kase(`payload ${JSON.stringify(p).slice(0, 28)} in spot ${i}`, async () => {
          const { org } = orgs[0];
          const token = await mint(claimsFor('property_manager', { org }));
          const res = await get(spots(p)[i], token);
          assert.ok([400, 404].includes(res.status), `status ${res.status}`);
          const body = await res.text();
          assert.ok(!/"rows":\[\{/.test(body), 'rows returned for a malformed input');
        });
      }
    }
    kase('forged claim values with SQL are rejected even when validly signed', async () => {
      for (const org_id of ["ORG1' OR '1'='1", 'ORG1;--', 'ORG1 ORG2']) {
        const token = await mint({ role: 'property_manager', org_id });
        assert.equal((await get('/v1/leases?limit=1', token)).status, 401);
      }
    });
    kase('tables survive the injection attempts', async () => {
      const n = await admin.query('select count(*)::int as n from serving.leases');
      assert.equal(n.rows[0].n, tables.leases.length);
    });
    kase('unknown query parameters (org_id=...) are refused, not honoured', async () => {
      const [a, b] = orgs;
      const token = await mint(claimsFor('property_manager', a));
      assert.equal((await get(`/v1/leases?org_id=${b.org}`, token)).status, 400);
    });
    kase('forged org header does not widen a token', async () => {
      const [a, b] = orgs;
      const token = await mint(claimsFor('property_manager', a));
      const res = await get('/v1/leases?limit=500', token, { 'x-org-id': b.org, 'x-owner-id': b.owner });
      const rows = (await res.json()).rows;
      assert.ok(rows.length > 0 && rows.every((r) => r.org_id === a.org));
    });
  });

  describe('4. missing or forged auth', () => {
    const cases = {
      'no Authorization header': async () => null,
      'empty bearer': async () => '',
      'garbage token': async () => 'not.a.jwt',
      'signed with the wrong secret': async () => mint({ role: 'data_owner' }, { secret: 'z'.repeat(40) }),
      'alg none': async () => noneToken({ role: 'data_owner' }),
      'HS512 (algorithm pinned to HS256)': async () => mint({ role: 'data_owner' }, { alg: 'HS512' }),
      'expired token': async () => mint({ role: 'data_owner' }, { expiresIn: Math.floor(Date.now() / 1000) - 60 }),
      'no exp claim': async () => {
        const { SignJWT } = await import('jose');
        return new SignJWT({ role: 'data_owner' })
          .setProtectedHeader({ alg: 'HS256' }).setIssuer('doorsignal').setAudience('doorsignal-api').setIssuedAt()
          .sign(new TextEncoder().encode(SECRET));
      },
      'wrong issuer': async () => mint({ role: 'data_owner' }, { issuer: 'someone-else' }),
      'wrong audience': async () => mint({ role: 'data_owner' }, { audience: 'other-service' }),
      'no issuer or audience': async () => mint({ role: 'data_owner' }, { issuer: null, audience: null }),
      'far-future exp but issued 2 hours ago (max age 1h)': async () =>
        mint({ role: 'data_owner' }, { issuedAt: Math.floor(Date.now() / 1000) - 7200, expiresIn: '30d' }),
      'unknown role superuser': async () => mint({ role: 'superuser' }),
      'role postgres': async () => mint({ role: 'postgres' }),
      'role with SQL': async () => mint({ role: 'data_owner; DROP TABLE serving.leases' }),
      'owner without owner_id': async () => mint({ role: 'owner', org_id: orgs[0].org }),
      'property_manager without org_id': async () => mint({ role: 'property_manager' }),
      'org_id of wrong type': async () => mint({ role: 'property_manager', org_id: ['ORG1', 'ORG2'] }),
    };
    for (const [name, make] of Object.entries(cases)) {
      kase(`rejected: ${name}`, async () => {
        const t = await make();
        const res = await fetch(`${base}/v1/leases?limit=1`, { headers: t === null ? {} : { authorization: `Bearer ${t}` } });
        assert.equal(res.status, 401);
        assert.ok(!(await res.text()).includes('"rows"'));
      });
    }
    kase('offset above the cap is refused', async () => {
      const token = await mint({ role: 'data_owner' });
      assert.equal((await get('/v1/leases?offset=100001', token)).status, 400);
    });
    kase('/ready reads the serving layer as an API role and returns no data', async () => {
      const res = await fetch(`${base}/ready`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'ready' });
    });
    kase('Basic scheme is rejected', async () => {
      const res = await fetch(`${base}/v1/leases`, { headers: { authorization: 'Basic dXNlcjpwYXNz' } });
      assert.equal(res.status, 401);
    });
    kase('/health returns no data and needs no token', async () => {
      const res = await fetch(`${base}/health`);
      assert.deepEqual(await res.json(), { status: 'ok' });
    });
    kase('a role without access to an endpoint gets 403, not data', async () => {
      const token = await mint(claimsFor('leasing_manager', orgs[0]));
      assert.equal((await get('/v1/work-orders', token)).status, 403);
    });
  });

  describe('5. ground_truth is unreachable from every API role', () => {
    const roles = ['api_login', ...ROLE_NAMES.map((r) => `api_${r}`)];
    kase('ground_truth has tables to protect (guards against a vacuous test)', () => {
      assert.ok(gtTables.length >= 1);
    });
    for (const role of roles) {
      kase(`${role}: no USAGE on schema, no SELECT on any ground_truth table`, async () => {
        const s = await admin.query("select has_schema_privilege($1, 'ground_truth', 'USAGE') as u", [role]);
        assert.equal(s.rows[0].u, false);
        for (const t of gtTables) {
          const r = await admin.query("select has_table_privilege($1, format('ground_truth.%I', $2::text), 'SELECT') as s", [role, t]);
          assert.equal(r.rows[0].s, false, `${role} can select ground_truth.${t}`);
        }
      });
      kase(`${role}: no relation outside serving is selectable, vendor_signals included`, async () => {
        const r = await admin.query(
          `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r','v','m','p','f') and n.nspname not in ('pg_catalog','information_schema','serving')
             and n.nspname not like 'pg_toast%' and has_table_privilege($1, c.oid, 'SELECT')`, [role]);
        assert.deepEqual(r.rows, []);
        const v = await admin.query("select has_table_privilege($1, 'serving.vendor_signals', 'SELECT') as s", [role]);
        assert.equal(v.rows[0].s, false);
      });
    }
    kase('every schema except serving is closed to every API role (enumerated from pg_namespace)', async () => {
      const r = await admin.query(
        `select n.nspname, r.rolname from pg_namespace n cross join pg_roles r
         where r.rolname = any($1) and n.nspname <> 'serving' and n.nspname not like 'pg\\_toast%'
           and n.nspname not in ('pg_catalog', 'information_schema')
           and (has_schema_privilege(r.rolname, n.nspname, 'USAGE') or has_schema_privilege(r.rolname, n.nspname, 'CREATE'))`,
        [roles]);
      assert.deepEqual(r.rows, []);
    });
    for (const role of ROLE_NAMES) {
      kase(`${role}: SELECT on ground_truth fails with permission denied (live query)`, async () => {
        const c = await apiClientFactory();
        try {
          for (const t of gtTables) {
            await c.query('BEGIN');
            await c.query(`SET LOCAL ROLE api_${role}`);
            await assert.rejects(c.query(`SELECT 1 FROM ground_truth.${t} LIMIT 1`), (e) => e.code === '42501');
            await c.query('ROLLBACK');
          }
        } finally {
          await c.end();
        }
      });
    }
    kase('api_login itself cannot read ground_truth (live query)', async () => {
      const c = await apiClientFactory();
      try {
        await assert.rejects(c.query(`SELECT 1 FROM ground_truth.${gtTables[0]} LIMIT 1`), (e) => e.code === '42501');
      } finally {
        await c.end();
      }
    });
    kase('nothing served by the API mentions ground_truth', async () => {
      const token = await mint({ role: 'data_owner' });
      for (const path of Object.keys(ACCESS)) {
        const rows = await fetchAll(path, token);
        assert.ok(!JSON.stringify(rows).includes('ground_truth'));
      }
    });
  });

  describe('6. api_login cannot escalate', () => {
    const targets = ['postgres', 'neon_superuser', 'cloud_admin', 'pg_read_all_data', 'pg_write_all_data', 'does_not_exist'];
    for (const target of [...targets, '__owner__']) {
      kase(`SET ROLE ${target === '__owner__' ? '<owner role>' : target} fails`, async () => {
        const name = target === '__owner__' ? adminUser() : target;
        const c = await apiClientFactory();
        try {
          await assert.rejects(c.query(`SET ROLE "${name.replaceAll('"', '')}"`), isDenied);
          const who = await c.query('select current_user as u');
          assert.equal(who.rows[0].u, 'api_login');
        } finally {
          await c.end();
        }
      });
    }
    kase('SET SESSION AUTHORIZATION fails', async () => {
      const c = await apiClientFactory();
      try {
        await assert.rejects(c.query(`SET SESSION AUTHORIZATION "${adminUser()}"`), isDenied);
        await assert.rejects(c.query('SET SESSION AUTHORIZATION postgres'), isDenied);
      } finally {
        await c.end();
      }
    });
    kase('API roles are not superuser, cannot bypass RLS, own no tables', async () => {
      const r = await admin.query(
        `select rolname from pg_roles where rolname like 'api\\_%' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)`);
      assert.deepEqual(r.rows, []);
      const owned = await admin.query(
        `select c.relname from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname like 'api\\_%'`);
      assert.deepEqual(owned.rows, []);
    });
    kase('api_login does not inherit the group roles', async () => {
      const c = await apiClientFactory();
      try {
        await assert.rejects(c.query('SELECT 1 FROM serving.leases LIMIT 1'), (e) => e.code === '42501');
      } finally {
        await c.end();
      }
    });
    kase('role state does not leak between requests on a reused connection', async () => {
      const one = await pool.connect();
      try {
        await one.query('BEGIN READ ONLY');
        await one.query('SET LOCAL ROLE api_data_owner');
        await one.query('COMMIT');
        const r = await one.query('select current_user as u');
        assert.equal(r.rows[0].u, 'api_login');
      } finally {
        one.release();
      }
    });
  });

  describe('7. read-only', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      kase(`${method} /v1/leases is 405`, async () => {
        const token = await mint({ role: 'data_owner' });
        const res = await fetch(`${base}/v1/leases`, { method, headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 405);
      });
    }
    kase('unauthenticated POST is 401, not 405 (auth runs first)', async () => {
      assert.equal((await fetch(`${base}/v1/leases`, { method: 'POST' })).status, 401);
    });
    for (const sql of [
      "INSERT INTO serving.leases (lease_id) VALUES ('x')",
      "UPDATE serving.leases SET monthly_rent = 0",
      'DELETE FROM serving.leases',
      'CREATE TABLE serving.x (a int)',
    ]) {
      kase(`data_owner cannot write: ${sql.slice(0, 30)}`, async () => {
        const c = await apiClientFactory();
        try {
          await c.query('BEGIN');
          await c.query('SET LOCAL ROLE api_data_owner');
          await assert.rejects(c.query(sql), (e) => ['42501', '25006'].includes(e.code));
          await c.query('ROLLBACK');
        } finally {
          await c.end();
        }
      });
    }
  });

  describe('summary', () => {
    kase('matrix has at least 40 cases and no leak was counted', () => {
      assert.ok(stats.cases >= 40, `only ${stats.cases} cases`);
      assert.equal(stats.leaks, 0);
    });
  });
}
