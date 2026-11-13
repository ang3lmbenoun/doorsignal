"""Integrity and benchmark checks shared by tests, the CLI and the loader."""

from __future__ import annotations

from datetime import timedelta

import pandas as pd

# (child table, child column, parent table, parent column)
FOREIGN_KEYS = [
    ("sim_properties", "owner_id", "sim_owners", "owner_id"),
    ("sim_units", "property_id", "sim_properties", "property_id"),
    ("sim_leases", "unit_id", "sim_units", "unit_id"),
    ("sim_leases", "tenant_id", "sim_tenants", "tenant_id"),
    ("sim_leases", "prior_lease_id", "sim_leases", "lease_id"),
    ("sim_lease_events", "lease_id", "sim_leases", "lease_id"),
    ("sim_work_orders", "unit_id", "sim_units", "unit_id"),
    ("sim_work_orders", "lease_id", "sim_leases", "lease_id"),
    ("sim_work_orders", "tenant_id", "sim_tenants", "tenant_id"),
    ("sim_work_orders", "vendor_id", "sim_vendors", "vendor_id"),
    ("sim_ledger_entries", "lease_id", "sim_leases", "lease_id"),
]


def fk_violations(tables: dict[str, pd.DataFrame]) -> dict[str, int]:
    bad = {}
    for child, ccol, parent, pcol in FOREIGN_KEYS:
        vals = tables[child][ccol].dropna()
        missing = (~vals.isin(set(tables[parent][pcol]))).sum()
        if missing:
            bad[f"{child}.{ccol}->{parent}.{pcol}"] = int(missing)
    return bad


def benchmark_summary(tables: dict[str, pd.DataFrame], cfg: dict) -> dict[str, float]:
    wo = tables["sim_work_orders"]
    done = wo.dropna(subset=["completed_at"])
    repair_days = float(
        ((done["completed_at"] - done["submitted_at"]).dt.total_seconds() / 86400).mean()
    )
    satisfaction = float(wo["satisfaction"].dropna().mean())

    leases = tables["sim_leases"].copy()
    sim_start, sim_end = cfg["calendar"]["sim_start"], cfg["calendar"]["sim_end"]
    window = cfg["renewal"]["early_window_days"]["value"]
    full = leases[
        (leases["start_date"] >= sim_start)
        & (leases["start_date"] + timedelta(days=window) <= sim_end)
    ]
    wo2 = wo.merge(leases[["lease_id", "start_date"]], on="lease_id")
    wo2["day"] = pd.to_datetime(wo2["submitted_at"]).dt.date
    early = wo2[(wo2["day"] - wo2["start_date"]).apply(lambda d: d.days) < window]
    with_req = set(early["lease_id"])
    zero_share = float((~full["lease_id"].isin(with_req)).mean())
    return {
        "repair_days": repair_days,
        "satisfaction": satisfaction,
        "zero_request_share_first90": zero_share,
    }


def benchmark_report(tables, cfg) -> list[tuple[str, float, float, float, bool]]:
    got = benchmark_summary(tables, cfg)
    rows = []
    for name, spec in cfg["benchmark_checks"].items():
        ok = abs(got[name] - spec["target"]) <= spec["tolerance"]
        rows.append((name, got[name], spec["target"], spec["tolerance"], ok))
    return rows
