"""Apply the M5a API role and RLS SQL to a database.

    python -m ingest.api_sql roles   # 30_api_roles.sql (once per database)
    python -m ingest.api_sql rls     # 31_serving_rls.sql (after every dbt build)
    python -m ingest.api_sql all
    python -m ingest.api_sql password  # api_login password from API_LOGIN_PASSWORD (never printed)

The target URL is read from the env var named by --url-env (default NEON_TEST_DATABASE_URL).
The command refuses to run if that URL equals DATABASE_URL (the main Neon database): roles are
created on a branch first.
"""
import argparse
import os
import sys

import psycopg

from ingest.db import ROOT, ConfigError

SQL_DIR = ROOT / "ingest" / "sql"
FILES = {"roles": "30_api_roles.sql", "rls": "31_serving_rls.sql"}
OPS_FILES = ["32_ops_approvals.sql", "33_ops_rls.sql"]
PASSWORD_ENV = {"api_login": "API_LOGIN_PASSWORD", "api_agent_writer": "AGENT_WRITER_PASSWORD"}


def _host(url: str) -> str:
    """Host without Neon's pooler suffix, so pooled and direct URLs compare equal."""
    from urllib.parse import urlparse

    return (urlparse(url).hostname or "").replace("-pooler", "")


def target_url(url_env: str) -> str:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    url = os.environ.get(url_env, "").strip()
    if not url:
        raise ConfigError(f"{url_env} is not set (Neon branch URL, in .env or the environment).")
    main = os.environ.get("DATABASE_URL", "").strip()
    if main and _host(url) == _host(main):
        raise ConfigError(f"{url_env} has the same host as DATABASE_URL (main). Use a branch.")
    return url


def role_exists(conn, name: str) -> bool:
    return conn.execute("select 1 from pg_roles where rolname = %s", (name,)).fetchone() is not None


def set_password(conn, role: str = "api_login") -> None:
    from psycopg import sql

    if role not in PASSWORD_ENV:
        raise ConfigError(f"No password variable is defined for role {role}.")
    var = PASSWORD_ENV[role]
    password = os.environ.get(var, "")
    if len(password) < 24:
        raise ConfigError(f"{var} is not set or shorter than 24 characters.")
    stmt = sql.SQL("alter role {} password {}").format(sql.Identifier(role), sql.Literal(password))
    conn.execute(stmt)
    print(f"{role} password set")


def apply(conn, which: str) -> None:
    keys = {"all": ["roles", "rls", "ops"]}.get(which, [which])
    for key in keys:
        for name in (OPS_FILES if key == "ops" else [FILES[key]]):
            conn.execute((SQL_DIR / name).read_text(encoding="utf-8"))
            print(f"applied {name}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["roles", "rls", "ops", "all", "password"])
    ap.add_argument("--url-env", default="NEON_TEST_DATABASE_URL")
    ap.add_argument("--role", default="api_login", help="role for the password command")
    args = ap.parse_args(argv)
    try:
        url = target_url(args.url_env)
    except ConfigError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    with psycopg.connect(url, connect_timeout=15, autocommit=True) as conn:
        if args.which == "password":
            set_password(conn, args.role)
        else:
            apply(conn, args.which)
    return 0


if __name__ == "__main__":
    sys.exit(main())
