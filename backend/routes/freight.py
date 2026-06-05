"""Freight quote — verbatim port of legacy spot_server.js freight logic.

Three-tier resolution:
  1. SPCOC local zone (Canton metro / Akron / Cleveland) — flat-rate SPC fleet
  2. UTS API /v1/rateestimate — picks lowest of multiple carrier rates
  3. National zone fallback (zone 1-8 CWT pricing) — used when UTS unavailable
"""
from __future__ import annotations
import asyncio
import base64
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

# Process-wide semaphore: UTS returns HTTP 500 if multiple rateestimate calls
# arrive concurrently on the same auth session, so we funnel them one-at-a-time.
_UTS_LOCK = asyncio.Lock()

from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/freight", tags=["freight"])


# ─── SPCOC Local Zones (D-119) ──────────────────────────────────────
SPCOC_ZONES = {
    "447": 1,
    "443": 2, "444": 2, "446": 2, "448": 2,
    "440": 3, "441": 3, "442": 3, "445": 3, "449": 3,
}
SPCOC_RATES = {1: 45, 2: 70, 3: 95}
SPCOC_LABELS = {
    1: "Zone 1 — Canton metro",
    2: "Zone 2 — Akron/Alliance",
    3: "Zone 3 — Cleveland/Youngstown/Mansfield",
}
SPCOC_MAX_WEIGHT = 10000
SPCOC_MAX_TRAILER_FT = 24

# ─── National Zone Fallback (when UTS unavailable) ──────────────────
FALLBACK_ZONES = [
    {"zone": 1, "label": "OH local", "cwt": 35, "min": 175},
    {"zone": 2, "label": "OH/PA/WV", "cwt": 42, "min": 175},
    {"zone": 3, "label": "Mid-Atlantic", "cwt": 48, "min": 200},
    {"zone": 4, "label": "SE/NE", "cwt": 55, "min": 225},
    {"zone": 5, "label": "Deep South", "cwt": 62, "min": 250},
    {"zone": 6, "label": "South/Plains", "cwt": 72, "min": 300},
    {"zone": 7, "label": "Mountain", "cwt": 85, "min": 350},
    {"zone": 8, "label": "West Coast", "cwt": 98, "min": 400},
]

# ─── UTS Config ──────────────────────────────────────────────────────
# Defaults from .env are used if no DB override is set in `integrations`
# (admin can update either; service.get_effective returns DB-first).
ORIGIN_ZIP_DEFAULT = os.environ.get("ORIGIN_ZIP", "44704")
UTS_BASE = os.environ.get("UTS_BASE", "https://api.myuts.net/v1")
UTS_USER_DEFAULT = os.environ.get("UTS_USER", "")
UTS_KEY_DEFAULT = os.environ.get("UTS_KEY", "")
UTS_BILL_TO_ID_DEFAULT = int(os.environ.get("UTS_BILL_TO_ID", "496663") or "496663")

from services.integrations import get_effective as _integ_get


def _uts_creds():
    user = _integ_get("UTS_USER") or UTS_USER_DEFAULT
    key  = _integ_get("UTS_KEY")  or UTS_KEY_DEFAULT
    bid_raw = _integ_get("UTS_BILL_TO_ID") or str(UTS_BILL_TO_ID_DEFAULT)
    try:
        bid = int(bid_raw or "0")
    except (TypeError, ValueError):
        bid = UTS_BILL_TO_ID_DEFAULT
    origin = _integ_get("ORIGIN_ZIP") or ORIGIN_ZIP_DEFAULT
    return user, key, bid, origin


def _zip_to_zone(zip_code: str) -> int:
    """Verbatim port of legacy zipToZone()."""
    try:
        p = int(str(zip_code)[:3])
    except (ValueError, TypeError):
        return 4
    if 430 <= p <= 458:
        return 1
    if (150 <= p <= 196) or (247 <= p <= 268) or (400 <= p <= 429) or (459 <= p <= 479):
        return 2
    if (100 <= p <= 149) or (197 <= p <= 246) or (269 <= p <= 289):
        return 3
    if (290 <= p <= 349) or (10 <= p <= 99) or (480 <= p <= 499):
        return 4
    if 350 <= p <= 399:
        return 5
    if (500 <= p <= 599) or (600 <= p <= 699) or (700 <= p <= 799):
        return 6
    if 800 <= p <= 884:
        return 7
    if 885 <= p <= 999:
        return 8
    return 4


def _spcoc_local_rate(dest_zip: str, weight_lbs: float, trailer_feet: Optional[float]) -> Optional[Dict[str, Any]]:
    """Verbatim port of legacy spcLocalRate()."""
    prefix = str(dest_zip)[:3]
    zone = SPCOC_ZONES.get(prefix)
    if not zone:
        return None
    if weight_lbs > SPCOC_MAX_WEIGHT:
        return None
    if trailer_feet is not None and trailer_feet > SPCOC_MAX_TRAILER_FT:
        return None
    rate = SPCOC_RATES[zone]
    return {
        "source": "spcoc",
        "zone": zone,
        "zoneLabel": SPCOC_LABELS[zone],
        "carrier": "SPC Local Delivery",
        "transitDays": 1,
        "totalAmount": rate,
        "fuelSurcharge": 0,
        "allCarriers": [],
        "note": f"SPCOC local zone rate — flat ${rate}",
    }


def _fallback_rate(dest_zip: str, weight_lbs: float) -> Dict[str, Any]:
    """Verbatim port of legacy fallbackRate()."""
    z = _zip_to_zone(dest_zip)
    zd = FALLBACK_ZONES[z - 1]
    cwt = weight_lbs / 100
    base = max(cwt * zd["cwt"], zd["min"])
    transit = 2 if z <= 2 else (3 if z <= 4 else (5 if z <= 6 else 7))
    return {
        "source": "fallback",
        "zone": z,
        "zoneLabel": zd["label"],
        "carrier": f"Estimated (zone {z})",
        "transitDays": transit,
        "totalAmount": round(base * 100) / 100,
        "fuelSurcharge": 0,
        "note": "Fallback estimate (UTS unavailable)",
    }


async def _uts_rate_estimate(dest_zip: str, weight_lbs: float, freight_class: str = "70") -> Dict[str, Any]:
    """Verbatim port of legacy utsRateEstimate() — calls UTS /v1/rateestimate.
    Serializes all UTS calls behind a process-wide asyncio.Lock — concurrent
    calls were observed returning HTTP 500 (UTS appears to reject parallel
    requests on the same auth session)."""
    async with _UTS_LOCK:
        return await _uts_rate_estimate_inner(dest_zip, weight_lbs, freight_class)


async def _uts_rate_estimate_inner(dest_zip: str, weight_lbs: float, freight_class: str = "70") -> Dict[str, Any]:
    uts_user, uts_key, bill_to_id, origin_zip = _uts_creds()
    if not (uts_user and uts_key):
        raise RuntimeError("UTS credentials not configured")
    body = {
        "paymentType": "PREPAID",
        "billToID": bill_to_id,
        "includeGuaranteedRates": False,
        "origin": {"locationID": bill_to_id, "zip": origin_zip},
        "destination": {"locationID": 0, "zip": str(dest_zip)},
        "feetOfTrailer": 0,
        "lineItems": [{
            "weight": weight_lbs,
            "freightClass": str(freight_class or "70"),
            "isStackable": True,
        }],
    }
    auth_b64 = base64.b64encode(f"{uts_user}:{uts_key}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(f"{UTS_BASE}/rateestimate", headers=headers, json=body)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"UTS HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
    carrier_rates = data.get("CarrierRates") or []
    rates = [cr for cr in carrier_rates if cr.get("charges", {}).get("totalAmount", 0) > 0]
    if not rates:
        raise RuntimeError("UTS returned no priced carrier rates")
    rates.sort(key=lambda cr: cr["charges"]["totalAmount"] + cr["charges"].get("fuelSurcharge", 0))
    best = rates[0]
    total = best["charges"]["totalAmount"] + best["charges"].get("fuelSurcharge", 0)
    return {
        "source": "uts",
        "carrier": best.get("carrierName"),
        "transitDays": best.get("transitDays", 0),
        "totalAmount": round(total * 100) / 100,
        "fuelSurcharge": round(best["charges"].get("fuelSurcharge", 0) * 100) / 100,
        "estimateNumber": data.get("estimateNumber"),
        "allCarriers": [{
            "name": cr["carrierName"],
            "total": round((cr["charges"]["totalAmount"] + cr["charges"].get("fuelSurcharge", 0)) * 100) / 100,
            "transit": cr.get("transitDays"),
            "fuel": cr["charges"].get("fuelSurcharge", 0),
        } for cr in rates[:5]],
        "destination": data.get("destination"),
    }


# ═══════════════════════════════════════════════════════════════
# Public endpoints
# ═══════════════════════════════════════════════════════════════
@router.get("/zones")
async def list_zones(_u: User = Depends(get_current_user)) -> Dict[str, Any]:
    _, _, _, origin = _uts_creds()
    return {
        "origin_zip": origin,
        "spcoc": {
            "rates": SPCOC_RATES,
            "labels": SPCOC_LABELS,
            "zip_prefixes": SPCOC_ZONES,
            "max_weight_lbs": SPCOC_MAX_WEIGHT,
            "max_trailer_ft": SPCOC_MAX_TRAILER_FT,
        },
        "national_zones": FALLBACK_ZONES,
    }


@router.post("/quote")
async def quote(
    body: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get a freight cost estimate.

    Body matches legacy POST /api/freight: { destZip, weightLbs, freightClass?, trailerFeet? }
    Also accepts snake_case (dest_zip, weight_lbs, etc.) for flexibility.
    """
    dest_zip = str(body.get("destZip") or body.get("dest_zip") or "").strip()
    weight_lbs = float(body.get("weightLbs") or body.get("weight_lbs") or 0)
    freight_class = str(body.get("freightClass") or body.get("freight_class") or "70")
    trailer_feet = body.get("trailerFeet") or body.get("trailer_feet")

    if not dest_zip:
        raise HTTPException(400, "destZip required")
    if weight_lbs <= 0:
        raise HTTPException(400, "weightLbs > 0 required")

    # 1) SPCOC local zone
    spc = _spcoc_local_rate(dest_zip, weight_lbs, trailer_feet)
    if spc:
        return spc

    # 2) UTS API
    try:
        return await _uts_rate_estimate(dest_zip, weight_lbs, freight_class)
    except Exception as uts_err:
        # 3) Fallback zone estimate
        result = _fallback_rate(dest_zip, weight_lbs)
        result["utsError"] = str(uts_err)[:200]
        return result
