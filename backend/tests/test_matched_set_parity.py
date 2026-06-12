"""Lock down legacy parity for the L'Oréal 12-component Matched Set quote.

Source of truth: spot_runner.runEstimate + spot_r1_5.jsx setTotals aggregation.
Pre-recorded ground-truth values (per-component sells and totals) come from
running /tmp/legacy_replay.js against /tmp/loreal_payload.json (see PRD.md).

Sentinel test: if any component sell drifts more than $0.01 or the slot
quoteSell drifts more than $0.50, fail the build — that's a real math
regression.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest


# ── Ground truth from legacy spot_runner.js + setTotals aggregation ──
# (Values dumped from `node /tmp/legacy_replay.js` on 2026-02-12 — see /app/memory/PRD.md)
LEGACY_PER_COMPONENT = {
    "Bot Disk 1":   {"pps": 6, "qty": 15000, "cost": 84392.59, "sell": 112523.45, "sellTotal": 112523.45, "die": 0.00},
    "Bot Disk 2":   {"pps": 1, "qty": 2500,  "cost": 1146.84,  "sell": 1791.02,   "sellTotal": 3171.02,   "die": 1380.00},
    "Mid Disk 1":   {"pps": 8, "qty": 20000, "cost": 111631.24,"sell": 148841.66, "sellTotal": 150221.66, "die": 1380.00},
    "Mid Disk 2":   {"pps": 1, "qty": 2500,  "cost": 16256.24, "sell": 21674.99,  "sellTotal": 23054.99,  "die": 1380.00},
    "Mid Disk 3":   {"pps": 1, "qty": 2500,  "cost": 16256.24, "sell": 21674.99,  "sellTotal": 21674.99,  "die": 0.00},
    "Mid Disk 4":   {"pps": 1, "qty": 2500,  "cost": 744.83,   "sell": 1152.90,   "sellTotal": 1152.90,   "die": 0.00},
    "Mid Disk 5":   {"pps": 1, "qty": 2500,  "cost": 744.83,   "sell": 1152.90,   "sellTotal": 1152.90,   "die": 0.00},
    "Shaft Disk 1": {"pps": 9, "qty": 22500, "cost": 125188.74,"sell": 166918.32, "sellTotal": 168298.32, "die": 1380.00},
    "Shaft Disk 2": {"pps": 3, "qty": 7500,  "cost": 43438.74, "sell": 57918.32,  "sellTotal": 57918.32,  "die": 0.00},
    "Shaft Disk 3": {"pps": 1, "qty": 2500,  "cost": 342.81,   "sell": 635.62,    "sellTotal": 2015.62,   "die": 1380.00},
    "Support 1":    {"pps": 2, "qty": 5000,  "cost": 25462.66, "sell": 33950.22,  "sellTotal": 35330.22,  "die": 1380.00},
    "Support 2":    {"pps": 1, "qty": 2500,  "cost": 13962.66, "sell": 18616.88,  "sellTotal": 18616.88,  "die": 0.00},
}

LEGACY_SLOT0 = {
    "setQty": 2500,
    "totalMfg": 439568.43,
    "sell": 586851.27,      # aggregate of per-item itemSell
    "lineCharges": 8280.00, # die line charges
    "quoteSell": 595131.27, # sell + lineCharges
}


PAYLOAD_PATH = Path("/app/backend/tests/fixtures/loreal_matched_set.json")


@pytest.fixture(scope="module")
def loreal_payload():
    """Load the L'Oréal-equivalent 12-component Matched Set fixture."""
    if not PAYLOAD_PATH.exists():
        pytest.skip(f"Fixture missing: {PAYLOAD_PATH}")
    return json.loads(PAYLOAD_PATH.read_text())


def _aggregate_slot(slot: dict) -> dict:
    """Re-derive slot aggregates from perComponent the same way the engine does."""
    pcs = slot.get("perComponent", [])
    total_mfg = round(sum(float(p.get("totalMfg") or 0) for p in pcs), 2)
    total_sell = round(sum(float(p.get("itemSell") or 0) for p in pcs), 2)
    total_die = round(sum(float(p.get("dieLineCost") or 0) for p in pcs), 2)
    return {
        "totalMfg": total_mfg,
        "totalSell": total_sell,
        "dieLine": total_die,
    }


def test_per_component_parity(loreal_payload):
    """Each manufactured component matches legacy within $0.01."""
    # Run engine directly (no FastAPI / auth / Mongo) by importing the engine
    # core only. We replicate the multi-part loop here for purity.
    from engine import run_estimate

    p = loreal_payload
    pps_map = {b["desc"]: int(b.get("pcsPerSet") or 1) for b in p["bomItems"]}
    set_qty = int(p["qtys"][0])

    failures = []
    for bom in p["bomItems"]:
        desc = bom["desc"]
        expected = LEGACY_PER_COMPONENT.get(desc)
        if not expected:
            continue
        pps = pps_map[desc]
        item_qty = set_qty * pps

        # Build engine payload exactly like Matched Set path does
        item_qtys = [str(item_qty), "", "", "", ""]
        st = dict(bom.get("state") or {})
        st["qtys"] = item_qtys
        # Pass-through job-level keys that may matter
        for k in ("estInitials", "custName", "destZip", "quoteFOB"):
            if k in p:
                st.setdefault(k, p[k])

        r = run_estimate(st, 0)
        if r.get("error"):
            failures.append(f"{desc}: ENGINE ERROR {r['error']}")
            continue

        c_cost = float(r.get("totalMfg") or 0)
        c_sell = float(r.get("itemSell") or 0)
        c_sell_total = float(r.get("sellTotal") or 0)
        c_die = float(r.get("dieLineCost") or 0)

        for label, got, want in [
            ("cost", c_cost, expected["cost"]),
            ("sell", c_sell, expected["sell"]),
            ("sellTotal", c_sell_total, expected["sellTotal"]),
            ("die", c_die, expected["die"]),
        ]:
            if abs(got - want) > 0.01:
                failures.append(f"{desc}.{label}: got ${got:.2f}, expected ${want:.2f} (delta ${got-want:+.2f})")

    assert not failures, "Per-component parity broken:\n  " + "\n  ".join(failures)


def test_matched_set_slot_aggregation(loreal_payload):
    """Slot 0 (qty=2500 sets) — sell, line charges, and quote total match legacy."""
    from engine import run_estimate

    p = loreal_payload
    set_qty = int(p["qtys"][0])

    total_mfg = 0.0
    total_sell = 0.0
    total_die = 0.0
    for bom in p["bomItems"]:
        if (bom.get("type") or "Manufactured") != "Manufactured":
            continue
        pps = int(bom.get("pcsPerSet") or 1)
        item_qty = set_qty * pps
        st = dict(bom.get("state") or {})
        st["qtys"] = [str(item_qty), "", "", "", ""]
        for k in ("estInitials", "custName", "destZip", "quoteFOB"):
            if k in p:
                st.setdefault(k, p[k])
        r = run_estimate(st, 0)
        if r.get("error"):
            continue
        total_mfg += float(r.get("totalMfg") or 0)
        total_sell += float(r.get("itemSell") or 0)
        total_die += float(r.get("dieLineCost") or 0)

    assert abs(total_mfg - LEGACY_SLOT0["totalMfg"]) < 0.50, (
        f"totalMfg drift: got ${total_mfg:.2f}, expected ${LEGACY_SLOT0['totalMfg']:.2f}"
    )
    assert abs(total_sell - LEGACY_SLOT0["sell"]) < 0.50, (
        f"jobSell drift: got ${total_sell:.2f}, expected ${LEGACY_SLOT0['sell']:.2f}"
    )
    assert abs(total_die - LEGACY_SLOT0["lineCharges"]) < 0.50, (
        f"lineCharges drift: got ${total_die:.2f}, expected ${LEGACY_SLOT0['lineCharges']:.2f}"
    )

    quote_sell = total_sell + total_die
    assert abs(quote_sell - LEGACY_SLOT0["quoteSell"]) < 0.50, (
        f"quoteSell drift: got ${quote_sell:.2f}, expected ${LEGACY_SLOT0['quoteSell']:.2f}"
    )
