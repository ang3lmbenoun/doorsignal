"""M4 backtest: out-of-time checks of the renewal model and the delinquency PD scorecard.

Run after `python -m ingest.run_dbt build`:   python -m risk.backtest
Writes docs/risk/calibration_table.csv and docs/risk/backtest.md. Nothing here is random, so the
same database and snapshot date give byte-identical files.

Renewal backtest
  Fit S04 on leases that ended before SPLIT, score leases that ended on or after SPLIT, compare with
  what actually happened and with the true renewal probability the simulator drew (ground_truth).
  Loss backtest: predicted expected loss versus realized loss on the same test leases.
Delinquency backtest
  Build the PD lookup on early lease-months, apply it to later lease-months, compare with observed
  late-fee rates. The two periods are separated by one label horizon so no label overlaps.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

from signals.s04_model import build_design, fit_logistic

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "risk"
SPLIT = pd.Timestamp("2025-07-01")
PD_TRAIN_END = pd.Timestamp("2025-06-30")
PD_TEST_START = pd.Timestamp("2025-09-30")
DAILY_RENT_DAYS = 30.4375  # same divisor as S07 and risk.expected_loss_by_lease


def auc(y: np.ndarray, score: np.ndarray) -> float:
    """Rank-based AUC (ties get average rank). Returns nan if only one class is present."""
    y = np.asarray(y, dtype=float)
    pos, neg = int((y == 1).sum()), int((y == 0).sum())
    if pos == 0 or neg == 0:
        return float("nan")
    ranks = pd.Series(score).rank(method="average").to_numpy()
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def _quantile_groups(p: np.ndarray, k: int) -> np.ndarray:
    """Deterministic equal-size groups 1..k by predicted probability (ties broken by position)."""
    order = np.argsort(p, kind="stable")
    g = np.empty(len(p), dtype=int)
    g[order] = np.floor(np.arange(len(p)) * k / len(p)).astype(int) + 1
    return g


def nonrenewal_backtest(leases: pd.DataFrame, split: pd.Timestamp = SPLIT, groups: int = 5) -> dict:
    """leases needs the fct_leases columns plus end_date, monthly_rent, turnover_cost, vacancy_days
    and (optional) true_p_nonrenew from ground_truth."""
    df = leases[leases["outcome"] != "open"].copy()
    df["end_date"] = pd.to_datetime(df["end_date"])
    train, test = df[df["end_date"] < split], df[df["end_date"] >= split]
    if len(train) < 50 or len(test) < 20 or (train["outcome"] == "moved_out").sum() == 0:
        raise ValueError(
            f"too few decided leases for a backtest: train={len(train)} test={len(test)}"
        )
    X, y, c_delay, c_offer = build_design(train)
    beta, _ = fit_logistic(X, y)
    Xt, yt, _, _ = build_design(test, center_delay=c_delay, center_offer=c_offer)
    p = 1 / (1 + np.exp(-Xt @ beta))
    base_rate = float(y.mean())

    sev_rows = train[train["outcome"] == "moved_out"]
    mean_cost = float(sev_rows["turnover_cost"].mean())
    mean_vac = float(sev_rows["vacancy_days"].mean())
    daily_rent = test["monthly_rent"].astype(float).to_numpy() / DAILY_RENT_DAYS
    loss_if = mean_cost + mean_vac * daily_rent
    predicted_loss = float((p * loss_if).sum())
    realized = np.where(
        yt == 1,
        test["turnover_cost"].fillna(0).astype(float).to_numpy()
        + test["vacancy_days"].fillna(0).astype(float).to_numpy() * daily_rent,
        0.0,
    )
    realized_loss = float(realized.sum())

    g = _quantile_groups(p, groups)
    calib = [
        {"model": "nonrenewal", "group": f"Q{k}", "n": int((g == k).sum()),
         "predicted": float(p[g == k].mean()), "observed": float(yt[g == k].mean())}
        for k in range(1, groups + 1)
    ]
    out = {
        "n_train": len(train), "n_test": len(test),
        "pred_mean": float(p.mean()), "obs_rate": float(yt.mean()), "train_rate": base_rate,
        "brier_model": brier(yt, p), "brier_baseline": brier(yt, np.full(len(yt), base_rate)),
        "auc": auc(yt, p),
        "predicted_loss": predicted_loss, "realized_loss": realized_loss,
        "loss_ratio": predicted_loss / realized_loss if realized_loss else float("nan"),
        "calibration": calib,
    }
    if "true_p_nonrenew" in test and test["true_p_nonrenew"].notna().all():
        t = test["true_p_nonrenew"].astype(float).to_numpy()
        out["mae_vs_true_p"] = float(np.mean(np.abs(p - t)))
        out["corr_vs_true_p"] = float(np.corrcoef(p, t)[0, 1])
        out["brier_oracle"] = brier(yt, t)
        out["auc_oracle"] = auc(yt, t)
    return out


def pd_backtest(panel: pd.DataFrame, train_end: pd.Timestamp = PD_TRAIN_END,
                test_start: pd.Timestamp = PD_TEST_START, min_n: int = 30) -> dict:
    """panel: obs_date, late_bucket, defaulted (the risk.delinquency_pd_panel columns)."""
    d = panel.copy()
    d["obs_date"] = pd.to_datetime(d["obs_date"])
    d["defaulted"] = d["defaulted"].astype(float)
    train, test = d[d["obs_date"] <= train_end], d[d["obs_date"] >= test_start]
    portfolio = float(train["defaulted"].mean())
    by = train.groupby("late_bucket")["defaulted"].agg(["count", "mean"])
    lookup = {b: (float(r["mean"]) if r["count"] >= min_n else portfolio) for b, r in by.iterrows()}
    p = test["late_bucket"].map(lookup).fillna(portfolio).to_numpy(dtype=float)
    y = test["defaulted"].to_numpy()
    calib = []
    for b in sorted(test["late_bucket"].unique()):
        m = (test["late_bucket"] == b).to_numpy()
        calib.append({"model": "delinquency_pd", "group": f"late_{b}", "n": int(m.sum()),
                      "predicted": float(p[m].mean()), "observed": float(y[m].mean())})
    return {
        "n_train": len(train), "n_test": len(test),
        "pred_mean": float(p.mean()), "obs_rate": float(y.mean()), "train_rate": portfolio,
        "brier_model": brier(y, p), "brier_baseline": brier(y, np.full(len(y), portfolio)),
        "auc": auc(y, p), "calibration": calib,
    }


def _fmt(x: float, nd: int = 4) -> str:
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.{nd}f}"


def calibration_frame(nr: dict, dq: dict) -> pd.DataFrame:
    rows = nr["calibration"] + dq["calibration"]
    out = pd.DataFrame(rows)
    out["gap"] = out["observed"] - out["predicted"]
    return out.round({"predicted": 4, "observed": 4, "gap": 4})


def render_markdown(nr: dict, dq: dict, calib: pd.DataFrame, as_of: str, digest: str) -> str:
    lines = [
        "# M4 backtest and calibration",
        "",
        f"Snapshot date: {as_of}. Data: simulator output (SYNTHETIC_CALIBRATED), evidence grade C.",
        f"Calibration table digest (sha256, first 12): `{digest}`.",
        "",
        "## Renewal model (S04), out of time",
        f"Fit on {nr['n_train']} decided leases that ended before {SPLIT.date()}; "
        f"scored {nr['n_test']} decided leases that ended on or after.",
        "",
        "| metric | value |",
        "|---|---|",
        f"| mean predicted P(non-renewal) | {_fmt(nr['pred_mean'])} |",
        f"| observed non-renewal rate | {_fmt(nr['obs_rate'])} |",
        f"| Brier, model | {_fmt(nr['brier_model'])} |",
        f"| Brier, constant base rate | {_fmt(nr['brier_baseline'])} |",
        f"| AUC, model | {_fmt(nr['auc'])} |",
    ]
    if "mae_vs_true_p" in nr:
        lines += [
            f"| AUC, true simulator probability (ceiling) | {_fmt(nr['auc_oracle'])} |",
            f"| Brier, true simulator probability (floor) | {_fmt(nr['brier_oracle'])} |",
            f"| mean abs error vs true probability | {_fmt(nr['mae_vs_true_p'])} |",
            f"| correlation with true probability | {_fmt(nr['corr_vs_true_p'])} |",
        ]
    lines += [
        f"| predicted expected loss, test leases | {nr['predicted_loss']:,.0f} |",
        f"| realized loss, test leases | {nr['realized_loss']:,.0f} |",
        f"| predicted / realized | {_fmt(nr['loss_ratio'], 3)} |",
        "",
        "## Delinquency PD scorecard, out of time",
        f"Lookup built on {dq['n_train']} lease-months through {PD_TRAIN_END.date()}; "
        f"tested on {dq['n_test']} lease-months from {PD_TEST_START.date()}.",
        "",
        "| metric | value |",
        "|---|---|",
        f"| mean predicted PD | {_fmt(dq['pred_mean'])} |",
        f"| observed late-fee rate | {_fmt(dq['obs_rate'])} |",
        f"| Brier, scorecard | {_fmt(dq['brier_model'])} |",
        f"| Brier, constant base rate | {_fmt(dq['brier_baseline'])} |",
        f"| AUC, scorecard | {_fmt(dq['auc'])} |",
        "",
        "## Calibration table",
        "",
        "| model | group | n | predicted | observed | gap |",
        "|---|---|---|---|---|---|",
    ]
    for r in calib.itertuples():
        lines.append(
            f"| {r.model} | {r.group} | {r.n} | {r.predicted:.4f} | {r.observed:.4f} "
            f"| {r.gap:+.4f} |"
        )
    lines += [
        "",
        "## Reading this",
        "- Q1 to Q5 are equal-size groups by predicted risk, lowest to highest. A calibrated "
        "model has predicted close to observed in every row.",
        "- The true-probability rows are the best any model could do on this synthetic data. "
        "Real data has no such ceiling.",
        "- Loss figures use turnover cost and vacancy days learned from the training leases, "
        "never from sim/config.yaml.",
        "- Small test sets are noisy. Treat gaps under about 0.05 in a group of 50 or fewer "
        "as noise.",
        "",
    ]
    return "\n".join(lines)


def load_from_db():
    """Return (leases frame, delinquency panel frame, as_of date string) from the database."""
    from ingest.db import connect

    sql_leases = """
        select f.lease_id, f.end_date, f.monthly_rent, f.outcome, f.early_wo_count,
               f.early_avg_ln_assign_hours, f.early_has_priority, f.offered_increase_pct,
               f.turnover_cost, f.vacancy_days, 1 - g.renewal_prob as true_p_nonrenew
        from marts.fct_leases f
        left join ground_truth.lease_outcomes g using (lease_id)
        where f.outcome <> 'open'
        order by f.lease_id"""
    sql_panel = (
        "select obs_date, lease_id, late_bucket, defaulted "
        "from risk.delinquency_pd_panel order by 1, 2"
    )
    sql_asof = "select max(computed_at)::date - 1 from risk.risk_loss_params"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql_leases)
        leases = pd.DataFrame(cur.fetchall(), columns=[c.name for c in cur.description])
        cur.execute(sql_panel)
        panel = pd.DataFrame(cur.fetchall(), columns=[c.name for c in cur.description])
        cur.execute(sql_asof)
        as_of = str(cur.fetchone()[0])
    for col in ["monthly_rent", "early_avg_ln_assign_hours", "offered_increase_pct",
                "turnover_cost", "vacancy_days", "true_p_nonrenew"]:
        leases[col] = pd.to_numeric(leases[col])
    leases["early_has_priority"] = leases["early_has_priority"].astype(bool)
    return leases, panel, as_of


def main() -> int:
    leases, panel, as_of = load_from_db()
    nr, dq = nonrenewal_backtest(leases), pd_backtest(panel)
    calib = calibration_frame(nr, dq)
    csv_text = calib.to_csv(index=False, lineterminator="\n")
    digest = hashlib.sha256(csv_text.encode()).hexdigest()[:12]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "calibration_table.csv").write_text(csv_text, newline="\n")
    report = render_markdown(nr, dq, calib, as_of, digest)
    (OUT_DIR / "backtest.md").write_text(report, newline="\n")
    print(f"wrote docs/risk/calibration_table.csv and backtest.md (digest {digest})")
    print(calib.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
