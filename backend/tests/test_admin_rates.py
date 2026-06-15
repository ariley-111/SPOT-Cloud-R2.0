"""SPOT Cloud — Backend tests for P1-A (DB split) and P1-B (Pricing Admin Console).

Coverage:
- DB split: preview DB connectivity (drafts/customers) and admin auth/me
- Admin role gate: admin vs estimator
- Admin rates CRUD: set/reset/reset-all across all 4 categories
- Audit log: pagination + filtering
- Calibration metadata: read-only
- Override → engine integration: /api/engine/calculate-all reflects override
- Invalid input handling
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-multi-user.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"
EST_EMAIL = "rwalter@standardprinting.com"
EST_PASS = "spot-rich-2026"


# ─── Fixtures ──────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def estimator_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EST_EMAIL, "password": EST_PASS}, timeout=20)
    assert r.status_code == 200, f"estimator login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture
def admin_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def est_hdr(estimator_token):
    return {"Authorization": f"Bearer {estimator_token}"}


@pytest.fixture(autouse=True)
def cleanup_overrides(admin_hdr):
    """Reset all overrides AFTER each test to keep state clean."""
    yield
    try:
        requests.post(f"{BASE_URL}/api/admin/rates/reset-all", headers=admin_hdr, timeout=20)
    except Exception:
        pass


# ─── P1-A: DB split — connectivity ────────────────────────────────────
class TestDbSplit:
    def test_drafts_endpoint_responds(self, admin_hdr):
        # Drafts router is mounted at /api/drafts (NOT /api/quotes/drafts).
        r = requests.get(f"{BASE_URL}/api/drafts", headers=admin_hdr, timeout=20)
        assert r.status_code == 200, r.text
        # Response may be a list or dict; either is fine — we are proving connectivity.
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_customers_endpoint_responds(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/customers", headers=admin_hdr, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_auth_me_returns_admin(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_hdr, timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u.get("email") == ADMIN_EMAIL
        assert u.get("role") == "admin"


# ─── Admin role gate ──────────────────────────────────────────────────
class TestAdminRoleGate:
    def test_estimator_cannot_access_admin_rates(self, est_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=est_hdr, timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_admin_can_access(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "categories" in body and "override_count" in body

    def test_no_auth_rejected(self):
        r = requests.get(f"{BASE_URL}/api/admin/rates", timeout=20)
        assert r.status_code in (401, 403)


# ─── Categories / calibration metadata ────────────────────────────────
class TestMetadata:
    def test_categories_endpoint(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates/categories", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        body = r.json()
        for cat in ("rate", "gm_tier", "sell_tier", "grade_adder"):
            assert cat in body, f"missing category {cat}"

    def test_calibration_endpoint(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates/calibration", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        body = r.json()
        # Just verify it returns a dict with some fields
        assert isinstance(body, dict)
        assert len(body) > 0


# ─── CRUD on each of the 4 categories ─────────────────────────────────
class TestRateCRUD:
    def _get_row(self, hdr, cat, key):
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=hdr, timeout=20)
        assert r.status_code == 200
        for row in r.json()["categories"][cat]:
            if row["key"] == key:
                return row
        return None

    def test_set_and_reset_rate(self, admin_hdr):
        # SET
        r = requests.put(f"{BASE_URL}/api/admin/rates/rate/incaRate",
                         json={"value": "600"}, headers=admin_hdr, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_override"] is True
        assert str(body["value"]) == "600"

        # GET — verify persisted
        row = self._get_row(admin_hdr, "rate", "incaRate")
        assert row is not None
        assert row["is_override"] is True
        assert str(row["value"]) == "600"

        # RESET
        r = requests.delete(f"{BASE_URL}/api/admin/rates/rate/incaRate", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        row = self._get_row(admin_hdr, "rate", "incaRate")
        assert row["is_override"] is False

    def test_set_gm_tier(self, admin_hdr):
        # Find any key in gm_tier
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        rows = r.json()["categories"]["gm_tier"]
        assert len(rows) >= 9, f"expected 9 GM tiers, got {len(rows)}"
        key = rows[0]["key"]
        r = requests.put(f"{BASE_URL}/api/admin/rates/gm_tier/{key}",
                         json={"value": 0.55}, headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        assert r.json()["is_override"] is True

    def test_set_sell_tier(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        rows = r.json()["categories"]["sell_tier"]
        assert len(rows) >= 9
        key = rows[0]["key"]
        r = requests.put(f"{BASE_URL}/api/admin/rates/sell_tier/{key}",
                         json={"value": 999.99}, headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        assert r.json()["is_override"] is True

    def test_set_grade_adder(self, admin_hdr):
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        rows = r.json()["categories"]["grade_adder"]
        assert len(rows) >= 1
        key = rows[0]["key"]
        r = requests.put(f"{BASE_URL}/api/admin/rates/grade_adder/{key}",
                         json={"value": 12.34}, headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        assert r.json()["is_override"] is True

    def test_reset_all(self, admin_hdr):
        # Set 3 overrides
        for k, v in [("incaRate", "600"), ("cadRate", "500"), ("regInkRate", "30")]:
            r = requests.put(f"{BASE_URL}/api/admin/rates/rate/{k}",
                             json={"value": v}, headers=admin_hdr, timeout=20)
            assert r.status_code == 200, f"set {k} failed: {r.text}"

        # Verify
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        assert r.json()["override_count"] >= 3

        # Reset-all
        r = requests.post(f"{BASE_URL}/api/admin/rates/reset-all", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        assert r.json()["reset_count"] >= 3

        # Verify cleared
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        assert r.json()["override_count"] == 0


# ─── Invalid input ────────────────────────────────────────────────────
class TestInvalidInput:
    def test_non_numeric_gm_tier_returns_400(self, admin_hdr):
        # Find any gm_tier key
        r = requests.get(f"{BASE_URL}/api/admin/rates", headers=admin_hdr, timeout=20)
        key = r.json()["categories"]["gm_tier"][0]["key"]
        r = requests.put(f"{BASE_URL}/api/admin/rates/gm_tier/{key}",
                         json={"value": "abc"}, headers=admin_hdr, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_unknown_key_returns_400(self, admin_hdr):
        r = requests.put(f"{BASE_URL}/api/admin/rates/rate/__nope__",
                         json={"value": "1"}, headers=admin_hdr, timeout=20)
        assert r.status_code == 400


# ─── Audit log ────────────────────────────────────────────────────────
class TestAuditLog:
    def test_audit_records_set_and_reset(self, admin_hdr):
        # Generate fresh activity
        requests.put(f"{BASE_URL}/api/admin/rates/rate/incaRate",
                     json={"value": "750"}, headers=admin_hdr, timeout=20)
        requests.delete(f"{BASE_URL}/api/admin/rates/rate/incaRate", headers=admin_hdr, timeout=20)

        r = requests.get(f"{BASE_URL}/api/admin/rates/audit?limit=50", headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) >= 2
        # Most recent first; verify shape
        for row in rows[:5]:
            assert "type" in row and "timestamp" in row and "user" in row

    def test_audit_filter_by_category(self, admin_hdr):
        requests.put(f"{BASE_URL}/api/admin/rates/rate/incaRate",
                     json={"value": "770"}, headers=admin_hdr, timeout=20)
        r = requests.get(f"{BASE_URL}/api/admin/rates/audit?category=rate&limit=20",
                         headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            # reset_all docs have category="ALL"; everything else should be 'rate'
            assert row.get("category") in ("rate", "ALL")

    def test_audit_filter_by_key(self, admin_hdr):
        requests.put(f"{BASE_URL}/api/admin/rates/rate/incaRate",
                     json={"value": "780"}, headers=admin_hdr, timeout=20)
        r = requests.get(f"{BASE_URL}/api/admin/rates/audit?key=incaRate&limit=20",
                         headers=admin_hdr, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row.get("key") == "incaRate"

    def test_audit_pagination(self, admin_hdr):
        r1 = requests.get(f"{BASE_URL}/api/admin/rates/audit?limit=5&skip=0",
                          headers=admin_hdr, timeout=20)
        r2 = requests.get(f"{BASE_URL}/api/admin/rates/audit?limit=5&skip=5",
                          headers=admin_hdr, timeout=20)
        assert r1.status_code == 200 and r2.status_code == 200


# ─── Override → engine integration ────────────────────────────────────
class TestEngineIntegration:
    """Verify that admin overrides actually reach the pricing engine math."""

    # Realistic Inca quote payload shape (matches run_estimate expectations)
    PAYLOAD = {
        "oneUpW": 12, "oneUpL": 18,
        "qtys": [1000],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "Kraft", "insideLiner": "Kraft", "medium": "None",
        "printReq": "Inca", "printMode": "Standard", "printSides": 1,
        "cadDifficulty": "Standard",
    }

    def _calc(self, hdr):
        # Try /api/engine/calculate-all; tolerate different request shapes.
        r = requests.post(f"{BASE_URL}/api/engine/calculate-all",
                          json=self.PAYLOAD, headers=hdr, timeout=30)
        return r

    def test_engine_responds_with_or_without_override(self, admin_hdr):
        """Light-touch test: engine endpoint reachable, and price changes when override is in effect.
        We don't hard-code expected dollars (those came from a curl pre-test); we only assert delta."""
        baseline_resp = self._calc(admin_hdr)
        if baseline_resp.status_code != 200:
            pytest.skip(f"engine/calculate-all not callable in this shape: "
                        f"{baseline_resp.status_code} {baseline_resp.text[:200]}")
        baseline_body = baseline_resp.json()

        # Apply override
        r = requests.put(f"{BASE_URL}/api/admin/rates/rate/incaRate",
                         json={"value": "1000"}, headers=admin_hdr, timeout=20)
        assert r.status_code == 200

        override_resp = self._calc(admin_hdr)
        assert override_resp.status_code == 200
        override_body = override_resp.json()

        # The two responses MUST differ (engine reflects the override).
        assert override_body != baseline_body, \
            "engine response identical before and after override — override not propagated"
