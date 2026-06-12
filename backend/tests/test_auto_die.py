"""Test: auto-die parity with legacy spot_r1_5.jsx L3866-3883.

When the engine resolves a route to Crest or Bobst and the estimator has not
supplied a die cost, the engine MUST auto-inject the default die cost
($1200 Crest / $1800 Bobst). This used to live in the React useEffect, which
only ran on the active BOM tab — leaving items 2..N of Multi-Part quotes
without dies. The fix moves auto-die into build_prod_inputs() so every
component gets one.

Reproduces (in miniature) the L'Oreal Grippy Chipper math gap:
  Cloud $584,017.96 vs Legacy $593,389.67 — $9,371.71 delta
  ~$6,900 of that delta was missing dies on items 2,3,5,8,11.
"""
import sys
sys.path.insert(0, "/app/backend")

from engine.runner import run_estimate


def _crest_payload(rule_in="60", die_cost="0", die_treat="None", route_override="Crest"):
    return {
        "oneUpW": "12", "oneUpL": "18",
        "qtys": ["5000"], "qty": "5000",
        "boardGrade": "200", "flute": "B",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "totalRuleInches": rule_in,
        "routeOverride": route_override,
        "cuttingDieCost": die_cost, "dieTreatment": die_treat,
        "pricingBasis": "Gross Margin %",
    }


def test_crest_auto_die_1200_default():
    """Crest + no die input → auto-applies $1200 + 15% markup = $1380 line cost."""
    r = run_estimate(_crest_payload())
    assert r["route"] == "Crest"
    assert r["dieAutoApplied"] is True
    assert abs(r["dieBase"] - 1200) < 0.01
    assert abs(r["dieLineCost"] - 1380) < 0.01
    assert r["dieTreatmentEffective"] == "Separate Line"


def test_bobst_auto_die_1800_default():
    """Bobst + no die input → auto-applies $1800 default."""
    r = run_estimate(_crest_payload(route_override="Bobst"))
    assert r["route"] == "Bobst"
    assert r["dieAutoApplied"] is True
    assert abs(r["dieBase"] - 1800) < 0.01


def test_saber_dc_no_auto_die():
    """Saber + D/C does NOT auto-apply a die.

    Legacy spot_r1_5.jsx L3870 strictly checks `route==="Crest"||route==="Bobst"`
    — Saber+D/C is the fallback route when no Crest die fits, so by definition
    no die was viable. Items that *do* show a die in legacy on a Saber+D/C
    item got it from a sticky React state where the route was previously
    Crest, not from the auto-die useEffect on the current Saber+D/C route.
    """
    r = run_estimate({
        **_crest_payload(rule_in="0", route_override="Saber + D/C"),
        "saber": "Yes", "saberBlanksOut": "1",
    })
    assert r["route"] == "Saber + D/C"
    assert r["dieAutoApplied"] is False, "Saber+D/C must not auto-apply die"
    assert (r.get("dieBase") or 0) == 0


def test_cad_route_no_auto_die():
    """CAD route → no auto-die."""
    r = run_estimate(_crest_payload(rule_in="0", route_override="Auto"))
    assert r["route"] in ("CAD", "Saber + D/C")
    assert r["dieAutoApplied"] is False
    assert (r.get("dieBase") or 0) == 0


def test_user_set_die_preserved():
    """If user explicitly entered a die cost, do NOT override."""
    r = run_estimate(_crest_payload(die_cost="800", die_treat="Separate Line"))
    assert r["route"] == "Crest"
    assert r["dieAutoApplied"] is False
    assert abs(r["dieBase"] - 800) < 0.01


def test_user_amortize_die_preserved():
    """Amortize treatment with $0 cost → do NOT auto-apply (user opted out)."""
    r = run_estimate(_crest_payload(die_cost="0", die_treat="Amortize"))
    assert r["dieAutoApplied"] is False


def test_loreal_5_components_all_get_die():
    """Regression for L'Oreal Grippy Chipper Bug A: simulate 5 Crest-routed
    components and verify each gets the $1200 default die. Was failing
    because the React useEffect only fired on the active tab."""
    total_die = 0
    for w, l in [(12, 18), (14, 20), (8, 16), (10, 14), (16, 24)]:
        r = run_estimate({
            **_crest_payload(),
            "oneUpW": str(w), "oneUpL": str(l),
        })
        assert r.get("dieAutoApplied") is True, f"Component {w}x{l} missing auto-die"
        total_die += r["dieLineCost"]
    # 5 components × $1200 × 1.15 markup = $6,900
    assert abs(total_die - 6900.0) < 0.01, f"Expected $6,900 total die, got ${total_die}"
