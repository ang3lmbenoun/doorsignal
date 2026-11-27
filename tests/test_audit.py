"""M7 pass criteria: a planted disparity is detected; the null scenario is not flagged."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from audit.harness import AuditConfig, audit, holm
from audit.scenarios import run_scenario

FAST = AuditConfig(n_perm=1500)
SEEDS = [1, 2, 3, 4, 5, 6]


def _flagged(res):
    return {r.outcome for r in res if r.flagged}


def test_planted_disparity_detected_in_every_seed():
    for seed in SEEDS:
        res = run_scenario(seed, planted_delay_factor=2.0, cfg=FAST)
        flagged = _flagged(res)
        assert "early_avg_ln_assign_hours" in flagged, (seed, [(r.outcome, r.effect, r.p_holm) for r in res])
        direct = next(r for r in res if r.outcome == "early_avg_ln_assign_hours")
        assert direct.effect > 0.2 and direct.stat_cmp > direct.stat_ref  # the planted group waits longer


def test_null_scenario_not_flagged():
    total = 0
    for seed in SEEDS:
        res = run_scenario(seed, planted_delay_factor=None, cfg=FAST)
        total += len(_flagged(res))
    assert total == 0, "null world produced a flag"


def test_downstream_effect_visible_on_the_ranker_when_planted():
    res = run_scenario(3, planted_delay_factor=3.0, cfg=FAST)
    risk = next(r for r in res if r.outcome == "s04_risk")
    assert risk.stat_cmp > risk.stat_ref  # the longer waits raise predicted non-renewal risk for that group


def test_false_positive_rate_on_pure_noise_is_near_alpha():
    rng = np.random.default_rng(0)
    hits = 0
    runs = 150
    for i in range(runs):
        df = pd.DataFrame({"x": rng.normal(size=300), "g": np.where(rng.random(300) < 0.4, "B", "A")})
        res = audit(df, "g", "A", "B", {"x": "continuous"}, AuditConfig(n_perm=300, seed=i, min_d=0.0))
        hits += res[0].flagged
    assert hits / runs < 0.10  # alpha is 0.05; allow slack for 150 runs


def test_small_groups_are_not_tested():
    df = pd.DataFrame({"x": range(40), "g": ["A"] * 35 + ["B"] * 5})
    r = audit(df, "g", "A", "B", {"x": "continuous"})[0]
    assert r.tested is False and r.flagged is False


def test_binary_four_fifths_rule():
    rng = np.random.default_rng(1)
    g = np.array(["A"] * 400 + ["B"] * 400)
    x = np.concatenate([rng.random(400) < 0.5, rng.random(400) < 0.3]).astype(float)  # ratio 0.6
    r = audit(pd.DataFrame({"x": x, "g": g}), "g", "A", "B", {"x": "binary"}, AuditConfig(n_perm=1500))[0]
    assert r.flagged and r.effect < 0.8


def test_holm_is_monotone_and_bounded():
    adj = holm([0.01, 0.04, 0.03])
    assert adj == pytest.approx([0.03, 0.06, 0.06])
