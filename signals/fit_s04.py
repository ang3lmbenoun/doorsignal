"""Fit the S04 renewal-risk model on decided leases and write dbt/seeds/s04_coefficients.csv.

Run (after dbt has built the marts): python -m signals.fit_s04
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from ingest.db import connect
from signals.s04_model import TERMS, build_design, fit_logistic

SEED = Path(__file__).resolve().parents[1] / "dbt" / "seeds" / "s04_coefficients.csv"
QUERY = """
select lease_id, outcome, early_wo_count, early_avg_ln_assign_hours, early_has_priority,
       offered_increase_pct
from marts.fct_leases where outcome in ('renewed', 'moved_out')
"""


def main() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(QUERY)
        cols = [c.name for c in cur.description]
        df = pd.DataFrame(cur.fetchall(), columns=cols)
    for c in ["early_wo_count", "early_avg_ln_assign_hours", "offered_increase_pct"]:
        df[c] = df[c].astype(float)
    X, y, center_delay, center_offer = build_design(df)
    beta, se = fit_logistic(X, y)
    rows = [(t, float(b)) for t, b in zip(TERMS, beta, strict=True)]
    rows += [
        ("center_ln_delay", center_delay),
        ("center_offer_pct", center_offer),
        ("scale_offer_pct", 0.02),
        ("n_train", float(len(df))),
        ("n_moved_out", float(y.sum())),
    ]
    pd.DataFrame(rows, columns=["term", "value"]).round(6).to_csv(SEED, index=False)
    for (t, b), s in zip(rows[: len(TERMS)], se, strict=True):
        print(f"{t:20s} {b:8.3f}  (se {s:.3f})")
    print(f"trained on {len(df)} decided leases, {int(y.sum())} non-renewals -> {SEED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
