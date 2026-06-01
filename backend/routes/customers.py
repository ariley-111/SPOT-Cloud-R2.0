"""Customer endpoints — typeahead, lookup, CSV upload (SharePoint stub)."""
from __future__ import annotations
import csv
import io
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from db import db, COL_CUSTOMERS
from models.schemas import Customer, User
from routes.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/customers", tags=["customers"])

_BUNDLED_CSV = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "customerList.csv"


async def _load_csv_rows(rows: List[dict]) -> int:
    """Replace customer collection with given rows (full refresh)."""
    if not rows:
        return 0
    await db[COL_CUSTOMERS].delete_many({})
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
        })
    if docs:
        await db[COL_CUSTOMERS].insert_many(docs)
    return len(docs)


async def ensure_customers_loaded() -> None:
    """On startup, load the bundled CSV if collection is empty."""
    count = await db[COL_CUSTOMERS].count_documents({})
    if count > 0:
        return
    if not _BUNDLED_CSV.exists():
        return
    with _BUNDLED_CSV.open("r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    await _load_csv_rows(rows)


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
    total = await db[COL_CUSTOMERS].count_documents({})
    docs = await db[COL_CUSTOMERS].find({}, {"_id": 0}).limit(limit).to_list(length=limit)
    return {"total": total, "returned": len(docs), "items": docs}


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
