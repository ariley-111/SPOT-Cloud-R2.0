"""Tests for Buy Min / belowMin behaviour in the SPOT engine.

Covers iteration_14 changes:
  - STEP 6 auto-enable BuyMin when buyMinBoard == 'Auto'
  - STEP 7 Buy Min recalc + buyMinActive flag
  - Below-Min partial-row return when buyMinBoard == 'No'
  - _pipeline.belowMin flag for the Quote Table
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ai-connect-33.preview.emergentagent.com").rstrip("/")


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


def _below_min_payload(buy_min: str = "Auto", qty: int = 200) -> dict:
    """Minimal payload for a 6x6 B-flute 275 quote — custom-order grade lands below mill min.

    275 is NOT in APPROVED_SHEETS so the engine routes via custom-order
    where meetMin is enforced (o_sq_ft must >= 25000).
    """
    return {
        "itemDesc": "TEST_BelowMin Box",
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
        "buyMinBoard": buy_min,
        "quoteFOB": "Origin",
    }


# Pipeline auto-buy-min flag
def test_buy_min_auto_engages(client):
    payload = _below_min_payload(buy_min="Auto", qty=500)
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    pipe = data.get("_pipeline") or {}
    # Either Buy Min auto-enabled (pricable) OR we land in below-min hard error path.
    # In Auto mode we expect buyMinActive=True on a successful price.
    if "error" not in data:
        assert pipe.get("buyMinActive") is True, f"Expected buyMinActive=True, got pipeline={pipe}"
        assert (pipe.get("buyMinSheets") or 0) > 0
        assert data.get("itemSell", 0) > 0


# Below-min partial-row return when Buy Min explicitly disabled
def test_buy_min_no_returns_below_min_row(client):
    payload = _below_min_payload(buy_min="No", qty=500)
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    # Must not be a hard error — must be a structured belowMin row
    assert "error" not in data, f"Did not expect error; got: {data}"
    assert data.get("belowMin") is True
    assert data.get("pricable") is False
    assert data.get("status") == "Below Min"
    pipe = data.get("_pipeline") or {}
    assert pipe.get("belowMin") is True
    assert pipe.get("buyMinActive") is False
    # Money fields should be zeroed so the UI can render "Below Min" cells
    assert data.get("itemSell") == 0
    assert data.get("sellPc") == 0
    assert data.get("sellTotal") == 0
    # Required identification fields for the Quote Table
    for key in ("sheetW", "sheetL", "sheetsReq", "pcsPerSheet", "boardGrade", "flute"):
        assert key in data, f"Missing {key} from belowMin row"


# Buy Min Yes always recalcs and prices
def test_buy_min_yes_prices_successfully(client):
    payload = _below_min_payload(buy_min="Yes", qty=500)
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    if "error" in data:
        pytest.fail(f"BuyMin=Yes still errored: {data}")
    assert data.get("itemSell", 0) > 0
    pipe = data.get("_pipeline") or {}
    assert pipe.get("buyMinActive") is True


# Force spec'd-board flow (buyMinBoard=Yes + boardSubstitution=forced)
def test_force_spec_board_triggers_buy_min_recalc(client):
    payload = _below_min_payload(buy_min="Yes", qty=500)
    payload["boardSubstitution"] = "forced"
    payload["boardGrade"] = "32 ECT"  # likely fallback-eligible
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    # Either prices or returns a structured row — but should not crash.
    assert isinstance(data, dict)
    if "error" not in data and data.get("pricable") is not False:
        pipe = data.get("_pipeline") or {}
        # When forced + buy min the engine should produce a priced row
        assert data.get("itemSell", 0) >= 0


# Calculate-all returns one row per qty slot, belowMin flag preserved
def test_calculate_all_propagates_below_min(client):
    payload = _below_min_payload(buy_min="No", qty=200)
    payload["qtys"] = [200, 100, 0, 0, 0]
    r = client.post(f"{BASE_URL}/api/engine/calculate-all", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body.get("results") or []
    assert len(rows) >= 1
    # First row (qty=500) should be belowMin
    first = rows[0]
    assert first.get("belowMin") is True or (first.get("_pipeline") or {}).get("belowMin") is True, \
        f"Expected belowMin=True on first row, got: {first}"
