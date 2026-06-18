"""Per-qty custom misc charges (2026-06-18).

A misc charge may carry an optional `costByQty` map keyed by slot index so an
estimator can associate a DIFFERENT flat dollar amount with each quantity tier
(e.g. 50 clips @ qty1, 100 @ qty2, 300 @ qty3). When a per-slot value is present
it overrides the flat `cost`; otherwise the flat cost applies. Markup still
applies on top. Per-component isolation is inherent (miscCharges is item-level).
"""
import pytest
from engine.runner import run_estimate, _resolve_misc_per_slot


def _base(qtys, misc):
    return {
        "oneUpW": "10", "oneUpL": "12", "qtys": qtys,
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Digital", "printSides": "1-Sided",
        "cadDifficulty": "Standard", "miscCharges": misc,
        "miscChargeMarkup": "0.15", "pricingBasis": "Gross Margin %",
    }


class TestResolveHelper:
    def test_per_slot_override_and_fallback(self):
        mc = [{"id": "c1", "name": "Clips", "treatment": "Separate Line",
               "cost": "100", "costByQty": {"0": "50", "2": "300"}}]
        assert _resolve_misc_per_slot(mc, 0)[0]["cost"] == "50"
        assert _resolve_misc_per_slot(mc, 1)[0]["cost"] == "100"   # fallback to flat
        assert _resolve_misc_per_slot(mc, 2)[0]["cost"] == "300"

    def test_blank_per_slot_falls_back(self):
        mc = [{"id": "c1", "cost": "100", "treatment": "Separate Line",
               "costByQty": {"0": "", "1": "  "}}]
        assert _resolve_misc_per_slot(mc, 0)[0]["cost"] == "100"
        assert _resolve_misc_per_slot(mc, 1)[0]["cost"] == "100"

    def test_no_costbyqty_unchanged(self):
        mc = [{"id": "c1", "cost": "75", "treatment": "Separate Line"}]
        assert _resolve_misc_per_slot(mc, 5)[0]["cost"] == "75"

    def test_list_form_supported(self):
        mc = [{"id": "c1", "cost": "100", "treatment": "Separate Line",
               "costByQty": ["50", "", "300"]}]
        assert _resolve_misc_per_slot(mc, 0)[0]["cost"] == "50"
        assert _resolve_misc_per_slot(mc, 1)[0]["cost"] == "100"
        assert _resolve_misc_per_slot(mc, 2)[0]["cost"] == "300"


class TestEnginePerQty:
    def test_different_misc_per_tier_with_markup(self):
        p = _base(["500", "1000", "2000", "", ""],
                  [{"id": "c1", "name": "Clips", "treatment": "Separate Line",
                    "cost": "100", "costByQty": {"0": "50", "2": "300"}}])
        r0 = run_estimate(p, 0)
        r1 = run_estimate(p, 1)
        r2 = run_estimate(p, 2)
        # 15% markup applied to the per-slot resolved cost
        assert r0["miscLineCost"] == pytest.approx(50 * 1.15, abs=0.01)
        assert r1["miscLineCost"] == pytest.approx(100 * 1.15, abs=0.01)   # fallback
        assert r2["miscLineCost"] == pytest.approx(300 * 1.15, abs=0.01)
        # Named line item carried through
        assert r2["miscLineItems"][0]["name"] == "Clips"

    def test_flat_cost_still_applies_to_all_tiers(self):
        p = _base(["500", "1000", "2000", "", ""],
                  [{"id": "c1", "name": "Setup", "treatment": "Separate Line", "cost": "80"}])
        for slot in range(3):
            r = run_estimate(p, slot)
            assert r["miscLineCost"] == pytest.approx(80 * 1.15, abs=0.01)
