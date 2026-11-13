"""DoorSignal simulator v0: seeded, deterministic synthetic property-management data.

Observable tables go to raw.sim_*; hidden truth (traits, true renewal probabilities, planted
effects) goes to ground_truth.* and is never exposed to the API, agents or BI.
Every parameter lives in sim/config.yaml with a stated basis.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).with_name("config.yaml")
HUD_PATH = ROOT / "data" / "reference" / "fy2026_safmrs_revised.xlsx"
TERM_DAYS = 365


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _at(d: date, rng: np.random.Generator) -> datetime:
    return datetime(d.year, d.month, d.day) + timedelta(seconds=int(rng.integers(0, 86400)))


def build_rent_table(cfg: dict, hud_path: Path | None) -> tuple[dict, str]:
    """Base rent by ZIP and bedrooms: HUD SAFMR if the file is present, else labeled placeholder."""
    placeholder = cfg["market"]["placeholder_base_rent_by_beds"]["value"]
    ratio = cfg["market"]["market_to_safmr_ratio"]["value"]
    hud: dict = {}
    if hud_path is not None and Path(hud_path).exists():
        from sim.hud import load_safmr

        hud = load_safmr(hud_path)
    table: dict = {}
    from_hud = True
    for item in cfg["zips"]["items"]:
        z = item["zip"]
        table[z] = {}
        for beds in range(5):
            if z in hud and beds in hud[z]:
                table[z][beds] = hud[z][beds] * ratio
            else:
                table[z][beds] = placeholder[beds] * item["rent_multiplier"]
                from_hud = False
    return table, ("HUD_SAFMR" if from_hud else "PLACEHOLDER_ASSUMPTION")


def generate(cfg: dict | None = None, seed: int | None = None, hud_path: Path | None = HUD_PATH):
    cfg = cfg or load_config()
    seed = cfg["seed"] if seed is None else seed
    rng = np.random.default_rng(seed)

    sim_start: date = cfg["calendar"]["sim_start"]
    sim_end: date = cfg["calendar"]["sim_end"]
    sim_end_dt = datetime(sim_end.year, sim_end.month, sim_end.day, 23, 59, 59)

    pf = cfg["portfolio"]
    mk = cfg["market"]
    lc = cfg["leases"]
    wo = cfg["work_orders"]
    rn = cfg["renewal"]
    py = cfg["payments"]
    tv = cfg["turnover"]
    vc = cfg["vacancy"]
    rent_table, rent_basis = build_rent_table(cfg, hud_path)

    # ---- owners, vendors ----
    owners = [
        {
            "owner_id": f"O{i + 1:02d}",
            "owner_name": f"Owner {i + 1:02d}",
            "mgmt_fee_pct": float(rng.choice(pf["mgmt_fee_pct_options"]["value"])),
            "spend_limit": int(rng.choice(pf["owner_spend_limits"]["value"])),
        }
        for i in range(pf["n_owners"]["value"])
    ]
    n_vendors = pf["n_vendors"]["value"]
    speed = rng.lognormal(0.0, wo["vendor_speed_sd"]["value"], n_vendors)
    planted = wo["planted_slow_vendor"]["value"]
    vendors, vendor_truth = [], []
    for i in range(n_vendors):
        vid = f"V{i + 1:02d}"
        is_planted = vid == planted["vendor_id"]
        factor = float(planted["speed_factor"]) if is_planted else float(speed[i])
        vendors.append({"vendor_id": vid, "vendor_name": f"Vendor {i + 1:02d}"})
        vendor_truth.append({"vendor_id": vid, "speed_factor": factor, "planted": is_planted})
    vendor_speed = {v["vendor_id"]: v["speed_factor"] for v in vendor_truth}
    vendor_ids = [v["vendor_id"] for v in vendors]

    # ---- properties and units ----
    zips = cfg["zips"]["items"]
    zip_w = np.array([z["weight"] for z in zips], dtype=float)
    zip_w /= zip_w.sum()
    ptypes = list(pf["property_types"].keys())
    type_w = np.array([pf["property_types"][t]["share"] for t in ptypes], dtype=float)
    type_w /= type_w.sum()
    yb_lo, yb_hi = pf["year_built_range"]["value"]
    sqft = pf["sqft_by_beds"]["value"]

    properties, units = [], []
    for p in range(pf["n_properties"]["value"]):
        pid = f"P{p + 1:03d}"
        ptype = ptypes[int(rng.choice(len(ptypes), p=type_w))]
        spec = pf["property_types"][ptype]
        zi = zips[int(rng.choice(len(zips), p=zip_w))]
        n_units = int(rng.integers(spec["units"][0], spec["units"][1] + 1))
        year_built = int(rng.integers(yb_lo, yb_hi + 1))
        properties.append(
            {
                "property_id": pid,
                "owner_id": owners[int(rng.integers(0, len(owners)))]["owner_id"],
                "property_type": ptype,
                "zip": zi["zip"],
                "area_label": zi["area_label"],
                "year_built": year_built,
                "n_units": n_units,
            }
        )
        bed_keys = [int(k) for k in spec["beds"].keys()]
        bed_w = np.array(list(spec["beds"].values()), dtype=float)
        bed_w /= bed_w.sum()
        for u in range(n_units):
            beds = int(rng.choice(bed_keys, p=bed_w))
            units.append(
                {
                    "unit_id": f"U{len(units) + 1:04d}",
                    "property_id": pid,
                    "unit_number": f"{u + 1:03d}",
                    "beds": beds,
                    "sqft": int(sqft[beds] * rng.uniform(0.9, 1.1)),
                    "_unit_effect": float(rng.normal(0, mk["unit_rent_noise_sd"]["value"])),
                    "_zip": zi["zip"],
                    "_year_built": year_built,
                }
            )

    def market_rent(zip_code: str, beds: int, d: date) -> float:
        years = (d - sim_start).days / 365.0
        return rent_table[zip_code][beds] * (1 + mk["annual_drift"]["value"]) ** years

    # ---- seasonality (hvac), normalised to mean 1 ----
    peak = set(wo["hvac_peak_months"]["value"])
    pm = wo["hvac_peak_multiplier"]["value"]
    raw_season = {m: (pm if m in peak else 1.0) for m in range(1, 13)}
    norm = sum(raw_season.values()) / 12.0
    season = {m: v / norm for m, v in raw_season.items()}
    cats = list(wo["category_weights"]["value"].keys())
    cat_w = np.array([wo["category_weights"]["value"][c] for c in cats], dtype=float)
    cat_w /= cat_w.sum()
    cat_probs: dict[int, np.ndarray] = {}
    cat_mass: dict[int, float] = {}
    for m in range(1, 13):
        w = cat_w.copy()
        w[cats.index("hvac")] *= season[m]
        cat_mass[m] = float(w.sum())
        cat_probs[m] = w / w.sum()
    sev_names = ["routine", "urgent", "emergency"]

    tenants, tenant_truth = [], []
    leases, events, work_orders, ledger = [], [], [], []
    lease_truth = []
    wo_seq = [0]
    ledger_seq = [0]
    event_seq = [0]

    def new_tenant(first_seen: date) -> str:
        tid = f"T{len(tenants) + 1:05d}"
        a, b = cfg["tenants"]["reliability_beta"]["value"]
        tenants.append({"tenant_id": tid, "first_seen_date": first_seen})
        tenant_truth.append(
            {
                "tenant_id": tid,
                "reliability": float(rng.beta(a, b)),
                "price_sensitivity": float(rng.normal(0, 1)),
            }
        )
        return tid

    def add_event(lease_id, d, etype, value=None):
        event_seq[0] += 1
        events.append(
            {
                "event_id": f"E{event_seq[0]:06d}",
                "lease_id": lease_id,
                "event_date": d,
                "event_type": etype,
                "value_numeric": value,
            }
        )

    def simulate_work_orders(lease_id, unit, tenant_id, start, end):
        """Work orders for one lease inside the sim window; returns early-window observables."""
        early_delays, early_priority = [], False
        d0 = start
        last = min(end, sim_end)
        while d0 < last:
            d1 = min(d0 + timedelta(days=30), last)
            days = (d1 - d0).days
            age = d0.year - unit["_year_built"]
            lam = (
                wo["rate_per_unit_month"]["value"]
                * (1 + wo["age_slope_per_year"]["value"] * (age - 30))
                * (days / 30.4375)
                * cat_mass[d0.month]
            )
            n = int(rng.poisson(max(lam, 0.0)))
            for _ in range(n):
                cat = cats[int(rng.choice(len(cats), p=cat_probs[d0.month]))]
                sev = sev_names[int(rng.choice(3, p=wo["severity_probs"]["value"][cat]))]
                sub_day = d0 + timedelta(days=int(rng.integers(0, max(days, 1))))
                submitted = _at(sub_day, rng)
                delay_h = float(
                    rng.lognormal(
                        math.log(
                            wo["assign_delay_median_hours"]["value"]
                            * wo["assign_severity_multiplier"]["value"][sev]
                        ),
                        wo["assign_delay_sigma"]["value"],
                    )
                )
                assigned = submitted + timedelta(hours=delay_h)
                vendor = vendor_ids[int(rng.integers(0, len(vendor_ids)))]
                comp_days = float(
                    rng.lognormal(
                        math.log(wo["completion_median_days"]["value"][sev] * vendor_speed[vendor]),
                        wo["completion_sigma"]["value"],
                    )
                )
                completed = assigned + timedelta(days=comp_days)
                cost = float(
                    rng.lognormal(
                        math.log(wo["cost_median_by_category"]["value"][cat]),
                        wo["cost_sigma"]["value"],
                    )
                )
                if sev == "emergency":
                    cost *= wo["emergency_cost_multiplier"]["value"]
                notice = (
                    "written" if rng.random() < wo["written_notice_share"]["value"] else "verbal"
                )
                total_days = (completed - submitted).total_seconds() / 86400.0
                sat = None
                if rng.random() < wo["survey_response_rate"]["value"]:
                    s = (
                        wo["satisfaction_intercept"]["value"]
                        - wo["satisfaction_slope_per_day"]["value"] * total_days
                        + rng.normal(0, wo["satisfaction_noise_sd"]["value"])
                    )
                    sat = int(min(5, max(1, round(s))))
                is_early = (sub_day - start).days < rn["early_window_days"]["value"]
                if is_early:
                    early_delays.append(math.log(max(delay_h, 0.05)))
                    early_priority = early_priority or sev != "routine"
                row_assigned = assigned if assigned <= sim_end_dt else None
                row_completed = completed if completed <= sim_end_dt else None
                wo_seq[0] += 1
                work_orders.append(
                    {
                        "work_order_id": f"W{wo_seq[0]:06d}",
                        "unit_id": unit["unit_id"],
                        "lease_id": lease_id,
                        "tenant_id": tenant_id,
                        "category": cat,
                        "severity": sev,
                        "notice_type": notice,
                        "submitted_at": submitted,
                        "assigned_at": row_assigned,
                        "vendor_id": vendor if row_assigned else None,
                        "completed_at": row_completed,
                        "cost": round(cost, 2) if row_completed else None,
                        "satisfaction": sat if row_completed else None,
                        "status": "completed" if row_completed else "open",
                    }
                )
            d0 = d1
        return early_delays, early_priority

    def simulate_ledger(lease_id, tenant_rel, rent, start, end):
        grace = py["grace_days"]["value"]
        pending_catchup = None
        for i in range(12):
            due = start + timedelta(days=30 * i)
            if due > sim_end or due >= end:
                break

            def add(d, etype, amt):
                ledger_seq[0] += 1
                ledger.append(
                    {
                        "entry_id": f"G{ledger_seq[0]:07d}",
                        "lease_id": lease_id,
                        "entry_date": d,
                        "entry_type": etype,
                        "amount": round(amt, 2),
                    }
                )

            add(due, "charge_rent", rent)
            miss = py["p_miss_base"]["value"] + py["p_miss_slope"]["value"] * (1 - tenant_rel) ** 2
            late = min(0.9, py["p_late_slope"]["value"] * (1 - tenant_rel))
            u = rng.random()
            if u < miss:
                if rng.random() < py["catchup_prob"]["value"]:
                    pending_catchup = (due + timedelta(days=int(rng.integers(10, 26))), rent)
            elif u < miss + late:
                pay_day = due + timedelta(days=int(rng.integers(grace + 1, 21)))
                add(due + timedelta(days=grace + 1), "late_fee", rent * py["late_fee_pct"]["value"])
                if pay_day <= sim_end:
                    add(pay_day, "payment", -rent)
            else:
                pay_day = due + timedelta(days=int(rng.integers(0, grace + 1)))
                if pay_day <= sim_end:
                    add(pay_day, "payment", -rent)
            if pending_catchup and pending_catchup[0] <= sim_end and u >= miss:
                add(pending_catchup[0], "payment", -pending_catchup[1])
                pending_catchup = None
        if pending_catchup and pending_catchup[0] <= sim_end:
            ledger_seq[0] += 1
            ledger.append(
                {
                    "entry_id": f"G{ledger_seq[0]:07d}",
                    "lease_id": lease_id,
                    "entry_date": pending_catchup[0],
                    "entry_type": "payment",
                    "amount": -round(pending_catchup[1], 2),
                }
            )

    # ---- lease chains per unit ----
    lease_seq = 0
    for unit in units:
        start = sim_start + timedelta(days=int(rng.integers(0, 366)))  # staggered onboarding
        tenant_id = new_tenant(start)
        prior = None
        rent = (
            market_rent(unit["_zip"], unit["beds"], start)
            * (1 + unit["_unit_effect"])
            * (1 + rng.normal(0, mk["new_lease_noise_sd"]["value"]))
        )
        while start <= sim_end:
            lease_seq += 1
            lease_id = f"L{lease_seq:05d}"
            end = start + timedelta(days=TERM_DAYS)
            tt = tenant_truth[int(tenant_id[1:]) - 1]
            leases.append(
                {
                    "lease_id": lease_id,
                    "unit_id": unit["unit_id"],
                    "tenant_id": tenant_id,
                    "start_date": start,
                    "end_date": end,
                    "monthly_rent": round(rent, 2),
                    "prior_lease_id": prior,
                    "status": "ended" if end <= sim_end else "active",
                }
            )
            delays, early_pri = simulate_work_orders(lease_id, unit, tenant_id, start, end)
            simulate_ledger(lease_id, tt["reliability"], rent, start, end)

            gap = market_rent(unit["_zip"], unit["beds"], end) / rent - 1.0
            pct = float(
                np.clip(
                    rng.normal(
                        lc["offered_increase_mean"]["value"] + 0.5 * gap,
                        lc["offered_increase_sd"]["value"],
                    ),
                    0.0,
                    lc["offered_increase_max"]["value"],
                )
            )
            offer_date = end - timedelta(days=lc["renewal_offer_lead_days"]["value"])
            if offer_date <= sim_end:
                add_event(lease_id, offer_date, "renewal_offer", round(pct, 4))
            if end > sim_end:
                lease_truth.append(
                    {
                        "lease_id": lease_id,
                        "renewal_prob": None,
                        "renewed": None,
                        "delay_z": None,
                        "early_priority": None,
                        "offered_increase_z": None,
                        "censored": True,
                    }
                )
                break

            delay_z = (
                (float(np.mean(delays)) - rn["delay_ref_mu"]["value"])
                / rn["delay_ref_sigma"]["value"]
                if delays
                else 0.0
            )
            inc_z = (pct - lc["offered_increase_mean"]["value"]) / lc["offered_increase_sd"][
                "value"
            ]
            logit = (
                rn["baseline_logit"]["value"]
                + rn["b_assign_delay_z"]["value"] * delay_z
                + rn["b_early_priority"]["value"] * (1.0 if early_pri else 0.0)
                + rn["b_rent_gap_z"]["value"] * inc_z
                + rn["b_price_sensitivity"]["value"] * tt["price_sensitivity"]
            )
            p_renew = _sigmoid(logit)
            renewed = bool(rng.random() < p_renew)
            lease_truth.append(
                {
                    "lease_id": lease_id,
                    "renewal_prob": p_renew,
                    "renewed": renewed,
                    "delay_z": delay_z,
                    "early_priority": early_pri,
                    "offered_increase_z": inc_z,
                    "censored": False,
                }
            )
            if renewed:
                add_event(lease_id, end, "renewed", round(pct, 4))
                prior = lease_id
                start = end
                rent = rent * (1 + pct)
            else:
                add_event(lease_id, end, "move_out", None)
                cost = float(
                    np.clip(
                        rng.lognormal(
                            math.log(tv["cost_median"]["value"]), tv["cost_sigma"]["value"]
                        ),
                        tv["cost_min"]["value"],
                        tv["cost_max"]["value"],
                    )
                )
                vac = int(
                    max(
                        1,
                        round(
                            rng.lognormal(
                                math.log(vc["median_days"]["value"]), vc["sigma"]["value"]
                            )
                        ),
                    )
                )
                add_event(lease_id, end, "turnover_cost", round(cost, 2))
                add_event(lease_id, end, "vacancy_days", float(vac))
                prior = None
                start = end + timedelta(days=vac)
                if start > sim_end:
                    break
                tenant_id = new_tenant(start)
                rent = (
                    market_rent(unit["_zip"], unit["beds"], start)
                    * (1 + unit["_unit_effect"])
                    * (1 + rng.normal(0, mk["new_lease_noise_sd"]["value"]))
                )

    unit_cols = ["unit_id", "property_id", "unit_number", "beds", "sqft"]
    tables = {
        "sim_owners": pd.DataFrame(owners),
        "sim_properties": pd.DataFrame(properties),
        "sim_units": pd.DataFrame(units)[unit_cols],
        "sim_vendors": pd.DataFrame(vendors),
        "sim_tenants": pd.DataFrame(tenants),
        "sim_leases": pd.DataFrame(leases),
        "sim_lease_events": pd.DataFrame(events),
        "sim_work_orders": pd.DataFrame(work_orders).astype({"satisfaction": "Int64"}),
        "sim_ledger_entries": pd.DataFrame(ledger),
    }
    truth = {
        "tenant_traits": pd.DataFrame(tenant_truth),
        "lease_outcomes": pd.DataFrame(lease_truth),
        "vendor_speed": pd.DataFrame(vendor_truth),
        "params": pd.DataFrame(
            [
                {"key": "seed", "value": str(seed)},
                {"key": "rent_basis", "value": rent_basis},
                {
                    "key": "renewal_coefficients",
                    "value": str({k: v["value"] for k, v in rn.items()}),
                },
                {"key": "planted_slow_vendor", "value": str(planted)},
            ]
        ),
    }
    return tables, truth
