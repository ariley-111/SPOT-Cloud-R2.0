"""Route Comparison parity — backend compare_routes must surface the legacy
breakeven {qty, die}, perPc, cadSaberNeeded, and isStock fields that the
Route Comparison panel renders 1:1 with spot_r1_5.jsx L835-890 / L6945-6964.
"""
from engine.routing import compare_routes
from engine.core import ENGINE, GRADE_ADDER_DEFAULTS, RATE_DEFAULTS


def _asmp():
    return {
        **ENGINE,
        "printReq": "Yes", "printMode": "Satin",
        "dieTreatment": "None", "dieCost": 0, "totalRuleInches": 0,
        "crestComplexity": "Standard", "cadDifficulty": "Standard",
        "bobstFirstSizing": "true",
        "incaRate": 485, "cadRate": 138, "crestRate": 45, "bobstRate": 350,
        "crestSpeed": 150, "bobstSpeed": 3000,
        "incaMinCharge": 0, "cadMinCharge": 0, "crestMinCharge": 0, "bobstMinCharge": 0,
    }


def _spec(grade="200", flute="E", ol="42# Kemi-Lite", il="None", med="None"):
    return {
        "boardGrade": grade, "flute": flute,
        "outsideLiner": ol, "insideLiner": il, "medium": med,
        "fscEnabled": False, "fscFee": 25, "kemiTariff": 2.50,
        "palletPrepFee": 17.50, "under5MsfFee": 0,
        "gradeAdder": float(GRADE_ADDER_DEFAULTS.get(grade, 0)),
    }


def test_breakeven_fields_present_and_consistent():
    opts = {"printReq": "Yes", "printMode": "Satin", "dieTreatment": "None",
            "dieCost": 0, "crestComplexity": "Standard"}
    comp = compare_routes(10, 12, _spec(), 5000, _asmp(), opts)
    assert comp is not None
    assert comp["cad"] and comp["crest"]
    # breakeven object shape
    assert "breakeven" in comp and set(comp["breakeven"].keys()) == {"qty", "die"}
    assert comp["breakeven"]["die"] >= 0
    # legacy formula: breakeven.die == cad.total - (crest.board+press+cut)
    cr = comp["crest"]
    expected_die = comp["cad"]["totalCost"] - (cr["board"] + cr["press"] + cr["cut"])
    assert abs(comp["breakeven"]["die"] - max(0, expected_die)) < 0.01
    # perPc == (crest.total - cad.total)/qty
    assert abs(comp["perPc"] - (cr["totalCost"] - comp["cad"]["totalCost"]) / 5000) < 1e-6
    # isStock surfaced on both routes
    assert "isStock" in comp["cad"] and "isStock" in comp["crest"]
    # cadSaberNeeded mirrors cad detail
    assert comp["cadSaberNeeded"] == bool(comp["cad"].get("saberNeeded"))


def test_breakeven_qty_matches_legacy_formula():
    opts = {"printReq": "Yes", "printMode": "Satin", "dieTreatment": "None",
            "dieCost": 0, "crestComplexity": "Standard"}
    qty = 5000
    comp = compare_routes(10, 12, _spec(), qty, _asmp(), opts)
    cad, cr = comp["cad"], comp["crest"]
    cad_pp = (cad["board"] + cad["press"] + cad["cut"]) / qty
    cr_pp = (cr["board"] + cr["press"] + cr["cut"]) / qty
    per_pc_diff = cad_pp - cr_pp
    if per_pc_diff > 0:
        assert comp["breakeven"]["qty"] == round((cr["die"] or 0) / per_pc_diff)
    else:
        assert comp["breakeven"]["qty"] is None


def test_winner_is_auto_cheapest():
    opts = {"printReq": "Yes", "printMode": "Satin", "dieTreatment": "None",
            "dieCost": 0, "crestComplexity": "Standard"}
    comp = compare_routes(10, 12, _spec(), 5000, _asmp(), opts)
    routes = {"CAD": comp["cad"]["totalCost"], "Crest": comp["crest"]["totalCost"]}
    if comp.get("bobst"):
        routes["Bobst"] = comp["bobst"]["totalCost"]
    cheapest = min(routes, key=routes.get)
    assert comp["winner"] == cheapest
