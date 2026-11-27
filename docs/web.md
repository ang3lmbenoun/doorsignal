# Web app (M8)

A React single-page app plus a small Express server (the BFF). ADR: `docs/adr/0005-web-app.md`.

## Run it locally
```
# terminal 1: the API (see docs/api.md for the database setup)
JWT_SECRET=... API_DATABASE_URL=<api_login url> npm start --prefix api
# terminal 2: the web app
cd web && npm install && npm run build
DEMO_MODE=true JWT_SECRET=<same secret> API_BASE_URL=http://127.0.0.1:3000 npm start
```
Open http://127.0.0.1:8080. For client development run `npm run dev:client` (Vite, proxies to port 8080).
Works when: the sign-in page lists six people, signing in as Pat Rivera shows counts, and the approval inbox lists drafts after `node api/agent/cli.js --org ORG1 --rules-only` has run.

## What each role sees
Same rules as the API (`docs/api.md`): the database decides. Pages a role cannot use are hidden, and a direct call returns 403.
| Person | Role | Pages |
|---|---|---|
| Pat Rivera, Sam Patel (ORG1, ORG2) | property_manager | everything, including the approval inbox |
| Maya Chen | maintenance_coordinator | overview, repairs, risk, signals, inbox |
| Leo Ortiz | leasing_manager | overview, leases, risk, signals |
| Olivia Grant | owner O01 | own properties only, no inbox |
| Dana Wu | data_owner | all orgs, read only, no inbox |

## Checked
- `npm test --prefix web`: 11 tests for the BFF (sign-in, session expiry, minted claims, path allowlist, JSON-only decisions, query validation, status pass-through).
- Real run on a scratch Postgres 16 with the real API: Pat sees 8 drafts, Sam (ORG2) sees 1, Leo gets 403 on the inbox, Maya gets 403 on expected loss; approving records `pat.rivera`; approving twice gives 409; Sam deciding an ORG1 draft gives 404. Headless Chrome walked sign-in, overview, inbox, repair clock and expected loss with no error elements.

## Known limits
- Demo sign-in: no passwords. Real use needs an identity provider and a replacement for `/auth/login` (ADR 0005, ADR 0003).
- Sessions live in server memory (a restart signs everyone out). No rate limiting. Single instance only.
- Read-only except approve and reject. The agent is run by an operator from the command line, not from the app.
- No browser-level automated tests yet; the screens were checked by hand with headless Chrome.
