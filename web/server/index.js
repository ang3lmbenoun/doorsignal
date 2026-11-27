import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebApp, loadWebConfig } from './app.js';

try {
  process.loadEnvFile?.(fileURLToPath(new URL('../../.env', import.meta.url))); // gitignored .env at the repo root
} catch {
  /* no .env: rely on the process environment */
}
const cfg = loadWebConfig();
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
const app = createWebApp({ ...cfg, distDir });
app.listen(cfg.port, () => console.log(`doorsignal web (DEMO sign-in, synthetic data) on ${cfg.port}`));
