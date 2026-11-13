"""M3 known-truth test: S04 must recover the renewal effects planted in the simulator.

One dataset is a single noisy draw, so recovery is judged across several seeds: every planted
effect must have the right sign in each pooled estimate and the seed-average must sit near the
planted value. Planted values are on the renewal log-odds scale; the model predicts
non-renewal, so the expected coefficient is the negated planted value.
"""
from __future__ import annotations

import numpy as np
import pytest

from signals.s04_model import build_design, features_from_raw, fit_logistic
from sim.generate import generate, load_config

SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]


@pytest.fixture(scope="module")
def estimates():
    cfg = load_config()
    out = []
    for seed in SEEDS:
        tables, _ = generate(cfg, seed=seed, hud_path=None)
        f = features_from_raw(tables)
        f = f[f["outcome"] != "open"]
        X, y, _, _ = build_design(f)
        beta, se = fit_logistic(X, y)
        out.append((beta, se))
    return np.array([b for b, _ in out]), np.array([s for _, s in out])


def test_planted_renewal_effects_recovered(estimates):
    betas, _ = estimates
    rn = load_config()["renewal"]
    # columns: intercept, has_wo, delay, priority, offer
    planted = {
        2: -rn["b_assign_delay_z"]["value"] / rn["delay_ref_sigma"]["value"],
        3: -rn["b_early_priority"]["value"],
        4: -rn["b_rent_gap_z"]["value"],
    }
    mean = betas.mean(axis=0)
    for col, truth in planted.items():
        assert mean[col] > 0, f"wrong sign for term {col}"
        gap = abs(mean[col] - truth)
        assert gap < 0.2, f"term {col}: mean {mean[col]:.2f} vs planted {truth:.2f}"


def test_effect_standard_errors_are_usable(estimates):
    _, ses = estimates
    assert ses[:, 2:].max() < 0.35


def test_null_feature_is_not_flagged():
    """Control: with outcomes shuffled the fitted effects must be small."""
    tables, _ = generate(load_config(), seed=11, hud_path=None)
    f = features_from_raw(tables)
    f = f[f["outcome"] != "open"].copy()
    rng = np.random.default_rng(0)
    f["outcome"] = rng.permutation(f["outcome"].to_numpy())
    X, y, _, _ = build_design(f)
    beta, se = fit_logistic(X, y)
    assert (np.abs(beta[2:] / se[2:]) < 3.5).all()
