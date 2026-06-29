"""Tests for Email Quote (Microsoft Graph 365) backend endpoints.

Coverage:
  - GET /api/email/status (auth required, configured=False when GRAPH_MAIL_SENDER unset)
  - POST /api/email/send-quote returns 503 when not configured (NOT 500)
  - Auth gating on both endpoints
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-estimator.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PWD = "spot-admin-2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── /api/email/status ────────────────────────────────────
class TestEmailStatus:
    def test_status_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/email/status", timeout=15)
        assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"

    def test_status_configured_false_when_sender_unset(self, headers):
        r = requests.get(f"{BASE_URL}/api/email/status", headers=headers, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "configured" in data
        assert data["configured"] is False, f"GRAPH_MAIL_SENDER is unset; expected configured=False, got {data}"
        # sender should be None / falsy when not configured
        assert not data.get("sender"), f"expected sender to be null/empty, got {data.get('sender')}"


# ── /api/email/send-quote ────────────────────────────────
class TestSendQuote:
    PAYLOAD = {
        "to": ["x@y.com"],
        "cc": [],
        "subject": "t",
        "body_html": "hi",
        "pdf": {"quote": {"est_num": "TEST_E1", "customer_name": "TEST Cust", "state": {}}, "results": []},
    }

    def test_send_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/email/send-quote", json=self.PAYLOAD, timeout=20)
        assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"

    def test_send_returns_503_when_not_configured(self, headers):
        r = requests.post(f"{BASE_URL}/api/email/send-quote",
                          headers=headers, json=self.PAYLOAD, timeout=20)
        assert r.status_code == 503, f"expected 503 (not configured), got {r.status_code} body={r.text[:300]}"
        # Must NOT be a 500 — graceful gating
        assert r.status_code != 500
        data = r.json()
        # Detail should mention not configured / Mail.Send / consent
        detail = (data.get("detail") or "").lower()
        assert any(k in detail for k in ("not configured", "mail.send", "consent", "not enabled")), \
            f"expected helpful detail, got: {data}"

    def test_send_validation_error_shape(self, headers):
        # Missing required fields → 422 (Pydantic)
        r = requests.post(f"{BASE_URL}/api/email/send-quote",
                          headers=headers, json={"to": ["a@b.com"]}, timeout=15)
        assert r.status_code in (422, 503), f"unexpected {r.status_code} {r.text[:200]}"
