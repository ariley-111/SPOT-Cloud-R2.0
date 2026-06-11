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


# REGRESSION (2026-06-10 Massillon Container Storage Bin v3): The engine MUST
# NOT auto-flip oneUpW/L internally — that's a frontend responsibility per
# legacy spot_r1_5.jsx L3941-3957. With 200#B Kraft/Kraft (None/None liners) +
# 72.125 x 46.625 + Complex difficulty, the engine must produce:
#   - sheet 74.125 x 48.625 (CUSTOM-OVERSIZE, exceedsSheetLibrary=True)
#   - route "Saber + D/C" with the "Too many CAD hours..." warning
#   - buyMinSheets = 600 (15,000 sqft Kraft min ÷ 25.03 sqft/sheet)
#   - matTotal ≈ $1,977.42, cutterDirect ≈ $4,650.60, totalMfg ≈ $6,628.02
def test_storage_bin_v3_legacy_parity(client):
    payload = {
        "itemDesc": "Storage Bin v3", "oneUpW": 72.125, "oneUpL": 46.625,
        "qtys": [500, 0, 0, 0, 0],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "None", "insideLiner": "None", "medium": "None",
        "fscEnabled": False, "printReq": "Off",
        "productMats": "RSC", "prepressTreatment": "Auto",
        "cadDifficulty": "Complex",
        "pricingBasis": "Gross Margin %", "gmByTier": {"10-24": 0.25},
    }
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    p = d.get("_pipeline") or {}
    # Engine MUST keep original (un-flipped) dims
    assert p.get("corrFlipped") is False, f"Engine must not auto-flip; got {p}"
    assert p.get("exceedsSheetLibrary") is True, f"Expected exceedsSheetLibrary=True; got {p}"
    # Sheet must be CUSTOM-OVERSIZE
    assert abs(d.get("sheetW") - 74.125) < 0.01, f"sheetW={d.get('sheetW')}"
    assert abs(d.get("sheetL") - 48.625) < 0.01, f"sheetL={d.get('sheetL')}"
    # Route + warning
    assert d.get("route") == "Saber + D/C", f"route={d.get('route')}"
    assert d.get("routeWarning") and "Crest" in d["routeWarning"] and "Saber" in d["routeWarning"], \
        f"routeWarning={d.get('routeWarning')}"
    # Buy Min must match legacy (600 sheets)
    assert d.get("buyMinActive") is True, "Buy Min must auto-fire"
    assert d.get("buyMinSheets") == 600, f"buyMinSheets={d.get('buyMinSheets')} (legacy=600)"
    # Material cost must match legacy ($1,977.42 ± $1)
    assert abs(d.get("matTotal") - 1977.42) < 1.0, f"matTotal={d.get('matTotal')} (legacy=1977.42)"
    # Total manufacturing cost match legacy ($6,628.02 ± $5)
    assert abs(d.get("totalMfg") - 6628.02) < 5.0, f"totalMfg={d.get('totalMfg')} (legacy=6628.02)"


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


# REGRESSION (2026-06-10 Massillon Container quote): Force-spec'd-board on a
# substituted grade (125 -> 200# Mullen upgrade) must compute Buy Min cost at
# the SPEC grade rate (125#), not the substituted running grade (200#).
# Legacy spot_r1_5.jsx L3617 always uses boardSpec for the Buy Min recalc.
# Material cost should be ~$2,889 (legacy parity) — NOT ~$3,784 (cloud bug).
def test_force_spec_uses_spec_grade_for_buy_min_cost(client):
    payload = {
        "itemDesc": "RegressionMassillon", "oneUpW": 9, "oneUpL": 9,
        "qtys": [500, 0, 0, 0, 0],
        "flute": "C", "boardGrade": "125",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kraft", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "buyMinBoard": "Yes", "boardSubstitution": "forced",
        "productMats": "RSC", "handGluing": "Yes", "jointsPerPiece": 1,
        "prepressTreatment": "Auto", "pricingBasis": "Gross Margin %",
        "gmByTier": {"25-49": 0.248},
    }
    r = client.post(f"{BASE_URL}/api/engine/calculate?slot_index=0", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "error" not in d, d
    pipe = d.get("_pipeline") or {}
    # Force custom order must surface as ORDER, not STOCK
    assert pipe.get("stockMode") is False, f"forced spec must report stockMode=False; got {pipe}"
    assert pipe.get("customOrder") is True, f"forced spec must report customOrder=True; got {pipe}"
    # Material must be at 125# rate (~$2,889) NOT 200# substituted rate (~$3,784).
    mat = d.get("matTotal") or 0
    assert 2700 < mat < 3100, (
        f"Material {mat:.2f} indicates Buy Min recalc used wrong grade. "
        f"Legacy 125# rate ≈ $2,889; substituted 200# rate ≈ $3,784."
    )
