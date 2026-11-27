// Operator tool: mints the short-lived token the triage agent reads the API with.
//   node agent/mint-token.js --org ORG1        prints the token (set it as AGENT_TOKEN for agent/cli.js)
// The token has role maintenance_coordinator and actor "agent": it can read what that role reads but can never read
// or decide the approval inbox. Running this in a separate process from the agent keeps JWT_SECRET out of the
// process that talks to the model. (cli.js can also mint in-process as a convenience, then drops the secret.)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { AUDIENCE, ISSUER } from '../src/auth.js';
import { loadEnvAllowlist } from './env.js';

export async function mintAgentToken(secret, org, ttl = '15m') {
  return new SignJWT({ role: 'maintenance_coordinator', org_id: org, sub: 'agent.triage', actor: 'agent' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--org');
  const org = i >= 0 ? process.argv[i + 1] : '';
  const { JWT_SECRET: secret = '' } = loadEnvAllowlist(fileURLToPath(new URL('../../.env', import.meta.url)), ['JWT_SECRET']);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(org || '') || secret.length < 32) {
    console.error('usage: node agent/mint-token.js --org ORG1   (JWT_SECRET must be set, at least 32 characters)');
    process.exit(2);
  }
  console.log(await mintAgentToken(secret, org));
}
