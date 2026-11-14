import { jwtVerify } from 'jose';
import { REQUIRED_CLAIMS, ROLES } from './roles.js';

export const ISSUER = 'doorsignal';
export const AUDIENCE = 'doorsignal-api';
const ID = /^[A-Za-z0-9_-]{1,32}$/;

// Verifies a bearer token (HS256 only, exp required) and returns clean claims, or null.
export async function authenticate(header, secret) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!m) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1], new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['exp', 'iat'],
      clockTolerance: 5,
      maxTokenAge: '1h', // a token with a far-future exp is still refused once it is older than this
    }));
  } catch {
    return null;
  }
  const role = payload.role;
  if (typeof role !== 'string' || !Object.hasOwn(ROLES, role)) return null;
  const claims = { role, org_id: '', owner_id: '' };
  for (const name of ['org_id', 'owner_id']) {
    const v = payload[name];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !ID.test(v)) return null;
    claims[name] = v;
  }
  for (const name of REQUIRED_CLAIMS[role]) if (!claims[name]) return null;
  return claims;
}
