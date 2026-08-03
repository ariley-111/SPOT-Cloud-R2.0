"""Full report-vs-UI parity regression over EVERY saved quote.

For each saved quote: flag it (alone) for testing, download the report XLSX,
independently rebuild the UI engine payload with EXACT JS semantics
(useEngine.js buildPayload/buildMpPayload), call the same engine endpoints the
UI calls, and compare Sell Total / Quote Total / Total Cost / Margin % per
component per qty. Restores all flags at the end.
"""
import io
import json
import os
import sys

import openpyxl
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
API = None
for line in open('/app/frontend/.env'):
    if line.startswith('REACT_APP_BACKEND_URL='):
        API = line.split('=', 1)[1].strip()

TOKEN = requests.post(f"{API}/api/auth/login", json={
    "email": "admin@standardprinting.com", "password": "spot-admin-2026"}).json()["access_token"]
H = {"Authorization": f"Bearer {TOKEN}"}
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]

_MISSING = object()


def g(state, key):
    """JS `state.key`: missing -> _MISSING (undefined), null -> None."""
    return state.get(key, _MISSING)


def js_or(v, dflt):
    """JS `x || dflt` (falsy -> default)."""
    if v is _MISSING or not v:
        return dflt
    return v


def js_str(x):
    if x is None:
        return "null"
    if x is _MISSING:
        return "undefined"
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, float) and x == int(x):
        return str(int(x))
    return str(x)


def clean(d):
    """Drop undefined keys like JSON.stringify does."""
    return {k: v for k, v in d.items() if v is not _MISSING}


def build_payload(state, quote_id):
    """Replica of useEngine.js buildPayload()."""
    ro = g(state, "routeOverride")
    return clean({
        "oneUpW": js_or(g(state, "oneUpW"), "0"),
        "oneUpL": js_or(g(state, "oneUpL"), "0"),
        "qtys": [js_str(x) for x in (js_or(g(state, "qtys"), []))],
        "flute": g(state, "flute"), "boardGrade": g(state, "boardGrade"),
        "outsideLiner": g(state, "outsideLiner"), "insideLiner": g(state, "insideLiner"),
        "medium": g(state, "medium"),
        "fscEnabled": bool(js_or(g(state, "fscEnabled"), False)),
        "printReq": g(state, "printReq"), "printMode": g(state, "printMode"),
        "printSides": g(state, "printSides"), "whiteInk": g(state, "whiteInk"),
        "colorsFront": g(state, "colorsFront"), "colorsBack": g(state, "colorsBack"),
        "routeOverride": ro if (ro is not _MISSING and ro and ro != "Auto") else _MISSING,
        "cadDifficulty": g(state, "cadDifficulty"), "cadPricingMethod": g(state, "cadPricingMethod"),
        "cadMethodTouched": bool(js_or(g(state, "cadMethodTouched"), False)),
        "totalRuleInches": g(state, "totalRuleInches"), "perfPct": g(state, "perfPct"),
        "productMats": g(state, "productMats"),
        "saber": g(state, "saber"), "saberCuts": g(state, "saberCuts"),
        "saberBlanksOut": g(state, "saberBlanksOut"),
        "handStripping": g(state, "handStripping"),
        "perimeterStripping": g(state, "perimeterStripping"),
        "strippingComplexity": g(state, "strippingComplexity"),
        "handGluing": g(state, "handGluing"), "jointsPerPiece": g(state, "jointsPerPiece"),
        "gluingComplexity": g(state, "gluingComplexity"),
        "tape": g(state, "tape"), "tapeType": g(state, "tapeType"),
        "tapeStrips": g(state, "tapeStrips"), "tapeStripLength": g(state, "tapeStripLength"),
        "quoteFOB": g(state, "quoteFOB"), "freightCost": g(state, "freightCost"),
        "freightTreatment": g(state, "freightTreatment"), "freightMarkup": g(state, "freightMarkup"),
        "freightCarrier": g(state, "freightCarrier"),
        "cuttingDieCost": g(state, "cuttingDieCost"), "dieTreatment": g(state, "dieTreatment"),
        "dieMarkup": g(state, "dieMarkup"),
        "prepressCost": g(state, "prepressCost"), "prepressTreatment": g(state, "prepressTreatment"),
        "proofTreatment": g(state, "proofTreatment"), "proofCost": g(state, "proofCost"),
        "proofMarkup": g(state, "proofMarkup"),
        "miscCharges": g(state, "miscCharges"), "miscChargeMarkup": g(state, "miscChargeMarkup"),
        "pricingBasis": g(state, "pricingBasis"),
        "gmByTier": js_or(g(state, "gmByTier"), _MISSING),
        "sellByTier": js_or(g(state, "sellByTier"), _MISSING),
        "freightByQty": js_or(g(state, "freightByQty"), _MISSING),
        "forcedSellPc": js_or(g(state, "forcedSellPc"), _MISSING),
        "buyMinBoard": js_or(g(state, "buyMinBoard"), "Auto"),
        "boardSubstitution": js_or(g(state, "boardSubstitution"), None),
        "overrideSheetId": js_or(g(state, "overrideSheetId"), None),
        "pricingVersionId": js_or(g(state, "pricingVersionId"), _MISSING),
        "quoteId": quote_id or _MISSING,
    })


_MP_ITEM_KEYS = [
    "itemDesc", "boxStyle", "custIdent", "quoteMode", "oneUpW", "oneUpL",
    "sheetSizeW", "sheetSizeL", "sheetPcsPerSheet", "corrFlipped", "overrideSheetId",
    "qtys", "selSlot", "flute", "boardGrade", "outsideLiner", "insideLiner", "medium",
    "fscEnabled", "fscFee", "buyMinBoard", "boardSubstitution",
    "printReq", "printMode", "printSides", "whiteInk", "colorsFront", "colorsBack",
    "routeOverride", "cadDifficulty", "cadPricingMethod", "cadMethodTouched", "totalRuleInches",
    "perfPct", "productMats", "saber", "saberCuts", "saberBlanksOut",
    "handStripping", "perimeterStripping", "strippingComplexity",
    "handGluing", "jointsPerPiece", "gluingComplexity",
    "tape", "tapeType", "tapeStrips", "tapeStripLength",
    "prepressTreatment", "prepressCost", "proofTreatment", "proofCost", "proofMarkup",
    "dieTreatment", "cuttingDieCost", "dieAmortMethod", "miscCharges",
    "freightType", "freightTreatment", "freightCost", "freightMarkup",
    "freightCarrier", "freightByQty", "forcedSellPc", "gmByTier", "sellByTier",
    "pricingBasis", "miscChargeMarkup",
]

# New DEFAULT_STATE keys (2026-08): browser state always carries these after
# applyState(), even for legacy saves that lack them in the DB.
_NEW_DEFAULTS = {"freightCarrier": "", "pricingBasis": "Gross Margin %",
                 "gmByTier": None, "sellByTier": None, "forcedSellPc": None,
                 "miscChargeMarkup": None}


def js_state(state):
    """Replicate applyState(): merge new defaults + freightCarrier heal."""
    s = {**_NEW_DEFAULTS, **state}
    if s.get("freightCarrier") and isinstance(s.get("bomItems"), list):
        s["bomItems"] = [
            {**it, "state": {**(it.get("state") or {}), "freightCarrier": s["freightCarrier"]}}
            if it and it.get("state") and not (it.get("state") or {}).get("freightCarrier")
            else it
            for it in s["bomItems"]]
    return s


def build_mp_payload(state, quote_id):
    """Replica of useEngine.js buildMpPayload() with exact JS spread semantics."""
    items = [dict(it) for it in (js_or(g(state, "bomItems"), []))]
    active = g(state, "activeItemIdx")
    active = 0 if active in (_MISSING, None) else active
    if isinstance(active, int) and 0 <= active < len(items):
        merged = dict(items[active].get("state") or {})
        for k in _MP_ITEM_KEYS:
            v = g(state, k)
            if v is _MISSING:
                # JS: `k: undefined` overwrites -> key dropped by JSON.stringify
                merged.pop(k, None)
            else:
                merged[k] = v
        items[active] = {**items[active], "state": merged}
    if state.get("freightScope") == "Per Job":
        items = [{**it, "state": {**(it.get("state") or {}),
                                  "freightCost": "0", "freightTreatment": "None"}}
                 for it in items]
    return clean({
        "quoteType": g(state, "quoteType"),
        "pricingMode": js_or(g(state, "pricingMode"), "Matched Set"),
        "setMarginPct": js_or(g(state, "setMarginPct"), "0.40"),
        "setMarginOverride": bool(js_or(g(state, "setMarginOverride"), False)),
        "fulfillmentMarginPct": js_or(g(state, "fulfillmentMarginPct"), "0.45"),
        "purchasedMarginPct": js_or(g(state, "purchasedMarginPct"), "0.40"),
        "qtys": [js_str(x) for x in (js_or(g(state, "qtys"), []))],
        "activeItemIdx": active,
        "bomItems": items,
        "estInitials": g(state, "estInitials"),
        "custName": g(state, "custName"), "custCode": g(state, "custCode"),
        "custRef": g(state, "custRef"),
        "destZip": g(state, "destZip"), "quoteFOB": g(state, "quoteFOB"),
        "freightScope": g(state, "freightScope"),
        "freightAllocMethod": g(state, "freightAllocMethod"),
        "jobFreightCost": g(state, "jobFreightCost"),
        "jobFreightTreatment": g(state, "jobFreightTreatment"),
        "jobFreightBySlot": js_or(g(state, "jobFreightBySlot"), {}),
        "freightMarkup": g(state, "freightMarkup"),
        "freightCarrier": g(state, "freightCarrier"),
        "prepressScope": g(state, "prepressScope"),
        "prepressAllocMethod": g(state, "prepressAllocMethod"),
        "jobPrepressCost": g(state, "jobPrepressCost"),
        "jobPrepressTreatment": g(state, "jobPrepressTreatment"),
        "pricingVersionId": js_or(g(state, "pricingVersionId"), _MISSING),
        "quoteId": quote_id or _MISSING,
    })


def r2(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def ui_values(q):
    """Call the engine exactly like the UI and return {(component, qty): (sell, quote_total, cost, gm)}."""
    state = js_state(q.get("state") or {})
    is_mp = state.get("quoteType") == "Multi-Part" and bool(state.get("bomItems"))
    out = {}
    if is_mp:
        payload = build_mp_payload(state, q.get("id"))
        resp = requests.post(f"{API}/api/engine/calculate-multi-part", headers=H, json=payload)
        resp.raise_for_status()
        data = resp.json()
        per_job = state.get("freightScope") == "Per Job"
        for slot in (data.get("slots") or []):
            for pc in (slot.get("perComponent") or []):
                if pc.get("error"):
                    continue
                qt = r2(slot.get("sellTotal")) if per_job else r2(pc.get("sellTotal"))
                fr = r2(pc.get("allocatedFreight")) if per_job else (
                    r2((pc.get("freightLine") or 0) + (pc.get("freightEmbed") or 0)))
                out[(pc.get("desc") or "", pc.get("qty"))] = (
                    r2(pc.get("itemSell")), qt, r2(pc.get("totalMfg")),
                    r2(pc.get("gmDollar")),
                    round(float(pc.get("gmPct") or 0) * 100, 1), fr)
    else:
        payload = build_payload(state, q.get("id"))
        resp = requests.post(f"{API}/api/engine/calculate-all", headers=H, json=payload)
        resp.raise_for_status()
        data = resp.json()
        desc = state.get("itemDesc") or "Item"
        for rr in (data.get("results") or []):
            if rr.get("error"):
                continue
            out[(desc, rr.get("qty"))] = (
                r2(rr.get("itemSell")), r2(rr.get("sellTotal")),
                r2(rr.get("totalMfg")), r2(rr.get("gmDollar")),
                round(float(rr.get("gmPct") or 0) * 100, 1),
                r2((rr.get("freightLine") or 0) + (rr.get("freightEmbed") or 0)))
    return out


def report_values():
    """Download report (only one quote is flagged at a time) -> same keyed dict."""
    r = requests.get(f"{API}/api/quotes/_report/testing.xlsx", headers=H)
    r.raise_for_status()
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb.active
    hdr = [c.value for c in ws[1]]
    out, errors = {}, []
    for row in ws.iter_rows(min_row=2, values_only=True):
        d = dict(zip(hdr, row))
        comp = d.get("Component") or ""
        if str(comp).startswith("ENGINE ERROR"):
            errors.append(comp)
            continue
        out[(comp, d.get("Qty"))] = (d.get("Sell Total"), d.get("Quote Total"),
                                     d.get("Total Cost"), d.get("Margin $"),
                                     d.get("Margin %"),
                                     d.get("Freight") if d.get("Freight") != "" else 0.0)
    return out, errors


def main():
    quotes = list(db.quotes.find({}))
    originals = {q["_id"]: bool((q.get("state") or {}).get("goodForTesting")) for q in quotes}
    db.quotes.update_many({}, {"$set": {"state.goodForTesting": False}})

    results = []
    try:
        for q in quotes:
            est = q.get("est_num") or str(q.get("id"))
            state = q.get("state") or {}
            label = f"{est} [{state.get('quoteType', 'Simple')}/{state.get('pricingMode', '')}]"
            db.quotes.update_one({"_id": q["_id"]}, {"$set": {"state.goodForTesting": True}})
            try:
                ui = ui_values({**q, "id": q.get("id")})
                rep, rep_errors = report_values()
            except Exception as e:  # noqa: BLE001
                results.append((label, "ERROR", [f"{type(e).__name__}: {e}"]))
                continue
            finally:
                db.quotes.update_one({"_id": q["_id"]}, {"$set": {"state.goodForTesting": False}})
            issues = []
            for key in sorted(set(ui) | set(rep), key=lambda k: (str(k[0]), str(k[1]))):
                u, rp = ui.get(key), rep.get(key)
                if u != rp:
                    issues.append(f"  {key[0]}@{key[1]}: UI={u} REPORT={rp}")
            for e in rep_errors:
                issues.append(f"  {e}")
            results.append((label, "PASS" if not issues else "FAIL", issues))
    finally:
        for _id, flag in originals.items():
            db.quotes.update_one({"_id": _id}, {"$set": {"state.goodForTesting": flag}})

    n_pass = sum(1 for _, s, _ in results if s == "PASS")
    n_fail = sum(1 for _, s, _ in results if s == "FAIL")
    n_err = sum(1 for _, s, _ in results if s == "ERROR")
    for label, status, issues in results:
        print(f"{status}: {label}")
        for i in issues:
            print(i)
    print(f"\n=== PARITY REGRESSION: {n_pass} PASS / {n_fail} FAIL / {n_err} ERROR "
          f"of {len(results)} quotes ===")
    sys.exit(0 if (n_fail == 0 and n_err == 0) else 1)


if __name__ == "__main__":
    main()
