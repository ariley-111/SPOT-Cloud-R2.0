"""Per-Job freight allocation tests (iteration_11).

Validates the legacy `allocateJobCost` port in engine_routes._alloc_job:
  - MP-Individual + freightScope=Per Job + freightAllocMethod=By MSF →
    SUM of all components' freightLine ≈ jobFreightCost*(1+freightMarkup),
    split proportionally by each component's total oMSF.
  - MP-Matched Set + freightAllocMethod=Equal → each manufactured component
    in each slot gets jobFreightCost*(1+freightMarkup)/N_mfg per slot.
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if not tok:
        pytest.skip("No token in login response")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _mfg_state(qtys):
    return {
        "oneUpW": "5", "oneUpL": "7",
        "qtys": qtys,
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Digital",
        "printSides": "1/0", "numColorsF": "4", "numColorsB": "0",
        "cadDifficulty": "Standard",
        "dieType": "Existing Die",
    }


# ── MP-Individual / By MSF: total = 1500*1.15 = 1725 split by total oMSF ──
class TestIndividualPerJobByMSF:
    @pytest.fixture(scope="class")
    def resp(self, client):
        payload = {
            "quoteType": "Multi-Part",
            "pricingMode": "Individual",
            "setMarginPct": "0.40",
            "setMarginOverride": False,
            "purchasedMarginPct": "0.40",
            "fulfillmentMarginPct": "0.45",
            "qtys": ["42", "168", "2352", "", ""],
            "bomItems": [
                {"id": "a", "desc": "Comp A", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["42", "", "", "", ""])},
                {"id": "b", "desc": "Comp B", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["", "168", "", "", ""])},
                {"id": "c", "desc": "Comp C", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["", "", "2352", "", ""])},
            ],
            "freightScope": "Per Job",
            "jobFreightCost": "1500",
            "freightAllocMethod": "By MSF",
            "freightMarkup": "0.15",
            "jobFreightTreatment": "Separate Line",
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_total_freight_equals_marked_up_job_cost(self, resp):
        cps = resp["componentPricing"]
        total = sum(
            float(row.get("freightLine") or 0)
            for cp in cps for row in cp["rows"]
        )
        # 1500 * 1.15 = 1725
        assert total == pytest.approx(1725.0, abs=0.01), (
            f"Expected total freight ≈ 1725, got {total}. "
            f"Per-comp shares: {[[float(r.get('freightLine') or 0) for r in cp['rows']] for cp in cps]}"
        )

    def test_smallest_omsf_gets_smallest_share(self, resp):
        """Comp A qty=42, Comp C qty=2352 → A should have smallest freight, C largest."""
        cps = resp["componentPricing"]
        share_a = sum(float(r.get("freightLine") or 0) for r in cps[0]["rows"])
        share_b = sum(float(r.get("freightLine") or 0) for r in cps[1]["rows"])
        share_c = sum(float(r.get("freightLine") or 0) for r in cps[2]["rows"])
        assert share_a < share_b < share_c, (
            f"Expected freight monotonic A<B<C by oMSF; got A={share_a} B={share_b} C={share_c}"
        )
        assert share_a > 0
        assert share_c > 0

    def test_sell_total_includes_freight_share(self, resp):
        """sellTotal must include the freightLine share for each row."""
        for cp in resp["componentPricing"]:
            for row in cp["rows"]:
                fl = float(row.get("freightLine") or 0)
                base = float(row["itemSell"])
                die = float(row.get("dieLineCost") or 0)
                prep = float(row.get("prepressLineCost") or 0)
                misc = float(row.get("miscLineCost") or 0)
                expected = base + fl + die + prep + misc
                assert float(row["sellTotal"]) == pytest.approx(expected, abs=0.05), (
                    f"sellTotal mismatch for comp={cp.get('desc')}: "
                    f"got {row['sellTotal']}, expected {expected}"
                )


# ── MP-Matched Set / Equal: per-slot allocation, equal split ──
class TestMatchedSetPerJobEqual:
    @pytest.fixture(scope="class")
    def resp(self, client):
        payload = {
            "quoteType": "Multi-Part",
            "pricingMode": "Matched Set",
            "setMarginPct": "0.40",
            "setMarginOverride": False,
            "purchasedMarginPct": "0.40",
            "fulfillmentMarginPct": "0.45",
            "qtys": ["1000", "", "", "", ""],
            "bomItems": [
                {"id": "a", "desc": "Comp A", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["1000", "", "", "", ""])},
                {"id": "b", "desc": "Comp B", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["1000", "", "", "", ""])},
                {"id": "c", "desc": "Comp C", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["1000", "", "", "", ""])},
            ],
            "freightScope": "Per Job",
            "jobFreightCost": "1500",
            "freightAllocMethod": "Equal",
            "freightMarkup": "0.15",
            "jobFreightTreatment": "Separate Line",
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_each_component_gets_equal_share(self, resp):
        cps = resp["componentPricing"]
        # 1500 * 1.15 = 1725, /3 mfg = 575 per component (slot 0 only)
        for i, cp in enumerate(cps):
            share = sum(float(r.get("freightLine") or 0) for r in cp["rows"])
            assert share == pytest.approx(575.0, abs=0.05), (
                f"Comp {i} ({cp.get('desc')}): expected 575, got {share}"
            )

    def test_total_freight_matches_marked_up(self, resp):
        total = sum(
            float(row.get("freightLine") or 0)
            for cp in resp["componentPricing"] for row in cp["rows"]
        )
        assert total == pytest.approx(1725.0, abs=0.05)
