"""SPOT Pricing Engine — Production cost calculator (calcWF), allocation, freight.

Verbatim port of:
  - calcWF              (spot_engine.js L662-855)
  - allocateJobCost     (spot_engine.js L639-659)
  - calcShipment + helpers (spot_engine.js L861-990)
"""
from __future__ import annotations
import math
from typing import Any, Dict, List, Optional

from .core import (
    PRINT_SPEEDS, CAD_SETUP, CAD_FALLBACK, STRIP_DEFAULTS, GLUE_DEFAULTS,
    GM_DEFAULTS, SELL_DEFAULTS, FLUTE_CALIPERS, ECT_GRADE_FALLBACK,
    RATE_DEFAULTS, get_gm_msf_tier, pn, ceil_int, is_finite,
    active_cad_setup, active_cad_fallback, active_rate_defaults,
    active_strip_defaults, active_glue_defaults,
)


def calc_wf(board_calc: Dict[str, Any], sheet_qty: int, finished_qty: Optional[int],
            fpps: int, prod: Dict[str, Any], asmp: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """WF Production cost. Port of L662-855."""
    if not board_calc or sheet_qty <= 0:
        return None
    b = board_calc
    ord_qty = finished_qty if finished_qty else (sheet_qty * fpps)
    o_msf = b["oMsf"]
    mat_total = b["total"]
    mat_tier = b.get("tier") or "-"
    shipped_msf = sheet_qty * b["sqft"] / 1000

    print_on = prod.get("printRequired") == "Yes"
    white_ink = print_on and prod.get("whiteInk") == "Yes"
    two_sided = print_on and prod.get("printSides") == "2-Sided"
    mk_sheets = (asmp.get("whiteMR", 15) if white_ink else asmp.get("regularMR", 5)) if print_on else 0
    spoil_sheets = ceil_int(sheet_qty * asmp.get("spoilagePct", 0.02)) if print_on else 0
    print_run_sheets = sheet_qty + mk_sheets + spoil_sheets if print_on else 0
    extra_sheets = mk_sheets + spoil_sheets
    mat_makeready = (b["varCost"] + b["pp"]) * extra_sheets / sheet_qty if extra_sheets > 0 and sheet_qty > 0 else 0

    speed = PRINT_SPEEDS.get(prod.get("printMode"), 100) if print_on else 0
    gross_sq_ft = print_run_sheets * b["sqft"] if print_on else 0
    press_hrs = print_run_sheets / speed if print_on and speed > 0 else 0
    press_cost = max(press_hrs * asmp.get("incaRate", 485), asmp.get("incaMinCharge", 0)) if print_on else 0
    ink_cost = gross_sq_ft * asmp.get("regularInkRate", 0.05) if print_on else 0
    white_cost = asmp.get("whiteInkFactor", 0.5) * (mat_total + ink_cost + press_cost) if white_ink else 0
    side1_print = press_cost + ink_cost + white_cost
    side2_cost = side1_print * asmp.get("side2PrintFactor", 0.6) if two_sided else 0
    print_direct = side1_print + side2_cost

    saber_on = prod.get("saber") == "Yes"
    n_cuts = max(1, int(prod.get("saberCuts", 1) or 1)) if saber_on else 0
    blanks_out = max(1, int(prod.get("saberBlanksOut", 1) or 1)) if saber_on else 1
    saber_lifts = ceil_int(sheet_qty / 10) if saber_on else 0
    saber_hrly_cost = max((saber_lifts * 10 / 60) * asmp.get("saberRate", 2),
                          asmp.get("saberMinCharge", 0)) * n_cuts if saber_on else 0
    saber_cut_adder = asmp.get("saberCostPerCut", 0) * n_cuts * sheet_qty if saber_on else 0
    saber_cost = saber_hrly_cost + saber_cut_adder
    conv_sheets = sheet_qty * blanks_out if saber_on else sheet_qty

    # Cutter: CAD or Crest or Bobst
    route = prod.get("route", "CAD")
    cutter_direct = 0
    cutter_basis = ""
    cad_hrs = 0
    if route == "CAD" or route == "Saber + D/C":
        diff = prod.get("cadDifficulty", "Standard")
        setup_min = active_cad_setup().get(diff, 15)
        rule_in = pn(prod.get("totalRuleInches"))
        perf_pct = pn(prod.get("perfPct"))
        override = pn(prod.get("cadSheetsPerHourOverride"))
        p_mats = prod.get("productMats") == "Yes"
        cad_perf_factor = asmp.get("cadPerfSpeedFactor", 0.4)
        cad_reg_speed = asmp.get("cadRegularSpeed", 650)
        cad_perf_speed = cad_reg_speed * cad_perf_factor
        runtime_min = 0
        if override > 0:
            runtime_min = (conv_sheets / override) * 60 if conv_sheets > 0 else 0
            cutter_basis = f"CAD override {override:.0f} sh/hr"
        elif prod.get("cadPricingMethod") == "By Inches of Rule" and rule_in > 0:
            effective_fpps = prod.get("saberPcsPerBlank") if (saber_on and prod.get("saberPcsPerBlank")) else fpps
            sheet_rule_in = rule_in * effective_fpps * 1.15
            total_in = sheet_rule_in * conv_sheets
            runtime_min = (total_in * (1 - perf_pct) / cad_reg_speed) + (total_in * perf_pct / cad_perf_speed) if cad_reg_speed > 0 else 0
            if p_mats:
                runtime_min += 2 * conv_sheets
                setup_min = max(setup_min, active_cad_setup()["Standard"])
            cutter_basis = f"{rule_in:.0f} in/pc x {effective_fpps} out{' /blank' if saber_on else ''} x 1.15 = {sheet_rule_in:.0f} in/{'blank' if saber_on else 'sh'}"
        else:
            bm = active_cad_fallback().get(diff, 6)
            if p_mats:
                bm = max(bm, 5)
                setup_min = max(setup_min, active_cad_setup()["Standard"])
            runtime_min = conv_sheets * bm * ((1 - perf_pct) + (perf_pct / cad_perf_factor)) if cad_perf_factor > 0 else 0
            if p_mats:
                runtime_min += 2 * conv_sheets
            cutter_basis = diff
        cad_hrs = (setup_min + runtime_min) / 60
        cutter_direct = max(cad_hrs * asmp.get("cadRate", 138), asmp.get("cadMinCharge", 0))
    elif route == "Crest":
        c_comp = prod.get("crestComplexity", "Standard")
        crest_setup = asmp.get("crestSetup", {})
        setup_min = crest_setup.get(c_comp) or crest_setup.get("Standard") or 45
        crest_speed = asmp.get("crestSpeed", 150)
        eff_speed = crest_speed * asmp.get("crestAdvSpeedFactor", 0.8) if c_comp == "Advanced" else crest_speed
        runtime_hr = conv_sheets / eff_speed if conv_sheets > 0 and eff_speed > 0 else 0
        cad_hrs = setup_min / 60 + runtime_hr
        cutter_direct = max(cad_hrs * asmp.get("crestRate", 45), asmp.get("crestMinCharge", 0))
        cutter_basis = f"Crest {c_comp}, {conv_sheets:.0f} {'blanks' if saber_on else 'sheets'}"
    elif route == "Bobst":
        setup_min = pn(asmp.get("bobstSetup")) or 45
        eff_speed = pn(asmp.get("bobstSpeed")) or 3000
        runtime_hr = conv_sheets / eff_speed if conv_sheets > 0 and eff_speed > 0 else 0
        cad_hrs = setup_min / 60 + runtime_hr
        bobst_rate = pn(asmp.get("bobstRate")) or 350
        bobst_min = pn(asmp.get("bobstMinCharge")) or 0
        cutter_direct = max(cad_hrs * bobst_rate, bobst_min)
        cutter_basis = f"Bobst flat, {conv_sheets:.0f} {'blanks' if saber_on else 'sheets'} @ {eff_speed:.0f} sh/hr"

    # Die cost
    die_base = 0 if prod.get("dieTreatment") == "None" else pn(prod.get("cuttingDieCost"))
    die_cost = die_base * (1 + pn(prod.get("dieMarkup")))
    die_sep = prod.get("dieTreatment") == "Separate Line" and die_cost > 0
    die_line_cost = die_cost if die_sep else 0
    die_embedded = die_cost if not die_sep else 0
    cutter_direct += die_embedded

    # Hand stripping
    strip_cost = 0
    if prod.get("handStripping") == "Yes":
        sh_h = asmp.get("stackHeight", 48)
        if sh_h <= 0:
            sh_h = 48
        cal = FLUTE_CALIPERS.get(prod.get("flute"), 0.125)
        spp = max(1, math.floor(sh_h / cal))
        perim_pallets = ceil_int(conv_sheets / spp) if prod.get("perimeterStripping") == "Yes" else 0
        perim_min = perim_pallets * asmp.get("perimeterStripMinPallet", 15)
        int_min = conv_sheets * active_strip_defaults().get(prod.get("strippingComplexity"), 1)
        strip_cost = max(((perim_min + int_min) / 60) * asmp.get("handStrippingRate", 17),
                         asmp.get("handStrippingMinCharge", 0))

    # Assembly: glue OR tape
    assembly_cost = 0
    if prod.get("handGluing") == "Yes":
        jppc = pn(prod.get("jointsPerPiece"))
        per_j = active_glue_defaults().get(prod.get("gluingComplexity"), 0.75)
        assembly_cost = max((ord_qty * jppc * per_j / 60) * asmp.get("handGluingRate", 23),
                            asmp.get("handGluingMinCharge", 0))
    elif prod.get("tape") == "Yes":
        cost_per_ft = asmp.get("reinforcedTapeCostPerFt", 0.08) if prod.get("tapeType") == "Reinforced" else asmp.get("clearTapeCostPerFt", 0.03)
        ft_per_pc = asmp.get("tapeFootPerPiece", 2)
        assembly_cost = ord_qty * ft_per_pc * cost_per_ft

    # Freight
    freight_amt = 0 if prod.get("freightTreatment") == "None" else pn(prod.get("freightCost")) * (1 + pn(prod.get("freightMarkup")))
    freight_sep = prod.get("freightTreatment") == "Separate Line" and freight_amt > 0
    freight_line = freight_amt if freight_sep else 0
    freight_embed = freight_amt if not freight_sep else 0

    # Prepress
    prepress_base = pn(prod.get("prepressCost")) if (prod.get("printRequired") == "Yes" and prod.get("prepressTreatment") != "None") else 0
    prepress_cost = prepress_base
    prepress_sep = prod.get("prepressTreatment") == "Separate Line" and prepress_cost > 0
    prepress_line_cost = prepress_cost if prepress_sep else 0
    prepress_embedded = prepress_cost if not prepress_sep else 0

    # Misc charges
    misc_items = prod.get("miscCharges") or []
    misc_line_cost = 0
    misc_embedded = 0
    misc_line_items = []
    for mc in misc_items:
        if mc.get("treatment") == "None" or pn(mc.get("cost")) <= 0:
            continue
        marked = pn(mc.get("cost")) * (1 + pn(prod.get("miscChargeMarkup") or active_rate_defaults()["miscChargeMarkup"]))
        if mc.get("treatment") == "Separate Line":
            misc_line_cost += marked
            misc_line_items.append({"name": mc.get("name"), "amt": marked})
        else:
            misc_embedded += marked

    total_direct = mat_total + mat_makeready + print_direct + saber_cost + cutter_direct + strip_cost + assembly_cost + freight_embed + prepress_embedded + misc_embedded
    die_amort_method = prod.get("dieAmortMethod", "Markup")
    markup_exclude = (die_embedded + freight_embed + prepress_embedded + misc_embedded) if die_amort_method == "Markup" else 0
    direct_for_overhead = total_direct - markup_exclude
    overhead = direct_for_overhead * asmp.get("overheadPct", 0)
    total_mfg = total_direct + overhead
    cost_pc = total_mfg / ord_qty if ord_qty > 0 else 0
    cost_sh = total_mfg / sheet_qty if sheet_qty > 0 else 0
    cost_msf = total_mfg / o_msf if o_msf > 0 else 0

    gm_tier_name = get_gm_msf_tier(o_msf)
    _gm_table = prod.get("gmByTier") or GM_DEFAULTS
    gm_tier = _gm_table[gm_tier_name] if gm_tier_name in _gm_table else (_gm_table.get(mat_tier, 0))
    sell_tier_name = get_gm_msf_tier(o_msf)
    _sell_table = prod.get("sellByTier") or SELL_DEFAULTS
    sell_tier = _sell_table[sell_tier_name] if sell_tier_name in _sell_table else (_sell_table.get(mat_tier, 0))

    item_sell = 0
    if prod.get("pricingBasis") == "Gross Margin %":
        if die_amort_method == "Markup" and markup_exclude > 0:
            mfg_for_margin = total_mfg - markup_exclude
            item_sell = (mfg_for_margin / (1 - gm_tier) + markup_exclude) if ord_qty > 0 and gm_tier < 0.9999 else 0
        else:
            item_sell = (total_mfg / (1 - gm_tier)) if ord_qty > 0 and gm_tier < 0.9999 else 0
    else:
        item_sell = sell_tier * o_msf

    sell_total = item_sell + freight_line + die_line_cost + prepress_line_cost + misc_line_cost
    sell_pc = sell_total / ord_qty if ord_qty > 0 else 0
    sell_sh = sell_total / sheet_qty if sheet_qty > 0 else 0
    sell_msf = item_sell / o_msf if o_msf > 0 else 0
    gm_dollar = item_sell - total_mfg
    gm_pct = gm_dollar / item_sell if item_sell > 0 else 0
    gm_msf = gm_dollar / o_msf if o_msf > 0 else 0

    return {
        "sheetQty": sheet_qty, "ordQty": ord_qty, "fpps": fpps, "oSqFt": b["oSqFt"], "oMSF": o_msf,
        "shippedMSF": shipped_msf, "matTier": mat_tier, "matTotal": mat_total, "matMakeready": mat_makeready,
        "mkSheets": mk_sheets, "spoilSheets": spoil_sheets, "extraSheets": extra_sheets,
        "matPerMsf": mat_total / o_msf if o_msf > 0 else 0,
        "printRunSheets": print_run_sheets, "convSheets": conv_sheets, "grossSqFt": gross_sq_ft,
        "pressHrs": press_hrs, "pressCost": press_cost, "inkCost": ink_cost, "whiteCost": white_cost,
        "side2Cost": side2_cost, "printDirect": print_direct,
        "saberCost": saber_cost, "route": route, "cutterDirect": cutter_direct, "cutterBasis": cutter_basis, "cadHrs": cad_hrs,
        "dieLineCost": die_line_cost, "dieSep": die_sep, "dieEmbedded": die_embedded, "dieBase": die_base,
        "dieAmortMethod": die_amort_method, "markupExclude": markup_exclude,
        "stripCost": strip_cost, "assemblyCost": assembly_cost,
        "freightLine": freight_line, "freightEmbed": freight_embed, "freightSep": freight_sep,
        "prepressLineCost": prepress_line_cost, "prepressSep": prepress_sep,
        "prepressEmbedded": prepress_embedded, "prepressBase": prepress_base,
        "miscLineCost": misc_line_cost, "miscEmbedded": misc_embedded, "miscLineItems": misc_line_items,
        "totalDirect": total_direct, "overhead": overhead, "totalMfg": total_mfg,
        "costPc": cost_pc, "costSh": cost_sh, "costMSF": cost_msf,
        "itemSell": item_sell, "sellTotal": sell_total, "sellPc": sell_pc, "sellSh": sell_sh, "sellMSF": sell_msf,
        "gm$": gm_dollar, "gmPct": gm_pct, "gmMSF": gm_msf,
        "pricable": b["pricable"],
        "status": "Pricable" if b["pricable"] else ("Unavailable" if not b["hasPrice"] else "Below Min"),
    }


def allocate_job_cost(items: List[Dict[str, Any]], total_cost: float, method: str) -> List[float]:
    """Allocate job-level cost across MFG items.

    Methods:
      - "Equal": evenly split across MFG items.
      - "By Weight": proportional to each item's shipWeight (D-140 fix —
        previously fell through to MSF; now uses real weight per user's
        explicit freight-allocation choice).
      - default / "By MSF": proportional to each item's oMSF (legacy default).
    """
    if not items or len(items) == 0 or total_cost <= 0:
        return [0] * len(items) if items else []
    mfg_idxs = [i for i, it in enumerate(items) if it.get("type") == "Manufactured"]
    if not mfg_idxs:
        return [0] * len(items)
    alloc = [0] * len(items)
    if method == "Equal":
        share = total_cost / len(mfg_idxs)
        for i in mfg_idxs:
            alloc[i] = share
    elif method == "By Weight":
        total_w = sum(items[i].get("shipWeight", 0) or 0 for i in mfg_idxs)
        if total_w <= 0:
            # Fallback to equal split if no weight data
            share = total_cost / len(mfg_idxs)
            for i in mfg_idxs:
                alloc[i] = share
        else:
            for i in mfg_idxs:
                alloc[i] = total_cost * (items[i].get("shipWeight", 0) or 0) / total_w
    else:
        # "By MSF" (default / legacy)
        total_msf = sum(items[i].get("oMSF", 0) for i in mfg_idxs)
        if total_msf <= 0:
            share = total_cost / len(mfg_idxs)
            for i in mfg_idxs:
                alloc[i] = share
        else:
            for i in mfg_idxs:
                alloc[i] = total_cost * items[i].get("oMSF", 0) / total_msf
    return alloc


# ═══════════════════════════════════════════════════════════════
# Weight / Skid / Freight (port of L861-990)
# ═══════════════════════════════════════════════════════════════
GRADE_LINER_DEFAULTS = {
    "125": {"outer": 26, "inner": 26, "medium": 23},
    "150": {"outer": 33, "inner": 26, "medium": 23},
    "175": {"outer": 42, "inner": 26, "medium": 23},
    "200": {"outer": 42, "inner": 42, "medium": 23},
    "250": {"outer": 69, "inner": 42, "medium": 23},
    "275": {"outer": 69, "inner": 69, "medium": 26},
    "350": {"outer": 90, "inner": 90, "medium": 26},
}
FLUTE_TAKEUP = {"B": 1.36, "C": 1.44, "E": 1.27}
SKID_SIZES = {
    "S": {"label": "Small (40x48)", "w": 40, "l": 48, "weight": 75},
    "L": {"label": "Large (51x72)", "w": 51, "l": 72, "weight": 100},
    "WF": {"label": "Wide Format (60x96)", "w": 60, "l": 96, "weight": 200},
}
SKID_GRIPPER = 0.5
SKID_SIDE_GUIDE = 0.5
SKID_MAX_PRODUCT_HEIGHT = 44
TRAILER_FEET = {
    "S": [4, 4, 8, 8, 12, 12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32, 36, 36, 40, 40, 44, 44, 52, 52],
    "L": [5, 9, 13, 17, 22, 26, 30, 34, 39, 43, 47, 51],
    "WF": [8, 16, 24, 32, 40, 48],
}


def calc_board_weight(board_grade: str, flute: str, outside_liner: str,
                      inside_liner: str, medium_upgrade: str) -> float:
    import re as _re
    mullen_grade = board_grade
    if board_grade and board_grade.startswith("ECT"):
        ect_num = board_grade.replace("ECT ", "").replace("ECT", "")
        fb = ECT_GRADE_FALLBACK.get(ect_num) or ECT_GRADE_FALLBACK.get(board_grade)
        if fb:
            mullen_grade = str(fb)
    defaults = GRADE_LINER_DEFAULTS.get(mullen_grade) or GRADE_LINER_DEFAULTS["200"]
    outer_wt = defaults["outer"]
    if outside_liner and outside_liner != "None":
        m = _re.match(r"^(\d+)#", outside_liner)
        if m:
            outer_wt = int(m.group(1))
    inner_wt = defaults["inner"]
    if inside_liner and inside_liner != "None":
        m2 = _re.match(r"^(\d+)#", inside_liner)
        if m2:
            inner_wt = int(m2.group(1))
    med_wt = defaults["medium"]
    if medium_upgrade and medium_upgrade != "None":
        m3 = _re.match(r"^(\d+)", medium_upgrade)
        if m3:
            med_wt = int(m3.group(1))
    if flute == "B/C":
        take_b = FLUTE_TAKEUP.get("B", 1.36)
        take_c = FLUTE_TAKEUP.get("C", 1.44)
        return outer_wt + inner_wt + (med_wt * take_b) + (med_wt * take_c)
    takeup = FLUTE_TAKEUP.get(flute, 1.36)
    return outer_wt + inner_wt + (med_wt * takeup)


def auto_select_skid(piece_w: float, piece_l: float) -> str:
    for key in ["S", "L", "WF"]:
        sk = SKID_SIZES[key]
        usable_w = sk["w"] - SKID_SIDE_GUIDE
        usable_l = sk["l"] - SKID_GRIPPER
        if (piece_w <= usable_w and piece_l <= usable_l) or (piece_l <= usable_w and piece_w <= usable_l):
            return key
    return "WF"


def calc_pieces_per_skid_layer(piece_w: float, piece_l: float, skid_key: str) -> int:
    sk = SKID_SIZES.get(skid_key)
    if not sk:
        return 1
    usable_w = sk["w"] - SKID_SIDE_GUIDE
    usable_l = sk["l"] - SKID_GRIPPER
    across_w_a = math.floor(usable_w / piece_w) if piece_w > 0 else 0
    across_l_a = math.floor(usable_l / piece_l) if piece_l > 0 else 0
    count_a = across_w_a * across_l_a
    across_w_b = math.floor(usable_w / piece_l) if piece_l > 0 else 0
    across_l_b = math.floor(usable_l / piece_w) if piece_w > 0 else 0
    count_b = across_w_b * across_l_b
    return max(count_a, count_b, 1)


def calc_shipment(board_grade: str, flute: str, outside_liner: str, inside_liner: str,
                  medium_upgrade: str, total_msf: float, piece_w: float, piece_l: float,
                  qty: int, skid_override: Optional[str] = None) -> Dict[str, Any]:
    board_lbs_msf = calc_board_weight(board_grade, flute, outside_liner, inside_liner, medium_upgrade)
    product_weight = board_lbs_msf * total_msf * 1.05
    skid_key = skid_override or auto_select_skid(piece_w, piece_l)
    pcs_per_layer = calc_pieces_per_skid_layer(piece_w, piece_l, skid_key)
    flute_cal = FLUTE_CALIPERS.get(flute, 0.125)
    layers = math.ceil(qty / pcs_per_layer) if qty > 0 else 0
    stack_height = layers * flute_cal
    skid_count = math.ceil(stack_height / SKID_MAX_PRODUCT_HEIGHT) if stack_height > 0 else 1
    skid_total_weight = SKID_SIZES.get(skid_key, {"weight": 75})["weight"] * skid_count
    total_weight = product_weight + skid_total_weight
    ft_table = TRAILER_FEET.get(skid_key, TRAILER_FEET["S"])
    if skid_count <= len(ft_table):
        trailer_feet = ft_table[skid_count - 1]
    else:
        trailer_feet = ft_table[-1] if ft_table else 52
    return {
        "boardLbsMSF": board_lbs_msf,
        "productWeight": round(product_weight),
        "skidKey": skid_key,
        "skidLabel": SKID_SIZES.get(skid_key, {}).get("label", skid_key),
        "pcsPerLayer": pcs_per_layer,
        "layers": layers,
        "stackHeight": round(stack_height * 10) / 10,
        "skidCount": skid_count,
        "skidTotalWeight": skid_total_weight,
        "totalWeight": round(total_weight),
        "trailerFeet": trailer_feet,
    }
