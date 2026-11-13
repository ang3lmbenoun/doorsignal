"""S04 renewal-risk model: logistic regression on observable early-lease features.

Features (all observable in a real PMS export, none are protected-class attributes):
  has_wo     1 if the lease had any request in the first 90 days
  delay      mean ln(assignment hours) of requests in the first 90 days, centered, 0 if no requests
  priority   1 if any urgent or emergency request in the first 90 days
  offer      (offered rent increase - portfolio mean) / 0.02, 0 when no offer has been made yet
"""
from __future__ import annotations

import numpy as np
import pandas as pd

OFFER_SCALE = 0.02
TERMS = ["intercept", "b_has_early_wo", "b_delay_ln_hours", "b_early_priority", "b_offer_z"]


def build_design(
    df: pd.DataFrame, center_delay: float | None = None, center_offer: float | None = None
):
    """Return X (n x 5 with intercept), y (1 = did not renew), and the centers used."""
    has_wo = df["early_wo_count"] > 0
    if center_delay is None:
        center_delay = float(df.loc[has_wo, "early_avg_ln_assign_hours"].mean())
    if center_offer is None:
        center_offer = float(df["offered_increase_pct"].mean())
    delay = np.where(has_wo, df["early_avg_ln_assign_hours"] - center_delay, 0.0)
    priority = df["early_has_priority"].astype(float).to_numpy()
    offer = ((df["offered_increase_pct"] - center_offer) / OFFER_SCALE).fillna(0.0).to_numpy()
    X = np.column_stack([np.ones(len(df)), has_wo.astype(float).to_numpy(), delay, priority, offer])
    y = (df["outcome"] == "moved_out").astype(float).to_numpy()
    return X, y, center_delay, center_offer


def fit_logistic(X: np.ndarray, y: np.ndarray, iters: int = 100, l2: float = 1e-6):
    """Newton-Raphson. Returns coefficients and standard errors."""
    beta = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ beta))
        W = p * (1 - p)
        grad = X.T @ (y - p) - l2 * beta
        H = X.T @ (X * W[:, None]) + l2 * np.eye(X.shape[1])
        step = np.linalg.solve(H, grad)
        beta = beta + step
        if np.max(np.abs(step)) < 1e-10:
            break
    p = 1 / (1 + np.exp(-X @ beta))
    cov = np.linalg.inv(X.T @ (X * (p * (1 - p))[:, None]) + l2 * np.eye(X.shape[1]))
    return beta, np.sqrt(np.diag(cov))


def features_from_raw(tables: dict[str, pd.DataFrame], window_days: int = 90) -> pd.DataFrame:
    """Rebuild the fct_leases feature columns from raw simulator tables (used by tests)."""
    leases, wo, ev = tables["sim_leases"], tables["sim_work_orders"], tables["sim_lease_events"]
    m = wo.merge(leases[["lease_id", "start_date"]], on="lease_id")
    m["day"] = pd.to_datetime(m["submitted_at"]).dt.date
    m = m[(m["day"] - m["start_date"]).apply(lambda d: d.days) < window_days].copy()
    m["delay_h"] = (m["assigned_at"] - m["submitted_at"]).dt.total_seconds() / 3600
    m["ln_h"] = np.log(m["delay_h"].clip(lower=0.05))
    g = m.groupby("lease_id").agg(
        early_wo_count=("work_order_id", "count"),
        early_avg_ln_assign_hours=("ln_h", "mean"),
        early_has_priority=("severity", lambda s: bool((s != "routine").any())),
    )
    offer = (
        ev[ev["event_type"] == "renewal_offer"].set_index("lease_id")["value_numeric"]
        .astype(float).rename("offered_increase_pct")
    )
    renewed = set(ev.loc[ev["event_type"] == "renewed", "lease_id"])
    moved = set(ev.loc[ev["event_type"] == "move_out", "lease_id"])
    out = leases[["lease_id"]].set_index("lease_id").join(g).join(offer)
    out["early_wo_count"] = out["early_wo_count"].fillna(0)
    out["early_has_priority"] = out["early_has_priority"].eq(True)
    out["outcome"] = [
        "renewed" if i in renewed else "moved_out" if i in moved else "open" for i in out.index
    ]
    return out.reset_index()
