"""Bug A end-to-end via HTTP: POST /api/engine/calculate-multi-part
must auto-apply $1200 die ($1380 with markup) to EVERY Crest component.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-estimator.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _comp_state(w=12, l=18, die_cost="0", die_treat="None", route="Crest", rule_in="60"):
    return {
        "oneUpW": str(w), "oneUpL": str(l),
        "boardGrade": "200", "flute": "B",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "totalRuleInches": rule_in,
        "routeOverride": route,
        "cuttingDieCost": die_cost, "dieTreatment": die_treat,
        "pricingBasis": "Gross Margin %",
    }


def test_multipart_crest_4_components_all_get_auto_die(auth_token):
    """4 components on Crest, no die input → each row dieBase=1200, dieAutoApplied=true."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    payload = {
        "mode": "Matched Set",
        "setQty": 2500,
        "qtys": ["2500", "", "", "", ""],
        "bomItems": [
            {"id": "c1", "label": "Comp 1", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(12, 18)},
            {"id": "c2", "label": "Comp 2", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(14, 20)},
            {"id": "c3", "label": "Comp 3", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(10, 14)},
            {"id": "c4", "label": "Comp 4", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(16, 24)},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                      json=payload, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    comp_pricing = data.get("componentPricing", [])
    assert len(comp_pricing) == 4, f"expected 4 components, got {len(comp_pricing)}"

    total_die_base = 0
    for i, cp in enumerate(comp_pricing):
        rows = cp.get("rows", [])
        assert rows, f"component {i} has no rows"
        row0 = rows[0]
        assert row0.get("dieAutoApplied") is True, f"comp {i} dieAutoApplied={row0.get('dieAutoApplied')}"
        assert abs(row0.get("dieBase", 0) - 1200) < 0.01, f"comp {i} dieBase={row0.get('dieBase')}"
        # dieLineCost = 1200 * 1.15 = 1380
        assert abs(row0.get("dieLineCost", 0) - 1380) < 0.01, f"comp {i} dieLineCost={row0.get('dieLineCost')}"
        total_die_base += row0["dieBase"]

    assert abs(total_die_base - 4800) < 0.01, f"expected $4800 total dieBase, got ${total_die_base}"


def test_multipart_user_die_preserved(auth_token):
    """User-supplied $800 die on Crest → no auto-override."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    payload = {
        "mode": "Matched Set",
        "setQty": 1000,
        "qtys": ["1000", "", "", "", ""],
        "bomItems": [
            {"id": "c1", "label": "User Die", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(die_cost="800", die_treat="Separate Line")},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                      json=payload, headers=headers)
    assert r.status_code == 200
    row0 = r.json()["componentPricing"][0]["rows"][0]
    assert row0["dieAutoApplied"] is False
    assert abs(row0["dieBase"] - 800) < 0.01
    assert abs(row0["dieLineCost"] - 920) < 0.01  # 800 * 1.15


def test_multipart_cad_no_auto_die(auth_token):
    """CAD route (low rule_in + Auto) → no auto-die."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    payload = {
        "mode": "Matched Set",
        "setQty": 1000,
        "qtys": ["1000", "", "", "", ""],
        "bomItems": [
            {"id": "c1", "label": "CAD", "type": "Manufactured", "pcsPerSet": 1,
             "state": _comp_state(rule_in="0", route="Auto")},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                      json=payload, headers=headers)
    assert r.status_code == 200
    row0 = r.json()["componentPricing"][0]["rows"][0]
    assert row0.get("dieAutoApplied") is False
    assert (row0.get("dieBase") or 0) == 0


def test_simple_crest_single_component(auth_token):
    """Regression: single-component (non-MP) Crest quote still gets auto-die."""
    headers = {"Authorization": f"Bearer {auth_token}"}
    payload = _comp_state(12, 18)
    payload["qtys"] = ["5000"]
    payload["qty"] = "5000"
    r = requests.post(f"{BASE_URL}/api/engine/calculate",
                      json=payload, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    # Result row(s) returned
    rows = data.get("rows") or [data]
    row0 = rows[0]
    assert row0.get("route") == "Crest"
    assert row0.get("dieAutoApplied") is True
    assert abs(row0.get("dieBase", 0) - 1200) < 0.01
    assert abs(row0.get("dieLineCost", 0) - 1380) < 0.01
