"""Engine endpoints — wrap the Python engine port (Phase 1)."""
from __future__ import annotations
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body

from engine import run_estimate, CALIBRATION_BASELINE
from engine.routing import auto_select_sheet, auto_route
from engine.core import RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, APPROVED_SHEETS, get_grade_fallback
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
