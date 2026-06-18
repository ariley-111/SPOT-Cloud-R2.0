"""Cost Report (internal) — verifies the multi-part componentPricing rows expose
the per-row cost breakdown fields the Cost Report modal renders
(Material/Print/Cutter/Finish/OH/Sheets) plus the board_spec_view print fields.

Legacy parity: spot_r1_5.jsx L8021-8252 internal cost report columns.
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
        pytest.skip(f"Login failed: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _mp_payload():
    mfg = {
        "oneUpW": "12", "oneUpL": "10",
        "qtys": ["500", "1000", "", "", ""],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "2-Sided",
        "cadDifficulty": "Standard",
    }
    mfg2 = {**mfg, "oneUpW": "8", "oneUpL": "6"}
    return {
        "quoteType": "Multi-Part", "pricingMode": "Matched Set",
        "setMarginPct": "0.40", "purchasedMarginPct": "0.40", "fulfillmentMarginPct": "0.45",
        "qtys": ["500", "1000", "", "", ""],
        "bomItems": [
            {"id": "i1", "desc": "Tray", "type": "Manufactured", "pcsPerSet": 1, "state": mfg},
            {"id": "i2", "desc": "Lid", "type": "Manufactured", "pcsPerSet": 1, "state": mfg2},
        ],
    }


REPORT_FIELDS = ["matTotal", "matMakeready", "printDirect", "cutterDirect",
                 "saberCost", "assemblyCost", "overhead", "sheetsReq",
                 "stripCost", "totalMfg", "itemSell", "sellTotal", "oMSF",
                 "gmPct", "gmDollar", "route"]


@pytest.fixture(scope="module")
def resp(client):
    r = client.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                    json=_mp_payload(), timeout=60)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    return r.json()


def test_component_pricing_present(resp):
    cp = resp.get("componentPricing") or []
    assert len(cp) == 2, "expected 2 components"
    for c in cp:
        assert c.get("rows"), f"component {c.get('desc')} has no rows"


def test_rows_expose_cost_report_fields(resp):
    cp = resp["componentPricing"]
    for c in cp:
        for row in c["rows"]:
            for f in REPORT_FIELDS:
                assert f in row, f"row missing '{f}' (needed by Cost Report) in {c['desc']}"


def test_manufactured_rows_have_real_costs(resp):
    cp = resp["componentPricing"]
    for c in cp:
        for row in c["rows"]:
            # Material = matTotal + matMakeready should be > 0 for a real MFG run
            assert float(row["matTotal"]) > 0, f"{c['desc']} matTotal should be > 0"
            assert float(row["totalMfg"]) > 0
            assert float(row["sheetsReq"]) > 0


def test_board_spec_view_has_print_fields(resp):
    cp = resp["componentPricing"]
    for c in cp:
        bs = c.get("boardSpec") or {}
        assert "printReq" in bs and "printMode" in bs and "printSides" in bs
        assert bs.get("boardGrade") == "200"
