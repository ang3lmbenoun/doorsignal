"""Apply the M5a API role and RLS SQL to a database.

    python -m ingest.api_sql roles   # 30_api_roles.sql (once per database)
    python -m ingest.api_sql rls     # 31_serving_rls.sql (after every dbt build)
    python -m ingest.api_sql all
    python -m ingest.api_sql password  # sets api_login's password from API_LOGIN_PASSWORD (never printed)

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


def target_url(url_env: str) -> str:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    url = os.environ.get(url_env, "").strip()
    if not url:
        raise ConfigError(f"{url_env} is not set (Neon branch URL, in .env or the environment).")
    main = os.environ.get("DATABASE_URL", "").strip()
    if main and url == main:
        raise ConfigError(f"{url_env} equals DATABASE_URL (main). Use a Neon branch URL.")
    return url


def role_exists(conn, name: str) -> bool:
    return conn.execute("select 1 from pg_roles where rolname = %s", (name,)).fetchone() is not None


def set_password(conn) -> None:
    from psycopg import sql

    password = os.environ.get("API_LOGIN_PASSWORD", "")
    if len(password) < 24:
        raise ConfigError("API_LOGIN_PASSWORD is not set or shorter than 24 characters.")
    conn.execute(sql.SQL("alter role api_login password {}").format(sql.Literal(password)))
    print("api_login password set")


def apply(conn, which: str) -> None:
    for key in (["roles", "rls"] if which == "all" else [which]):
        conn.execute((SQL_DIR / FILES[key]).read_text(encoding="utf-8"))
        print(f"applied {FILES[key]}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["roles", "rls", "all", "password"])
    ap.add_argument("--url-env", default="NEON_TEST_DATABASE_URL")
    args = ap.parse_args(argv)
    try:
        url = target_url(args.url_env)
    except ConfigError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    with psycopg.connect(url, connect_timeout=15, autocommit=True) as conn:
        if args.which == "password":
            set_password(conn)
        else:
            apply(conn, args.which)
    return 0


if __name__ == "__main__":
    sys.exit(main())
