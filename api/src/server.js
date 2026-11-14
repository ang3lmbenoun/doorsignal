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
app.listen(config.port, () => console.log(`doorsignal api listening on ${config.port}`));
