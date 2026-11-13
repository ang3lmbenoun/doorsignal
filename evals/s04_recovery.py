"""Print S04 coefficient recovery across seeds: python -m evals.s04_recovery [n_seeds]"""
from __future__ import annotations

import sys

import numpy as np

from signals.s04_model import build_design, features_from_raw, fit_logistic
from sim.generate import generate, load_config


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    cfg = load_config()
    rn = cfg["renewal"]
    truth = [
        None,
        None,
        -rn["b_assign_delay_z"]["value"],
        -rn["b_early_priority"]["value"],
        -rn["b_rent_gap_z"]["value"],
    ]
    names = ["intercept", "has_early_wo", "delay_ln_hours", "early_priority", "offer_z"]
    est = []
    for seed in range(1, n + 1):
        f = features_from_raw(generate(cfg, seed=seed, hud_path=None)[0])
        f = f[f["outcome"] != "open"]
        X, y, _, _ = build_design(f)
        est.append(fit_logistic(X, y)[0])
    est = np.array(est)
    print(f"S04 recovery over {n} seeds (non-renewal scale)")
    print(f"{'term':16s} {'planted':>8s} {'mean':>7s} {'sd':>6s} {'min':>6s} {'max':>6s}")
    for i, name in enumerate(names):
        t = "-" if truth[i] is None else f"{truth[i]:.2f}"
        print(f"{name:16s} {t:>8s} {est[:, i].mean():7.2f} {est[:, i].std():6.2f} "
              f"{est[:, i].min():6.2f} {est[:, i].max():6.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
