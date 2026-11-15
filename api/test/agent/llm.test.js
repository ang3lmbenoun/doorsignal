import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { complete, LlmUnavailable, loadProviders } from '../../agent/llm.js';
import { okResponse, statusResponse } from './fixtures.js';

const P = (name, key = `key-${name}`) => ({ name, baseUrl: `http://${name}.test/v1`, key, model: `model-${name}` });
const msgs = [{ role: 'user', content: 'hi' }];
const script = (steps) => {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    const step = steps[calls.length - 1];
    if (!step) throw new Error('unexpected extra call');
    if (step instanceof Error) throw step;
    return step;
  };
  return { transport, calls };
};
const sleeps = () => {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
};

describe('retry and fallback', () => {
  test('429 then success on the same provider: retries with backoff', async () => {
    const { transport, calls } = script([statusResponse(429), statusResponse(429), okResponse('hello')]);
    const { waits, sleep } = sleeps();
    const r = await complete({ providers: [P('a')], messages: msgs, transport, sleep });
    assert.deepEqual([r.text, r.provider, r.model, r.attempts], ['hello', 'a', 'model-a', 3]);
    assert.equal(calls.length, 3);
    assert.equal(waits.length, 2);
    assert.ok(waits[1] > waits[0] || waits[1] >= 1000); // exponential: second wait at least as long as the base of the first
  });
  test('Retry-After is honoured', async () => {
    const { transport } = script([statusResponse(429, { 'retry-after': '2' }), okResponse('x')]);
    const { waits, sleep } = sleeps();
    await complete({ providers: [P('a')], messages: msgs, transport, sleep });
    assert.deepEqual(waits, [2000]);
  });
  test('5xx three times moves to the next provider', async () => {
    const { transport, calls } = script([statusResponse(503), statusResponse(500), statusResponse(502), okResponse('from b')]);
    const { sleep } = sleeps();
    const r = await complete({ providers: [P('a'), P('b')], messages: msgs, transport, sleep });
    assert.deepEqual([r.provider, r.text], ['b', 'from b']);
    assert.deepEqual(calls.map((c) => c.url), ['http://a.test/v1/chat/completions', 'http://a.test/v1/chat/completions', 'http://a.test/v1/chat/completions', 'http://b.test/v1/chat/completions']);
  });
  test('a non-retryable 4xx is not retried: straight to the next provider', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { transport, calls } = script([statusResponse(status), okResponse('b')]);
      const r = await complete({ providers: [P('a'), P('b')], messages: msgs, transport, sleep: sleeps().sleep });
      assert.equal(r.provider, 'b');
      assert.equal(calls.length, 2, `status ${status}`);
    }
  });
  test('network errors and timeouts are retried', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const { transport } = script([new Error('ECONNRESET'), timeout, okResponse('ok')]);
    const r = await complete({ providers: [P('a')], messages: msgs, transport, sleep: sleeps().sleep });
    assert.equal(r.text, 'ok');
  });
  test('every provider failing throws LlmUnavailable with attempt statuses and no secrets', async () => {
    const { transport } = script([statusResponse(503), statusResponse(503), statusResponse(503), statusResponse(401)]);
    await assert.rejects(
      complete({ providers: [P('a', 'SECRET-KEY-A'), P('b', 'SECRET-KEY-B')], messages: msgs, transport, sleep: sleeps().sleep }),
      (e) => {
        assert.ok(e instanceof LlmUnavailable);
        assert.deepEqual(e.attempts.map((a) => a.status), [503, 503, 503, 401]);
        assert.ok(!JSON.stringify(e.attempts).includes('SECRET-KEY'));
        assert.ok(!String(e.message + e.stack).includes('SECRET-KEY'));
        return true;
      });
  });
  test('no providers configured throws LlmUnavailable without any network call', async () => {
    const { transport, calls } = script([]);
    await assert.rejects(complete({ providers: [], messages: msgs, transport }), LlmUnavailable);
    assert.equal(calls.length, 0);
  });
  test('an empty completion comes back as empty text for the validator to reject', async () => {
    const { transport } = script([{ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: null } }] }) }]);
    assert.equal((await complete({ providers: [P('a')], messages: msgs, transport })).text, '');
  });
  test('request shape: bearer key to that provider only, model and temperature 0, nothing else sent', async () => {
    const { transport, calls } = script([okResponse('x')]);
    await complete({ providers: [P('a')], messages: msgs, transport });
    assert.equal(calls[0].auth, 'Bearer key-a');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['max_tokens', 'messages', 'model', 'temperature']);
    assert.equal(calls[0].body.temperature, 0);
  });
});

describe('configuration from the environment', () => {
  test('order, models and keys come from env; a provider without key or model is skipped', () => {
    const p = loadProviders({
      LLM_PROVIDER_ORDER: 'openrouter, nvidia ,google',
      NVIDIA_API_KEY: 'n', LLM_MODEL_NVIDIA: 'nm', OPENROUTER_API_KEY: 'o', LLM_MODEL_OPENROUTER: 'om', GOOGLE_API_KEY: 'g',
    });
    assert.deepEqual(p.map((x) => [x.name, x.model]), [['openrouter', 'om'], ['nvidia', 'nm']]); // google has no model
    assert.equal(p[1].baseUrl, 'https://integrate.api.nvidia.com/v1');
  });
  test('default order, unknown names ignored, duplicates dropped, nothing configured gives none', () => {
    const env = { NVIDIA_API_KEY: 'n', LLM_MODEL_NVIDIA: 'm', GOOGLE_API_KEY: 'g', LLM_MODEL_GOOGLE: 'gm' };
    assert.deepEqual(loadProviders(env).map((x) => x.name), ['nvidia', 'google']);
    assert.deepEqual(loadProviders({ ...env, LLM_PROVIDER_ORDER: 'evil,nvidia,nvidia' }).map((x) => x.name), ['nvidia']);
    assert.deepEqual(loadProviders({}), []);
  });
  test('the real network is never used by these tests (fetch is disabled)', async () => {
    const { transport } = script([okResponse('x')]);
    assert.throws(() => fetch('http://example.test'), /network is disabled/);
    assert.equal((await complete({ providers: [P('a')], messages: msgs, transport })).text, 'x');
  });
});
