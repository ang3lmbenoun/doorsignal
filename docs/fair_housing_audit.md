# Fair-housing audit harness (M7)

Synthetic group labels (G1 reference, G2 comparison, about 40% of tenants) are assigned after the simulator runs and are never an input to any signal or model.
Flag rule: at least 30 per group, effect at least |d| 0.20 (continuous) or outside the four-fifths band 0.80 to 1.25 (binary), and Holm-adjusted permutation p below 0.05. These thresholds are assumptions.

## Null world (no disparity planted)

| seed | outcome | G1 | G2 | effect | Holm p | flagged |
|---|---|---|---|---|---|---|
| 1 | early_avg_ln_assign_hours | 2.327 | 2.411 | 0.091 | 0.7218 | no |
| 1 | s04_risk | 0.545 | 0.557 | 0.054 | 0.9553 | no |
| 1 | s04_high_risk | 0.095 | 0.108 | 1.146 | 0.9553 | no |
| 1 | moved_out | 0.546 | 0.555 | 1.016 | 0.9553 | no |
| 2 | early_avg_ln_assign_hours | 2.340 | 2.383 | 0.049 | 1.0000 | no |
| 2 | s04_risk | 0.543 | 0.545 | 0.012 | 1.0000 | no |
| 2 | s04_high_risk | 0.102 | 0.097 | 0.947 | 1.0000 | no |
| 2 | moved_out | 0.539 | 0.546 | 1.013 | 1.0000 | no |
| 3 | early_avg_ln_assign_hours | 2.291 | 2.417 | 0.139 | 0.2559 | no |
| 3 | s04_risk | 0.514 | 0.534 | 0.083 | 0.4439 | no |
| 3 | s04_high_risk | 0.093 | 0.112 | 1.211 | 0.5724 | no |
| 3 | moved_out | 0.533 | 0.499 | 0.936 | 0.5724 | no |
| 4 | early_avg_ln_assign_hours | 2.361 | 2.344 | -0.019 | 1.0000 | no |
| 4 | s04_risk | 0.556 | 0.546 | -0.042 | 1.0000 | no |
| 4 | s04_high_risk | 0.093 | 0.112 | 1.211 | 1.0000 | no |
| 4 | moved_out | 0.538 | 0.567 | 1.054 | 1.0000 | no |
| 5 | early_avg_ln_assign_hours | 2.388 | 2.278 | -0.123 | 0.2889 | no |
| 5 | s04_risk | 0.535 | 0.546 | 0.054 | 0.6278 | no |
| 5 | s04_high_risk | 0.104 | 0.095 | 0.910 | 0.6278 | no |
| 5 | moved_out | 0.519 | 0.566 | 1.090 | 0.4281 | no |
| 6 | early_avg_ln_assign_hours | 2.314 | 2.297 | -0.019 | 0.8828 | no |
| 6 | s04_risk | 0.559 | 0.530 | -0.129 | 0.0450 | no |
| 6 | s04_high_risk | 0.106 | 0.093 | 0.873 | 0.8828 | no |
| 6 | moved_out | 0.564 | 0.514 | 0.911 | 0.3022 | no |

Flags across 6 seeds: **0**

Narration, seed 1:

```
No outcome was flagged (4 tested).
- how long repair requests waited for assignment in the first 90 days: 0.09 standard deviations higher for G2; adjusted p 0.722; no flag.
- the predicted chance of not renewing (S04): 0.05 standard deviations higher for G2; adjusted p 0.955; no flag.
- the share placed on the high renewal-risk shortlist: G2 at 10.8% against G1 at 9.5% (ratio 1.15); adjusted p 0.955; no flag.
- the observed move-out rate: G2 at 55.5% against G1 at 54.6% (ratio 1.02); adjusted p 0.955; no flag.

No flag does not rule out a disparity: groups this small can hide a modest gap.
```

## Planted: G2 repair requests wait 2.0x longer for assignment

| seed | outcome | G1 | G2 | effect | Holm p | flagged |
|---|---|---|---|---|---|---|
| 1 | early_avg_ln_assign_hours | 2.327 | 3.104 | 0.845 | 0.0010 | YES |
| 1 | s04_risk | 0.531 | 0.577 | 0.195 | 0.0030 | no |
| 1 | s04_high_risk | 0.089 | 0.117 | 1.313 | 0.1955 | no |
| 1 | moved_out | 0.546 | 0.555 | 1.016 | 0.8013 | no |
| 2 | early_avg_ln_assign_hours | 2.340 | 3.076 | 0.831 | 0.0010 | YES |
| 2 | s04_risk | 0.533 | 0.558 | 0.116 | 0.1432 | no |
| 2 | s04_high_risk | 0.099 | 0.101 | 1.018 | 1.0000 | no |
| 2 | moved_out | 0.539 | 0.546 | 1.013 | 1.0000 | no |
| 3 | early_avg_ln_assign_hours | 2.291 | 3.111 | 0.902 | 0.0010 | YES |
| 3 | s04_risk | 0.509 | 0.542 | 0.142 | 0.0352 | no |
| 3 | s04_high_risk | 0.089 | 0.119 | 1.332 | 0.2039 | no |
| 3 | moved_out | 0.533 | 0.499 | 0.936 | 0.3172 | no |
| 4 | early_avg_ln_assign_hours | 2.361 | 3.037 | 0.755 | 0.0010 | YES |
| 4 | s04_risk | 0.543 | 0.564 | 0.094 | 0.2467 | no |
| 4 | s04_high_risk | 0.089 | 0.118 | 1.325 | 0.2467 | no |
| 4 | moved_out | 0.538 | 0.567 | 1.054 | 0.3914 | no |
| 5 | early_avg_ln_assign_hours | 2.388 | 2.971 | 0.646 | 0.0010 | YES |
| 5 | s04_risk | 0.524 | 0.563 | 0.183 | 0.0022 | no |
| 5 | s04_high_risk | 0.099 | 0.103 | 1.045 | 0.7896 | no |
| 5 | moved_out | 0.519 | 0.566 | 1.090 | 0.2854 | no |
| 6 | early_avg_ln_assign_hours | 2.314 | 2.990 | 0.742 | 0.0010 | YES |
| 6 | s04_risk | 0.543 | 0.553 | 0.041 | 0.8938 | no |
| 6 | s04_high_risk | 0.099 | 0.102 | 1.029 | 0.8938 | no |
| 6 | moved_out | 0.564 | 0.514 | 0.911 | 0.3022 | no |

Flags across 6 seeds: **6**

Narration, seed 1:

```
1 of 4 outcomes were flagged for review.
- how long repair requests waited for assignment in the first 90 days: 0.84 standard deviations higher for G2; adjusted p 0.001; FLAGGED for human review.
- the predicted chance of not renewing (S04): 0.19 standard deviations higher for G2; adjusted p 0.003; no flag.
- the share placed on the high renewal-risk shortlist: G2 at 11.7% against G1 at 8.9% (ratio 1.31); adjusted p 0.195; no flag.
- the observed move-out rate: G2 at 55.5% against G1 at 54.6% (ratio 1.02); adjusted p 0.801; no flag.

A flag means the gap is larger than chance and larger than the minimum effect size. It does not say why, and it is not a legal finding. Look at the inputs behind the flagged outcome before changing anything.
```

Reading: effect is Cohen's d for continuous outcomes and the G2/G1 rate ratio for binary ones. A flag is a prompt for human review, not a finding of discrimination.
