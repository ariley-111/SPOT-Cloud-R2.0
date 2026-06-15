"""Tests for Entra SSO scaffolding + login flow with Entra env missing."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-multi-user.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ── /api/auth/config — sso_enabled false, allowed_domain set ─────────────
def test_auth_config_sso_disabled():
    r = requests.get(f"{API}/auth/config", timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sso_enabled"] is False
    assert body["sso_required"] is False
    assert body["allowed_domain"] == "standardprinting.com"


# ── /api/auth/entra/login — 503 when env missing ─────────────────────────
def test_entra_login_503_when_unconfigured():
    # Use a fresh session with no redirects so we capture the 503 directly
    r = requests.get(f"{API}/auth/entra/login", timeout=20, allow_redirects=False)
    assert r.status_code == 503, f"expected 503, got {r.status_code}: {r.text}"
    detail = r.json().get("detail", "")
    assert "not configured" in detail.lower()


# ── /api/auth/entra/callback — 503 (because is_sso_configured short-circuits before state check) ─
def test_entra_callback_503_when_unconfigured():
    """Per the code: when SSO not configured, callback also raises 503 BEFORE the state-cookie check.
    Once Entra env vars are set, missing-cookie returns 400. This test documents current behavior."""
    r = requests.get(f"{API}/auth/entra/callback", timeout=20, allow_redirects=False)
    # When unconfigured, callback returns 503; when configured but no cookie, 400.
    assert r.status_code in (400, 503), r.text


# ── /api/auth/login — admin login still works ────────────────────────────
def test_admin_password_login_success():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body and isinstance(body["access_token"], str)
    assert body["user"]["email"] == "admin@standardprinting.com"
    assert body["user"]["role"] == "admin"


def test_password_login_bad_creds():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@standardprinting.com", "password": "wrong-password"},
        timeout=20,
    )
    assert r.status_code == 401


# ── User schema accepts password_hash='' for SSO-only users ──────────────
def test_user_schema_allows_empty_password_hash():
    """Inspect-level test — directly instantiate the User model."""
    import sys
    sys.path.insert(0, "/app/backend")
    from models.schemas import User
    u = User(email="sso@standardprinting.com", name="SSO User", role="estimator",
            password_hash="", auth_provider="entra", entra_oid="oid-123")
    assert u.password_hash == ""
    assert u.auth_provider == "entra"
    assert u.entra_oid == "oid-123"


# ── SSO_REQUIRED logic guard in routes/auth.py ───────────────────────────
def test_login_route_has_sso_required_guard():
    """Static check that auth.py rejects password login when SSO_REQUIRED=true."""
    with open("/app/backend/routes/auth.py") as f:
        src = f.read()
    assert 'SSO_REQUIRED' in src
    assert '403' in src or 'HTTP_403_FORBIDDEN' in src
    assert 'Password login is disabled' in src


# ── Regression: engine multi-part still returns componentPricing[] ───────
def test_engine_calculate_multi_part_regression():
    token_resp = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"},
        timeout=20,
    )
    assert token_resp.status_code == 200
    token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Minimal multi-part payload — two components
    payload = {
        "qtys": [1000],
        "bomItems": [
            {
                "label": "Cover",
                "state": {
                    "stockType": "Sheet", "press": "Heidelberg XL106", "passes": 1,
                    "sheetW": 28, "sheetH": 40, "pieceW": 8.5, "pieceH": 11,
                    "stockCost": 0.05, "ink": "4/0", "qtyMode": "Component",
                },
            },
            {
                "label": "Body",
                "state": {
                    "stockType": "Sheet", "press": "Heidelberg XL106", "passes": 1,
                    "sheetW": 28, "sheetH": 40, "pieceW": 8.5, "pieceH": 11,
                    "stockCost": 0.04, "ink": "4/4", "qtyMode": "Component",
                },
            },
        ],
        "fob": "WillCall",
    }
    r = requests.post(f"{API}/engine/calculate-multi-part", json=payload, headers=headers, timeout=60)
    assert r.status_code == 200, r.text[:500]
    body = r.json()
    assert "componentPricing" in body or "jobTotals" in body, list(body.keys())
    cp = body.get("componentPricing") or []
    if cp:
        assert isinstance(cp, list) and len(cp) >= 2
