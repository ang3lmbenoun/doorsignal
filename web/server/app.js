// BFF for the DoorSignal web app. Holds the JWT secret and the sessions; the browser holds only an opaque cookie.
// Demo sign-in with fixed synthetic personas (ADR 0005). Forwards a small allowlist of API paths.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { SignJWT } from 'jose';
import { PERSONAS, personaById, publicPersona } from './personas.js';

const COOKIE = 'ds_sid';
const SESSION_MS = 8 * 3600 * 1000;
const READ_PATHS = /^\/v1\/(signals|expected-loss|stress|risk-register|work-orders|leases|approvals)(\/[A-Za-z0-9_.:-]{1,64})?$/;
const DECISION = /^\/v1\/approvals\/[0-9a-f-]{36}\/(approve|reject)$/;
const QUERY_KEY = /^[a-z_]{1,24}$/;
const QUERY_VAL = /^[A-Za-z0-9_.:-]{1,64}$/;

export function loadWebConfig(env = process.env) {
  if (env.DEMO_MODE !== 'true') {
    throw new Error('DEMO_MODE=true is required: this server has demo sign-in only, with no real authentication (ADR 0005).');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set (at least 32 characters).');
  return {
    port: Number(env.WEB_PORT || 8080),
    apiBase: (env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
    jwtSecret: env.JWT_SECRET,
    secureCookie: env.NODE_ENV === 'production',
  };
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createWebApp({ apiBase, jwtSecret, fetchFn = fetch, distDir = null, secureCookie = false, now = () => Date.now() }) {
  const sessions = new Map(); // sid -> { persona, expires }
  const key = new TextEncoder().encode(jwtSecret);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
    });
    next();
  });

  const sessionOf = (req) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    const s = sid && sessions.get(sid);
    if (!s) return null;
    if (s.expires < now()) { sessions.delete(sid); return null; }
    return { sid, ...s };
  };

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/auth/personas', (req, res) => res.json({ demo: true, personas: PERSONAS.map(publicPersona) }));
  app.get('/auth/me', (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'not signed in' });
    return res.json({ demo: true, user: publicPersona(s.persona) });
  });
  app.post('/auth/login', (req, res) => {
    const persona = personaById(req.body && req.body.persona);
    if (!persona) return res.status(400).json({ error: 'unknown persona' });
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { persona, expires: now() + SESSION_MS });
    res.set('Set-Cookie', `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureCookie ? '; Secure' : ''}`);
    return res.json({ user: publicPersona(persona) });
  });
  app.post('/auth/logout', (req, res) => {
    const s = sessionOf(req);
    if (s) sessions.delete(s.sid);
    res.set('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return res.json({ ok: true });
  });

  // /api/<api path>?<query>: GET for reads, POST for the two approval decisions. Nothing else is forwarded.
  app.use('/api', async (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'not signed in' });
    const apiPath = req.path;
    const isRead = req.method === 'GET' && READ_PATHS.test(apiPath);
    const isDecision = req.method === 'POST' && DECISION.test(apiPath);
    if (!isRead && !isDecision) return res.status(404).json({ error: 'not found' });
    // A decision must come from our own page: JSON content type cannot be sent cross-site by a plain form.
    if (isDecision && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return res.status(415).json({ error: 'json required' });
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (!QUERY_KEY.test(k) || typeof v !== 'string' || !QUERY_VAL.test(v)) return res.status(400).json({ error: 'bad request' });
      qs.set(k, v);
    }
    const p = s.persona;
    const claims = { role: p.role, sub: p.sub, ...(p.org_id ? { org_id: p.org_id } : {}), ...(p.owner_id ? { owner_id: p.owner_id } : {}) };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('doorsignal').setAudience('doorsignal-api')
      .setIssuedAt().setExpirationTime('5m').sign(key);
    try {
      const r = await fetchFn(`${apiBase}${apiPath}${qs.size ? `?${qs}` : ''}`, {
        method: req.method,
        headers: { Authorization: `Bearer ${token}`, ...(isDecision ? { 'Content-Type': 'application/json' } : {}) },
        ...(isDecision ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      return res.status(r.status).type('application/json').send(text);
    } catch {
      return res.status(502).json({ error: 'api unreachable' });
    }
  });

  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: 0 }));
    app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  return app;
}
