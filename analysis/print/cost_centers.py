"""Full cost-center decomposition SPOT vs iQuote (every iQuote account) on the matched print rows.
SPOT = live prod engine (read-only). iQuote = 'iquote full cost centers.xlsx'."""
import json
import statistics
import sys
from collections import defaultdict

import openpyxl
import requests

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import HERE, PROD, QTY_BANDS, login, mp_items, mp_payload, single_payload, write_sheet, r2  # noqa: E402

FIELDS = ["matTotal", "matMakeready", "printDirect", "cutterDirect", "saberCost", "stripCost", "assemblyCost",
          "dieLineCost", "dieEmbedded", "freightLine", "freightEmbed", "prepressLineCost", "prepressEmbedded",
          "proofLineCost", "proofEmbedded", "miscLineCost", "overhead", "totalMfg", "itemSell", "sellTotal", "route"]

# iQuote account -> bucket
IQ_BUCKET = {
    "Paper": "Board", "Inca": "Print", "Press Raw Material": "Print",
    "Zund - Large": "Cutting", "Crest Clamshell": "Cutting", "Bobst": "Cutting",
    "Hand Stripping": "Hand finishing", "Hand Gluing": "Hand finishing", "Handwork Finishing": "Hand finishing",
    "Finishing Helper": "Hand finishing", "Finishing Raw Material": "Hand finishing",
    "Die Cost": "Die", "Freight": "Freight", "PrePress": "Prepress",
    "Outsourcing Press": "Other", "Outsourcing Finishing": "Other",
}
BUCKETS = ["Board", "Print", "Cutting", "Hand finishing", "Die", "Freight", "Prepress", "Other"]


def iq_accounts():
    wb = openpyxl.load_workbook(f"{HERE}/iquote_full_cost_centers.xlsx", read_only=True, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    h = rows[0]
    acc = {}
    for r in rows[1:]:
        d = dict(zip(h, r))
        k = (int(d["IdQuote"]), str(d["OptDesc"]), str(d["Product"]).strip(), int(d["Qty"]))
        a = acc.setdefault(k, {"buckets": defaultdict(float), "accounts": defaultdict(float)})
        try:
            c = float(d["Cost"])
        except (TypeError, ValueError):
            continue
        a["accounts"][d["CostAccountDesc"]] += c
        a["buckets"][IQ_BUCKET.get(d["CostAccountDesc"], "Other")] += c
        a["price"] = float(d["TotalPrice"])
        a["markup"] = float(d["TotalMarkup"])
        a["coverage"] = d.get("CoverageLevel")
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


def spot_buckets(c):
    f = lambda k: float(c.get(k) or 0)  # noqa: E731
    return {
        "Board": f("matTotal") + f("matMakeready"),
        "Print": f("printDirect"),
        "Cutting": f("cutterDirect") + f("saberCost"),
        "Hand finishing": f("stripCost") + f("assemblyCost"),
        "Die": f("dieLineCost") + f("dieEmbedded"),
        "Freight": f("freightLine") + f("freightEmbed"),
        "Prepress": f("prepressLineCost") + f("prepressEmbedded") + f("proofLineCost") + f("proofEmbedded"),
        "Other": f("miscLineCost") + f("overhead"),
    }


def main():
    H = login()
    quotes = json.load(open(f"{HERE}/spot_prod_quotes.json"))
    by_est = {(q.get("state") or {}).get("estNum"): q for q in quotes if (q.get("state") or {}).get("estNum")}
    matched = json.load(open(f"{HERE}/print_parity_data.json"))["matched"]
    acc = iq_accounts()
    mkey = {(m["SPOT Estimate #"], m["Component"], m["Qty"]): m for m in matched}
    have_iq = {m["IdQuote"] for m in matched if any(k[0] == m["IdQuote"] for k in acc)}
    ests = sorted({m["SPOT Estimate #"] for m in matched if m["IdQuote"] in have_iq})
    print(f"{len(ests)} SPOT quotes with full iQuote cost centers")
    rows = []
    for n, est in enumerate(ests, 1):
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
                a = acc.get((m["IdQuote"], m["iQ Option"], m["iQ Product"], m["iQ Qty"]))
                if not a:
                    continue
                sb = spot_buckets(c)
                spot_sell = float(c.get("sellTotal") or c.get("itemSell") or 0)
                spot_cost = sum(sb.values())
                iq_price, iq_markup = a["price"], a["markup"]
                iq_cost = iq_price - iq_markup
                row = {"SPOT Estimate #": est, "iQuote #": m["IdQuote"], "iQ Option": m["iQ Option"], "Component": c["Component"],
                       "iQ Product": m["iQ Product"], "Qty": c["Qty"], "Qty Band": m["Qty Band"], "SPOT Route": c.get("route"),
                       "iQ Coverage": a.get("coverage")}
                for b in BUCKETS:
                    row[f"SPOT {b}"] = r2(sb[b])
                    row[f"iQ {b}"] = r2(a["buckets"].get(b, 0))
                    row[f"Δ {b}"] = r2(sb[b] - a["buckets"].get(b, 0))
                row.update({"SPOT Cost": r2(spot_cost), "iQ Cost": r2(iq_cost), "Δ Cost": r2(spot_cost - iq_cost),
                            "SPOT Margin $": r2(spot_sell - spot_cost), "iQ Margin $": r2(iq_markup), "Δ Margin": r2(spot_sell - spot_cost - iq_markup),
                            "SPOT Margin %": round((spot_sell - spot_cost) / spot_sell * 100, 1) if spot_sell else None,
                            "iQ Margin %": round(iq_markup / iq_price * 100, 1) if iq_price else None,
                            "SPOT Sell": r2(spot_sell), "iQ Sell": r2(iq_price), "Δ Sell": r2(spot_sell - iq_price),
                            "Δ Sell %": round((spot_sell - iq_price) / iq_price * 100, 1) if iq_price else None,
                            "iQ accounts": "; ".join(f"{k}={v:.0f}" for k, v in sorted(a["accounts"].items(), key=lambda x: -x[1]))})
                rows.append(row)
        if n % 15 == 0:
            print(f"  {n}/{len(ests)}", flush=True)
    json.dump(rows, open(f"{HERE}/cost_center_rows.json", "w"))
    build(rows)


def build(rows):
    g = defaultdict(list)
    for r in rows:
        g[r["Qty Band"]].append(r)
    g["ALL"] = rows
    summ, water = [], []
    for b in [x[0] for x in QTY_BANDS] + ["ALL"]:
        rs = g.get(b)
        if not rs:
            continue
        s = {"Qty Band": b, "Rows": len(rs)}
        iq_sell = sum(r["iQ Sell"] for r in rs)
        for k in BUCKETS:
            s[f"SPOT {k}"] = r2(sum(r[f"SPOT {k}"] for r in rs))
            s[f"iQ {k}"] = r2(sum(r[f"iQ {k}"] for r in rs))
        for k in ["SPOT Cost", "iQ Cost", "SPOT Margin $", "iQ Margin $", "SPOT Sell", "iQ Sell"]:
            s[k] = r2(sum(r[k] for r in rs))
        s["SPOT Margin %"] = round(s["SPOT Margin $"] / s["SPOT Sell"] * 100, 1) if s["SPOT Sell"] else None
        s["iQ Margin %"] = round(s["iQ Margin $"] / s["iQ Sell"] * 100, 1) if s["iQ Sell"] else None
        s["Δ Sell $"] = r2(s["SPOT Sell"] - s["iQ Sell"])
        s["Δ Sell %"] = round(s["Δ Sell $"] / iq_sell * 100, 1) if iq_sell else None
        pcts = [r["Δ Sell %"] for r in rs if r["Δ Sell %"] is not None]
        s["median row Δ%"] = round(statistics.median(pcts), 1)
        s["std dev Δ%"] = round(statistics.pstdev(pcts), 1)
        s["within ±20%"] = sum(1 for p in pcts if abs(p) <= 20)
        summ.append(s)
        w = {"Qty Band": b, "Rows": len(rs), "iQ Sell": r2(iq_sell)}
        for k in BUCKETS:
            d = s[f"SPOT {k}"] - s[f"iQ {k}"]
            w[f"Δ {k} $"] = r2(d)
            w[f"Δ {k} % of iQ sell"] = round(d / iq_sell * 100, 1) if iq_sell else None
        w["Δ Margin $"] = r2(s["SPOT Margin $"] - s["iQ Margin $"])
        w["Δ Margin % of iQ sell"] = round(w["Δ Margin $"] / iq_sell * 100, 1) if iq_sell else None
        w["Δ Sell $"] = s["Δ Sell $"]
        w["Δ Sell %"] = s["Δ Sell %"]
        water.append(w)
        print(b, len(rs), "Δ Sell%", s["Δ Sell %"], {k: w[f"Δ {k} % of iQ sell"] for k in BUCKETS}, "margin", w["Δ Margin % of iQ sell"])
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "README"
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 130
    for k, v in [
        ("What", "Every matched SPOT component × qty vs its iQuote product, decomposed into cost buckets. SPOT = live prod engine; iQuote = full cost-center export (60 iQuote #s)."),
        ("Buckets", "Board = Paper | Print = Inca + Press Raw Material (ink) | Cutting = Zund + Crest + Bobst (+ SPOT saber) | Hand finishing = Hand Stripping + Hand Gluing + Handwork Finishing + Finishing Helper + Finishing Raw Material (INTENTIONALLY different in SPOT) | Die | Freight | Prepress (+ SPOT proof) | Other = outsourcing / SPOT misc + overhead."),
        ("Sell", "SPOT sellTotal (component sell incl. its share of die/freight/prepress line charges) vs iQuote product TotalPrice. iQuote Cost = TotalPrice − TotalMarkup."),
        ("Waterfall tab", "Δ per bucket expressed as % of iQuote sell, so the bucket contributions add up to the total Δ Sell %."),
    ]:
        ws.append([k, v])
    write_sheet(wb, "Waterfall by Band", water)
    write_sheet(wb, "Summary by Band", summ)
    write_sheet(wb, "Rows", rows, widths={"SPOT Estimate #": 24, "Component": 32, "iQ Product": 30, "iQ accounts": 60})
    wb.save(f"{HERE}/SPOT_vs_iQuote_CostCenters.xlsx")
    print("wrote")


if __name__ == "__main__":
    if "--rebuild" in sys.argv:
        build(json.load(open(f"{HERE}/cost_center_rows.json")))
    else:
        main()
