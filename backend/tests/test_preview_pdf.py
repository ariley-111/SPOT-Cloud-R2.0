"""Backend tests for /api/pdf/preview-quote endpoint - validates PDF generation
with all three charge modes (Lump Sum / By Type / By Part)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-multi-user.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"


@pytest.fixture(scope="module")
def auth_token():
    # ensure seeded
    requests.post(f"{BASE_URL}/api/auth/seed-admin", timeout=20)
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


def _sample_body(charge_mode):
    return {
        "quote": {
            "est_num": "TEST-PDF-001",
            "customer_name": "TEST Customer Co",
            "state": {
                "estNum": "TEST-PDF-001",
                "estInitials": "TST",
                "custName": "TEST Customer Co",
                "custRef": "TEST PROJECT",
                "itemDesc": "RSC 10x12x8",
                "boxStyle": "RSC",
                "flute": "C",
                "boardGrade": "32",
                "outsideLiner": "42# Kraft",
                "insideLiner": "42# Kraft",
                "oneUpW": 10,
                "oneUpL": 12,
                "quoteExpDays": 30,
                "quoteFOB": "Origin",
                "quoteTerms": "Net 30",
                "quoteShipTo": "Canton OH",
                "destZip": "44704",
            },
        },
        "results": [
            {"qty": 1000, "itemSell": 850.0, "pricable": True, "dieLineCost": 0, "freightLine": 0, "prepressLineCost": 50.0, "miscLineCost": 0},
            {"qty": 5000, "itemSell": 3200.0, "pricable": True, "dieLineCost": 0, "freightLine": 125.0, "prepressLineCost": 50.0, "miscLineCost": 0},
            {"qty": 10000, "itemSell": 5800.0, "pricable": True, "dieLineCost": 250.0, "freightLine": 200.0, "prepressLineCost": 50.0, "miscLineCost": 25.0},
        ],
        "chargeMode": charge_mode,
    }


class TestPreviewQuotePdf:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote", json=_sample_body("By Type"), timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403 unauth, got {r.status_code}"

    @pytest.mark.parametrize("mode", ["By Type", "Lump Sum", "By Part"])
    def test_pdf_generation_modes(self, auth_headers, mode):
        body = _sample_body(mode)
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote", json=body, headers=auth_headers, timeout=60)
        assert r.status_code == 200, f"[{mode}] {r.status_code}: {r.text[:300]}"
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype, f"[{mode}] wrong content-type: {ctype}"
        assert r.content.startswith(b"%PDF"), f"[{mode}] missing %PDF signature"
        assert len(r.content) > 2000, f"[{mode}] suspiciously small PDF: {len(r.content)} bytes"

    def test_default_charge_mode_is_by_type(self, auth_headers):
        # Omit chargeMode; backend should default to "By Type"
        body = _sample_body("By Type")
        body.pop("chargeMode", None)
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote", json=body, headers=auth_headers, timeout=60)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")

    def test_empty_results_still_returns_pdf(self, auth_headers):
        body = _sample_body("By Type")
        body["results"] = []
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote", json=body, headers=auth_headers, timeout=60)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")
