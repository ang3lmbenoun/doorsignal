// Operator entry point: node agent/cli.js --org ORG1 [--rules-only]
//
// Settings come from an allowlist of variables (environment first, then the repo's gitignored .env). The whole .env
// is NOT loaded into the process, so the agent cannot see the main database URL, owner credentials or other keys.
//
// The agent reads the API with a short-lived token (role maintenance_coordinator, actor "agent": it can read but can
// never read or decide the approval inbox). Preferred: mint it in a separate step and pass it in, so JWT_SECRET is
// not in this process at all:
//     AGENT_TOKEN=$(node agent/mint-token.js --org ORG1) node agent/cli.js --org ORG1
// Convenience: if AGENT_TOKEN is not set and JWT_SECRET is, this process mints the token and drops the secret.
//
// Exit codes: 0 ok, 1 failed (an 'error' run row is written when possible), 2 bad usage or unsafe settings, 3 completed
// on the rules after a provider failure or a rejected model answer (status fallback or rejected_output).
import { fileURLToPath } from 'node:url';
import { createApiClient } from './client.js';
import { loadEnvAllowlist } from './env.js';
import { loadProviders } from './llm.js';
import { mintAgentToken } from './mint-token.js';
import { runTriage } from './triage.js';
import { createWriter } from './writer.js';

const ALLOWED = [
  'AGENT_TOKEN', 'JWT_SECRET', 'API_BASE_URL', 'AGENT_DATABASE_URL',
  'LLM_PROVIDER_ORDER', 'LLM_DATA_CLASS', 'LLM_MODEL_NVIDIA', 'LLM_MODEL_GOOGLE', 'LLM_MODEL_OPENROUTER',
  'NVIDIA_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
];
const fail = (msg, code = 2) => {
  console.error(msg);
  process.exit(code);
};

const args = process.argv.slice(2);
const org = args[args.indexOf('--org') + 1];
const rulesOnly = args.includes('--rules-only');
if (!org || !/^[A-Za-z0-9_-]{1,32}$/.test(org)) fail('usage: node agent/cli.js --org ORG1 [--rules-only]');

const cfg = loadEnvAllowlist(fileURLToPath(new URL('../../.env', import.meta.url)), ALLOWED);
const baseUrl = cfg.API_BASE_URL || 'http://127.0.0.1:3000';
const dbUrl = cfg.AGENT_DATABASE_URL || '';
if (!dbUrl) fail('AGENT_DATABASE_URL must be set');

// The token is a bearer credential and the writer URL carries a password: do not send either in clear text off-box.
const loopback = (h) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h);
let api;
let db;
try {
  api = new URL(baseUrl);
  db = new URL(dbUrl);
} catch {
  fail('API_BASE_URL and AGENT_DATABASE_URL must be valid URLs');
}
if (api.protocol !== 'https:' && !loopback(api.hostname)) fail('API_BASE_URL must be https unless it is a loopback address');
if (!loopback(db.hostname) && !['require', 'verify-ca', 'verify-full'].includes(db.searchParams.get('sslmode'))) {
  fail('AGENT_DATABASE_URL must set sslmode=require (or verify-*) for a non-loopback host');
}

let token = cfg.AGENT_TOKEN;
if (!token) {
  if ((cfg.JWT_SECRET || '').length < 32) fail('Set AGENT_TOKEN (see agent/mint-token.js) or JWT_SECRET (at least 32 characters)');
  token = await mintAgentToken(cfg.JWT_SECRET, org);
}
delete cfg.JWT_SECRET; // the secret is not kept past minting

let summary;
try {
  summary = await runTriage({
    org,
    client: createApiClient({ baseUrl, token }),
    writer: createWriter({ connectionString: dbUrl }),
    providers: loadProviders(cfg),
    rulesOnly,
  });
} catch (e) {
  // runTriage already tried to leave a run row with status 'error'. Print the reason only, never a stack with data.
  fail(`agent run failed: ${e && e.name}: ${String((e && e.message) || '').slice(0, 200)}`, 1);
}
console.log(JSON.stringify(summary));
// Exit 3 when the run fell back to rules or rejected model output, so a scheduler or operator can notice.
process.exit(summary.status === 'ok' ? 0 : 3);
