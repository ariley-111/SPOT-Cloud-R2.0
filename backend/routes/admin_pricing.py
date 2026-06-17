"""Admin — Board Pricing Versions (import / diff / activate).

ADMIN ONLY. Flow:
  1. POST /import (xlsx) → parse base_matrix, diff vs active, land a DRAFT version.
  2. GET  /versions, GET /versions/{id} → review (full diff included).
  3. POST /versions/{id}/activate → deliberate go-live (archives prior active).
  4. DELETE /versions/{id} → discard a draft.
The Board Engine panel (/api/engine/manifest) reads the active version, so
activation flips the displayed rates instantly — the preview-vs-prod spot-check.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from models.schemas import User
from routes.auth import require_admin
from services import pricing_versions as pv
from services.pricing_import import parse_workbook, diff_base_matrix

router = APIRouter(prefix="/api/admin/pricing", tags=["admin-pricing"])


@router.get("/versions")
async def list_versions(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    versions = await pv.list_versions()
    active = await pv.get_active_version()
    return {"versions": versions, "active_id": (active or {}).get("id")}


@router.get("/versions/{version_id}")
async def get_version(version_id: str, _admin: User = Depends(require_admin)) -> Dict[str, Any]:
    v = await pv.get_version(version_id)
    if not v:
        raise HTTPException(404, "Pricing version not found")
    active = await pv.get_active_version()
    diff = None
    if active and active.get("config") and v.get("config"):
        diff = diff_base_matrix(
            active["config"].get("base_matrix", {}),
            v["config"].get("base_matrix", {}),
        )
    return {"version": v, "diff": diff, "active_id": (active or {}).get("id")}


@router.post("/import")
async def import_spreadsheet(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    label: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    """Parse an uploaded board-price xlsx → create a DRAFT version (base_matrix
    only; adders carried forward from the active version) → return diff +
    warnings for review. Does NOT activate."""
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Please upload an .xlsx board-price spreadsheet")
    content = await file.read()

    active = await pv.get_active_version()
    if not active or not active.get("config"):
        raise HTTPException(500, "No active pricing version to base the import on")
    base_cfg = active["config"]
    cur_bm = base_cfg.get("base_matrix", {})

    try:
        parsed = parse_workbook(content, cur_bm, requested_sheet=sheet)
    except Exception as e:
        raise HTTPException(400, f"Could not parse spreadsheet: {type(e).__name__}: {e}")

    new_bm = parsed["base_matrix"]
    diff = diff_base_matrix(cur_bm, new_bm)
    if diff["summary"]["cells_changed"] == 0:
        parsed["warnings"].append("No board-rate changes detected vs the active version.")

    # New config = active config with base_matrix replaced (adders carried forward).
    new_cfg = {**base_cfg, "base_matrix": new_bm}

    draft = await pv.create_version(
        label=label or parsed["label"],
        config=new_cfg,
        effective_date=parsed["effective_date"],
        change_summary=diff["summary"],
        source_file=file.filename,
        notes=notes,
        created_by=admin.email,
        status="draft",
    )
    return {
        "version": draft,
        "diff": diff,
        "warnings": parsed["warnings"],
        "sheet_used": parsed["sheet_used"],
        "available_sheets": parsed["available_sheets"],
        "new_grades": parsed["new_grades"],
        "tier_header_labels": parsed["tier_header_labels"],
        "based_on": {"id": active.get("id"), "label": active.get("label")},
    }


@router.post("/versions/{version_id}/activate")
async def activate(version_id: str, admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        v = await pv.activate_version(version_id, user_email=admin.email)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True, "version": v}


@router.delete("/versions/{version_id}")
async def delete_draft(version_id: str, _admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        ok = await pv.delete_version(version_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, "Pricing version not found")
    return {"ok": True}
