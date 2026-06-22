"""Engine endpoints — wrap the Python engine port (Phase 1)."""
from __future__ import annotations
import functools
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body

from engine import run_estimate, CALIBRATION_BASELINE
from engine.routing import auto_select_sheet, auto_route, compare_routes
from engine.core import RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, APPROVED_SHEETS, get_grade_fallback, ENGINE
from engine.core import BOBST_FLUTES, BOBST_MIN_W, BOBST_MIN_L, BOBST_MAX_W, BOBST_MAX_L
from engine.core import CREST_MAX_W, CREST_MAX_L, MULLEN_UPGRADE, FLUTE_CALIPERS
from engine.core import use_pricing
from models.schemas import User
from routes.auth import get_current_user
from services.pricing_versions import resolve_config, get_active_config, get_active_version, get_version

router = APIRouter(prefix="/api/engine", tags=["engine"])


def with_pricing(fn):
    """Resolve the pricing version for a calc request and apply it for the
    duration of the handler. Reads `pricingVersionId` from the JSON body
    (a saved quote's PINNED version); falls back to the ACTIVE version for
    drafts. calc_board overlays the version's config via the ContextVar."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        payload = kwargs.get("payload")
        vid = None
        if isinstance(payload, dict):
            vid = payload.get("pricingVersionId") or payload.get("pricing_version_id")
        cfg = await resolve_config(vid)
        with use_pricing(cfg):
            return await fn(*args, **kwargs)
    return wrapper




@router.get("/manifest")
async def manifest(version_id: Optional[str] = None,
                   _u: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Return the FULL Board Engine reference data so the Board Engine
    viewer panel can render the actual rates/rules/sheets — not a stale
    hardcoded summary. Legacy parity: matches the data legacy renders at
    spot_r1_5.jsx L6606-6758 from its ENGINE constant.

    Pricing keys (base_matrix + adders) come from the ACTIVE pricing version
    (or `version_id` if given), so activating a new board-price list flips the
    Board Engine panel to the new rates instantly."""
    from collections import Counter
    sheet_counts = Counter((sh["g"], sh["f"]) for sh in APPROVED_SHEETS)
    approved_specs = [
        {"grade": g, "flute": f, "count": n}
        for (g, f), n in sorted(sheet_counts.items())
    ]
    active = await get_active_version()
    active_id = (active or {}).get("id")
    # Show the REQUESTED version (a loaded quote's pinned/frozen version) if given,
    # else the active version. This makes the Board Engine panel reflect exactly
    # what the open quote is priced on — not always the global active version.
    shown = await get_version(version_id) if version_id else active
    if not shown:
        shown = active
    cfg = (shown or {}).get("config")
    eng = {**ENGINE, **(cfg or {})}
    return {
        "msf_tiers": ENGINE["msf_tiers"],
        "base_matrix": eng["base_matrix"],
        "liner_upgrades": eng.get("liner_upgrades") or {},
        "medium_upgrades": eng.get("medium_upgrades") or {},
        "flute_rules": eng.get("flute_rules") or {},
        "dimensional_adders": eng.get("dimensional_adders") or {},
        "fixed_charges": eng.get("fixed_charges") or {},
        "org_limits": ENGINE.get("org_limits") or {},
        "approved_sheets_total": len(APPROVED_SHEETS),
        "approved_specs": approved_specs,
        "pricing_version": {
            "id": shown.get("id"),
            "label": shown.get("label"),
            "effective_date": shown.get("effective_date"),
            "is_baseline": shown.get("is_baseline", False),
            "is_active": shown.get("id") == active_id,
            "active_label": (active or {}).get("label"),
        } if shown else None,
        "constants": {
            "BOBST_FLUTES": BOBST_FLUTES,
            "BOBST_MIN_W": BOBST_MIN_W, "BOBST_MIN_L": BOBST_MIN_L,
            "BOBST_MAX_W": BOBST_MAX_W, "BOBST_MAX_L": BOBST_MAX_L,
            "CREST_MAX_W": CREST_MAX_W, "CREST_MAX_L": CREST_MAX_L,
            "MULLEN_UPGRADE": MULLEN_UPGRADE,
            "FLUTE_CALIPERS": FLUTE_CALIPERS,
        },
    }


@router.post("/calculate")
@with_pricing
async def calculate(
    payload: Dict[str, Any] = Body(...),
    slot_index: int = 0,
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Run a single quote slot through the full pricing pipeline.

    Body matches the JSON shape `spot_runner.runEstimate` expects:
      oneUpW, oneUpL, qtys[], flute, boardGrade, outsideLiner, insideLiner,
      medium, printReq, printMode, printSides, cadDifficulty, etc.
    """
    try:
        result = run_estimate(payload, slot_index)
    except Exception as e:
        raise HTTPException(500, f"Engine error: {type(e).__name__}: {e}")
    return result


@router.post("/calculate-all")
@with_pricing
async def calculate_all(
    payload: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Run every quantity slot in qtys[] through the engine — returns array of results."""
    qtys = payload.get("qtys") or []
    results: List[Dict[str, Any]] = []
    for i, q in enumerate(qtys):
        try:
            qi = int(q)
        except (ValueError, TypeError):
            continue
        if qi <= 0:
            continue
        try:
            r = run_estimate(payload, i)
            results.append({"slot": i, **r})
        except Exception as e:
            results.append({"slot": i, "error": f"{type(e).__name__}: {e}"})
    return {"results": results, "count": len(results)}


@router.get("/defaults")
async def defaults(_u: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Return RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, calibration baseline.

    Used by the frontend to seed new-quote forms.
    """
    return {
        "rate_defaults": RATE_DEFAULTS,
        "gm_defaults": GM_DEFAULTS,
        "sell_defaults": SELL_DEFAULTS,
        "calibration": CALIBRATION_BASELINE,
    }



@router.post("/sheet-library")
async def sheet_library_priced(
    payload: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Enriched Sheet Library — returns every approved sheet (+ user stock
    sheets) with layout + board-cost computed against the active item's W/L/qty
    so the legacy Sheet Library modal can show pcs/sh, sheets, waste, $/MSF,
    cost/pc, total PO per row (spot_r1_5.jsx L8316-8376).

    Body: {
      oneUpW, oneUpL, qty,
      boardGrade, flute, outsideLiner, insideLiner, medium,
      fscEnabled, fscFee, kemiTariff, palletPrepFee, under5MsfFee,
      stockSheets: [ {id, g, f, ol, il, md, w, l, isStock} ],  # per-quote
    }
    """
    from engine.core import compute_layout, calc_board, get_grade_fallback

    p = payload or {}
    try:
        uw = float(p.get("oneUpW") or 0)
        ul = float(p.get("oneUpL") or 0)
        qty = int(float(p.get("qty") or 0))
    except (TypeError, ValueError):
        uw = ul = qty = 0
    if uw <= 0 or ul <= 0 or qty <= 0:
        return {"sheets": [], "warning": "Provide oneUpW, oneUpL, qty > 0"}

    grade = (p.get("boardGrade") or "").strip()
    flute = (p.get("flute") or "").strip()
    ol = (p.get("outsideLiner") or "None").strip()
    il = (p.get("insideLiner") or "None").strip()
    med = (p.get("medium") or "None").strip()

    base_spec = {
        "flute": flute, "boardGrade": grade,
        "outsideLiner": ol, "insideLiner": il, "medium": med,
        "fscEnabled": bool(p.get("fscEnabled")),
        "fscFee": float(p.get("fscFee") or 25),
        "kemiTariff": float(p.get("kemiTariff") or 2.50),
        "palletPrepFee": float(p.get("palletPrepFee") or 17.50),
        "under5MsfFee": float(p.get("under5MsfFee") or 0),
        "widthIn": 0, "lengthIn": 0,
    }

    fb_grade = get_grade_fallback(grade)

    all_sheets = list(APPROVED_SHEETS)
    for ss in (p.get("stockSheets") or []):
        try:
            all_sheets.append({
                "id": ss.get("id") or f"STK-{ss.get('w')}x{ss.get('l')}",
                "g": ss.get("g") or grade, "f": ss.get("f") or flute,
                "ol": ss.get("ol") or ol, "il": ss.get("il") or il,
                "md": ss.get("md") or med,
                "w": float(ss.get("w") or 0), "l": float(ss.get("l") or 0),
                "isStock": True,
            })
        except (TypeError, ValueError):
            continue

    rows: List[Dict[str, Any]] = []
    for sh in all_sheets:
        sw, sl = float(sh.get("w") or 0), float(sh.get("l") or 0)
        if sw <= 0 or sl <= 0:
            continue
        layout = compute_layout(uw, ul, sw, sl)
        if not layout or layout.get("pcsPerSheet", 0) <= 0:
            # Try flipped — match legacy auto-flip semantic
            layout = compute_layout(ul, uw, sw, sl)
            if not layout or layout.get("pcsPerSheet", 0) <= 0:
                continue
        sheets_req = -(-qty // layout["pcsPerSheet"])  # ceil
        bspec = dict(base_spec, widthIn=sw, lengthIn=sl)
        # Use this sheet's actual grade/flute/liner for the board-cost lookup
        bspec.update({
            "boardGrade": sh.get("g") or grade,
            "flute": sh.get("f") or flute,
            "outsideLiner": sh.get("ol") or ol,
            "insideLiner": sh.get("il") or il,
            "medium": sh.get("md") or med,
        })
        bc = calc_board(bspec, sheets_req, bool(sh.get("isStock")))
        cost_msf = bc.get("effWithFsc") if bc and bc.get("pricable") else None
        # LEGACY PARITY (spot_r1_5.jsx L5000): costPc = total / component_qty.
        # `bc["costPc"]` from calc_board returns total/sheets_req (cost per
        # SHEET, not per piece) — different semantics. Sheet Library wants
        # cost-per-piece for the active-item qty, so we override here.
        cost_pc = (bc["total"] / qty) if (bc and bc.get("pricable") and qty > 0) else None
        total = bc.get("total") if bc and bc.get("pricable") else None
        spec_match = (
            (sh.get("g") == grade or (fb_grade and sh.get("g") == fb_grade))
            and sh.get("f") == flute
            and sh.get("ol") == ol and sh.get("il") == il
            and sh.get("md") == med
        )
        rows.append({
            "id": sh.get("id"),
            "w": sw, "l": sl,
            "g": sh.get("g"), "f": sh.get("f"),
            "ol": sh.get("ol"), "il": sh.get("il"), "md": sh.get("md"),
            "isStock": bool(sh.get("isStock")),
            "specMatch": bool(spec_match),
            "pcsPerSheet": layout.get("pcsPerSheet"),
            "sheetsReq": sheets_req,
            "wastePct": layout.get("wastePct"),
            "costMsf": cost_msf, "costPc": cost_pc, "total": total,
            "pricable": bool(bc and bc.get("pricable")),
            "hasPrice": bool(bc and bc.get("hasPrice")),
            "meetMin": bool(bc and bc.get("meetMin")),
        })
    # Sort: spec-match first, then by total PO ascending (best price up top)
    rows.sort(key=lambda r: (
        0 if r["specMatch"] else 1,
        r["total"] if r["pricable"] else 9_999_999,
    ))
    return {"sheets": rows}


@router.get("/sheet-availability")
async def sheet_availability(
    boardGrade: str, flute: str, medium: str = "None",
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return which outside/inside liners have approved stock sheets for the given
    grade/flute/medium combo. Used by the frontend to render the green stock-availability
    dot on liner tiles (legacy spot_r1_5.jsx L5983)."""
    fb_grade = get_grade_fallback(boardGrade)
    ol_set, il_set = set(), set()
    for sh in APPROVED_SHEETS:
        if sh["f"] != flute or sh["md"] != medium:
            continue
        if sh["g"] != boardGrade and not (fb_grade and sh["g"] == fb_grade):
            continue
        ol_set.add(sh["ol"])
        il_set.add(sh["il"])
    return {"outside": sorted(ol_set), "inside": sorted(il_set)}


@router.get("/grade-availability")
async def grade_availability(
    flute: str, medium: str = "None",
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Which board grades have approved stock sheets for the given flute/medium combo?
    Drives green-dot stock indicators on the GRADE row (legacy spot_r1_5.jsx L5983).

    Also flags ECT grades whose Mullen-equivalent (ECT 32 → 200#) IS stocked.
    Returns: {"stocked": [direct-stocked grades], "viaFallback": [ECT grades whose
              Mullen-equiv is stocked]}.
    """
    direct, via_fb = set(), set()
    stocked = set()
    for sh in APPROVED_SHEETS:
        if sh["f"] != flute or sh["md"] != medium:
            continue
        stocked.add(sh["g"])
    for sh in APPROVED_SHEETS:
        if sh["f"] != flute or sh["md"] != medium:
            continue
        direct.add(sh["g"])
    # ECT → Mullen fallback: e.g. ECT 32 → 200#. If 200# is stocked, ECT 32 should
    # also get a (lighter) green dot since it'll auto-substitute to a stocked sheet.
    from engine.core import ECT_GRADE_FALLBACK
    for ect_g, mullen_g in ECT_GRADE_FALLBACK.items():
        if mullen_g in stocked:
            via_fb.add(ect_g)
    return {"stocked": sorted(direct), "viaFallback": sorted(via_fb)}


@router.post("/compare-routes")
@with_pricing
async def compare_routes_ep(
    payload: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """D-090: side-by-side CAD vs Crest vs Bobst route economics for one qty.

    Body: {oneUpW, oneUpL, qty, boardGrade, flute, outsideLiner, insideLiner, medium,
           printReq, printMode, dieTreatment, dieCost, crestComplexity, totalRuleInches, ...}
    """
    try:
        from engine.runner import _build_assumptions  # type: ignore[attr-defined]
    except Exception:
        _build_assumptions = None

    one_w = float(payload.get("oneUpW") or 0)
    one_l = float(payload.get("oneUpL") or 0)
    qty = int(payload.get("qty") or 0)
    if one_w <= 0 or one_l <= 0 or qty <= 0:
        return {"error": "Need oneUpW, oneUpL, and qty"}
    board_spec = {
        "boardGrade": payload.get("boardGrade"), "flute": payload.get("flute"),
        "outsideLiner": payload.get("outsideLiner"), "insideLiner": payload.get("insideLiner"),
        "medium": payload.get("medium") or "None",
        # ── Parity with runner build_board_spec — adders missing from compare-routes
        # caused CAD/Crest Board cost to drop by gradeAdder×MSF (Lynk: -$15/MSF → -$10.93).
        "fscEnabled": bool(payload.get("fscEnabled")),
        "fscFee": float(payload.get("fscFee") or 25),
        "kemiTariff": float(payload.get("kemiTariff") or 2.50),
        "palletPrepFee": float(payload.get("palletPrepFee") or 17.50),
        "under5MsfFee": float(payload.get("under5MsfFee") or RATE_DEFAULTS.get("under5MsfFee") or 0),
        "gradeAdder": float(payload.get("gradeAdder") if payload.get("gradeAdder") is not None
                            else (RATE_DEFAULTS.get("gradeAdder") if RATE_DEFAULTS.get("gradeAdder") is not None
                                  else 0) or (lambda g: 0)(payload.get("boardGrade"))),
    }
    # Compute gradeAdder default from GRADE_ADDER_DEFAULTS if caller didn't supply
    if not payload.get("gradeAdder"):
        from engine.core import GRADE_ADDER_DEFAULTS
        board_spec["gradeAdder"] = float(GRADE_ADDER_DEFAULTS.get(payload.get("boardGrade", "200"), 0) or 0)
    asmp = {**ENGINE,
            "printReq": "Yes" if payload.get("printReq") in ("Yes", "On") else "No",
            "printMode": payload.get("printMode") or "Satin",
            "dieTreatment": payload.get("dieTreatment") or "None",
            "dieCost": payload.get("dieCost") or payload.get("cuttingDieCost") or 0,
            "totalRuleInches": payload.get("totalRuleInches") or 0,
            "crestComplexity": payload.get("crestComplexity") or "Standard",
            "cadDifficulty": payload.get("cadDifficulty") or "Standard",
            "bobstFirstSizing": "true",
            "incaRate": float(RATE_DEFAULTS.get("incaRate", 485) or 485),
            "cadRate": float(RATE_DEFAULTS.get("cadRate", 138) or 138),
            "crestRate": float(RATE_DEFAULTS.get("crestRate", 45) or 45),
            "bobstRate": float(RATE_DEFAULTS.get("bobstRate", 350) or 350),
            "crestSpeed": float(RATE_DEFAULTS.get("crestSpeed", 150) or 150),
            "bobstSpeed": float(RATE_DEFAULTS.get("bobstSpeed", 3000) or 3000),
            "incaMinCharge": float(RATE_DEFAULTS.get("incaMinCharge", 0) or 0),
            "cadMinCharge": float(RATE_DEFAULTS.get("cadMinCharge", 0) or 0),
            "crestMinCharge": float(RATE_DEFAULTS.get("crestMinCharge", 0) or 0),
            "bobstMinCharge": float(RATE_DEFAULTS.get("bobstMinCharge", 0) or 0)}
    opts = {
        "printReq": asmp["printReq"], "printMode": asmp["printMode"],
        "dieTreatment": asmp["dieTreatment"], "dieCost": asmp["dieCost"],
        "crestComplexity": asmp["crestComplexity"],
    }
    try:
        comp = compare_routes(one_w, one_l, board_spec, qty, asmp, opts)
        return comp or {"error": "no result"}
    except Exception as e:
        raise HTTPException(500, f"Route compare error: {type(e).__name__}: {e}")


# ─── Multi-Part (MP-2) ─────────────────────────────────────────────────
# Mirrors legacy spot_r1_5.jsx L3795-3861 (allItemsCosts + setTotals) plus
# per-item type branching (Manufactured / Purchased / Fulfillment).
# Strategy:
#   1) For each bomItems[i] of type "Manufactured", run the standard
#      run_estimate pipeline against a per-item payload constructed by
#      merging the top-level job-level keys + the item's saved state.
#   2) For "Purchased" — cost per piece = purchasedCost (constant or
#      purCostByQty[slot]); sell = cost × (1 + purchasedMarginPct).
#   3) For "Fulfillment" — fee per piece (item.purchasedCost or item.fulfillmentFee);
#      sell = cost × (1 + fulfillmentMarginPct). FUL is excluded from
#      job-level cost allocations.
#   4) Aggregate per slot into Matched Set or Individual totals.
#
# Request body (multi-part state):
#   {
#     quoteType: "Multi-Part",
#     pricingMode: "Matched Set" | "Individual",
#     setMarginPct: "0.40",
#     setMarginOverride: bool,
#     fulfillmentMarginPct: "0.45",
#     purchasedMarginPct: "0.40",
#     qtys: [...5 slots...],                      // top-level set quantities
#     bomItems: [
#       { id, desc, type, pcsPerSet, state: {...item-level intake} }, ...
#     ],
#     // Optional job-level keys (allocated):
#     jobFreightCost, freightScope, freightAllocMethod, jobFreightTreatment,
#     jobPrepressCost, prepressScope, jobPrepressTreatment,
#     // plus any other keys (estInitials, custName, etc.) — passed through.
#   }


def _safe_float(v: Any, d: float = 0.0) -> float:
    try:
        if v is None or v == "": return d
        return float(v)
    except (TypeError, ValueError):
        return d


def _calc_purchased(item: Dict[str, Any], slot: int, qty: int,
                    purchased_margin: float, top: Dict[str, Any]) -> Dict[str, Any]:
    """Purchased item: cost × (1 + markup). Per-piece cost may be slot-specific."""
    st = item.get("state") or {}
    cost_by_qty = st.get("purCostByQty") or {}
    if isinstance(cost_by_qty, dict):
        cost_pc = _safe_float(cost_by_qty.get(slot) or cost_by_qty.get(str(slot))
                              or st.get("purchasedCost") or st.get("purCost") or 0)
    else:
        cost_pc = _safe_float(st.get("purchasedCost") or st.get("purCost") or 0)
    cost = cost_pc * qty
    sell_pc = cost_pc * (1.0 + purchased_margin)
    sell = sell_pc * qty
    return {
        "type": "Purchased", "qty": qty, "totalQty": qty,
        "costPc": cost_pc, "sellPc": sell_pc,
        "totalMfg": cost, "itemSell": sell, "sellTotal": sell,
        "gmDollar": sell - cost, "gmPct": (sell - cost) / sell if sell > 0 else 0,
        "oMSF": 0, "shippedMSF": 0,
        "pricable": cost_pc > 0, "route": "Purchased",
    }


def _calc_fulfillment(item: Dict[str, Any], slot: int, set_qty: int,
                      fulfillment_margin: float, top: Dict[str, Any]) -> Dict[str, Any]:
    """Fulfillment item: per-set fee × set count. Pcs are virtual (1 per set)."""
    st = item.get("state") or {}
    fee_by_qty = st.get("purCostByQty") or {}
    if isinstance(fee_by_qty, dict):
        fee_per_set = _safe_float(fee_by_qty.get(slot) or fee_by_qty.get(str(slot))
                                  or st.get("fulfillmentFee") or st.get("purchasedCost") or 0)
    else:
        fee_per_set = _safe_float(st.get("fulfillmentFee") or st.get("purchasedCost") or 0)
    cost = fee_per_set * set_qty
    sell_per_set = fee_per_set * (1.0 + fulfillment_margin)
    sell = sell_per_set * set_qty
    return {
        "type": "Fulfillment", "qty": set_qty, "totalQty": set_qty,
        "costPc": fee_per_set, "sellPc": sell_per_set,
        "totalMfg": cost, "itemSell": sell, "sellTotal": sell,
        "gmDollar": sell - cost, "gmPct": (sell - cost) / sell if sell > 0 else 0,
        "oMSF": 0, "shippedMSF": 0,
        "pricable": fee_per_set > 0, "route": "Fulfillment",
    }


def _build_item_payload(item: Dict[str, Any], top: Dict[str, Any], item_qtys: List[Any]) -> Dict[str, Any]:
    """Construct a payload for the engine from an item's state + job-level overlays.
    The item's qtys are overridden per the Matched Set ratio (or kept as-is for Individual)."""
    st = dict(item.get("state") or {})
    st["qtys"] = item_qtys
    # Job-level overlays that an item-level run may need to read
    if "estInitials" in top: st.setdefault("estInitials", top["estInitials"])
    if "custName" in top:    st.setdefault("custName", top["custName"])
    if "destZip" in top:     st.setdefault("destZip", top["destZip"])
    if "quoteFOB" in top:    st.setdefault("quoteFOB", top["quoteFOB"])
    return st


@router.post("/calculate-multi-part")
@with_pricing
async def calculate_multi_part(
    payload: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Run an entire Multi-Part quote through the pricing pipeline.
    See module docstring above for body shape. Returns:
      {
        slots: [{ slot, setQty, jobCost, jobSell, gmDollar, gmPct,
                  perComponent: [{itemId, desc, type, pcsPerSet, ...result}] }, ...],
        meta:  { pricingMode, setMarginOverride, setMarginPct, itemCount,
                 manufacturedCount, hasPurchased, hasFulfillment },
      }
    """
    bom_items = payload.get("bomItems") or []
    if not bom_items:
        return {"error": "No bomItems provided", "slots": [], "meta": {}}

    pricing_mode      = payload.get("pricingMode") or "Matched Set"
    set_margin_pct    = _safe_float(payload.get("setMarginPct"), 0.40)
    set_margin_ovride = bool(payload.get("setMarginOverride"))
    purch_margin      = _safe_float(payload.get("purchasedMarginPct"), 0.40)
    ful_margin        = _safe_float(payload.get("fulfillmentMarginPct"), 0.45)
    top_qtys          = payload.get("qtys") or ["", "", "", "", ""]

    # Local delivery (our own truck, zip-resolved carrier) → flat rate, NO markup.
    # Authoritative signal is the resolved carrier (legacy parity — local delivery
    # is determined by destination ZIP, not a user-selectable FOB option).
    job_carrier  = (payload.get("freightCarrier") or "").strip()
    job_is_local = job_carrier in ("SPC Local Delivery", "Local Delivery")
    job_freight_treat_top = payload.get("jobFreightTreatment") or "Separate Line"

    # Iterate qty slots — for each one we compute per-component results then aggregate
    out_slots: List[Dict[str, Any]] = []
    for slot in range(len(top_qtys)):
        try:
            set_qty = int(top_qtys[slot])
        except (TypeError, ValueError):
            set_qty = 0
        if set_qty <= 0:
            continue

        per_comp: List[Dict[str, Any]] = []
        for item in bom_items:
            item_id    = item.get("id") or ""
            item_desc  = item.get("desc") or ""
            item_type  = item.get("type") or "Manufactured"
            pcs_per_set = max(1, int(item.get("pcsPerSet") or 1))

            # Determine this item's qty for this slot
            if pricing_mode == "Matched Set":
                item_qty = set_qty * pcs_per_set
            else:  # Individual — use item's own qtys[slot] (fall back to set_qty if blank)
                ist = item.get("state") or {}
                iqs = ist.get("qtys") or []
                try:
                    raw = int(iqs[slot]) if slot < len(iqs) and iqs[slot] not in ("", None) else set_qty
                except (TypeError, ValueError):
                    raw = set_qty
                # LEGACY PARITY (spot_r1_5.jsx L2071-2075): when committing a BOM
                # draft, legacy stores `state.qtys` PRE-MULTIPLIED by pcsPerSet so
                # every downstream calc (including Individual mode) sees the true
                # component pcs count. Cloud stores raw set qtys; multiply at
                # runtime so Individual mode matches legacy 1:1.
                item_qty = raw * pcs_per_set

            if item_type == "Purchased":
                r = _calc_purchased(item, slot, item_qty, purch_margin, payload)
            elif item_type == "Fulfillment":
                r = _calc_fulfillment(item, slot, set_qty, ful_margin, payload)
            else:
                # Manufactured — full pipeline
                if pricing_mode == "Matched Set":
                    # LEGACY PARITY (spot_r1_5.jsx allItemsCosts builder):
                    #   itemQtys = qtys.map(q => String(pn(q) * pn(pcsPerSet)))
                    # Cloud previously replicated `set_qty * pcs_per_set` 5x
                    # which inflated single-tier quotes' rate-table lookups.
                    # Pass the legacy-shaped qtys so MSF tier classification
                    # mirrors legacy exactly.
                    item_qtys = [str(int(_safe_float(q) * pcs_per_set)) if str(q).strip() else "" for q in top_qtys]
                    # Pad to 5 to match engine's tier-array expectation
                    while len(item_qtys) < 5:
                        item_qtys.append("")
                    use_slot = slot if slot < 5 else 0
                else:
                    # Individual mode — legacy parity (spot_r1_5.jsx L2071-2075):
                    # state.qtys is stored pre-multiplied by pcsPerSet in legacy.
                    # Cloud stores raw set qtys; multiply here so the engine sees
                    # the true component pcs count.
                    raw_qtys = (item.get("state") or {}).get("qtys") or top_qtys
                    item_qtys = [
                        (str(int(_safe_float(q) * pcs_per_set)) if str(q).strip() else "")
                        for q in raw_qtys
                    ]
                    while len(item_qtys) < 5:
                        item_qtys.append("")
                    use_slot = slot
                item_payload = _build_item_payload(item, payload, item_qtys)
                try:
                    r = run_estimate(item_payload, use_slot)
                except Exception as e:
                    r = {"error": f"{type(e).__name__}: {e}", "pricable": False,
                         "qty": item_qty, "totalQty": item_qty,
                         "itemSell": 0, "totalMfg": 0, "sellTotal": 0,
                         "oMSF": 0, "shippedMSF": 0, "gmDollar": 0, "gmPct": 0}
                # Normalize fields used by aggregation
                r["type"] = "Manufactured"
                r.setdefault("totalQty", r.get("qty", item_qty))

            per_comp.append({
                "itemId": item_id, "desc": item_desc, "type": item_type,
                "pcsPerSet": pcs_per_set, **r,
            })

        # ── Job-level allocations (freight + prepress) ──────────────────
        freight_scope = payload.get("freightScope") or "None"
        prepress_scope = payload.get("prepressScope") or "None"
        if freight_scope == "Per Job":
            # Per-slot job freight, MARKUP-INCLUSIVE, on the FINISHED shipped
            # basis (finMSF / finShipWeight). This must match the componentPricing
            # path (lines ~1051-1065) and the right-rail cost buildup so the
            # per-component breakdown chip, the cost buildup line, and the Quote
            # Table tier freight all agree. Legacy parity: spot_r1_5.jsx L3442
            # allocateJobCost(items, slotFreight*(1+freightMarkup), method).
            _jfbs0 = payload.get("jobFreightBySlot") or {}
            _slot_job0 = _jfbs0.get(str(slot), _jfbs0.get(slot)) if isinstance(_jfbs0, dict) else None
            if _slot_job0 in (None, "", "null"):
                _slot_job0 = payload.get("jobFreightCost")
            _mk0_raw = payload.get("freightMarkup")
            _mk0 = 0.0 if job_is_local else _safe_float(_mk0_raw if _mk0_raw not in (None, "") else 0.15)
            job_freight = _safe_float(_slot_job0) * (1.0 + _mk0)
            method = payload.get("freightAllocMethod") or "By MSF"
            # Finished shipped basis — NOT board-consumed oMSF/shipWeight.
            items_for_alloc = [{
                "type": pc.get("type"),
                "oMSF": _safe_float(pc.get("finMSF") or pc.get("oMSF") or 0),
                "shipWeight": _safe_float(pc.get("finShipWeight") or pc.get("shipWeight") or 0),
            } for pc in per_comp]
            from engine.pricing import allocate_job_cost as _alloc
            alloc = _alloc(items_for_alloc, job_freight, method)
            for i, pc in enumerate(per_comp):
                pc["allocatedFreight"] = float(alloc[i] or 0)
        if prepress_scope == "Per Job":
            job_prepress = _safe_float(payload.get("jobPrepressCost"))
            items_for_alloc = [
                {"type": pc.get("type"),
                 "oMSF": pc.get("oMSF", 0) if (pc.get("state", {}) or pc).get("printReq", "Yes") == "Yes" else 0}
                for pc in per_comp
            ]
            from engine.pricing import allocate_job_cost as _alloc
            alloc = _alloc(items_for_alloc, job_prepress, "Equal")
            for i, pc in enumerate(per_comp):
                pc["allocatedPrepress"] = float(alloc[i] or 0)

        # ── Aggregate at job level ──────────────────────────────────────
        job_cost = sum(_safe_float(pc.get("totalMfg")) for pc in per_comp)
        job_sell_components = sum(_safe_float(pc.get("itemSell")) for pc in per_comp)
        # Split line charges by type so the right-rail Cost Buildup can
        # display Freight / Die / Prepress separately (matches Quote Table)
        line_freight = sum(_safe_float(pc.get("freightLine")) for pc in per_comp
                           if _safe_float(pc.get("freightLine")) > 0)
        # If freight is allocated at the JOB level (Per-Job UTS / local delivery),
        # add the job-level total to the aggregate. Per-item freightLine was zeroed
        # in the payload to avoid double-billing. Markup is 0 for local delivery.
        # When jobFreightTreatment == "Amortize" the freight is baked into the
        # component sell (job_sell) and must NOT appear as a separate Freight line.
        job_freight_embed = 0.0
        if freight_scope == "Per Job":
            _mk = 0.0 if job_is_local else _safe_float(
                payload.get("freightMarkup") if payload.get("freightMarkup") not in (None, "") else 0.15)
            # Per-slot job freight: each set-qty tier ships a different combined
            # load, so its UTS-quoted job freight differs. jobFreightBySlot maps
            # {slotIdx: rawCost}; fall back to the flat jobFreightCost only when a
            # per-slot value isn't present (e.g. single-tier quotes / local del.).
            _jfbs = payload.get("jobFreightBySlot") or {}
            _slot_job = _jfbs.get(str(slot), _jfbs.get(slot)) if isinstance(_jfbs, dict) else None
            if _slot_job in (None, "", "null"):
                _slot_job = payload.get("jobFreightCost")
            _job_frt_total = _safe_float(_slot_job) * (1.0 + _mk)
            if job_freight_treat_top == "Separate Line":
                line_freight += _job_frt_total
            else:
                job_freight_embed = _job_frt_total
        line_die = sum(_safe_float(pc.get("dieLineCost")) for pc in per_comp
                       if _safe_float(pc.get("dieLineCost")) > 0)
        # Aggregate die base (pre-markup) so the cost buildup can render
        # "$X + Y% markup" exactly like legacy in Multi-Part mode.
        # Use engine result (which includes auto-applied dies from
        # build_prod_inputs) so all components — not just the active tab —
        # contribute correctly.
        die_base_total = 0.0
        die_markup_amts = []
        bom_items_payload = payload.get("bomItems") or []
        for idx, pc in enumerate(per_comp):
            if _safe_float(pc.get("dieLineCost")) <= 0 and _safe_float(pc.get("dieEmbedded")) <= 0:
                continue
            die_base_total += _safe_float(pc.get("dieBase"))
            # Markup rides with the item state — fall back to engine default.
            st = (bom_items_payload[idx].get("state") if idx < len(bom_items_payload) else None) or {}
            mk = st.get("dieMarkup")
            die_markup_amts.append(_safe_float(mk) if mk not in (None, "") else 0.15)
        die_markup_avg = (sum(die_markup_amts) / len(die_markup_amts)) if die_markup_amts else 0.0
        line_prepress = sum(_safe_float(pc.get("prepressLineCost")) for pc in per_comp
                            if _safe_float(pc.get("prepressLineCost")) > 0)
        line_misc = sum(_safe_float(pc.get("miscLineCost")) for pc in per_comp
                        if _safe_float(pc.get("miscLineCost")) > 0)
        # Aggregate named misc line items across all components so the UI can
        # show the user's actual labels (legacy parity) instead of generic "Misc".
        agg_misc_items: List[Dict[str, Any]] = []
        for pc in per_comp:
            for li in (pc.get("miscLineItems") or []):
                name = li.get("name") or "Misc"
                amt = _safe_float(li.get("amt"))
                if amt <= 0:
                    continue
                # Coalesce duplicates (same name across components) by summing.
                existing = next((x for x in agg_misc_items if x["name"] == name), None)
                if existing:
                    existing["amt"] += amt
                else:
                    agg_misc_items.append({"name": name, "amt": amt})
        line_charges = line_freight + line_die + line_prepress + line_misc
        omsf_total = sum(_safe_float(pc.get("oMSF")) for pc in per_comp)

        if pricing_mode == "Matched Set" and set_margin_ovride:
            # Force uniform GM% across the set
            margin = set_margin_pct
            job_sell = job_cost / (1.0 - margin) if margin < 0.9999 else 0
        else:
            # Aggregate item-level sells (default)
            job_sell = job_sell_components
        # Per-Job freight under "Amortize" is baked into the set sell (not a line).
        job_sell += job_freight_embed

        gm_dollar = job_sell - job_cost
        gm_pct = (gm_dollar / job_sell) if job_sell > 0 else 0
        set_sell = (job_sell / set_qty) if set_qty > 0 else 0
        set_cost = (job_cost / set_qty) if set_qty > 0 else 0
        quote_sell = job_sell + line_charges

        # ── Pull active component's sheet/out for matched-set quote table display ──
        # Aggregated rows lack per-component fields (sheetW, pcsPerSheet, route, etc.)
        # so when the user is viewing the quote table, they see "—" in those cells.
        # Surface the ACTIVE component's values so they always see something useful;
        # to see a different component's specs they switch the active BOM item.
        active_idx = payload.get("activeItemIdx") or 0
        try:
            active_idx = int(active_idx)
        except (TypeError, ValueError):
            active_idx = 0
        active_idx = max(0, min(active_idx, len(per_comp) - 1)) if per_comp else 0
        active_pc = per_comp[active_idx] if per_comp else {}

        # Surface the ACTIVE component's routeWarning only (legacy parity:
        # legacy displays "Too many CAD hours…" for the currently-active BOM
        # component, not aggregated across the job — when the user switches
        # to a non-CAD component the warning disappears).
        slot_route_warning = active_pc.get("routeWarning")

        # Shape compatible with QuoteTableSec's row schema
        out_slots.append({
            "slot": slot,
            "qty": set_qty,                 # for Matched Set this is the SET qty
            "setQty": set_qty,
            "jobCost": job_cost, "jobSell": job_sell,
            "totalMfg": job_cost, "itemSell": job_sell, "sellTotal": quote_sell,
            "setSell": set_sell, "setCost": set_cost, "sellPc": set_sell, "costPc": set_cost,
            "gmDollar": gm_dollar, "gmPct": gm_pct, "gm$": gm_dollar,
            "oMSF": omsf_total,
            "sellMSF": (job_sell / omsf_total) if omsf_total > 0 else 0,
            "costMSF": (job_cost / omsf_total) if omsf_total > 0 else 0,
            "freightLine": line_freight,
            "dieLineCost": line_die,
            "dieBaseTotal": die_base_total,
            "dieMarkupAvg": die_markup_avg,
            "prepressLineCost": line_prepress,
            "miscLineCost": line_misc,
            "miscLineItems": agg_misc_items,
            "itemsSell": job_sell_components,
            "route": active_pc.get("route") or pricing_mode,
            "routeWarning": slot_route_warning,
            # Per-component aggregation can't have a single value — show active's
            "sheetW": active_pc.get("sheetW") or "",
            "sheetL": active_pc.get("sheetL") or "",
            "pcsPerSheet": active_pc.get("pcsPerSheet") or "",
            "pricable": all(pc.get("pricable", True) for pc in per_comp) and job_sell > 0,
            "lineCharges": line_charges,
            "perComponent": per_comp,
        })

    # ── Per-component pricing view (for Quote Table + PDF per-component layout) ──
    # Each component is its own section with its own qty rows. For Individual mode,
    # rows come from the component's own state.qtys (skipping blanks). For Matched
    # Set mode, rows come from the top-level set qtys, with item_qty = set_qty * pcsPerSet.
    component_pricing: List[Dict[str, Any]] = []
    for ci, item in enumerate(bom_items):
        item_id    = item.get("id") or ""
        item_desc  = item.get("desc") or ""
        item_type  = item.get("type") or "Manufactured"
        pcs_per_set = max(1, int(item.get("pcsPerSet") or 1))
        ist = item.get("state") or {}

        # Board / spec sub-header data
        board_spec_view = {
            "boardGrade":   ist.get("boardGrade") or "",
            "flute":        ist.get("flute") or "",
            "outsideLiner": ist.get("outsideLiner") or "",
            "insideLiner":  ist.get("insideLiner") or "",
            "medium":       ist.get("medium") or "None",
            "oneUpW":       ist.get("oneUpW") or "",
            "oneUpL":       ist.get("oneUpL") or "",
            "custIdent":    item.get("custIdent") or ist.get("custIdent") or "",
            "printReq":     ist.get("printReq") or "Yes",
            "printMode":    ist.get("printMode") or "Satin",
            "printSides":   ist.get("printSides") or "1-Sided",
        }

        # Determine the qty list for this component
        if pricing_mode == "Individual":
            # Use this component's OWN qtys — only non-blank entries.
            # LEGACY PARITY (spot_r1_5.jsx L2071-2075): state.qtys is stored
            # pre-multiplied by pcsPerSet. Cloud stores raw set qtys; multiply
            # here so Individual mode prices the true component pcs count.
            comp_qtys: List[int] = []
            comp_slot_idx: List[int] = []  # which top-level slot each row came from
            iqs = ist.get("qtys") or []
            for slot_i in range(min(len(iqs), len(top_qtys))):
                v = iqs[slot_i]
                try:
                    qv = int(v) if v not in ("", None) else 0
                except (TypeError, ValueError):
                    qv = 0
                if qv > 0:
                    comp_qtys.append(qv * pcs_per_set)
                    comp_slot_idx.append(slot_i)
        else:
            # Matched Set: use top-level set qtys; item_qty = set_qty * pcs_per_set
            comp_qtys = []
            comp_slot_idx = []
            for slot_i, sq in enumerate(top_qtys):
                try:
                    sq_int = int(sq)
                except (TypeError, ValueError):
                    sq_int = 0
                if sq_int > 0:
                    comp_qtys.append(sq_int * pcs_per_set)
                    comp_slot_idx.append(slot_i)

        # Build the qty rows for this component
        rows_out: List[Dict[str, Any]] = []
        for row_i, (iq, slot_i) in enumerate(zip(comp_qtys, comp_slot_idx)):
            if item_type == "Purchased":
                r = _calc_purchased(item, slot_i, iq, purch_margin, payload)
            elif item_type == "Fulfillment":
                # Fulfillment fee is per-set; iq here = component qty (post-multiply).
                # Convert back to set qty for the fulfillment fee math.
                set_qty_for_ful = (iq // pcs_per_set) if pcs_per_set > 0 else iq
                r = _calc_fulfillment(item, slot_i, set_qty_for_ful, ful_margin, payload)
            else:
                # Manufactured — run engine.
                # Place `iq` at the REAL top-level slot index (slot_i) and price
                # that slot, so per-slot resolutions (per-qty misc costByQty,
                # freightByQty) pick the value for THIS quantity tier — not always
                # slot 0. (Bug: per-qty Clips only applied to qty 100.)
                n_slots = max(5, slot_i + 1)
                item_qtys = ["" for _ in range(n_slots)]
                use_slot = slot_i
                item_qtys[use_slot] = str(iq)
                item_payload = _build_item_payload(item, payload, item_qtys)
                try:
                    r = run_estimate(item_payload, use_slot)
                except Exception as e:
                    r = {"error": f"{type(e).__name__}: {e}", "pricable": False,
                         "qty": iq, "totalQty": iq,
                         "itemSell": 0, "totalMfg": 0, "sellTotal": 0,
                         "oMSF": 0, "shippedMSF": 0, "gmDollar": 0, "gmPct": 0}

            # Compute derived display fields
            qty_val = float(r.get("qty") or iq)
            sell_total = float(r.get("itemSell") or r.get("sellTotal") or 0)
            cost_total = float(r.get("totalMfg") or 0)
            sell_pc = (sell_total / qty_val) if qty_val > 0 else 0
            cost_pc = (cost_total / qty_val) if qty_val > 0 else 0
            o_msf = float(r.get("oMSF") or 0)
            sell_msf = (sell_total / o_msf) if o_msf > 0 else 0
            cost_msf = (cost_total / o_msf) if o_msf > 0 else 0
            cad_hrs = float(r.get("cadHrs") or 0)

            rows_out.append({
                "slotIdx": slot_i,
                "qty": int(qty_val),
                "setQty": int(qty_val / pcs_per_set) if pcs_per_set > 0 else int(qty_val),
                "sellPc": sell_pc,
                "costPc": cost_pc,
                "perM": sell_pc * 1000.0,
                "sellMSF": sell_msf,
                "costMSF": cost_msf,
                "itemSell": sell_total,
                "totalMfg": cost_total,
                "sheetW": r.get("sheetW") or "",
                "sheetL": r.get("sheetL") or "",
                "pcsPerSheet": r.get("pcsPerSheet") or 0,
                "shipWeight": float(r.get("shipWeight") or 0),  # for By-Weight job freight allocation
                "finMSF": float(r.get("finMSF") or 0),          # finished basis (freight alloc)
                "finShipWeight": float(r.get("finShipWeight") or 0),
                "route": r.get("route") or "",
                "routeWarning": r.get("routeWarning"),  # surface "Too many CAD hours..." per-row
                "cadHrs": cad_hrs,
                "buyMinActive": bool(r.get("buyMinActive")),
                "buyMinSheets": r.get("buyMinSheets"),
                "_pipeline": r.get("_pipeline") or {},  # forward corrFlipped/customOrder/stockMode/exceedsSheetLibrary
                "freightLine": float(r.get("freightLine") or 0),
                "freightEmbed": float(r.get("freightEmbed") or 0),
                "dieLineCost": float(r.get("dieLineCost") or 0),
                "dieEmbedded": float(r.get("dieEmbedded") or 0),
                "dieBase": float(r.get("dieBase") or 0),
                "dieAutoApplied": bool(r.get("dieAutoApplied")),
                "stripCost": float(r.get("stripCost") or 0),
                # Cost Report (internal) column breakdown — legacy spot_r1_5.jsx
                # cost-report parity. Surfaced per-row so the Cost Report modal
                # can render Material/Print/Cutter/Finish/OH columns per component.
                "matTotal": float(r.get("matTotal") or 0),
                "matMakeready": float(r.get("matMakeready") or 0),
                "printDirect": float(r.get("printDirect") or 0),
                "cutterDirect": float(r.get("cutterDirect") or 0),
                "saberCost": float(r.get("saberCost") or 0),
                "assemblyCost": float(r.get("assemblyCost") or 0),
                "overhead": float(r.get("overhead") or 0),
                "sheetsReq": float(r.get("sheetsReq") or 0),
                "prepressLineCost": float(r.get("prepressLineCost") or 0),
                "miscLineCost": float(r.get("miscLineCost") or 0),
                "sellTotal": sell_total
                            + float(r.get("freightLine") or 0)
                            + float(r.get("dieLineCost") or 0)
                            + float(r.get("prepressLineCost") or 0)
                            + float(r.get("miscLineCost") or 0),
                "gmDollar": float(r.get("gmDollar") or 0),
                "gmPct": float(r.get("gmPct") or 0),
                "oMSF": o_msf,
                "pricable": bool(r.get("pricable")),
                "error": r.get("error"),
            })

        component_pricing.append({
            "itemId": item_id,
            "itemIndex": ci,
            "desc": item_desc,
            "type": item_type,
            "pcsPerSet": pcs_per_set,
            "boardSpec": board_spec_view,
            "rows": rows_out,
        })

    # ── Legacy parity: Allocate Per-Job freight + prepress across components ──
    # Legacy `allocateJobCost(items, totalCost, method)` (spot_r1_5.jsx L897):
    # "Equal" splits across Manufactured items; "By MSF" weights by item oMSF.
    # Purchased/Fulfillment always get 0. We allocate PER SLOT (per qty tier) so
    # multi-qty freight (jobFreightBySlot) flows correctly to each tier.
    freight_scope = (payload.get("freightScope") or "").strip()
    prepress_scope = (payload.get("prepressScope") or "").strip()
    alloc_method = payload.get("freightAllocMethod") or "By MSF"
    prep_alloc_method = payload.get("prepressAllocMethod") or "Equal"
    job_freight_by_slot = payload.get("jobFreightBySlot") or {}
    job_freight_flat = _safe_float(payload.get("jobFreightCost"))
    job_prepress_flat = _safe_float(payload.get("jobPrepressCost"))
    freight_markup_raw = payload.get("freightMarkup")
    # Don't `or 0.15` here — that turns explicit "0" / 0 into 15%! Honor any
    # markup the user actually set, only falling back when truly unset.
    freight_markup = _safe_float(freight_markup_raw if freight_markup_raw not in (None, "") else 0.15)
    job_freight_treat = payload.get("jobFreightTreatment") or "Separate Line"
    job_prep_treat = payload.get("jobPrepressTreatment") or "Separate Line"

    def _alloc_job(items_for_slot, total_cost, method):
        """Port of legacy allocateJobCost. items_for_slot is a list of
        {idx, type, oMSF, shipWeight} pairs aligned with component_pricing order.
        Returns a list of $ allocations (same length). Purchased/Fulfillment get 0."""
        n = len(items_for_slot)
        out = [0.0] * n
        if n == 0 or total_cost <= 0:
            return out
        mfg_idxs = [i for i, it in enumerate(items_for_slot) if (it["type"] or "Manufactured") == "Manufactured"]
        if not mfg_idxs:
            return out
        if method == "Equal":
            share = total_cost / len(mfg_idxs)
            for i in mfg_idxs:
                out[i] = share
        elif method == "By Weight":
            # D-140: TRUE By Weight allocation using each component's shipWeight.
            total_w = sum((items_for_slot[i].get("shipWeight") or 0) for i in mfg_idxs)
            if total_w <= 0:
                share = total_cost / len(mfg_idxs)
                for i in mfg_idxs:
                    out[i] = share
            else:
                for i in mfg_idxs:
                    out[i] = total_cost * ((items_for_slot[i].get("shipWeight") or 0) / total_w)
        else:
            # By MSF — proportional. Fallback to Equal if no MSF data.
            total_msf = sum(items_for_slot[i]["oMSF"] for i in mfg_idxs)
            if total_msf <= 0:
                share = total_cost / len(mfg_idxs)
                for i in mfg_idxs:
                    out[i] = share
            else:
                for i in mfg_idxs:
                    out[i] = total_cost * (items_for_slot[i]["oMSF"] / total_msf)
        return out

    # Allocate per-slot when scope = Per Job. Affects componentPricing rows for
    # each manufactured component, mirroring legacy line 3442 behavior.
    if freight_scope == "Per Job" or prepress_scope == "Per Job":
        # In MP-Individual each component lives at a unique slot, so a per-slot
        # allocation would dump the whole job total on a single component. For
        # Individual mode we instead allocate the total job cost across ALL
        # components by each component's total oMSF (legacy parity for jobs
        # that consolidate to a single freight shipment). Matched Set keeps
        # the per-slot allocation because all components share each slot.
        is_individual = pricing_mode == "Individual"

        if is_individual:
            # Compute total oMSF + shipWeight per component (sum across rows)
            items_for_alloc = []
            for c in component_pricing:
                # Freight allocates on the FINISHED shipped basis (finMSF /
                # finShipWeight), not the board-consumed oMSF/shipWeight.
                tot_msf = sum(float(r.get("finMSF") or r.get("oMSF") or 0) for r in c["rows"])
                ship_w = next((float(r.get("finShipWeight") or r.get("shipWeight") or 0)
                               for r in c["rows"] if (r.get("finShipWeight") or r.get("shipWeight"))), 0)
                items_for_alloc.append({
                    "type": c["type"], "oMSF": tot_msf, "shipWeight": ship_w, "rows": c["rows"],
                })
            # Per-Job freight allocation
            if freight_scope == "Per Job":
                slot_freight = job_freight_flat * (1.0 + (0.0 if job_is_local else freight_markup))
                allocs = _alloc_job(items_for_alloc, slot_freight, alloc_method)
                for j, it in enumerate(items_for_alloc):
                    share = allocs[j]
                    if share <= 0 or not it["rows"]:
                        continue
                    # Distribute share across this component's rows by row oMSF
                    rows = it["rows"]
                    tot = sum(float(r.get("oMSF") or 0) for r in rows) or 1
                    for r in rows:
                        row_share = share * (float(r.get("oMSF") or 0) / tot) if tot > 0 else share / len(rows)
                        r["freightLine"] = row_share if job_freight_treat == "Separate Line" else 0.0
                        r["freightEmbed"] = row_share if job_freight_treat != "Separate Line" else 0.0
                        base_sell = float(r["itemSell"])
                        if r["freightEmbed"] > 0 and float(r["qty"] or 0) > 0:
                            base_sell += r["freightEmbed"]
                            r["itemSell"] = base_sell
                            r["sellPc"] = base_sell / float(r["qty"])
                            r["perM"] = r["sellPc"] * 1000.0
                        r["sellTotal"] = base_sell + r["freightLine"] + float(r["dieLineCost"]) + float(r["prepressLineCost"]) + float(r["miscLineCost"])
            # Per-Job prepress
            if prepress_scope == "Per Job":
                slot_prep = _safe_float(job_prepress_flat)
                allocs_p = _alloc_job(items_for_alloc, slot_prep, prep_alloc_method)
                for j, it in enumerate(items_for_alloc):
                    share = allocs_p[j]
                    if share <= 0 or not it["rows"]:
                        continue
                    rows = it["rows"]
                    tot = sum(float(r.get("oMSF") or 0) for r in rows) or 1
                    for r in rows:
                        row_share = share * (float(r.get("oMSF") or 0) / tot) if tot > 0 else share / len(rows)
                        r["prepressLineCost"] = row_share if job_prep_treat == "Separate Line" else 0.0
                        base_sell = float(r["itemSell"])
                        if job_prep_treat != "Separate Line" and float(r["qty"] or 0) > 0:
                            base_sell += row_share
                            r["itemSell"] = base_sell
                            r["sellPc"] = base_sell / float(r["qty"])
                            r["perM"] = r["sellPc"] * 1000.0
                        r["sellTotal"] = base_sell + float(r["freightLine"]) + float(r["dieLineCost"]) + float(r["prepressLineCost"]) + float(r["miscLineCost"])
        else:
            # Matched Set: per-slot allocation (legacy line 3442 parity)
            all_slots: set = set()
            for c in component_pricing:
                for r in c["rows"]:
                    all_slots.add(r["slotIdx"])
            for slot_i in sorted(all_slots):
                items_for_slot = []
                for c in component_pricing:
                    row = next((r for r in c["rows"] if r["slotIdx"] == slot_i), None)
                    items_for_slot.append({
                        "idx": c["itemIndex"], "type": c["type"],
                        # Freight allocates on the FINISHED shipped basis.
                        "oMSF": float((row or {}).get("finMSF") or (row or {}).get("oMSF") or 0),
                        "shipWeight": float((row or {}).get("finShipWeight") or (row or {}).get("shipWeight") or 0),
                        "row": row,
                    })
                if freight_scope == "Per Job":
                    raw = job_freight_by_slot.get(str(slot_i)) if isinstance(job_freight_by_slot, dict) else None
                    if raw in (None, ""):
                        raw = job_freight_by_slot.get(slot_i) if isinstance(job_freight_by_slot, dict) else None
                    if raw in (None, ""):
                        raw = job_freight_flat
                    slot_freight = _safe_float(raw) * (1.0 + (0.0 if job_is_local else freight_markup))
                    alloc = _alloc_job(items_for_slot, slot_freight, alloc_method)
                    for j, it in enumerate(items_for_slot):
                        if it["row"] is None:
                            continue
                        share = alloc[j]
                        if share <= 0:
                            continue
                        it["row"]["freightLine"] = share if job_freight_treat == "Separate Line" else 0.0
                        it["row"]["freightEmbed"] = share if job_freight_treat != "Separate Line" else 0.0
                        base_sell = float(it["row"]["itemSell"])
                        if it["row"]["freightEmbed"] > 0 and float(it["row"]["qty"] or 0) > 0:
                            base_sell += it["row"]["freightEmbed"]
                            it["row"]["itemSell"] = base_sell
                            it["row"]["sellPc"] = base_sell / float(it["row"]["qty"])
                            it["row"]["perM"] = it["row"]["sellPc"] * 1000.0
                        it["row"]["sellTotal"] = base_sell + it["row"]["freightLine"] + float(it["row"]["dieLineCost"]) + float(it["row"]["prepressLineCost"]) + float(it["row"]["miscLineCost"])
                if prepress_scope == "Per Job":
                    slot_prep = _safe_float(job_prepress_flat)
                    alloc_p = _alloc_job(items_for_slot, slot_prep, prep_alloc_method)
                    for j, it in enumerate(items_for_slot):
                        if it["row"] is None:
                            continue
                        share = alloc_p[j]
                        if share <= 0:
                            continue
                        it["row"]["prepressLineCost"] = share if job_prep_treat == "Separate Line" else 0.0
                        base_sell = float(it["row"]["itemSell"])
                        if job_prep_treat != "Separate Line" and float(it["row"]["qty"] or 0) > 0:
                            base_sell += share
                            it["row"]["itemSell"] = base_sell
                            it["row"]["sellPc"] = base_sell / float(it["row"]["qty"])
                            it["row"]["perM"] = it["row"]["sellPc"] * 1000.0
                        it["row"]["sellTotal"] = base_sell + float(it["row"]["freightLine"]) + float(it["row"]["dieLineCost"]) + float(it["row"]["prepressLineCost"]) + float(it["row"]["miscLineCost"])

    # ── Job-level totals (for footer when Per-Job costs exist) ───────────
    job_totals = {
        "freightScope": payload.get("freightScope") or "None",
        "prepressScope": payload.get("prepressScope") or "None",
        "jobFreightCost": _safe_float(payload.get("jobFreightCost")),
        "jobFreightTreatment": payload.get("jobFreightTreatment") or "",
        "jobPrepressCost": _safe_float(payload.get("jobPrepressCost")),
        "jobPrepressTreatment": payload.get("jobPrepressTreatment") or "",
        "freightAllocMethod": alloc_method,
        "prepressAllocMethod": prep_alloc_method,
        "jobFreightBySlot": job_freight_by_slot if isinstance(job_freight_by_slot, dict) else {},
    }

    meta = {
        "pricingMode": pricing_mode,
        "setMarginOverride": set_margin_ovride,
        "setMarginPct": set_margin_pct,
        "fulfillmentMarginPct": ful_margin,
        "purchasedMarginPct": purch_margin,
        "itemCount": len(bom_items),
        "manufacturedCount": sum(1 for it in bom_items if (it.get("type") or "Manufactured") == "Manufactured"),
        "hasPurchased": any(it.get("type") == "Purchased" for it in bom_items),
        "hasFulfillment": any(it.get("type") == "Fulfillment" for it in bom_items),
    }
    return {
        "slots": out_slots,
        "meta": meta,
        "results": out_slots,
        "componentPricing": component_pricing,
        "jobTotals": job_totals,
    }

