"""Engine endpoints — wrap the Python engine port (Phase 1)."""
from __future__ import annotations
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body

from engine import run_estimate, CALIBRATION_BASELINE
from engine.routing import auto_select_sheet, auto_route, compare_routes
from engine.core import RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, APPROVED_SHEETS, get_grade_fallback, ENGINE
from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/engine", tags=["engine"])


@router.post("/calculate")
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


@router.post("/compare-routes")
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
                    item_qty = int(iqs[slot]) if slot < len(iqs) and iqs[slot] not in ("", None) else set_qty
                except (TypeError, ValueError):
                    item_qty = set_qty

            if item_type == "Purchased":
                r = _calc_purchased(item, slot, item_qty, purch_margin, payload)
            elif item_type == "Fulfillment":
                r = _calc_fulfillment(item, slot, set_qty, ful_margin, payload)
            else:
                # Manufactured — full pipeline
                if pricing_mode == "Matched Set":
                    item_qtys = [str(set_qty * pcs_per_set)] * 5
                    use_slot = slot if slot < 5 else 0
                    # Mirror the chosen slot to position `slot` so run_estimate picks it up
                    item_qtys[slot] = str(item_qty)
                else:
                    item_qtys = [str(q or "") for q in ((item.get("state") or {}).get("qtys") or top_qtys)]
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
            job_freight = _safe_float(payload.get("jobFreightCost"))
            method = payload.get("freightAllocMethod") or "By MSF"
            items_for_alloc = [{"type": pc.get("type"), "oMSF": pc.get("oMSF", 0)} for pc in per_comp]
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
        line_charges = sum(max(0.0, _safe_float(pc.get("sellTotal")) - _safe_float(pc.get("itemSell")))
                           for pc in per_comp)
        omsf_total = sum(_safe_float(pc.get("oMSF")) for pc in per_comp)

        if pricing_mode == "Matched Set" and set_margin_ovride:
            # Force uniform GM% across the set
            margin = set_margin_pct
            job_sell = job_cost / (1.0 - margin) if margin < 0.9999 else 0
        else:
            # Aggregate item-level sells (default)
            job_sell = job_sell_components

        gm_dollar = job_sell - job_cost
        gm_pct = (gm_dollar / job_sell) if job_sell > 0 else 0
        set_sell = (job_sell / set_qty) if set_qty > 0 else 0
        set_cost = (job_cost / set_qty) if set_qty > 0 else 0
        quote_sell = job_sell + line_charges

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
            "freightLine": line_charges,
            "route": pricing_mode,
            "pricable": all(pc.get("pricable", True) for pc in per_comp) and job_sell > 0,
            "lineCharges": line_charges,
            "perComponent": per_comp,
        })

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
    return {"slots": out_slots, "meta": meta, "results": out_slots}

