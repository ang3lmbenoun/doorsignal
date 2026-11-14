# ADR 0001: express (runtime dependency, api/)

Status: accepted for M5a. Date: 2026-11-13.

**Decision.** Use `express` for the read-only HTTP API.

**Why.** CLAUDE.md names Express as the API stack. It is small, widely reviewed, and has no database access of its own, so row-level security stays in Postgres.

**Alternatives.** Node `http` directly (more hand-written routing and error handling, so more room for mistakes); Fastify (not in the stack).

**Risks.** Large transitive tree. Mitigation: pin versions through the lockfile, run `npm audit` in CI later. Express adds no auth or query logic; all request handling goes through one middleware that opens the per-request transaction.
