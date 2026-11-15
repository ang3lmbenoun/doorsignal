"""Create the layer schemas in Neon. Safe to rerun.

Usage: python -m ingest.init_db [--with-ref-tables]

--with-ref-tables also creates the (empty) raw.ref_hud_safmr and ops.load_log tables, for databases
that never loaded the HUD file (CI). The staging models read raw.ref_hud_safmr, and rents then fall
back to the simulator.
"""
import sys
from pathlib import Path

from ingest.db import ConfigError, connect

SQL_FILE = Path(__file__).parent / "sql" / "00_schemas.sql"
EXPECTED = {"raw", "staging", "intermediate", "marts", "signals", "risk", "ops", "ground_truth"}


def main() -> int:
    with_ref = "--with-ref-tables" in sys.argv[1:]
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(SQL_FILE.read_text())
            if with_ref:
                ref_sql = Path(__file__).parent / "sql" / "20_raw_ref.sql"
                cur.execute(ref_sql.read_text(encoding="utf-8"))
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
