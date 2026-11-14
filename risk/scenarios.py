"""M4 scenario run: print and save portfolio expected loss under each stress scenario.

Run after `python -m ingest.run_dbt build`:   python -m risk.scenarios
Reads risk.stress_summary (built by dbt from the risk_scenarios seed) and writes
docs/risk/scenario_run.md. Deterministic: the snapshot date comes from the dbt var, never the clock.
"""
from __future__ import annotations

import hashlib

from risk.backtest import OUT_DIR


def render(rows: list[tuple], as_of: str, params: tuple, digest: str) -> str:
    n_moved, cost, vac, lgd = params
    lines = [
        "# M4 stress scenario run",
        "",
        f"Snapshot date: {as_of}. Evidence grade C (synthetic calibrated). "
        f"Digest (sha256, first 12): `{digest}`.",
        f"Loss parameters learned from data: mean turnover cost {cost:,.0f}, "
        f"mean vacancy days {vac:.1f}, LGD {lgd:.3f} (from {n_moved} move-outs).",
        "",
        "| scenario | what changes | leases | non-renewal EL | delinquency EL | total EL "
        "| vs base |",
        "|---|---|---|---|---|---|---|",
    ]
    for sid, desc, n, nr, dq, tot, delta, pct in rows:
        lines.append(
            f"| {sid} | {desc} | {n} | {nr:,.0f} | {dq:,.0f} | {tot:,.0f} "
            f"| {delta:+,.0f} ({pct:+.1f}%) |"
        )
    lines += [
        "",
        "Scenario knobs live in `dbt/seeds/risk_scenarios.csv`. The stress values are "
        "assumptions, not forecasts. Non-renewal EL covers only leases within 120 days of "
        "expiry (the S04 scope); delinquency EL is over the next 90 days.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    from ingest.db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """select scenario_id, description, n_leases, el_nonrenewal, el_delinquency,
                      el_total, delta_vs_base, pct_vs_base
               from risk.stress_summary
               order by case scenario_id when 'base' then 0 else 1 end, el_total, scenario_id"""
        )
        rows = [tuple(float(v) if hasattr(v, "quantize") else v for v in r) for r in cur.fetchall()]
        cur.execute(
            "select n_moved_out, mean_turnover_cost, mean_vacancy_days, lgd, computed_at::date - 1 "
            "from risk.risk_loss_params"
        )
        n_moved, cost, vac, lgd, as_of = cur.fetchone()
    digest = hashlib.sha256(repr(rows).encode()).hexdigest()[:12]
    text = render(rows, str(as_of), (n_moved, float(cost), float(vac), float(lgd)), digest)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "scenario_run.md").write_text(text, newline="\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
