"""Component-pricing data shape tests for Multi-Part endpoint.

Verifies the new `componentPricing` array + `jobTotals` block added to
POST /api/engine/calculate-multi-part for both Individual and Matched Set modes.
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


# ── Individual Mode: per-component qty in different slots ──────────────
class TestIndividualComponentPricing:
    @pytest.fixture(scope="class")
    def resp(self, client):
        # Component A qty=42 in slot 0; B qty=168 in slot 1; C qty=2352 in slot 2
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
            "jobFreightCost": "120",
            "freightAllocMethod": "By MSF",
            "prepressScope": "Per Job",
            "jobPrepressCost": "85",
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_response_has_component_pricing(self, resp):
        assert "componentPricing" in resp
        assert isinstance(resp["componentPricing"], list)
        assert len(resp["componentPricing"]) == 3

    def test_each_component_has_one_row(self, resp):
        cps = resp["componentPricing"]
        expected_qtys = [42, 168, 2352]
        for i, cp in enumerate(cps):
            assert "rows" in cp, f"comp {i} missing rows"
            assert len(cp["rows"]) == 1, (
                f"Individual mode comp {i}: expected 1 row, got {len(cp['rows'])}: {cp['rows']}"
            )
            row = cp["rows"][0]
            assert row["qty"] == expected_qtys[i], (
                f"comp {i}: expected qty={expected_qtys[i]}, got {row['qty']}"
            )

    def test_row_required_fields(self, resp):
        required = ["qty", "sellPc", "costPc", "perM", "sellMSF", "costMSF",
                    "sheetW", "sheetL", "pcsPerSheet", "route", "cadHrs",
                    "freightLine", "dieLineCost", "prepressLineCost", "sellTotal"]
        for i, cp in enumerate(resp["componentPricing"]):
            row = cp["rows"][0]
            for f in required:
                assert f in row, f"comp {i} row missing field {f}: {list(row.keys())}"

    def test_manufactured_row_has_real_sheet_route(self, resp):
        # All three are Manufactured — should have real sheet specs & a route
        for i, cp in enumerate(resp["componentPricing"]):
            row = cp["rows"][0]
            assert row.get("route"), f"comp {i} missing route: {row}"
            # sheet dimensions should be numeric and >0 for Manufactured
            sw = row.get("sheetW") or 0
            sl = row.get("sheetL") or 0
            try:
                sw, sl = float(sw), float(sl)
            except (TypeError, ValueError):
                sw, sl = 0, 0
            assert sw > 0 and sl > 0, (
                f"comp {i}: expected non-zero sheet dimensions, got W={row.get('sheetW')} L={row.get('sheetL')}"
            )

    def test_component_meta_fields(self, resp):
        for cp in resp["componentPricing"]:
            for k in ("itemId", "itemIndex", "desc", "type", "pcsPerSet", "boardSpec", "rows"):
                assert k in cp, f"componentPricing missing {k}"

    def test_job_totals_block(self, resp):
        assert "jobTotals" in resp
        jt = resp["jobTotals"]
        for k in ("freightScope", "prepressScope", "jobFreightCost", "jobPrepressCost"):
            assert k in jt, f"jobTotals missing {k}"
        assert jt["freightScope"] == "Per Job"
        assert jt["jobFreightCost"] == pytest.approx(120.0, rel=1e-6)
        assert jt["prepressScope"] == "Per Job"
        assert jt["jobPrepressCost"] == pytest.approx(85.0, rel=1e-6)

    def test_backcompat_slots_and_results_still_present(self, resp):
        assert "slots" in resp
        assert isinstance(resp["slots"], list)
        assert "meta" in resp


# ── Matched Set Mode: 3 rows per component (one per matched set qty) ────
class TestMatchedSetComponentPricing:
    @pytest.fixture(scope="class")
    def resp(self, client):
        payload = {
            "quoteType": "Multi-Part",
            "pricingMode": "Matched Set",
            "setMarginPct": "0.40",
            "setMarginOverride": False,
            "purchasedMarginPct": "0.40",
            "fulfillmentMarginPct": "0.45",
            "qtys": ["1000", "5000", "10000", "", ""],
            "bomItems": [
                {"id": "a", "desc": "Comp A", "type": "Manufactured", "pcsPerSet": 1,
                 "state": _mfg_state(["1000", "5000", "10000", "", ""])},
                {"id": "b", "desc": "Comp B", "type": "Manufactured", "pcsPerSet": 2,
                 "state": _mfg_state(["1000", "5000", "10000", "", ""])},
                {"id": "c", "desc": "Comp C", "type": "Purchased", "pcsPerSet": 4,
                 "state": {"purchasedCost": "0.10",
                           "qtys": ["1000", "5000", "10000", "", ""]}},
            ],
        }
        r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                        json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        return r.json()

    def test_three_components_each_three_rows(self, resp):
        cps = resp["componentPricing"]
        assert len(cps) == 3
        for cp in cps:
            assert len(cp["rows"]) == 3, (
                f"comp {cp.get('desc')}: expected 3 rows, got {len(cp['rows'])}"
            )

    def test_row_qty_equals_setqty_times_pcs_per_set(self, resp):
        set_qtys = [1000, 5000, 10000]
        pcs_per_set_by_idx = [1, 2, 4]
        for ci, cp in enumerate(resp["componentPricing"]):
            pps = pcs_per_set_by_idx[ci]
            for ri, row in enumerate(cp["rows"]):
                expected = set_qtys[ri] * pps
                assert row["qty"] == expected, (
                    f"comp {ci} row {ri}: qty={row['qty']} expected {expected} "
                    f"(setQty={set_qtys[ri]} * pcsPerSet={pps})"
                )

    def test_pricingmode_matched_in_meta(self, resp):
        assert resp["meta"]["pricingMode"] == "Matched Set"
