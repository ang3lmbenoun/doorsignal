import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { jwtVerify } from 'jose';
import { createWebApp, loadWebConfig } from '../server/app.js';
import { PERSONAS } from '../server/personas.js';

const SECRET = 'x'.repeat(40);
const key = new TextEncoder().encode(SECRET);

function harness() {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(JSON.stringify({ rows: [], meta: { count: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const app = createWebApp({ apiBase: 'http://api.test', jwtSecret: SECRET, fetchFn });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ calls, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
async function signIn(h, persona) {
  const res = await fetch(`${h.base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) });
  return { res, cookie: cookieOf(res) };
}

describe('config', () => {
  test('refuses to start without DEMO_MODE=true or a long secret', () => {
    assert.throws(() => loadWebConfig({ JWT_SECRET: SECRET }), /DEMO_MODE/);
    assert.throws(() => loadWebConfig({ DEMO_MODE: 'true', JWT_SECRET: 'short' }), /JWT_SECRET/);
    assert.equal(loadWebConfig({ DEMO_MODE: 'true', JWT_SECRET: SECRET }).apiBase, 'http://127.0.0.1:3000');
  });
});

describe('sign-in and session', () => {
  test('personas are listed without secrets or subs', async () => {
    const h = await harness();
    const body = await (await fetch(`${h.base}/auth/personas`)).json();
    assert.equal(body.personas.length, PERSONAS.length);
    assert.ok(!JSON.stringify(body).includes('"sub"'));
    await h.close();
  });
  test('unknown persona is refused; login sets an HttpOnly SameSite=Strict cookie', async () => {
    const h = await harness();
    assert.equal((await signIn(h, 'nobody')).res.status, 400);
    const { res } = await signIn(h, 'pat');
    const sc = res.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
    await h.close();
  });
  test('no cookie means 401 on /api and /auth/me; logout ends the session', async () => {
    const h = await harness();
    assert.equal((await fetch(`${h.base}/api/v1/signals`)).status, 401);
    assert.equal((await fetch(`${h.base}/auth/me`)).status, 401);
    const { cookie } = await signIn(h, 'pat');
    assert.equal((await fetch(`${h.base}/auth/me`, { headers: { cookie } })).status, 200);
    await fetch(`${h.base}/auth/logout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await fetch(`${h.base}/auth/me`, { headers: { cookie } })).status, 401);
    await h.close();
  });
  test('an expired session is refused', async () => {
    let t = 1_000;
    const app = createWebApp({ apiBase: 'http://api.test', jwtSecret: SECRET, fetchFn: async () => new Response('{}'), now: () => t });
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"persona":"pat"}' });
    const cookie = cookieOf(login);
    t += 9 * 3600 * 1000;
    assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie } })).status, 401);
    await new Promise((r) => server.close(r));
  });
});

describe('forwarding to the API', () => {
  test('mints a short-lived token with the persona role, org, owner and sub; never the browser value', async () => {
    const h = await harness();
    for (const [id, role, org, owner] of [['pat', 'property_manager', 'ORG1', undefined], ['olivia', 'owner', 'ORG1', 'O01'], ['dana', 'data_owner', undefined, undefined]]) {
      h.calls.length = 0;
      const { cookie } = await signIn(h, id);
      const res = await fetch(`${h.base}/api/v1/signals?signal_id=S01&limit=5`, { headers: { cookie, authorization: 'Bearer attacker', 'x-org-id': 'ORG2' } });
      assert.equal(res.status, 200);
      const { url, opts } = h.calls[0];
      assert.equal(url, 'http://api.test/v1/signals?signal_id=S01&limit=5');
      const token = opts.headers.Authorization.replace('Bearer ', '');
      const { payload } = await jwtVerify(token, key, { issuer: 'doorsignal', audience: 'doorsignal-api', algorithms: ['HS256'] });
      assert.equal(payload.role, role); assert.equal(payload.org_id, org); assert.equal(payload.owner_id, owner);
      assert.ok(payload.sub && payload.exp - payload.iat <= 300);
    }
    await h.close();
  });
  test('only the allowlisted read paths and the two decisions are forwarded', async () => {
    const h = await harness();
    const { cookie } = await signIn(h, 'pat');
    const id = '11111111-2222-3333-4444-555555555555';
    for (const [method, path, expect] of [
      ['GET', '/api/health', 404], ['GET', '/api/ready', 404], ['GET', '/api/v1/../admin', 404], ['DELETE', '/api/v1/signals', 404],
      ['POST', '/api/v1/signals', 404], ['POST', `/api/v1/approvals/${id}/delete`, 404], ['GET', `/api/v1/approvals/${id}`, 200],
    ]) {
      const res = await fetch(`${h.base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(res.status, expect, `${method} ${path}`);
    }
    assert.equal(h.calls.length, 1);
    await h.close();
  });
  test('a decision needs a JSON content type, and always sends an empty body; the browser body is ignored', async () => {
    const h = await harness();
    const { cookie } = await signIn(h, 'pat');
    const id = '11111111-2222-3333-4444-555555555555';
    const form = await fetch(`${h.base}/api/v1/approvals/${id}/approve`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    assert.equal(form.status, 415);
    assert.equal(h.calls.length, 0);
    const ok = await fetch(`${h.base}/api/v1/approvals/${id}/approve`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"status":"rejected","decided_by":"x"}' });
    assert.equal(ok.status, 200);
    assert.equal(h.calls[0].opts.body, '{}');
    await h.close();
  });
  test('odd query strings are rejected before reaching the API', async () => {
    const h = await harness();
    const { cookie } = await signIn(h, 'pat');
    for (const q of ['band=a%27%3B--', 'Limit=5', 'x[a]=1', 'band=a&band=b']) {
      assert.equal((await fetch(`${h.base}/api/v1/signals?${q}`, { headers: { cookie } })).status, 400, q);
    }
    assert.equal(h.calls.length, 0);
    await h.close();
  });
  test('API status codes pass through (403, 404, 409) and an unreachable API gives 502', async () => {
    const codes = [403, 409];
    const app = createWebApp({ apiBase: 'http://api.test', jwtSecret: SECRET, fetchFn: async () => { const c = codes.shift(); if (!c) throw new Error('down'); return new Response('{"error":"x"}', { status: c }); } });
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookie = cookieOf(await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"persona":"leo"}' }));
    assert.equal((await fetch(`${base}/api/v1/approvals`, { headers: { cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/signals`, { headers: { cookie } })).status, 409);
    assert.equal((await fetch(`${base}/api/v1/signals`, { headers: { cookie } })).status, 502);
    await new Promise((r) => server.close(r));
  });
  test('security headers are set', async () => {
    const h = await harness();
    const res = await fetch(`${h.base}/health`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    await h.close();
  });
});
