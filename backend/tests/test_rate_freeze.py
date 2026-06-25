"""SPOT — Rate Freeze backend test (rate snapshot per saved quote).

Validates that:
  1. A NEW/draft calc (no quoteId) uses the CURRENT live admin rates.
  2. A SAVED quote stamps a rate_snapshot at save time.
  3. After an admin rate change, the SAVED quote's recalc keeps frozen rates;
     a draft (no quoteId) reflects the new live rate.
  4. Duplicating a saved quote re-prices at current live rates.
  5. Board/stock calc endpoints don't 500 with the new with_pricing wrapper.
"""
import os
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS  = "spot-admin-2026"


# ─── Fixtures ──────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{API}/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# Calc payload that uses a fixed CAD route via overrideSheetId so it
# deterministically drives the CAD cutting cost.
CAD_PAYLOAD = {
    "oneUpW": 12.0, "oneUpL": 18.0, "qty": 1000,
    "qtys": ["1000", "", "", "", ""],
    "boardGrade": "200", "flute": "C", "outsideLiner": "42# Kemi-Lite",
    "insideLiner": "None", "medium": "None",
    "printReq": "No", "printMode": "Satin", "printSides": "1-Sided",
    "cadDifficulty": "Complex",
    "cadPricingMethod": "Per Sheet",
    "overrideSheetId": "OVR-48x96",
}


def _calc(session, auth, payload):
    r = session.post(f"{API}/engine/calculate", json=payload, headers=auth)
    assert r.status_code == 200, f"calc failed {r.status_code}: {r.text[:300]}"
    return r.json()


# ─── 1. Admin rates endpoint reachable ─────────────────────────────
def test_admin_rates_list(session, auth):
    r = session.get(f"{API}/admin/rates", headers=auth)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "categories" in data
    assert "cad_setup" in data["categories"]
    assert "cad_fallback" in data["categories"]


# ─── 2. Draft calc (no quoteId) ────────────────────────────────────
def test_draft_calc_returns_cutter_direct(session, auth):
    res = _calc(session, auth, CAD_PAYLOAD)
    assert res.get("cutterDirect", 0) > 0, f"no cutterDirect in {list(res.keys())}"


# ─── 3. Create saved quote → rate_snapshot stamped ─────────────────
@pytest.fixture(scope="module")
def saved_quote(session, auth):
    body = {
        "est_num": "TEST_RATE_FREEZE_001",
        "customer_code": "TEST",
        "customer_name": "TEST Rate Freeze",
        "state": dict(CAD_PAYLOAD),
        "status": "saved",
        "test_mode": True,
    }
    r = session.post(f"{API}/quotes", json=body, headers=auth)
    assert r.status_code == 200, f"create quote: {r.status_code} {r.text[:300]}"
    q = r.json()
    assert q.get("id")
    assert q.get("rate_snapshot"), "rate_snapshot not stamped on create"
    snap = q["rate_snapshot"]
    # Must contain the 4 frozen categories
    for cat in ("rate", "grade_adder", "cad_setup", "cad_fallback"):
        assert cat in snap, f"snapshot missing category {cat}"
    assert "Complex" in snap["cad_setup"]
    assert "Complex" in snap["cad_fallback"]
    yield q
    # cleanup (no DELETE quote endpoint — best-effort skip)


def test_saved_quote_has_rate_snapshot_via_get(session, auth, saved_quote):
    r = session.get(f"{API}/quotes/{saved_quote['id']}", headers=auth)
    assert r.status_code == 200
    q = r.json()
    assert q.get("rate_snapshot")
    assert q["rate_snapshot"].get("cad_setup", {}).get("Complex") is not None


# ─── 4. CORE freeze: change rate → saved quote stays; draft moves ──
def test_rate_freeze_core(session, auth, saved_quote):
    """The crux of the feature.
    - Capture saved-quote cutterDirect with quoteId.
    - Capture draft cutterDirect (no quoteId).
    - Change cad_fallback.Complex via admin endpoint.
    - Re-calc saved quote with quoteId → cutterDirect UNCHANGED (frozen).
    - Re-calc draft (no quoteId) → cutterDirect CHANGED (live rate).
    - Reset override to restore pod.
    """
    # Baseline values
    payload_saved = dict(CAD_PAYLOAD, quoteId=saved_quote["id"])
    payload_draft = dict(CAD_PAYLOAD)
    saved_before = _calc(session, auth, payload_saved).get("cutterDirect")
    draft_before = _calc(session, auth, payload_draft).get("cutterDirect")
    assert saved_before is not None
    assert draft_before is not None

    # Current admin rate for cad_fallback.Complex
    rates = session.get(f"{API}/admin/rates", headers=auth).json()
    fb_rows = {r["key"]: r for r in rates["categories"]["cad_fallback"]}
    assert "Complex" in fb_rows
    current = float(fb_rows["Complex"]["value"])
    new_val = current + 5.0  # significantly different

    # Apply override
    r = session.put(f"{API}/admin/rates/cad_fallback/Complex",
                    json={"value": new_val}, headers=auth)
    assert r.status_code == 200, f"set override failed: {r.status_code} {r.text[:300]}"

    try:
        saved_after = _calc(session, auth, payload_saved).get("cutterDirect")
        draft_after = _calc(session, auth, payload_draft).get("cutterDirect")
        # SAVED quote MUST be frozen
        assert abs(saved_after - saved_before) < 0.01, (
            f"FREEZE FAIL: saved quote moved after admin rate change "
            f"({saved_before} → {saved_after})"
        )
        # DRAFT MUST reflect new rate (cutterDirect goes UP when per-sheet min/sheet increases)
        assert abs(draft_after - draft_before) > 0.5, (
            f"LIVE-RATE FAIL: draft did NOT change after admin rate change "
            f"({draft_before} → {draft_after})"
        )
        assert draft_after > draft_before, (
            f"draft cutterDirect should rise when cad_fallback Complex increases "
            f"({draft_before} → {draft_after})"
        )
    finally:
        # ALWAYS reset, even if assertion failed
        rr = session.delete(f"{API}/admin/rates/cad_fallback/Complex", headers=auth)
        assert rr.status_code == 200, f"reset failed {rr.status_code}: {rr.text[:200]}"


# ─── 5. Duplicate re-prices at current live ────────────────────────
def test_duplicate_reprices_current(session, auth, saved_quote):
    """Change rate, duplicate the saved quote, confirm the clone uses NEW rate
    while the original stays frozen, then reset."""
    payload_saved = dict(CAD_PAYLOAD, quoteId=saved_quote["id"])
    saved_before = _calc(session, auth, payload_saved).get("cutterDirect")

    # Bump cad_setup Complex
    rates = session.get(f"{API}/admin/rates", headers=auth).json()
    setup_rows = {r["key"]: r for r in rates["categories"]["cad_setup"]}
    current = float(setup_rows["Complex"]["value"])
    new_val = current + 10.0
    r = session.put(f"{API}/admin/rates/cad_setup/Complex",
                    json={"value": new_val}, headers=auth)
    assert r.status_code == 200

    clone_id = None
    try:
        # Duplicate
        rc = session.post(f"{API}/quotes/{saved_quote['id']}/copy", headers=auth)
        assert rc.status_code == 200, f"copy failed: {rc.status_code} {rc.text[:300]}"
        clone = rc.json()
        clone_id = clone["id"]
        # Clone snapshot Complex setup should be the NEW value
        clone_setup_complex = float(clone["rate_snapshot"]["cad_setup"]["Complex"])
        assert abs(clone_setup_complex - new_val) < 0.01

        # Recalc original — still frozen
        saved_after = _calc(session, auth, payload_saved).get("cutterDirect")
        assert abs(saved_after - saved_before) < 0.01, (
            f"original moved: {saved_before} → {saved_after}"
        )
        # Recalc clone — uses NEW live rate
        clone_payload = dict(CAD_PAYLOAD, quoteId=clone_id)
        clone_calc = _calc(session, auth, clone_payload).get("cutterDirect")
        assert clone_calc > saved_before, (
            f"clone did NOT pick up higher setup ({saved_before} → {clone_calc})"
        )
    finally:
        # Clone has no DELETE endpoint — leave it; reset the override.
        session.delete(f"{API}/admin/rates/cad_setup/Complex", headers=auth)


# ─── 6. Regression: standard calc endpoints don't 500 ──────────────
def test_calculate_no_500(session, auth):
    r = session.post(f"{API}/engine/calculate",
                     json=CAD_PAYLOAD, headers=auth)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "itemSell" in body or "sellTotal" in body or "cutterDirect" in body


def test_calculate_multi_part_no_500(session, auth):
    mp_payload = {
        "quoteType": "Multi-Part",
        "pricingMode": "Matched Set",
        "setMarginPct": "0.40",
        "qtys": ["1000", "", "", "", ""],
        "bomItems": [{
            "id": "i1", "desc": "Test", "type": "Manufactured",
            "pcsPerSet": 1,
            "state": dict(CAD_PAYLOAD),
        }],
    }
    r = session.post(f"{API}/engine/calculate-multi-part",
                     json=mp_payload, headers=auth)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "slots" in data
