// Provider-neutral LLM access. The ONLY file that knows about providers. NVIDIA, Google AI Studio and OpenRouter
// all expose OpenAI-compatible chat completions, so one small client serves all three.
//
// Configuration (environment only; keys are never logged or returned):
//   LLM_PROVIDER_ORDER   comma list, default "nvidia,google,openrouter"
//   LLM_MODEL_NVIDIA / LLM_MODEL_GOOGLE / LLM_MODEL_OPENROUTER   model id per provider (no built-in defaults)
//   NVIDIA_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY
// A provider without both a key and a model is skipped. With none configured, complete() throws
// LlmUnavailable and the caller falls back to the rule-based triage.
//
// Only synthetic data may be sent to a provider. The messages are built by prompt.js from the case list.

const KNOWN = {
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', keyEnv: 'NVIDIA_API_KEY', modelEnv: 'LLM_MODEL_NVIDIA' },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GOOGLE_API_KEY', modelEnv: 'LLM_MODEL_GOOGLE',
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'LLM_MODEL_OPENROUTER' },
};

export class LlmUnavailable extends Error {
  constructor(attempts) {
    super('no LLM provider produced a response');
    this.name = 'LlmUnavailable';
    this.attempts = attempts; // [{provider, status|error, attempt}] with no bodies and no keys
  }
}

export function loadProviders(env = process.env) {
  const order = (env.LLM_PROVIDER_ORDER || 'nvidia,google,openrouter').split(',').map((s) => s.trim().toLowerCase());
  const out = [];
  for (const name of order) {
    const p = KNOWN[name];
    if (!p || out.some((o) => o.name === name)) continue;
    const key = (env[p.keyEnv] || '').trim();
    const model = (env[p.modelEnv] || '').trim();
    if (key && model) out.push({ name, baseUrl: p.baseUrl, key, model });
  }
  return out;
}

const RETRYABLE = (status) => status === 429 || (status >= 500 && status <= 599);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt, retryAfterHeader) {
  const ra = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 30000);
  return Math.min(500 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
}

// One chat completion with retry and provider fallback. Returns {text, provider, model, latencyMs, attempts}.
// transport/sleep are injectable so tests use a fake provider and no real waiting or network.
export async function complete({
  providers,
  messages,
  transport = (...a) => fetch(...a),
  sleep = defaultSleep,
  maxAttempts = 3,
  timeoutMs = 30000,
  maxTokens = 2000,
  temperature = 0,
}) {
  const attempts = [];
  for (const p of providers) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      let res;
      try {
        res = await transport(`${p.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
          body: JSON.stringify({ model: p.model, messages, temperature, max_tokens: maxTokens }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        attempts.push({ provider: p.name, attempt, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' });
        if (attempt < maxAttempts) await sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) {
        let data;
        try {
          data = await res.json();
        } catch {
          attempts.push({ provider: p.name, attempt, error: 'bad_json_envelope' });
          break; // a malformed envelope is not retried: try the next provider
        }
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return {
          text: typeof text === 'string' ? text : '',
          provider: p.name,
          model: p.model,
          latencyMs: Date.now() - started,
          attempts: attempts.length + 1,
        };
      }
      attempts.push({ provider: p.name, attempt, status: res.status });
      if (RETRYABLE(res.status) && attempt < maxAttempts) {
        await sleep(backoffMs(attempt, res.headers && res.headers.get && res.headers.get('retry-after')));
        continue;
      }
      break; // other 4xx, or retries exhausted: next provider
    }
  }
  throw new LlmUnavailable(attempts);
}
