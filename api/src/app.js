import express from 'express';
import { authenticate } from './auth.js';
import { withClaims } from './db.js';
import { ENDPOINTS } from './endpoints.js';

const MAX_LIMIT = 500;

function parsePaging(query) {
  const out = { limit: 100, offset: 0 };
  for (const key of ['limit', 'offset']) {
    if (query[key] === undefined) continue;
    const v = query[key];
    if (typeof v !== 'string' || !/^\d{1,7}$/.test(v)) return null;
    out[key] = Number.parseInt(v, 10);
  }
  if (out.limit < 1 || out.limit > MAX_LIMIT) return null;
  return out;
}

// Builds WHERE parts from the endpoint's allowlisted filters. Values are bound, never concatenated.
function buildFilters(endpoint, query, idValue) {
  const where = [];
  const values = [];
  const allowed = new Set(['limit', 'offset', ...Object.keys(endpoint.filters)]);
  for (const key of Object.keys(query)) if (!allowed.has(key)) return null;
  for (const [name, pattern] of Object.entries(endpoint.filters)) {
    if (query[name] === undefined) continue;
    const v = query[name];
    if (typeof v !== 'string' || !pattern.test(v)) return null;
    values.push(v);
    where.push(`${name} = $${values.length}`);
  }
  if (idValue !== undefined) {
    values.push(idValue);
    where.push(`${endpoint.idColumn} = $${values.length}`);
  }
  return { where, values };
}

const reply = (res, status, error) => res.status(status).json({ error });

function makeHandler(endpoint, pool, byId) {
  return async (req, res, next) => {
    try {
      const idValue = byId ? req.params.id : undefined;
      if (idValue !== undefined && !/^[A-Za-z0-9_.:-]{1,64}$/.test(idValue)) return reply(res, 400, 'bad request');
      const paging = parsePaging(req.query);
      const filters = buildFilters(endpoint, req.query, idValue);
      if (!paging || !filters) return reply(res, 400, 'bad request');
      const sql =
        `SELECT * FROM serving.${endpoint.table}` +
        (filters.where.length ? ` WHERE ${filters.where.join(' AND ')}` : '') +
        ` ORDER BY ${endpoint.orderBy} LIMIT ${paging.limit} OFFSET ${paging.offset}`;
      const { rows } = await withClaims(pool, req.claims, (c) => c.query(sql, filters.values));
      // A row the caller may not see and a row that does not exist look the same: 404.
      if (idValue !== undefined && rows.length === 0) return reply(res, 404, 'not found');
      // Every response row must carry its evidence grade and lineage. Fail closed if one does not.
      if (rows.some((r) => !r.evidence_grade || !r.lineage_ref)) return reply(res, 500, 'internal error');
      return res.json({ rows, meta: { count: rows.length, limit: paging.limit, offset: paging.offset } });
    } catch (err) {
      return next(err);
    }
  };
}

export function createApp({ pool, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/v1', async (req, res, next) => {
    const claims = await authenticate(req.headers.authorization, jwtSecret);
    if (!claims) return reply(res.set('WWW-Authenticate', 'Bearer'), 401, 'unauthorized');
    req.claims = claims;
    return next();
  });
  // Read-only API (tier T0): anything but GET/HEAD is refused after authentication.
  app.use('/v1', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return reply(res.set('Allow', 'GET'), 405, 'method not allowed');
  });

  for (const endpoint of ENDPOINTS) {
    app.get(endpoint.path, makeHandler(endpoint, pool, false));
    if (endpoint.idColumn) app.get(`${endpoint.path}/:id`, makeHandler(endpoint, pool, true));
  }

  app.use((req, res) => reply(res, 404, 'not found'));
  // Errors never echo database messages. A missing table privilege is a 403, everything else a 500.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.code === '42501') return reply(res, 403, 'forbidden');
    console.error('request failed', { path: req.path, code: err && err.code });
    return reply(res, 500, 'internal error');
  });
  return app;
}
