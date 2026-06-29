"""Regression tests for pricing-version comparison baseline logic.

Bug: GET /api/admin/pricing/versions/{id} for the is_baseline=true version
('2025-04-14') used to diff against the active version and show stale 'Old'
prices and Δ% values. The expected behaviour is:
  • baseline version      → diff == None and compared_to == None
  • active version        → diff present, compared_to == label of the
                            next-older non-draft version (the one it replaced).
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://spot-estimator.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASSWORD = "spot-admin-2026"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def versions_payload(headers):
    r = requests.get(f"{BASE_URL}/api/admin/pricing/versions",
                     headers=headers, timeout=15)
    assert r.status_code == 200, f"list versions failed: {r.status_code} {r.text}"
    data = r.json()
    assert "versions" in data and isinstance(data["versions"], list)
    return data


def test_versions_list_contains_baseline_and_active(versions_payload):
    versions = versions_payload["versions"]
    labels = [v.get("label") for v in versions]
    assert "2025-04-14" in labels, f"baseline label missing: {labels}"
    assert "2026-06-15" in labels, f"active label missing: {labels}"
    baseline = next(v for v in versions if v.get("label") == "2025-04-14")
    assert baseline.get("is_baseline") is True
    assert baseline.get("status") == "archived"
    active_id = versions_payload.get("active_id")
    assert active_id, "active_id missing from list response"
    active = next(v for v in versions if v.get("id") == active_id)
    assert active.get("label") == "2026-06-15"


def test_baseline_version_returns_null_diff(versions_payload, headers):
    """PRIMARY BUG: baseline must NOT have a diff or compared_to set."""
    baseline = next(v for v in versions_payload["versions"]
                    if v.get("is_baseline") is True)
    r = requests.get(
        f"{BASE_URL}/api/admin/pricing/versions/{baseline['id']}",
        headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("diff") is None, \
        f"baseline diff should be None, got: {body.get('diff')}"
    assert body.get("compared_to") is None, \
        f"baseline compared_to should be None, got: {body.get('compared_to')}"
    assert body["version"]["is_baseline"] is True
    assert body["version"]["label"] == "2025-04-14"


def test_active_version_diffs_against_replaced_baseline(versions_payload, headers):
    """Regression guard: active version still diffs vs the version it replaced
    (here, the baseline '2025-04-14')."""
    active_id = versions_payload["active_id"]
    r = requests.get(
        f"{BASE_URL}/api/admin/pricing/versions/{active_id}",
        headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("compared_to") == "2025-04-14", \
        f"active should compare to baseline label, got: {body.get('compared_to')}"
    diff = body.get("diff")
    assert diff is not None, "active version diff should not be None"
    # diff should be a dict with summary + cells
    assert isinstance(diff, dict)
    assert "summary" in diff
    # active vs baseline must have at least one cell changed (these are distinct
    # seeded versions with different rates)
    assert diff["summary"].get("cells_changed", 0) >= 1, \
        f"expected at least 1 cell changed, got summary: {diff['summary']}"
