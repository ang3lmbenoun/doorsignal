# ruff: noqa: E501  (long SQL and docstring lines are clearer unwrapped)
"""Policy-mutation check for the API and approval-inbox access rules. Neon BRANCH only, never main.

    python -m ingest.mutation_check [--url-env NEON_TEST_DATABASE_URL] [--only 3,9] [--out docs/api-mutations.json]

For each of the 16 mutations, serially: apply it, run the full test suite (one test process at a time), restore with
30 + 31 + 32 + 33, verify the restored state equals a snapshot taken before any mutation (policies, grants, column
grants, schema usage, role memberships, triggers), then run the full suite again, which must be green. Results are
written after every mutation, so an interrupted run keeps what it has. A mutation "survives" when the suite stays
green with it applied: that is either a gap in the tests or an equivalent mutant (a redundant layer makes the change
unobservable); deciding which is done by reading the policies, not by this script.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse

import psycopg
from dotenv import dotenv_values

from ingest.db import ROOT

ORG = "nullif(current_setting('app.org_id', true), '')"
OWN = "nullif(current_setting('app.owner_id', true), '')"
ALL_ROLES = ("api_owner, api_property_manager, api_maintenance_coordinator, api_leasing_manager, "
             "api_data_owner")

# (id, what changed, SQL). Ids 1-6 are the M5a access rules, 7-16 the M5b approval inbox.
MUTATIONS = [
    (1, "serving.all_signals, property_manager: org_id = org replaced by true",
     "drop policy p_property_manager on serving.all_signals; create policy p_property_manager on "
     "serving.all_signals for select to api_property_manager using (true);"),
    (2, "serving.all_signals, owner: owner_id condition dropped (org only)",
     "drop policy p_owner on serving.all_signals; create policy p_owner on serving.all_signals for select "
     f"to api_owner using (org_id = {ORG});"),
    (3, "serving.leases, leasing_manager: policy removed, select granted anyway",
     "drop policy p_leasing_manager on serving.leases; grant select on serving.leases to api_leasing_manager;"),
    (4, "serving.all_signals, maintenance_coordinator: signal_id filter removed (all signals)",
     "drop policy p_maintenance_coordinator on serving.all_signals; create policy p_maintenance_coordinator on "
     f"serving.all_signals for select to api_maintenance_coordinator using (org_id = {ORG});"),
    (5, "grant usage on schema ground_truth to api_data_owner",
     "grant usage on schema ground_truth to api_data_owner;"),
    (6, "grant api_data_owner to api_login with inherit true, set true",
     "grant api_data_owner to api_login with inherit true, set true;"),
    (7, "api_agent_writer gets UPDATE on ops.approvals (self-approve path)",
     "grant update on ops.approvals to api_agent_writer;"),
    (8, "ops.approvals read policy for approvers: org filter replaced by true",
     "drop policy h_approvals_read on ops.approvals; create policy h_approvals_read on ops.approvals for select "
     "to api_property_manager, api_maintenance_coordinator using (true);"),
    (9, "ops.approvals decide policy for approvers: org filter removed",
     "drop policy h_approvals_decide on ops.approvals; create policy h_approvals_decide on ops.approvals for "
     "update to api_property_manager, api_maintenance_coordinator using (status = 'pending') "
     "with check (status in ('approved', 'rejected'));"),
    (10, "leasing_manager gets SELECT on ops.approvals (no schema usage)",
     "grant select on ops.approvals to api_leasing_manager;"),
    (11, "approvals_guard trigger dropped (decision fields forgeable, no actor check)",
     "drop trigger approvals_guard_trg on ops.approvals;"),
    (12, "writer insert policy on approvals: status = 'pending' condition removed",
     "drop policy w_approvals on ops.approvals; create policy w_approvals on ops.approvals for insert "
     f"to api_agent_writer with check (org_id = {ORG});"),
    (13, "api_agent_writer gets INSERT on serving.leases (a lease write path)",
     "grant usage on schema serving to api_agent_writer; grant insert on serving.leases to api_agent_writer;"),
    (14, "writer insert policy on agent_actions: org check removed",
     "drop policy w_actions on ops.agent_actions; create policy w_actions on ops.agent_actions for insert "
     "to api_agent_writer with check (true);"),
    (15, "agent_actions append-only trigger dropped",
     "drop trigger agent_actions_append_only on ops.agent_actions;"),
    (16, "data_owner gets SELECT on ops.agent_actions (and usage on schema ops)",
     "grant usage on schema ops to api_data_owner; grant select on ops.agent_actions to api_data_owner;"),
]

SNAPSHOT_SQL = {
    "policies": "select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies "
                "where schemaname in ('serving','ops') order by 1,2,3",
    "grants": "select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants "
              "where grantee like 'api\\_%' order by 1,2,3,4",
    "colgrants": "select grantee, table_schema, table_name, column_name, privilege_type from "
                 "information_schema.column_privileges where grantee like 'api\\_%' and table_schema in "
                 "('ops','serving') and grantee not in ('api_owner') order by 1,2,3,4,5",
    "schema_usage": "select r.rolname, n.nspname from pg_roles r cross join pg_namespace n where r.rolname like "
                    "'api\\_%' and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema' and "
                    "has_schema_privilege(r.rolname, n.nspname, 'USAGE') order by 1,2",
    "members": "select u.rolname, r.rolname, m.inherit_option, m.set_option from pg_auth_members m join pg_roles r "
               "on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname like 'api\\_%' order by 1,2",
    "triggers": "select tgrelid::regclass::text, tgname from pg_trigger where not tgisinternal and "
                "tgrelid::regclass::text like 'ops.%' order by 1,2",
}


def host(url: str) -> str:
    return (urlparse(url).hostname or "").replace("-pooler", "")


def snapshot(url: str) -> dict:
    with psycopg.connect(url, connect_timeout=30) as c:
        return {k: [tuple(map(str, r)) for r in c.execute(q).fetchall()] for k, q in SNAPSHOT_SQL.items()}


def restore(env: dict) -> None:
    for which in ("roles", "rls", "ops"):
        r = subprocess.run([sys.executable, "-m", "ingest.api_sql", which], cwd=ROOT, env=env,
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"RESTORE FAILED at {which}: {r.stderr[-300:]}")


def run_suite(env: dict) -> dict:
    npm = shutil.which("npm") or "npm"
    r = subprocess.run([npm, "run", "test:leaks", "--prefix", "api"], cwd=ROOT, env=env, capture_output=True,
                       encoding="utf-8", errors="replace", shell=os.name == "nt")
    out = r.stdout + r.stderr
    nums = {k: int(v) for k, v in re.findall(r"^\S* ?(tests|pass|fail|skipped) (\d+)\s*$", out, re.M)}
    failing = []
    if "failing tests:" in out:
        for line in out.split("failing tests:")[1].splitlines():
            m = re.match(r"^\s*\S* ?(.+?) \([\d.]+ms\)\s*$", line) if "(" in line else None
            if m and line.strip().startswith(("✖", "x ")):
                name = m.group(1).strip()
                if not re.match(r"^\d+\. |^summary$", name):
                    failing.append(name)
    leaks = re.search(r"cross_org_leaks=(\d+)", out)
    return {"tests": nums.get("tests"), "pass": nums.get("pass"), "fail": nums.get("fail"),
            "skipped": nums.get("skipped"), "leaks": int(leaks.group(1)) if leaks else None,
            "failing": sorted(set(failing)), "exit": r.returncode}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url-env", default="NEON_TEST_DATABASE_URL")
    ap.add_argument("--only", default="", help="comma list of mutation ids")
    ap.add_argument("--out", default="docs/api-mutations.json")
    args = ap.parse_args()

    values = dotenv_values(ROOT / ".env")
    url = os.environ.get(args.url_env) or values.get(args.url_env, "")
    main_url = os.environ.get("DATABASE_URL") or values.get("DATABASE_URL", "")
    if not url:
        print(f"ERROR: {args.url_env} is not set")
        return 2
    if main_url and host(url) == host(main_url):
        print("REFUSING: the target has the same host as the main database")
        return 2
    # Every child process sees the branch as NEON_TEST_DATABASE_URL, and main is named only by its host.
    env = {**os.environ, "NEON_TEST_DATABASE_URL": url, "MAIN_DATABASE_HOST": host(main_url)}
    env.pop("DATABASE_URL", None)
    env.pop("NEON_CI_DATABASE_URL", None)

    wanted = {int(x) for x in args.only.split(",") if x.strip()}
    base = snapshot(url)
    print("baseline snapshot:", {k: len(v) for k, v in base.items()}, flush=True)
    results = []
    out_path = ROOT / args.out
    for mid, what, sql in MUTATIONS:
        if wanted and mid not in wanted:
            continue
        print(f"\n=== mutation {mid}: {what}", flush=True)
        try:
            with psycopg.connect(url, autocommit=True, connect_timeout=30) as c:
                c.execute(sql)
            mutated = run_suite(env)
        finally:
            restore(env)
        identical = snapshot(url) == base
        rerun = run_suite(env)
        row = {"id": mid, "what": what, "with_mutation": mutated, "restored_identical": identical,
               "rerun_after_restore": rerun}
        results.append(row)
        print(f"  with mutation: tests={mutated['tests']} failed={mutated['fail']} leaks={mutated['leaks']}", flush=True)
        for name in mutated["failing"]:
            print("     FAIL:", name, flush=True)
        print(f"  restored identical to baseline: {identical}; rerun: tests={rerun['tests']} failed={rerun['fail']}",
              flush=True)
        out_path.write_text(json.dumps(results, indent=1), encoding="utf-8")
        if not identical or rerun["fail"]:
            print("STOPPING: restored state differs from baseline or the rerun is not green", flush=True)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
