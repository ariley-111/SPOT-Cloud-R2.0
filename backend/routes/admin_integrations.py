"""SPOT Cloud — Admin: Integrations + Usage routes (admin-only)."""
from __future__ import annotations

from typing import Any, Dict, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel

from routes.auth import require_admin
from models.schemas import User
from services import integrations as integ_svc
from services import parser_usage as usage_svc

router = APIRouter(prefix="/api/admin", tags=["admin-integrations"])


class SetIntegrationBody(BaseModel):
    value: str


@router.get("/integrations")
async def get_integrations(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    return await integ_svc.list_all(redact=True)


@router.put("/integrations/{key_name}")
async def set_integration(key_name: str, body: SetIntegrationBody,
                          admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await integ_svc.set_value(key_name, body.value, admin.email)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/integrations/{key_name}")
async def reset_integration(key_name: str,
                            admin: User = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await integ_svc.reset_value(key_name, admin.email)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/usage")
async def get_usage(months: int = Query(6, ge=1, le=24),
                    customer_code: Optional[str] = Query(None),
                    _admin: User = Depends(require_admin)) -> Dict[str, Any]:
    return await usage_svc.summary(months=months, customer_code=customer_code)
