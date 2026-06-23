"""Test the Multi-Part aggregator dieBaseTotal field."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-estimator.preview.emergentagent.com").rstrip("/")


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"})
    return r.json()["access_token"]


def test_diebasetotal_aggregates_correctly():
    token = _login()
    headers = {"Authorization": f"Bearer {token}"}
    state = lambda w, l: {
        "oneUpW": str(w), "oneUpL": str(l),
        "boardGrade": "200", "flute": "B",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "totalRuleInches": "60", "routeOverride": "Crest",
        "cuttingDieCost": "0", "dieTreatment": "None",
        "pricingBasis": "Gross Margin %",
    }
    payload = {
        "mode": "Matched Set", "setQty": 2500,
        "qtys": ["2500", "", "", "", ""],
        "bomItems": [
            {"id": f"c{i}", "label": f"C{i}", "type": "Manufactured", "pcsPerSet": 1,
             "state": state(12 + i, 18 + i)} for i in range(5)
        ],
    }
    r = requests.post(f"{BASE_URL}/api/engine/calculate-multi-part",
                      json=payload, headers=headers)
    assert r.status_code == 200
    data = r.json()
    slots = data.get("slots") or data.get("matched_set") or []
    # find the slot with our setQty
    found = None
    for s in slots:
        if s.get("setQty") == 2500 or s.get("slot") == 2500:
            found = s
            break
    if not found and slots:
        found = slots[0]
    print("dieBaseTotal:", found.get("dieBaseTotal"), "dieMarkupAvg:", found.get("dieMarkupAvg"))
    assert abs(found.get("dieBaseTotal", 0) - 5 * 1200) < 0.01, \
        f"expected 6000 (5 comps × $1200), got {found.get('dieBaseTotal')}"
    assert abs(found.get("dieLineCost", 0) - 5 * 1380) < 0.01, \
        f"expected $6900 die line, got {found.get('dieLineCost')}"


if __name__ == "__main__":
    test_diebasetotal_aggregates_correctly()
    print("PASS")
