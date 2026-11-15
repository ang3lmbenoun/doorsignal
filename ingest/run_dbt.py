"""Run dbt with PG* variables derived from DATABASE_URL. Usage: python -m ingest.run_dbt build

After a build or run, re-applies the serving RLS policies and grants if the API roles exist in this
database (dbt recreates the serving tables, which drops their policies).
Without the roles it is a no-op.
"""
import os
import subprocess
import sys

from ingest.db import ROOT, get_database_url, pg_env_from_url

REAPPLY_AFTER = {"build", "run", "seed"}


def reapply_rls(url: str) -> None:
    import psycopg

    from ingest.api_sql import apply, role_exists

    with psycopg.connect(url, connect_timeout=15, autocommit=True) as conn:
        if not role_exists(conn, "api_login"):
            return
        exists = conn.execute("select to_regclass('serving.all_signals')").fetchone()[0]
        if exists:
            apply(conn, "rls")


def main() -> int:
    url = get_database_url()
    env = {**os.environ, **pg_env_from_url(url)}
    cmd = ["dbt", *sys.argv[1:], "--project-dir", "dbt", "--profiles-dir", "dbt"]
    code = subprocess.call(cmd, cwd=ROOT, env=env)
    if sys.argv[1:2] and sys.argv[1] in REAPPLY_AFTER:
        if code != 0:
            # A failed build can leave a serving table whose tests failed. Do not re-grant it:
            # the API stays closed (403 logged, /ready 503) until a build passes or
            # `api_sql rls` is run on purpose.
            print("dbt failed: serving RLS not re-applied; tables stay closed", file=sys.stderr)
            return code
        try:
            reapply_rls(url)
        except Exception as e:  # noqa: BLE001 - report it and fail the run
            print(f"ERROR: could not re-apply serving RLS: {type(e).__name__}", file=sys.stderr)
            return 3
    return code


if __name__ == "__main__":
    sys.exit(main())
