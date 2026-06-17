"""Quote drafts (the 'tabs') + saved quotes."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel

from db import db, COL_QUOTE_DRAFTS, COL_QUOTES, COL_USERS, COL_AUDIT_LOG
from models.schemas import (
    Quote, QuoteCreate, QuoteDraft, QuoteDraftCreate, QuoteDraftUpdate, User,
    AuditLogEntry,
)
from routes.auth import get_current_user
from services.pricing_versions import get_active_version_id


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _user_name_map(user_ids: List[str]) -> Dict[str, str]:
    """Resolve {user_id → display name/email} in one query for owner attribution."""
    if not user_ids:
        return {}
    uniq = list(set(user_ids))
    cursor = db[COL_USERS].find({"id": {"$in": uniq}}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    docs = await cursor.to_list(length=len(uniq))
    return {d["id"]: (d.get("name") or d.get("email") or d["id"]) for d in docs}


async def _attach_owner_names(quotes: List[Quote]) -> List[Dict[str, Any]]:
    """Attach owner_name to each Quote → returned as dict (response_model omitted)."""
    name_map = await _user_name_map([q.owner_id for q in quotes])
    return [{**q.model_dump(), "owner_name": name_map.get(q.owner_id, q.owner_id)} for q in quotes]


async def _log_audit(quote_id: str, user_id: str, field: str, old: Any, new: Any, source: str = "user") -> None:
    entry = AuditLogEntry(
        quote_id=quote_id, user_id=user_id, field=field,
        old_value=old, new_value=new, source=source,
    )
    await db[COL_AUDIT_LOG].insert_one(entry.model_dump())


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


@drafts_router.delete("")
async def delete_all_drafts(user: User = Depends(get_current_user)) -> dict:
    """Delete ALL of the current user's drafts (and purge their parser files)."""
    ids = [d["id"] async for d in db[COL_QUOTE_DRAFTS].find(
        {"owner_id": user.id}, {"_id": 0, "id": 1})]
    result = await db[COL_QUOTE_DRAFTS].delete_many({"owner_id": user.id})
    try:
        from services.parser_files import purge_quote_files
        for did in ids:
            await purge_quote_files(did)
    except Exception:
        pass
    return {"status": "ok", "deleted": result.deleted_count}


@drafts_router.delete("/{draft_id}")
async def delete_draft(draft_id: str, user: User = Depends(get_current_user)) -> dict:
    result = await db[COL_QUOTE_DRAFTS].delete_one({"id": draft_id, "owner_id": user.id})
    if result.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    # Quote-lifetime parser-file storage (2026-06-12) — purge raw uploads tied
    # to this draft so disk + metadata never outlive their owning quote.
    try:
        from services.parser_files import purge_quote_files
        await purge_quote_files(draft_id)
    except Exception:
        # Best-effort — don't fail the delete if cleanup glitches.
        pass
    return {"status": "ok"}


# ─── SAVED QUOTES ─────────────────────────────────────────────────────────
quotes_router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@quotes_router.get("")
async def list_quotes(
    user: User = Depends(get_current_user),
    limit: int = 100,
    scope: str = Query("mine", regex="^(mine|team|all)$"),
    owner_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
) -> List[Dict[str, Any]]:
    """List saved quotes.

    Scope:
      • mine — only current user's quotes (default, legacy behavior)
      • team — everyone's quotes (cross-user coverage use case)
      • all  — alias for team (admin clarity)
    Optional `owner_id` filters to a single user (useful when team view is on).
    Optional `status` filters by current status (draft/saved/sent/won/lost).
    Response is a flat list with `owner_name` joined in for display.
    """
    query: Dict[str, Any] = {}
    if scope == "mine":
        query["owner_id"] = user.id
    if owner_id:
        query["owner_id"] = owner_id
    if status_filter:
        query["status"] = status_filter
    cursor = db[COL_QUOTES].find(query, {"_id": 0}).sort("updated_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    quotes = [Quote(**d) for d in docs]
    result = await _attach_owner_names(quotes)
    # Attach attached-file counts (📎 badge in the Load Quote list) — one query.
    from services.parser_files import count_files_by_quote
    counts = await count_files_by_quote([q.get("id") for q in result])
    for q in result:
        q["file_count"] = counts.get(q.get("id"), 0)
    return result


@quotes_router.post("", response_model=Quote)
async def create_quote(body: QuoteCreate, user: User = Depends(get_current_user)) -> Quote:
    # Pin the pricing version at save time (Board Pricing Freeze). A fresh save
    # pins to whatever is ACTIVE now; re-pricing later is only via Duplicate.
    pinned = body.pricing_version_id or await get_active_version_id()
    quote = Quote(
        owner_id=user.id, est_num=body.est_num,
        customer_code=body.customer_code, customer_name=body.customer_name,
        state=body.state, status=body.status, test_mode=body.test_mode,
        pricing_version_id=pinned,
    )
    await db[COL_QUOTES].insert_one(quote.model_dump())
    return quote


@quotes_router.get("/{quote_id}")
async def get_quote(quote_id: str, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Fetch any team member's quote (read-only access for team coverage)."""
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    quote = Quote(**doc)
    name_map = await _user_name_map([quote.owner_id])
    return {**quote.model_dump(), "owner_name": name_map.get(quote.owner_id, quote.owner_id)}


@quotes_router.put("/{quote_id}", response_model=Quote)
async def update_quote(quote_id: str, body: QuoteCreate, user: User = Depends(get_current_user)) -> Quote:
    """Update is still owner-locked. To edit a teammate's quote, use Take Over first."""
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
        # Distinguish 404 (no quote) from 403 (not owner) for the UI
        existing = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0, "owner_id": 1})
        if existing:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Owned by another user — use Take Over first")
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return Quote(**result)


# ─── TEAM-COVERAGE ENDPOINTS ──────────────────────────────────────────────
class TakeOverRequest(BaseModel):
    reason: Optional[str] = None  # optional free-text for audit log


@quotes_router.post("/{quote_id}/take-over", response_model=Quote)
async def take_over_quote(quote_id: str, body: TakeOverRequest = None,
                          user: User = Depends(get_current_user)) -> Quote:
    """Transfer ownership of a quote to the current user. The original owner
    loses write access. The transfer is logged to the audit collection so
    admins can see who took what from whom."""
    body = body or TakeOverRequest()
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    prev_owner = doc.get("owner_id")
    if prev_owner == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You already own this quote")
    update = {"owner_id": user.id, "updated_at": _now()}
    result = await db[COL_QUOTES].find_one_and_update(
        {"id": quote_id}, {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    # Audit log with optional reason on the entry's source field
    await _log_audit(
        quote_id=quote_id, user_id=user.id, field="owner_id",
        old=prev_owner, new=user.id,
        source=f"take-over: {body.reason}" if body.reason else "take-over",
    )
    return Quote(**result)


@quotes_router.post("/{quote_id}/copy", response_model=Quote)
async def copy_quote(quote_id: str, user: User = Depends(get_current_user)) -> Quote:
    """Clone a quote into a new one owned by the current user. Useful for
    starting from a teammate's quote without taking it over."""
    src = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not src:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    clone = Quote(
        owner_id=user.id,
        est_num=f"{src.get('est_num', '')}-COPY",
        customer_code=src.get("customer_code"),
        customer_name=src.get("customer_name"),
        state=src.get("state") or {},
        status="draft",  # always start a copy as draft
        test_mode=src.get("test_mode", False),
        # Duplicate IS the re-price path: pin the clone to the ACTIVE version
        # so it picks up current board pricing (the original stays frozen).
        pricing_version_id=await get_active_version_id(),
    )
    await db[COL_QUOTES].insert_one(clone.model_dump())
    await _log_audit(
        quote_id=clone.id, user_id=user.id, field="copy",
        old=quote_id, new=clone.id, source="copy",
    )
    return clone


class StatusUpdateRequest(BaseModel):
    status: str  # draft | saved | sent | won | lost | hold


_VALID_STATUSES = {"draft", "saved", "sent", "won", "lost", "hold"}


@quotes_router.patch("/{quote_id}/status", response_model=Quote)
async def update_quote_status(quote_id: str, body: StatusUpdateRequest,
                              user: User = Depends(get_current_user)) -> Quote:
    """Quick status change — anyone on the team can update status (won/lost are
    common multi-person updates, e.g. a sales rep marking a quote 'won')."""
    if body.status not in _VALID_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Invalid status. Must be one of: {sorted(_VALID_STATUSES)}")
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    prev = doc.get("status", "draft")
    result = await db[COL_QUOTES].find_one_and_update(
        {"id": quote_id}, {"$set": {"status": body.status, "updated_at": _now()}},
        return_document=True, projection={"_id": 0},
    )
    if prev != body.status:
        await _log_audit(quote_id=quote_id, user_id=user.id, field="status",
                         old=prev, new=body.status, source="user")
    return Quote(**result)


# ─── AUDIT LOG (admin-only) ────────────────────────────────────────────────
audit_router = APIRouter(prefix="/api/admin/audit", tags=["audit"])


@audit_router.get("/quotes")
async def list_quote_audit(
    user: User = Depends(get_current_user),
    quote_id: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Full audit trail of ownership transfers, status changes, and copies.
    Restricted to admin role for now."""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    # Only return entries that have a quote_id — older rate-change audits
    # share the same collection but don't belong in the Quote Activity view.
    query: Dict[str, Any] = {"quote_id": {"$exists": True, "$ne": None}}
    if quote_id:
        query["quote_id"] = quote_id
    cursor = db[COL_AUDIT_LOG].find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    # Join user names so the UI can render "Sarah took over from Rich"
    all_uids: List[str] = []
    for d in docs:
        if d.get("user_id"):
            all_uids.append(d["user_id"])
        if d.get("field") == "owner_id":
            if d.get("old_value"):
                all_uids.append(d["old_value"])
    name_map = await _user_name_map(all_uids)
    return [
        {
            **d,
            "user_name": name_map.get(d.get("user_id"), d.get("user_id")),
            "old_value_name": name_map.get(d.get("old_value")) if d.get("field") == "owner_id" else None,
        }
        for d in docs
    ]


# ─── LIST USERS (for owner filter dropdown) ────────────────────────────────
@quotes_router.get("/_meta/owners")
async def list_quote_owners(user: User = Depends(get_current_user)) -> List[Dict[str, Any]]:
    """Distinct owners across all saved quotes — feeds the Load modal filter."""
    owner_ids = await db[COL_QUOTES].distinct("owner_id")
    name_map = await _user_name_map(owner_ids)
    return [{"id": uid, "name": name_map.get(uid, uid)} for uid in owner_ids if uid]
