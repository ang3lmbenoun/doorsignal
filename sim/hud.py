"""Load HUD Small Area FMR (SAFMR) by ZIP and bedroom count from the HUD xlsx download.

File: https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs_revised.xlsx
Save it as data/reference/fy2026_safmrs_revised.xlsx. Column layout is matched by pattern because
HUD does not document it on the download page; the loader fails loudly if no match is found.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

BED_RE = re.compile(r"^\s*SAFMR\s*([0-4])\s*BR\s*$", re.IGNORECASE)
ZIP_RE = re.compile(r"zip", re.IGNORECASE)


def _to_number(value) -> float:
    return float(str(value).replace("$", "").replace(",", "").strip())


def _read_table(path: str | Path) -> tuple[pd.DataFrame, str, dict[int, str], str | None]:
    raw = pd.read_excel(path, header=None, dtype=str)
    header_row = None
    for idx in range(min(15, len(raw))):
        cells = [str(c) for c in raw.iloc[idx].tolist()]
        if any(ZIP_RE.search(c) for c in cells) and any(BED_RE.match(c) for c in cells):
            header_row = idx
            break
    if header_row is None:
        sample = [str(c) for c in raw.iloc[0].tolist()]
        raise ValueError(f"Could not find a header with ZIP and SAFMR nBR columns. Row 0: {sample}")
    cols = [str(c).strip() for c in raw.iloc[header_row].tolist()]
    df = raw.iloc[header_row + 1 :].copy()
    df.columns = cols
    zip_col = next(c for c in cols if ZIP_RE.search(c))
    bed_cols = {int(BED_RE.match(c).group(1)): c for c in cols if BED_RE.match(c)}
    area_col = next((c for c in cols if "area name" in c.lower()), None)
    return df, zip_col, bed_cols, area_col


def load_safmr_long(path: str | Path) -> pd.DataFrame:
    """One row per ZIP and bedroom count: zip, hud_area_name, bedrooms, safmr_rent."""
    df, zip_col, bed_cols, area_col = _read_table(path)
    rows = []
    for _, row in df.iterrows():
        zip_code = str(row[zip_col]).strip().split(".")[0].zfill(5)
        if not zip_code.isdigit():
            continue
        area = str(row[area_col]).replace("\n", " ").strip() if area_col else ""
        for beds, col in bed_cols.items():
            if pd.notna(row[col]):
                rows.append((zip_code, area, beds, _to_number(row[col])))
    return pd.DataFrame(rows, columns=["zip", "hud_area_name", "bedrooms", "safmr_rent"])


def load_safmr(path: str | Path) -> dict[str, dict[int, float]]:
    long = load_safmr_long(path)
    out: dict[str, dict[int, float]] = {}
    for z, b, r in zip(long["zip"], long["bedrooms"], long["safmr_rent"], strict=True):
        out.setdefault(z, {})[int(b)] = float(r)
    return out
