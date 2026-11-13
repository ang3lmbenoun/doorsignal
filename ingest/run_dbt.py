"""Run dbt with PG* variables derived from DATABASE_URL. Usage: python -m ingest.run_dbt build"""
import os
import subprocess
import sys

from ingest.db import ROOT, get_database_url, pg_env_from_url


def main() -> int:
    env = {**os.environ, **pg_env_from_url(get_database_url())}
    cmd = ["dbt", *sys.argv[1:], "--project-dir", "dbt", "--profiles-dir", "dbt"]
    return subprocess.call(cmd, cwd=ROOT, env=env)


if __name__ == "__main__":
    sys.exit(main())
