"""Freight quote — SPCOC local zones + UTS API proxy for non-local destinations.

SPCOC zones are local Canton, OH delivery (no UTS needed). UTS API handles
truckload quotes for everywhere else. Mirrors spot_server.js freight handler.
"""
from __future__ import annotations
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/freight", tags=["freight"])


# ─── SPCOC Local Zone Table (Canton, OH origin = 44704) ──────────────────
# Customers in these zones use SPC's own trucks at fixed zone rates.
# Source: SPC's freight matrix — bundled with the SPOT install.
SPCOC_ZONES: List[Dict[str, Any]] = [
    {"zone": "Local-1", "max_miles": 25, "base_rate": 75.00, "per_skid": 5.00},
    {"zone": "Local-2", "max_miles": 50, "base_rate": 125.00, "per_skid": 8.00},
    {"zone": "Local-3", "max_miles": 100, "base_rate": 200.00, "per_skid": 12.00},
]


ORIGIN_ZIP = os.environ.get("ORIGIN_ZIP", "44704")
UTS_BASE = os.environ.get("UTS_BASE", "https://api.myuts.net/v1")
UTS_USER = os.environ.get("UTS_USER", "")
UTS_KEY = os.environ.get("UTS_KEY", "")
UTS_BILL_TO_ID = os.environ.get("UTS_BILL_TO_ID", "")


@router.get("/zones")
async def list_zones(_u: User = Depends(get_current_user)) -> Dict[str, Any]:
    return {"origin_zip": ORIGIN_ZIP, "zones": SPCOC_ZONES}


@router.post("/quote")
async def quote(
    body: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get a freight cost estimate.

    Body: { dest_zip, weight_lbs, skid_count, skid_type, trailer_feet, prefer_zone? }

    Returns SPCOC zone match if available, OR UTS API quote, OR 'manual'
    placeholder when both unavailable.
    """
    dest_zip = (body.get("dest_zip") or "").strip()
    weight_lbs = float(body.get("weight_lbs") or 0)
    skid_count = int(body.get("skid_count") or 1)
    skid_type = body.get("skid_type") or "S"
    trailer_feet = body.get("trailer_feet")

    if not dest_zip:
        raise HTTPException(400, "dest_zip is required")

    # Step 1 — SPCOC local zone check (would need a real ZIP→miles lookup;
    # for now use simple ZIP prefix heuristic: 446xx, 447xx, 448xx = nearby).
    # Real implementation pulls from a ZIP-distance table.
    nearby_prefixes = {"446", "447", "448", "440", "441"}
    if dest_zip[:3] in nearby_prefixes:
        zone = SPCOC_ZONES[0]
        cost = zone["base_rate"] + zone["per_skid"] * skid_count
        return {
            "source": "SPCOC",
            "zone": zone["zone"],
            "cost": round(cost, 2),
            "currency": "USD",
            "carrier": "SPC Trucks",
            "note": "Local delivery via SPC fleet",
        }

    # Step 2 — UTS API (non-local destinations)
    if not (UTS_USER and UTS_KEY):
        return {
            "source": "manual",
            "cost": None,
            "note": "UTS credentials not configured — estimator must enter freight cost manually",
        }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{UTS_BASE}/rates",
                auth=(UTS_USER, UTS_KEY),
                json={
                    "origin_zip": ORIGIN_ZIP,
                    "dest_zip": dest_zip,
                    "weight_lbs": weight_lbs,
                    "skid_count": skid_count,
                    "skid_type": skid_type,
                    "trailer_feet": trailer_feet,
                    "bill_to_id": UTS_BILL_TO_ID,
                },
            )
            if resp.status_code >= 400:
                return {
                    "source": "manual", "cost": None,
                    "note": f"UTS returned {resp.status_code}: {resp.text[:200]} — enter freight manually",
                }
            data = resp.json()
            return {
                "source": "UTS",
                "cost": data.get("cost") or data.get("total"),
                "currency": "USD",
                "carrier": data.get("carrier") or "UTS",
                "transit_days": data.get("transit_days"),
                "raw": data,
            }
    except Exception as e:
        return {
            "source": "manual", "cost": None,
            "note": f"UTS API unavailable ({type(e).__name__}) — enter freight manually",
        }
