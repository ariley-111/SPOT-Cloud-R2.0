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


# ── Local Delivery / By Weight / 0% markup ──
# Regression for BUG-2026-02 (freight 3-way mismatch). User scenario:
# LocalDelivery + Per-Job $70 + freightAllocMethod=By Weight + freightMarkup=0
# → per-component allocation sums to exactly $70, AND the aggregate
#   slots[0].freightLine also equals $70 (matches Quote Table footer raw).
class TestLocalDeliveryByWeight:
    @pytest.fixture(scope="class")
    def resp(self, client):
        # Two components: small + large board so shipWeight differs significantly
        payload = {
            "quoteType": "Multi-Part",
            "pricingMode": "Individual",
            "setMarginPct": "0.40",
            "setMarginOverride": False,
            "purchasedMarginPct": "0.40",
            "fulfillmentMarginPct": "0.45",
            "qtys": ["500", "", "", "", ""],
            "bomItems": [
                {"id": "small", "desc": "Small Part", "type": "Manufactured", "pcsPerSet": 1,
                 "state": {**_mfg_state(["500", "", "", "", ""]), "oneUpW": "5", "oneUpL": "7"}},
                {"id": "large", "desc": "Large Part", "type": "Manufactured", "pcsPerSet": 1,
                 "state": {**_mfg_state(["500", "", "", "", ""]), "oneUpW": "12", "oneUpL": "18"}},
            ],
            "quoteFOB": "LocalDelivery",
            "freightScope": "Per Job",
            "jobFreightCost": 70,
            "freightAllocMethod": "By Weight",
            "freightMarkup": "0",
            "jobFreightTreatment": "Separate Line",
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_sum_of_components_equals_70(self, resp):
        total = sum(
            float(row.get("freightLine") or 0)
            for cp in resp["componentPricing"] for row in cp["rows"]
        )
        assert total == pytest.approx(70.0, abs=0.01), (
            f"Expected $70 (no markup); got ${total:.2f}"
        )

    def test_aggregate_freight_matches_components(self, resp):
        """slots[0].freightLine (used by Cost Buildup + Quote Table footer)
        must match the sum of per-component freight to avoid 3-way mismatch."""
        agg = float(resp["slots"][0].get("freightLine") or 0)
        comp_sum = sum(
            float(row.get("freightLine") or 0)
            for cp in resp["componentPricing"] for row in cp["rows"]
        )
        assert agg == pytest.approx(comp_sum, abs=0.01), (
            f"aggregate freight ${agg:.2f} != component sum ${comp_sum:.2f}"
        )
        assert agg == pytest.approx(70.0, abs=0.01)

    def test_larger_part_gets_larger_share(self, resp):
        cps = resp["componentPricing"]
        share_small = sum(float(r.get("freightLine") or 0) for r in cps[0]["rows"])
        share_large = sum(float(r.get("freightLine") or 0) for r in cps[1]["rows"])
        assert share_large > share_small, (
            f"Larger (heavier) part should get larger freight share; "
            f"small=${share_small:.2f}, large=${share_large:.2f}"
        )


# ── Ship + Per-Job + 15% markup aggregate consistency ──
# After BUG-2026-02 fix: aggregate must include markup ($70 * 1.15 = $80.50)
# so the Cost Buildup, Quote Table component rows, and Quote Table footer all
# show the same total.
class TestShipPerJobAggregateConsistency:
    @pytest.fixture(scope="class")
    def resp(self, client):
        payload = {
            "quoteType": "Multi-Part",
            "pricingMode": "Individual",
            "setMarginPct": "0.40",
            "purchasedMarginPct": "0.40",
            "fulfillmentMarginPct": "0.45",
            "qtys": ["500", "", "", "", ""],
            "bomItems": [
                {"id": "a", "desc": "A", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["500", "", "", "", ""])},
                {"id": "b", "desc": "B", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["500", "", "", "", ""])},
            ],
            "quoteFOB": "Destination",
            "freightScope": "Per Job",
            "jobFreightCost": 70,
            "freightAllocMethod": "By Weight",
            "freightMarkup": "0.15",
            "jobFreightTreatment": "Separate Line",
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_component_sum_equals_80_50(self, resp):
        total = sum(
            float(row.get("freightLine") or 0)
            for cp in resp["componentPricing"] for row in cp["rows"]
        )
        assert total == pytest.approx(80.50, abs=0.01)

    def test_aggregate_equals_component_sum(self, resp):
        agg = float(resp["slots"][0].get("freightLine") or 0)
        comp_sum = sum(
            float(row.get("freightLine") or 0)
            for cp in resp["componentPricing"] for row in cp["rows"]
        )
        assert agg == pytest.approx(comp_sum, abs=0.01)
        assert agg == pytest.approx(80.50, abs=0.01)

    def test_jobTotals_raw_value_preserved(self, resp):
        """jobTotals.jobFreightCost MUST remain the raw $70 so the UI can
        render '$70 + 15% markup' breakdown labels correctly."""
        assert float(resp["jobTotals"]["jobFreightCost"]) == pytest.approx(70.0, abs=0.01)
