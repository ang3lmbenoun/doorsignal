"""Disparity tests on finished outputs. Pure numpy/pandas; no database.

A result is FLAGGED only when all three hold, so a big sample cannot flag a trivial gap and a small one cannot
flag noise: enough people in each group, an effect at least as large as the minimum, and a Holm-adjusted
permutation p-value below alpha. Thresholds are choices (assumption), set in AuditConfig.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class AuditConfig:
    alpha: float = 0.05            # assumption: conventional family-wise level
    min_group_n: int = 30          # assumption: below this a group is too small to test
    min_d: float = 0.20            # assumption: Cohen's "small" effect, continuous outcomes
    ratio_floor: float = 0.80      # four-fifths rule (EEOC Uniform Guidelines, 29 CFR 1607.4D), binary outcomes
    n_perm: int = 4000
    seed: int = 7


@dataclass
class Result:
    outcome: str
    kind: str                      # "continuous" or "binary"
    n_ref: int
    n_cmp: int
    stat_ref: float                # mean or rate
    stat_cmp: float
    effect: float                  # Cohen's d (cmp minus ref), or ratio of rates (cmp / ref)
    p_raw: float
    p_holm: float = float("nan")
    tested: bool = True
    flagged: bool = False


def _perm_p(x: np.ndarray, is_cmp: np.ndarray, stat, observed: float, n_perm: int, rng) -> float:
    n_cmp = int(is_cmp.sum())
    count = 0
    idx = np.arange(len(x))
    for _ in range(n_perm):
        pick = rng.choice(idx, size=n_cmp, replace=False)
        mask = np.zeros(len(x), dtype=bool)
        mask[pick] = True
        if abs(stat(x[mask], x[~mask])) >= abs(observed) - 1e-12:
            count += 1
    return (count + 1) / (n_perm + 1)


def _cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = len(a), len(b)
    sp = np.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    return 0.0 if sp == 0 else float((a.mean() - b.mean()) / sp)


def test_outcome(df: pd.DataFrame, outcome: str, group: str, ref: str, cmp_: str, kind: str, cfg: AuditConfig) -> Result:
    d = df[[outcome, group]].dropna()
    x = d[outcome].to_numpy(dtype=float)
    is_cmp = (d[group] == cmp_).to_numpy()
    is_ref = (d[group] == ref).to_numpy()
    n_ref, n_cmp = int(is_ref.sum()), int(is_cmp.sum())
    if min(n_ref, n_cmp) < cfg.min_group_n:
        return Result(outcome, kind, n_ref, n_cmp, float("nan"), float("nan"), float("nan"), 1.0, tested=False)
    sub = is_ref | is_cmp
    x, is_cmp = x[sub], is_cmp[sub]
    rng = np.random.default_rng(cfg.seed)
    if kind == "continuous":
        stat = _cohens_d
        observed = stat(x[is_cmp], x[~is_cmp])
        effect, s_cmp, s_ref = observed, float(x[is_cmp].mean()), float(x[~is_cmp].mean())
    else:
        s_cmp, s_ref = float(x[is_cmp].mean()), float(x[~is_cmp].mean())
        observed = s_cmp - s_ref
        effect = float("inf") if s_ref == 0 and s_cmp > 0 else (1.0 if s_ref == 0 else s_cmp / s_ref)

        def stat(a, b):  # difference in rates
            return float(a.mean() - b.mean())
    p = _perm_p(x, is_cmp, stat, observed, cfg.n_perm, rng)
    return Result(outcome, kind, n_ref, n_cmp, s_ref, s_cmp, float(effect), p)


def holm(ps: list[float]) -> list[float]:
    order = np.argsort(ps)
    m = len(ps)
    adj = np.empty(m)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * ps[i]))
        adj[i] = running
    return adj.tolist()


def audit(df: pd.DataFrame, group: str, ref: str, cmp_: str, outcomes: dict[str, str], cfg: AuditConfig | None = None) -> list[Result]:
    """outcomes: {column: "continuous" | "binary"}. Returns results with Holm-adjusted p and flags."""
    cfg = cfg or AuditConfig()
    res = [test_outcome(df, col, group, ref, cmp_, kind, cfg) for col, kind in outcomes.items()]
    tested = [r for r in res if r.tested]
    for r, adj in zip(tested, holm([r.p_raw for r in tested]), strict=True):
        r.p_holm = adj
        if r.kind == "continuous":
            big = abs(r.effect) >= cfg.min_d
        else:  # four-fifths rule on either direction of the rate ratio
            big = r.effect < cfg.ratio_floor or r.effect > 1 / cfg.ratio_floor
        r.flagged = bool(adj < cfg.alpha and big)
    return res
