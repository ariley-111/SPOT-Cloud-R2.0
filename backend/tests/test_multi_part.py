"""Multi-Part backend integration tests (MP-1..MP-6 parity).

Covers /api/engine/calculate-multi-part orchestration:
- Matched Set default mode (3 components: Manufactured/Purchased/Fulfillment)
- GM override mode (forces uniform margin)
- Individual mode (per-item qtys)
- Job-level freight allocation (Per Job, By MSF)
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"


# ── fixtures ─────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if not tok:
        pytest.skip(f"No token in login response: {r.json()}")
    return tok


@pytest.fixture(scope="module")
def client(api, auth_token):
    api.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api


# ── shared builders ──────────────────────────────────────────────────
def _manufactured_state():
    """Minimal but realistic Manufactured component state (Header Card)."""
    return {
        "oneUpW": "5", "oneUpL": "7",
        "qtys": ["500", "1000", "2500", "", ""],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Digital",
        "printSides": "1/0", "numColorsF": "4", "numColorsB": "0",
        "cadDifficulty": "Standard",
        "dieType": "Existing Die",
    }


def _mp_payload(pricing_mode="Matched Set", set_override=False, set_margin="0.40",
                with_freight=False):
    bom = [
        {"id": "i1", "desc": "Header Card", "type": "Manufactured",
         "pcsPerSet": 1, "state": _manufactured_state()},
        {"id": "i2", "desc": "Insert", "type": "Purchased", "pcsPerSet": 1,
         "state": {"purchasedCost": "0.25", "qtys": ["500", "1000", "2500", "", ""]}},
        {"id": "i3", "desc": "Fulfillment Kit", "type": "Fulfillment", "pcsPerSet": 1,
         "state": {"fulfillmentFee": "0.50", "qtys": ["500", "1000", "2500", "", ""]}},
    ]
    payload = {
        "quoteType": "Multi-Part",
        "pricingMode": pricing_mode,
        "setMarginPct": set_margin,
        "setMarginOverride": set_override,
        "purchasedMarginPct": "0.40",
        "fulfillmentMarginPct": "0.45",
        "qtys": ["500", "1000", "2500", "", ""],
        "bomItems": bom,
    }
    if with_freight:
        payload.update({
            "freightScope": "Per Job",
            "jobFreightCost": "500",
            "freightAllocMethod": "By MSF",
        })
    return payload


# ── auth gate ────────────────────────────────────────────────────────
class TestMultiPartAuth:
    def test_unauth_blocked(self, api):
        r = requests.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                          json=_mp_payload(), timeout=15)
        assert r.status_code in (401, 403)


# ── Matched Set default mode ─────────────────────────────────────────
class TestMatchedSetDefault:
    @pytest.fixture(scope="class")
    def resp(self, client):
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=_mp_payload(), timeout=60)
        assert r.status_code == 200, f"MP calc failed: {r.status_code} {r.text[:400]}"
        return r.json()

    def test_meta_shape(self, resp):
        meta = resp["meta"]
        assert meta["pricingMode"] == "Matched Set"
        assert meta["setMarginOverride"] is False
        assert meta["itemCount"] == 3
        assert meta["manufacturedCount"] == 1
        assert meta["hasPurchased"] is True
        assert meta["hasFulfillment"] is True

    def test_three_slots_returned(self, resp):
        # qtys = [500, 1000, 2500, "", ""] → 3 priceable slots
        assert len(resp["slots"]) == 3
        for s in resp["slots"]:
            assert "perComponent" in s
            assert len(s["perComponent"]) == 3

    def test_manufactured_has_nonzero_cost(self, resp):
        for slot in resp["slots"]:
            mfg = [pc for pc in slot["perComponent"] if pc["type"] == "Manufactured"]
            assert len(mfg) == 1
            assert mfg[0].get("totalMfg", 0) > 0, "Manufactured run should produce real cost"
            assert mfg[0].get("itemSell", 0) > 0

    def test_purchased_markup_formula(self, resp):
        # cost_pc 0.25, margin 0.40 → sell_pc = 0.35
        for slot in resp["slots"]:
            p = next(pc for pc in slot["perComponent"] if pc["type"] == "Purchased")
            assert p["costPc"] == pytest.approx(0.25, rel=1e-6)
            assert p["sellPc"] == pytest.approx(0.35, rel=1e-6)
            # cost = 0.25 * qty
            assert p["totalMfg"] == pytest.approx(0.25 * slot["setQty"], rel=1e-6)
            assert p["itemSell"] == pytest.approx(0.35 * slot["setQty"], rel=1e-6)

    def test_fulfillment_markup_formula(self, resp):
        # fee 0.50, margin 0.45 → sell_per_set = 0.725
        for slot in resp["slots"]:
            f = next(pc for pc in slot["perComponent"] if pc["type"] == "Fulfillment")
            assert f["costPc"] == pytest.approx(0.50, rel=1e-6)
            assert f["sellPc"] == pytest.approx(0.725, rel=1e-6)

    def test_gm_pct_computed(self, resp):
        for slot in resp["slots"]:
            if slot.get("jobSell", 0) > 0:
                expected_gm = (slot["jobSell"] - slot["jobCost"]) / slot["jobSell"]
                assert slot["gmPct"] == pytest.approx(expected_gm, rel=1e-4)

    def test_set_sell_decreases_with_volume(self, resp):
        # Per-set sell should drop with volume (manufacturing scale)
        sells = [s["setSell"] for s in resp["slots"]]
        # Allow weak monotonicity; at minimum biggest qty < smallest qty per-set
        assert sells[-1] < sells[0], f"Per-set sell should decline: {sells}"


# ── GM Override ──────────────────────────────────────────────────────
class TestGMOverride:
    def test_override_forces_uniform_margin(self, client):
        payload = _mp_payload(set_override=True, set_margin="0.40")
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["meta"]["setMarginOverride"] is True
        for slot in data["slots"]:
            # GM% should be exactly 40.00% (job_sell = cost / (1-0.40))
            assert round(slot["gmPct"] * 100, 2) == 40.00, (
                f"GM override should yield 40.00%, got {slot['gmPct']*100}")


# ── Individual Mode ──────────────────────────────────────────────────
class TestIndividualMode:
    def test_uses_per_item_qtys(self, client):
        payload = _mp_payload(pricing_mode="Individual")
        # Make insert qtys distinct from set qtys
        payload["bomItems"][1]["state"]["qtys"] = ["750", "1500", "3000", "", ""]
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["meta"]["pricingMode"] == "Individual"
        # Slot 0: purchased should price 750 pcs at 0.25 = $187.50 cost
        slot0 = data["slots"][0]
        p = next(pc for pc in slot0["perComponent"] if pc["type"] == "Purchased")
        assert p["totalQty"] == 750, f"Individual mode should use item qtys, got {p['totalQty']}"
        assert p["totalMfg"] == pytest.approx(187.50, rel=1e-4)


# ── Job-level freight allocation ─────────────────────────────────────
class TestJobLevelFreightAlloc:
    def test_freight_allocated_to_manufactured(self, client):
        payload = _mp_payload(with_freight=True)
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        # Each per-component should carry an allocatedFreight field
        for slot in data["slots"]:
            keys_present = [("allocatedFreight" in pc) for pc in slot["perComponent"]]
            assert any(keys_present), (
                f"Expected allocatedFreight on at least one component for slot {slot['slot']}: "
                f"{slot['perComponent']}"
            )
            # Fulfillment must be excluded from freight per spec → either missing or 0
            ful = next(pc for pc in slot["perComponent"] if pc["type"] == "Fulfillment")
            assert ful.get("allocatedFreight", 0) == 0 or "allocatedFreight" not in ful


# ── Empty / edge cases ───────────────────────────────────────────────
class TestEdgeCases:
    def test_no_bom_items(self, client):
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json={"quoteType": "Multi-Part", "bomItems": [], "qtys": ["500"]},
                        timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("slots") == []
