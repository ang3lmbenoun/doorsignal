import pg from 'pg';
import { ROLES } from './roles.js';

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 });
}

// Every request runs in ONE read-only transaction: SET LOCAL ROLE + transaction-local claims, then the query.
// SET LOCAL ends with the transaction, so no role or claim can carry over to another request on the same
// connection. The role identifier is taken from the fixed ROLES map.
export async function withClaims(pool, claims, fn) {
  const role = ROLES[claims.role];
  if (!role) throw new Error('unknown role');
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('app.org_id', $1, true), set_config('app.owner_id', $2, true)", [
      claims.org_id,
      claims.owner_id,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true; // do not return an unusable connection to the pool
    }
    throw err;
  } finally {
    client.release(broken ? true : undefined);
  }
}
