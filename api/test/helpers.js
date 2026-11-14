import crypto from 'node:crypto';
import pg from 'pg';
import { SignJWT } from 'jose';

try {
  process.loadEnvFile?.('../.env'); // repo-root .env (gitignored); cwd is api/ under `npm --prefix api`
} catch {
  /* CI and shells provide the environment directly */
}

const hostOf = (url) => new URL(url).hostname.replace('-pooler', '');

// Owner-privileged URL of the Neon BRANCH under test. NEON_TEST_DATABASE_URL locally, NEON_CI_DATABASE_URL in CI.
export const ADMIN_URL = (process.env.NEON_TEST_DATABASE_URL || process.env.NEON_CI_DATABASE_URL || '').trim();

export function guardNotMain() {
  const main = (process.env.DATABASE_URL || '').trim();
  if (main && hostOf(main) === hostOf(ADMIN_URL)) {
    throw new Error('Refusing to run: the test database host equals DATABASE_URL (main). Use a Neon branch.');
  }
}

// Direct (non-pooled) connection for the API under test, so no role or session state can be shared by a pooler.
export function apiUrlFromAdmin() {
  const password = process.env.API_LOGIN_PASSWORD || '';
  if (password.length < 24) throw new Error('API_LOGIN_PASSWORD is not set (or too short)');
  const u = new URL(ADMIN_URL);
  const out = new URL(`postgresql://${u.host.replace('-pooler', '')}${u.pathname}`);
  out.username = 'api_login';
  out.password = password;
  out.searchParams.set('sslmode', 'require');
  return out.toString();
}

export function adminClientConfig() {
  const u = new URL(ADMIN_URL);
  u.hostname = u.hostname.replace('-pooler', '');
  return { connectionString: u.toString() };
}

export const adminUser = () => decodeURIComponent(new URL(ADMIN_URL).username);

export const SECRET = crypto.randomBytes(32).toString('hex');
const key = (secret) => new TextEncoder().encode(secret);

export async function mint(claims, { secret = SECRET, alg = 'HS256', expiresIn = '5m' } = {}) {
  let jwt = new SignJWT(claims).setProtectedHeader({ alg }).setIssuedAt();
  jwt = typeof expiresIn === 'string' ? jwt.setExpirationTime(expiresIn) : jwt.setExpirationTime(expiresIn);
  return jwt.sign(key(secret));
}

// An unsigned token with alg "none".
export function noneToken(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 300 })}.`;
}

export function claimsFor(role, ctx) {
  if (role === 'owner') return { role, org_id: ctx.org, owner_id: ctx.owner };
  if (role === 'data_owner') return { role };
  return { role, org_id: ctx.org };
}

export { pg };
