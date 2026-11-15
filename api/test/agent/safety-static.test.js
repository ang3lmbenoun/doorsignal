// Tier T3 is "never": the agent has no way to send a message or write ledger or lease data.
// These tests read the agent's source and its public surface and fail if such a path ever appears.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './fixtures.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agent');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
// cli.js is operator wiring (mints the agent's token, then deletes the secret); everything else is agent code.
const agentFiles = files.filter((f) => f !== 'cli.js');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const code = (f) => strip(fs.readFileSync(path.join(dir, f), 'utf8'));

describe('no send path', () => {
  test('the agent directory is what we expect (a new file must be reviewed)', () => {
    assert.deepEqual(files.sort(), ['cases.js', 'cli.js', 'client.js', 'llm.js', 'prompt.js', 'rules.js', 'schema.js', 'triage.js', 'writer.js']);
  });

  test('no mail, SMS, chat, webhook, process or raw-socket module is imported anywhere', () => {
    const banned = /(nodemailer|sendgrid|mailgun|postmark|twilio|smtp|slack|discord|telegram|webhook|child_process|node:net|node:http|node:https|node:dgram|axios|node-fetch|got\b|undici)/i;
    for (const f of files) {
      const imports = [...code(f).matchAll(/(?:import[^'"]*from\s*|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const i of imports) assert.ok(!banned.test(i), `${f} imports ${i}`);
    }
  });

  test('imports are limited to a short allowlist', () => {
    const allowed = new Set(['express', 'pg', 'node:crypto', 'jose']);
    for (const f of files) {
      for (const m of code(f).matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('./')) assert.ok(files.includes(spec.slice(2)), `${f}: unknown local import ${spec}`);
        else if (spec.startsWith('../src/')) assert.equal(f, 'cli.js', `${f} imports API code ${spec}`);
        else assert.ok(allowed.has(spec), `${f} imports ${spec}`);
      }
    }
  });

  test('the only HTTP POST is the model call in llm.js (plus its catalog GET); client.js is GET only', () => {
    for (const f of agentFiles) {
      const methods = [...code(f).matchAll(/method:\s*['"]([A-Z]+)['"]/g)].map((m) => m[1]);
      if (f === 'llm.js') assert.deepEqual(methods.sort(), ['GET', 'POST']); // POST: model call; GET: model catalog list
      else if (f === 'client.js') assert.deepEqual(methods, ['GET']);
      else assert.deepEqual(methods, [], `${f} makes HTTP calls`);
    }
    assert.ok(!/\.(post|put|patch|delete)\(/.test(code('client.js')));
  });

  test('provider names and hosts appear only in llm.js (provider-neutral elsewhere)', () => {
    const provider = /(nvidia|googleapis|generativelanguage|openrouter|integrate\.api|llama|gpt-oss|nemotron|gemini)/i;
    for (const f of agentFiles.filter((x) => x !== 'llm.js')) assert.ok(!provider.test(code(f)), `${f} mentions a provider`);
    const src = fs.readdirSync(path.resolve(dir, '../src')).filter((x) => x.endsWith('.js'));
    for (const f of src) assert.ok(!provider.test(strip(fs.readFileSync(path.resolve(dir, '../src', f), 'utf8'))), `src/${f} mentions a provider`);
  });

  test('no exported function or object is named like a send, notify or approve action', async () => {
    const bad = /(send|mail|sms|notify|notif|push|publish|webhook|dispatch|approve|reject|decide|transfer|pay|charge)/i;
    for (const f of files.filter((x) => x !== 'cli.js')) {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      for (const name of Object.keys(mod)) assert.ok(!bad.test(name), `${f} exports ${name}`);
    }
  });
});

describe('no write path to ledger, leases or anything but the inbox', () => {
  test('SQL in the agent is only INSERT INTO the three ops inbox tables (writer.js); no other file has SQL', () => {
    for (const f of agentFiles) {
      const sql = [...code(f).matchAll(/['"`]\s*((?:INSERT|UPDATE|DELETE|SELECT|TRUNCATE|DROP|ALTER|GRANT|CREATE|REVOKE|SET|BEGIN|COMMIT|ROLLBACK)\b[^'"`]*)/g)].map((m) => m[1]);
      if (f !== 'writer.js') {
        assert.deepEqual(sql, [], `${f} contains SQL`);
        continue;
      }
      for (const s of sql) {
        if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(s)) continue;
        if (s === 'SELECT set_config(') continue; // the single org-setting statement, checked below
        assert.match(s, /^INSERT INTO ops\.(agent_runs|agent_actions|approvals) /, s);
      }
      assert.ok(sql.filter((s) => s.startsWith('INSERT')).length >= 3);
      // The one set_config call sets only the org the run is for (no role, user or actor settings, no SET ROLE).
      const w = code('writer.js');
      assert.equal((w.match(/set_config\(/g) || []).length, 1);
      assert.ok(w.includes("set_config('app.org_id', $1, true)"));
      assert.ok(!/SET\s+(LOCAL\s+)?ROLE|SESSION AUTHORIZATION|app\.(user_id|actor|owner_id)/i.test(w));
    }
  });

  test('no mention of ledger, lease, serving or ground-truth tables in code (comments aside)', () => {
    const touches = /(ledger_entries|fct_|dim_|raw\.|marts\.|serving\.|ground_truth|staging\.|signals\.|risk\.)/i;
    for (const f of agentFiles) assert.ok(!touches.test(code(f).replace(/\/v1\/[a-z-]+/g, '')), `${f} touches a data table`);
  });

  test('the agent never touches the JWT secret or the API database layer (only cli.js, which then deletes it)', () => {
    for (const f of agentFiles) {
      const c = code(f);
      assert.ok(!/JWT_SECRET|SignJWT|jose|\.\.\/src\/db\.js|withClaims/.test(c), `${f} reaches secrets or the API db layer`);
    }
    assert.match(code('cli.js'), /delete process\.env\.JWT_SECRET/);
  });

  test('keys are never logged or placed in an error', () => {
    const c = code('llm.js');
    assert.ok(!/console\.(log|error|warn|info)/.test(c));
    assert.ok(!/(throw new Error\([^)]*key|JSON\.stringify\([^)]*(key|headers))/i.test(c));
  });
});
