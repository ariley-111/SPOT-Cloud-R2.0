"""SPOT Cloud — Pricing Admin: HTTP routes.

Admin-only endpoints for managing calibrated rates, GM tier curve, sell tier curve,
and grade adders. Defaults live in engine/core.py; this layer adds DB-backed
overrides with full audit-log retention.

Endpoints (all admin-only):
  GET    /api/admin/rates                   — list all values (with override flag)
  GET    /api/admin/rates/categories        — category metadata for UI
  GET    /api/admin/rates/calibration       — baseline metadata
  PUT    /api/admin/rates/{cat}/{key}       — set/update an override
  DELETE /api/admin/rates/{cat}/{key}       — remove override → restore baseline
  POST   /api/admin/rates/reset-all         — mass reset (optional ?category=)
  GET    /api/admin/rates/audit             — paginated audit log
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel

from routes.auth import require_admin
from models.schemas import User
from services import rate_overrides as svc
from engine import CALIBRATION_BASELINE

router = APIRouter(prefix="/api/admin/rates", tags=["admin-rates"])


# ─── Schemas ────────────────────────────────────────────────────────────
class RateRow(BaseModel):
    category: str
    key: str
    value: Any
    baseline: Any
    is_override: bool


class SetRateBody(BaseModel):
    value: Any  # string for "rate"; numeric for tiers/adders


class BulkSetBody(BaseModel):
    category: str
    values: Dict[str, Any]  # {key: value} — saves a whole section at once


# ─── Category metadata — drives the UI grouping & labels ───────────────
CATEGORY_META = {
    svc.RATE: {
        "label": "Rates",
        "description": "Press, CAD, finishing, ink, and overhead rates",
        # Logical groups within RATE for UI display. Order matters.
        "groups": [
            {"label": "Press rates",        "keys": ["incaRate", "cadRate", "crestRate", "saberRate", "bobstRate"]},
            {"label": "Hand finishing",     "keys": ["handStripRate", "handGlueRate", "saberCostPerCut", "perimStripMinPerPallet"]},
            {"label": "Press speeds",       "keys": ["cadRegSpeed", "crestSpeedVal", "bobstSpeed",
                                                     "cadPerfSpeedFactor", "crestAdvSpeedFactor", "side2Factor"]},
            {"label": "Setup minutes",      "keys": ["crestSetupStd", "crestSetupAdv", "bobstSetup"]},
            {"label": "Minimum charges",    "keys": ["incaMinChg", "cadMinChg", "crestMinChg", "saberMinChg",
                                                     "stripMinChg", "glueMinChg", "bobstMinChg"]},
            {"label": "Ink",                "keys": ["regInkRate", "whiteInkFactor", "regMR", "whiteMR"]},
            {"label": "Tape",               "keys": ["clearTapeCost", "reinfTapeCost", "tapeFtPerPc"]},
            {"label": "Die costs",          "keys": ["crestDieCost", "bobstDieCost"]},
            {"label": "Markups",            "keys": ["freightMarkup", "dieMarkup", "miscChargeMarkup", "purchasedMarginPct"]},
            {"label": "Material & overhead", "keys": ["overheadPct", "spoilagePct", "kemiTariff", "palletPrepFee",
                                                     "under5MsfFee", "stackHeight"]},
            {"label": "Prepress defaults",  "keys": ["defaultPrepressCost", "defaultPrintMode"]},
            {"label": "Bobst sizing",       "keys": ["bobstFirstSizing"]},
        ],
    },
    svc.GM_TIER:   {"label": "GM Curve (Gross Margin tiers)",
                    "description": "Target gross margin by MSF tier (decimal — 0.50 = 50%)"},
    svc.SELL_TIER: {"label": "Sell Curve ($/MSF tiers)",
                    "description": "Target sell price per MSF by tier (dollars)"},
    svc.GRADE:     {"label": "Grade Adders",
                    "description": "Per-MSF cost adder by board grade ($/MSF)"},
    svc.CAD_SETUP_CAT: {
        "label": "CAD Setup (minutes)",
        "description": "One-time CAD/router cutting setup minutes by cutting complexity. "
                       "Setup ÷ 60 × CAD $/hr = the fixed cutting setup cost per job.",
    },
    svc.CAD_FALLBACK_CAT: {
        "label": "CAD Per-Sheet (min/sheet)",
        "description": "Per-sheet CAD cutting minutes by cutting complexity (run-time fallback). "
                       "min/sheet × sheets ÷ 60 × CAD $/hr = the variable cutting run cost.",
    },
    svc.STRIP_CAT: {
        "label": "Hand Stripping (min/sheet)",
        "description": "Hand-stripping minutes per sheet by stripping complexity. "
                       "min/sheet × sheets ÷ 60 × hand-strip $/hr = the stripping cost. "
                       "NOTE: these are legacy placeholders — not yet calibrated to actual costs.",
        "calibrated": False,
    },
    svc.GLUE_CAT: {
        "label": "Hand Gluing (min/joint)",
        "description": "Hand-gluing minutes per joint by gluing complexity. "
                       "min/joint × joints ÷ 60 × hand-glue $/hr = the gluing cost. "
                       "NOTE: these are legacy placeholders — not yet calibrated to actual costs.",
        "calibrated": False,
    },
}


def _build_row(category: str, key: str) -> Dict[str, Any]:
    return {
        "category": category, "key": key,
        "value":    svc.get_effective(category, key),
        "baseline": svc.get_baseline(category, key),
        "is_override": svc.has_override(category, key),
    }


@router.get("")
async def get_all_rates(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    """Return every effective value across all categories, with override flag."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for cat in svc.CATEGORIES:
        out[cat] = [_build_row(cat, k) for k in svc.list_all_keys(cat)]
    return {
        "categories": out,
        "override_count": sum(1 for cat in svc.CATEGORIES
                              for k in svc.list_all_keys(cat) if svc.has_override(cat, k)),
    }


@router.get("/categories")
async def get_categories(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    return CATEGORY_META


@router.get("/calibration")
async def get_calibration(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    """Read-only — fleet R² baseline (D-110 FINAL)."""
    return CALIBRATION_BASELINE


@router.post("/bulk")
async def set_rates_bulk(body: BulkSetBody,
                        admin: User = Depends(require_admin)) -> Dict[str, Any]:
    """Save a whole section at once — applies every {key: value} for one category.
    Only changed keys should be sent by the UI. Each write is individually audited."""
    saved: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for key, val in (body.values or {}).items():
        try:
            saved.append(await svc.set_override(body.category, key, val, admin.email))
        except ValueError as e:
            errors.append({"key": key, "error": str(e)})
        except Exception as e:
            errors.append({"key": key, "error": f"{type(e).__name__}: {e}"})
    if errors and not saved:
        raise HTTPException(400, f"No values saved: {errors}")
    return {"saved": saved, "errors": errors, "count": len(saved)}


@router.put("/{category}/{key}")
async def set_rate(category: str, key: str, body: SetRateBody,
                   admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await svc.set_override(category, key, body.value, admin.email)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@router.delete("/{category}/{key}")
async def reset_rate(category: str, key: str,
                     admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await svc.reset_override(category, key, admin.email)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@router.post("/reset-all")
async def reset_all_rates(category: Optional[str] = Query(None),
                          admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        n = await svc.reset_all(admin.email, category)
        return {"reset_count": n, "category": category or "ALL"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@router.get("/audit")
async def get_audit(limit: int = Query(200, ge=1, le=1000),
                    skip: int = Query(0, ge=0),
                    category: Optional[str] = None,
                    key: Optional[str] = None,
                    _admin: User = Depends(require_admin)) -> Dict[str, Any]:
    rows = await svc.list_audit(limit=limit, skip=skip, category=category, key=key)
    return {"rows": rows, "limit": limit, "skip": skip}
