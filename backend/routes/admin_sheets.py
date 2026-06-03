"""SPOT Cloud — Admin: Sheet Library routes (admin-only)."""
from __future__ import annotations

import csv
import io
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from fastapi.responses import PlainTextResponse

from routes.auth import require_admin
from models.schemas import User
from services import sheet_library as svc

router = APIRouter(prefix="/api/admin/sheets", tags=["admin-sheets"])


class AddSheetBody(BaseModel):
    flute: Optional[str] = None
    grade: Optional[str] = None
    outsideLiner: Optional[str] = None
    insideLiner: Optional[str] = None
    medium: Optional[str] = None
    width: Optional[float] = None
    length: Optional[float] = None
    reason: Optional[str] = None


class EditSheetBody(BaseModel):
    flute: Optional[str] = None
    grade: Optional[str] = None
    outsideLiner: Optional[str] = None
    insideLiner: Optional[str] = None
    medium: Optional[str] = None
    width: Optional[float] = None
    length: Optional[float] = None
    reason: Optional[str] = None


class DisableBody(BaseModel):
    reason: Optional[str] = None


@router.get("")
async def list_sheets(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    return await svc.list_all()


@router.post("")
async def add_sheet(body: AddSheetBody, admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await svc.add_sheet(body.dict(exclude_none=True), admin.email, reason=body.reason)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/{sheet_id}")
async def edit_sheet(sheet_id: str, body: EditSheetBody,
                     admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await svc.edit_sheet(sheet_id, body.dict(exclude_none=True),
                                     admin.email, reason=body.reason)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{sheet_id}")
async def disable_sheet(sheet_id: str, reason: Optional[str] = None,
                        admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await svc.disable_sheet(sheet_id, admin.email, reason=reason)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{sheet_id}/enable")
async def enable_sheet(sheet_id: str, admin: User = Depends(require_admin)) -> Dict[str, Any]:
    return await svc.enable_sheet(sheet_id, admin.email)


@router.get("/csv", response_class=PlainTextResponse)
async def export_csv(_admin: User = Depends(require_admin)) -> str:
    data = await svc.list_all()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "flute", "grade", "outsideLiner", "insideLiner", "medium",
                "width", "length", "status", "updated_by", "updated_at"])
    for r in data["rows"]:
        w.writerow([r.get("id", ""), r.get("f", ""), r.get("g", ""),
                    r.get("ol", ""), r.get("il", ""), r.get("md", ""),
                    r.get("w", ""), r.get("l", ""), r.get("status", ""),
                    r.get("updated_by", "") or "", r.get("updated_at", "") or ""])
    return out.getvalue()


@router.post("/csv")
async def import_csv(file: UploadFile = File(...), reason: Optional[str] = Form(None),
                     admin: User = Depends(require_admin)) -> Dict[str, Any]:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV must be UTF-8")
    rows: List[Dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        # Map both legacy column names (f/g/ol/il/md/w/l) and friendly ones
        rows.append({
            "flute": row.get("flute") or row.get("f"),
            "grade": row.get("grade") or row.get("g"),
            "outsideLiner": row.get("outsideLiner") or row.get("ol"),
            "insideLiner":  row.get("insideLiner")  or row.get("il"),
            "medium":       row.get("medium")       or row.get("md"),
            "width":        row.get("width")        or row.get("w"),
            "length":       row.get("length")       or row.get("l"),
        })
    if not rows:
        raise HTTPException(400, "CSV had no data rows")
    return await svc.import_csv(rows, admin.email, reason=reason)
