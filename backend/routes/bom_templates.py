"""SPOT Cloud — BOM Templates routes.

Two scopes:
  - personal: visible only to the owner
  - team:     visible to every authenticated user (org-shared)

Endpoints:
  GET    /api/bom-templates                  → personal + team
  POST   /api/bom-templates                  → create
  PUT    /api/bom-templates/{tid}            → rename / update components
  DELETE /api/bom-templates/{tid}            → owner OR admin
  POST   /api/bom-templates/{tid}/promote    → personal → team (owner OR admin)

Document shape:
  {
    "tid": "tpl_<ts>_<rand>",
    "name": "Counter Display - Standard",
    "scope": "personal" | "team",
    "owner_id": "<user.id>",        # always the original creator
    "owner_email": "...",
    "default_qtys": ["100", "250", "500", "1000", "2500"],
    "components": [
      {"desc": "Base", "type": "Manufactured", "pcs": 1, "on": true}
    ],
    "created_at": "<iso>",
    "updated_at": "<iso>",
  }
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db, COL_BOM_TEMPLATES
from routes.auth import get_current_user
from models.schemas import User

router = APIRouter(prefix="/api/bom-templates", tags=["bom-templates"])


# ─── Pydantic ───────────────────────────────────────────────────────────────

class TemplateComponent(BaseModel):
    desc: str
    type: Literal["Manufactured", "Purchased", "Fulfillment"] = "Manufactured"
    pcs: int = 1
    on: bool = True
    opt: bool = False


class CreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: Literal["personal", "team"] = "personal"
    default_qtys: List[str] = Field(default_factory=lambda: ["", "", "", "", ""])
    components: List[TemplateComponent] = Field(default_factory=list)


class UpdateBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    scope: Optional[Literal["personal", "team"]] = None
    default_qtys: Optional[List[str]] = None
    components: Optional[List[TemplateComponent]] = None


# ─── Helpers ────────────────────────────────────────────────────────────────

def _new_tid() -> str:
    return f"tpl_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{secrets.token_hex(3)}"


def _to_dto(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("tid"),
        "name": doc.get("name"),
        "scope": doc.get("scope", "personal"),
        "owner_id": doc.get("owner_id"),
        "owner_email": doc.get("owner_email"),
        "defaultQtys": doc.get("default_qtys", ["", "", "", "", ""]),
        "components": doc.get("components", []),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_templates(user: User = Depends(get_current_user)) -> Dict[str, List[Dict[str, Any]]]:
    """Personal: only mine. Team: everyone's."""
    cursor = db[COL_BOM_TEMPLATES].find({
        "$or": [{"scope": "team"}, {"owner_id": user.id, "scope": "personal"}],
    })
    docs = await cursor.to_list(length=500)
    personal, team = [], []
    for d in docs:
        dto = _to_dto(d)
        (team if dto["scope"] == "team" else personal).append(dto)
    personal.sort(key=lambda x: (x.get("name") or "").lower())
    team.sort(key=lambda x: (x.get("name") or "").lower())
    return {"personal": personal, "team": team}


@router.post("")
async def create_template(body: CreateBody, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    name = body.name.strip()
    # Block duplicate names within the same effective scope for the same user.
    existing = await db[COL_BOM_TEMPLATES].find_one({
        "name": name,
        "$or": [{"scope": "team"}, {"owner_id": user.id, "scope": "personal"}],
    })
    if existing:
        raise HTTPException(409, f'Template "{name}" already exists')
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "tid": _new_tid(),
        "name": name,
        "scope": body.scope,
        "owner_id": user.id,
        "owner_email": user.email,
        "default_qtys": body.default_qtys,
        "components": [c.model_dump() for c in body.components],
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_BOM_TEMPLATES].insert_one(doc)
    return _to_dto(doc)


@router.put("/{tid}")
async def update_template(tid: str, body: UpdateBody, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    doc = await db[COL_BOM_TEMPLATES].find_one({"tid": tid})
    if not doc:
        raise HTTPException(404, "Template not found")
    # Permission: owner OR admin can edit personal/team; non-owners can NOT
    # touch others' templates (even team), to avoid surprise edits.
    if doc["owner_id"] != user.id and user.role != "admin":
        raise HTTPException(403, "Only the template owner or an admin may edit")
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.scope is not None:
        patch["scope"] = body.scope
    if body.default_qtys is not None:
        patch["default_qtys"] = body.default_qtys
    if body.components is not None:
        patch["components"] = [c.model_dump() for c in body.components]
    await db[COL_BOM_TEMPLATES].update_one({"tid": tid}, {"$set": patch})
    out = await db[COL_BOM_TEMPLATES].find_one({"tid": tid})
    return _to_dto(out)


@router.delete("/{tid}")
async def delete_template(tid: str, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    doc = await db[COL_BOM_TEMPLATES].find_one({"tid": tid})
    if not doc:
        raise HTTPException(404, "Template not found")
    if doc["owner_id"] != user.id and user.role != "admin":
        raise HTTPException(403, "Only the template owner or an admin may delete")
    await db[COL_BOM_TEMPLATES].delete_one({"tid": tid})
    return {"ok": True, "id": tid}


@router.post("/{tid}/promote")
async def promote_to_team(tid: str, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Convert a personal template to a team template. Owner-only (or admin)."""
    doc = await db[COL_BOM_TEMPLATES].find_one({"tid": tid})
    if not doc:
        raise HTTPException(404, "Template not found")
    if doc["owner_id"] != user.id and user.role != "admin":
        raise HTTPException(403, "Only the template owner or an admin may promote")
    if doc.get("scope") == "team":
        return _to_dto(doc)
    await db[COL_BOM_TEMPLATES].update_one(
        {"tid": tid},
        {"$set": {"scope": "team", "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    out = await db[COL_BOM_TEMPLATES].find_one({"tid": tid})
    return _to_dto(out)
