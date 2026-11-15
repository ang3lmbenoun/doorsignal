// Approval inbox endpoints. The ONLY write path in the API, and it writes exactly one thing: a human's decision
// (approved or rejected) on a pending draft. Nothing here sends a message or touches ledger or lease data.
//
// Who may do what is decided by Postgres (grants and RLS on ops.approvals, plus the approvals_guard trigger that
// records who decided, in which role, when, and the exact draft text). The role check below only gives a clean
// 403 before the database is reached; the database enforces the same rule.
import express from 'express';
import { withClaims } from './db.js';
import { parsePaging, reply } from './util.js';

const APPROVER_ROLES = new Set(['property_manager', 'maintenance_coordinator']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUS = /^(pending|approved|rejected)$/;

// Agent output is model-generated on synthetic data: grade C.
const SELECT_INBOX = `
  SELECT a.approval_id, a.action_id, a.org_id, a.status, a.requested_at,
         a.decided_by, a.decided_role, a.decided_at, a.draft_text_at_decision, a.draft_sha256,
         x.tier, x.kind, x.entity_type, x.entity_id, x.draft_text, x.payload,
         r.run_id, r.mode, r.provider, r.model,
         'C' AS evidence_grade,
         'ops.agent_runs -> ops.agent_actions (triage agent output) -> ops.approvals' AS lineage_ref
  FROM ops.approvals a
  JOIN ops.agent_actions x ON x.action_id = a.action_id AND x.org_id = a.org_id
  JOIN ops.agent_runs r ON r.run_id = x.run_id AND r.org_id = x.org_id`;

export function approvalsRouter(pool) {
  const router = express.Router();
  router.use((req, res, next) => {
    req.endpointTable = 'ops.approvals'; // for the 403 log line
    next();
  });
  // Agent tokens (actor = 'agent') never touch the inbox, even with an approver role; the database refuses too.
  const guardRole = (req, res, next) =>
    APPROVER_ROLES.has(req.claims.role) && req.claims.actor !== 'agent' ? next() : reply(res, 403, 'forbidden');

  router.get('/', guardRole, async (req, res, next) => {
    try {
      const paging = parsePaging(req.query);
      const allowed = new Set(['limit', 'offset', 'status']);
      if (!paging || Object.keys(req.query).some((k) => !allowed.has(k))) return reply(res, 400, 'bad request');
      const values = [];
      let where = '';
      if (req.query.status !== undefined) {
        if (typeof req.query.status !== 'string' || !STATUS.test(req.query.status)) return reply(res, 400, 'bad request');
        values.push(req.query.status);
        where = ' WHERE a.status = $1';
      }
      const sql = `${SELECT_INBOX}${where} ORDER BY a.requested_at DESC, a.approval_id LIMIT ${paging.limit} OFFSET ${paging.offset}`;
      const { rows } = await withClaims(pool, req.claims, (c) => c.query(sql, values));
      return res.json({ rows, meta: { count: rows.length, limit: paging.limit, offset: paging.offset } });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', guardRole, async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) return reply(res, 400, 'bad request');
      const { rows } = await withClaims(pool, req.claims, (c) =>
        c.query(`${SELECT_INBOX} WHERE a.approval_id = $1`, [req.params.id]));
      if (rows.length === 0) return reply(res, 404, 'not found'); // missing and other-org look the same
      return res.json({ rows, meta: { count: 1 } });
    } catch (err) {
      return next(err);
    }
  });

  for (const [action, status] of [['approve', 'approved'], ['reject', 'rejected']]) {
    router.post(`/:id/${action}`, guardRole, async (req, res, next) => {
      try {
        if (!UUID.test(req.params.id)) return reply(res, 400, 'bad request');
        // The decision is attributed to the token's `sub`; a token without one cannot decide anything.
        if (!req.claims.sub) return reply(res, 403, 'forbidden');
        const out = await withClaims(
          pool,
          req.claims,
          async (c) => {
            // Only the status is supplied by the caller. Who/when/role and the draft snapshot are filled in by
            // the database trigger from the token and the immutable action, never from the request.
            const upd = await c.query(
              'UPDATE ops.approvals SET status = $1 WHERE approval_id = $2 AND status = \'pending\' RETURNING approval_id',
              [status, req.params.id],
            );
            if (upd.rowCount === 1) {
              const { rows } = await c.query(`${SELECT_INBOX} WHERE a.approval_id = $1`, [req.params.id]);
              return { kind: 'ok', row: rows[0] };
            }
            const seen = await c.query('SELECT status FROM ops.approvals WHERE approval_id = $1', [req.params.id]);
            return seen.rowCount === 0 ? { kind: 'missing' } : { kind: 'decided' };
          },
          { write: true },
        );
        if (out.kind === 'missing') return reply(res, 404, 'not found'); // missing and other-org look the same
        if (out.kind === 'decided') return reply(res, 409, 'already decided');
        return res.json({ rows: [out.row], meta: { count: 1 } });
      } catch (err) {
        if (err && err.code === '23514') return reply(res, 409, 'already decided');
        return next(err);
      }
    });
  }
  return router;
}
