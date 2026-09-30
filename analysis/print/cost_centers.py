"""Where does the SELL gap come from? Cost-center decomposition SPOT vs iQuote on the matched print rows."""
import json
import sys
from collections import defaultdict

import openpyxl
import requests

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import HERE, PROD, QTY_BANDS, login, mp_items, mp_payload, single_payload, write_sheet, r2  # noqa: E402

FIELDS = ["matTotal", "matMakeready", "printDirect", "cutterDirect", "saberCost", "stripCost", "assemblyCost",
          "dieLineCost", "dieEmbedded", "freightEmbed", "prepressEmbedded", "proofEmbedded", "miscLineCost",
          "overhead", "totalMfg", "itemSell", "cadHrs", "route"]


def iq_accounts():
    wb = openpyxl.load_workbook(f"{HERE}/iquote_cost_breakdown.xlsx", read_only=True, data_only=True)
    acc = defaultdict(lambda: defaultdict(float))
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        h = rows[0]
        for r in rows[1:]:
            d = dict(zip(h, r))
            k = (int(d["IdQuote"]), str(d["OptDesc"]), str(d["Product"]).strip(), int(d["Qty"]))
            try:
                acc[k][d["CostAccountDesc"]] += float(d["Cost"])
                acc[k]["_price"] = float(d["TotalPrice"])
                acc[k]["_acct_price_" + d["CostAccountDesc"]] += float(d["CostAcctPrice"])
            except (TypeError, ValueError):
                pass
    return acc


def spot_breakdown(H, q, qty_idx):
    state = q["state"]
    is_mp = state.get("quoteType") == "Multi-Part" and bool(state.get("bomItems"))
    out = []
    if is_mp:
        p = mp_payload(state, None)
        p["qtys"] = [str((state.get("qtys") or [])[qty_idx])]
        r = requests.post(f"{PROD}/api/engine/calculate-multi-part", headers=H, json=p, timeout=120)
        r.raise_for_status()
        slot = (r.json().get("slots") or [None])[0]
        if not slot:
            return out
        items = mp_items(state)
        for pc in slot.get("perComponent") or []:
            if pc.get("error") or not pc.get("qty"):
                continue
            idx = next((i for i, it in enumerate(items) if it.get("id") == pc.get("itemId")), None)
            desc = items[idx].get("desc") if idx is not None else pc.get("desc")
            out.append({"Component": desc, "Qty": int(pc["qty"]), **{f: pc.get(f) for f in FIELDS}})
    else:
        qty = int(float((state.get("qtys") or [])[qty_idx]))
        r = requests.post(f"{PROD}/api/engine/calculate-all", headers=H, json=single_payload(state, state, qty, None), timeout=60)
        r.raise_for_status()
        res = (r.json().get("results") or [None])[0]
        if res and not res.get("error"):
            out.append({"Component": state.get("itemDesc") or "Item", "Qty": qty, **{f: res.get(f) for f in FIELDS}})
    return out


def main():
    H = login()
    quotes = json.load(open(f"{HERE}/spot_prod_quotes.json"))
    by_est = {(q.get("state") or {}).get("estNum"): q for q in quotes if (q.get("state") or {}).get("estNum")}
    matched = json.load(open(f"{HERE}/print_parity_data.json"))["matched"]
    acc = iq_accounts()
    mkey = {(m["SPOT Estimate #"], m["Component"], m["Qty"]): m for m in matched}
    rows = []
    for n, est in enumerate(sorted({m["SPOT Estimate #"] for m in matched}), 1):
        q = by_est.get(est)
        if not q:
            continue
        for qi, qv in enumerate(q["state"].get("qtys") or []):
            try:
                if int(float(qv)) <= 0:
                    continue
            except (TypeError, ValueError):
                continue
            try:
                comps = spot_breakdown(H, q, qi)
            except Exception as e:  # noqa
                print("ERR", est, e)
                continue
            for c in comps:
                m = mkey.get((est, c["Component"], c["Qty"]))
                if not m:
                    continue
                a = acc.get((m["IdQuote"], m["iQ Option"], m["iQ Product"], m["iQ Qty"]), {})
                f = lambda k: float(c.get(k) or 0)  # noqa: E731
                iq_print = a.get("Inca", 0) + a.get("Press Raw Material", 0)
                iq_cut = a.get("Zund - Large", 0) + a.get("Crest Clamshell", 0)
                iq_hand = a.get("Handwork Finishing", 0) + a.get("Hand Stripping", 0) + a.get("Hand Gluing", 0)
                iq_price = a.get("_price", m["iQ Product Price $"] or 0)
                spot_cost = f("totalMfg")
                rows.append({
                    "SPOT Estimate #": est, "iQuote #": m["IdQuote"], "Component": c["Component"], "iQ Product": m["iQ Product"],
                    "Qty": c["Qty"], "Qty Band": m["Qty Band"], "SPOT Route": c.get("route"),
                    "SPOT Board $": r2(f("matTotal") + f("matMakeready")), "SPOT Print $": r2(f("printDirect")),
                    "SPOT Cutting $ (CAD/Crest)": r2(f("cutterDirect")), "SPOT Saber $": r2(f("saberCost")),
                    "SPOT Hand Strip $": r2(f("stripCost")), "SPOT Hand Glue/Assembly $": r2(f("assemblyCost")),
                    "SPOT Die $": r2(f("dieLineCost") + f("dieEmbedded")),
                    "SPOT Other $ (freight/prepress/proof/misc embed)": r2(f("freightEmbed") + f("prepressEmbedded") + f("proofEmbedded") + f("miscLineCost")),
                    "SPOT Overhead $": r2(f("overhead")), "SPOT Total Cost": r2(spot_cost), "SPOT Sell": r2(f("itemSell")),
                    "SPOT Margin $": r2(f("itemSell") - spot_cost),
                    "iQ Print $": r2(iq_print), "iQ Zund $": r2(a.get("Zund - Large", 0)), "iQ Crest $": r2(a.get("Crest Clamshell", 0)),
                    "iQ Hand $": r2(iq_hand), "iQ Known Cost $": r2(iq_print + iq_cut + iq_hand), "iQ Sell": r2(iq_price),
                    "iQ Sell − known cost (board+margin+other)": r2(iq_price - iq_print - iq_cut - iq_hand),
                    "Δ Print": r2(f("printDirect") - iq_print), "Δ Cutting": r2(f("cutterDirect") - iq_cut),
                    "Δ Hand": r2(f("stripCost") + f("assemblyCost") - iq_hand),
                    "Δ Sell": r2(f("itemSell") - iq_price), "Δ Sell %": round((f("itemSell") - iq_price) / iq_price * 100, 1) if iq_price else None,
                })
        if n % 20 == 0:
            print(f"  {n}", flush=True)
    json.dump(rows, open(f"{HERE}/cost_center_rows.json", "w"))
    # band summary
    g = defaultdict(list)
    for r in rows:
        g[r["Qty Band"]].append(r)
    g["ALL"] = rows
    summ = []
    keys = ["SPOT Board $", "SPOT Print $", "SPOT Cutting $ (CAD/Crest)", "SPOT Saber $", "SPOT Hand Strip $", "SPOT Hand Glue/Assembly $",
            "SPOT Die $", "SPOT Other $ (freight/prepress/proof/misc embed)", "SPOT Overhead $", "SPOT Total Cost", "SPOT Margin $", "SPOT Sell",
            "iQ Print $", "iQ Zund $", "iQ Crest $", "iQ Hand $", "iQ Sell − known cost (board+margin+other)", "iQ Sell"]
    for b in [x[0] for x in QTY_BANDS] + ["ALL"]:
        rs = g.get(b)
        if not rs:
            continue
        s = {"Qty Band": b, "Rows": len(rs)}
        for k in keys:
            s[k] = r2(sum(r[k] for r in rs))
        s["Δ Sell $"] = r2(s["SPOT Sell"] - s["iQ Sell"])
        s["Δ Sell %"] = round(s["Δ Sell $"] / s["iQ Sell"] * 100, 1) if s["iQ Sell"] else None
        s["Δ Print $"] = r2(s["SPOT Print $"] - s["iQ Print $"])
        s["Δ Cutting $"] = r2(s["SPOT Cutting $ (CAD/Crest)"] - s["iQ Zund $"] - s["iQ Crest $"])
        s["Δ Hand $"] = r2(s["SPOT Hand Strip $"] + s["SPOT Hand Glue/Assembly $"] - s["iQ Hand $"])
        s["Δ Rest $ (board+margin+other)"] = r2(s["Δ Sell $"] - s["Δ Print $"] - s["Δ Cutting $"] - s["Δ Hand $"])
        s["Hand rows SPOT>0"] = sum(1 for r in rs if r["SPOT Hand Strip $"] + r["SPOT Hand Glue/Assembly $"] > 0)
        s["Hand rows iQ>0"] = sum(1 for r in rs if r["iQ Hand $"] > 0)
        summ.append(s)
        print({k: s[k] for k in ["Qty Band", "Rows", "Δ Sell %", "Δ Sell $", "Δ Print $", "Δ Cutting $", "Δ Hand $", "Δ Rest $ (board+margin+other)", "Hand rows SPOT>0", "Hand rows iQ>0"]})
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    write_sheet(wb, "Summary by Band", summ)
    write_sheet(wb, "Rows", rows, widths={"SPOT Estimate #": 24, "Component": 32, "iQ Product": 30})
    wb.save(f"{HERE}/SPOT_vs_iQuote_CostCenters.xlsx")
    print("wrote")


if __name__ == "__main__":
    main()
