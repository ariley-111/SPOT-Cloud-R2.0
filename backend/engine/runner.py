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
    active_rate_defaults, active_grade_adders,
)
from .routing import auto_select_sheet, auto_route, select_override_sheet
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
    "tapeFootPerPiece": 2, "tapeCostPerInch": 0.00245, "side2PrintFactor": 0.6,
    "cadDifficulty": "Standard", "totalRuleInches": "0", "under5MsfFee": 0, "cadPerfSpeedFactor": 0.4,
    "crestDieCost": 1200,
    "bobstRate": 350, "bobstSpeed": 3000, "bobstSetup": 45, "bobstMinCharge": 250, "bobstDieCost": 1800,
    "bobstFirstSizing": "true",
}


def build_asmp(rate_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {**ASMP_DEFAULTS, **(rate_overrides or {})}


def _canon_field(v: Any, default: str) -> str:
    """Coerce a missing/blank board-spec field to its canonical default.
    A parsed payload can carry "" or null (not just an absent key), which
    `dict.get(k, default)` does NOT catch — and an empty/variant value breaks
    stock-sheet matching (e.g. medium "" never equals a stock sheet's "None"),
    silently forcing a custom mill order + spurious Buy-Min warning."""
    s = "" if v is None else str(v).strip()
    if s == "":
        return default
    return v


def _canon_medium(v: Any) -> str:
    """Medium has no stocked layer unless an explicit doublewall medium is
    called out. Treat blank / 'none' / 'kraft' / 'n/a' variants as 'None' so
    single-wall boards always match their stocked sheet."""
    s = "" if v is None else str(v).strip()
    if s == "" or s.lower() in ("none", "null", "kraft", "n/a", "na"):
        return "None"
    return v


def _canon_liner(v: Any, default: str) -> str:
    """Liner parity (legacy spot_r1_5.jsx): a liner VALUE is never the literal
    string 'Kraft' — legacy stores 'None' and only DISPLAYS it as 'Kraft'
    (`outsideLiner==='None'?'Kraft':...`, L1218/L4625/L5983). A blank coerces to
    the field default. Any incoming 'Kraft'/'none'/'n/a' variant (from the parser
    or imported data) maps to 'None' so stock-sheet matching behaves exactly like
    legacy (there is no Kraft/Kraft sheet in the library — only None/Kemi/Kla)."""
    s = "" if v is None else str(v).strip()
    if s == "":
        return default
    if s.lower() in ("kraft", "none", "null", "n/a", "na"):
        return "None"
    return v


def build_board_spec(json: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "flute": _canon_field(json.get("flute"), "B"),
        "boardGrade": _canon_field(json.get("boardGrade"), "200"),
        "outsideLiner": _canon_liner(json.get("outsideLiner"), "42# Kemi-Lite"),
        "insideLiner": _canon_liner(json.get("insideLiner"), "None"),
        "medium": _canon_medium(json.get("medium")),
        "fscEnabled": bool(json.get("fscEnabled")),
        "fscFee": pn(json.get("fscFee", "25")),
        "kemiTariff": pn(json.get("kemiTariff", "2.50")),
        "palletPrepFee": pn(json.get("palletPrepFee", "17.50")),
        "under5MsfFee": pn(json["under5MsfFee"] if json.get("under5MsfFee") is not None else active_rate_defaults()["under5MsfFee"]),
        "gradeAdder": pn(json["gradeAdder"]) if json.get("gradeAdder") is not None else (active_grade_adders().get(json.get("boardGrade", "200"), 0)),
        "widthIn": 0,
        "lengthIn": 0,
    }


def _resolve_misc_per_slot(misc_charges: Any, slot_index: int) -> List[Dict[str, Any]]:
    """Resolve each misc charge's per-qty cost for THIS slot.

    A misc charge may carry an optional ``costByQty`` map keyed by slot index
    (e.g. {"0": "50", "2": "300"}) so estimators can associate a DIFFERENT flat
    dollar amount with each quantity tier (e.g. 50 clips @ qty1, 300 @ qty3).
    When a per-slot value is present it overrides the flat ``cost`` for that
    tier; otherwise the flat ``cost`` applies (preserving current behavior).
    """
    out: List[Dict[str, Any]] = []
    for mc in (misc_charges or []):
        if not isinstance(mc, dict):
            continue
        cost = mc.get("cost")
        cbq = mc.get("costByQty")
        per = None
        if isinstance(cbq, dict):
            per = cbq.get(str(slot_index))
            if per is None:
                per = cbq.get(slot_index)
        elif isinstance(cbq, list) and 0 <= slot_index < len(cbq):
            per = cbq[slot_index]
        if per is not None and str(per).strip() != "":
            cost = per
        out.append({**mc, "cost": cost})
    return out



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
        # freightByQty arrives from the frontend as a JSON object, so its keys
        # are STRINGS ("0","1",...) even though slot_idx is an int. Look up both
        # forms so per-qty freight resolves per slot (Simple AND MP-Individual).
        val = None
        if isinstance(fbq, dict):
            if slot_idx in fbq:
                val = fbq[slot_idx]
            elif str(slot_idx) in fbq:
                val = fbq[str(slot_idx)]
        elif isinstance(fbq, list) and slot_idx < len(fbq):
            val = fbq[slot_idx]
        # Use the per-slot value when present (incl. a legitimate "0"); only fall
        # back to the flat freightCost when this slot has no entry.
        if val not in (None, "", "null"):
            freight_cost = val
        else:
            freight_cost = json.get("freightCost", "0")

    # ─── Auto-Die (legacy spot_r1_5.jsx L3866-3883 parity) ─────────────────
    # When the resolved route is Crest or Bobst, legacy auto-fills the die
    # cost ($1200 Crest / $1800 Bobst) if the estimator didn't supply one.
    # We do this in the engine (not the React useEffect) so multi-part
    # quotes get auto-die for every component — not just the active tab.
    #
    # NOTE: Saber + D/C is NOT included. Legacy spot_r1_5.jsx L3870 strictly
    # checks `route==="Crest" || route==="Bobst"` for auto-die. Saber+D/C is
    # the fallback route when no Crest die *fits* — by definition no die
    # was viable, so legacy never auto-applies one. (We tried adding it
    # 2026-06-12 and over-applied by 2 dies = $2,760 vs legacy.)
    resolved_route = route_result.get("route") or ""
    any_die_route = resolved_route in ("Crest", "Bobst")
    die_cost_in = pn(json.get("cuttingDieCost", "0"))
    # Legacy parity (spot_r1_5.jsx L3782: `dieTreatment: s.dieTreatment || "Separate Line"`).
    # Restored 2026-06-16 per user decision (A1) — match legacy exactly: when the
    # dieTreatment key is missing/empty, default to "Separate Line". A non-zero
    # cuttingDieCost in saved state will therefore show as a separate die line just
    # as it did in legacy. Auto-apply still fires for Crest/Bobst routes below.
    die_treat_in = json.get("dieTreatment") or "Separate Line"
    die_cost_eff: Any = json.get("cuttingDieCost", "0")
    die_treat_eff = die_treat_in
    die_auto_applied = False
    if any_die_route and die_cost_in <= 0 and die_treat_in != "Amortize":
        default_cost = (asmp.get("bobstDieCost") if resolved_route == "Bobst"
                        else asmp.get("crestDieCost"))
        if default_cost is None:
            default_cost = 1800 if resolved_route == "Bobst" else 1200
        die_cost_eff = str(default_cost)
        die_treat_eff = "Separate Line"
        die_auto_applied = True

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
        "tapeType": json.get("tapeType", "Film"),
        "tapeStrips": json.get("tapeStrips", "1"),
        "tapeStripLength": json.get("tapeStripLength", "0"),
        "freightCost": freight_cost,
        "freightTreatment": "None" if fob_origin else json.get("freightTreatment", "Separate Line"),
        # Local delivery (our own truck, zip-resolved carrier) is a flat published
        # rate — NEVER marked up. Markup only applies to common-carrier shipments.
        "freightMarkup": ("0" if (json.get("freightCarrier") or "").strip() in ("SPC Local Delivery", "Local Delivery")
                          else json.get("freightMarkup", "0.15")),
        "cuttingDieCost": die_cost_eff,
        "dieTreatment": die_treat_eff,
        "dieMarkup": json.get("dieMarkup", "0.15"),
        "dieAmortMethod": json.get("dieAmortMethod", "Markup"),
        "_dieAutoApplied": die_auto_applied,
        "miscCharges": _resolve_misc_per_slot(json.get("miscCharges", []), json.get("_slotIndex", 0)),
        "miscChargeMarkup": json.get("miscChargeMarkup", "0.15"),
        "prepressCost": prepress_cost,
        "prepressTreatment": "None" if prepress_treat_raw == "None" else prepress_treat,
        "proofCost": json.get("proofCost") or json.get("defaultProofCost") or "200",
        "proofTreatment": json.get("proofTreatment", "None"),
        "proofMarkup": json.get("proofMarkup") if json.get("proofMarkup") is not None else "0",
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

    # STEP 1: Auto-select sheet — or use user override (legacy L3544-3570).
    # overrideSheetId format: "OVR-{w}x{l}" (e.g. "OVR-48x96"). When present,
    # build the sheet directly from those dims and skip auto-route (pin to CAD).
    override_id = json.get("overrideSheetId")
    override_active = False
    best = None
    if override_id and isinstance(override_id, str) and override_id.startswith("OVR-"):
        try:
            w_str, l_str = override_id[4:].split("x", 1)
            ov_w, ov_l = float(w_str), float(l_str)
            best = select_override_sheet(uw, ul, board_spec, qty, ov_w, ov_l, asmp)
            if best:
                override_active = True
        except (ValueError, AttributeError):
            best = None
    if not best:
        best = auto_select_sheet(uw, ul, board_spec, qty, asmp)

    # ─── Legacy parity: pre-compute "flipWouldHelp" for the FE auto-flip gate ──
    # Legacy spot_r1_5.jsx L3949-3953 calls autoSelectSheet(L, W, ...) inside
    # the auto-flip useEffect and only flips when the flipped result is
    # pricable OR (hasPrice AND stockMode). We surface the same boolean here
    # so the frontend can mirror legacy 1:1 without a second engine round-trip.
    flip_would_help = False
    if uw > 0 and ul > 0:
        flipped_sel = auto_select_sheet(ul, uw, board_spec, qty, asmp)
        if flipped_sel:
            fbc = flipped_sel.get("bc") or {}
            flip_would_help = bool(
                fbc.get("pricable")
                or (fbc.get("hasPrice") and flipped_sel.get("stockMode"))
            )

    # ─── Legacy parity (spot_r1_5.jsx) ──────────────────────────────────
    # The engine does NOT auto-flip corrugation internally. Legacy keeps the
    # user's (oneUpW, oneUpL) as the source of truth and lets the FRONTEND
    # auto-flip useEffect (L3941-3957) decide whether to swap state and set
    # corrFlipped. Doing it here AND in the frontend caused a double-flip
    # divergence (Storage Bin v3 regression 2026-06-10).
    corr_flipped = False

    if not best:
        return {"error": "No sheet found", "uw": uw, "ul": ul, "qty": qty,
                "boardGrade": board_spec["boardGrade"], "flute": board_spec["flute"]}

    # STEP 3: Auto-route. Legacy parity (spot_r1_5.jsx L3578): when a user
    # override (or sheet-mode) is active, route is PINNED to CAD — we do not
    # run autoRoute against Crest/Bobst sheets because the user explicitly
    # picked the sheet they want to cut on. The override badge in the UI
    # reads "ROUTE PINNED TO CAD" for this reason.
    if override_active:
        auto_r = {"route": "CAD", "sheet": best, "warning": None}
    else:
        auto_r = auto_route(best.get("cadHrs", 0), best, uw, ul, board_spec, qty, asmp)

    route_override = json.get("routeOverride") or None
    if route_override and route_override != "Auto":
        if route_override != auto_r["route"]:
            routing = {"route": route_override, "sheet": best, "warning": f"Forced to {route_override}", "forced": True}
            # Legacy parity (spot_r1_5.jsx): the Crest die-approval warning must
            # persist even when the route is FORCED to Crest — it drives the
            # "Crest Approval Required" popup + the per-component quote-table
            # banner. Previously this was overwritten by "Forced to Crest".
            if route_override == "Crest":
                _rin = pn(json.get("totalRuleInches"))
                _pps = (best.get("layout") or {}).get("pcsPerSheet") or 0
                _sheet_rule = _rin * _pps * 1.15 if _rin > 0 else 0
                if _sheet_rule > 1000:
                    routing["warning"] = (f"Crest die has {round(_sheet_rule)} rule inches per sheet "
                                          f"(over 1,000) — needs approval before ordering die")
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

    # PARITY (legacy spot_r1_5.jsx L3608, L3617): downstream calc_board re-calls
    # (Saber, Buy Min) use the ORIGINAL boardSpec — NOT a substituted running
    # grade. Buy Min is always a CUSTOM mill order at the user's SPEC grade,
    # regardless of any stock-substitution that happened during auto-select.
    # The 2026-06-01 "use running grade" diff was a regression vs legacy
    # (proven by Massillon Container quote 2026-06-10).
    board_spec_running = board_spec

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
            bc = calc_board({**board_spec_running, "widthIn": sh_w, "lengthIn": sh_l}, sheets_req,
                            is_stock=use_sheet.get("stockMode", False))

    # STEP 6: Auto Buy Min
    buy_min_board = json.get("buyMinBoard", "Auto")
    board_substitution = json.get("boardSubstitution")
    # Capture pre-buy-min state for the FE auto-flip useEffect (legacy parity:
    # spot_r1_5.jsx L3942-3957 evaluates `hasIssue` against the SEL bc, which
    # is the raw auto-select result — buy-min has not yet been applied at that
    # point in legacy's render order; buy-min auto-enables in a SEPARATE
    # useEffect that fires AFTER auto-flip. Cloud applies buy-min in the same
    # backend pass, so we must expose the pre-buy-min `pricable`/`meetMin`
    # snapshot to mirror legacy's flip decision.
    pre_bm_has_price = bool(bc and bc.get("hasPrice"))
    pre_bm_meet_min = bool(bc and bc.get("meetMin"))
    pre_bm_pricable = bool(bc and bc.get("pricable"))
    if bc and bc["hasPrice"] and not bc["pricable"] and not bc["meetMin"] and buy_min_board == "Auto":
        buy_min_board = "Yes"

    # STEP 7: Buy Min recalc
    force_custom_order = buy_min_board == "Yes" and board_substitution == "forced"
    if buy_min_board == "Yes" and bc and bc["hasPrice"] and ((not bc["pricable"] and not bc["meetMin"]) or force_custom_order):
        bm_sq_ft = (sh_w * sh_l) / 144
        bm_min_sheets = max(1, math.ceil((bc.get("minSqFt") or 15000) / bm_sq_ft))
        bm_bc = calc_board({**board_spec_running, "widthIn": sh_w, "lengthIn": sh_l}, bm_min_sheets, is_stock=False)
        if bm_bc and bm_bc["pricable"]:
            bc = {**bm_bc, "pricable": True, "meetMin": True, "buyMin": True,
                  "buyMinSheets": bm_min_sheets, "actualSheets": sheets_req}

    if not bc or not bc["pricable"]:
        # D-070 Below-Min path: if bc has a price but doesn't meet mill minimum and
        # the user has explicitly turned Buy Min OFF (buyMinBoard==="No"), surface
        # a "Below Min" row instead of a hard error so the Quote Table can render
        # red "Below Min" cells (legacy spot_r1_5.jsx L1111, L5945, L8366 parity).
        is_below_min = bool(bc and bc.get("hasPrice") and not bc.get("meetMin") and not bc.get("pricable"))
        if is_below_min and buy_min_board == "No":
            return {
                "_pipeline": {
                    "belowMin": True,
                    "stockMode": bool(best.get("stockMode") or bc.get("stockMode")),
                    "customOrder": bool(best.get("customOrder")),
                    "gradeFallback": best.get("gradeFallback"),
                    "mediumFallback": best.get("mediumFallback"),
                    "buyMinActive": False,
                    "minSqFt": bc.get("minSqFt") or 25000,
                    "corrFlipped": corr_flipped,
                    "flipWouldHelp": flip_would_help,
                },
                "belowMin": True,
                "pricable": False,
                "status": "Below Min",
                "uw": uw, "ul": ul, "qty": qty,
                "boardGrade": board_spec["boardGrade"], "flute": board_spec["flute"],
                "outsideLiner": board_spec["outsideLiner"], "insideLiner": board_spec["insideLiner"],
                "medium": board_spec["medium"],
                "sheetW": sh_w, "sheetL": sh_l,
                "pcsPerSheet": layout["pcsPerSheet"],
                "sheetsReq": sheets_req,
                "wastePct": layout["wastePct"],
                "gradeFallback": best.get("gradeFallback"),
                "mediumFallback": best.get("mediumFallback"),
                "stockMode": bool(best.get("stockMode") or bc.get("stockMode")),
                "customOrder": bool(best.get("customOrder")),
                "boardHasPrice": True,
                "boardMeetMin": False,
                "route": (routing or {}).get("route") or "",
                "cadHrs": 0,
                # Money fields zeroed; UI will swap for "Below Min" red text
                "itemSell": 0, "sellTotal": 0, "sellPc": 0, "sellMSF": 0,
                "costPc": 0, "costMSF": 0, "totalMfg": 0,
                "gmDollar": 0, "gmPct": 0, "gmMSF": 0,
                "freightLine": 0, "freightEmbed": 0,
            }
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
        "defaultPrepressCost": json.get("defaultPrepressCost") or active_rate_defaults()["defaultPrepressCost"],
        "defaultProofCost": json.get("defaultProofCost") or active_rate_defaults().get("defaultProofCost", "200"),
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

    # FINISHED ship weight (for FREIGHT only): freight is charged on the finished,
    # die-cut product that actually ships — NOT the full board sheets consumed
    # (the trim is recycled at the plant). So compute a separate shipment from the
    # finished one-up footprint (oneUpW × oneUpL × qty), mirroring the freight
    # dashboard's calcShipment. Used for Per-Job freight allocation (By Weight /
    # By MSF). The board-based `ship` above is left untouched for pricing/skids.
    fin_msf = (eff_w * eff_l * qty) / 144000.0 if (eff_w and eff_l and qty) else 0.0
    fin_ship = calc_shipment(board_spec["boardGrade"], board_spec["flute"],
                             board_spec["outsideLiner"], board_spec["insideLiner"], board_spec["medium"],
                             fin_msf, eff_w, eff_l, qty)

    # When force_custom_order, the board IS a custom mill order regardless of
    # the underlying auto-selected stock sheet's flag. Override the surface
    # flags so the Board panel shows "ORDER" (not "STOCK") — legacy parity.
    _stock_mode_eff = bool(best.get("stockMode") or bc.get("stockMode")) and not force_custom_order
    _custom_order_eff = bool(best.get("customOrder")) or force_custom_order

    return {
        "_pipeline": {
            "corrFlipped": corr_flipped,
            "buyMinActive": bool(bc.get("buyMin")),
            "buyMinSheets": bc.get("buyMinSheets"),
            "belowMin": False,
            "isMillMinScaled": bool(best.get("isMillMinScaled") or bc.get("isMillMinScaled")),
            "minBuySheets": best.get("minBuySheets") or bc.get("stockMinBuy"),
            "minSqFt": bc.get("minSqFt") or 25000,
            "gradeFallback": best.get("gradeFallback"),
            "mediumFallback": best.get("mediumFallback"),
            "mullenUpgrade": bool(best.get("mullenUpgrade")),
            "stockMode": _stock_mode_eff,
            "customOrder": _custom_order_eff,
            "exceedsSheetLibrary": bool(best.get("exceedsSheetLibrary")),
            "routeAuto": auto_r["route"],
            "routeForced": routing.get("forced", False),
            "overrideActive": bool(override_active),
            "flipWouldHelp": flip_would_help,
            # Pre-buy-min snapshot — see STEP 6 comment for parity rationale.
            "preBuyMinHasPrice": pre_bm_has_price,
            "preBuyMinMeetMin": pre_bm_meet_min,
            "preBuyMinPricable": pre_bm_pricable,
        },
        "oneUpW": eff_w, "oneUpL": eff_l, "qty": qty,
        "flute": board_spec["flute"], "boardGrade": board_spec["boardGrade"],
        "outsideLiner": board_spec["outsideLiner"], "insideLiner": board_spec["insideLiner"], "medium": board_spec["medium"],
        "sheetW": sh_w, "sheetL": sh_l,
        "sheetId": (use_sheet.get("sheet") or best.get("sheet") or {}).get("id"),
        "pcsPerSheet": layout["pcsPerSheet"],
        "numUp": layout["numUp"], "numOut": layout["numOut"], "wastePct": layout["wastePct"],
        # Saber blank-out hint (legacy spot_r1_5.jsx L6091): "→ N blanks at WxL — M out/blank"
        "saberOut": ((saber_blank_layout or {}).get("pcsPerSheet") if saber_on else None),
        "saberBlankW": (sh_w if saber_on and sh_w > 0 else None),
        "saberBlankL": ((round(sh_l / saber_bo * 100) / 100) if (saber_on and saber_bo and sh_l > 0) else None),
        "saberBlanksOutN": (saber_bo if saber_on else None),
        "sheetsReq": sheets_req,
        "oMSF": wf["oMSF"], "shippedMSF": wf["shippedMSF"], "msfTier": wf["matTier"],
        # D-070 status-bar surface flags
        "buyMinActive": bool(bc.get("buyMin")),
        "buyMinSheets": bc.get("buyMinSheets"),
        "gradeFallback": best.get("gradeFallback"),
        "mediumFallback": best.get("mediumFallback"),
        "mullenUpgrade": bool(best.get("mullenUpgrade")),
        "stockMode": _stock_mode_eff,
        "customOrder": _custom_order_eff,
        "exceedsSheetLibrary": bool(best.get("exceedsSheetLibrary")),
        "exceedsMachineCapacity": bool(best.get("exceedsMachineCapacity")),
        "overrideActive": bool(override_active),
        "boardHasPrice": bool(bc.get("hasPrice")),
        "boardMeetMin": bool(bc.get("meetMin")),
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
        "saberRate": asmp.get("saberRate", 2),
        "inkSqFt": wf.get("grossSqFt") or 0,
        "inkRate": asmp.get("inkPerSqFt") or 0.05,
        # Cutting / Finishing detail
        "cutterBasis": wf.get("cutterBasis") or "",
        "jointsPerPiece": json.get("jointsPerPiece"),
        "gluingComplexity": json.get("gluingComplexity"),
        "route": routing.get("route") or wf["route"], "cadHrs": wf["cadHrs"],
        # Route fallback warning (legacy spot_r1_5.jsx L811-814 + Quote Table banner).
        # Surfaces "Too many CAD hours and no Crest/Bobst route viable — falling back
        # to Saber + die cut" so the frontend can render it as an orange banner.
        "routeWarning": routing.get("warning"),
        "matTotal": wf["matTotal"], "matMakeready": wf["matMakeready"],
        "matPerMsf": wf.get("matPerMsf") or 0,
        "extraSheets": wf.get("extraSheets") or 0,
        "mkSheets": wf.get("mkSheets") or 0,
        "spoilSheets": wf.get("spoilSheets") or 0,
        "pressCost": wf["pressCost"], "inkCost": wf["inkCost"], "whiteCost": wf["whiteCost"],
        "side2Cost": wf["side2Cost"], "printDirect": wf["printDirect"],
        "saberCost": wf["saberCost"], "cutterDirect": wf["cutterDirect"],
        "dieEmbedded": wf["dieEmbedded"], "dieLineCost": wf["dieLineCost"],
        "dieAutoApplied": bool(prod_inputs.get("_dieAutoApplied")),
        "dieBase": wf.get("dieBase") or 0,
        "dieTreatmentEffective": prod_inputs.get("dieTreatment"),
        "stripCost": wf["stripCost"], "assemblyCost": wf["assemblyCost"],
        "freightLine": wf["freightLine"], "freightEmbed": wf["freightEmbed"],
        "prepressLineCost": wf["prepressLineCost"], "prepressEmbedded": wf["prepressEmbedded"],
        "proofLineCost": wf.get("proofLineCost") or 0, "proofEmbedded": wf.get("proofEmbedded") or 0,
        "proofBase": wf.get("proofBase") or 0, "proofTreatment": wf.get("proofTreatment"),
        "miscLineCost": wf["miscLineCost"], "miscLineItems": wf.get("miscLineItems") or [],
        "overhead": wf["overhead"],
        "totalDirect": wf["totalDirect"], "totalMfg": wf["totalMfg"],
        "costPc": wf["costPc"], "costMSF": wf["costMSF"],
        "itemSell": wf["itemSell"], "sellTotal": wf["sellTotal"],
        "sellPc": wf["sellPc"], "sellMSF": wf["sellMSF"],
        "gmDollar": wf["gm$"], "gmPct": wf["gmPct"], "gmMSF": wf["gmMSF"],
        "pricable": wf["pricable"], "status": wf["status"],
        "shipWeight": ship["totalWeight"], "skidCount": ship["skidCount"],
        "skidKey": ship["skidKey"], "trailerFeet": ship["trailerFeet"],
        "boardLbsMSF": ship["boardLbsMSF"],
        # Finished (shipped-product) basis — used for freight allocation only.
        "finMSF": fin_msf, "finShipWeight": fin_ship["totalWeight"],
        # ── Display fields surfaced for Cost Buildup ────────────────────
        "freightMarkup": float(json.get("freightMarkup") or 0),
        "freightCost": float(json.get("freightCost") or 0),
    }
