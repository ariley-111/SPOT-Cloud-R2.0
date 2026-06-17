"""SPOT Cloud — Board Pricing Versions service.

Manages versioned snapshots of BOARD-SUPPLIER pricing (the `base_matrix` and
its sibling adder tables). Each version is a self-contained `config` payload
(the engine PRICING_KEYS) that calc_board overlays at quote-calc time.

Model
─────
  • v1 ("baseline") = a snapshot of the in-code pricing (engine ENGINE values),
    which equals the supplier's 4.14.25 list. Seeded once, idempotently.
  • Exactly one version has status="active" — what NEW drafts price against.
  • A SAVED quote pins `pricing_version_id`. On reload it recomputes against
    THAT version (true freeze). Re-pricing is only via Duplicate (new est #).
  • Existing quotes (pre-feature) are backfilled to the baseline version.

Resolution helpers return the raw `config` dict; the engine layer wraps the
calc in `use_pricing(config)` so calc_board reads the overlaid values.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, COL_PRICING_VERSIONS, COL_QUOTES, COL_QUOTE_DRAFTS, COL_AUDIT_LOG
from models.schemas import PricingVersion
from engine.core import snapshot_pricing_config, PRICING_KEYS

logger = logging.getLogger("spot.pricing_versions")

BASELINE_LABEL = "2025-04-14"
BASELINE_EFFECTIVE = "2025-04-14"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Reads ─────────────────────────────────────────────────────────────────
async def get_active_version() -> Optional[Dict[str, Any]]:
    return await db[COL_PRICING_VERSIONS].find_one({"status": "active"}, {"_id": 0})


async def get_version(version_id: str) -> Optional[Dict[str, Any]]:
    if not version_id:
        return None
    return await db[COL_PRICING_VERSIONS].find_one({"id": version_id}, {"_id": 0})


async def list_versions() -> List[Dict[str, Any]]:
    cursor = db[COL_PRICING_VERSIONS].find({}, {"_id": 0, "config": 0}).sort("created_at", -1)
    return [d async for d in cursor]


async def get_active_config() -> Optional[Dict[str, Any]]:
    v = await get_active_version()
    return (v or {}).get("config")


async def resolve_config(pricing_version_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Return the pricing `config` to calc against:
      • a pinned version id  → that version's config (frozen)
      • None (draft / unsaved) → the active version's config
    Falls back to None (→ engine code defaults) if nothing is found, which is
    always == the baseline, so behavior is never broken."""
    if pricing_version_id:
        v = await get_version(pricing_version_id)
        if v and v.get("config"):
            return v["config"]
    return await get_active_config()


async def get_active_version_id() -> Optional[str]:
    v = await get_active_version()
    return (v or {}).get("id")


# ─── Seed / backfill (startup, idempotent) ──────────────────────────────────
async def seed_baseline_if_missing() -> Optional[str]:
    """Create v1 = the in-code pricing snapshot (4.14.25) and mark it active,
    but ONLY if there are no versions yet. Returns the baseline version id."""
    existing = await db[COL_PRICING_VERSIONS].find_one({}, {"_id": 0, "id": 1})
    if existing:
        # Already initialized — return whatever is active (or the baseline).
        active = await get_active_version()
        if active:
            return active["id"]
        base = await db[COL_PRICING_VERSIONS].find_one({"is_baseline": True}, {"_id": 0, "id": 1})
        return (base or existing).get("id")

    v = PricingVersion(
        label=BASELINE_LABEL,
        effective_date=BASELINE_EFFECTIVE,
        status="active",
        config=snapshot_pricing_config(),
        notes="Baseline snapshot of the in-code engine pricing (supplier 4.14.25 list).",
        created_by="system",
        activated_at=_now(),
        is_baseline=True,
    )
    await db[COL_PRICING_VERSIONS].insert_one(v.model_dump())
    logger.info(f"pricing_versions: seeded baseline v1 ({v.id})")
    return v.id


async def backfill_quotes(version_id: str) -> int:
    """Pin every saved quote (and draft) that has no pricing_version_id to the
    given version. Idempotent — only touches docs missing the field/value."""
    if not version_id:
        return 0
    q = {"$or": [{"pricing_version_id": {"$exists": False}}, {"pricing_version_id": None}]}
    total = 0
    for col in (COL_QUOTES, COL_QUOTE_DRAFTS):
        res = await db[col].update_many(q, {"$set": {"pricing_version_id": version_id}})
        total += res.modified_count
    if total:
        logger.info(f"pricing_versions: backfilled {total} quotes/drafts to {version_id}")
    return total


async def ensure_initialized() -> str:
    """Startup hook: seed baseline + backfill existing quotes. Returns active id."""
    base_id = await seed_baseline_if_missing()
    active_id = await get_active_version_id() or base_id
    if active_id:
        await backfill_quotes(active_id)
    return active_id


# ─── Create / activate (admin importer, Phase 2 uses these) ──────────────────
async def create_version(label: str, config: Dict[str, Any], *,
                         effective_date: Optional[str] = None,
                         change_summary: Optional[Dict[str, Any]] = None,
                         source_file: Optional[str] = None,
                         notes: Optional[str] = None,
                         created_by: Optional[str] = None,
                         activate: bool = False) -> Dict[str, Any]:
    """Persist a new pricing version. If activate=True, flip it active and
    archive the previously-active version."""
    # Keep only the recognized pricing keys in config.
    clean = {k: config[k] for k in PRICING_KEYS if k in config}
    v = PricingVersion(
        label=label,
        effective_date=effective_date,
        status="active" if activate else "archived",
        config=clean,
        change_summary=change_summary,
        source_file=source_file,
        notes=notes,
        created_by=created_by,
        activated_at=_now() if activate else None,
    )
    if activate:
        await db[COL_PRICING_VERSIONS].update_many(
            {"status": "active"}, {"$set": {"status": "archived"}})
    await db[COL_PRICING_VERSIONS].insert_one(v.model_dump())
    await db[COL_AUDIT_LOG].insert_one({
        "type": "pricing_version_create",
        "version_id": v.id, "label": label, "activated": activate,
        "user": created_by, "timestamp": _now(),
    })
    return v.model_dump()


async def activate_version(version_id: str, user_email: Optional[str] = None) -> Dict[str, Any]:
    target = await get_version(version_id)
    if not target:
        raise ValueError(f"Pricing version {version_id!r} not found")
    await db[COL_PRICING_VERSIONS].update_many(
        {"status": "active"}, {"$set": {"status": "archived"}})
    await db[COL_PRICING_VERSIONS].update_one(
        {"id": version_id},
        {"$set": {"status": "active", "activated_at": _now()}})
    await db[COL_AUDIT_LOG].insert_one({
        "type": "pricing_version_activate",
        "version_id": version_id, "label": target.get("label"),
        "user": user_email, "timestamp": _now(),
    })
    logger.info(f"pricing_versions: activated {version_id} ({target.get('label')})")
    return await get_version(version_id)
