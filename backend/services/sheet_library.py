"""SPOT Cloud — Sheet Library service.

Manages the approved stock-sheet library:
  - Baseline 216 sheets come from engine/core.py:APPROVED_SHEETS (immutable code)
  - DB layer in `sheet_library` collection holds:
      • ADDED   sheets (admin entered or CSV imported, id starts with USR-)
      • DISABLED flag on baseline sheets (id starts with SH-, doc has `disabled: True`)
      • EDITED  sheets (admin tweaked dimensions on an existing baseline — rare)
  - The engine reads from a single mutable list APPROVED_SHEETS — we patch it on
    startup from DB so the in-process engine sees the merged effective set.
  - Every change is audit-logged (timestamp · action · key · before · after · user).

NB: We never delete baseline sheets — we mark `disabled: True` so historical
quotes load correctly under Rule 6 (rate migration on load).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, COL_SHEETS, COL_AUDIT_LOG
from engine.core import APPROVED_SHEETS  # mutable in-process list

logger = logging.getLogger("spot.sheets")

# Snapshot of baseline at import time — used so we can identify which entries
# in the live list came from code vs. DB additions.
_BASELINE_IDS = {s["id"] for s in APPROVED_SHEETS}
_BASELINE_BY_ID = {s["id"]: dict(s) for s in APPROVED_SHEETS}


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_user_id(existing_ids: set[str]) -> str:
    """Generate the next USR-### id not already in use."""
    n = 1
    while f"USR-{n:04d}" in existing_ids:
        n += 1
    return f"USR-{n:04d}"


async def load_sheets_from_db() -> Dict[str, int]:
    """Startup hook — apply DB layer onto the live APPROVED_SHEETS list.
    Idempotent. Returns counts for logging."""
    added = 0
    disabled = 0
    edited = 0

    # First restore baseline (in case this is a hot reload)
    APPROVED_SHEETS.clear()
    for s in _BASELINE_BY_ID.values():
        APPROVED_SHEETS.append(dict(s))

    existing_ids = {s["id"] for s in APPROVED_SHEETS}

    async for doc in db[COL_SHEETS].find({}):
        doc_id = doc.get("id")
        if not doc_id:
            continue
        if doc.get("disabled"):
            # Disable a baseline sheet: remove from live list
            APPROVED_SHEETS[:] = [s for s in APPROVED_SHEETS if s["id"] != doc_id]
            disabled += 1
            continue
        if doc_id in existing_ids:
            # Edit on an existing entry
            for i, s in enumerate(APPROVED_SHEETS):
                if s["id"] == doc_id:
                    APPROVED_SHEETS[i] = _shape_sheet(doc)
                    edited += 1
                    break
        else:
            # New addition
            APPROVED_SHEETS.append(_shape_sheet(doc))
            existing_ids.add(doc_id)
            added += 1

    logger.info(f"sheet_library: added={added} edited={edited} disabled={disabled} "
                f"effective={len(APPROVED_SHEETS)}")
    return {"added": added, "edited": edited, "disabled": disabled,
            "effective": len(APPROVED_SHEETS)}


def _shape_sheet(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce a DB doc into the engine's sheet shape."""
    return {
        "id": doc["id"],
        "g":  doc.get("g")  or doc.get("grade"),
        "f":  doc.get("f")  or doc.get("flute"),
        "ol": doc.get("ol") or doc.get("outsideLiner"),
        "il": doc.get("il") or doc.get("insideLiner"),
        "md": doc.get("md") or doc.get("medium"),
        "w":  float(doc.get("w") or doc.get("width") or 0),
        "l":  float(doc.get("l") or doc.get("length") or 0),
    }


def list_effective() -> List[Dict[str, Any]]:
    """Live merged list (what the engine sees)."""
    return list(APPROVED_SHEETS)


async def list_all() -> Dict[str, Any]:
    """Admin view: every baseline + every DB doc, with status flags."""
    db_docs: Dict[str, Dict[str, Any]] = {}
    async for d in db[COL_SHEETS].find({}, {"_id": 0}):
        if d.get("id"):
            db_docs[d["id"]] = d

    rows: List[Dict[str, Any]] = []
    for sid, base in _BASELINE_BY_ID.items():
        db_doc = db_docs.get(sid)
        if db_doc and db_doc.get("disabled"):
            row = {**base, "status": "disabled", "is_baseline": True,
                   "updated_by": db_doc.get("updated_by"),
                   "updated_at": db_doc.get("updated_at")}
        elif db_doc:
            row = {**_shape_sheet(db_doc), "status": "edited", "is_baseline": True,
                   "baseline": base, "updated_by": db_doc.get("updated_by"),
                   "updated_at": db_doc.get("updated_at")}
        else:
            row = {**base, "status": "active", "is_baseline": True}
        rows.append(row)
    # User additions
    for sid, d in db_docs.items():
        if sid not in _BASELINE_IDS:
            rows.append({**_shape_sheet(d), "status": "added", "is_baseline": False,
                         "updated_by": d.get("updated_by"),
                         "updated_at": d.get("updated_at"),
                         "reason": d.get("reason")})
    return {
        "rows": rows,
        "counts": {
            "total":    len(rows),
            "baseline": len(_BASELINE_IDS),
            "added":    sum(1 for r in rows if r["status"] == "added"),
            "edited":   sum(1 for r in rows if r["status"] == "edited"),
            "disabled": sum(1 for r in rows if r["status"] == "disabled"),
            "active":   sum(1 for r in rows if r["status"] == "active"),
        },
    }


async def add_sheet(spec: Dict[str, Any], user_email: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """Add a brand-new user sheet. Validates spec then audit-logs."""
    s = _validate_spec(spec)
    existing_ids = {sh["id"] for sh in APPROVED_SHEETS}
    async for d in db[COL_SHEETS].find({}, {"id": 1}):
        existing_ids.add(d.get("id"))
    new_id = _next_user_id(existing_ids)
    doc = {"id": new_id, **s,
           "updated_at": utc_iso(), "updated_by": user_email, "reason": reason}
    await db[COL_SHEETS].insert_one(doc)
    APPROVED_SHEETS.append(_shape_sheet(doc))
    await db[COL_AUDIT_LOG].insert_one({
        "type": "sheet_added", "key": new_id,
        "value_after": f"{s['f']} {s['g']} {s['ol']}/{s['il']} {s['w']}×{s['l']}",
        "reason": reason, "user": user_email, "timestamp": utc_iso(),
    })
    return {"id": new_id, "status": "added", **s}


async def edit_sheet(sheet_id: str, patch: Dict[str, Any],
                     user_email: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """Edit an existing sheet (baseline or user). Records before/after."""
    before = next((s for s in APPROVED_SHEETS if s["id"] == sheet_id), None)
    if not before:
        raise ValueError(f"Sheet {sheet_id!r} not found")
    merged = {**before, **{k: v for k, v in patch.items()
                            if k in ("g", "f", "ol", "il", "md", "w", "l",
                                      "grade", "flute", "outsideLiner", "insideLiner", "medium",
                                      "width", "length")}}
    s = _validate_spec(merged)
    new_doc = {"id": sheet_id, **s,
               "updated_at": utc_iso(), "updated_by": user_email, "reason": reason}
    await db[COL_SHEETS].update_one({"id": sheet_id}, {"$set": new_doc}, upsert=True)
    for i, sh in enumerate(APPROVED_SHEETS):
        if sh["id"] == sheet_id:
            APPROVED_SHEETS[i] = _shape_sheet(new_doc); break
    await db[COL_AUDIT_LOG].insert_one({
        "type": "sheet_edited", "key": sheet_id,
        "value_before": f"{before['f']} {before['g']} {before['ol']}/{before['il']} {before['w']}×{before['l']}",
        "value_after":  f"{s['f']} {s['g']} {s['ol']}/{s['il']} {s['w']}×{s['l']}",
        "reason": reason, "user": user_email, "timestamp": utc_iso(),
    })
    return {"id": sheet_id, "status": "edited", **s}


async def disable_sheet(sheet_id: str, user_email: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """Soft-delete: remove from engine, keep in DB so historical quotes still
    load. Works on both baseline and user sheets."""
    before = next((s for s in APPROVED_SHEETS if s["id"] == sheet_id), None)
    if not before:
        # Already disabled or never existed
        await db[COL_SHEETS].update_one({"id": sheet_id},
            {"$set": {"id": sheet_id, "disabled": True,
                      "updated_at": utc_iso(), "updated_by": user_email,
                      "reason": reason}}, upsert=True)
        return {"id": sheet_id, "status": "disabled", "noop": True}
    await db[COL_SHEETS].update_one(
        {"id": sheet_id},
        {"$set": {"id": sheet_id, "disabled": True,
                  "g": before["g"], "f": before["f"],
                  "ol": before["ol"], "il": before["il"], "md": before["md"],
                  "w": before["w"], "l": before["l"],
                  "updated_at": utc_iso(), "updated_by": user_email,
                  "reason": reason}},
        upsert=True,
    )
    APPROVED_SHEETS[:] = [s for s in APPROVED_SHEETS if s["id"] != sheet_id]
    await db[COL_AUDIT_LOG].insert_one({
        "type": "sheet_disabled", "key": sheet_id,
        "value_before": f"{before['f']} {before['g']} {before['ol']}/{before['il']} {before['w']}×{before['l']}",
        "reason": reason, "user": user_email, "timestamp": utc_iso(),
    })
    return {"id": sheet_id, "status": "disabled"}


async def enable_sheet(sheet_id: str, user_email: str) -> Dict[str, Any]:
    """Reverse a disable. Baseline sheets get put back; user sheets reactivate."""
    doc = await db[COL_SHEETS].find_one({"id": sheet_id})
    if doc and doc.get("disabled"):
        if sheet_id in _BASELINE_IDS:
            # Remove the disable override → baseline returns
            await db[COL_SHEETS].delete_one({"id": sheet_id})
            base = _BASELINE_BY_ID[sheet_id]
            APPROVED_SHEETS.append(dict(base))
        else:
            # User sheet — unset disabled flag
            await db[COL_SHEETS].update_one({"id": sheet_id},
                {"$set": {"disabled": False, "updated_at": utc_iso(),
                          "updated_by": user_email}})
            APPROVED_SHEETS.append(_shape_sheet(doc))
        await db[COL_AUDIT_LOG].insert_one({
            "type": "sheet_enabled", "key": sheet_id,
            "user": user_email, "timestamp": utc_iso(),
        })
        return {"id": sheet_id, "status": "active"}
    return {"id": sheet_id, "status": "active", "noop": True}


async def import_csv(rows: List[Dict[str, Any]], user_email: str,
                     reason: Optional[str] = None) -> Dict[str, Any]:
    """Bulk-add sheets from a CSV row list. Skips invalid rows; never updates."""
    added = []
    errors = []
    for i, raw in enumerate(rows):
        try:
            r = await add_sheet(raw, user_email, reason=reason or "CSV import")
            added.append(r["id"])
        except Exception as e:
            errors.append({"row": i + 1, "error": str(e), "data": raw})
    await db[COL_AUDIT_LOG].insert_one({
        "type": "sheet_csv_import", "key": "(bulk)",
        "value_after": f"{len(added)} added, {len(errors)} errors",
        "reason": reason, "user": user_email, "timestamp": utc_iso(),
    })
    return {"added_count": len(added), "added_ids": added, "errors": errors}


# ─── Validation ─────────────────────────────────────────────────────────
_ALLOWED_FLUTES = {"E", "B", "C", "B/C", "EE", "EB"}


def _validate_spec(spec: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize CSV/UI input keys and validate required fields."""
    s = {
        "g":  (spec.get("g")  or spec.get("grade")        or "").strip(),
        "f":  (spec.get("f")  or spec.get("flute")        or "").strip(),
        "ol": (spec.get("ol") or spec.get("outsideLiner") or "").strip(),
        "il": (spec.get("il") or spec.get("insideLiner")  or "").strip(),
        "md": (spec.get("md") or spec.get("medium")       or "").strip(),
    }
    try:
        s["w"] = float(spec.get("w") or spec.get("width")  or 0)
        s["l"] = float(spec.get("l") or spec.get("length") or 0)
    except (TypeError, ValueError):
        raise ValueError("width/length must be numeric")
    if not s["g"] or not s["f"]:
        raise ValueError("grade and flute are required")
    if s["w"] <= 0 or s["l"] <= 0:
        raise ValueError("width and length must be > 0")
    if s["f"] not in _ALLOWED_FLUTES:
        raise ValueError(f"flute must be one of: {sorted(_ALLOWED_FLUTES)}")
    return s
