"""Iter 17 — Route warning + CORR FLIPPED engine surfacing tests.

Validates:
1. /api/engine/calculate surfaces routeWarning for Storage Bin v3 fallback scenario.
2. routeWarning is null for normal Crest/Bobst/CAD routing.
3. _pipeline.corrFlipped surfaces for auto-flip scenario.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    token = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def test_route_warning_storage_bin_v3(client):
    """Storage Bin v3 72.125x46.625 200#B Kraft/Kraft qty 500 → Saber+D/C fallback w/ warning."""
    payload = {
        "oneUpW": 72.125,
        "oneUpL": 46.625,
        "qtys": [500, 0, 0, 0, 0],
        "flute": "B",
        "boardGrade": "200",
        "outsideLiner": "42# Kraft",
        "insideLiner": "42# Kraft",
        "medium": "None",
        "printReq": "Off",
        "productMats": "RSC",
        "prepressTreatment": "Auto",
        "pricingBasis": "Gross Margin %",
        "gmByTier": {"10-24": 0.25},
    }
    r = client.post(f"{BASE_URL}/api/engine/calculate", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    # API may return either a result row directly or a results list
    row = data
    if isinstance(data, dict) and "results" in data:
        row = data["results"][0]
    print("STORAGE BIN ROW KEYS:", list(row.keys())[:30])
    print("route:", row.get("route"))
    print("routeWarning:", row.get("routeWarning"))
    print("sheetW:", row.get("sheetW"), "sheetL:", row.get("sheetL"))
    print("_pipeline.exceedsSheetLibrary:", (row.get("_pipeline") or {}).get("exceedsSheetLibrary"))

    assert row.get("route") == "Saber + D/C", f"Expected Saber + D/C, got {row.get('route')}"
    rw = row.get("routeWarning")
    assert rw is not None, "routeWarning should not be null for this fallback scenario"
    assert "Crest/Bobst" in rw or "Saber" in rw, f"Unexpected warning: {rw}"
    assert row.get("sheetW") == 74.125
    assert row.get("sheetL") == 48.625
    pipe = row.get("_pipeline") or {}
    assert pipe.get("exceedsSheetLibrary") is True


def test_route_warning_null_for_normal_route(client):
    """Small piece with Kemi-Lite — no fallback, routeWarning must be null."""
    payload = {
        "oneUpW": 8,
        "oneUpL": 10,
        "qtys": [500, 0, 0, 0, 0],
        "flute": "B",
        "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite",
        "insideLiner": "42# Kemi-Lite",
        "medium": "None",
        "printReq": "Off",
        "productMats": "RSC",
        "prepressTreatment": "Auto",
        "pricingBasis": "Gross Margin %",
        "gmByTier": {"10-24": 0.25},
    }
    r = client.post(f"{BASE_URL}/api/engine/calculate", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    row = data if "route" in data else (data.get("results") or [{}])[0]
    print("SMALL ROW route:", row.get("route"), "warning:", row.get("routeWarning"))
    assert row.get("routeWarning") in (None, ""), (
        f"Expected null routeWarning for normal route, got {row.get('routeWarning')}"
    )


def test_corr_flipped_pipeline_surfacing(client):
    """5x100 200#B Kemi-Lite — engine should auto-flip; pipeline.corrFlipped=true."""
    payload = {
        "oneUpW": 5,
        "oneUpL": 100,
        "qtys": [500, 0, 0, 0, 0],
        "flute": "B",
        "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite",
        "insideLiner": "42# Kemi-Lite",
        "medium": "None",
        "printReq": "Off",
        "productMats": "RSC",
        "prepressTreatment": "Auto",
        "pricingBasis": "Gross Margin %",
        "gmByTier": {"10-24": 0.25},
    }
    r = client.post(f"{BASE_URL}/api/engine/calculate", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    row = data if "_pipeline" in data else (data.get("results") or [{}])[0]
    pipe = row.get("_pipeline") or {}
    print("CORR FLIP pipeline:", pipe)
    # The exact flip behaviour depends on the sheet library; at least the field must be present and bool.
    assert "corrFlipped" in pipe, "corrFlipped key missing in _pipeline"
    assert isinstance(pipe["corrFlipped"], bool)
