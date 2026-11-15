# ADR 0004: separate the agent's write role from the approver (no new dependency)

Status: accepted for M5b. Date: 2026-11-14.

**Decision.** The triage agent connects as `api_agent_writer`, which can only INSERT `ops.agent_runs`, `ops.agent_actions` and a *pending* `ops.approvals` row. Approving or rejecting a draft is done by a human through the API as `api_property_manager` or `api_maintenance_coordinator`, which hold column-level UPDATE on `approvals.status` and are limited by RLS to their own org. A trigger fills the decision fields (who from the token `sub`, role, time, the exact draft text and its SHA-256, copied from the immutable action) and allows one transition only (pending to approved or rejected).

**Why.** The first wording of the requirement gave one role both INSERT on actions and UPDATE on approvals. That role could approve its own drafts, so "a human must approve" would hold only by application convention. With the split, the guarantee is in the database and is tested: the agent role has no UPDATE or SELECT anywhere.

**Consequences.**
- On `agent_runs` and `agent_actions`, UPDATE and DELETE are refused for every role by row triggers. This is not owner-proof: the table owner could drop or disable a trigger. TRUNCATE is not covered by the triggers; no API role holds it, so it is owner-only and is used for test resets.
- The draft SHA-256 is set by a `BEFORE INSERT` trigger from the stored text and overwrites anything the caller supplies (a generated column is not possible: `convert_to()` is STABLE).
- The writer sets `app.org_id` itself. An agent that lies about its org can only add pending rows to that org's inbox; a human still decides, and it cannot read or change anything. Per-org agent logins would close this and are out of scope for M5b.
- "Approved" is a status only. No code path sends a message or edits a ledger or lease (tier T3), and tests scan for one.
- `decided_by` trusts the `sub` claim of a shared-secret JWT (same limitation as ADR 0003).

**Alternatives.** One role that inserts and updates (rejected: self-approval); a SECURITY DEFINER approve function (rejected: moves the check into a function the owner must keep correct; policies plus a trigger are simpler to test).
