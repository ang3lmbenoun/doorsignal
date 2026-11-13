"""M1 pass criteria: identical seeded runs, FK integrity, recoverable planted effects."""

from __future__ import annotations

from datetime import timedelta

import pandas as pd
import pytest

from sim.checks import benchmark_report, fk_violations
from sim.generate import generate, load_config


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture(scope="module")
def run(cfg):
    return generate(cfg, seed=cfg["seed"], hud_path=None)


def test_same_seed_identical(cfg, run):
    tables2, truth2 = generate(cfg, seed=cfg["seed"], hud_path=None)
    tables1, truth1 = run
    for name in tables1:
        pd.testing.assert_frame_equal(tables1[name], tables2[name])
    for name in truth1:
        pd.testing.assert_frame_equal(truth1[name], truth2[name])


def test_different_seed_differs(cfg, run):
    other, _ = generate(cfg, seed=cfg["seed"] + 1, hud_path=None)
    assert len(other["sim_work_orders"]) != len(run[0]["sim_work_orders"])


def test_foreign_keys_clean(run):
    assert fk_violations(run[0]) == {}


def test_primary_keys_unique(run):
    keys = {
        "sim_leases": "lease_id",
        "sim_work_orders": "work_order_id",
        "sim_ledger_entries": "entry_id",
        "sim_lease_events": "event_id",
    }
    for table, key in keys.items():
        assert run[0][table][key].is_unique


def test_benchmarks_within_tolerance(cfg, run):
    failed = [r for r in benchmark_report(run[0], cfg) if not r[4]]
    assert failed == []


def test_no_protected_class_columns(run):
    banned = {
        "race",
        "ethnicity",
        "religion",
        "sex",
        "gender",
        "national_origin",
        "familial_status",
        "household_size",
        "disability",
        "age",
    }
    for df in run[0].values():
        assert banned.isdisjoint(c.lower() for c in df.columns)


def test_planted_slow_vendor_recoverable(cfg, run):
    wo = run[0]["sim_work_orders"].dropna(subset=["completed_at", "vendor_id"])
    days = (wo["completed_at"] - wo["assigned_at"]).dt.total_seconds() / 86400
    mean_by_vendor = days.groupby(wo["vendor_id"]).mean()
    assert (
        mean_by_vendor.idxmax() == cfg["work_orders"]["planted_slow_vendor"]["value"]["vendor_id"]
    )


def test_planted_delay_effect_recoverable_from_raw(cfg, run):
    """Using only raw observables, slower early assignment predicts lower renewal."""
    tables, _ = run
    wo, leases, events = tables["sim_work_orders"], tables["sim_leases"], tables["sim_lease_events"]
    window = cfg["renewal"]["early_window_days"]["value"]
    m = wo.merge(leases[["lease_id", "start_date"]], on="lease_id").dropna(subset=["assigned_at"])
    m["early"] = (pd.to_datetime(m["submitted_at"]).dt.date - m["start_date"]).apply(
        lambda d: d.days
    ) < window
    m = m[m["early"]]
    m["delay_h"] = (m["assigned_at"] - m["submitted_at"]).dt.total_seconds() / 3600
    per_lease = m.groupby("lease_id")["delay_h"].mean().rename("avg_delay_h")
    outcome = events[events["event_type"].isin(["renewed", "move_out"])].copy()
    outcome["renewed"] = outcome["event_type"] == "renewed"
    df = outcome.set_index("lease_id")[["renewed"]].join(per_lease, how="inner")
    assert len(df) > 300
    df["tercile"] = pd.qcut(df["avg_delay_h"], 3, labels=["fast", "mid", "slow"])
    rate = df.groupby("tercile", observed=True)["renewed"].mean()
    assert rate["fast"] - rate["slow"] > 0.03


def test_leases_do_not_overlap_per_unit(run):
    lease = run[0]["sim_leases"].sort_values(["unit_id", "start_date"])
    nxt = lease.groupby("unit_id")["start_date"].shift(-1)
    gap = (nxt - lease["end_date"]).dropna()
    assert (gap >= timedelta(days=0)).all()
