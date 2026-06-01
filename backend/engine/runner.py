"""SPOT Runner — orchestrates the full pricing pipeline.

Verbatim Python port of spot_runner.js. This function replicates the entire
reactive chain in the JSX app:
  calcResults -> auto-flip -> auto-BuyMin -> re-calc.
"""
from __future__ import annotations
import math
from typing import Any, Dict, List, Optional

from .core import (
    RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, SPOT_SCHEMA_VERSION,
    GRADE_ADDER_DEFAULTS, calc_board, compute_layout, pn,
)
from .routing import auto_select_sheet, auto_route
from .pricing import calc_wf, calc_shipment


ASMP_DEFAULTS: Dict[str, Any] = {
    "overheadPct": 0, "regularInkRate": 0.05, "whiteInkFactor": 0.5,
    "regularMR": 5, "whiteMR": 15, "spoilagePct": 0.02,
    "stackHeight": 48, "perimeterStripMinPallet": 15, "cadRegularSpeed": 650,
    "incaRate": 485, "cadRate": 138, "crestRate": 45, "saberRate": 2,
    "handStrippingRate": 17, "handGluingRate": 23,
    "incaMinCharge": 0, "cadMinCharge": 0, "crestMinCharge": 0,
    "saberMinCharge": 0, "saberCostPerCut": 0, "handStrippingMinCharge": 0, "handGluingMinCharge": 0,
    "crestSetup": {"Standard": 45, "Advanced": 90}, "crestSpeed": 150, "crestAdvSpeedFactor": 0.8,
    "clearTapeCostPerFt": 0.03, "reinforcedTapeCostPerFt": 0.08,
    "tapeFootPerPiece": 2, "side2PrintFactor": 0.6,
    "cadDifficulty": "Standard", "totalRuleInches": "0", "under5MsfFee": 0, "cadPerfSpeedFactor": 0.4,
    "crestDieCost": 1200,
    "bobstRate": 350, "bobstSpeed": 3000, "bobstSetup": 45, "bobstMinCharge": 250, "bobstDieCost": 1800,
    "bobstFirstSizing": "true",
}


def build_asmp(rate_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {**ASMP_DEFAULTS, **(rate_overrides or {})}


def build_board_spec(json: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "flute": json.get("flute", "B"),
        "boardGrade": json.get("boardGrade", "200"),
        "outsideLiner": json.get("outsideLiner", "42# Kemi-Lite"),
        "insideLiner": json.get("insideLiner", "None"),
        "medium": json.get("medium", "None"),
        "fscEnabled": bool(json.get("fscEnabled")),
        "fscFee": pn(json.get("fscFee", "25")),
        "kemiTariff": pn(json.get("kemiTariff", "2.50")),
        "palletPrepFee": pn(json.get("palletPrepFee", "17.50")),
        "under5MsfFee": pn(json["under5MsfFee"] if json.get("under5MsfFee") is not None else RATE_DEFAULTS["under5MsfFee"]),
        "gradeAdder": pn(json["gradeAdder"]) if json.get("gradeAdder") is not None else (GRADE_ADDER_DEFAULTS.get(json.get("boardGrade", "200"), 0)),
        "widthIn": 0,
        "lengthIn": 0,
    }


def build_prod_inputs(json: Dict[str, Any], route_result: Dict[str, Any],
                      layout: Dict[str, Any], asmp: Dict[str, Any]) -> Dict[str, Any]:
    prepress_treat_raw = json.get("prepressTreatment", "Auto")
    prepress_treat = "Amortize" if prepress_treat_raw == "Auto" else prepress_treat_raw
    prepress_cost = json.get("defaultPrepressCost", "50") if prepress_treat_raw == "Auto" else json.get("prepressCost", "50")

    fob_origin = json.get("quoteFOB", "Origin") == "Origin"
    freight_cost = "0"
    if not fob_origin:
        fbq = json.get("freightByQty") or {}
        slot_idx = json.get("_slotIndex", 0)
        if isinstance(fbq, dict) and slot_idx in fbq:
            freight_cost = fbq[slot_idx]
        elif isinstance(fbq, list) and slot_idx < len(fbq):
            freight_cost = fbq[slot_idx]
        else:
            freight_cost = json.get("freightCost", "0")

    return {
        "printRequired": json.get("printReq") or json.get("printRequired") or "Yes",
        "printMode": json.get("printMode", "Satin"),
        "printSides": json.get("printSides", "1-Sided"),
        "whiteInk": json.get("whiteInk", "No"),
        "saber": json.get("saber", "No"),
        "saberCuts": json.get("saberCuts", "1"),
        "saberBlanksOut": json.get("saberBlanksOut", "1"),
        "saberPcsPerBlank": layout["pcsPerSheet"],
        "cadPricingMethod": json.get("cadPricingMethod", "By Difficulty"),
        "cadDifficulty": json.get("cadDifficulty", "Standard"),
        "crestComplexity": json.get("crestComplexity", "Standard"),
        "totalRuleInches": json.get("totalRuleInches", "0"),
        "perfPct": json.get("perfPct", "0"),
        "cadSheetsPerHourOverride": json.get("cadSheetsPerHourOverride", "0"),
        "productMats": json.get("productMats", "No"),
        "flute": json.get("flute", "B"),
        "route": route_result["route"],
        "handStripping": json.get("handStripping", "No"),
        "perimeterStripping": json.get("perimeterStripping", "No"),
        "strippingComplexity": json.get("strippingComplexity", "Standard"),
        "handGluing": json.get("handGluing", "No"),
        "jointsPerPiece": json.get("jointsPerPiece", "1"),
        "gluingComplexity": json.get("gluingComplexity", "Standard"),
        "tape": json.get("tape", "No"),
        "tapeType": json.get("tapeType", "Clear"),
        "freightCost": freight_cost,
        "freightTreatment": "None" if fob_origin else json.get("freightTreatment", "Separate Line"),
        "freightMarkup": json.get("freightMarkup", "0.15"),
        "cuttingDieCost": json.get("cuttingDieCost", "0"),
        "dieTreatment": json.get("dieTreatment", "None"),
        "dieMarkup": json.get("dieMarkup", "0.15"),
        "dieAmortMethod": json.get("dieAmortMethod", "Markup"),
        "miscCharges": json.get("miscCharges", []),
        "miscChargeMarkup": json.get("miscChargeMarkup", "0.15"),
        "prepressCost": prepress_cost,
        "prepressTreatment": "None" if prepress_treat_raw == "None" else prepress_treat,
        "pricingBasis": json.get("pricingBasis", "Gross Margin %"),
        "gmByTier": json.get("gmByTier") or GM_DEFAULTS,
        "sellByTier": json.get("sellByTier") or SELL_DEFAULTS,
    }


def run_estimate(json: Dict[str, Any], slot_index: int = 0) -> Dict[str, Any]:
    """Mirrors runEstimate() in spot_runner.js. Returns a result row with full breakdown."""
    uw = pn(json.get("oneUpW"))
    ul = pn(json.get("oneUpL"))
    qtys = json.get("qtys") or []
    qty_val = qtys[slot_index] if slot_index < len(qtys) else json.get("qty", "0")
    try:
        qty = int(qty_val)
    except (ValueError, TypeError):
        qty = 0
    if uw <= 0 or ul <= 0 or qty <= 0:
        return {"error": "Invalid dimensions or qty", "uw": uw, "ul": ul, "qty": qty}

    board_spec = build_board_spec(json)
    asmp = build_asmp(json.get("rateOverrides"))

    # STEP 1: Auto-select sheet
    best = auto_select_sheet(uw, ul, board_spec, qty, asmp)

    # STEP 2: Auto-flip corrugation
    corr_flipped = False
    if best and (best.get("exceedsSheetLibrary") or
                 (best.get("bc") and not best["bc"]["pricable"] and best["bc"]["hasPrice"] and not best["bc"]["meetMin"])):
        flipped_sel = auto_select_sheet(ul, uw, board_spec, qty, asmp)
        if flipped_sel and flipped_sel.get("bc") and (flipped_sel["bc"]["pricable"] or (flipped_sel["bc"]["hasPrice"] and flipped_sel.get("stockMode"))):
            best = flipped_sel
            corr_flipped = True

    if not best:
        flipped_last = auto_select_sheet(ul, uw, board_spec, qty, asmp)
        if flipped_last:
            best = flipped_last
            corr_flipped = True
        else:
            return {"error": "No sheet found", "uw": uw, "ul": ul, "qty": qty,
                    "boardGrade": board_spec["boardGrade"], "flute": board_spec["flute"]}

    # STEP 3: Auto-route
    eff_w_for_route = ul if corr_flipped else uw
    eff_l_for_route = uw if corr_flipped else ul
    auto_r = auto_route(best.get("cadHrs", 0), best, eff_w_for_route, eff_l_for_route, board_spec, qty, asmp)

    route_override = json.get("routeOverride") or None
    if route_override and route_override != "Auto":
        if route_override != auto_r["route"]:
            routing = {"route": route_override, "sheet": best, "warning": f"Forced to {route_override}", "forced": True}
        else:
            routing = {**auto_r, "forced": False}
    else:
        routing = auto_r

    # STEP 4: Extract sheet/layout/bc
    use_sheet = routing.get("sheet") or best
    layout = use_sheet.get("layout") or best.get("layout")
    sheets_req = use_sheet.get("sheetsReq") or best.get("sheetsReq")
    bc = use_sheet.get("bc") or best.get("bc")
    sh_w = (use_sheet.get("sheet") or {}).get("w") or use_sheet.get("w") or 0
    sh_l = (use_sheet.get("sheet") or {}).get("l") or use_sheet.get("l") or 0

    # STEP 5: Saber yield recalc
    saber_on = json.get("saber", "No") == "Yes"
    try:
        saber_bo = max(1, int(json.get("saberBlanksOut", "1") or 1)) if saber_on else 1
    except (ValueError, TypeError):
        saber_bo = 1
    saber_blank_layout = None
    if saber_on and sh_w > 0 and sh_l > 0 and uw > 0 and ul > 0:
        adj_l = round(sh_l / saber_bo * 100) / 100
        saber_blank_layout = compute_layout(uw, ul, sh_w, adj_l)
    if saber_on and saber_bo > 1 and saber_blank_layout:
        effective_pcs = saber_blank_layout["pcsPerSheet"] * saber_bo
        if effective_pcs > 0 and effective_pcs < layout["pcsPerSheet"]:
            sheets_req = math.ceil(qty / effective_pcs)
            bc = calc_board({**board_spec, "widthIn": sh_w, "lengthIn": sh_l}, sheets_req,
                            is_stock=use_sheet.get("stockMode", False))

    # STEP 6: Auto Buy Min
    buy_min_board = json.get("buyMinBoard", "Auto")
    board_substitution = json.get("boardSubstitution")
    if bc and bc["hasPrice"] and not bc["pricable"] and not bc["meetMin"] and buy_min_board == "Auto":
        buy_min_board = "Yes"

    # STEP 7: Buy Min recalc
    force_custom_order = buy_min_board == "Yes" and board_substitution == "forced"
    if buy_min_board == "Yes" and bc and bc["hasPrice"] and ((not bc["pricable"] and not bc["meetMin"]) or force_custom_order):
        bm_sq_ft = (sh_w * sh_l) / 144
        bm_min_sheets = max(1, math.ceil((bc.get("minSqFt") or 15000) / bm_sq_ft))
        bm_bc = calc_board({**board_spec, "widthIn": sh_w, "lengthIn": sh_l}, bm_min_sheets, is_stock=False)
        if bm_bc and bm_bc["pricable"]:
            bc = {**bm_bc, "pricable": True, "meetMin": True, "buyMin": True,
                  "buyMinSheets": bm_min_sheets, "actualSheets": sheets_req}

    if not bc or not bc["pricable"]:
        return {
            "error": (bc and ("Below minimum (all fallbacks exhausted)" if bc["hasPrice"] else "No price for grade/tier")) or "No board calc",
            "uw": uw, "ul": ul, "qty": qty,
            "boardGrade": board_spec["boardGrade"], "flute": board_spec["flute"],
            "sheet": f"{sh_w}x{sh_l}" if sh_w > 0 else None,
            "gradeFallback": best.get("gradeFallback"),
            "mediumFallback": best.get("mediumFallback"),
            "corrFlipped": corr_flipped,
        }

    # STEP 8: Build prod inputs
    prod_inputs = build_prod_inputs({
        **json,
        "_slotIndex": slot_index,
        "defaultPrepressCost": json.get("defaultPrepressCost") or RATE_DEFAULTS["defaultPrepressCost"],
    }, routing, layout, asmp)

    if saber_blank_layout:
        prod_inputs["saberPcsPerBlank"] = saber_blank_layout["pcsPerSheet"]

    # STEP 9: calcWF
    wf = calc_wf(bc, sheets_req, qty, layout["pcsPerSheet"], prod_inputs, asmp)
    if not wf:
        return {"error": "calcWF returned null", "uw": uw, "ul": ul, "qty": qty}

    # STEP 10: Forced sell override
    fsp_map = json.get("forcedSellPc") or {}
    if isinstance(fsp_map, list):
        fsp = pn(fsp_map[slot_index]) if slot_index < len(fsp_map) else 0
    else:
        fsp = pn(fsp_map.get(slot_index) or fsp_map.get(str(slot_index)))
    if fsp > 0 and wf["pricable"]:
        wf["itemSell"] = fsp * qty
        wf["sellTotal"] = wf["itemSell"] + wf["freightLine"] + wf["dieLineCost"] + (wf.get("prepressLineCost") or 0) + (wf.get("miscLineCost") or 0)
        wf["sellPc"] = wf["sellTotal"] / qty if qty > 0 else 0
        wf["sellSh"] = wf["sellTotal"] / sheets_req if sheets_req > 0 else 0
        wf["sellMSF"] = wf["itemSell"] / wf["oMSF"] if wf["oMSF"] > 0 else 0
        wf["gm$"] = wf["itemSell"] - wf["totalMfg"]
        wf["gmPct"] = wf["gm$"] / wf["itemSell"] if wf["itemSell"] > 0 else 0
        wf["gmMSF"] = wf["gm$"] / wf["oMSF"] if wf["oMSF"] > 0 else 0
        wf["forcedPrice"] = True

    # STEP 11: Shipment
    eff_w = ul if corr_flipped else uw
    eff_l = uw if corr_flipped else ul
    ship = calc_shipment(board_spec["boardGrade"], board_spec["flute"],
                         board_spec["outsideLiner"], board_spec["insideLiner"], board_spec["medium"],
                         wf.get("shippedMSF") or wf["oMSF"], eff_w, eff_l, qty)

    return {
        "_pipeline": {
            "corrFlipped": corr_flipped,
            "buyMinActive": bool(bc.get("buyMin")),
            "buyMinSheets": bc.get("buyMinSheets"),
            "gradeFallback": best.get("gradeFallback"),
            "mediumFallback": best.get("mediumFallback"),
            "mullenUpgrade": bool(best.get("mullenUpgrade")),
            "stockMode": bool(best.get("stockMode") or bc.get("stockMode")),
            "customOrder": bool(best.get("customOrder")),
            "exceedsSheetLibrary": bool(best.get("exceedsSheetLibrary")),
            "routeAuto": auto_r["route"],
            "routeForced": routing.get("forced", False),
        },
        "oneUpW": eff_w, "oneUpL": eff_l, "qty": qty,
        "flute": board_spec["flute"], "boardGrade": board_spec["boardGrade"],
        "outsideLiner": board_spec["outsideLiner"], "insideLiner": board_spec["insideLiner"], "medium": board_spec["medium"],
        "sheetW": sh_w, "sheetL": sh_l,
        "sheetId": (use_sheet.get("sheet") or best.get("sheet") or {}).get("id"),
        "pcsPerSheet": layout["pcsPerSheet"],
        "numUp": layout["numUp"], "numOut": layout["numOut"], "wastePct": layout["wastePct"],
        "sheetsReq": sheets_req,
        "oMSF": wf["oMSF"], "shippedMSF": wf["shippedMSF"], "msfTier": wf["matTier"],
        "boardBase": bc["base"], "boardEffRate": bc["effRate"], "boardTotal": bc["total"],
        # Board PO breakdown (Board panel parity with legacy spot_r1_5.jsx L7980+)
        "boardSqFt": bc.get("sqft") or 0,
        "boardOSqFt": bc.get("oSqFt") or 0,
        "boardVarCost": bc.get("varCost") or 0,
        "boardFscAmt": bc.get("fscAmt") or 0,
        "boardSetup": bc.get("setup") or 0,
        "boardPp": bc.get("pp") or 0,
        "boardKemiChg": bc.get("kemiChg") or 0,
        # Press detail rows for Cost Buildup DETAIL view
        "pressHrs": wf.get("pressHrs") or 0,
        "incaRate": asmp.get("incaRate", 485),
        "inkSqFt": wf.get("grossSqFt") or 0,
        "inkRate": asmp.get("inkPerSqFt") or 0.05,
        # Cutting / Finishing detail
        "cutterBasis": wf.get("cutterBasis") or "",
        "jointsPerPiece": json.get("jointsPerPiece"),
        "gluingComplexity": json.get("gluingComplexity"),
        "route": routing.get("route") or wf["route"], "cadHrs": wf["cadHrs"],
        "matTotal": wf["matTotal"], "matMakeready": wf["matMakeready"],
        "pressCost": wf["pressCost"], "inkCost": wf["inkCost"], "whiteCost": wf["whiteCost"],
        "side2Cost": wf["side2Cost"], "printDirect": wf["printDirect"],
        "saberCost": wf["saberCost"], "cutterDirect": wf["cutterDirect"],
        "dieEmbedded": wf["dieEmbedded"], "dieLineCost": wf["dieLineCost"],
        "stripCost": wf["stripCost"], "assemblyCost": wf["assemblyCost"],
        "freightLine": wf["freightLine"], "freightEmbed": wf["freightEmbed"],
        "prepressLineCost": wf["prepressLineCost"], "prepressEmbedded": wf["prepressEmbedded"],
        "miscLineCost": wf["miscLineCost"], "overhead": wf["overhead"],
        "totalDirect": wf["totalDirect"], "totalMfg": wf["totalMfg"],
        "costPc": wf["costPc"], "costMSF": wf["costMSF"],
        "itemSell": wf["itemSell"], "sellTotal": wf["sellTotal"],
        "sellPc": wf["sellPc"], "sellMSF": wf["sellMSF"],
        "gmDollar": wf["gm$"], "gmPct": wf["gmPct"], "gmMSF": wf["gmMSF"],
        "pricable": wf["pricable"], "status": wf["status"],
        "shipWeight": ship["totalWeight"], "skidCount": ship["skidCount"],
        "skidKey": ship["skidKey"], "trailerFeet": ship["trailerFeet"],
        "boardLbsMSF": ship["boardLbsMSF"],
    }
