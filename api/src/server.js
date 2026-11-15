import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

try {
  process.loadEnvFile?.('../.env'); // optional gitignored .env at the repo root (Node 20.12+)
} catch {
  /* no .env: rely on the process environment */
}

const config = loadConfig();
const app = createApp({ pool: createPool(config.databaseUrl), jwtSecret: config.jwtSecret });
const pool = app.locals.pool;
const server = app.listen(config.port, () => console.log(`doorsignal api listening on ${config.port}`));
// Drain in-flight requests on deploy instead of resetting them.
process.on('SIGTERM', () => server.close(async () => { await pool.end(); process.exit(0); }));
