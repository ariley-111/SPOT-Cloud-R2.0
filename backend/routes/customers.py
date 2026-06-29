"""Customer endpoints — typeahead, lookup, CSV upload, Ignition nightly push."""
from __future__ import annotations
import csv
import io
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Header, HTTPException, UploadFile, status

from db import db, COL_CUSTOMERS
from models.schemas import Customer, User
from routes.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/customers", tags=["customers"])

_BUNDLED_CSV = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "customerList.csv"
_SYNC_META_KEY = "__sync_meta__"  # sentinel doc storing last-sync status


async def _load_csv_rows(rows: List[dict], source: str = "csv") -> int:
    """Replace customer collection with given rows (full refresh, atomic-ish).

    Preserves the sync-meta sentinel. Rejects empty payloads so a bad push
    never wipes the live list.
    """
    docs = []
    for r in rows:
        code = (r.get("cust_code") or r.get("code") or "").strip()
        if not code:
            continue
        docs.append({
            "code": code,
            "name": (r.get("cust_name") or r.get("name") or "").strip(),
            "address_1": (r.get("address_1") or r.get("address1") or r.get("street") or "").strip() or None,
            "address_2": (r.get("address_2") or r.get("address2") or "").strip() or None,
            "city": (r.get("city") or "").strip() or None,
            "state": (r.get("state") or "").strip() or None,
            "zip": (r.get("zip") or "").strip() or None,
            "po_required": (r.get("po_required") or "").strip() or None,
            "on_credit_hold": (r.get("oncredithold") or r.get("on_credit_hold") or "").strip() or None,
            "credit_limit": (r.get("credit_limit") or "").strip() or None,
            "csr": (r.get("csr") or r.get("cam") or r.get("customer_service_rep") or "").strip() or None,
            "csr_email": (r.get("csr_email") or r.get("cam_email") or "").strip() or None,
            "salesperson": (r.get("salesperson") or r.get("sales_person") or r.get("sales") or "").strip() or None,
            "salesperson_email": (r.get("salesperson_email") or r.get("sales_email") or "").strip() or None,
        })
    if not docs:
        return 0
    # Full refresh — delete only real customer rows, keep the sync-meta sentinel.
    await db[COL_CUSTOMERS].delete_many({"_meta": {"$exists": False}})
    await db[COL_CUSTOMERS].insert_many(docs)
    await _set_sync_meta(len(docs), source)
    return len(docs)


async def _set_sync_meta(rows: int, source: str) -> None:
    await db[COL_CUSTOMERS].update_one(
        {"_meta": "sync"},
        {"$set": {"_meta": "sync", "rows": rows, "source": source,
                  "ts": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def _get_sync_meta() -> dict:
    doc = await db[COL_CUSTOMERS].find_one({"_meta": "sync"}, {"_id": 0, "_meta": 0})
    return doc or {}


async def ensure_customers_loaded() -> None:
    """On startup, load the bundled CSV if collection is empty."""
    count = await db[COL_CUSTOMERS].count_documents({"_meta": {"$exists": False}})
    if count > 0:
        return
    if not _BUNDLED_CSV.exists():
        return
    with _BUNDLED_CSV.open("r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    await _load_csv_rows(rows, source="bundled")


@router.get("/search", response_model=List[Customer])
async def search(q: str = "", limit: int = 25, _u: User = Depends(get_current_user)) -> List[Customer]:
    """Typeahead — matches code or name (case-insensitive, prefix-preferred)."""
    if not q or len(q.strip()) < 1:
        return []
    q_clean = q.strip()
    regex = {"$regex": q_clean, "$options": "i"}
    cursor = db[COL_CUSTOMERS].find(
        {"$or": [{"code": regex}, {"name": regex}]}, {"_id": 0}
    ).limit(max(1, min(limit, 100)))
    docs = await cursor.to_list(length=limit)
    return [Customer(**d) for d in docs]


@router.get("/{code}", response_model=Customer)
async def get_one(code: str, _u: User = Depends(get_current_user)) -> Customer:
    doc = await db[COL_CUSTOMERS].find_one({"code": code}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Customer {code} not found")
    return Customer(**doc)


@router.get("")
async def list_all(limit: int = 1000, _u: User = Depends(get_current_user)) -> dict:
    flt = {"_meta": {"$exists": False}}
    total = await db[COL_CUSTOMERS].count_documents(flt)
    docs = await db[COL_CUSTOMERS].find(flt, {"_id": 0}).limit(limit).to_list(length=limit)
    return {"total": total, "returned": len(docs), "items": docs}


@router.get("/sync/status")
async def sync_status(_u: User = Depends(get_current_user)) -> dict:
    """Last Ignition push: row count + timestamp + source."""
    meta = await _get_sync_meta()
    total = await db[COL_CUSTOMERS].count_documents({"_meta": {"$exists": False}})
    return {"total": total, "last_sync": meta or None}


@router.post("/sync")
async def sync_from_ignition(
    payload: List[dict] = Body(..., embed=False),
    authorization: Optional[str] = Header(None),
) -> dict:
    """Machine-to-machine: Ignition nightly push of the full customer list (JSON array).

    Auth: Authorization: Bearer <IGNITION_SYNC_KEY>. Full-refresh; empty/bad
    payloads are rejected so a failed push never wipes the live list.
    """
    expected = os.environ.get("IGNITION_SYNC_KEY", "").strip()
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Customer sync not configured")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token or token != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing sync key")
    if not isinstance(payload, list) or len(payload) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payload must be a non-empty JSON array")
    loaded = await _load_csv_rows(payload, source="ignition")
    if loaded == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "No rows had a customer code — refusing to wipe live list")
    return {"status": "ok", "rows_loaded": loaded, "source": "ignition"}


@router.post("/upload")
async def upload_csv(file: UploadFile = File(...), _admin: User = Depends(require_admin)) -> dict:
    """Admin: replace customer list from uploaded CSV. Stub for SharePoint sync (Phase 5)."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Must be a .csv file")
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    loaded = await _load_csv_rows(rows)
    return {"status": "ok", "rows_loaded": loaded}


@router.post("/refresh")
async def refresh_from_bundled(_admin: User = Depends(require_admin)) -> dict:
    """Admin: re-load from bundled CSV. SharePoint Graph API replaces this in Phase 5."""
    if not _BUNDLED_CSV.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bundled CSV not found")
    with _BUNDLED_CSV.open("r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    loaded = await _load_csv_rows(rows)
    return {"status": "ok", "rows_loaded": loaded, "source": str(_BUNDLED_CSV)}
