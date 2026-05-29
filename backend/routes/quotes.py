"""Quote drafts (the 'tabs') + saved quotes."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from db import db, COL_QUOTE_DRAFTS, COL_QUOTES
from models.schemas import (
    Quote, QuoteCreate, QuoteDraft, QuoteDraftCreate, QuoteDraftUpdate, User,
)
from routes.auth import get_current_user


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── DRAFTS ───────────────────────────────────────────────────────────────
drafts_router = APIRouter(prefix="/api/drafts", tags=["drafts"])


@drafts_router.get("", response_model=List[QuoteDraft])
async def list_drafts(user: User = Depends(get_current_user)) -> List[QuoteDraft]:
    cursor = db[COL_QUOTE_DRAFTS].find({"owner_id": user.id}, {"_id": 0}).sort("updated_at", -1)
    docs = await cursor.to_list(length=50)
    return [QuoteDraft(**d) for d in docs]


@drafts_router.post("", response_model=QuoteDraft)
async def create_draft(body: QuoteDraftCreate, user: User = Depends(get_current_user)) -> QuoteDraft:
    draft = QuoteDraft(owner_id=user.id, label=body.label, state=body.state or {})
    await db[COL_QUOTE_DRAFTS].insert_one(draft.model_dump())
    return draft


@drafts_router.get("/{draft_id}", response_model=QuoteDraft)
async def get_draft(draft_id: str, user: User = Depends(get_current_user)) -> QuoteDraft:
    doc = await db[COL_QUOTE_DRAFTS].find_one({"id": draft_id, "owner_id": user.id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return QuoteDraft(**doc)


@drafts_router.put("/{draft_id}", response_model=QuoteDraft)
async def update_draft(draft_id: str, body: QuoteDraftUpdate, user: User = Depends(get_current_user)) -> QuoteDraft:
    update = {"updated_at": _now()}
    if body.label is not None:
        update["label"] = body.label
    if body.est_num is not None:
        update["est_num"] = body.est_num
    if body.state is not None:
        update["state"] = body.state
    result = await db[COL_QUOTE_DRAFTS].find_one_and_update(
        {"id": draft_id, "owner_id": user.id}, {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return QuoteDraft(**result)


@drafts_router.delete("/{draft_id}")
async def delete_draft(draft_id: str, user: User = Depends(get_current_user)) -> dict:
    result = await db[COL_QUOTE_DRAFTS].delete_one({"id": draft_id, "owner_id": user.id})
    if result.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return {"status": "ok"}


# ─── SAVED QUOTES ─────────────────────────────────────────────────────────
quotes_router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@quotes_router.get("", response_model=List[Quote])
async def list_quotes(user: User = Depends(get_current_user), limit: int = 50) -> List[Quote]:
    cursor = db[COL_QUOTES].find({"owner_id": user.id}, {"_id": 0}).sort("updated_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [Quote(**d) for d in docs]


@quotes_router.post("", response_model=Quote)
async def create_quote(body: QuoteCreate, user: User = Depends(get_current_user)) -> Quote:
    quote = Quote(
        owner_id=user.id, est_num=body.est_num,
        customer_code=body.customer_code, customer_name=body.customer_name,
        state=body.state, status=body.status, test_mode=body.test_mode,
    )
    await db[COL_QUOTES].insert_one(quote.model_dump())
    return quote


@quotes_router.get("/{quote_id}", response_model=Quote)
async def get_quote(quote_id: str, user: User = Depends(get_current_user)) -> Quote:
    doc = await db[COL_QUOTES].find_one({"id": quote_id, "owner_id": user.id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return Quote(**doc)


@quotes_router.put("/{quote_id}", response_model=Quote)
async def update_quote(quote_id: str, body: QuoteCreate, user: User = Depends(get_current_user)) -> Quote:
    update = {
        "updated_at": _now(),
        "est_num": body.est_num,
        "state": body.state,
        "status": body.status,
        "customer_code": body.customer_code,
        "customer_name": body.customer_name,
        "test_mode": body.test_mode,
    }
    result = await db[COL_QUOTES].find_one_and_update(
        {"id": quote_id, "owner_id": user.id}, {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return Quote(**result)
