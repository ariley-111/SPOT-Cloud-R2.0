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

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from db import db, COL_QUOTES, COL_QUOTE_DRAFTS, COL_AUDIT_LOG
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
    active_id = (active or {}).get("id")

    # Choose a meaningful comparison baseline:
    #  • a draft            → diff vs the ACTIVE version (what activating it changes)
    #  • the original/baseline version → NO prior exists → no diff (old price + delta N/A)
    #  • any other version (active or archived) → diff vs the version it REPLACED
    #    (the next-older non-draft version), i.e. its own change history
    baseline = None
    if v.get("status") == "draft":
        baseline = active
    elif not v.get("is_baseline"):
        all_versions = await pv.list_versions()  # newest-first, no config
        older = [x for x in all_versions
                 if x["id"] != version_id and x.get("status") != "draft"
                 and (x.get("created_at") or "") < (v.get("created_at") or "")]
        prev = older[0] if older else None  # most-recent version older than v
        baseline = await pv.get_version(prev["id"]) if prev else None

    diff = None
    if baseline and baseline.get("config") and v.get("config"):
        diff = diff_base_matrix(
            baseline["config"].get("base_matrix", {}),
            v["config"].get("base_matrix", {}),
        )
    return {"version": v, "diff": diff, "active_id": active_id,
            "compared_to": (baseline or {}).get("label")}


@router.post("/import")
async def import_spreadsheet(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    label: Optional[str] = Form(None),
    effective_date: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    """Parse an uploaded board-price xlsx → create a DRAFT version (base_matrix
    only; adders carried forward from the active version) → return diff +
    warnings for review. Does NOT activate.

    `effective_date` (YYYY-MM-DD) overrides the auto-derivation from the sheet
    name — useful when the supplier's date is inside the sheet (e.g. a header
    cell like "Effective: 8-15-26") rather than in the tab name, and for
    back-dating a version to a historical go-live date."""
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
        label=label or (effective_date or parsed["label"]),
        config=new_cfg,
        effective_date=effective_date or parsed["effective_date"],
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


async def _quote_total_sell(q: Dict[str, Any], version_id: Optional[str], user: User) -> float:
    """Price a saved quote against `version_id` (by injecting into a state copy)
    and return its whole-quote sell at the FIRST qty tier (== iQuote's headline
    price). Reuses the same code path the report uses so this validator never
    drifts from what the report/UI shows."""
    from routes.quotes import _compute_report_rows
    q2 = {**q, "state": {**(q.get("state") or {}), "pricingVersionId": version_id}}
    rows = await _compute_report_rows(q2, user)
    for r in rows:
        qt = r.get("Quote Total")
        try:
            return round(float(qt or 0), 2)
        except (TypeError, ValueError):
            continue
    return 0.0


@router.post("/versions/{version_id}/repin")
async def repin_quotes(
    version_id: str,
    since: Optional[str] = None,
    dry_run: bool = True,
    include_drafts: bool = True,
    exclude_won: bool = False,
    exclude_sent: bool = False,
    admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    """Re-pin quotes to `version_id` so a newly-activated pricing version applies
    retroactively to quotes saved before it went active. Freeze-contract escape
    hatch — use with intent.

    Query params:
      • `since` (YYYY-MM-DD): only touch quotes with `created_at >= since`.
        Defaults to the target version's `effective_date`.
      • `dry_run` (default True): report what would change, but don't write.
        Returns per-quote old→new sell so the price impact is auditable BEFORE
        the re-pin lands.
      • `include_drafts` (default True): also re-pin unsaved drafts.
      • `exclude_won`, `exclude_sent`: guard against silently changing prices
        on quotes the customer has already seen.

    Response includes a per-quote table with:
      est_num · customer · created_at · from_version_label · old_sell · new_sell
      · delta · delta_pct
    plus aggregate totals so a UI can show a summary before confirming."""
    target = await pv.get_version(version_id)
    if not target:
        raise HTTPException(404, f"Pricing version {version_id!r} not found")
    eff_since = since or target.get("effective_date")
    if not eff_since:
        raise HTTPException(400, "No `since` provided and target version has no effective_date")
    since_iso_lo = f"{eff_since}T00:00:00"

    # Build a label map so the response is human-readable.
    all_versions = await pv.list_versions()
    vlabel = {v["id"]: v.get("label") for v in all_versions}

    collections: List[str] = [COL_QUOTES]
    if include_drafts:
        collections.append(COL_QUOTE_DRAFTS)

    base_q: Dict[str, Any] = {
        "created_at": {"$gte": since_iso_lo},
        "pricing_version_id": {"$ne": version_id},
    }
    if exclude_won:
        base_q["status"] = {"$nin": ["won"]}
    if exclude_sent:
        # Compose with a prior $nin if present.
        cur = base_q.get("status")
        blocked = set((cur or {}).get("$nin") or []) | {"sent"}
        base_q["status"] = {"$nin": list(blocked)}

    affected: List[Dict[str, Any]] = []
    for col in collections:
        cursor = db[col].find(base_q, {"_id": 0})
        async for doc in cursor:
            from_vid = doc.get("pricing_version_id")
            row: Dict[str, Any] = {
                "collection": col,
                "id": doc.get("id"),
                "est_num": doc.get("est_num"),
                "customer": doc.get("customer_name") or (doc.get("state") or {}).get("custName"),
                "created_at": doc.get("created_at"),
                "status": doc.get("status"),
                "from_version_id": from_vid,
                "from_version_label": vlabel.get(from_vid),
            }
            # Compute old vs new sell — best-effort; a bad quote must not block
            # the whole re-pin dry run.
            try:
                row["old_sell"] = await _quote_total_sell(doc, from_vid, admin)
            except Exception as e:  # noqa: BLE001
                row["old_sell"] = None
                row["price_error"] = f"old: {type(e).__name__}: {e}"
            try:
                row["new_sell"] = await _quote_total_sell(doc, version_id, admin)
            except Exception as e:  # noqa: BLE001
                row["new_sell"] = None
                row["price_error"] = (row.get("price_error") or "") + f" new: {type(e).__name__}: {e}"
            if row.get("old_sell") is not None and row.get("new_sell") is not None:
                row["delta"] = round(row["new_sell"] - row["old_sell"], 2)
                row["delta_pct"] = (round(100 * row["delta"] / row["old_sell"], 2)
                                    if row["old_sell"] else None)
            affected.append(row)

    # Aggregates for the confirm dialog.
    priced = [r for r in affected if r.get("old_sell") is not None and r.get("new_sell") is not None]
    tot_old = round(sum(r["old_sell"] for r in priced), 2)
    tot_new = round(sum(r["new_sell"] for r in priced), 2)
    tot_delta = round(tot_new - tot_old, 2)
    tot_delta_pct = round(100 * tot_delta / tot_old, 3) if tot_old else None

    updated_counts: Dict[str, int] = {}
    if not dry_run:
        for col in collections:
            # Update BOTH the doc-level pin AND the state-level mirror. The
            # engine payload builders read `state.pricingVersionId` (that's
            # what the frontend flows to the calc endpoints), while list/load
            # views read the doc-level `pricing_version_id`. If we only touch
            # one, the UI shows new rates on reload but reports still price on
            # the old rates (or vice-versa). Keep them in lock-step.
            res = await db[col].update_many(base_q, {"$set": {
                "pricing_version_id": version_id,
                "state.pricingVersionId": version_id,
            }})
            updated_counts[col] = res.modified_count
        await db[COL_AUDIT_LOG].insert_one({
            "type": "pricing_version_repin",
            "version_id": version_id,
            "version_label": target.get("label"),
            "since": eff_since,
            "collections": collections,
            "include_drafts": include_drafts,
            "exclude_won": exclude_won,
            "exclude_sent": exclude_sent,
            "affected_count": len(affected),
            "updated_counts": updated_counts,
            "total_old_sell": tot_old,
            "total_new_sell": tot_new,
            "total_delta": tot_delta,
            "user": admin.email,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    return {
        "dry_run": dry_run,
        "target_version_id": version_id,
        "target_version_label": target.get("label"),
        "effective_date": target.get("effective_date"),
        "since": eff_since,
        "collections": collections,
        "filters": {
            "include_drafts": include_drafts,
            "exclude_won": exclude_won,
            "exclude_sent": exclude_sent,
        },
        "count": len(affected),
        "updated_counts": updated_counts,
        "totals": {
            "old_sell": tot_old,
            "new_sell": tot_new,
            "delta": tot_delta,
            "delta_pct": tot_delta_pct,
        },
        "quotes": affected,
    }
