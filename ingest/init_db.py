"""Create the layer schemas in Neon. Safe to rerun. Usage: python -m ingest.init_db"""
import sys
from pathlib import Path

from ingest.db import ConfigError, connect

SQL_FILE = Path(__file__).parent / "sql" / "00_schemas.sql"
EXPECTED = {"raw", "staging", "intermediate", "marts", "signals", "risk", "ops", "ground_truth"}


def main() -> int:
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(SQL_FILE.read_text())
            cur.execute(
                "select schema_name from information_schema.schemata where schema_name = any(%s)",
                (sorted(EXPECTED),),
            )
            found = {row[0] for row in cur.fetchall()}
            conn.commit()
    except ConfigError as exc:
        print(f"FAIL: {exc}")
        return 1
    missing = EXPECTED - found
    if missing:
        print(f"FAIL: missing schemas {sorted(missing)}")
        return 1
    print(f"OK: schemas present: {sorted(found)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
