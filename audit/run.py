"""python -m audit.run  -> writes docs/fair_housing_audit.md (null world and planted-disparity world, several seeds)."""
from __future__ import annotations

from pathlib import Path

from audit.harness import AuditConfig
from audit.narrate import narrate
from audit.scenarios import run_scenario

SEEDS = [1, 2, 3, 4, 5, 6]
OUT = Path(__file__).resolve().parents[1] / "docs" / "fair_housing_audit.md"


def main() -> int:
    cfg = AuditConfig()
    lines = [
        "# Fair-housing audit harness (M7)", "",
        "Synthetic group labels (G1 reference, G2 comparison, about 40% of tenants) are assigned after the simulator runs and are never an input to any signal or model.",
        "Flag rule: at least 30 per group, effect at least |d| 0.20 (continuous) or outside the four-fifths band 0.80 to 1.25 (binary), and Holm-adjusted permutation p below 0.05. These thresholds are assumptions.", "",
    ]
    for title, factor in [("Null world (no disparity planted)", None), ("Planted: G2 repair requests wait 2.0x longer for assignment", 2.0)]:
        lines += [f"## {title}", "", "| seed | outcome | G1 | G2 | effect | Holm p | flagged |", "|---|---|---|---|---|---|---|"]
        n_flags = 0
        for seed in SEEDS:
            for r in run_scenario(seed, planted_delay_factor=factor, cfg=cfg):
                n_flags += r.flagged
                lines.append(f"| {seed} | {r.outcome} | {r.stat_ref:.3f} | {r.stat_cmp:.3f} | {r.effect:.3f} | {r.p_holm:.4f} | {'YES' if r.flagged else 'no'} |")
        lines += ["", f"Flags across {len(SEEDS)} seeds: **{n_flags}**", ""]
        lines += [f"Narration, seed {SEEDS[0]}:", "", "```", narrate(run_scenario(SEEDS[0], planted_delay_factor=factor, cfg=cfg)), "```", ""]
    lines += ["Reading: effect is Cohen's d for continuous outcomes and the G2/G1 rate ratio for binary ones. A flag is a prompt for human review, not a finding of discrimination."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
