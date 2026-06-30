"""SPOT Pricing Engine — Routing & Sheet Selection.

Verbatim Python port of:
  - selectBobstSheet  (spot_engine.js L283-333)
  - autoSelectSheet   (spot_engine.js L336-556)
  - evaluateRoutes    (spot_engine.js L626-790) — D-124 shared route evaluator
  - autoRoute         (spot_engine.js L792-832) — D-124 cost-aware (cheapest viable)
  - compareRoutes     (spot_engine.js L834-900) — D-090 side-by-side panel data
"""
from __future__ import annotations
import math
from copy import copy
from typing import Any, Dict, List, Optional, Set

from .core import (
    ENGINE, APPROVED_SHEETS, BOBST_FLUTES, BOBST_MIN_W, BOBST_MIN_L,
    BOBST_MAX_W, BOBST_MAX_L, CREST_MAX_W, CREST_MAX_L,
    CAD_SETUP, CAD_FALLBACK, PRINT_SPEEDS, GRADE_ADDER_DEFAULTS, MULLEN_UPGRADE,
    calc_board, compute_layout, get_grade_fallback, get_medium_fallback, pn,
    active_cad_setup, active_cad_fallback, active_grade_adders,
)


def select_bobst_sheet(one_up_w: float, one_up_l: float, board_spec: Dict[str, Any],
                       total_qty: int, assumptions: Dict[str, Any]) -> Dict[str, Any]:
    """D-123 Bobst-only sheet selection — custom imposition with mill-min-buy scaling."""
    if board_spec["flute"] not in BOBST_FLUTES:
        return {"viable": False, "reason": f"{board_spec['flute']} flute exceeds Bobst's 0.060\" caliper limit"}

    b_n_up = math.floor((BOBST_MAX_W - 2) / one_up_w)
    b_n_out = math.floor((BOBST_MAX_L - 2) / one_up_l)
    if b_n_up < 1 or b_n_out < 1:
        return {"viable": False, "reason": f"piece exceeds Bobst envelope (max {BOBST_MAX_W}x{BOBST_MAX_L})"}

    b_sh_w = max(BOBST_MIN_W, b_n_up * one_up_w + 2)
    b_sh_l = max(BOBST_MIN_L, b_n_out * one_up_l + 2)
    if b_sh_w > BOBST_MAX_W or b_sh_l > BOBST_MAX_L:
        return {"viable": False, "reason": "computed sheet exceeds Bobst envelope"}

    b_pps = b_n_up * b_n_out
    b_req = math.ceil(total_qty / b_pps)
    b_waste = 1 - ((b_n_up * one_up_w * b_n_out * one_up_l) / (b_sh_w * b_sh_l))
    b_layout = {"numUp": b_n_up, "numOut": b_n_out, "pcsPerSheet": b_pps,
                "wastePct": b_waste, "sheetW": b_sh_w, "sheetL": b_sh_l}
    b_sheet = {"id": f"BOBST-{b_n_up}x{b_n_out}", "g": board_spec["boardGrade"], "f": board_spec["flute"],
               "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"], "md": board_spec["medium"],
               "w": b_sh_w, "l": b_sh_l}

    b_bi = {**board_spec, "widthIn": b_sh_w, "lengthIn": b_sh_l}
    b_bc = calc_board(b_bi, b_req)

    # Path A: pricable as-is
    if b_bc["pricable"]:
        return {"viable": True, "sheet": b_sheet, "layout": b_layout, "sheetsReq": b_req,
                "bc": b_bc, "totalCost": b_bc["total"], "stockMode": False,
                "customOrder": True, "isMillMinScaled": False}

    # Path B: has price but below mill min — mill-min-buy scale
    if b_bc["hasPrice"] and not b_bc["meetMin"]:
        sheet_sq_ft = (b_sh_w * b_sh_l) / 144
        min_buy_sheets = max(1, math.ceil(b_bc["minSqFt"] / sheet_sq_ft))
        min_buy_calc = calc_board(b_bi, min_buy_sheets)
        if min_buy_calc["pricable"]:
            scale = b_req / min_buy_sheets
            scaled_total = min_buy_calc["total"] * scale
            scaled_bc = {**b_bc, "pricable": True, "meetMin": True, "total": scaled_total,
                         "effWithFsc": scaled_total / b_bc["oMsf"] if b_bc["oMsf"] > 0 else 0,
                         "costPc": scaled_total / total_qty if total_qty > 0 else 0,
                         "varCost": min_buy_calc["varCost"] * scale,
                         "fscAmt": min_buy_calc["fscAmt"] * scale,
                         "setup": 0, "pp": min_buy_calc["pp"] * scale,
                         "kemiChg": min_buy_calc["kemiChg"] * scale,
                         "stockMode": True, "stockMinBuy": min_buy_sheets, "isMillMinScaled": True}
            return {"viable": True, "sheet": b_sheet, "layout": b_layout, "sheetsReq": b_req,
                    "bc": scaled_bc, "totalCost": scaled_total, "stockMode": False,
                    "customOrder": True, "isMillMinScaled": True, "minBuySheets": min_buy_sheets}

    return {"viable": False, "reason": "no Bobst-eligible board pricing — even at mill minimum"}


def select_override_sheet(one_up_w: float, one_up_l: float, board_spec: Dict[str, Any],
                          total_qty: int, override_w: float, override_l: float,
                          assumptions: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """User-forced sheet override (legacy spot_r1_5.jsx L3544-3570).

    Builds a sheet result for the user's chosen W×L using the current board spec.
    Mirrors legacy: if pricable → use as-is; if below mill min → scale to mill-min-buy.
    Marks `overrideActive` so runner pins route to CAD and skips auto-flip.
    """
    if override_w <= 0 or override_l <= 0:
        return None
    layout = compute_layout(one_up_w, one_up_l, override_w, override_l)
    if not layout:
        return None
    sheets_req = math.ceil(total_qty / layout["pcsPerSheet"])
    bi = {**board_spec, "widthIn": override_w, "lengthIn": override_l}
    bc = calc_board(bi, sheets_req, is_stock=True)
    cad_fb_min = (active_cad_fallback().get(assumptions.get("cadDifficulty", "Standard"), 6)) * sheets_req
    cad_hrs = ((active_cad_setup().get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
    # Preserve fractional precision in the id (matches the FE format
    # spot/SheetLibraryModal.jsx → `OVR-${Number(w)}x${Number(l)}` so that
    # round-tripping the id through MongoDB never silently truncates
    # 63.5 → 63 (which would re-cost a different sheet on reload).
    _w_str = f"{override_w:g}"
    _l_str = f"{override_l:g}"
    sheet = {"id": f"OVR-{_w_str}x{_l_str}",
             "g": board_spec["boardGrade"], "f": board_spec["flute"],
             "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"],
             "md": board_spec["medium"], "w": override_w, "l": override_l}
    if bc["pricable"]:
        return {"sheet": sheet, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
                "cadHrs": cad_hrs, "totalCost": bc["total"], "stockMode": False,
                "overrideActive": True, "customOrder": True}
    if bc["hasPrice"] and not bc["meetMin"]:
        # Below mill min — scale to mill-min-buy (matches legacy override branch)
        stock_sq_ft = (override_w * override_l) / 144
        min_buy = max(1, math.ceil(bc["minSqFt"] / stock_sq_ft))
        stock_calc = calc_board(bi, min_buy, is_stock=True)
        if stock_calc["pricable"]:
            scale = sheets_req / min_buy
            scaled_total = stock_calc["total"] * scale
            stock_bc = {**bc, "pricable": True, "meetMin": True, "total": scaled_total,
                        "effWithFsc": scaled_total / bc["oMsf"] if bc["oMsf"] > 0 else 0,
                        "costPc": scaled_total / total_qty if total_qty > 0 else 0,
                        "varCost": stock_calc["varCost"] * scale,
                        "fscAmt": stock_calc["fscAmt"] * scale,
                        "setup": 0, "pp": stock_calc["pp"] * scale,
                        "kemiChg": stock_calc["kemiChg"] * scale,
                        "stockMode": True, "stockMinBuy": min_buy}
            return {"sheet": sheet, "layout": layout, "sheetsReq": sheets_req, "bc": stock_bc,
                    "cadHrs": cad_hrs, "totalCost": scaled_total, "stockMode": True,
                    "overrideActive": True}
    # Not pricable even at mill min — return the unpriced result so the runner can
    # surface the Buy-Min status bar (mirrors legacy behavior).
    return {"sheet": sheet, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
            "cadHrs": cad_hrs, "totalCost": bc.get("total") or 0, "stockMode": False,
            "overrideActive": True}


def auto_select_sheet(one_up_w: float, one_up_l: float, board_spec: Dict[str, Any],
                      total_qty: int, assumptions: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Sheet auto-select (RULE-014). Verbatim port of L336-556."""

    def optimal_custom(max_w: float, max_l: float, medium_override: Optional[str] = None) -> Optional[Dict[str, Any]]:
        use_medium = medium_override or board_spec["medium"]
        n_up = math.floor((max_w - 2) / one_up_w)
        n_out = math.floor((max_l - 2) / one_up_l)
        if n_up < 1 or n_out < 1:
            return None
        sh_w = n_up * one_up_w + 2
        sh_l = n_out * one_up_l + 2
        pcs_per_sheet = n_up * n_out
        sheets_req = math.ceil(total_qty / pcs_per_sheet)
        bi = {**board_spec, "medium": use_medium, "widthIn": sh_w, "lengthIn": sh_l}
        bc = calc_board(bi, sheets_req)
        if not bc["hasPrice"]:
            return None
        waste_pct = 1 - ((n_up * one_up_w * n_out * one_up_l) / (sh_w * sh_l))
        cad_fb_min = (active_cad_fallback().get(assumptions.get("cadDifficulty", "Standard"), 3)) * sheets_req
        cad_hrs = ((active_cad_setup().get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
        layout = {"numUp": n_up, "numOut": n_out, "pcsPerSheet": pcs_per_sheet,
                  "wastePct": waste_pct, "sheetW": sh_w, "sheetL": sh_l}
        sheet = {"id": f"CUSTOM-{n_up}x{n_out}", "g": board_spec["boardGrade"], "f": board_spec["flute"],
                 "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"], "md": use_medium,
                 "w": sh_w, "l": sh_l}
        medium_fallback = {"medium": medium_override, "isHigher": True} if (medium_override and medium_override != board_spec["medium"]) else None
        # JS version returns just medium string, not dict — see L355
        if medium_override and medium_override != board_spec["medium"]:
            medium_fallback = medium_override
        return {"sheet": sheet, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
                "cadHrs": cad_hrs, "totalCost": bc["total"], "stockMode": False,
                "customOrder": True, "pricable": bc["pricable"], "mediumFallback": medium_fallback}

    def find_approved_sheets(medium_override: Optional[str], is_higher_medium: bool) -> List[Dict[str, Any]]:
        use_medium = medium_override or board_spec["medium"]
        results = []
        fb_grade = get_grade_fallback(board_spec["boardGrade"])
        for sh in APPROVED_SHEETS:
            grade_match = sh["g"] == board_spec["boardGrade"] or (fb_grade and sh["g"] == fb_grade)
            if (sh["f"] != board_spec["flute"] or not grade_match or
                sh["ol"] != board_spec["outsideLiner"] or sh["il"] != board_spec["insideLiner"] or
                sh["md"] != use_medium):
                continue
            used_grade_fallback = sh["g"] != board_spec["boardGrade"]
            layout = compute_layout(one_up_w, one_up_l, sh["w"], sh["l"])
            if not layout:
                continue
            sheets_req = math.ceil(total_qty / layout["pcsPerSheet"])
            # PARITY FIX (2026-06-01): when grade fallback fires (ECT 32 → 200),
            # swap boardGrade + gradeAdder to the RUNNING grade for the base-rate
            # lookup, mirroring the Mullen-upgrade path at L221. Without this,
            # calc_board looks up the SPEC grade's base ($95.31 for ECT 32) instead
            # of the RUNNING grade's base ($102.98 for 200) → ~$5.59/MSF understated
            # material cost (Lynk Pkg case 2026-06-01).
            if used_grade_fallback:
                fb_adder = active_grade_adders().get(fb_grade, 0)
                bi = {**board_spec, "boardGrade": fb_grade, "gradeAdder": fb_adder,
                      "medium": use_medium, "widthIn": sh["w"], "lengthIn": sh["l"]}
            else:
                bi = {**board_spec, "medium": use_medium, "widthIn": sh["w"], "lengthIn": sh["l"]}
            bc = calc_board(bi, sheets_req, is_stock=True)
            cad_fb_min = (active_cad_fallback().get(assumptions.get("cadDifficulty", "Standard"), 6)) * sheets_req
            cad_hrs = ((active_cad_setup().get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
            medium_fallback = {"medium": medium_override, "isHigher": is_higher_medium} if (medium_override and medium_override != board_spec["medium"]) else None
            if bc["pricable"]:
                results.append({"sheet": sh, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
                                "cadHrs": cad_hrs, "totalCost": bc["total"], "stockMode": True,
                                "customOrder": False,
                                "gradeFallback": fb_grade if used_grade_fallback else None,
                                "mediumFallback": medium_fallback})
            elif bc["hasPrice"] and not bc["meetMin"]:
                stock_sheet_sq_ft = (sh["w"] * sh["l"]) / 144
                min_buy_sheets = max(1, math.ceil(bc["minSqFt"] / stock_sheet_sq_ft))
                stock_calc = calc_board(bi, min_buy_sheets, is_stock=True)
                if stock_calc["pricable"]:
                    scale = sheets_req / min_buy_sheets
                    scaled_total = stock_calc["total"] * scale
                    stock_bc = {**bc, "pricable": True, "meetMin": True, "total": scaled_total,
                                "effWithFsc": scaled_total / bc["oMsf"] if bc["oMsf"] > 0 else 0,
                                "costPc": scaled_total / total_qty if total_qty > 0 else 0,
                                "varCost": stock_calc["varCost"] * scale,
                                "fscAmt": stock_calc["fscAmt"] * scale,
                                "setup": 0, "pp": stock_calc["pp"] * scale,
                                "kemiChg": stock_calc["kemiChg"] * scale,
                                "stockMode": True, "stockSheet": sh, "stockMinBuy": min_buy_sheets}
                    results.append({"sheet": sh, "layout": layout, "sheetsReq": sheets_req, "bc": stock_bc,
                                    "cadHrs": cad_hrs, "totalCost": scaled_total, "stockMode": True,
                                    "gradeFallback": fb_grade if used_grade_fallback else None,
                                    "mediumFallback": medium_fallback})
        return results

    def get_available_mediums() -> Set[str]:
        meds = set()
        fb_grade = get_grade_fallback(board_spec["boardGrade"])
        for sh in APPROVED_SHEETS:
            grade_match = sh["g"] == board_spec["boardGrade"] or (fb_grade and sh["g"] == fb_grade)
            if (sh["f"] == board_spec["flute"] and grade_match and
                sh["ol"] == board_spec["outsideLiner"] and sh["il"] == board_spec["insideLiner"]):
                meds.add(sh["md"])
        return meds

    # ─── Priority 1: Custom board order at CAD max ───
    max_dim = ENGINE["org_limits"]["max_dimension_in"]
    pair_lim = ENGINE["org_limits"]["oversize_pair_limit_in"]
    cad_candidates = []
    c1 = optimal_custom(max_dim, max_dim)
    if c1:
        if c1["sheet"]["w"] <= pair_lim or c1["sheet"]["l"] <= pair_lim:
            cad_candidates.append(c1)
    c2 = optimal_custom(pair_lim, max_dim)
    if c2:
        cad_candidates.append(c2)

    inca_rate = assumptions.get("incaRate", 460)
    cad_rate = assumptions.get("cadRate", 160)
    _press_per_sh = inca_rate / 100
    _cut_per_sh = cad_rate / 240
    def _all_in(c):
        return c["totalCost"] + c["sheetsReq"] * (_press_per_sh + _cut_per_sh)

    pricable = [c for c in cad_candidates if c.get("pricable")]
    if pricable:
        pricable.sort(key=_all_in)
        return pricable[0]

    # ─── Priority 2: Below minimum — approved stock sheets ───
    below_min = find_approved_sheets(None, False)
    if not below_min and board_spec["medium"] != "None":
        available_mediums = get_available_mediums()
        fallback_result = get_medium_fallback(board_spec["medium"], available_mediums)
        if fallback_result:
            below_min = find_approved_sheets(fallback_result["medium"], fallback_result["isHigher"])

    if below_min:
        below_min.sort(key=_all_in)
        return below_min[0]

    # ─── D-059: Mullen grade upgrade chain ───
    upgrade_grade = MULLEN_UPGRADE.get(board_spec["boardGrade"])
    while upgrade_grade:
        upgrade_adder = active_grade_adders().get(upgrade_grade, 0)
        upg_results = []
        for sh in APPROVED_SHEETS:
            if (sh["f"] != board_spec["flute"] or sh["g"] != upgrade_grade or
                sh["ol"] != board_spec["outsideLiner"] or sh["il"] != board_spec["insideLiner"] or
                sh["md"] != board_spec["medium"]):
                continue
            layout = compute_layout(one_up_w, one_up_l, sh["w"], sh["l"])
            if not layout:
                continue
            sheets_req = math.ceil(total_qty / layout["pcsPerSheet"])
            bi = {**board_spec, "boardGrade": upgrade_grade, "gradeAdder": upgrade_adder,
                  "medium": board_spec["medium"], "widthIn": sh["w"], "lengthIn": sh["l"]}
            bc = calc_board(bi, sheets_req, is_stock=True)
            cad_fb_min = (active_cad_fallback().get(assumptions.get("cadDifficulty", "Standard"), 6)) * sheets_req
            cad_hrs = ((active_cad_setup().get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
            if bc["pricable"]:
                upg_results.append({"sheet": sh, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
                                    "cadHrs": cad_hrs, "totalCost": bc["total"], "stockMode": True,
                                    "customOrder": False, "gradeFallback": upgrade_grade, "mullenUpgrade": True})
            elif bc["hasPrice"] and not bc["meetMin"]:
                stock_sq_ft = (sh["w"] * sh["l"]) / 144
                min_buy_sheets = max(1, math.ceil(bc["minSqFt"] / stock_sq_ft))
                stock_calc = calc_board(bi, min_buy_sheets, is_stock=True)
                if stock_calc["pricable"]:
                    scale = sheets_req / min_buy_sheets
                    scaled_total = stock_calc["total"] * scale
                    stock_bc = {**bc, "pricable": True, "meetMin": True, "total": scaled_total,
                                "effWithFsc": scaled_total / bc["oMsf"] if bc["oMsf"] > 0 else 0,
                                "costPc": scaled_total / total_qty if total_qty > 0 else 0,
                                "varCost": stock_calc["varCost"] * scale,
                                "fscAmt": stock_calc["fscAmt"] * scale,
                                "setup": 0, "pp": stock_calc["pp"] * scale,
                                "kemiChg": stock_calc["kemiChg"] * scale,
                                "stockMode": True, "stockSheet": sh, "stockMinBuy": min_buy_sheets}
                    upg_results.append({"sheet": sh, "layout": layout, "sheetsReq": sheets_req, "bc": stock_bc,
                                        "cadHrs": cad_hrs, "totalCost": scaled_total, "stockMode": True,
                                        "gradeFallback": upgrade_grade, "mullenUpgrade": True})
        if upg_results:
            upg_results.sort(key=_all_in)
            return upg_results[0]
        upgrade_grade = MULLEN_UPGRADE.get(upgrade_grade)

    # ─── Fallback: One-up exceeds stock sheet library ───
    req_w = one_up_w + 2
    req_l = one_up_l + 2
    fits_cad = (req_w <= pair_lim and req_l <= max_dim) or (req_l <= pair_lim and req_w <= max_dim)
    fits_crest = (req_w <= CREST_MAX_W and req_l <= CREST_MAX_L) or (req_l <= CREST_MAX_W and req_w <= CREST_MAX_L)
    if not fits_cad and not fits_crest:
        return {"noSheet": True, "exceedsMachineCapacity": True,
                "capacityError": f"Blank size {req_w}x{req_l} (with trim) is too large for any machine. Cannot manufacture."}

    fallback_candidates = []
    def try_oversize_fallback(w: float, l: float, label: str) -> Optional[Dict[str, Any]]:  # noqa: E741
        bi = {**board_spec, "widthIn": w, "lengthIn": l}
        bc = calc_board(bi, total_qty)
        if not bc["hasPrice"]:
            return None
        layout = {"numUp": 1, "numOut": 1, "pcsPerSheet": 1, "wastePct": 0, "sheetW": w, "sheetL": l}
        sheet = {"id": label, "g": board_spec["boardGrade"], "f": board_spec["flute"],
                 "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"], "md": board_spec["medium"],
                 "w": w, "l": l}
        cad_fb_min = (active_cad_fallback().get(assumptions.get("cadDifficulty", "Standard"), 6)) * total_qty
        cad_hrs = ((active_cad_setup().get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
        meets_pair_rule = w <= pair_lim or l <= pair_lim
        return {"sheet": sheet, "layout": layout, "sheetsReq": total_qty, "bc": bc,
                "cadHrs": cad_hrs, "totalCost": bc.get("total") or 0,
                "stockMode": False, "customOrder": True, "meetsPairRule": meets_pair_rule,
                "exceedsSheetLibrary": True,
                "exceedsWarning": "Piece is larger than any stock sheet. Will need a custom board order."}

    fb1 = try_oversize_fallback(req_w, req_l, "CUSTOM-OVERSIZE")
    if fb1:
        fallback_candidates.append(fb1)
    if one_up_w != one_up_l:
        fb2 = try_oversize_fallback(req_l, req_w, "CUSTOM-OVERSIZE-R")
        if fb2:
            fallback_candidates.append(fb2)

    if fallback_candidates:
        fallback_candidates.sort(key=lambda x: (0 if x["meetsPairRule"] else 1, x["totalCost"]))
        return fallback_candidates[0]

    return None


# ─── D-124 (R1.6.1): Shared route evaluator. ALL-CANDIDATES-COMPETE pattern. ───
# Verbatim port of legacy spot_r1_5.jsx L626-790 evaluateRoutes().
# Returns {cad, crest, bobst, bobstReason, cheapest} where each route entry has
#   {route, viable, totalCost, sheet, board, press, cut, hrs, ...}
# Used by auto_route (cheapest viable) and compare_routes (full set).
# Replaces D-121 hard-Bobst-first early return and the duplicate Crest sheet
# selection logic that previously caused autoRoute/compareRoutes to disagree.
def evaluate_routes(one_up_w: float, one_up_l: float, board_spec: Dict[str, Any],
                    total_qty: int, assumptions: Dict[str, Any],
                    opts: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if one_up_w <= 0 or one_up_l <= 0 or total_qty <= 0:
        return None
    opts = opts or {}

    print_speed = PRINT_SPEEDS.get(opts.get("printMode"), 100)
    die_cost_in = pn(opts.get("dieCost"))
    die_has_input = opts.get("dieTreatment") != "None" and die_cost_in > 0
    print_on = opts.get("printReq") == "Yes" and print_speed > 0

    inca_rate = assumptions.get("incaRate", 460)
    inca_min = assumptions.get("incaMinCharge", 0)
    cad_rate = assumptions.get("cadRate", 160)
    cad_min = assumptions.get("cadMinCharge", 0)

    # ─── CAD ───
    cad_sel = opts.get("cadSelectedSheet") or auto_select_sheet(
        one_up_w, one_up_l, board_spec, total_qty, assumptions)
    cad = None
    if cad_sel and cad_sel.get("bc") and cad_sel["bc"].get("pricable"):
        cad_sh_w = (cad_sel.get("sheet") or {}).get("w", 0)
        cad_sh_l = (cad_sel.get("sheet") or {}).get("l", 0)
        cad_hrs_v = opts.get("cadHrs") if isinstance(opts.get("cadHrs"), (int, float)) else cad_sel.get("cadHrs", 0)
        cad_press = max((cad_sel["sheetsReq"] / print_speed) * inca_rate, inca_min) if print_on else 0
        cad_cut = max(cad_hrs_v * cad_rate, cad_min)
        cad_board = cad_sel["bc"]["total"]
        cad_total = cad_board + cad_press + cad_cut
        # RULE-017: CAD viable when cadHrs <= 8 (within one shift)
        cad_viable = cad_hrs_v <= 8
        saber_needed = cad_sh_w > CREST_MAX_W or cad_sh_l > CREST_MAX_L
        cad = {
            "route": "CAD", "viable": cad_viable, "totalCost": cad_total, "sheet": cad_sel,
            "board": cad_board, "press": cad_press, "cut": cad_cut, "hrs": cad_hrs_v,
            "saberNeeded": saber_needed, "warning": None,
        }

    # ─── Crest (all-candidates-compete: custom + viable stock all sort by cost) ───
    crest = None
    c_n_up = math.floor((CREST_MAX_W - 2) / one_up_w)
    c_n_out = math.floor((CREST_MAX_L - 2) / one_up_l)
    if c_n_up >= 1 and c_n_out >= 1:
        fb_grade = get_grade_fallback(board_spec["boardGrade"])
        crest_rate = assumptions.get("crestRate", 45)
        crest_speed = assumptions.get("crestSpeed", 150)
        crest_min = assumptions.get("crestMinCharge", 0)
        crest_setup_map = assumptions.get("crestSetup") or {}
        crest_setup_min = (crest_setup_map.get("Standard", 45)
                           if isinstance(crest_setup_map, dict) else (crest_setup_map or 45))
        _pr_sh = inca_rate / 100
        _cr_sh = crest_rate / (crest_speed or 150)
        candidates = []

        # Candidate: custom Crest imposition
        c_sh_w = c_n_up * one_up_w + 2
        c_sh_l = c_n_out * one_up_l + 2
        c_pps = c_n_up * c_n_out
        c_req = math.ceil(total_qty / c_pps)
        c_bi = {**board_spec, "widthIn": c_sh_w, "lengthIn": c_sh_l}
        c_bc = calc_board(c_bi, c_req)
        if c_bc["pricable"]:
            c_waste = 1 - ((c_n_up * one_up_w * c_n_out * one_up_l) / (c_sh_w * c_sh_l))
            c_layout = {"numUp": c_n_up, "numOut": c_n_out, "pcsPerSheet": c_pps,
                        "wastePct": c_waste, "sheetW": c_sh_w, "sheetL": c_sh_l}
            c_sheet = {"id": f"CREST-{c_n_up}x{c_n_out}", "g": board_spec["boardGrade"],
                       "f": board_spec["flute"], "ol": board_spec["outsideLiner"],
                       "il": board_spec["insideLiner"], "md": board_spec["medium"],
                       "w": c_sh_w, "l": c_sh_l}
            candidates.append({
                "sheet": c_sheet, "layout": c_layout, "sheetsReq": c_req, "bc": c_bc,
                "totalCost": c_bc["total"], "allIn": c_bc["total"] + c_req * (_pr_sh + _cr_sh),
                "stockMode": False, "customOrder": True, "isStock": False,
                "gradeFallback": None,
            })

        # Candidates: stock sheets within Crest envelope
        for sh in APPROVED_SHEETS:
            if sh["w"] > CREST_MAX_W or sh["l"] > CREST_MAX_L:
                continue
            gm = sh["g"] == board_spec["boardGrade"] or (fb_grade and sh["g"] == fb_grade)
            if (sh["f"] != board_spec["flute"] or not gm or
                sh["ol"] != board_spec["outsideLiner"] or
                sh["il"] != board_spec["insideLiner"] or sh["md"] != board_spec["medium"]):
                continue
            ly = compute_layout(one_up_w, one_up_l, sh["w"], sh["l"])
            if not ly:
                continue
            req = math.ceil(total_qty / ly["pcsPerSheet"])
            used_fallback = sh["g"] != board_spec["boardGrade"]
            # PARITY (legacy spot_r1_5.jsx L701): cost the stock candidate using
            # boardSpec — NOT the fallback running grade. The Crest competition
            # ranks candidates on apples-to-apples spec-grade pricing, mirroring
            # legacy. The 2026-06-01 "use running grade" diff was a regression
            # (same root cause as the Buy Min recalc bug fixed 2026-06-10).
            bi = {**board_spec, "widthIn": sh["w"], "lengthIn": sh["l"]}
            bc = calc_board(bi, req, is_stock=True)
            if bc["pricable"]:
                candidates.append({
                    "sheet": sh, "layout": ly, "sheetsReq": req, "bc": bc,
                    "totalCost": bc["total"], "allIn": bc["total"] + req * (_pr_sh + _cr_sh),
                    "stockMode": True, "customOrder": False, "isStock": True,
                    "gradeFallback": fb_grade if used_fallback else None,
                })
            elif bc["hasPrice"] and not bc["meetMin"]:
                sq_ft = (sh["w"] * sh["l"]) / 144
                min_buy = max(1, math.ceil(bc["minSqFt"] / sq_ft))
                sc = calc_board(bi, min_buy, is_stock=True)
                if sc["pricable"]:
                    scale = req / min_buy
                    scaled = sc["total"] * scale
                    stock_bc = {**bc, "pricable": True, "meetMin": True, "total": scaled,
                                "effWithFsc": scaled / bc["oMsf"] if bc["oMsf"] > 0 else 0,
                                "costPc": scaled / total_qty if total_qty > 0 else 0,
                                "stockMode": True}
                    candidates.append({
                        "sheet": sh, "layout": ly, "sheetsReq": req, "bc": stock_bc,
                        "totalCost": scaled, "allIn": scaled + req * (_pr_sh + _cr_sh),
                        "stockMode": True, "customOrder": False, "isStock": True,
                        "gradeFallback": fb_grade if used_fallback else None,
                    })

        if candidates:
            candidates.sort(key=lambda a: a["allIn"])
            cr_pick = candidates[0]
            cr_board = cr_pick["bc"]["total"]
            cr_press_hrs = (cr_pick["sheetsReq"] / print_speed) if print_on else 0
            cr_press = max(cr_press_hrs * inca_rate, inca_min) if print_on else 0
            c_setup = crest_setup_min / 60
            eff_speed = crest_speed
            cr_cut_hrs = c_setup + (cr_pick["sheetsReq"] / eff_speed if eff_speed > 0 else 0)
            cr_cut = max(cr_cut_hrs * crest_rate, crest_min)
            rule_in = pn(assumptions.get("totalRuleInches"))
            # Legacy parity (spot_r1_5.jsx L1058-1059 + call site L3689): the Crest
            # die estimate is the crestDieCost default ($1,200) when the user hasn't
            # entered a die. Rule-inches drive ONLY the approval warning below — NOT
            # the die-cost estimate. (Cloud previously fed rule-inches into a floor-$500
            # formula that legacy's compareRoutes never actually reached, since its
            # caller omits totalRuleInches.)
            die_cost = die_cost_in if die_has_input else (pn(assumptions.get("crestDieCost")) or 1200)
            die_estimated = not die_has_input
            sheet_rule_inches = rule_in * cr_pick["layout"]["pcsPerSheet"] * 1.15 if rule_in > 0 else 0
            warning = (f"Crest die has {round(sheet_rule_inches)} rule inches per sheet "
                       f"(over 1,000) — needs approval before ordering die") if sheet_rule_inches > 1000 else None
            cr_total = cr_board + cr_press + cr_cut + die_cost
            crest = {
                "route": "Crest", "viable": True, "totalCost": cr_total, "sheet": cr_pick,
                "board": cr_board, "press": cr_press, "cut": cr_cut, "hrs": cr_cut_hrs,
                "die": die_cost, "dieEstimated": die_estimated,
                "sheetRuleInches": sheet_rule_inches, "warning": warning,
            }

    # ─── Bobst ───
    bobst = None
    bobst_reason = None
    if assumptions.get("bobstFirstSizing") != "false":
        b_sel = select_bobst_sheet(one_up_w, one_up_l, board_spec, total_qty, assumptions)
        if b_sel and b_sel.get("viable"):
            b_board = b_sel["bc"]["total"]
            b_press_hrs = (b_sel["sheetsReq"] / print_speed) if print_on else 0
            b_press = max(b_press_hrs * inca_rate, inca_min) if print_on else 0
            b_setup = assumptions.get("bobstSetup", 45) / 60
            b_speed = assumptions.get("bobstSpeed", 3000)
            b_cut_hrs = b_setup + (b_sel["sheetsReq"] / b_speed if b_speed > 0 else 0)
            b_rate = assumptions.get("bobstRate", 350)
            b_min = assumptions.get("bobstMinCharge", 0)
            b_cut = max(b_cut_hrs * b_rate, b_min)
            b_die_cost = die_cost_in if die_has_input else (pn(assumptions.get("bobstDieCost")) or 1800)
            b_die_estimated = not die_has_input
            b_total = b_board + b_press + b_cut + b_die_cost
            bobst = {
                "route": "Bobst", "viable": True, "totalCost": b_total, "sheet": b_sel,
                "board": b_board, "press": b_press, "cut": b_cut, "hrs": b_cut_hrs,
                "die": b_die_cost, "dieEstimated": b_die_estimated,
                "isMillMinScaled": bool(b_sel.get("isMillMinScaled")),
                "minBuySheets": b_sel.get("minBuySheets", 0),
                "warning": None,
            }
        elif b_sel:
            bobst_reason = b_sel.get("reason")
    else:
        bobst_reason = "Bobst auto-route eligibility disabled"

    # Determine cheapest viable. Order [cad, crest, bobst] preserves CAD>Crest>Bobst
    # tiebreaker via Python's stable sort.
    viable = [r for r in (cad, crest, bobst) if r and r.get("viable")]
    viable.sort(key=lambda r: r["totalCost"])
    cheapest = viable[0] if viable else None

    return {"cad": cad, "crest": crest, "bobst": bobst,
            "bobstReason": bobst_reason, "cheapest": cheapest}


def auto_route(cad_hrs: float, selected_sheet: Dict[str, Any], one_up_w: float, one_up_l: float,
               board_spec: Dict[str, Any], total_qty: int, assumptions: Dict[str, Any]) -> Dict[str, Any]:
    """Auto-routing — verbatim legacy parity (spot_r1_5.jsx L793-832 autoRoute).

    D-124 COST-AWARE: the cheapest VIABLE route wins (computed by evaluate_routes,
    which ranks CAD vs Crest vs Bobst on all-in cost). There is NO Bobst-first
    early-return and NO "CAD if cadHrs <= 8" hard rule — those were a prior
    mis-revert that diverged from the legacy source. CAD viability is still gated
    at cadHrs <= 8 inside evaluate_routes (so a long CAD job drops out of the
    cheapest set), but a viable cheaper CAD beats a viable Bobst. Force-route in
    the caller still pins manually; the Route Comparison panel shows all options.
    """
    opts = {
        "printReq": assumptions.get("printReq", "Yes"),
        "printMode": assumptions.get("printMode", "Satin"),
        "dieTreatment": assumptions.get("dieTreatment", "None"),
        "dieCost": assumptions.get("dieCost"),
        "cadSelectedSheet": selected_sheet,
        "cadHrs": cad_hrs,
    }
    ev = evaluate_routes(one_up_w, one_up_l, board_spec, total_qty, assumptions, opts)
    if not ev or not ev.get("cheapest"):
        # RULE-020: Saber + D/C fallback when no viable route (legacy L809-814)
        return {"route": "Saber + D/C", "sheet": selected_sheet,
                "warning": "Too many CAD hours and no Crest/Bobst route viable — falling back to Saber + die cut",
                "cadHrs": cad_hrs}
    w = ev["cheapest"]
    if w["route"] == "CAD":
        return {"route": "CAD", "sheet": selected_sheet, "warning": None}
    if w["route"] == "Crest":
        return {"route": "Crest", "sheet": w["sheet"], "warning": w.get("warning"),
                "cadHrs": cad_hrs, "sheetRuleInches": w.get("sheetRuleInches")}
    if w["route"] == "Bobst":
        return {"route": "Bobst", "sheet": w["sheet"], "warning": None, "cadHrs": cad_hrs}
    # Defensive (shouldn't reach) — legacy L826-831
    return {"route": "Saber + D/C", "sheet": selected_sheet,
            "warning": "Routing fallback — no expected route winner", "cadHrs": cad_hrs}


# ─── D-090: Route comparison — side-by-side CAD vs Crest vs Bobst economics. ───
# Delegates routing math to evaluate_routes (same helper auto_route uses).
def compare_routes(one_up_w: float, one_up_l: float, board_spec: Dict[str, Any],
                   total_qty: int, assumptions: Dict[str, Any],
                   opts: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Returns flat fields {cad, crest, bobst, delta, winner, breakeven} for the
    Route Comparison panel. Math identical to auto_route via evaluate_routes."""
    opts = opts or {}
    ev = evaluate_routes(one_up_w, one_up_l, board_spec, total_qty, assumptions, opts)
    if not ev:
        return None

    cad = ev.get("cad")
    crest = ev.get("crest")
    bobst = ev.get("bobst")

    cad_detail = None
    if cad and cad.get("sheet"):
        cs = cad["sheet"]
        cad_detail = {
            "viable": cad["viable"],
            "totalCost": cad["totalCost"],
            "board": cad["board"], "press": cad["press"], "cut": cad["cut"],
            "hrs": cad["hrs"],
            "sheetW": (cs.get("sheet") or {}).get("w"),
            "sheetL": (cs.get("sheet") or {}).get("l"),
            "pcsPerSheet": (cs.get("layout") or {}).get("pcsPerSheet"),
            "sheetsReq": cs.get("sheetsReq"),
            "wastePct": (cs.get("layout") or {}).get("wastePct"),
            "saberNeeded": cad.get("saberNeeded"),
            "isStock": bool(cs.get("stockMode")),
        }

    crest_detail = None
    if crest:
        cp = crest["sheet"]
        crest_detail = {
            "viable": crest["viable"],
            "totalCost": crest["totalCost"],
            "board": crest["board"], "press": crest["press"], "cut": crest["cut"],
            "die": crest.get("die"), "dieEstimated": crest.get("dieEstimated"),
            "hrs": crest["hrs"],
            "sheetW": (cp.get("sheet") or {}).get("w"),
            "sheetL": (cp.get("sheet") or {}).get("l"),
            "pcsPerSheet": (cp.get("layout") or {}).get("pcsPerSheet"),
            "sheetsReq": cp.get("sheetsReq"),
            "wastePct": (cp.get("layout") or {}).get("wastePct"),
            "isStock": cp.get("isStock"), "stockMode": cp.get("stockMode"),
            "gradeFallback": cp.get("gradeFallback"),
            "sheetRuleInches": crest.get("sheetRuleInches"),
            "warning": crest.get("warning"),
        }

    bobst_detail = None
    if bobst:
        bp = bobst["sheet"]
        bobst_detail = {
            "viable": bobst["viable"],
            "totalCost": bobst["totalCost"],
            "board": bobst["board"], "press": bobst["press"], "cut": bobst["cut"],
            "die": bobst.get("die"), "dieEstimated": bobst.get("dieEstimated"),
            "hrs": bobst["hrs"],
            "sheetW": (bp.get("sheet") or {}).get("w"),
            "sheetL": (bp.get("sheet") or {}).get("l"),
            "pcsPerSheet": (bp.get("layout") or {}).get("pcsPerSheet"),
            "sheetsReq": bp.get("sheetsReq"),
            "wastePct": (bp.get("layout") or {}).get("wastePct"),
            "isMillMinScaled": bobst.get("isMillMinScaled"),
            "minBuySheets": bobst.get("minBuySheets"),
        }

    # Delta + breakeven (CAD vs Crest) — verbatim legacy spot_r1_5.jsx L873-890.
    delta = None
    per_pc = None
    breakeven = {"qty": None, "die": 0}
    if cad_detail and crest_detail and total_qty > 0:
        delta = crest_detail["totalCost"] - cad_detail["totalCost"]
        cad_prod_per_pc = (cad_detail["board"] + cad_detail["press"] + cad_detail["cut"]) / total_qty
        cr_prod_per_pc = (crest_detail["board"] + crest_detail["press"] + crest_detail["cut"]) / total_qty
        per_pc_diff = cad_prod_per_pc - cr_prod_per_pc
        crest_die = crest_detail.get("die") or 0
        breakeven_qty = round(crest_die / per_pc_diff) if per_pc_diff > 0 else None
        breakeven_die = cad_detail["totalCost"] - (crest_detail["board"] + crest_detail["press"] + crest_detail["cut"])
        breakeven = {"qty": breakeven_qty, "die": max(0, breakeven_die)}
        per_pc = (crest_detail["totalCost"] - cad_detail["totalCost"]) / total_qty

    winner = ev["cheapest"]["route"] if ev.get("cheapest") else None

    return {
        "cad": cad_detail, "crest": crest_detail, "bobst": bobst_detail,
        "bobstReason": ev.get("bobstReason"),
        "delta": delta, "perPc": per_pc,
        "breakeven": breakeven, "breakevenQty": breakeven.get("qty"),
        "cadSaberNeeded": bool(cad_detail and cad_detail.get("saberNeeded")),
        "winner": winner,
    }
