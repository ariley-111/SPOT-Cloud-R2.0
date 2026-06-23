"""SPOT Cloud — Pricing Admin: Rate Override Service.

Architecture (per user request 2026-06-03):
  - Defaults live in `engine/core.py` (immutable source of truth in code)
  - Overrides live in MongoDB `rate_overrides` collection
  - Effective value = override (if present) ELSE default
  - Engine reads from live dicts (RATE_DEFAULTS, GM_DEFAULTS, etc.) by reference
  - On startup we mutate the live dicts in-place from DB overrides
  - "Reset" removes the override → live dict reverts to baseline snapshot
  - Every change recorded in `audit_log` (append-only, retained forever per requirement)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, COL_RATE_OVERRIDES, COL_AUDIT_LOG
from engine.core import (
    RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS, GRADE_ADDER_DEFAULTS,
    CAD_SETUP, CAD_FALLBACK,
)
from engine.runner import ASMP_DEFAULTS

logger = logging.getLogger("spot.rates")

# ─── RATE_DEFAULTS → ASMP_DEFAULTS key mapping ──────────────────────────
# The engine's runner has its own ASMP_DEFAULTS dict (see runner.py L19-34).
# Engine code reads from ASMP_DEFAULTS via `asmp.get("incaRate")` etc.
# RATE_DEFAULTS lives in core.py and uses slightly different key names for
# some entries. To keep "1:1 legacy parity" intact we don't refactor the engine
# — we just maintain this map so admin overrides mutate BOTH dicts.
#
# Lambda values handle nested keys (crestSetup) and any value coercion the
# engine expects (numeric vs string). value = the override (string or float).
_RATE_TO_ASMP: Dict[str, Any] = {
    # Direct numeric copies (engine wants float; admin stores string)
    "incaRate":          ("incaRate",        float),
    "cadRate":           ("cadRate",         float),
    "crestRate":         ("crestRate",       float),
    "saberRate":         ("saberRate",       float),
    "bobstRate":         ("bobstRate",       float),
    "overheadPct":       ("overheadPct",     float),
    "spoilagePct":       ("spoilagePct",     float),
    "stackHeight":       ("stackHeight",     float),
    "regInkRate":        ("regularInkRate",  float),
    "whiteInkFactor":    ("whiteInkFactor",  float),
    "regMR":             ("regularMR",       float),
    "whiteMR":           ("whiteMR",         float),
    "cadRegSpeed":       ("cadRegularSpeed", float),
    "crestSpeedVal":     ("crestSpeed",      float),
    "bobstSpeed":        ("bobstSpeed",      float),
    "bobstSetup":        ("bobstSetup",      float),
    "bobstMinChg":       ("bobstMinCharge",  float),
    "bobstDieCost":      ("bobstDieCost",    float),
    "bobstFirstSizing":  ("bobstFirstSizing", str),
    "clearTapeCost":     ("clearTapeCostPerFt",      float),
    "reinfTapeCost":     ("reinforcedTapeCostPerFt", float),
    "tapeFtPerPc":       ("tapeFootPerPiece", float),
    "side2Factor":       ("side2PrintFactor", float),
    "incaMinChg":        ("incaMinCharge",   float),
    "cadMinChg":         ("cadMinCharge",    float),
    "crestMinChg":       ("crestMinCharge",  float),
    "saberMinChg":       ("saberMinCharge",  float),
    "saberCostPerCut":   ("saberCostPerCut", float),
    "stripMinChg":       ("handStrippingMinCharge", float),
    "glueMinChg":        ("handGluingMinCharge",    float),
    "handStripRate":     ("handStrippingRate", float),
    "handGlueRate":      ("handGluingRate",    float),
    "perimStripMinPerPallet": ("perimeterStripMinPallet", float),
    "under5MsfFee":      ("under5MsfFee",   float),
    "cadPerfSpeedFactor": ("cadPerfSpeedFactor", float),
    "crestAdvSpeedFactor": ("crestAdvSpeedFactor", float),
    "crestDieCost":      ("crestDieCost",   float),
    # Crest setup: stored in ASMP as nested dict crestSetup: {"Standard": N, "Advanced": M}
    "crestSetupStd":     (("crestSetup", "Standard"), float),
    "crestSetupAdv":     (("crestSetup", "Advanced"), float),
    # Note: kemiTariff / palletPrepFee / *Markup keys are read from RATE_DEFAULTS
    #       directly in pricing.py/runner.py and DON'T live in ASMP_DEFAULTS,
    #       so mutating only RATE_DEFAULTS is enough for those.
    # Default print mode is a string knob read at quote build time — RATE_DEFAULTS only.
}


def _apply_to_asmp(rate_key: str, raw_value: Any) -> None:
    """Mirror a rate override into ASMP_DEFAULTS via the key-rename map."""
    mapping = _RATE_TO_ASMP.get(rate_key)
    if not mapping:
        return  # No-op for rate keys not used by the engine's ASMP path
    asmp_key, coercer = mapping
    try:
        v = coercer(raw_value)
    except (ValueError, TypeError):
        logger.warning(f"rate_overrides: bad value {raw_value!r} for ASMP key {asmp_key}")
        return
    if isinstance(asmp_key, tuple):
        # Nested key (e.g. crestSetup.Standard)
        top, sub = asmp_key
        if not isinstance(ASMP_DEFAULTS.get(top), dict):
            ASMP_DEFAULTS[top] = {}
        ASMP_DEFAULTS[top][sub] = v
    else:
        ASMP_DEFAULTS[asmp_key] = v

# ─── Categories ────────────────────────────────────────────────────────
RATE      = "rate"
GM_TIER   = "gm_tier"
SELL_TIER = "sell_tier"
GRADE     = "grade_adder"
CAD_SETUP_CAT    = "cad_setup"     # cutting setup minutes by complexity
CAD_FALLBACK_CAT = "cad_fallback"  # per-sheet cutting minutes by complexity
CATEGORIES = (RATE, GM_TIER, SELL_TIER, GRADE, CAD_SETUP_CAT, CAD_FALLBACK_CAT)

# Live dict lookup — engine reads from these by reference, so mutations
# propagate immediately. NEVER replace these dicts (would break imports);
# always mutate in place via [key] = value.
_LIVE = {
    RATE:      RATE_DEFAULTS,
    GM_TIER:   GM_DEFAULTS,
    SELL_TIER: SELL_DEFAULTS,
    GRADE:     GRADE_ADDER_DEFAULTS,
    CAD_SETUP_CAT:    CAD_SETUP,
    CAD_FALLBACK_CAT: CAD_FALLBACK,
}

# Snapshot at module-import time — this IS the source-of-truth baseline,
# preserved even if the live dict is mutated later. "Reset" restores from here.
_BASELINE = {cat: dict(d) for cat, d in _LIVE.items()}

# ASMP_DEFAULTS baseline (deep copy because crestSetup is a nested dict)
import copy
_ASMP_BASELINE = copy.deepcopy(ASMP_DEFAULTS)

# Type coercion per category — RATE values are stored as strings (engine parses
# with pn() at use); tiers and adders are stored as floats (engine reads numeric).
_VALUE_COERCERS = {
    RATE:      lambda v: str(v),
    GM_TIER:   lambda v: float(v),
    SELL_TIER: lambda v: float(v),
    GRADE:     lambda v: float(v),
    CAD_SETUP_CAT:    lambda v: float(v),
    CAD_FALLBACK_CAT: lambda v: float(v),
}


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_all_keys(category: str) -> List[str]:
    return sorted(_BASELINE.get(category, {}).keys())


def get_baseline(category: str, key: str) -> Any:
    return _BASELINE.get(category, {}).get(key)


def get_effective(category: str, key: str) -> Any:
    return _LIVE.get(category, {}).get(key)


def has_override(category: str, key: str) -> bool:
    """True iff the live value differs from the baseline."""
    return get_effective(category, key) != get_baseline(category, key)


def _coerce(category: str, value: Any) -> Any:
    fn = _VALUE_COERCERS.get(category)
    if not fn:
        raise ValueError(f"Unknown category {category!r}")
    return fn(value)


async def load_overrides_from_db() -> int:
    """Startup hook: apply all persisted overrides to the live engine dicts.
    Idempotent — safe to call multiple times."""
    count = 0
    try:
        cursor = db[COL_RATE_OVERRIDES].find({})
        async for doc in cursor:
            cat = doc.get("category")
            key = doc.get("key")
            value = doc.get("value")
            if cat not in CATEGORIES or key is None:
                continue
            if key not in _BASELINE[cat]:
                # Unknown key — engine doesn't have a default for it; skip.
                logger.warning(f"rate_overrides: skipping unknown {cat} key {key!r}")
                continue
            try:
                _LIVE[cat][key] = _coerce(cat, value)
                if cat == RATE:
                    _apply_to_asmp(key, value)
                count += 1
            except (ValueError, TypeError) as e:
                logger.error(f"rate_overrides: bad value for {cat}.{key}: {e}")
    except Exception as e:
        logger.error(f"rate_overrides: load failed: {e}")
    logger.info(f"rate_overrides: applied {count} overrides")
    return count


async def set_override(category: str, key: str, new_value: Any, user_email: str) -> Dict[str, Any]:
    """Persist + apply + audit-log a single override."""
    if category not in CATEGORIES:
        raise ValueError(f"Unknown category {category!r}")
    if key not in _BASELINE[category]:
        raise ValueError(f"Unknown {category} key {key!r}")
    new_v = _coerce(category, new_value)
    old_v = _LIVE[category][key]
    baseline = _BASELINE[category][key]

    await db[COL_RATE_OVERRIDES].update_one(
        {"category": category, "key": key},
        {"$set": {
            "category": category, "key": key,
            "value": new_v,
            "baseline": baseline,
            "updated_at": utc_iso(),
            "updated_by": user_email,
        }},
        upsert=True,
    )
    _LIVE[category][key] = new_v
    if category == RATE:
        _apply_to_asmp(key, new_v)
    await db[COL_AUDIT_LOG].insert_one({
        "type": "rate_override_set",
        "category": category, "key": key,
        "value_before": old_v, "value_after": new_v,
        "baseline": baseline,
        "user": user_email,
        "timestamp": utc_iso(),
    })
    return {"category": category, "key": key, "value": new_v,
            "baseline": baseline, "previous": old_v, "is_override": new_v != baseline}


async def reset_override(category: str, key: str, user_email: str) -> Dict[str, Any]:
    """Remove override → live dict reverts to baseline. Audit-logged."""
    if category not in CATEGORIES:
        raise ValueError(f"Unknown category {category!r}")
    if key not in _BASELINE[category]:
        raise ValueError(f"Unknown {category} key {key!r}")
    old_v = _LIVE[category][key]
    baseline = _BASELINE[category][key]
    _LIVE[category][key] = baseline
    # Restore ASMP baseline too if this is a rate
    if category == RATE:
        mapping = _RATE_TO_ASMP.get(key)
        if mapping:
            asmp_key, _ = mapping
            if isinstance(asmp_key, tuple):
                top, sub = asmp_key
                ASMP_DEFAULTS[top][sub] = _ASMP_BASELINE[top][sub]
            else:
                ASMP_DEFAULTS[asmp_key] = _ASMP_BASELINE[asmp_key]
    deleted = await db[COL_RATE_OVERRIDES].delete_one({"category": category, "key": key})
    await db[COL_AUDIT_LOG].insert_one({
        "type": "rate_override_reset",
        "category": category, "key": key,
        "value_before": old_v, "value_after": baseline,
        "baseline": baseline,
        "user": user_email,
        "timestamp": utc_iso(),
    })
    return {"category": category, "key": key, "value": baseline,
            "baseline": baseline, "previous": old_v, "is_override": False,
            "deleted": deleted.deleted_count > 0}


async def reset_all(user_email: str, category: Optional[str] = None) -> int:
    """Mass reset — remove ALL overrides (optionally limited to one category).
    Each individual reset is audit-logged so the trail is preserved."""
    q: Dict[str, Any] = {}
    if category:
        if category not in CATEGORIES:
            raise ValueError(f"Unknown category {category!r}")
        q["category"] = category
    n = 0
    cursor = db[COL_RATE_OVERRIDES].find(q)
    async for doc in cursor:
        try:
            await reset_override(doc["category"], doc["key"], user_email)
            n += 1
        except Exception as e:
            logger.error(f"reset_all: failed on {doc.get('category')}.{doc.get('key')}: {e}")
    await db[COL_AUDIT_LOG].insert_one({
        "type": "rate_override_reset_all",
        "category": category or "ALL",
        "count": n,
        "user": user_email,
        "timestamp": utc_iso(),
    })
    return n


async def list_audit(limit: int = 200, skip: int = 0,
                     category: Optional[str] = None, key: Optional[str] = None) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"type": {"$in": ["rate_override_set", "rate_override_reset", "rate_override_reset_all"]}}
    if category: q["category"] = category
    if key:      q["key"] = key
    cursor = db[COL_AUDIT_LOG].find(q, {"_id": 0}).sort("timestamp", -1).skip(int(skip)).limit(int(limit))
    return [doc async for doc in cursor]
