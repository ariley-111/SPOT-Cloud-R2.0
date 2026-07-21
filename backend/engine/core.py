"""SPOT Pricing Engine — Python port of spot_engine.js (R1.5.6 / R1.6.5.1).

VERBATIM PORT. The math, constants, control flow, and edge cases mirror
the JavaScript engine line-for-line. This is the single source of truth
for SPOT pricing in the cloud version.

Calibration baseline: D-110 FINAL (2026-04-24).
  Segment Cost R²: 0.9690 | Segment Sell R²: 0.9496
  Fleet cost delta vs iQuote: +6.55%  | Sell premium: +8.30%

Any deviation from the JS engine output MUST be treated as a regression bug.
"""
from __future__ import annotations
import math
import re
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from typing import Any, Dict, List, Optional, Set, Tuple


# ═══════════════════════════════════════════════════════════════
# HELPERS — mirror of JS helpers
# ═══════════════════════════════════════════════════════════════
def pn(v: Any) -> float:
    """parseFloat with Number.isFinite guard. Returns 0 for anything non-numeric.
    Mirrors: const pn = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
    """
    if v is None or isinstance(v, bool):
        return 0.0
    try:
        if isinstance(v, str):
            s = v.strip()
            if s == "":
                return 0.0
            # JS parseFloat parses leading numeric chars and stops; emulate loosely
            try:
                f = float(s)
            except ValueError:
                m = re.match(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?", s)
                f = float(m.group(0)) if m else float("nan")
        else:
            f = float(v)
        return f if math.isfinite(f) else 0.0
    except (ValueError, TypeError):
        return 0.0


def ceil_int(v: Any) -> int:
    """Math.ceil(Number(v||0)) — JS coerces null/undefined to NaN then 0 via ||.
    But ceil(0) == 0, ceil(0.1) == 1. We use pn(v) to coerce safely.
    """
    n = pn(v)
    return math.ceil(n) if n > 0 else int(math.ceil(n))  # negative or zero handled


def num_or_zero(v: Any) -> float:
    """JS pattern `Number(v||0)`. v||0 returns 0 if v is falsy (null/undef/0/'/false)."""
    if v is None or v == "" or v is False:
        return 0.0
    try:
        f = float(v)
        return f if math.isfinite(f) else 0.0
    except (ValueError, TypeError):
        return 0.0


def is_finite(v: Any) -> bool:
    """Number.isFinite — but stricter; returns False for booleans."""
    if isinstance(v, bool) or v is None:
        return False
    try:
        return math.isfinite(float(v))
    except (ValueError, TypeError):
        return False


# ═══════════════════════════════════════════════════════════════
# ENGINE — Board pricing matrix (verbatim from spot_engine.js L7-73)
# ═══════════════════════════════════════════════════════════════
ENGINE: Dict[str, Any] = {
    "org_limits": {"max_dimension_in": 126, "oversize_pair_limit_in": 63},
    "flute_rules": {
        "B": {"wall_type": "singlewall", "flute_upcharge_per_msf": 0},
        "C": {"wall_type": "singlewall", "flute_upcharge_per_msf": 0},
        "E": {"wall_type": "singlewall", "flute_upcharge_per_msf": 0},  # D-110: $3→$0
        "B/C": {"wall_type": "doublewall", "flute_upcharge_per_msf": 0},
    },
    "msf_tiers": [
        {"name": "0-9", "min": 0, "maxExclusive": 10},
        {"name": "10-24", "min": 10, "maxExclusive": 25},
        {"name": "25-49", "min": 25, "maxExclusive": 50},
        {"name": "50-74", "min": 50, "maxExclusive": 75},
        {"name": "75-99", "min": 75, "maxExclusive": 100},
        {"name": "100+", "min": 100, "maxExclusive": None},
    ],
    "base_matrix": {
        "singlewall": {
            "125": {"0-9": 80.97, "10-24": 77.74, "25-49": 76.88, "50-74": 76.88, "75-99": 76.64, "100+": 76.64},
            "150": {"0-9": 95.01, "10-24": 92.39, "25-49": 91.54, "50-74": 91.54, "75-99": 90.55, "100+": 90.55},
            "175": {"0-9": 97.71, "10-24": 96.32, "25-49": 96.11, "50-74": 94.76, "75-99": 93.12, "100+": 93.12},
            "200": {"0-9": 102.98, "10-24": 99.17, "25-49": 97.64, "50-74": 96.21, "75-99": 95.52, "100+": 94.19},
            "250": {"0-9": 122.27, "10-24": 120.73, "25-49": 120.47, "50-74": 117.31, "75-99": 117.31, "100+": 117.31},
            "275": {"0-9": 139.58, "10-24": 137.84, "25-49": 137.6, "50-74": 134.55, "75-99": 134.55, "100+": 134.55},
            "350": {"0-9": 230.35, "10-24": 217.25, "25-49": 213.45, "50-74": 212.9, "75-99": 207.39, "100+": 206.09},
            "ECT 23": {"0-9": 80.97, "10-24": 77.74, "25-49": 76.88, "50-74": 76.88, "75-99": 76.64, "100+": 76.64},
            "ECT 26": {"0-9": 95.01, "10-24": 92.39, "25-49": 91.54, "50-74": 91.54, "75-99": 90.55, "100+": 90.55},
            "ECT 29": {"0-9": 97.71, "10-24": 96.32, "25-49": 96.11, "50-74": 94.76, "75-99": 93.12, "100+": 93.12},
            "ECT 32": {"0-9": 95.31, "10-24": 89.2, "25-49": 87.7, "50-74": 86.78, "75-99": 86.06, "100+": 84.78},
            "ECT 40": {"0-9": 120.6, "10-24": 114.44, "25-49": 112.94, "50-74": 112.03, "75-99": 111.31, "100+": 110.02},
            "ECT 44": {"0-9": 120.6, "10-24": 114.44, "25-49": 112.94, "50-74": 112.03, "75-99": 111.31, "100+": 110.02},
            "ECT 55": {"0-9": 192.96, "10-24": 186.8, "25-49": 185.34, "50-74": 184.36, "75-99": 183.68, "100+": 182.38},
            "NT": {"0-9": 76.88, "10-24": 76.88, "25-49": 76.88, "50-74": 76.88, "75-99": 76.64, "100+": 76.64},
        },
        "doublewall": {
            "200 DW": {"0-9": 150.51, "10-24": 144.78, "25-49": 142.85, "50-74": 142.34, "75-99": 141.3, "100+": 141.3},
            "275 DW": {"0-9": 155.14, "10-24": 149.58, "25-49": 147.65, "50-74": 147.13, "75-99": 146.46, "100+": 146.46},
            "350 DW": {"0-9": 165.43, "10-24": 159.75, "25-49": 157.75, "50-74": 157.2, "75-99": 156.64, "100+": 156.64},
            "400 DW": {"0-9": 233.49, "10-24": 227.64, "25-49": 225.97, "50-74": 224.68, "75-99": 223.08, "100+": 219.62},
            "450 DW": {"0-9": 235.78, "10-24": 229.95, "25-49": 228.21, "50-74": 226.99, "75-99": 225.42, "100+": 221.97},
            "500 DW": {"0-9": 277.47, "10-24": 266.56, "25-49": 264.56, "50-74": 264.56, "75-99": 263.51, "100+": 262.12},
            "600 DW": {"0-9": 336.63, "10-24": 324.49, "25-49": 323.25, "50-74": 320.1, "75-99": 313.43, "100+": 313.43},
            "ECT 42": {"0-9": 145.47, "10-24": 141.39, "25-49": 139.49, "50-74": 137.53, "75-99": 135.52, "100+": 133.47},
            "ECT 48": {"0-9": 145.47, "10-24": 141.39, "25-49": 139.49, "50-74": 137.53, "75-99": 135.52, "100+": 133.47},
            "ECT 51": {"0-9": 152.35, "10-24": 148.09, "25-49": 146.12, "50-74": 144.05, "75-99": 141.96, "100+": 139.83},
            "ECT 61": {"0-9": 198.97, "10-24": 192.96, "25-49": 190.85, "50-74": 190.84, "75-99": 190.2, "100+": 190.2},
            "ECT 71": {"0-9": 200.14, "10-24": 194.11, "25-49": 192.05, "50-74": 192.05, "75-99": 191.28, "100+": 191.28},
            "ECT 82": {"0-9": 273.46, "10-24": 264.81, "25-49": 261.47, "50-74": 261.47, "75-99": 261.02, "100+": 261.02},
            "NT DW": {"0-9": None, "10-24": None, "25-49": 142.85, "50-74": 142.34, "75-99": 141.3, "100+": 141.3},
        },
    },
    "liner_upgrades": {
        "None": {"amount_per_msf": 0},
        "33# Kla-White": {"amount_per_msf": 7.5, "allowed_board_grades": ["175", "ECT 32"], "enforce": True},
        "42# Kla-White": {"amount_per_msf": 8.0},
        "56# Kla-White": {"amount_per_msf": 15.0, "allowed_board_grades": ["250"], "enforce": True},
        "42# Bleached White": {"amount_per_msf": 17.5},
        "42# Kemi-Lite": {"base_amount_per_msf": 18.5},
    },
    "medium_upgrades": {
        "None": {"amount_per_msf": 0},
        "26# Medium": {"amount_per_msf": 3.0, "check_availability": True},
        "33# Medium": {"amount_per_msf": 7.0},
        "35HPL# Medium": {"amount_per_msf": 8.6},
        "40# Medium": {"amount_per_msf": 12.5},
        "42# Bleached Medium": {"amount_per_msf": 28.5},
    },
    "dimensional_adders": {
        "width": [{"min": 8.875, "max": 10.0, "amount_per_msf": 4.5}],
        "length": [{"min": 22.0, "max": 25.0, "amount_per_msf": 4.5}],
    },
    "fixed_charges": {
        "under_5_msf_setup_fee": {"trigger_order_msf_lt": 5, "amount": 0},
        "pallet_prep_fee": {"amount": 17.5},
    },
}


# ═══════════════════════════════════════════════════════════════
# VERSIONED BOARD PRICING (Phase 1 — Board Pricing Update + Freeze)
# ───────────────────────────────────────────────────────────────
# Only the BOARD-SUPPLIER pricing keys below are versioned/snapshotted.
# Machine/labor rates + margin curves (RATE_DEFAULTS, GM/SELL_DEFAULTS,
# GRADE_ADDER_DEFAULTS) are managed separately by services/rate_overrides
# and are NOT part of a pricing version.
#
# Resolution model: per-request ContextVar overlay. When a request sets an
# override (a saved quote's PINNED version, or the ACTIVE version for drafts),
# calc_board/get_liner_rate read from {**ENGINE, **override}. With NO override
# set, they read the module ENGINE values verbatim → exact legacy parity, and
# v1 == these values, so existing quotes never move.
# ═══════════════════════════════════════════════════════════════
PRICING_KEYS: Tuple[str, ...] = (
    "base_matrix", "liner_upgrades", "medium_upgrades",
    "dimensional_adders", "fixed_charges", "flute_rules",
)

_pricing_override: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "spot_pricing_override", default=None)


def active_engine() -> Dict[str, Any]:
    """The pricing config in effect for the current request: ENGINE overlaid
    with any ContextVar pricing override. Returns ENGINE itself when none set."""
    ov = _pricing_override.get()
    if not ov:
        return ENGINE
    return {**ENGINE, **ov}


def snapshot_pricing_config() -> Dict[str, Any]:
    """Deep copy of the current code-level pricing config (the v1 baseline)."""
    return {k: deepcopy(ENGINE[k]) for k in PRICING_KEYS}


@contextmanager
def use_pricing(config: Optional[Dict[str, Any]]):
    """Apply a versioned pricing config for the duration of the block.
    No-op when config is falsy (→ uses code defaults / active version)."""
    if not config:
        yield
        return
    token = _pricing_override.set(config)
    try:
        yield
    finally:
        _pricing_override.reset(token)


# ═══════════════════════════════════════════════════════════════
# PER-QUOTE RATE FREEZE (Phase 2 — Rate Freeze)
# ───────────────────────────────────────────────────────────────
# Mirrors the board-pricing freeze, but for the admin RATE OVERRIDES
# (machine rates, CAD setup/per-sheet, grade adders, markups/fees).
# A SAVED quote pins a `rate_snapshot` at save time; on recalc the engine
# reads frozen rates via the accessors below. Drafts/new quotes set no
# snapshot → accessors return the LIVE module dicts (current admin values).
# Snapshot keys match services/rate_overrides categories: "rate",
# "grade_adder", "cad_setup", "cad_fallback" (gm/sell tiers live in quote state).
# ═══════════════════════════════════════════════════════════════
_rate_freeze: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "spot_rate_freeze", default=None)


@contextmanager
def use_rate_freeze(snapshot: Optional[Dict[str, Any]]):
    """Apply a per-quote rate snapshot for the duration of the block.
    No-op when snapshot is falsy (→ drafts/new quotes use live admin rates)."""
    if not snapshot:
        yield
        return
    token = _rate_freeze.set(snapshot)
    try:
        yield
    finally:
        _rate_freeze.reset(token)


def _freeze_cat(cat: str) -> Optional[Dict[str, Any]]:
    ov = _rate_freeze.get()
    return ov.get(cat) if ov else None


def active_cad_setup() -> Dict[str, Any]:
    f = _freeze_cat("cad_setup")
    return {**CAD_SETUP, **f} if f else CAD_SETUP


def active_cad_fallback() -> Dict[str, Any]:
    f = _freeze_cat("cad_fallback")
    return {**CAD_FALLBACK, **f} if f else CAD_FALLBACK


def active_grade_adders() -> Dict[str, Any]:
    f = _freeze_cat("grade_adder")
    return {**GRADE_ADDER_DEFAULTS, **f} if f else GRADE_ADDER_DEFAULTS


def active_strip_defaults() -> Dict[str, Any]:
    f = _freeze_cat("strip_complexity")
    return {**STRIP_DEFAULTS, **f} if f else STRIP_DEFAULTS


def active_glue_defaults() -> Dict[str, Any]:
    f = _freeze_cat("glue_complexity")
    return {**GLUE_DEFAULTS, **f} if f else GLUE_DEFAULTS


def active_rate_defaults() -> Dict[str, Any]:
    f = _freeze_cat("rate")
    return {**RATE_DEFAULTS, **f} if f else RATE_DEFAULTS


# ═══════════════════════════════════════════════════════════════
# APPROVED SHEET LIBRARY — 216 sheets, verbatim from spot_engine.js L78
# ═══════════════════════════════════════════════════════════════
SHEET_GROUPS: List[Dict[str, Any]] = [
    {"g": "200", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "B", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "B", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "B", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "B", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "B", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "B", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "C", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "250", "f": "C", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "ECT 44", "f": "C", "ol": "None", "il": "None", "md": "None", "sizes": [[60, 120], [63, 126], [63, 63], [63, 98]]},
    {"g": "200", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "200", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "200", "f": "E", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "200", "f": "E", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "200", "f": "E", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "200", "f": "E", "ol": "None", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "250", "f": "E", "ol": "None", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kemi-Lite", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "42# Kemi-Lite", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "42# Kemi-Lite", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "42# Kla-White", "il": "42# Kla-White", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "42# Kla-White", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
    {"g": "ECT 44", "f": "E", "ol": "None", "il": "None", "md": "None", "sizes": [[48, 96], [60, 120], [63, 126], [63, 63]]},
]

# Expand groups into flat sheet list (mirrors L80-87)
APPROVED_SHEETS: List[Dict[str, Any]] = []
_sid = 1
for g in SHEET_GROUPS:
    for (w, l) in g["sizes"]:
        APPROVED_SHEETS.append({
            "id": f"SH-{_sid:03d}",
            "g": g["g"], "f": g["f"], "ol": g["ol"], "il": g["il"], "md": g["md"],
            "w": w, "l": l,
        })
        _sid += 1


# ═══════════════════════════════════════════════════════════════
# CONSTANTS (verbatim L92-165)
# ═══════════════════════════════════════════════════════════════
FLUTE_CALIPERS = {"E": 0.0625, "B": 0.125, "C": 0.1875, "B/C": 0.236}
PRINT_SPEEDS = {"Gloss": 75, "Satin": 75, "OnQ Styrene": 50, "OnQ Lightbox": 40}
CAD_SETUP = {"Simple": 8, "Standard": 25, "Complex": 22}
CAD_FALLBACK = {"Simple": 2, "Standard": 2, "Complex": 4}
STRIP_DEFAULTS = {"Simple": 0.5, "Straight": 1.0, "Standard": 3.0, "Complex": 5.0}
GLUE_DEFAULTS = {"Simple": 1.0, "Standard": 1.5, "Complex": 2.0}
CAD_DIFF_MIGRATION = {"Simple": "Simple", "Standard": "Straight", "Complex": "Standard", "Extreme": "Complex"}
STRIP_DIFF_MIGRATION = {"Simple": "Simple", "Standard": "Straight", "Complex": "Standard", "Extreme": "Complex"}


def compute_difficulty_from_rule(rule_inches: float, one_up_w: float, one_up_l: float,
                                  has_skip_score: bool = False, has_perf: bool = False) -> str:
    """iQuote calculator parity (3 tiers: Simple / Standard / Complex).

    Complex if ANY:
      - has_skip_score or has_perf (callouts on the CAD)
      - rule_inches / (2*(L+W)) > 3   (more than 3x perimeter of cuts/scores)
    Simple is manual-only — set by estimator for plain rectangles. The auto-classifier
    never picks Simple; it returns Standard when neither Complex trigger fires.
    """
    if has_skip_score or has_perf:
        return "Complex"
    perim = 2 * (max(0.0, one_up_w) + max(0.0, one_up_l))
    if perim <= 0 or rule_inches <= 0:
        return "Standard"
    ratio = rule_inches / perim
    return "Complex" if ratio > 3.0 else "Standard"


SPOT_SCHEMA_VERSION = 2

GM_MSF_TIERS = [
    {"name": "0-1", "min": 0, "maxExclusive": 1},
    {"name": "1-3", "min": 1, "maxExclusive": 3},
    {"name": "3-5", "min": 3, "maxExclusive": 5},
    {"name": "5-9", "min": 5, "maxExclusive": 10},
    {"name": "10-24", "min": 10, "maxExclusive": 25},
    {"name": "25-49", "min": 25, "maxExclusive": 50},
    {"name": "50-74", "min": 50, "maxExclusive": 75},
    {"name": "75-99", "min": 75, "maxExclusive": 100},
    {"name": "100+", "min": 100, "maxExclusive": None},
]
GM_DEFAULTS = {"0-1": 0.50, "1-3": 0.37, "3-5": 0.32, "5-9": 0.27, "10-24": 0.25, "25-49": 0.25, "50-74": 0.25, "75-99": 0.25, "100+": 0.25}
SELL_DEFAULTS = {"0-1": 600, "1-3": 500, "3-5": 450, "5-9": 400, "10-24": 375, "25-49": 325, "50-74": 300, "75-99": 285, "100+": 260}

GRADE_ADDER_DEFAULTS = {
    "125": 0, "150": 0, "175": 0, "200": 15, "250": 46, "275": 5, "350": 0,
    "ECT 23": 0, "ECT 26": 0, "ECT 29": 0, "ECT 32": 15, "ECT 40": 46, "ECT 44": 2, "ECT 55": 0, "NT": 0,
    "200 DW": 0, "275 DW": 0, "350 DW": 0, "400 DW": 0, "450 DW": 0, "500 DW": 0, "600 DW": 0,
    "ECT 42": 0, "ECT 48": 0, "ECT 51": 8, "ECT 61": 0, "ECT 71": 0, "ECT 82": 0,
}

CREST_MAX_W = 60
CREST_MAX_L = 120
BOBST_MIN_W = 13.78
BOBST_MIN_L = 15.75
BOBST_MAX_W = 41.75
BOBST_MAX_L = 29.125
BOBST_FLUTES = ["E", "F"]

RATE_DEFAULTS = {
    "overheadPct": "0", "spoilagePct": "0.02", "kemiTariff": "2.50", "palletPrepFee": "17.50", "under5MsfFee": "0",
    "freightMarkup": "0.15", "dieMarkup": "0.15", "miscChargeMarkup": "0.15", "purchasedMarginPct": "0.40",
    "incaRate": "485", "cadRate": "138", "crestRate": "45", "saberRate": "2", "handStripRate": "17", "handGlueRate": "23",
    "incaMinChg": "0", "cadMinChg": "0", "crestMinChg": "0", "saberMinChg": "0", "saberCostPerCut": "0", "stripMinChg": "0", "glueMinChg": "0",
    "regInkRate": "0.05", "whiteInkFactor": "0.5", "regMR": "5", "whiteMR": "15",
    "stackHeight": "48", "cadRegSpeed": "650", "crestSpeedVal": "150",
    "clearTapeCost": "0.03", "reinfTapeCost": "0.08", "tapeFtPerPc": "2", "tapeCostPerInch": "0.00245", "tapeLaborRate": "30", "tapeStripsPerHour": "60", "side2Factor": "0.60",
    "crestSetupStd": "45", "crestSetupAdv": "90", "crestAdvSpeedFactor": "0.80",
    "perimStripMinPerPallet": "15", "cadPerfSpeedFactor": "0.40",
    "defaultPrepressCost": "50", "defaultPrintMode": "Satin",
    "defaultProofCost": "200", "proofMarkup": "0",
    "crestDieCost": "1200",
    "bobstRate": "350", "bobstSpeed": "3000", "bobstSetup": "45", "bobstMinChg": "250", "bobstDieCost": "1800",
    "bobstFirstSizing": "true",
}

ECT_GRADE_FALLBACK = {
    "ECT 23": "125", "ECT 26": "150", "ECT 29": "175", "ECT 32": "200",
    "ECT 40": "250", "ECT 44": "275", "ECT 55": "350",
}
MULLEN_UPGRADE = {"125": "150", "150": "175", "175": "200", "200": "250", "250": "275", "275": "350"}

MEDIUM_ORDER = ["None", "26# Medium", "33# Medium", "35HPL# Medium", "40# Medium", "42# Bleached Medium"]
MEDIUM_FALLBACK_POOL = ["None", "26# Medium", "33# Medium", "35HPL# Medium", "40# Medium"]


# ═══════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════
def is_bobst_eligible(flute: str, sheet_w: float, sheet_l: float) -> bool:
    return (flute in BOBST_FLUTES and
            sheet_w >= BOBST_MIN_W and sheet_l >= BOBST_MIN_L and
            sheet_w <= BOBST_MAX_W and sheet_l <= BOBST_MAX_L)


def get_msf_tier(msf: float) -> str:
    for t in ENGINE["msf_tiers"]:
        if msf >= t["min"] and (t["maxExclusive"] is None or msf < t["maxExclusive"]):
            return t["name"]
    return "-"


def get_gm_msf_tier(msf: float) -> str:
    for t in GM_MSF_TIERS:
        if msf >= t["min"] and (t["maxExclusive"] is None or msf < t["maxExclusive"]):
            return t["name"]
    return "0-1"


def get_dim_adder(v: float, rules: List[Dict[str, Any]]) -> float:
    for r in rules:
        if v >= r["min"] and v <= r["max"]:
            return r["amount_per_msf"]
    return 0.0


def get_liner_rate(name: str, kemi_tariff: float) -> float:
    r = active_engine()["liner_upgrades"].get(name)
    if not r:
        return 0.0
    if name == "42# Kemi-Lite":
        return (r.get("base_amount_per_msf", 0) or 0) + kemi_tariff
    return r.get("amount_per_msf", 0) or 0.0


def get_grade_fallback(grade: str) -> Optional[str]:
    return ECT_GRADE_FALLBACK.get(grade)


def get_medium_fallback(requested_medium: str, available_mediums: Set[str]) -> Optional[Dict[str, Any]]:
    if requested_medium == "None":
        return None
    if requested_medium == "42# Bleached Medium":
        return None
    if requested_medium not in MEDIUM_FALLBACK_POOL:
        return None
    req_idx = MEDIUM_FALLBACK_POOL.index(requested_medium)
    # First: next higher available
    for i in range(req_idx + 1, len(MEDIUM_FALLBACK_POOL)):
        if MEDIUM_FALLBACK_POOL[i] in available_mediums:
            return {"medium": MEDIUM_FALLBACK_POOL[i], "isHigher": True}
    # Second: highest non-bleached medium available
    for i in range(len(MEDIUM_FALLBACK_POOL) - 1, -1, -1):
        if i != req_idx and MEDIUM_FALLBACK_POOL[i] in available_mediums:
            return {"medium": MEDIUM_FALLBACK_POOL[i], "isHigher": i > req_idx}
    return None


# ═══════════════════════════════════════════════════════════════
# calcBoard — board pricing (verbatim L227-258)
# ═══════════════════════════════════════════════════════════════
def calc_board(bi: Dict[str, Any], qty: int, is_stock: bool = False) -> Dict[str, Any]:
    eng = active_engine()
    fr = eng["flute_rules"].get(bi["flute"])
    if not fr:
        return {
            "qty": qty, "sqft": 0, "oSqFt": 0, "oMsf": 0, "tier": "-", "base": None,
            "hasPrice": False, "olR": 0, "ilR": 0, "mdR": 0, "flR": 0, "wA": 0, "lA": 0,
            "effRate": 0, "varCost": 0, "kemiChg": 0, "fscAmt": 0, "setup": 0, "pp": 0,
            "total": 0, "effWithFsc": 0, "costPc": 0, "isKraft": False,
            "minSqFt": 25000, "minQty": 0, "meetMin": False, "pricable": False,
        }
    mk = fr["wall_type"]
    sqft = (bi["lengthIn"] * bi["widthIn"]) / 144
    o_sq_ft = sqft * qty
    o_msf = o_sq_ft / 1000
    tier = get_msf_tier(o_msf)
    base = eng["base_matrix"][mk].get(bi["boardGrade"], {}).get(tier)
    has_price = base is not None
    kemi_tariff = bi.get("kemiTariff", 2.50)
    ol_r = get_liner_rate(bi["outsideLiner"], kemi_tariff)
    il_r = get_liner_rate(bi["insideLiner"], kemi_tariff)
    k_sides = (1 if bi["outsideLiner"] == "42# Kemi-Lite" else 0) + (1 if bi["insideLiner"] == "42# Kemi-Lite" else 0)
    md_up = eng["medium_upgrades"].get(bi["medium"]) or {}
    md_r = md_up.get("amount_per_msf", 0) or 0
    fl_r = fr.get("flute_upcharge_per_msf", 0) or 0
    w_a = get_dim_adder(bi["widthIn"], eng["dimensional_adders"]["width"])
    l_a = get_dim_adder(bi["lengthIn"], eng["dimensional_adders"]["length"])
    grade_adder = bi["gradeAdder"] if is_finite(bi.get("gradeAdder")) else 0
    eff_rate = (base or 0) + ol_r + il_r + md_r + fl_r + w_a + l_a + grade_adder
    var_cost = eff_rate * o_msf
    kemi_chg = k_sides * kemi_tariff * o_msf
    fsc_amt = (bi["fscFee"] if is_finite(bi.get("fscFee")) else 25) if bi.get("fscEnabled") else 0
    setup = (bi["under5MsfFee"] if is_finite(bi.get("under5MsfFee")) else 0) if o_msf < eng["fixed_charges"]["under_5_msf_setup_fee"]["trigger_order_msf_lt"] else 0
    pp_rate = bi["palletPrepFee"] if is_finite(bi.get("palletPrepFee")) else 17.5
    pp = 0 if is_stock else pp_rate * o_msf
    total = var_cost + fsc_amt + setup + pp
    is_kraft = bi["outsideLiner"] == "None" and bi["insideLiner"] == "None"
    min_sq_ft = 15000 if is_kraft else 25000
    min_qty = math.ceil(min_sq_ft / sqft) if sqft > 0 else 0
    meet_min = True if is_stock else (o_sq_ft >= min_sq_ft)
    pricable = has_price and meet_min
    return {
        "qty": qty, "sqft": sqft, "oSqFt": o_sq_ft, "oMsf": o_msf, "tier": tier,
        "base": base, "hasPrice": has_price, "olR": ol_r, "ilR": il_r, "mdR": md_r, "flR": fl_r,
        "wA": w_a, "lA": l_a, "effRate": eff_rate, "varCost": var_cost, "kemiChg": kemi_chg,
        "fscAmt": fsc_amt, "setup": setup, "pp": pp, "total": total,
        "effWithFsc": total / o_msf if o_msf > 0 else 0,
        "costPc": total / qty if qty > 0 else 0,
        "isKraft": is_kraft, "minSqFt": min_sq_ft, "minQty": min_qty, "meetMin": meet_min, "pricable": pricable,
    }


# ═══════════════════════════════════════════════════════════════
# Layout engine (RULE-005 through RULE-011)
# ═══════════════════════════════════════════════════════════════
def compute_layout(one_up_w: float, one_up_l: float, sheet_w: float, sheet_l: float) -> Optional[Dict[str, Any]]:
    if one_up_w <= 0 or one_up_l <= 0:
        return None
    num_up = math.floor((sheet_w - 2) / one_up_w)
    num_out = math.floor((sheet_l - 2) / one_up_l)
    pcs_per_sheet = num_up * num_out
    if pcs_per_sheet < 1:
        return None
    used_w = num_up * one_up_w
    used_l = num_out * one_up_l
    sheet_area = sheet_w * sheet_l
    used_area = used_w * used_l
    waste_pct = 1 - (used_area / sheet_area) if sheet_area > 0 else 0
    return {"numUp": num_up, "numOut": num_out, "pcsPerSheet": pcs_per_sheet,
            "wastePct": waste_pct, "sheetW": sheet_w, "sheetL": sheet_l}
