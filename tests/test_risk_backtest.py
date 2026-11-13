"""M4 tests: backtest math, and the renewal and PD backtests on simulator data with known truth."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from risk.backtest import auc, brier, calibration_frame, nonrenewal_backtest, pd_backtest
from signals.s04_model import features_from_raw
from sim.generate import generate, load_config


def test_auc_known_values():
    assert auc(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert auc(np.array([0, 0, 1, 1]), np.array([0.9, 0.8, 0.2, 0.1])) == 0.0
    assert auc(np.array([0, 1, 0, 1]), np.array([0.5, 0.5, 0.5, 0.5])) == 0.5
    assert np.isnan(auc(np.array([1, 1]), np.array([0.2, 0.3])))


def test_brier_known_value():
    assert brier(np.array([1, 0]), np.array([1.0, 0.0])) == 0.0
    assert brier(np.array([1, 0]), np.array([0.5, 0.5])) == pytest.approx(0.25)


def _lease_frame(seed: int) -> pd.DataFrame:
    tables, truth = generate(load_config(), seed=seed, hud_path=None)
    f = features_from_raw(tables)
    leases = tables["sim_leases"][["lease_id", "end_date", "monthly_rent"]]
    ev = tables["sim_lease_events"]
    def event(kind: str) -> pd.Series:
        return ev[ev["event_type"] == kind].set_index("lease_id")["value_numeric"].astype(float)

    cost, vac = event("turnover_cost"), event("vacancy_days")
    out = f.merge(leases, on="lease_id")
    out["turnover_cost"] = out["lease_id"].map(cost)
    out["vacancy_days"] = out["lease_id"].map(vac)
    gt = truth["lease_outcomes"].set_index("lease_id")["renewal_prob"].astype(float)
    out["true_p_nonrenew"] = 1 - out["lease_id"].map(gt)
    out["monthly_rent"] = out["monthly_rent"].astype(float)
    out["end_date"] = pd.to_datetime(out["end_date"])
    return out


@pytest.fixture(scope="module")
def results():
    return [nonrenewal_backtest(_lease_frame(s)) for s in (1, 2, 3)]


def test_renewal_model_beats_constant_and_tracks_truth(results):
    for r in results:
        assert r["brier_model"] < r["brier_baseline"]
        assert r["auc"] > 0.65
        assert r["corr_vs_true_p"] > 0.6
        assert r["brier_oracle"] <= r["brier_model"] + 0.01  # nothing beats the true probability


def test_predicted_loss_close_to_realized_loss(results):
    # Pooled across seeds; one dataset is a noisy draw.
    pred = sum(r["predicted_loss"] for r in results)
    real = sum(r["realized_loss"] for r in results)
    assert 0.85 < pred / real < 1.2


def test_backtest_is_deterministic():
    a = nonrenewal_backtest(_lease_frame(4))
    b = nonrenewal_backtest(_lease_frame(4))
    assert a == b


def _planted_panel(seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rates = {"0": 0.25, "1": 0.40, "2": 0.55, "3+": 0.70}
    rows = []
    for obs in pd.date_range("2023-06-30", "2026-06-30", freq="ME"):
        for b, r in rates.items():
            n = 200
            rows.append(pd.DataFrame({
                "obs_date": obs, "late_bucket": b, "defaulted": rng.random(n) < r}))
    return pd.concat(rows, ignore_index=True)


def test_pd_scorecard_recovers_planted_rates():
    res = pd_backtest(_planted_panel())
    planted = {"late_0": 0.25, "late_1": 0.40, "late_2": 0.55, "late_3+": 0.70}
    for row in res["calibration"]:
        assert abs(row["predicted"] - planted[row["group"]]) < 0.03
        assert abs(row["observed"] - planted[row["group"]]) < 0.03
    assert res["brier_model"] < res["brier_baseline"]
    assert res["auc"] > 0.6


def test_calibration_frame_has_gap_column():
    nr = nonrenewal_backtest(_lease_frame(5))
    dq = pd_backtest(_planted_panel(1))
    frame = calibration_frame(nr, dq)
    assert set(frame["model"]) == {"nonrenewal", "delinquency_pd"}
    assert np.allclose(frame["gap"], (frame["observed"] - frame["predicted"]).round(4), atol=1e-4)
