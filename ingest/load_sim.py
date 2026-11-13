"""Generate the simulation and load it into Neon (idempotent: truncate then reload).

Run: python -m ingest.load_sim [--seed N]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from ingest.db import connect
from sim.checks import FOREIGN_KEYS, benchmark_report, fk_violations
from sim.generate import generate, load_config

SQL_FILE = Path(__file__).parent / "sql" / "10_raw_sim.sql"
TRUTH_TABLES = ["tenant_traits", "lease_outcomes", "vendor_speed", "params"]


def _rows(df: pd.DataFrame) -> list[list]:
    return df.astype(object).where(df.notna(), None).values.tolist()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    cfg = load_config()
    seed = cfg["seed"] if args.seed is None else args.seed
    tables, truth = generate(cfg, seed=seed)

    bad = fk_violations(tables)
    if bad:
        raise SystemExit(f"Refusing to load, FK violations in generated data: {bad}")
    report = benchmark_report(tables, cfg)
    for name, got, target, tol, ok in report:
        print(f"{'OK ' if ok else 'OFF'} benchmark {name}: {got:.3f} (target {target} +/- {tol})")

    targets = [(f"raw.{n}", df) for n, df in tables.items()]
    targets += [(f"ground_truth.{n}", truth[n]) for n in TRUTH_TABLES]

    with connect() as conn, conn.cursor() as cur:
        cur.execute(SQL_FILE.read_text(encoding="utf-8"))
        cur.execute("TRUNCATE " + ", ".join(t for t, _ in targets))
        for target, df in targets:
            cols = ", ".join(df.columns)
            with cur.copy(f"COPY {target} ({cols}) FROM STDIN") as cp:
                for row in _rows(df):
                    cp.write_row(row)
            cur.execute(f"SELECT count(*) FROM {target}")
            n = cur.fetchone()[0]
            if n != len(df):
                raise SystemExit(f"Row count mismatch for {target}: {n} != {len(df)}")
            cur.execute(
                "INSERT INTO ops.load_log (source, seed, table_name, row_count) "
                "VALUES (%s, %s, %s, %s)",
                ("simulator", seed, target, n),
            )
            print(f"loaded {target:34s} {n:>8d}")
        for child, ccol, parent, pcol in FOREIGN_KEYS:
            cur.execute(
                f"SELECT count(*) FROM raw.{child} c WHERE c.{ccol} IS NOT NULL "
                f"AND NOT EXISTS (SELECT 1 FROM raw.{parent} p WHERE p.{pcol} = c.{ccol})"
            )
            orphans = cur.fetchone()[0]
            if orphans:
                raise SystemExit(f"FK check failed in Neon: {child}.{ccol} has {orphans} orphans")
        conn.commit()
    print("Load complete, FK checks clean in Neon.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
