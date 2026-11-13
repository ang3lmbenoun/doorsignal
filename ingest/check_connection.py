"""M0 check: can we reach Neon? Usage: python -m ingest.check_connection [--skip-if-unset]"""
import sys

from ingest.db import ConfigError, connect, get_database_url


def main() -> int:
    skip_if_unset = "--skip-if-unset" in sys.argv
    try:
        get_database_url()
    except ConfigError as exc:
        if skip_if_unset:
            print(f"SKIPPED: {exc}")
            return 0
        print(f"FAIL: {exc}")
        return 1
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("select current_database(), current_user, version()")
            db, user, version = cur.fetchone()
            print(f"OK: connected to {db} as {user}")
            print(version)
    except Exception as exc:  # report any connection failure plainly
        print(f"FAIL: {type(exc).__name__}: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
