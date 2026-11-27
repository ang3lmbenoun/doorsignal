# ADR 0005: web app (React + Vite client, small Express BFF)

Status: accepted for M8. Date: 2026-11-26.

**Decision.** `web/client` is a React single-page app built with Vite. `web/server` is a small Express server (the "BFF", backend for frontend) that serves the built files and forwards `/api/*` to the existing API.

**Why a BFF.** The API accepts a bearer JWT signed with a shared secret. A browser cannot hold that secret. The BFF keeps it, keeps the person's session on the server, and mints a 5-minute token per request for that session's role, org and name. The browser only ever holds an opaque, HttpOnly session cookie.

**Sign-in is a demo.** The BFF starts only with `DEMO_MODE=true`. It offers fixed synthetic personas and no passwords. This is fine for synthetic data and wrong for real data: real use needs an identity provider (see ADR 0003) and the BFF's sign-in replaced. Row-level security still decides what each persona sees, because the API and Postgres are unchanged.

**New dependencies.** Client: `react`, `react-dom` (runtime, bundled), `vite`, `@vitejs/plugin-react` (build only). Server: `express` and `jose`, already approved (ADR 0001, 0003). No router, chart or UI library: a few hundred lines of hand-written components and SVG-free CSS bars.

**Alternatives.** Next.js (heavier, a second server runtime to secure); plain HTML with no build (harder to keep the approval screen correct as it grows); putting minting inside the API (mixes sign-in with the audited read path).

**Risks.** A demo sign-in on a public URL lets anyone approve synthetic drafts. Accepted for synthetic data; the app shows a banner saying so. No rate limiting yet. Sessions are in memory, so a restart signs everyone out.
