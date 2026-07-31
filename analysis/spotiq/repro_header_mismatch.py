"""Reproduce the production RW-260629-133153 report/UI mismatch in preview.

Scenario: MP Individual quote, 2 components, per-item qtys. freightCarrier was
set to Local Delivery (markup 0) while each item was active, but gatherItemState
never persisted it into bomItems[i].state. Quote saved with item 1 (Side Panel)
active -> top-level mirror keys are Side Panel's.

Compare: report Header row  vs  engine run the UI does when Header is ACTIVE
(top-level mirror = Header + leaked top-level freightCarrier).
"""
import io, json, requests, openpyxl

API = None
for line in open('/app/frontend/.env'):
    if line.startswith('REACT_APP_BACKEND_URL='):
        API = line.split('=', 1)[1].strip()
TOKEN = requests.post(f"{API}/api/auth/login", json={
    "email": "admin@standardprinting.com", "password": "spot-admin-2026"}).json()["access_token"]
H = {"Authorization": f"Bearer {TOKEN}"}


def item(desc, w, l, qty, flute, grade, rule, strip):
    # NOTE: freightCarrier deliberately ABSENT (the production drift)
    return {"id": f"it-{desc}", "desc": desc, "type": "Manufactured", "pcsPerSet": 1,
            "state": {"itemDesc": desc, "oneUpW": w, "oneUpL": l, "qtys": [qty, "", "", "", ""],
                      "flute": flute, "boardGrade": grade, "outsideLiner": "Kemi", "insideLiner": "Kraft",
                      "printReq": "Yes", "printMode": "Gloss", "printSides": "1",
                      "cadDifficulty": "Standard", "cadPricingMethod": "Rule",
                      "totalRuleInches": rule, "handStripping": strip,
                      "strippingComplexity": "Standard",
                      "prepressTreatment": "Amortize", "prepressCost": "50",
                      "freightCost": "70", "freightTreatment": "Amortize"}}


header = item("Header", "41", "46.375", "250", "B", "250", "283", "Yes")
side = item("Side Panel 2 Out", "44.375", "44.375", "500", "E", "200", "189", "No")
side["state"]["dieTreatment"] = "Line"
side["state"]["cuttingDieCost"] = "1380"

# Saved with SIDE PANEL active -> top-level holds side panel's item keys + carrier
state = {"quoteType": "Multi-Part", "pricingMode": "Individual",
         "qtys": ["500", "", "", "", ""], "activeItemIdx": 1,
         "custName": "REPRO", "custRef": "Header Mismatch Repro", "quoteFOB": "Destination",
         "goodForTesting": True, "iquoteNum": "REPRO-1",
         "freightCarrier": "SPC Local Delivery",
         "bomItems": [header, side]}
state.update(side["state"])  # top-level mirror of active item

q = requests.post(f"{API}/api/quotes", headers=H, json={"state": state, "est_num": "REPRO-HDR-1"}).json()
qid = q["id"]

# ── UI run with HEADER active (user clicks Header tab):
#    applyItemStateTo loads header item state to top level; freightCarrier is NOT
#    an ITEM_LEVEL_KEY so the saved top-level value LEAKS and stays.
items_ui = [dict(header), dict(side)]
items_ui = [{**it, "state": {**it["state"], "freightCarrier": "SPC Local Delivery"}}
            for it in items_ui]  # applyState() heal: carrier seeded into ALL items
ui_payload = {"quoteType": "Multi-Part", "pricingMode": "Individual",
              "setMarginPct": "0.40", "setMarginOverride": False,
              "fulfillmentMarginPct": "0.45", "purchasedMarginPct": "0.40",
              "qtys": ["250", "", "", "", ""], "activeItemIdx": 0,
              "bomItems": items_ui, "custName": "REPRO", "custRef": "Header Mismatch Repro",
              "jobFreightBySlot": {}, "freightCarrier": "SPC Local Delivery", "quoteFOB": "Destination", "quoteId": qid}
eng = requests.post(f"{API}/api/engine/calculate-multi-part", headers=H, json=ui_payload).json()

ui = {}
for slot in eng.get("slots", []):
    for pc in slot.get("perComponent", []):
        ui[(pc["desc"], pc["qty"])] = {
            "sell": round(pc.get("itemSell") or 0, 2), "cost": round(pc.get("totalMfg") or 0, 2),
            "freight": round((pc.get("freightLine") or 0) + (pc.get("freightEmbed") or 0), 2),
            "mat": round((pc.get("matTotal") or 0) + (pc.get("matMakeready") or 0), 2),
            "route": pc.get("route"), "quoteTotal": round(slot.get("sellTotal") or 0, 2)}
print("UI (header active):", json.dumps({f"{k[0]}@{k[1]}": v for k, v in ui.items()}, indent=1))

r = requests.get(f"{API}/api/quotes/_report/testing.xlsx", headers=H)
wb = openpyxl.load_workbook(io.BytesIO(r.content))
ws = wb.active
hdr = [c.value for c in ws[1]]
print("\nREPORT rows:")
for row in ws.iter_rows(min_row=2, values_only=True):
    d = dict(zip(hdr, row))
    if d["SPOT Estimate #"] != "REPRO-HDR-1":
        continue
    print(f" {d['Component']}@{d['Qty']}: mat={d['Material Cost']} route={d['Route']} "
          f"freight={d['Freight']} cost={d['Total Cost']} sell={d['Sell Total']} qt={d['Quote Total']}")

requests.delete(f"{API}/api/quotes/{qid}", headers=H)
