"""Export the serving layer to CSV for Tableau Public: python -m ingest.export_extracts [--out extracts].

Reads with the DATABASE_URL login (the owner), writes one CSV per serving table plus MANIFEST.md with row counts
and the source tag. Run it against a database built with real HUD rents to get real-rent extracts; without the
HUD file rents fall back to placeholders (assumption) and the manifest says so. SYNTHETIC_CALIBRATED data only:
never export a real portfolio this way (CLAUDE.md rule 3 and the API's row-level security do not travel with a CSV).
"""
from __future__ import annotations

import argparse
import csv
from datetime import date
from pathlib import Path

import psycopg

from ingest.db import ROOT, get_database_url

TABLES = ["all_signals", "expected_loss_by_lease", "risk_register", "stress_summary", "work_orders", "leases"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "extracts"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = ["# Tableau extracts", "", f"Generated {date.today()} by `python -m ingest.export_extracts`.",
                "Source tag: SYNTHETIC_CALIBRATED (rents REAL_PUBLIC only if the HUD file was loaded).", "",
                "| file | rows |", "|---|---|"]
    with psycopg.connect(get_database_url(), connect_timeout=15) as conn:
        hud = conn.execute("select count(*) from raw.ref_hud_safmr").fetchone()[0]
        for t in TABLES:
            cur = conn.execute(f"select * from serving.{t}")  # fixed list above, not user input
            rows = cur.fetchall()
            with (out / f"{t}.csv").open("w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow([c.name for c in cur.description])
                w.writerows(rows)
            manifest.append(f"| {t}.csv | {len(rows)} |")
    manifest += ["", f"HUD rent rows loaded in the source database: {hud}"
                 + (" (real SAFMR rents)." if hud else " (NONE: rents are placeholders, an assumption).")]
    (out / "MANIFEST.md").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    print(f"wrote {len(TABLES)} files to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
