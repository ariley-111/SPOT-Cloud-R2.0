"""Regression: a blank/variant `medium` must not break stock-sheet matching.

Real bug (2026-06-18): the RFQ parser left `medium` empty on CADs that specify
no medium. `build_board_spec` used `dict.get("medium", "None")`, which only
defaults on an ABSENT key — a parsed "" / null slipped through. Stock matching
compares the stocked sheet's md=="None", so an empty medium matched nothing,
forcing a custom mill order + spurious Buy-Min warning. User had to manually
re-select "None" to get "In stock".
"""
from __future__ import annotations
import pytest
from engine import run_estimate
from engine.runner import _canon_medium, _canon_field


def _spec(medium):
    return {
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kla-White",
        "medium": medium, "oneUpW": "36.8543", "oneUpL": "75.9882",
        "qtys": ["500", "", "", "", ""], "quoteMode": "One-Up",
        "printReq": "No", "buyMinBoard": "Auto",
    }


@pytest.mark.parametrize("medium", ["None", "", None, "none", "NONE", "kraft", "  ", "n/a"])
def test_blank_or_variant_medium_resolves_in_stock(medium):
    r = run_estimate(_spec(medium))
    assert r.get("stockMode") is True, f"medium={medium!r} should match a stock sheet"
    assert r.get("buyMinActive") is False, f"medium={medium!r} must not trigger Buy-Min"


def test_explicit_doublewall_medium_is_preserved():
    r = run_estimate({
        "flute": "C", "boardGrade": "275", "outsideLiner": "42# Kemi-Lite",
        "insideLiner": "None", "medium": "33#", "oneUpW": "20", "oneUpL": "20",
        "qtys": ["500", "", "", "", ""], "quoteMode": "One-Up", "printReq": "No",
    })
    assert r.get("medium") == "33#", "explicit medium must not be coerced away"


def test_canon_medium_unit():
    for blank in ("", "  ", None, "none", "None", "KRAFT", "null", "n/a", "na"):
        assert _canon_medium(blank) == "None"
    assert _canon_medium("33#") == "33#"
    assert _canon_medium("40#") == "40#"


def test_canon_field_unit():
    assert _canon_field("", "42# Kemi-Lite") == "42# Kemi-Lite"
    assert _canon_field(None, "200") == "200"
    assert _canon_field("  ", "B") == "B"
    assert _canon_field("250", "200") == "250"
