// Operator entry point: node agent/cli.js --org ORG1 [--rules-only]
// The operator holds JWT_SECRET. This file mints a short-lived token for the agent (role maintenance_coordinator,
// actor "agent", so it can read but can never decide an approval) and then removes the secret from the process
// environment. The agent modules and the model only ever see the token.
import { SignJWT } from 'jose';
import { AUDIENCE, ISSUER } from '../src/auth.js';
import { createApiClient } from './client.js';
import { loadProviders } from './llm.js';
import { runTriage } from './triage.js';
import { createWriter } from './writer.js';

try {
  process.loadEnvFile?.('../.env');
} catch {
  /* no .env: rely on the process environment */
}

const args = process.argv.slice(2);
const org = args[args.indexOf('--org') + 1];
const rulesOnly = args.includes('--rules-only');
if (!org || !/^[A-Za-z0-9_-]{1,32}$/.test(org)) {
  console.error('usage: node agent/cli.js --org ORG1 [--rules-only]');
  process.exit(2);
}
const secret = process.env.JWT_SECRET || '';
const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const dbUrl = process.env.AGENT_DATABASE_URL || '';
if (secret.length < 32 || !dbUrl) {
  console.error('JWT_SECRET and AGENT_DATABASE_URL must be set');
  process.exit(2);
}

const token = await new SignJWT({ role: 'maintenance_coordinator', org_id: org, sub: 'agent.triage', actor: 'agent' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('15m')
  .sign(new TextEncoder().encode(secret));
delete process.env.JWT_SECRET;

const summary = await runTriage({
  org,
  client: createApiClient({ baseUrl, token }),
  writer: createWriter({ connectionString: dbUrl }),
  providers: loadProviders(),
  rulesOnly,
});
console.log(JSON.stringify(summary));
