"""Quote drafts (the 'tabs') + saved quotes."""
from __future__ import annotations
import re
from io import BytesIO
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import db, COL_QUOTE_DRAFTS, COL_QUOTES, COL_USERS, COL_AUDIT_LOG
from models.schemas import (
    Quote, QuoteCreate, QuoteDraft, QuoteDraftCreate, QuoteDraftUpdate, User,
    AuditLogEntry,
)
from routes.auth import get_current_user
from services.pricing_versions import get_active_version_id
from services.rate_overrides import effective_snapshot
from services.parser_files import purge_quote_files


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
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List saved quotes.

    Scope:
      • mine — only current user's quotes (default, legacy behavior)
      • team — everyone's quotes (cross-user coverage use case)
      • all  — alias for team (admin clarity)
    Optional `owner_id` filters to a single user (useful when team view is on).
    Optional `status` filters by current status (draft/saved/sent/won/lost).
    Optional `q` full-text search across est#, customer (code/name/ident),
      project name (custRef), item description, estimating-team initials, and the
      owner's name/email. Searches ALL matching quotes, not just the page.
    Response is a flat list with `owner_name` joined in for display.
    """
    query: Dict[str, Any] = {}
    if scope == "mine":
        query["owner_id"] = user.id
    if owner_id:
        query["owner_id"] = owner_id
    if status_filter:
        query["status"] = status_filter
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        # Resolve owner ids whose name/email matches the term (first-name search).
        name_ids = [
            u["id"] async for u in db[COL_USERS].find(
                {"$or": [{"name": rx}, {"email": rx}]}, {"_id": 0, "id": 1})
        ]
        or_clauses: List[Dict[str, Any]] = [
            {"est_num": rx}, {"customer_name": rx}, {"customer_code": rx},
            {"state.custName": rx}, {"state.custCode": rx}, {"state.custIdent": rx},
            {"state.custRef": rx}, {"state.itemDesc": rx}, {"state.estInitials": rx},
            {"state.iquoteNum": rx},
        ]
        # iQuote # may be stored as a number in some legacy/prod docs (MongoDB
        # $regex silently no-ops on numeric fields). Add numeric equality and a
        # $toString regex fallback so partial numeric matches work regardless
        # of stored type (string, int, or double).
        term = q.strip()
        if term.isdigit():
            try:
                or_clauses.append({"state.iquoteNum": int(term)})
            except ValueError:
                pass
        try:
            or_clauses.append({"state.iquoteNum": float(term)})
        except ValueError:
            pass
        or_clauses.append({
            "$expr": {
                "$regexMatch": {
                    "input": {"$toString": {"$ifNull": ["$state.iquoteNum", ""]}},
                    "regex": re.escape(term),
                    "options": "i",
                }
            }
        })
        if name_ids:
            or_clauses.append({"owner_id": {"$in": name_ids}})
        query["$or"] = or_clauses
    cursor = db[COL_QUOTES].find(query, {"_id": 0}).sort("updated_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    quotes = [Quote(**d) for d in docs]
    result = await _attach_owner_names(quotes)
    # Attach attached-file counts (📎 badge in the Load Quote list) — one query.
    from services.parser_files import count_files_by_quote
    counts = await count_files_by_quote([q.get("id") for q in result])
    for q in result:
        q["file_count"] = counts.get(q.get("id"), 0)
    # Attach the pinned board-pricing version label (+ whether it's the current
    # active version) so the Load Quote list can flag quotes on older pricing.
    from services.pricing_versions import list_versions, get_active_version_id
    versions = await list_versions()
    vmap = {v["id"]: v.get("label") for v in versions}
    active_vid = await get_active_version_id()
    for q in result:
        vid = q.get("pricing_version_id")
        q["pricing_version_label"] = vmap.get(vid)
        q["pricing_is_current"] = (vid == active_vid) if vid else None
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
        rate_snapshot=effective_snapshot(),
        sent_at=_now() if body.status == "sent" else None,
    )
    await db[COL_QUOTES].insert_one(quote.model_dump())
    try:
        await _snapshot_report_rows(quote.model_dump(), user)
    except Exception:  # noqa: BLE001 — snapshot failure must never block a save
        pass
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
    # Stamp sent_at the first time a quote becomes "sent" (emailed). Preserve any
    # existing sent_at so re-saves don't reset the original send time.
    if body.status == "sent":
        existing = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0, "sent_at": 1})
        if not (existing or {}).get("sent_at"):
            update["sent_at"] = _now()
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
    try:
        await _snapshot_report_rows(result, user)
    except Exception:  # noqa: BLE001 — snapshot failure must never block a save
        pass
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
        # Keep state.estNum in sync so the loaded tab shows the -COPY number
        state={**(src.get("state") or {}), "estNum": f"{src.get('est_num', '')}-COPY"},
        status="draft",  # always start a copy as draft
        test_mode=src.get("test_mode", False),
        # Duplicate IS the re-price path: pin the clone to the ACTIVE version
        # so it picks up current board pricing (the original stays frozen).
        pricing_version_id=await get_active_version_id(),
        # Re-price rates too — capture CURRENT live admin rates for the clone.
        rate_snapshot=effective_snapshot(),
    )
    await db[COL_QUOTES].insert_one(clone.model_dump())
    # Attachments follow the copy — duplicate all RFQ/reference files so the
    # new owner has the full source-document context.
    from services.parser_files import clone_quote_files
    try:
        await clone_quote_files(quote_id, clone.id)
    except Exception:  # noqa: BLE001 — a file-clone hiccup must not kill the copy
        pass
    await _log_audit(
        quote_id=clone.id, user_id=user.id, field="copy",
        old=quote_id, new=clone.id, source="copy",
    )
    return clone


class StatusUpdateRequest(BaseModel):
    status: str  # draft | saved | sent | won | lost | hold


_VALID_STATUSES = {"draft", "saved", "sent"}


@quotes_router.patch("/{quote_id}/status", response_model=Quote)
async def update_quote_status(quote_id: str, body: StatusUpdateRequest,
                              user: User = Depends(get_current_user)) -> Quote:
    """Quick status change — anyone on the team can update status."""
    if body.status not in _VALID_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Invalid status. Must be one of: {sorted(_VALID_STATUSES)}")
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    prev = doc.get("status", "draft")
    set_fields = {"status": body.status, "updated_at": _now()}
    if body.status == "sent" and not doc.get("sent_at"):
        set_fields["sent_at"] = _now()
    result = await db[COL_QUOTES].find_one_and_update(
        {"id": quote_id}, {"$set": set_fields},
        return_document=True, projection={"_id": 0},
    )
    if prev != body.status:
        await _log_audit(quote_id=quote_id, user_id=user.id, field="status",
                         old=prev, new=body.status, source="user")
    return Quote(**result)


# ─── TEMPORARY: "Good for testing" flag + comparison report (remove later) ──
class TestFlagRequest(BaseModel):
    good_for_testing: bool
    iquote_num: Optional[str] = None
    became_job: Optional[bool] = None
    iquote_total: Optional[float] = None


@quotes_router.patch("/{quote_id}/test-flag")
async def set_test_flag(quote_id: str, body: TestFlagRequest,
                        user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Flag a saved quote as good for testing/comparison against the legacy
    system, store the matching iQuote #, and whether it became a job.
    TEMPORARY — to be removed."""
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    await db[COL_QUOTES].update_one(
        {"id": quote_id},
        {"$set": {
            "state.goodForTesting": bool(body.good_for_testing),
            "state.iquoteNum": (body.iquote_num or ""),
            "state.iquoteWon": bool(body.became_job),
            "state.iquoteTotal": (body.iquote_total if body.iquote_total else ""),
            "updated_at": _now(),
        }},
    )
    return {"quote_id": quote_id, "good_for_testing": bool(body.good_for_testing),
            "iquote_num": body.iquote_num or "", "became_job": bool(body.became_job)}


# Ordered columns for the exportable testing report.
# NOTE: "CAD Method" + "Cutter Basis" are DIAGNOSTIC columns that show which CAD
# pricing method (By Difficulty vs By Inches of Rule) the engine actually used
# and the exact basis string it printed on the right-rail Cost Buildup detail.
# When a row's Total Cost doesn't match the UI, these columns pinpoint whether
# the engine and UI disagreed on the CAD method.
_REPORT_COLUMNS = [
    "SPOT Estimate #", "iQuote #", "iQuote Option", "Became a Job", "Project Name", "Quote Type", "Component", "Qty",
    "One-Up W", "One-Up L", "Board", "Liners", "Sheet",
    "Material Cost", "Print Mode", "Print Cost", "Route", "Route Hours", "Difficulty",
    "Inches of Rule", "Perf %", "CAD Method", "Cutter Basis", "Cutting Cost",
    "Strip Difficulty", "Strip Cost", "Glue Joints", "Glue Difficulty", "Glue Cost",
    "Tape Type", "Tape Strip Count", "Tape Inches", "Tape Cost",
    "Freight", "Die", "Prepress", "Proofs", "Misc",
    "Total Cost", "Margin $", "Margin %", "Sell Total", "Quote Total",
    "iQuote $", "Δ $", "Δ %",
]

# BUMP THIS STRING every time the report semantics change so the "Build Info"
# sheet immediately reveals whether prod is running the latest code. If a user
# reports the report is still "wrong" after a redeploy, open the Build Info
# tab first — if the tag doesn't match the one in this source file, prod is on
# stale code and the redeploy didn't actually publish.
_REPORT_BUILD_TAG = "2026-02-report-v5-deploy-force"


def _append_build_info_sheet(wb) -> None:
    """Attach a small 'Build Info' sheet to a testing-report workbook so users
    can verify at a glance which code version produced the export.
    Semantics we currently guarantee (per _REPORT_BUILD_TAG):
      • Qty column       = per-component pcs (set_qty × pcsPerSet)
      • Die column (MP)  = tier-aggregate  (slot.dieLineCost + Σ dieEmbedded)
      • Quote Total (MP) = slot.sellTotal  (whole-quote sell for the tier)
    """
    from openpyxl.styles import Font
    meta = wb.create_sheet("Build Info")
    meta["A1"] = "Report Build Tag"; meta["B1"] = _REPORT_BUILD_TAG
    meta["A2"] = "Generated (UTC)";  meta["B2"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["A3"] = "Qty column";       meta["B3"] = "per-component pcs (set_qty × pcsPerSet)"
    meta["A4"] = "Die column (MP)";  meta["B4"] = "tier-aggregate (slot.dieLineCost + Σ dieEmbedded)"
    meta["A5"] = "Quote Total (MP)"; meta["B5"] = "slot.sellTotal (whole-quote sell at tier)"
    for r in range(1, 6):
        meta.cell(row=r, column=1).font = Font(bold=True)
    meta.column_dimensions["A"].width = 22
    meta.column_dimensions["B"].width = 60


def _n(x) -> float:
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _rule_in(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _report_row(q: Dict[str, Any], state: Dict[str, Any], comp_desc: str,
                ist: Dict[str, Any], r: Dict[str, Any],
                quote_total: Optional[float] = None,
                per_job_freight: bool = False,
                raw_qty_override: Optional[int] = None,
                tier_die_override: Optional[float] = None) -> Dict[str, Any]:
    print_on = (ist.get("printReq") or ist.get("printRequired") or "Yes") == "Yes"
    strip_on = ist.get("handStripping") == "Yes"
    glue_on = ist.get("handGluing") == "Yes"
    tape_on = ist.get("tape") == "Yes"
    qty = r.get("qty") or 0
    # Report `Qty` should always be the RAW stored set qty (no pcs-per-set
    # multiplication) so it matches iQuote's `Quantity` column for direct
    # side-by-side comparison. Multi-Part supplies this via raw_qty_override.
    display_qty = raw_qty_override if raw_qty_override is not None else qty
    try:
        tstrips = float(ist.get("tapeStrips") or 0)
        tlen = float(ist.get("tapeStripLength") or 0)
    except (TypeError, ValueError):
        tstrips = tlen = 0
    tape_inches = round(qty * tstrips * tlen, 2) if tape_on else ""
    try:
        perf = round(float(ist.get("perfPct") or 0) * 100, 1)
    except (TypeError, ValueError):
        perf = 0
    return {
        "SPOT Estimate #": q.get("est_num") or "",
        "iQuote #": state.get("iquoteNum") or "",
        "iQuote Option": state.get("iquoteOption") or "",
        "Became a Job": "Yes" if state.get("iquoteWon") else "No",
        "Project Name": state.get("custRef") or "",
        "Quote Type": state.get("quoteType") or "Simple",
        "Component": comp_desc or "",
        "Qty": display_qty,
        # Board/dims come from the ENGINE RESULT for THIS component — the actual
        # board it was priced on, never another component's mirror.
        "One-Up W": round(float(r.get("oneUpW")), 3) if r.get("oneUpW") else "",
        "One-Up L": round(float(r.get("oneUpL")), 3) if r.get("oneUpL") else "",
        "Board": f"{r.get('boardGrade')} {r.get('flute')}" if r.get("boardGrade") else "",
        "Liners": (f"{r.get('outsideLiner') or ''}/{r.get('insideLiner') or ''}"
                   if (r.get("outsideLiner") or r.get("insideLiner")) else ""),
        "Sheet": (f"{r.get('sheetW')}x{r.get('sheetL')}" if r.get("sheetW") else ""),
        "Material Cost": _n(r.get("matTotal")) + _n(r.get("matMakeready")),
        "Print Mode": (ist.get("printMode") or "") if print_on else "",
        "Print Cost": _n(r.get("printDirect")),
        "Route": r.get("route") or "",
        "Route Hours": round(float(r.get("cadHrs") or 0), 3),
        "Difficulty": ist.get("cadDifficulty") or "",
        "Inches of Rule": ist.get("totalRuleInches") or "",
        "Perf %": perf,
        # DIAGNOSTICS: what the engine actually did for this row
        "CAD Method": r.get("cadPricingMethod") or "",
        "Cutter Basis": r.get("cutterBasis") or "",
        "Cutting Cost": _n(r.get("cutterDirect")),
        "Strip Difficulty": (ist.get("strippingComplexity") or "") if strip_on else "",
        "Strip Cost": _n(r.get("stripCost")) if strip_on else "",
        "Glue Joints": (ist.get("jointsPerPiece") or "") if glue_on else "",
        "Glue Difficulty": (ist.get("gluingComplexity") or "") if glue_on else "",
        "Glue Cost": _n(r.get("assemblyCost")) if glue_on else "",
        "Tape Type": (ist.get("tapeType") or "") if tape_on else "",
        "Tape Strip Count": (ist.get("tapeStrips") or "") if tape_on else "",
        "Tape Inches": tape_inches,
        "Tape Cost": _n(r.get("assemblyCost")) if tape_on else "",
        # Per-Job freight (UTS dashboard) lives in allocatedFreight — the
        # component's markup-inclusive share of the job shipment (matches the
        # Quote Table / right-rail). Per-item freight = line + embedded.
        "Freight": (_n(r.get("allocatedFreight")) if per_job_freight
                    else _n(r.get("freightLine")) + _n(r.get("freightEmbed"))),
        "Die": (round(float(tier_die_override), 2) if tier_die_override is not None
                else _n(r.get("dieLineCost")) + _n(r.get("dieEmbedded"))),
        "Prepress": _n(r.get("prepressLineCost")) + _n(r.get("prepressEmbedded")),
        "Proofs": _n(r.get("proofLineCost")) + _n(r.get("proofEmbedded")),
        "Misc": _n(r.get("miscLineCost")),
        "Total Cost": _n(r.get("totalMfg")),
        # Margin is THIS COMPONENT's production margin — exactly what the
        # right-rail Cost Buildup "Margin ... of sell" shows for the component.
        "Margin $": _n(r.get("gmDollar")),
        "Margin %": round(float(r.get("gmPct") or 0) * 100, 1),
        "Sell Total": _n(r.get("itemSell")),
        # Quote Total = whole-quote sell for this qty tier (matches iQuote's
        # TotalEstimatePrice, repeated per row within the tier). Multi-Part
        # supplies slot.sellTotal via `quote_total`; Simple falls through to
        # the component's own sellTotal (already the whole quote).
        "Quote Total": _n(r.get("sellTotal")) if quote_total is None else round(float(quote_total), 2),
        **_iquote_delta(state, _n(r.get("sellTotal")) if quote_total is None else round(float(quote_total), 2)),
    }


# Item-level keys mirrored from the top-level state into the active bom item —
# MUST stay in sync with buildMpPayload() in frontend/src/hooks/useEngine.js.
_MP_ITEM_KEYS = [
    "itemDesc", "boxStyle", "custIdent", "quoteMode", "oneUpW", "oneUpL",
    "sheetSizeW", "sheetSizeL", "sheetPcsPerSheet", "corrFlipped", "overrideSheetId",
    "qtys", "selSlot", "flute", "boardGrade", "outsideLiner", "insideLiner", "medium",
    "fscEnabled", "fscFee", "buyMinBoard", "boardSubstitution",
    "printReq", "printMode", "printSides", "whiteInk", "colorsFront", "colorsBack",
    "routeOverride", "cadDifficulty", "cadPricingMethod", "cadMethodTouched", "totalRuleInches",
    "perfPct", "productMats", "saber", "saberCuts", "saberBlanksOut",
    "handStripping", "perimeterStripping", "strippingComplexity",
    "handGluing", "jointsPerPiece", "gluingComplexity",
    "tape", "tapeType", "tapeStrips", "tapeStripLength",
    "prepressTreatment", "prepressCost", "proofTreatment", "proofCost", "proofMarkup",
    "dieTreatment", "cuttingDieCost", "dieAmortMethod", "miscCharges",
    "freightType", "freightTreatment", "freightCost", "freightMarkup",
    "freightCarrier", "freightByQty", "forcedSellPc", "gmByTier", "sellByTier",
    "pricingBasis", "miscChargeMarkup",
]


def _mp_engine_payload(state: Dict[str, Any], quote_id: Optional[str]) -> Dict[str, Any]:
    """Build the multi-part engine payload EXACTLY like the UI's buildMpPayload()
    (frontend/src/hooks/useEngine.js) so the report prices what the UI shows."""
    items = list(state.get("bomItems") or [])
    active = state.get("activeItemIdx") or 0

    # Heal legacy corruption where top-level `state.qtys` got saved as the
    # PRE-multiplied max-pcsPerSet version (e.g., [2, 1000, 2000, 4000] when
    # the true set qtys are [1, 500, 1000, 2000] and the Tray has pcsPerSet=2).
    # Ground truth: every component's `state.qtys[i] / pcsPerSet` yields the
    # true set qty for slot i. So we rebuild top-level qtys from EACH
    # component's own qtys, then take the MIN across components — a corrupted
    # component would only shift its own qtys UP, never DOWN.
    def _n(v: Any) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0
    healed_qtys: Optional[List[str]] = None
    if state.get("quoteType") == "Multi-Part" and items:
        candidates: List[List[str]] = []
        for it in items:
            iqs = (it.get("state") or {}).get("qtys") or []
            pps = _n(it.get("pcsPerSet")) or 1.0
            if pps <= 0:
                pps = 1.0
            per_slot: List[str] = []
            for q in iqs:
                v = _n(q)
                per_slot.append(str(int(v / pps)) if v > 0 else "")
            if any(s.strip() for s in per_slot):
                candidates.append(per_slot)
        if candidates:
            width = max(len(c) for c in candidates)
            healed = []
            for i in range(width):
                vals = []
                for c in candidates:
                    if i < len(c) and c[i].strip():
                        try:
                            vals.append(int(c[i]))
                        except ValueError:
                            pass
                healed.append(str(min(vals)) if vals else "")
            # Only apply the heal if the reconstructed set-qtys disagree with
            # what's stored — same-value case means the top-level was already
            # correct and we don't want to mask other legitimate configs.
            top_qtys_str = [str(x) for x in (state.get("qtys") or [])]
            if healed and healed != top_qtys_str[: len(healed)]:
                healed_qtys = healed

    if isinstance(active, int) and 0 <= active < len(items):
        mirror = {k: state.get(k) for k in _MP_ITEM_KEYS if state.get(k) is not None}
        items[active] = {**items[active],
                         "state": {**(items[active].get("state") or {}), **mirror}}
    # Legacy-save heal (mirror of applyState() in frontend/src/lib/defaults.js):
    # freightCarrier predates per-item persistence — seed items missing it from
    # the top-level value so per-item freight markup matches what the UI shows.
    job_carrier = state.get("freightCarrier")
    if job_carrier:
        items = [it if (it.get("state") or {}).get("freightCarrier")
                 else {**it, "state": {**(it.get("state") or {}), "freightCarrier": job_carrier}}
                 for it in items]
    if state.get("freightScope") == "Per Job":
        items = [{**it, "state": {**(it.get("state") or {}),
                                  "freightCost": "0", "freightTreatment": "None"}}
                 for it in items]

    # CAD-pricing-method heal on EVERY item (not just active). Legacy stored
    # `cadPricingMethod` on components even when the estimator never touched
    # the toggle — historic saves left "By Difficulty" on components that have
    # rule inches, which flips the report to by-difficulty even though the UI's
    # smart-default useEffect (ProductionSpecsSec.jsx L23-28) heals the ACTIVE
    # tab to "By Inches of Rule" as soon as it loads. Non-active tabs never got
    # that heal until the estimator clicked into them.
    #
    # Deterministic fix: apply the same smart default to EVERY item's state up
    # front so the report can't disagree with the UI regardless of which tab
    # was last visited. Rule: when rule inches > 0 AND the estimator did NOT
    # explicitly pick a method (`cadMethodTouched` falsy), price By Inches of
    # Rule. Explicit estimator choice (`cadMethodTouched` true) is preserved.
    def _heal_cad(ist: Dict[str, Any]) -> Dict[str, Any]:
        if ist.get("cadMethodTouched"):
            return ist
        try:
            ri = float(ist.get("totalRuleInches") or 0)
        except (TypeError, ValueError):
            ri = 0.0
        want = "By Inches of Rule" if ri > 0 else "By Difficulty"
        if (ist.get("cadPricingMethod") or "By Difficulty") == want:
            return ist
        return {**ist, "cadPricingMethod": want}
    items = [{**it, "state": _heal_cad(it.get("state") or {})} for it in items]
    payload = {
        "quoteType": state.get("quoteType"),
        "pricingMode": state.get("pricingMode") or "Matched Set",
        "setMarginPct": state.get("setMarginPct") or "0.40",
        "setMarginOverride": bool(state.get("setMarginOverride")),
        "fulfillmentMarginPct": state.get("fulfillmentMarginPct") or "0.45",
        "purchasedMarginPct": state.get("purchasedMarginPct") or "0.40",
        "qtys": [str(x) for x in (healed_qtys if healed_qtys is not None else (state.get("qtys") or []))],
        "activeItemIdx": active,
        "bomItems": items,
        "estInitials": state.get("estInitials"),
        "custName": state.get("custName"), "custCode": state.get("custCode"),
        "custRef": state.get("custRef"),
        "destZip": state.get("destZip"), "quoteFOB": state.get("quoteFOB"),
        "freightScope": state.get("freightScope"),
        "freightAllocMethod": state.get("freightAllocMethod"),
        "jobFreightCost": state.get("jobFreightCost"),
        "jobFreightTreatment": state.get("jobFreightTreatment"),
        "jobFreightBySlot": state.get("jobFreightBySlot") or {},
        "freightMarkup": state.get("freightMarkup"),
        "freightCarrier": state.get("freightCarrier"),
        "prepressScope": state.get("prepressScope"),
        "prepressAllocMethod": state.get("prepressAllocMethod"),
        "jobPrepressCost": state.get("jobPrepressCost"),
        "jobPrepressTreatment": state.get("jobPrepressTreatment"),
        "pricingVersionId": state.get("pricingVersionId") or None,
        "quoteId": quote_id or None,
    }
    # JS drops undefined keys on serialization; explicit nulls would defeat the
    # engine's .get(key, default) fallbacks. Mirror that by stripping Nones.
    return {k: v for k, v in payload.items() if v is not None}


def _simple_engine_payload(state: Dict[str, Any], quote_id: Optional[str]) -> Dict[str, Any]:
    """Mirror of the UI's buildPayload() whitelist (useEngine.js)."""
    ro = state.get("routeOverride")
    payload = {
        "oneUpW": state.get("oneUpW") or "0", "oneUpL": state.get("oneUpL") or "0",
        "qtys": [str(x) for x in (state.get("qtys") or [])],
        "flute": state.get("flute"), "boardGrade": state.get("boardGrade"),
        "outsideLiner": state.get("outsideLiner"), "insideLiner": state.get("insideLiner"),
        "medium": state.get("medium"), "fscEnabled": bool(state.get("fscEnabled")),
        "printReq": state.get("printReq"), "printMode": state.get("printMode"),
        "printSides": state.get("printSides"), "whiteInk": state.get("whiteInk"),
        "colorsFront": state.get("colorsFront"), "colorsBack": state.get("colorsBack"),
        **({"routeOverride": ro} if ro and ro != "Auto" else {}),
        # CAD-method heal (matches ProductionSpecsSec.jsx L23-28 useEffect): when
        # rule inches are present and the estimator never explicitly touched the
        # By Difficulty / By Rule toggle, price By Inches of Rule. Same rule the
        # UI applies at load — keeps report parity with what the estimator sees.
        "cadDifficulty": state.get("cadDifficulty"),
        "cadPricingMethod": (
            state.get("cadPricingMethod")
            if state.get("cadMethodTouched")
            else ("By Inches of Rule"
                  if _rule_in(state.get("totalRuleInches")) > 0
                  else "By Difficulty")
        ),
        "cadMethodTouched": bool(state.get("cadMethodTouched")),
        "totalRuleInches": state.get("totalRuleInches"), "perfPct": state.get("perfPct"),
        "productMats": state.get("productMats"),
        "saber": state.get("saber"), "saberCuts": state.get("saberCuts"),
        "saberBlanksOut": state.get("saberBlanksOut"),
        "handStripping": state.get("handStripping"),
        "perimeterStripping": state.get("perimeterStripping"),
        "strippingComplexity": state.get("strippingComplexity"),
        "handGluing": state.get("handGluing"), "jointsPerPiece": state.get("jointsPerPiece"),
        "gluingComplexity": state.get("gluingComplexity"),
        "tape": state.get("tape"), "tapeType": state.get("tapeType"),
        "tapeStrips": state.get("tapeStrips"), "tapeStripLength": state.get("tapeStripLength"),
        "quoteFOB": state.get("quoteFOB"), "freightCost": state.get("freightCost"),
        "freightTreatment": state.get("freightTreatment"), "freightMarkup": state.get("freightMarkup"),
        "freightCarrier": state.get("freightCarrier"),
        "cuttingDieCost": state.get("cuttingDieCost"), "dieTreatment": state.get("dieTreatment"),
        "dieMarkup": state.get("dieMarkup"),
        "prepressCost": state.get("prepressCost"), "prepressTreatment": state.get("prepressTreatment"),
        "proofTreatment": state.get("proofTreatment"), "proofCost": state.get("proofCost"),
        "proofMarkup": state.get("proofMarkup"),
        "miscCharges": state.get("miscCharges"), "miscChargeMarkup": state.get("miscChargeMarkup"),
        "pricingBasis": state.get("pricingBasis"),
        "gmByTier": state.get("gmByTier") or None,
        "sellByTier": state.get("sellByTier") or None,
        "freightByQty": state.get("freightByQty") or None,
        "forcedSellPc": state.get("forcedSellPc") or None,
        "buyMinBoard": state.get("buyMinBoard") or "Auto",
        "boardSubstitution": state.get("boardSubstitution") or None,
        "overrideSheetId": state.get("overrideSheetId") or None,
        "pricingVersionId": state.get("pricingVersionId") or None,
        "quoteId": quote_id or None,
    }
    return {k: v for k, v in payload.items() if v is not None}


def _iquote_delta(state: Dict[str, Any], spot_total: float) -> Dict[str, Any]:
    """Δ of SPOT quote total vs the recorded iQuote price (positive = SPOT higher)."""
    try:
        iq = float(state.get("iquoteTotal") or 0)
    except (TypeError, ValueError):
        iq = 0.0
    if iq <= 0:
        return {"iQuote $": "", "Δ $": "", "Δ %": ""}
    delta = round(spot_total - iq, 2)
    return {"iQuote $": round(iq, 2), "Δ $": delta, "Δ %": round(delta / iq * 100, 1)}


async def _compute_report_rows(q: Dict[str, Any], user: User) -> List[Dict[str, Any]]:
    """Price a saved quote EXACTLY like the UI and return its report rows."""
    from routes.engine_routes import calculate_all, calculate_multi_part
    state = q.get("state") or {}
    rows: List[Dict[str, Any]] = []
    is_mp = state.get("quoteType") == "Multi-Part" and bool(state.get("bomItems"))
    try:
        if is_mp:
            # buildMpPayload-equivalent payload, then read the SLOTS aggregation
            # (what the Quote Table / right rail show) — NOT componentPricing,
            # which prices each component independently.
            data = await calculate_multi_part(payload=_mp_engine_payload(state, q.get("id")), _u=user)
            bom = state.get("bomItems") or []
            by_id = {(b.get("id") or ""): (b.get("state") or {}) for b in bom}
            per_job = (state.get("freightScope") == "Per Job")
            for slot in (data.get("slots") or []):
                per_comp = slot.get("perComponent") or []
                # Slot-level roll-ups so per-component report rows can display
                # the whole-quote figures at this qty tier (matches iQuote's
                # TotalEstimatePrice repeated per row + right-rail Die aggregate).
                tier_die = _n(slot.get("dieLineCost")) + sum(_n(pc.get("dieEmbedded")) for pc in per_comp)
                tier_total = slot.get("sellTotal")
                for pc in per_comp:
                    if pc.get("error"):
                        continue
                    ist = by_id.get(pc.get("itemId") or "", {})
                    # Qty column = engine's per-component pcs count (= set_qty ×
                    # pcsPerSet in Matched Set, or the component's own row qty in
                    # Individual). Matches iQuote's `Quantity` per product, so
                    # every row is directly comparable between the two exports.
                    rows.append(_report_row(
                        q, state, pc.get("desc"), ist, pc,
                        quote_total=tier_total,
                        per_job_freight=per_job,
                        tier_die_override=tier_die))
        else:
            data = await calculate_all(payload=_simple_engine_payload(state, q.get("id")), _u=user)
            desc = state.get("itemDesc") or "Item"
            for rr in (data.get("results") or []):
                if rr.get("error"):
                    continue
                rows.append(_report_row(q, state, desc, state, rr))
    except Exception as e:  # noqa: BLE001 — a bad quote must not break save/export
        rows.append({**{c: "" for c in _REPORT_COLUMNS},
                     "SPOT Estimate #": q.get("est_num") or q.get("id"),
                     "iQuote #": state.get("iquoteNum") or "",
                     "Component": f"ENGINE ERROR: {type(e).__name__}: {e}"})
    return rows


async def _snapshot_report_rows(q: Dict[str, Any], user: User) -> List[Dict[str, Any]]:
    """SAVE-TIME COST SNAPSHOT: freeze the priced numbers into the quote doc so
    the report simply reads them back — no recalculation drift possible."""
    rows = await _compute_report_rows(q, user)
    await db[COL_QUOTES].update_one(
        {"id": q.get("id")},
        {"$set": {"report_rows": rows, "report_rows_at": _now()}})
    return rows


def _refresh_row_meta(row: Dict[str, Any], q: Dict[str, Any]) -> Dict[str, Any]:
    """Overlay fields editable AFTER save (test-flag PATCH: iQuote #/$, Job flag,
    project name) onto a stored snapshot row at export time."""
    state = q.get("state") or {}
    qt = row.get("Quote Total")
    qt = qt if isinstance(qt, (int, float)) else 0.0
    return {**row,
            "SPOT Estimate #": q.get("est_num") or row.get("SPOT Estimate #") or "",
            "iQuote #": state.get("iquoteNum") or "",
            "iQuote Option": state.get("iquoteOption") or "",
            "Became a Job": "Yes" if state.get("iquoteWon") else "No",
            "Project Name": state.get("custRef") or "",
            **_iquote_delta(state, qt)}


@quotes_router.get("/_report/testing.xlsx")
async def testing_report(user: User = Depends(get_current_user)) -> StreamingResponse:
    """Export every quote flagged 'good for testing' to .xlsx with a per-component
    cost breakdown. Every row is priced FRESH here from the quote's saved state
    using the current engine — the exact code path the UI uses when a quote is
    opened. No stale save-time snapshot; if the UI shows a number today, the
    report shows the same number today. A snapshot is still written back for
    audit/history but never read from at export."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill

    cursor = db[COL_QUOTES].find({"state.goodForTesting": True}, {"_id": 0}).sort("est_num", 1)
    quotes = [d async for d in cursor]

    rows: List[Dict[str, Any]] = []
    for q in quotes:
        fresh = await _compute_report_rows(q, user)
        # keep the snapshot in-sync for the next audit-only reader — never read from it here
        try:
            await db[COL_QUOTES].update_one(
                {"id": q.get("id")},
                {"$set": {"report_rows": fresh, "report_rows_at": _now()}})
        except Exception:  # noqa: BLE001
            pass
        rows.extend(_refresh_row_meta(r, q) for r in fresh)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Testing Comparison"
    ws.append(_REPORT_COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    amber = PatternFill(start_color="FFF3CD", end_color="FFF3CD", fill_type="solid")
    dpct_col = _REPORT_COLUMNS.index("Δ %") + 1
    for row in rows:
        ws.append([row.get(c, "") for c in _REPORT_COLUMNS])
        dpct = row.get("Δ %")
        if isinstance(dpct, (int, float)) and abs(dpct) > 10:
            for c in (dpct_col - 2, dpct_col - 1, dpct_col):
                ws.cell(row=ws.max_row, column=c).fill = amber
    ws.freeze_panes = "A2"
    for i, col in enumerate(_REPORT_COLUMNS, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = max(11, min(24, len(col) + 3))

    _append_build_info_sheet(wb)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    # Timestamped filename + no-store: multiple same-day exports previously all
    # downloaded as the SAME name, so users kept opening a stale earlier copy
    # from Downloads and thought the report was wrong/missing columns.
    fname = f"spot-testing-report-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"',
                 "Cache-Control": "no-store"},
    )


@quotes_router.get("/_report/testing.json")
async def testing_report_dump(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Return the raw stored state of every quote flagged 'good for testing'.
    Consumed by the WORKAROUND xlsx-from-json endpoint above — user curls this
    from prod, uploads the JSON to preview (which has the fixed engine), and
    downloads a corrected xlsx. Admin only."""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    cursor = db[COL_QUOTES].find({"state.goodForTesting": True}, {"_id": 0}).sort("est_num", 1)
    quotes = [d async for d in cursor]
    return {"count": len(quotes), "quotes": quotes}


@quotes_router.post("/_report/testing.xlsx-from-json")
async def testing_report_from_json(
    body: Dict[str, Any],
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """WORKAROUND for stale prod deploys: accept an inline list of quote docs
    (as would be returned by GET /api/quotes?owner_id=... or a Mongo dump) and
    return a corrected xlsx computed with the CURRENT engine. Post body:
      { "quotes": [ {id, est_num, state: {...}, ...}, ... ] }
    Only admins can call this so an untrusted user can't feed arbitrary state
    into the engine. Not indexed anywhere else — POST because payloads can be
    multi-MB and URLs shouldn't carry them."""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    from routes.engine_routes import _RATE_SNAP_CACHE

    quotes = body.get("quotes") or []
    # Upsert incoming quotes into preview DB so `_resolve_rate_snapshot(quoteId)`
    # in engine_routes finds each quote's PROD rate_snapshot (attached to the doc)
    # and applies it via `use_rate_freeze`. Without this, the engine falls back to
    # preview's LIVE admin rates and computed values drift from the prod UI.
    # Track inserted ids to clean up after so preview's DB stays isolated.
    inserted_ids: List[str] = []
    for q in quotes:
        qid = q.get("id")
        if not qid:
            continue
        exists = await db[COL_QUOTES].find_one({"id": qid}, {"_id": 0, "id": 1})
        if not exists:
            try:
                await db[COL_QUOTES].insert_one(dict(q))
                inserted_ids.append(qid)
            except Exception:  # noqa: BLE001
                pass
        _RATE_SNAP_CACHE.pop(qid, None)  # bust cache so upserted snapshot wins

    rows: List[Dict[str, Any]] = []
    for q in quotes:
        try:
            fresh = await _compute_report_rows(q, user)
        except Exception as e:  # noqa: BLE001
            fresh = [{**{c: "" for c in _REPORT_COLUMNS},
                      "SPOT Estimate #": q.get("est_num") or q.get("id") or "",
                      "Component": f"ENGINE ERROR: {type(e).__name__}: {e}"}]
        rows.extend(_refresh_row_meta(r, q) for r in fresh)

    # Clean up: remove any quotes we inserted so preview isn't polluted with prod data
    if inserted_ids:
        try:
            await db[COL_QUOTES].delete_many({"id": {"$in": inserted_ids}})
        except Exception:  # noqa: BLE001
            pass
        for qid in inserted_ids:
            _RATE_SNAP_CACHE.pop(qid, None)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Testing Comparison"
    ws.append(_REPORT_COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    amber = PatternFill(start_color="FFF3CD", end_color="FFF3CD", fill_type="solid")
    dpct_col = _REPORT_COLUMNS.index("Δ %") + 1
    for row in rows:
        ws.append([row.get(c, "") for c in _REPORT_COLUMNS])
        dpct = row.get("Δ %")
        if isinstance(dpct, (int, float)) and abs(dpct) > 10:
            for c in (dpct_col - 2, dpct_col - 1, dpct_col):
                ws.cell(row=ws.max_row, column=c).fill = amber
    ws.freeze_panes = "A2"
    for i, col in enumerate(_REPORT_COLUMNS, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = max(11, min(24, len(col) + 3))

    _append_build_info_sheet(wb)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"spot-testing-report-fromjson-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"',
                 "Cache-Control": "no-store"},
    )


@quotes_router.delete("/{quote_id}")
async def delete_quote(quote_id: str, user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Hard-delete a saved quote — ADMIN ONLY. Also purges any attached RFQ
    files (blobs + metadata). The deletion is recorded in the audit log."""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    doc = await db[COL_QUOTES].find_one({"id": quote_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    files_purged = await purge_quote_files(quote_id)
    await db[COL_QUOTES].delete_one({"id": quote_id})
    await _log_audit(quote_id=quote_id, user_id=user.id, field="deleted",
                     old=doc.get("est_num"), new=None, source="admin-delete")
    return {"ok": True, "deleted": quote_id, "files_purged": files_purged}



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
    # Attach the quote's pinned board-pricing version label per row, so the
    # Quote Activity audit can show a Pricing Version column.
    q_ids = list({d.get("quote_id") for d in docs if d.get("quote_id")})
    qver: Dict[str, Optional[str]] = {}
    if q_ids:
        async for q in db[COL_QUOTES].find(
            {"id": {"$in": q_ids}}, {"_id": 0, "id": 1, "pricing_version_id": 1}):
            qver[q["id"]] = q.get("pricing_version_id")
    from services.pricing_versions import list_versions
    vmap = {v["id"]: v.get("label") for v in await list_versions()}
    return [
        {
            **d,
            "user_name": name_map.get(d.get("user_id"), d.get("user_id")),
            "old_value_name": name_map.get(d.get("old_value")) if d.get("field") == "owner_id" else None,
            "pricing_version_label": vmap.get(qver.get(d.get("quote_id"))),
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
