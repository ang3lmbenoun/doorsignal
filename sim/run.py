"""Generate the simulation to CSV files: python -m sim.run [--seed N] [--out sim/out]."""

from __future__ import annotations

import argparse
from pathlib import Path

from sim.checks import benchmark_report, fk_violations
from sim.generate import ROOT, generate, load_config


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=str(ROOT / "sim" / "out"))
    args = ap.parse_args()
    cfg = load_config()
    tables, truth = generate(cfg, seed=args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, df in {**tables, **{f"gt_{k}": v for k, v in truth.items()}}.items():
        df.to_csv(out / f"{name}.csv", index=False)
        print(f"{name:22s} {len(df):>8d} rows")
    print("FK violations:", fk_violations(tables) or "none")
    for name, got, target, tol, ok in benchmark_report(tables, cfg):
        print(f"{'OK ' if ok else 'OFF'} {name}: {got:.3f} (target {target} +/- {tol})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
