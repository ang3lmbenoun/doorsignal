"""Plain-language narration of audit results. Deterministic template (no model): every number comes from the
Result objects, and the wording never states a legal conclusion. A flag is a prompt for human review.
An LLM narrator is not built; if added it must pass the same guard (see FORBIDDEN and check_text)."""
from __future__ import annotations

import re

from audit.harness import Result

FORBIDDEN = re.compile(r"discriminat|violat|illegal|unlawful|liab|intent|biased|racis|prove", re.I)
LABELS = {
    "early_avg_ln_assign_hours": "how long repair requests waited for assignment in the first 90 days",
    "s04_risk": "the predicted chance of not renewing (S04)",
    "s04_high_risk": "the share placed on the high renewal-risk shortlist",
    "moved_out": "the observed move-out rate",
}


def _one(r: Result, ref: str, cmp_: str) -> str:
    what = LABELS.get(r.outcome, r.outcome)
    if not r.tested:
        return f"- {what}: not tested, a group had fewer than 30 people ({ref} {r.n_ref}, {cmp_} {r.n_cmp})."
    if r.kind == "continuous":
        move = "higher" if r.effect > 0 else "lower"
        size = f"{abs(r.effect):.2f} standard deviations {move} for {cmp_}"
    else:
        size = f"{cmp_} at {r.stat_cmp:.1%} against {ref} at {r.stat_ref:.1%} (ratio {r.effect:.2f})"
    verdict = "FLAGGED for human review" if r.flagged else "no flag"
    return f"- {what}: {size}; adjusted p {r.p_holm:.3f}; {verdict}."


def narrate(results: list[Result], ref: str = "G1", cmp_: str = "G2") -> str:
    flagged = [r for r in results if r.flagged]
    head = (f"{len(flagged)} of {len(results)} outcomes were flagged for review."
            if flagged else f"No outcome was flagged ({len(results)} tested).")
    tail = ("A flag means the gap is larger than chance and larger than the minimum effect size. It does not say why, "
            "and it is not a legal finding. Look at the inputs behind the flagged "
            "outcome before changing anything." if flagged else
            "No flag does not rule out a disparity: groups this small can hide a modest gap.")
    text = "\n".join([head, *(_one(r, ref, cmp_) for r in results), "", tail])
    check_text(text)
    return text


def check_text(text: str) -> None:
    bad = FORBIDDEN.search(text)
    if bad:
        raise ValueError(f"narration contains a forbidden word: {bad.group(0)}")
