"""Parser file storage — saves raw uploads so estimators can retrieve / re-open
the source documents that were parsed into a quote.

Storage strategy (2026-07-13): file BYTES live in MongoDB GridFS (persistent —
survives redeploys, unlike the old ephemeral container disk which caused
"File blob missing on disk"). Metadata in Mongo collection `parser_files`:
  {
    id:              uuid (str),
    quote_id:        str (draft_id or quote_id — whichever owns this RFQ today),
    filename:        str (original name),
    mime:            str,
    bytes:           int (size),
    hash_sha256:     str (cheap dedupe + integrity),
    gridfs_id:       ObjectId (GridFS blob handle),
    uploaded_at:     iso datetime str,
    uploaded_by:     user email,
    source:          "upload" | "zip_member" | "email_attachment",
    parent_filename: str | None  (for zip/email members: the outer wrapper name),
    deleted_at:      iso datetime | None  (soft-delete; quote deletion sweeps),
  }

Lifecycle (per user direction, 2026-06-12): files persist for the lifetime of
their owning quote/draft. When a quote/draft is deleted, all associated
parser_files are soft-deleted and their GridFS blobs purged.
"""
from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, gridfs_bucket, COL_PARSER_FILES

logger = logging.getLogger(__name__)


async def save_parser_file(
    *,
    quote_id: str,
    filename: str,
    mime: str,
    content: bytes,
    uploaded_by: str,
    source: str = "upload",
    parent_filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist a single file (bytes → GridFS) + metadata. Returns the saved doc."""
    file_id = uuid.uuid4().hex
    safe_name = filename or f"file-{file_id[:8]}"
    gridfs_id = await gridfs_bucket.upload_from_stream(
        safe_name, content,
        metadata={"parser_file_id": file_id, "quote_id": str(quote_id or "orphan"),
                  "mime": mime or "application/octet-stream"},
    )

    sha = hashlib.sha256(content).hexdigest()
    doc = {
        "id": file_id,
        "quote_id": str(quote_id or "orphan"),
        "filename": safe_name,
        "mime": mime or "application/octet-stream",
        "bytes": len(content),
        "hash_sha256": sha,
        "gridfs_id": gridfs_id,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploaded_by or "",
        "source": source,
        "parent_filename": parent_filename,
        "deleted_at": None,
    }
    await db[COL_PARSER_FILES].insert_one(doc)
    doc.pop("_id", None)
    doc.pop("gridfs_id", None)  # internal handle — never leak to callers
    return doc


async def read_parser_file_bytes(doc: Dict[str, Any]) -> Optional[bytes]:
    """Return the raw bytes for a parser_file metadata doc, or None if the blob
    is missing (legacy disk-stored files whose blob was lost, or a bad handle)."""
    gid = doc.get("gridfs_id")
    if gid is None:
        return None
    try:
        stream = await gridfs_bucket.open_download_stream(gid)
        return await stream.read()
    except Exception as e:
        logger.warning(f"gridfs read failed for {doc.get('id')}: {e}")
        return None


async def list_parser_files(quote_id: str) -> List[Dict[str, Any]]:
    """List non-deleted files for a quote."""
    cur = db[COL_PARSER_FILES].find(
        {"quote_id": str(quote_id), "deleted_at": None},
        {"_id": 0, "disk_path": 0, "gridfs_id": 0},  # hide internal handles
    ).sort("uploaded_at", 1)
    return [d async for d in cur]


async def count_files_by_quote(quote_ids: List[str]) -> Dict[str, int]:
    """Return {quote_id: non-deleted file count} for the given quote ids (one query)."""
    ids = [str(q) for q in quote_ids if q]
    if not ids:
        return {}
    cur = db[COL_PARSER_FILES].aggregate([
        {"$match": {"quote_id": {"$in": ids}, "deleted_at": None}},
        {"$group": {"_id": "$quote_id", "n": {"$sum": 1}}},
    ])
    return {d["_id"]: d["n"] async for d in cur}


async def get_parser_file(file_id: str) -> Optional[Dict[str, Any]]:
    """Fetch one file's metadata (including gridfs_id, for download/preview)."""
    doc = await db[COL_PARSER_FILES].find_one(
        {"id": file_id, "deleted_at": None}, {"_id": 0}
    )
    return doc


async def soft_delete_file(file_id: str) -> bool:
    """Mark file deleted + remove the blob from GridFS."""
    doc = await db[COL_PARSER_FILES].find_one_and_update(
        {"id": file_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
        return_document=False,
    )
    if not doc:
        return False
    gid = doc.get("gridfs_id")
    if gid is not None:
        try:
            await gridfs_bucket.delete(gid)
        except Exception as e:
            logger.warning(f"failed to delete gridfs blob for {file_id}: {e}")
    return True


async def reassign_quote_files(from_quote_id: str, to_quote_id: str) -> int:
    """Re-key all parser_files from `from_quote_id` → `to_quote_id`.

    Used by the frontend autosave + save-as-quote flows so files uploaded
    against a transient local tab id (e.g. `local-abc123`) follow the quote
    through to its persisted draft id and later its saved quote id. Returns
    the number of records updated. Blobs stay in GridFS untouched (only the
    owning quote_id key changes)."""
    if not from_quote_id or not to_quote_id or from_quote_id == to_quote_id:
        return 0
    res = await db[COL_PARSER_FILES].update_many(
        {"quote_id": str(from_quote_id), "deleted_at": None},
        {"$set": {"quote_id": str(to_quote_id)}},
    )
    return res.modified_count


async def clone_quote_files(from_quote_id: str, to_quote_id: str) -> int:
    """Duplicate every non-deleted file from one quote to another — NEW metadata
    docs + NEW GridFS blobs so the two quotes' file lifecycles stay independent
    (deleting either quote can't orphan the other's attachments)."""
    if not from_quote_id or not to_quote_id or from_quote_id == to_quote_id:
        return 0
    n = 0
    async for doc in db[COL_PARSER_FILES].find(
            {"quote_id": str(from_quote_id), "deleted_at": None}):
        content = await read_parser_file_bytes(doc)
        if content is None:
            logger.warning(f"clone_quote_files: blob missing for {doc.get('id')}, skipped")
            continue
        await save_parser_file(
            quote_id=to_quote_id,
            filename=doc.get("filename") or "",
            mime=doc.get("mime") or "",
            content=content,
            uploaded_by=doc.get("uploaded_by") or "",
            source=doc.get("source") or "upload",
            parent_filename=doc.get("parent_filename"),
        )
        n += 1
    return n


async def purge_quote_files(quote_id: str) -> int:
    """Hard-delete all files for a quote (called by quote/draft delete handler).
    Returns number of files purged."""
    purged = 0
    async for doc in db[COL_PARSER_FILES].find({"quote_id": str(quote_id)}):
        gid = doc.get("gridfs_id")
        if gid is not None:
            try:
                await gridfs_bucket.delete(gid)
            except Exception:
                pass
        purged += 1
    await db[COL_PARSER_FILES].delete_many({"quote_id": str(quote_id)})
    return purged
