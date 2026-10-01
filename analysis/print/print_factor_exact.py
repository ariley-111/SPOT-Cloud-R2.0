"""Exact print-sell-factor hypothetical on the 109 won-job rows using the PROD engine's own per-row outputs.
sell' = sell - print * (m - k), where m = engine's effective margin multiplier on print = (itemSell - excl) / (totalMfg - excl).
No engine change; read-only replay."""
import json
import statistics
import sys
from collections import defaultdict

import openpyxl
import requests

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import HERE, PROD, login, mp_items, mp_payload, single_payload, write_sheet, r2  # noqa: E402

F = ["itemSell", "sellTotal", "totalMfg", "printDirect", "dieEmbedded", "freightEmbed", "prepressEmbedded", "proofEmbedded",
     "miscLineCost", "dieLineCost", "freightLine", "prepressLineCost", "proofLineCost", "oMSF", "gmPct", "route"]


def replay(H, q, qi):
    st = q["state"]
    is_mp = st.get("quoteType") == "Multi-Part" and bool(st.get("bomItems"))
    out = []
    if is_mp:
        p = mp_payload(st, None); p["qtys"] = [str(st["qtys"][qi])]
        r = requests.post(f"{PROD}/api/engine/calculate-multi-part", headers=H, json=p, timeout=120); r.raise_for_status()
        slot = (r.json().get("slots") or [None])[0]
        if not slot:
            return out
        items = mp_items(st)
        for pc in slot.get("perComponent") or []:
            if pc.get("error") or not pc.get("qty"):
                continue
            idx = next((i for i, it in enumerate(items) if it.get("id") == pc.get("itemId")), None)
            ist = (items[idx].get("state") or {}) if idx is not None else {}
            out.append({"Component": items[idx].get("desc") if idx is not None else pc.get("desc"), "Qty": int(pc["qty"]),
                        "basis": ist.get("pricingBasis") or st.get("pricingBasis") or "Gross Margin %", "mode": st.get("pricingMode") or "Individual",
                        "dieAmort": ist.get("dieAmortMethod") or "Markup", **{k: pc.get(k) for k in F}})
    else:
        qty = int(float(st["qtys"][qi]))
        r = requests.post(f"{PROD}/api/engine/calculate-all", headers=H, json=single_payload(st, st, qty, None), timeout=60); r.raise_for_status()
        res = (r.json().get("results") or [None])[0]
        if res and not res.get("error"):
            out.append({"Component": st.get("itemDesc") or "Item", "Qty": qty, "basis": st.get("pricingBasis") or "Gross Margin %",
                        "mode": "Simple", "dieAmort": st.get("dieAmortMethod") or "Markup", **{k: res.get(k) for k in F}})
    return out


def main():
    H = login()
    quotes = {(q.get("state") or {}).get("estNum"): q for q in json.load(open(f"{HERE}/spot_prod_quotes.json"))}
    base = json.load(open(f"{HERE}/cost_center_rows_tiered.json"))
    want = {(r["SPOT Estimate #"], r["Component"], r["Qty"]): r for r in base}
    rows = []
    for est in sorted({r["SPOT Estimate #"] for r in base}):
        q = quotes[est]
        for qi, qv in enumerate(q["state"].get("qtys") or []):
            try:
                if int(float(qv)) <= 0:
                    continue
            except (TypeError, ValueError):
                continue
            for c in replay(H, q, qi):
                b = want.get((est, c["Component"], c["Qty"]))
                if not b:
                    continue
                f = lambda k: float(c.get(k) or 0)  # noqa: E731
                excl = (f("dieEmbedded") + f("freightEmbed") + f("prepressEmbedded") + f("proofEmbedded")) if c["dieAmort"] == "Markup" else 0
                sell, mfg, pr = f("itemSell"), f("totalMfg"), f("printDirect")
                m = (sell - excl) / (mfg - excl) if (mfg - excl) > 0 else 0
                lines = f("sellTotal") - sell
                rows.append({**{k: b[k] for k in ["SPOT Estimate #", "iQuote #", "Component", "iQ Product", "Qty", "Qty Band", "tier", "msf"]},
                             "Pricing basis": c["basis"], "Pricing mode": c["mode"], "Route": c.get("route"),
                             "SPOT Cost": r2(mfg), "SPOT Print": r2(pr), "Print share %": round(pr / mfg * 100, 1) if mfg else 0,
                             "Engine GM%": round(f("gmPct") * 100, 1), "Print multiplier today": round(m, 2),
                             "Line charges": r2(lines), "SPOT Sell today": r2(sell + lines), "iQ Sell": b["iQ Sell"],
                             "Δ% today": round(((sell + lines) / b["iQ Sell"] - 1) * 100, 1),
                             **{f"Sell k={k}": r2(sell - pr * (m - k) + lines) for k in (1.0, 0.85, 0.75)},
                             **{f"Δ% k={k}": round(((sell - pr * (m - k) + lines) / b["iQ Sell"] - 1) * 100, 1) for k in (1.0, 0.85, 0.75)},
                             **{f"GM% k={k}": round((sell - pr * (m - k) - mfg) / (sell - pr * (m - k)) * 100, 1) for k in (1.0, 0.85, 0.75)},
                             "Note": "" if c["basis"] == "Gross Margin %" else "$/MSF basis — print cost does not drive sell"})
    json.dump(rows, open(f"{HERE}/print_factor_exact.json", "w"))
    print(len(rows), "rows;", sum(1 for r in rows if r["Note"]), "on $/MSF basis;", "modes", {m: sum(1 for r in rows if r["Pricing mode"] == m) for m in set(r["Pricing mode"] for r in rows)})
    tiers = ["0-1", "1-3", "3-5", "5-9", "10-24", "25-49", "ALL"]
    summ = []
    for t in tiers:
        rs = [r for r in rows if t == "ALL" or r["tier"] == t]
        if not rs:
            continue
        iq = sum(r["iQ Sell"] for r in rs)
        s = {"MSF tier": t, "Rows": len(rs), "iQ Sell": r2(iq)}
        for lab, key in [("today", "SPOT Sell today"), ("k=1.0", "Sell k=1.0"), ("k=0.85", "Sell k=0.85"), ("k=0.75", "Sell k=0.75")]:
            S = sum(r[key] for r in rs)
            pk = "Δ% today" if lab == "today" else f"Δ% {lab}"
            pcts = [r[pk] for r in rs]
            s[f"{lab} Δ%"] = round((S / iq - 1) * 100, 1)
            s[f"{lab} median"] = round(statistics.median(pcts), 1)
            s[f"{lab} ±20%"] = sum(1 for p in pcts if abs(p) <= 20)
            C = sum(r["SPOT Cost"] for r in rs)
            s[f"{lab} GM%"] = round((S - sum(r["Line charges"] for r in rs) - C) / (S - sum(r["Line charges"] for r in rs)) * 100, 1)
        summ.append(s)
        print({k: v for k, v in s.items() if "median" not in k})
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    write_sheet(wb, "Summary by MSF tier", summ)
    write_sheet(wb, "Rows", rows, widths={"SPOT Estimate #": 24, "Component": 30, "iQ Product": 28})
    wb.save(f"{HERE}/Print_Factor_Exact.xlsx"); print("wrote")


if __name__ == "__main__":
    main()
