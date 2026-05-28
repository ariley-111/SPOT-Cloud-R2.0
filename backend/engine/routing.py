"""SPOT Pricing Engine — Routing & Sheet Selection.

Verbatim Python port of:
  - selectBobstSheet  (spot_engine.js L283-333)
  - autoSelectSheet   (spot_engine.js L336-556)
  - autoRoute         (spot_engine.js L559-634)
  - compareRoutes     (spot_engine.js L993-1110)
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
        cad_fb_min = (CAD_FALLBACK.get(assumptions.get("cadDifficulty", "Standard"), 3)) * sheets_req
        cad_hrs = ((CAD_SETUP.get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
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
            bi = {**board_spec, "medium": use_medium, "widthIn": sh["w"], "lengthIn": sh["l"]}
            bc = calc_board(bi, sheets_req, is_stock=True)
            cad_fb_min = (CAD_FALLBACK.get(assumptions.get("cadDifficulty", "Standard"), 6)) * sheets_req
            cad_hrs = ((CAD_SETUP.get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
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
        upgrade_adder = GRADE_ADDER_DEFAULTS.get(upgrade_grade, 0)
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
            cad_fb_min = (CAD_FALLBACK.get(assumptions.get("cadDifficulty", "Standard"), 6)) * sheets_req
            cad_hrs = ((CAD_SETUP.get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
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
    def try_oversize_fallback(w: float, l: float, label: str) -> Optional[Dict[str, Any]]:
        bi = {**board_spec, "widthIn": w, "lengthIn": l}
        bc = calc_board(bi, total_qty)
        if not bc["hasPrice"]:
            return None
        layout = {"numUp": 1, "numOut": 1, "pcsPerSheet": 1, "wastePct": 0, "sheetW": w, "sheetL": l}
        sheet = {"id": label, "g": board_spec["boardGrade"], "f": board_spec["flute"],
                 "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"], "md": board_spec["medium"],
                 "w": w, "l": l}
        cad_fb_min = (CAD_FALLBACK.get(assumptions.get("cadDifficulty", "Standard"), 6)) * total_qty
        cad_hrs = ((CAD_SETUP.get(assumptions.get("cadDifficulty", "Standard"), 15)) + cad_fb_min) / 60
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


def auto_route(cad_hrs: float, selected_sheet: Dict[str, Any], one_up_w: float, one_up_l: float,
               board_spec: Dict[str, Any], total_qty: int, assumptions: Dict[str, Any]) -> Dict[str, Any]:
    """Auto-routing (RULE-017 through RULE-021). Port of L559-634."""
    # D-121 RULE-021 + D-123: Bobst first-preference
    if assumptions.get("bobstFirstSizing") != "false":
        b_sel = select_bobst_sheet(one_up_w, one_up_l, board_spec, total_qty, assumptions)
        if b_sel and b_sel.get("viable"):
            return {"route": "Bobst", "sheet": b_sel, "warning": None, "cadHrs": cad_hrs}

    # RULE-017: CAD default
    if cad_hrs <= 8:
        return {"route": "CAD", "sheet": selected_sheet, "warning": None}

    # RULE-018: Crest threshold
    n_up = math.floor((CREST_MAX_W - 2) / one_up_w)
    n_out = math.floor((CREST_MAX_L - 2) / one_up_l)
    if n_up >= 1 and n_out >= 1:
        sh_w = n_up * one_up_w + 2
        sh_l = n_out * one_up_l + 2
        pcs_per_sheet = n_up * n_out
        sheets_req = math.ceil(total_qty / pcs_per_sheet)
        bi = {**board_spec, "widthIn": sh_w, "lengthIn": sh_l}
        bc = calc_board(bi, sheets_req)
        waste_pct = 1 - ((n_up * one_up_w * n_out * one_up_l) / (sh_w * sh_l))
        layout = {"numUp": n_up, "numOut": n_out, "pcsPerSheet": pcs_per_sheet,
                  "wastePct": waste_pct, "sheetW": sh_w, "sheetL": sh_l}
        sheet = {"id": f"CREST-{n_up}x{n_out}", "g": board_spec["boardGrade"], "f": board_spec["flute"],
                 "ol": board_spec["outsideLiner"], "il": board_spec["insideLiner"], "md": board_spec["medium"],
                 "w": sh_w, "l": sh_l}
        rule_in_per_pc = pn(assumptions.get("totalRuleInches", 0))
        sheet_rule_inches = rule_in_per_pc * pcs_per_sheet * 1.15 if rule_in_per_pc > 0 else 0
        warning = f"Crest die has {round(sheet_rule_inches)} rule inches per sheet (over 1,000) — needs approval before ordering die" if sheet_rule_inches > 1000 else None

        if bc["pricable"]:
            crest_result = {"sheet": sheet, "layout": layout, "sheetsReq": sheets_req, "bc": bc,
                            "totalCost": bc["total"], "stockMode": False, "customOrder": True}
            return {"route": "Crest", "sheet": crest_result, "warning": warning,
                    "cadHrs": cad_hrs, "sheetRuleInches": sheet_rule_inches}

        # Below min — try stock sheets within Crest limits
        stock_candidates = []
        crest_fb_grade = get_grade_fallback(board_spec["boardGrade"])
        for sh in APPROVED_SHEETS:
            crest_grade_match = sh["g"] == board_spec["boardGrade"] or (crest_fb_grade and sh["g"] == crest_fb_grade)
            if (sh["f"] != board_spec["flute"] or not crest_grade_match or
                sh["ol"] != board_spec["outsideLiner"] or sh["il"] != board_spec["insideLiner"] or
                sh["md"] != board_spec["medium"]):
                continue
            if sh["w"] > CREST_MAX_W or sh["l"] > CREST_MAX_L:
                continue
            s_layout = compute_layout(one_up_w, one_up_l, sh["w"], sh["l"])
            if not s_layout:
                continue
            s_req = math.ceil(total_qty / s_layout["pcsPerSheet"])
            s_bi = {**board_spec, "widthIn": sh["w"], "lengthIn": sh["l"]}
            s_bc = calc_board(s_bi, s_req, is_stock=True)
            if s_bc["pricable"]:
                crest_used_fallback = sh["g"] != board_spec["boardGrade"]
                stock_candidates.append({"sheet": sh, "layout": s_layout, "sheetsReq": s_req, "bc": s_bc,
                                         "totalCost": s_bc["total"], "stockMode": True, "customOrder": False,
                                         "gradeFallback": crest_fb_grade if crest_used_fallback else None})
            elif s_bc["hasPrice"] and not s_bc["meetMin"]:
                stock_sq_ft = (sh["w"] * sh["l"]) / 144
                min_buy = max(1, math.ceil(s_bc["minSqFt"] / stock_sq_ft))
                stock_calc = calc_board(s_bi, min_buy, is_stock=True)
                if stock_calc["pricable"]:
                    scale = s_req / min_buy
                    scaled_total = stock_calc["total"] * scale
                    stock_bc = {**s_bc, "pricable": True, "meetMin": True, "total": scaled_total,
                                "effWithFsc": scaled_total / s_bc["oMsf"] if s_bc["oMsf"] > 0 else 0,
                                "costPc": scaled_total / total_qty if total_qty > 0 else 0,
                                "stockMode": True}
                    stock_candidates.append({"sheet": sh, "layout": s_layout, "sheetsReq": s_req, "bc": stock_bc,
                                             "totalCost": scaled_total, "stockMode": True,
                                             "gradeFallback": crest_fb_grade if sh["g"] != board_spec["boardGrade"] else None})
        if stock_candidates:
            inca_rate = assumptions.get("incaRate", 460)
            cad_rate = assumptions.get("cadRate", 160)
            _r_pr_sh = inca_rate / 100
            _r_ct_sh = cad_rate / 240
            stock_candidates.sort(key=lambda c: c["totalCost"] + c["sheetsReq"] * (_r_pr_sh + _r_ct_sh))
            return {"route": "Crest", "sheet": stock_candidates[0], "warning": warning,
                    "cadHrs": cad_hrs, "sheetRuleInches": sheet_rule_inches}

    # RULE-020: Saber fallback
    return {"route": "Saber + D/C", "sheet": selected_sheet,
            "warning": "Too many CAD hours and no Crest die fits — falling back to Saber + die cut",
            "cadHrs": cad_hrs}
