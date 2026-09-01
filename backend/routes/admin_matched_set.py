"""Admin — Matched Set qty batch-heal (BUG-2026-02).

Rewrites every corrupt Matched Set quote / draft in the DB so
`bomItems[i].state.qtys` are canonical multiples of `pcsPerSet` and every
component agrees on the same SET qty per slot. Idempotent: correct data
returns unchanged.

Port of `frontend/src/lib/mpSchema.js::healLoadedState` — must stay in lockstep
with the client transform so the DB row matches what the UI sees post-load.

Endpoint: POST /api/admin/matched-set/heal-qtys
Response: { scanned, drafts_healed, quotes_healed, unchanged, errors: [...] }
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends

from db import db, COL_QUOTES, COL_QUOTE_DRAFTS, COL_AUDIT_LOG
from models.schemas import User
from routes.auth import require_admin

router = APIRouter(prefix="/api/admin/matched-set", tags=["admin-matched-set"])


def _now_iso() -> str:
    """Match `routes.quotes._now()` — ISO string, not datetime. Writing a
    datetime object here breaks Pydantic `updated_at: str` validation on the
    read path and 500s the whole quotes list. Learned the hard way."""
    return datetime.now(timezone.utc).isoformat()


def _heal_state(s: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """Return (healed_state, changed). Mirrors mpSchema.healLoadedState's
    Matched Set qty normalization exactly."""
    if not isinstance(s, dict):
        return s, False
    if s.get("quoteType") != "Multi-Part":
        return s, False
    if (s.get("pricingMode") or "Matched Set") != "Matched Set":
        return s, False
    items = s.get("bomItems") or []
    if not items:
        return s, False

    try:
        idx = int(s.get("activeItemIdx") or 0)
    except (TypeError, ValueError):
        idx = 0
    if not (0 <= idx < len(items)):
        idx = 0

    try:
        active_pcs = max(1, int((items[idx] or {}).get("pcsPerSet") or 1))
    except (TypeError, ValueError):
        active_pcs = 1

    top_raw: List[str] = [str(q) for q in (s.get("qtys") or [])]
    # Derive true set qty per slot from top-level (active-item pre-multiplied qty)
    set_qtys: List[int] = []
    for q in top_raw:
        try:
            n = float(q)
        except (TypeError, ValueError):
            n = 0.0
        set_qtys.append(int(round(n / active_pcs)) if n > 0 else 0)

    if not any(v > 0 for v in set_qtys):
        return s, False  # can't derive anything — leave alone

    changed = False
    new_items: List[Dict[str, Any]] = []
    for b in items:
        try:
            pcs = max(1, int((b or {}).get("pcsPerSet") or 1))
        except (TypeError, ValueError):
            pcs = 1
        cur_state = (b or {}).get("state") or {}
        cur_qtys = list(cur_state.get("qtys") or [])
        rewritten: List[str] = []
        for i, sq in enumerate(set_qtys):
            if sq > 0:
                rewritten.append(str(sq * pcs))
            else:
                rewritten.append(str(cur_qtys[i]) if i < len(cur_qtys) else "")
        # Pad/trim to top-level length
        while len(rewritten) < len(top_raw):
            rewritten.append("")
        if rewritten != [str(x) for x in cur_qtys[: len(rewritten)]] + [""] * max(0, len(rewritten) - len(cur_qtys)):
            changed = True
        new_state = {**cur_state, "qtys": rewritten}
        new_items.append({**(b or {}), "state": new_state})

    # Also refresh top-level state.qtys to match the (now-healed) active item
    active_state = (new_items[idx] or {}).get("state") or {}
    new_top = [str(x) for x in (active_state.get("qtys") or [])]
    if new_top != top_raw:
        changed = True

    if not changed:
        return s, False

    out = {**s, "bomItems": new_items, "qtys": new_top}
    return out, True


@router.post("/heal-qtys")
async def heal_qtys(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    """Walk every Matched Set quote/draft in DB and rewrite `state.qtys` into
    canonical shape. Idempotent — running twice is a no-op the second time."""
    scanned = 0
    drafts_healed = 0
    quotes_healed = 0
    unchanged = 0
    errors: List[Dict[str, Any]] = []
    healed_ids: List[str] = []

    async def _walk(collection: str, is_draft: bool) -> None:
        nonlocal scanned, drafts_healed, quotes_healed, unchanged
        cursor = db[collection].find({
            "state.quoteType": "Multi-Part",
            "$or": [
                {"state.pricingMode": "Matched Set"},
                {"state.pricingMode": {"$exists": False}},  # default is Matched Set
            ],
        })
        async for doc in cursor:
            scanned += 1
            _id = doc.get("_id")
            state = doc.get("state") or {}
            try:
                healed, changed = _heal_state(state)
            except Exception as e:
                errors.append({"collection": collection, "_id": str(_id), "error": f"{type(e).__name__}: {e}"})
                continue
            if not changed:
                unchanged += 1
                continue
            try:
                await db[collection].update_one(
                    {"_id": _id},
                    {"$set": {"state": healed, "updated_at": _now_iso()}},
                )
                if is_draft:
                    drafts_healed += 1
                else:
                    quotes_healed += 1
                healed_ids.append(str(_id))
            except Exception as e:
                errors.append({"collection": collection, "_id": str(_id), "error": f"{type(e).__name__}: {e}"})

    await _walk(COL_QUOTE_DRAFTS, is_draft=True)
    await _walk(COL_QUOTES, is_draft=False)

    # Audit log entry so the operation is traceable
    try:
        await db[COL_AUDIT_LOG].insert_one({
            "action": "matched_set.heal_qtys",
            "actor_id": None,  # require_admin doesn't expose id on User model here
            "at": datetime.now(timezone.utc),
            "scanned": scanned,
            "drafts_healed": drafts_healed,
            "quotes_healed": quotes_healed,
            "unchanged": unchanged,
            "errors_count": len(errors),
            "healed_ids": healed_ids[:200],  # cap so audit rows stay reasonable
        })
    except Exception:
        pass  # audit is best-effort; don't fail the batch on log write

    return {
        "scanned": scanned,
        "drafts_healed": drafts_healed,
        "quotes_healed": quotes_healed,
        "unchanged": unchanged,
        "errors": errors,
    }
