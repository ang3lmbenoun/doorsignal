"""Committed risk evidence carries aggregates only: no lease ids or per-lease truth."""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs" / "risk"


def test_committed_outputs_have_no_lease_level_rows():
    files = list(DOCS.glob("*"))
    assert files, "docs/risk should contain the generated evidence"
    for f in files:
        assert not re.search(r"\bL\d{4,}\b", f.read_text()), f"lease id found in {f.name}"
