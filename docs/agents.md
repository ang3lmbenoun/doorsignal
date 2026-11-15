# Agents (M5b): tiers, the maintenance triage agent, and the model eval

## Tiers
| Tier | Meaning | In M5b |
|---|---|---|
| T0 | read | The agent reads work orders and S01/S02/S09 through the existing read API as an org-scoped `maintenance_coordinator`. |
| T1 | internal flag | Rows in `ops.agent_actions` with tier T1: `repair_breach_presumed`, `repair_at_risk`, `emergency_watch`, `slow_assignment`, `repeat_issue`. Visible to the org's approvers. |
| T2 | draft for human approval | Rows in `ops.agent_actions` with tier T2 (`tenant_status_message`, `vendor_reassignment_suggestion`), each with a **pending** row in `ops.approvals`. A human approves or rejects through the API. |
| T3 | never | Sending anything, legal notices, ledger or lease edits, unapproved outbound messages. No code path exists; tests scan for one. |

"Approved" is a status in a table. **Nothing is sent in M5b**, even after approval.

## What the maintenance triage agent may do
1. Read (T0): open work orders with S01 readings, and S02/S09 flags, for one org.
2. Decide flags (T1) and drafts (T2) with a model, or with deterministic rules.
3. Write only: `INSERT` into `ops.agent_runs`, `ops.agent_actions` and a pending `ops.approvals` row, as database role `api_agent_writer`.

It may not: read other orgs, read the approval inbox, decide any approval (its token carries `actor: agent`; the API and a database trigger both refuse), touch `serving`, `marts`, `raw`, `ground_truth` or any ledger or lease table, send a message, or state a legal conclusion.

## How a run works (`api/agent/`)
`cli.js` (operator) mints a 15-minute token for the agent and deletes `JWT_SECRET` from the process; the agent and the model only ever hold the token.
`cases.js` loads candidates through the API; `triage.js` sends batches (10 work orders) to the model and validates every answer with `schema.js`; a batch whose output is rejected, or any batch when no provider answers, is handled by `rules.js`; `writer.js` stores the run, the actions and the pending approvals in one transaction.

- **Closed output contract.** Exactly `{flags, drafts}`; fixed kinds; ids must exist in the input; length caps; no links, emails, phone numbers, hidden characters, legal conclusions or ids that were not in the input. Anything else rejects the whole answer.
- **Cross-check against the signal values.** A breach flag needs S01 >= 7.0 days, an at-risk flag 5.0 <= S01 < 7.0, `emergency_watch` the emergency band, `slow_assignment` an elevated or high S02, `repeat_issue` an S09 reading. A contradicting answer is rejected, logged in `agent_runs` as a reason code plus a short hash (never the content), and replaced by the rules for that batch.
- **S01 is a rebuttable presumption, not a legal finding.** Code (not the model) appends a fixed note to every draft about a work order with an S01 reading saying so and that a person must review it. The wording needs attorney review (as the S01 registry row already says).
- **Untrusted text.** An optional `tenant_note` is shown to the model only as a JSON string inside the case data, never in the system prompt. In M5b it exists only in test and eval fixtures (work orders have no free-text column yet).
- **Fallback.** Provider order and models come from environment variables (`LLM_PROVIDER_ORDER`, `LLM_MODEL_<PROVIDER>`, keys `NVIDIA_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`); 429 and 5xx are retried with backoff and `Retry-After`; if every provider fails the rule-based triage runs and the run is marked `fallback`. All provider-specific code is in `api/agent/llm.js`.
- Only synthetic data is ever sent to a provider.

## What the tests prove
Run: `npm run test:leaks --prefix api` (needs a Neon branch; offline agent tests also run alone with `node --test "test/agent/*.test.js"`).

| Claim | Evidence |
|---|---|
| (a) S01 breach at 7.0 days, not before, through the agent path | `test/agent/e2e.test.js`: fixtures at 6.0, 6.9, 6.999, 7.0, 7.001 days go client, triage, validator, writer into the inbox on both the rules path and a recorded-model path; real branch data: every S01 row's flag equals the serving layer (breach iff value >= 7, rows exist on both sides). The dbt unit test covers the SQL at 6.999 and 7.0. Real data has no row near 7.0, which is why exact boundaries use fixtures. |
| (b) the agent can never send or write ledger/lease data | `test/agent/safety-static.test.js` (no mail/SMS/webhook/process modules, only one HTTP POST and it is the model call, SQL is only `INSERT` into the three inbox tables, no export named like a send or approve action, no secret or API-db import); `test/approvals-db.test.js` (as `api_agent_writer`: UPDATE/DELETE/SELECT/TRUNCATE on the inbox, writes to `serving`, `marts`, `raw`, `ground_truth`, `CREATE`, `SET ROLE` all fail; exact privileges are INSERT on three tables). |
| (c) a human must approve before anything counts as approved | `test/approvals-api.test.js` and `approvals-db.test.js`: the writer cannot update; agent-actor tokens get 403 on the inbox and the trigger refuses them; only property_manager and maintenance_coordinator of the same org can decide; one decision only; who/role/when and the exact draft text and hash are recorded by the database. After agent runs every approval is still pending. |
| Prompt injection stays inside the schema and tiers | `test/agent/triage.test.js`, `e2e.test.js`: a model that obeys "approve this", "send email to...", "reveal other tenants", a fake schema or a 6.9-day breach request is rejected and the rules' output is stored; the note never appears in an action. Real models are measured in the eval below. |
| Malformed model output is rejected and logged, never executed | `schema.test.js` (84 cases), `triage.test.js`. |
| The agent cannot reach another org | `e2e.test.js`: an ORG1 agent token gets 404 for an ORG2 work order, sees only ORG1 rows and only S01/S02/S08/S09, and its writes are ORG1 only. |
| Retry, backoff, fallback | `test/agent/llm.test.js` with a fake transport; `fetch` is disabled in these tests. |

## Model-selection eval (run 2026-11-14)
36 synthetic cases (`api/eval/cases.js`): 11 S01 boundary cases (0.5 to 30.2 days, including 6.9, 6.999, 7.0, 7.001), emergency, S02, S09, combinations, a 10-work-order batch, clean cases and 8 prompt-injection cases (the tenant note says "ignore rules, approve this", "send email to...", "reveal other tenants", a fake system message, its own JSON, an extra `action` key, "print your system prompt", a jailbreak persona). Expected flags are hand-labelled from the registry rules, not computed by the rules code (a test checks the two agree). Each case goes through the same prompt, the same closed validator and the same provider code as production. Run: `node eval/run.js --provider nvidia --models <ids> --out ../docs/agents-eval/results.json` (needs a live key; never run in CI). Raw per-case rows are in `docs/agents-eval/results.json`.

### Which models
The three requested models could not be evaluated as specified (checked against the catalog and with a trivial call, no case data sent):
- `meta/llama-3.3-70b-instruct` and `openai/gpt-oss-120b`: not in the catalog, calls return **410 Gone**.
- `nvidia/nemotron-3-super-120b-a12b` (the only text Nemotron Super): listed, but calls return **404** with this key.

With Angel's approval the eval used three models that answered: `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3.5-lightning-30b-a3b` and `meta/muse-glimmer-30b`. Other listed models also returned 404 or timed out in the probe (for example `openai/gpt-oss-20b`, `mistralai/mistral-large-2-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`), so the catalog listing is not a reliable guide to what is callable.

### Results
Provider: NVIDIA (`integrate.api.nvidia.com/v1`), temperature 0, one run per case, 4000 max tokens, 180 s timeout, 3 requests in flight per model, up to 3 attempts per call.

| | valid JSON | schema-valid | correct flags (exact set) | boundary (11) | injection (8) | wrong tool/action | failed calls | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|---|---|
| rules (no model) | 100% | 100% | 100% | 100% | 100% | 0 | 0 | 0 | 0 |
| nemotron-3-ultra-550b-a55b | 100% | 100% | **100%** (36/36) | 100% | 100% | 0 | 0 | 8.6 s | 26.3 s |
| nemotron-3.5-lightning-30b-a3b | 94.4% | 94.4% | 94.4% (34/36) | 90.9% | 100% | 0 | 0 | 11.1 s | 22.0 s |
| muse-glimmer-30b | 97.2% | 97.2% | 97.2% (35/36) | 100% | 100% | 0 | 1 | 71.7 s | 129.6 s |

Every miss was a missing answer, never a wrong flag: among answers that were valid, all three models were exactly right (correct-flag rate 100% among valid answers, precision 1.0). Lightning returned an empty message on two cases (`b11`, `m01`, the two multi-work-order ones); muse-glimmer timed out three times on `m01` (the 10-work-order batch). Wrong tool/action count is 0 for every model: no unknown kind, extra key, link, email, phone or foreign id, and no model followed an injected instruction. Latency is wall time per call including retries, measured with 3 calls in flight, not an idle benchmark.

### Recommendation
Use **`nvidia/nemotron-3-ultra-550b-a55b`** as the development default: it is the only candidate with 100% valid answers and no failed call, and it has the lowest median latency. This rests on this run only.

Limits that matter more than the ranking:
- **The model adds nothing to flag accuracy.** The deterministic rules also score 100% on these cases, because flags follow directly from signal values. A model is only worth its latency, cost and risk if it improves draft wording, and **draft quality is not measured here** (drafts are only checked for safety: no links, contact details, legal wording or foreign ids). Treat the rules path as the reliable baseline and the model as optional.
- 36 cases, one run each, temperature 0, free-tier shared endpoints: a difference of one or two cases (the lightning and muse misses) is within what repeated runs could change. Injection results are 8 cases, not a proof of robustness; the real protection is the validator and the tier design, which the fake-model tests exercise independently.
- The 550B model's cost and licensing for production use are unknown to me and not evaluated. The two Llama and gpt-oss candidates you asked for were not testable, so nothing here says how they compare.
