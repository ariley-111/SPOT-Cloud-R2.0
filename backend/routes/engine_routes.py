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

