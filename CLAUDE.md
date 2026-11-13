# DoorSignal: rules for Claude Code

Project: a property-management signal platform. Data engineering + BI + risk layer + role-scoped agents.
Owner: Angel. Read docs/architecture.md and the current milestone in docs/milestones.md before any change.

## Working rules
1. Work one milestone at a time. Done means the milestone's pass command succeeds, not a description.
2. Every signal needs a registry row (inputs, refresh, threshold, evidence grade A/B/C, action tier, known failure modes) before any code.
3. Every data source carries a tag: REAL_PUBLIC, SYNTHETIC_CALIBRATED, or USER_EXPORT.
4. Synthetic parameters live in sim/config.yaml, each with a cited source or the label "assumption".
5. Never use protected-class attributes as features. Never build applicant accept/deny/score logic.
6. Agent tiers: T0 read, T1 internal flag, T2 draft for human approval, T3 never (legal notices, ledger/lease edits, unapproved outbound messages).
7. No secrets in the repo. Use environment variables and .env (gitignored). Ask Angel before installing or provisioning anything.
8. Small commits, clear messages. Write a short ADR in docs/adr/ for any new dependency.
9. At each milestone end run the schema, security, and incident review agents.
10. When information is missing, ask Angel. Do not guess.

## Stack
Postgres (Neon), dbt-core, Python (simulator, ingest), Express API with row-level security, React web, Tableau for BI, GitHub Actions.

## Style
Direct, concise. Label estimates as estimates. State confidence when uncertain.
