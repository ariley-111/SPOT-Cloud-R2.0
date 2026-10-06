"""Verify the print-sell-factor implementation on PREVIEW: run the 109 rows with factors at baseline (0) and at the plan,
and check per row that Δsell == −print × (m − k) exactly, untouched tiers identical."""
import json
import sys

import requests

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import HERE, mp_items, mp_payload, single_payload  # noqa: E402

LOCAL = "http://localhost:8001"
PLAN = {"1-3": 1.0, "5-9": 1.2}


def login():
    r = requests.post(f"{LOCAL}/api/auth/login", json={"email": "admin@standardprinting.com", "password": "spot-admin-2026"}, timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def set_factors(H, values):
    r = requests.post(f"{LOCAL}/api/admin/rates/bulk", headers=H, json={"category": "print_factor", "values": values}, timeout=30)
    r.raise_for_status()


def run(H, q, qi):
    st = dict(q["state"]); st.pop("pricingVersionId", None)
    is_mp = st.get("quoteType") == "Multi-Part" and bool(st.get("bomItems"))
    out = {}
    if is_mp:
        p = mp_payload(st, None); p["qtys"] = [str(st["qtys"][qi])]; p.pop("pricingVersionId", None)
        r = requests.post(f"{LOCAL}/api/engine/calculate-multi-part", headers=H, json=p, timeout=120); r.raise_for_status()
        slot = (r.json().get("slots") or [None])[0]
        items = mp_items(st)
        for pc in (slot or {}).get("perComponent") or []:
            if pc.get("error") or not pc.get("qty"):
                continue
            idx = next((i for i, it in enumerate(items) if it.get("id") == pc.get("itemId")), None)
            desc = items[idx].get("desc") if idx is not None else pc.get("desc")
            out[(desc, int(pc["qty"]))] = pc
    else:
        qty = int(float(st["qtys"][qi]))
        r = requests.post(f"{LOCAL}/api/engine/calculate-all", headers=H, json=single_payload(st, st, qty, None), timeout=60); r.raise_for_status()
        res = (r.json().get("results") or [None])[0]
        if res and not res.get("error"):
            out[(st.get("itemDesc") or "Item", qty)] = res
    return out


def main():
    H = login()
    quotes = {(q.get("state") or {}).get("estNum"): q for q in json.load(open(f"{HERE}/spot_prod_quotes.json"))}
    rows = json.load(open(f"{HERE}/print_factor_exact.json"))
    want = {(r["SPOT Estimate #"], r["Component"], r["Qty"]): r for r in rows}
    ests = sorted({r["SPOT Estimate #"] for r in rows})

    def pass_(label):
        res = {}
        for est in ests:
            q = quotes[est]
            for qi, qv in enumerate(q["state"].get("qtys") or []):
                try:
                    if int(float(qv)) <= 0:
                        continue
                except (TypeError, ValueError):
                    continue
                for (desc, qty), pc in run(H, q, qi).items():
                    if (est, desc, qty) in want:
                        res[(est, desc, qty)] = pc
        print(f"{label}: {len(res)} rows")
        return res

    set_factors(H, {k: 0 for k in ["0-1", "1-3", "3-5", "5-9", "10-24", "25-49", "50-74", "75-99", "100+"]})
    base = pass_("baseline (factor 0)")
    set_factors(H, PLAN)
    after = pass_("plan (1-3 → 1.0, 5-9 → 1.2)")
    set_factors(H, {k: 0 for k in PLAN})  # restore preview

    bad, checked, changed = [], 0, 0
    for k, b in base.items():
        a = after.get(k)
        if not a:
            continue
        tier = want[k]["tier"]
        f = lambda d, key: float(d.get(key) or 0)  # noqa: E731
        excl = f(b, "dieEmbedded") + f(b, "freightEmbed") + f(b, "prepressEmbedded") + f(b, "proofEmbedded")
        excl = excl if (want[k].get("dieAmort", "Markup") == "Markup") else 0
        m = (f(b, "itemSell") - excl) / (f(b, "totalMfg") - excl) if f(b, "totalMfg") - excl > 0 else 0
        kf = PLAN.get(tier)
        expected = f(b, "itemSell") if kf is None else f(b, "itemSell") - f(b, "printDirect") * (m - kf)
        checked += 1
        if kf is not None:
            changed += 1
        if abs(f(a, "itemSell") - expected) > 0.02 or abs(f(a, "totalMfg") - f(b, "totalMfg")) > 0.005:
            bad.append((k, tier, round(f(b, "itemSell"), 2), round(f(a, "itemSell"), 2), round(expected, 2), f(a, "printSellFactor")))
        if kf is not None and checked <= 3:
            print("  sample", k, tier, "sell", round(f(b, "itemSell"), 2), "->", round(f(a, "itemSell"), 2), "expected", round(expected, 2), "print", round(f(b, "printDirect"), 2), "m", round(m, 3))
    print(f"checked {checked} rows, {changed} in changed tiers, mismatches: {len(bad)}")
    for x in bad[:10]:
        print("  ", x)
    print("PASS" if not bad else "FAIL")


if __name__ == "__main__":
    main()
