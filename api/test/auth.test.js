import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SignJWT } from 'jose';
import { authenticate, AUDIENCE, ISSUER } from '../src/auth.js';

const SECRET = 'a'.repeat(40);
const mint = (claims) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt()
    .setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
const auth = async (claims) => authenticate(`Bearer ${await mint(claims)}`, SECRET);

describe('claims (offline)', () => {
  test('a normal approver token is accepted with actor human', async () => {
    const c = await auth({ role: 'property_manager', org_id: 'ORG1', sub: 'alice@example.org' });
    assert.deepEqual([c.role, c.org_id, c.sub, c.actor], ['property_manager', 'ORG1', 'alice@example.org', 'human']);
  });
  test('an agent token is accepted only with actor = agent', async () => {
    assert.equal((await auth({ role: 'maintenance_coordinator', org_id: 'ORG1', sub: 'agent.triage', actor: 'agent' })).actor, 'agent');
  });
  test('the agent.* subject is reserved: without actor = agent the token is refused', async () => {
    assert.equal(await auth({ role: 'maintenance_coordinator', org_id: 'ORG1', sub: 'agent.triage' }), null);
    assert.equal(await auth({ role: 'property_manager', org_id: 'ORG1', sub: 'AGENT.anything' }), null);
    assert.equal(await auth({ role: 'property_manager', org_id: 'ORG1', sub: 'agent.x', actor: 'human' }), null);
  });
  test('unknown actor values, bad sub characters and wrong types are refused', async () => {
    assert.equal(await auth({ role: 'property_manager', org_id: 'ORG1', actor: 'superuser' }), null);
    assert.equal(await auth({ role: 'property_manager', org_id: 'ORG1', sub: "a b'; drop" }), null);
    assert.equal(await auth({ role: 'property_manager', org_id: 'ORG1', sub: ['x'] }), null);
  });
});
