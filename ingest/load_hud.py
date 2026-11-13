"""Load HUD Small Area FMR (Texas ZIPs) into raw.ref_hud_safmr. Evidence grade A (real public data).

Run: python -m ingest.load_hud [path-to-xlsx]
"""
from __future__ import annotations

import sys
from pathlib import Path

from ingest.db import connect
from sim.generate import HUD_PATH
from sim.hud import load_safmr_long

SQL_FILE = Path(__file__).parent / "sql" / "20_raw_ref.sql"
FISCAL_YEAR = 2026


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HUD_PATH
    if not path.exists():
        raise SystemExit(f"HUD file not found: {path}")
    long = load_safmr_long(path)
    long = long[long["hud_area_name"].str.contains(", TX", regex=False)]
    long = long.drop_duplicates(["zip", "bedrooms"])
    rows = [(z, a, int(b), float(r), FISCAL_YEAR) for z, a, b, r in long.itertuples(index=False)]
    with connect() as conn, conn.cursor() as cur:
        cur.execute(SQL_FILE.read_text(encoding="utf-8"))
        cur.execute("TRUNCATE raw.ref_hud_safmr")
        with cur.copy(
            "COPY raw.ref_hud_safmr (zip, hud_area_name, bedrooms, safmr_rent, fiscal_year) "
            "FROM STDIN"
        ) as cp:
            for row in rows:
                cp.write_row(row)
        cur.execute(
            "INSERT INTO ops.load_log (source, seed, table_name, row_count) "
            "VALUES ('hud_safmr_fy2026', NULL, 'raw.ref_hud_safmr', %s)",
            (len(rows),),
        )
        conn.commit()
    print(f"loaded raw.ref_hud_safmr {len(rows)} rows ({long['zip'].nunique()} Texas ZIPs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
