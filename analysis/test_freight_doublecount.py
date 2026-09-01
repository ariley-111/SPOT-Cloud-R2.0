"""Freight double-count repro.

Sends a Multi-Part payload to /calculate-multi-part with BOTH:
  - per-component freightCost = $100 (Separate Line)
  - top-level jobFreightCost = $500, freightScope = "Per Job"

Then compares against payloads with only one of the two. If line_freight
in the "both" case > (per-item only) + (job only) - overlap, we have double-count.
"""
import json
import os
import sys
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8001")

# Login as seed admin
r = requests.post(
    f"{BASE}/api/auth/login",
    json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"},
    timeout=10,
)
if r.status_code != 200:
    print("LOGIN FAILED", r.status_code, r.text[:200])
    sys.exit(1)
tok = r.json().get("token") or r.json().get("access_token")
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def build(with_item_freight: bool, with_job_freight: bool):
    item_state = {
        "oneUpW": "12", "oneUpL": "12", "qtys": ["100", "", "", "", ""],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kla-White", "insideLiner": "42# Kla-White", "medium": "None",
        "printReq": "No", "printMode": "None",
        "quoteFOB": "Destination",
        "freightMarkup": "0.15",
        "freightTreatment": "Separate Line" if with_item_freight else "None",
        "freightCost": "100" if with_item_freight else "0",
    }
    bom = [
        {"id": "A", "desc": "Comp A", "type": "Manufactured", "pcsPerSet": 1, "state": dict(item_state)},
        {"id": "B", "desc": "Comp B", "type": "Manufactured", "pcsPerSet": 1, "state": dict(item_state)},
    ]
    payload = {
        "quoteType": "Multi-Part",
        "pricingMode": "Matched Set",
        "qtys": ["100", "", "", "", ""],
        "activeItemIdx": 0,
        "bomItems": bom,
        "estInitials": "TT",
        "quoteFOB": "Destination",
        "freightMarkup": "0.15",
        "freightAllocMethod": "Equal",
    }
    if with_job_freight:
        payload["freightScope"] = "Per Job"
        payload["jobFreightCost"] = "500"
        payload["jobFreightTreatment"] = "Separate Line"
    return payload


def run(label, payload):
    r = requests.post(f"{BASE}/api/engine/calculate-multi-part", headers=H, json=payload, timeout=30)
    if r.status_code != 200:
        print(f"[{label}] {r.status_code} {r.text[:300]}")
        return None
    j = r.json()
    s0 = j["slots"][0]
    keys = [k for k in s0.keys() if "freight" in k.lower() or "sell" in k.lower() or "cost" in k.lower() or "line" in k.lower()]
    print(f"[{label}]  slot0 keys: {keys}")
    for k in keys:
        v = s0.get(k)
        if isinstance(v, (int, float)):
            print(f"    {k} = {v}")
    return j


print("=" * 60)
print("Freight Double-Count Test")
print("=" * 60)
print("\nEach component has freightCost=$100 → per-item = 2 × $100 × 1.15 = $230")
print("Top-level jobFreightCost = $500 → job-level = $500 × 1.15 = $575")
print()
print("If backend correctly zeroes per-item when Per Job scope active:")
print("  BOTH mode should show freight = $575 (job only)")
print("If backend double-counts:")
print("  BOTH mode should show freight = $230 + $575 = $805")
print()

a = run("PER-ITEM ONLY", build(True, False))
b = run("PER-JOB ONLY ", build(False, True))
c = run("BOTH SET     ", build(True, True))
