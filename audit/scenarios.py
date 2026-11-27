"""Audit scenarios on simulator output: a null world and a world with a planted disparity.

Group labels are assigned AFTER generation, independently of every simulated trait (seeded, SYNTHETIC). In the
planted scenario one group's repair requests wait longer for assignment, injected into the raw timestamps
before the signals and the S04 model are built, so the audit has to find a disparity that flows downstream.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from audit.harness import AuditConfig, Result, audit
from signals.s04_model import build_design, features_from_raw, fit_logistic
from sim.generate import generate, load_config

REF, CMP = "G1", "G2"
OUTCOMES = {
    "early_avg_ln_assign_hours": "continuous",   # S02-style delay, first 90 days
    "s04_risk": "continuous",                    # S04 predicted non-renewal probability
    "s04_high_risk": "binary",                   # top decile of S04 risk (the "renewal ranker" shortlist)
    "moved_out": "binary",                       # observed outcome on closed leases
}


def assign_groups(tenant_ids: pd.Series, seed: int, share_cmp: float = 0.4) -> pd.Series:
    rng = np.random.default_rng(seed + 10_000)
    return pd.Series(np.where(rng.random(len(tenant_ids)) < share_cmp, CMP, REF), index=tenant_ids.index)


def run_scenario(seed: int, planted_delay_factor: float | None = None, cfg: AuditConfig | None = None) -> list[Result]:
    """planted_delay_factor: multiply assignment wait for CMP-group tenants (None = null world)."""
    tables, _ = generate(load_config(), seed=seed, hud_path=None)
    tenants = tables["sim_tenants"].copy()
    tenants["grp"] = assign_groups(tenants["tenant_id"], seed).to_numpy()
    if planted_delay_factor is not None:
        wo = tables["sim_work_orders"].copy()
        hit = wo["tenant_id"].map(tenants.set_index("tenant_id")["grp"]) == CMP
        wait = wo.loc[hit, "assigned_at"] - wo.loc[hit, "submitted_at"]
        wo.loc[hit, "assigned_at"] = wo.loc[hit, "submitted_at"] + wait * planted_delay_factor
        tables["sim_work_orders"] = wo
    f = features_from_raw(tables)
    closed = f[f["outcome"] != "open"]
    X, y, cd, co = build_design(closed)
    beta, _ = fit_logistic(X, y)
    Xall, _, _, _ = build_design(f, center_delay=cd, center_offer=co)
    f = f.copy()
    f["s04_risk"] = 1 / (1 + np.exp(-Xall @ beta))
    f["s04_high_risk"] = (f["s04_risk"] >= f["s04_risk"].quantile(0.9)).astype(float)
    f["moved_out"] = np.where(f["outcome"] == "open", np.nan, (f["outcome"] == "moved_out").astype(float))
    lease_tenant = tables["sim_leases"].set_index("lease_id")["tenant_id"]
    f["grp"] = f["lease_id"].map(lease_tenant).map(tenants.set_index("tenant_id")["grp"])
    f.loc[f["early_wo_count"] == 0, "early_avg_ln_assign_hours"] = np.nan
    return audit(f, "grp", REF, CMP, OUTCOMES, cfg)
