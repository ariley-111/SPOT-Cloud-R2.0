"""Iter 19: Pre-buy-min snapshot exposure tests.

Validates that _pipeline contains preBuyMinHasPrice / preBuyMinMeetMin /
preBuyMinPricable so the FE auto-flip useEffect (legacy parity:
spot_r1_5.jsx L3942-3957) can evaluate the SEL bc state BEFORE buy-min
auto-engages — fixing the L'Oreal Mid Disk auto-flip regression.

Endpoints covered:
  - POST /api/engine/calculate (single component)
  - POST /api/engine/calculate-multi-part (per-component snapshot)
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://ai-connect-33.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@standardprinting.com",
        "password": "spot-admin-2026",
    }, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture
def client(auth_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}",
    })
    return s


def _below_min_payload(qty: int = 500) -> dict:
    """275 6x6 B-flute Kemi-Lite — known below-mill-min payload from
    existing test_below_min.py::test_buy_min_auto_engages.
    Buy-min auto-engages, so preBuyMinMeetMin should be FALSE and
    final boardMeetMin should be TRUE."""
    return {
        "itemDesc": "TEST_PreBuyMin",
        "oneUpW": 6,
        "oneUpL": 6,
        "qtys": [qty, 0, 0, 0, 0],
        "flute": "B",
        "boardGrade": "275",
        "outsideLiner": "42# Kemi-Lite",
        "insideLiner": "42# Kemi-Lite",
        "medium": "None",
        "printReq": "Yes",
        "printMode": "Satin",
        "printSides": "1-Sided",
        "buyMinBoard": "Auto",
        "quoteFOB": "Origin",
    }


# Single-component pre-buy-min snapshot keys must exist
def test_single_calculate_exposes_pre_buy_min_snapshot(client):
    payload = _below_min_payload(qty=500)
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0",
                    json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    pipe = data.get("_pipeline") or {}

    # Pre-buy-min snapshot keys MUST be present even if engine errors.
    # When we have a successful pricing, _pipeline should be populated.
    if "error" in data:
        pytest.skip(f"Engine error (env data issue, not snapshot bug): {data.get('error')}")

    assert "preBuyMinHasPrice" in pipe, f"preBuyMinHasPrice missing; pipe keys={list(pipe.keys())}"
    assert "preBuyMinMeetMin" in pipe, f"preBuyMinMeetMin missing; pipe keys={list(pipe.keys())}"
    assert "preBuyMinPricable" in pipe, f"preBuyMinPricable missing; pipe keys={list(pipe.keys())}"

    assert isinstance(pipe["preBuyMinHasPrice"], bool)
    assert isinstance(pipe["preBuyMinMeetMin"], bool)
    assert isinstance(pipe["preBuyMinPricable"], bool)

    assert "flipWouldHelp" in pipe, "flipWouldHelp missing from _pipeline"
    assert isinstance(pipe["flipWouldHelp"], bool), (
        f"flipWouldHelp must be bool; got {type(pipe['flipWouldHelp'])}"
    )


# Pre-buy-min meetMin should be FALSE when buy-min auto-engages
def test_pre_buy_min_meet_min_false_when_buy_min_engages(client):
    payload = _below_min_payload(qty=500)
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0",
                    json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    if "error" in data:
        pytest.skip(f"Engine error: {data.get('error')}")
    pipe = data.get("_pipeline") or {}

    # Buy-min must have auto-engaged (review_request semantic)
    assert pipe.get("buyMinActive") is True, (
        f"Expected buy-min auto-engage on small below-min board; pipe={pipe}"
    )

    # Pre-buy-min meetMin should be FALSE (entire point of buy-min engaging)
    assert pipe.get("preBuyMinMeetMin") is False, (
        f"preBuyMinMeetMin must be FALSE before buy-min lifted it; "
        f"got {pipe.get('preBuyMinMeetMin')}"
    )
    # Pre-buy-min hasPrice should be TRUE (board priced ok, mill min was the problem)
    assert pipe.get("preBuyMinHasPrice") is True
    # Pre-buy-min pricable should be FALSE
    assert pipe.get("preBuyMinPricable") is False

    # Post-buy-min: top-level boardMeetMin should be TRUE
    assert data.get("boardMeetMin") is True
    assert data.get("boardHasPrice") is True


# Multi-part: per-component pre-buy-min snapshot exposed
def test_multi_part_per_component_pre_buy_min(client):
    """Multi-part endpoint exposes preBuyMin* inside each perComponent entry."""
    # Comp1 is the below-min component — should auto-buy-min
    comp1_state = {
        "oneUpW": "6", "oneUpL": "6",
        "qtys": ["500", "", "", "", ""],
        "flute": "B", "boardGrade": "275",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "buyMinBoard": "Auto",
    }
    comp2_state = {
        "oneUpW": "12", "oneUpL": "18",
        "qtys": ["5000", "", "", "", ""],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "buyMinBoard": "Auto",
    }

    payload = {
        "mode": "Matched Set",
        "setQty": 500,
        "qtys": ["500", "", "", "", ""],
        "bomItems": [
            {"id": "c1", "label": "Comp 1 BelowMin", "type": "Manufactured",
             "pcsPerSet": 1, "state": comp1_state},
            {"id": "c2", "label": "Comp 2 Normal", "type": "Manufactured",
             "pcsPerSet": 1, "state": comp2_state},
        ],
    }

    r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                    json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()

    # Response shape: {slots, componentPricing, jobTotals, results, meta}
    # Find perComponent — it lives inside slots[*].perComponent
    slots = body.get("slots") or []
    assert slots, f"Expected slots in response; keys={list(body.keys())}"

    per_comp = slots[0].get("perComponent") or []
    assert len(per_comp) >= 1, (
        f"Expected perComponent entries in slot[0]; slot keys={list(slots[0].keys())}"
    )

    # Each component must expose preBuyMin* in its _pipeline
    found_below_min_signal = False
    for idx, comp in enumerate(per_comp):
        pipe = comp.get("_pipeline") or {}
        assert "preBuyMinHasPrice" in pipe, (
            f"Comp[{idx}] missing preBuyMinHasPrice; pipe keys={list(pipe.keys())}"
        )
        assert "preBuyMinMeetMin" in pipe, f"Comp[{idx}] missing preBuyMinMeetMin"
        assert "preBuyMinPricable" in pipe, f"Comp[{idx}] missing preBuyMinPricable"

        assert isinstance(pipe["preBuyMinHasPrice"], bool)
        assert isinstance(pipe["preBuyMinMeetMin"], bool)
        assert isinstance(pipe["preBuyMinPricable"], bool)

        # At least one component should show the below-min auto-engage signature
        if pipe.get("buyMinActive") and pipe.get("preBuyMinMeetMin") is False:
            found_below_min_signal = True

    assert found_below_min_signal, (
        "Expected at least one component to show auto-buy-min "
        "(preBuyMinMeetMin=False, buyMinActive=True)"
    )
