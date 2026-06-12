"""Parser file storage — saves raw uploads so estimators can retrieve / re-open
the source documents that were parsed into a quote.

Storage strategy: filesystem under /app/backend/uploads/<quote_or_draft_id>/<file_id>.<ext>
Metadata in Mongo collection `parser_files`:
  {
    id:              uuid (str),
    quote_id:        str (draft_id or quote_id — whichever owns this RFQ today),
    filename:        str (original name),
    mime:            str,
    bytes:           int (size on disk),
    hash_sha256:     str (cheap dedupe + integrity),
    uploaded_at:     iso datetime str,
    uploaded_by:     user email,
    source:          "upload" | "zip_member" | "email_attachment",
    parent_filename: str | None  (for zip/email members: the outer wrapper name),
    deleted_at:      iso datetime | None  (soft-delete; quote deletion sweeps),
  }

Lifecycle (per user direction, 2026-06-12): files persist for the lifetime of
their owning quote/draft. When a quote/draft is deleted, all associated
parser_files are soft-deleted and their on-disk blobs purged.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from db import db, COL_PARSER_FILES

logger = logging.getLogger(__name__)

UPLOAD_ROOT = Path(os.environ.get("PARSER_UPLOAD_DIR") or "/app/backend/uploads")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _safe_dir(quote_id: str) -> Path:
    """Map a quote/draft id to a directory. Avoid path traversal."""
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", str(quote_id or "orphan"))[:64] or "orphan"
    d = UPLOAD_ROOT / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_ext(filename: str) -> str:
    """Keep alphanumeric extension; cap at 6 chars."""
    if not filename or "." not in filename:
        return ""
    ext = filename.rsplit(".", 1)[-1].lower()
    return "." + re.sub(r"[^a-z0-9]", "", ext)[:6] if ext else ""


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
    """Persist a single file + metadata. Returns the saved metadata doc."""
    file_id = uuid.uuid4().hex
    dirpath = _safe_dir(quote_id)
    diskpath = dirpath / f"{file_id}{_safe_ext(filename)}"
    diskpath.write_bytes(content)

    sha = hashlib.sha256(content).hexdigest()
    doc = {
        "id": file_id,
        "quote_id": str(quote_id or "orphan"),
        "filename": filename or f"file-{file_id[:8]}",
        "mime": mime or "application/octet-stream",
        "bytes": len(content),
        "hash_sha256": sha,
        "disk_path": str(diskpath),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploaded_by or "",
        "source": source,
        "parent_filename": parent_filename,
        "deleted_at": None,
    }
    await db[COL_PARSER_FILES].insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_parser_files(quote_id: str) -> List[Dict[str, Any]]:
    """List non-deleted files for a quote."""
    cur = db[COL_PARSER_FILES].find(
        {"quote_id": str(quote_id), "deleted_at": None},
        {"_id": 0, "disk_path": 0},  # hide internal path
    ).sort("uploaded_at", 1)
    return [d async for d in cur]


async def get_parser_file(file_id: str) -> Optional[Dict[str, Any]]:
    """Fetch one file's metadata (including disk_path, for download handler)."""
    doc = await db[COL_PARSER_FILES].find_one(
        {"id": file_id, "deleted_at": None}, {"_id": 0}
    )
    return doc


async def soft_delete_file(file_id: str) -> bool:
    """Mark file deleted + remove the blob from disk."""
    doc = await db[COL_PARSER_FILES].find_one_and_update(
        {"id": file_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
        return_document=False,
    )
    if not doc:
        return False
    try:
        p = Path(doc.get("disk_path") or "")
        if p.exists():
            p.unlink()
    except OSError as e:
        logger.warning(f"failed to unlink parser file {file_id}: {e}")
    return True


async def purge_quote_files(quote_id: str) -> int:
    """Hard-delete all files for a quote (called by quote/draft delete handler).
    Returns number of files purged."""
    purged = 0
    async for doc in db[COL_PARSER_FILES].find({"quote_id": str(quote_id)}):
        try:
            p = Path(doc.get("disk_path") or "")
            if p.exists():
                p.unlink()
        except OSError:
            pass
        purged += 1
    await db[COL_PARSER_FILES].delete_many({"quote_id": str(quote_id)})
    return purged
