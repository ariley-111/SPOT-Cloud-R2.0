"""SPOT Cloud — Integrations service.

Manages third-party API credentials (Anthropic, UTS Freight) with:
  - DB-backed storage (overrides the .env defaults at runtime)
  - Audit-logged changes (same audit_log collection as rate overrides)
  - Masked read-back (never returns full secret over the wire)
  - Fallback chain:  DB override → .env value → empty

This decouples credential management from server restarts and gives admins
visibility into "is the integration configured?" without shell access.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, COL_INTEGRATIONS, COL_AUDIT_LOG

logger = logging.getLogger("spot.integrations")


# ─── Registry of supported integrations ─────────────────────────────────
# (provider, key_name, env_var, label, hint, type)
# `type` controls UI rendering: "secret" → masked password input; "text" → plain text.
INTEGRATIONS: List[Dict[str, str]] = [
    # Anthropic — RFQ parser (Build Estimate)
    {"provider": "anthropic", "key": "ANTHROPIC_API_KEY",
     "env": "ANTHROPIC_API_KEY", "label": "Anthropic API Key",
     "hint": "Paste sk-ant-... from console.anthropic.com",
     "type": "secret"},
    {"provider": "anthropic", "key": "ANTHROPIC_MODEL",
     "env": "ANTHROPIC_MODEL", "label": "Anthropic Model",
     "hint": "e.g. claude-opus-4-7 (advanced)",
     "type": "text"},
    # UTS Freight API
    {"provider": "uts", "key": "UTS_USER",
     "env": "UTS_USER", "label": "UTS Username",
     "hint": "Your UTS portal username",
     "type": "text"},
    {"provider": "uts", "key": "UTS_KEY",
     "env": "UTS_KEY", "label": "UTS API Key (webKey)",
     "hint": "Paste from app.myuts.net",
     "type": "secret"},
    {"provider": "uts", "key": "UTS_BILL_TO_ID",
     "env": "UTS_BILL_TO_ID", "label": "UTS Bill-To ID",
     "hint": "Numeric account ID (default 496663)",
     "type": "text"},
    # Origin (display only — info, not a credential)
    {"provider": "shipping", "key": "ORIGIN_ZIP",
     "env": "ORIGIN_ZIP", "label": "Origin ZIP",
     "hint": "Standard Printing — Canton, OH",
     "type": "text"},
]

# Provider metadata for the UI status pills
PROVIDER_META = {
    "anthropic": {"label": "Anthropic API", "color": "#a855f7",
                  "required_keys": ["ANTHROPIC_API_KEY"]},
    "uts":       {"label": "UTS Freight",   "color": "#22c55e",
                  "required_keys": ["UTS_USER", "UTS_KEY"]},
    "shipping":  {"label": "Shipping",      "color": "#94a3b8",
                  "required_keys": []},  # Info only
}

# In-memory cache of effective values. Loaded once at startup + on every set.
# All reads in parser.py / freight.py go through `get_effective` so this layer
# is always consistent without restart.
_EFFECTIVE_CACHE: Dict[str, str] = {}


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(value: str, key_meta: Dict[str, str]) -> str:
    """Mask a secret for read-back: 'sk-ant-...xyz9' (first 7 + last 4).
    Non-secret types pass through unchanged."""
    if not value or key_meta.get("type") != "secret":
        return value or ""
    if len(value) <= 12:
        return "•" * len(value)
    return f"{value[:7]}…{value[-4:]}"


def _key_meta(key_name: str) -> Optional[Dict[str, str]]:
    return next((i for i in INTEGRATIONS if i["key"] == key_name), None)


async def load_integrations_from_db() -> int:
    """Startup hook — pull all DB overrides into the in-memory cache.
    Idempotent. Logs the resulting state but never prints secrets."""
    _EFFECTIVE_CACHE.clear()
    # Seed cache from .env defaults first
    for meta in INTEGRATIONS:
        _EFFECTIVE_CACHE[meta["key"]] = os.environ.get(meta["env"], "")
    count = 0
    try:
        async for doc in db[COL_INTEGRATIONS].find({}):
            k = doc.get("key")
            v = doc.get("value")
            if k and v is not None and _key_meta(k):
                _EFFECTIVE_CACHE[k] = str(v)
                count += 1
    except Exception as e:
        logger.error(f"integrations: load failed: {e}")
    logger.info(f"integrations: loaded {count} DB overrides; "
                f"effective set covers {len([k for k,v in _EFFECTIVE_CACHE.items() if v])} of "
                f"{len(INTEGRATIONS)} keys")
    return count


def get_effective(key_name: str) -> str:
    """Resolve the effective value (DB override > .env > empty)."""
    if key_name in _EFFECTIVE_CACHE:
        return _EFFECTIVE_CACHE[key_name]
    # Fallback if cache wasn't loaded yet (e.g. very early call)
    meta = _key_meta(key_name)
    return os.environ.get(meta["env"], "") if meta else ""


async def list_all(redact: bool = True) -> Dict[str, Any]:
    """Return the full integration table for the admin UI.
    If `redact=True` (default for over-the-wire), secrets are masked.
    Status field: 'set' if non-empty, 'missing' otherwise."""
    rows = []
    for meta in INTEGRATIONS:
        raw = get_effective(meta["key"])
        rows.append({
            **meta,
            "value": _mask(raw, meta) if redact else raw,
            "status": "set" if raw else "missing",
            "is_override": False,  # filled below
            "env_set": bool(os.environ.get(meta["env"])),
        })
    # Mark which keys have a DB override
    db_keys = set()
    async for doc in db[COL_INTEGRATIONS].find({}, {"key": 1}):
        db_keys.add(doc.get("key"))
    for r in rows:
        r["is_override"] = r["key"] in db_keys

    # Provider-level rollup
    providers = []
    for prov, pmeta in PROVIDER_META.items():
        keys_in_prov = [r for r in rows if r["provider"] == prov]
        configured = all(get_effective(k) for k in pmeta["required_keys"]) \
                     if pmeta["required_keys"] else True
        providers.append({
            "provider": prov, **pmeta, "configured": configured,
            "key_count": len(keys_in_prov),
        })
    return {"rows": rows, "providers": providers}


async def _iter_db_keys():
    async for d in db[COL_INTEGRATIONS].find({}, {"key": 1}):
        yield d.get("key")


async def set_value(key_name: str, value: str, user_email: str) -> Dict[str, Any]:
    meta = _key_meta(key_name)
    if not meta:
        raise ValueError(f"Unknown integration key {key_name!r}")
    old_v = get_effective(key_name)
    new_v = (value or "").strip()
    await db[COL_INTEGRATIONS].update_one(
        {"key": key_name},
        {"$set": {"key": key_name, "provider": meta["provider"],
                  "value": new_v, "updated_at": utc_iso(),
                  "updated_by": user_email}},
        upsert=True,
    )
    _EFFECTIVE_CACHE[key_name] = new_v
    # Audit-log without values — only "set" / "cleared" + last4 hash for traceability
    suffix = (new_v[-4:] if new_v else "")
    await db[COL_AUDIT_LOG].insert_one({
        "type": "integration_set",
        "key": key_name, "provider": meta["provider"],
        "value_before": "(set)" if old_v else "(empty)",
        "value_after":  "(set)" if new_v else "(empty)",
        "value_suffix": suffix,
        "user": user_email,
        "timestamp": utc_iso(),
    })
    return {"key": key_name, "value": _mask(new_v, meta), "status": "set" if new_v else "missing"}


async def reset_value(key_name: str, user_email: str) -> Dict[str, Any]:
    """Remove the DB override → falls back to .env value."""
    meta = _key_meta(key_name)
    if not meta:
        raise ValueError(f"Unknown integration key {key_name!r}")
    res = await db[COL_INTEGRATIONS].delete_one({"key": key_name})
    env_val = os.environ.get(meta["env"], "")
    _EFFECTIVE_CACHE[key_name] = env_val
    await db[COL_AUDIT_LOG].insert_one({
        "type": "integration_reset",
        "key": key_name, "provider": meta["provider"],
        "value_after": "(env fallback)" if env_val else "(empty)",
        "user": user_email,
        "timestamp": utc_iso(),
        "deleted": res.deleted_count > 0,
    })
    return {"key": key_name, "value": _mask(env_val, meta),
            "status": "set" if env_val else "missing"}
