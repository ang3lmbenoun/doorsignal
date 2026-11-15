// The agent's only write path: INSERT into the three approval-inbox tables as database role api_agent_writer.
// That role has no UPDATE, DELETE or SELECT anywhere, so it cannot approve a draft, edit what it wrote, or read
// other data. Nothing here sends a message or touches ledger or lease data (tier T3).
import crypto from 'node:crypto';
import pg from 'pg';

export const INSERT_RUN =
  'INSERT INTO ops.agent_runs (run_id, org_id, mode, provider, model, status, n_flags, n_drafts, error_code, started_at, finished_at) ' +
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)';
export const INSERT_ACTION =
  'INSERT INTO ops.agent_actions (action_id, run_id, org_id, tier, kind, entity_type, entity_id, payload, draft_text) ' +
  "VALUES ($1, $2, $3, $4, $5, 'work_order', $6, $7, $8)";
export const INSERT_APPROVAL =
  "INSERT INTO ops.approvals (approval_id, action_id, org_id, status) VALUES ($1, $2, $3, 'pending')";

// One transaction per run: the run row, every action, and a pending approval for every T2 draft.
// run: {org, mode, provider, model, status, errorCode, startedAt, finishedAt}; actions: [{tier, kind, entityId, payload, draftText}]
export function createWriter({ connectionString, ClientClass = pg.Client }) {
  async function write({ run, actions }) {
    const client = new ClientClass({ connectionString });
    await client.connect();
    const runId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, true)", [run.org]);
      await client.query(INSERT_RUN, [
        runId, run.org, run.mode, run.provider ?? null, run.model ?? null, run.status,
        actions.filter((a) => a.tier === 'T1').length, actions.filter((a) => a.tier === 'T2').length,
        run.errorCode ?? null, run.startedAt, run.finishedAt,
      ]);
      for (const a of actions) {
        const actionId = crypto.randomUUID();
        await client.query(INSERT_ACTION, [
          actionId, runId, run.org, a.tier, a.kind, a.entityId, JSON.stringify(a.payload ?? {}), a.tier === 'T2' ? a.draftText : null,
        ]);
        if (a.tier === 'T2') await client.query(INSERT_APPROVAL, [crypto.randomUUID(), actionId, run.org]);
      }
      await client.query('COMMIT');
      return { runId };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw e;
    } finally {
      await client.end();
    }
  }
  return { write };
}
