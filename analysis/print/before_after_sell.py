"""BEFORE / AFTER on final SELL price — SPOT (prod engine, read-only) vs iQuote.

'After' = proposed print settings emulated through the engine's existing per-payload
`rateOverrides` hook (no code / no admin change):
  speed by finish 144/102, $319/hr, 7 min setup per pass  -> per-row effective incaRate
  2-sided = full second pass                              -> side2PrintFactor 1.0
  ink Standard $0.024 / Heavy $0.06 (iQuote coverage)     -> regularInkRate
Sheet selection is re-checked so the emulated rate never changes the layout silently.
"""
import json
import statistics
import sys
from collections import defaultdict

import openpyxl
import requests
from openpyxl.styles import Font

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import (HERE, PROD, QTY_BANDS, band, login, mp_items, mp_payload,  # noqa: E402
                                single_payload, write_sheet, r2)

import os
_SC = os.environ.get("SCENARIO", "iquote")
if _SC == "actuals":
    NEW_SPEED = {"Satin": 50, "Gloss": 50}
    NEW_RATE = 319.0
    SETUP_MIN = 10
    INK_STD, INK_HEAVY = 0.03, 0.03
else:
    NEW_SPEED = {"Satin": 144, "Gloss": 102}
    NEW_RATE = 319.0
    SETUP_MIN = 7
    INK_STD, INK_HEAVY = 0.024, 0.06
OLD_SPEED = 75
OUT_TAG = "" if _SC == "iquote" else f"_{_SC}"


def coverage_map():
    wb = openpyxl.load_workbook(f"{HERE}/ink_coverages_iquote.xlsx", read_only=True, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    h = rows[0]
    out = {}
    for r in rows[1:]:
        d = dict(zip(h, r))
        out[(d["IdQuote"], str(d["OptDesc"]), str(d["Product"]).strip())] = d["CoverageLevel"]
    return out


def eff_inca_rate(run_sheets, mode):
    if not run_sheets:
        return NEW_RATE
    target = run_sheets / NEW_SPEED.get(mode, OLD_SPEED) * NEW_RATE + SETUP_MIN / 60 * NEW_RATE
    return target * OLD_SPEED / run_sheets


def run_slot(H, q, qty_idx, overrides_by_item=None):
    """Run one qty slot. Returns (slot_total_sell, [component rows])."""
    state = q["state"]
    qid = None  # no saved-quote rate freeze -> live admin rates for BOTH runs, so payload rateOverrides are honoured
    is_mp = state.get("quoteType") == "Multi-Part" and bool(state.get("bomItems"))
    if is_mp:
        p = mp_payload(state, qid)
        qv = (state.get("qtys") or [])[qty_idx]
        p["qtys"] = [str(qv)]
        if overrides_by_item:
            for i, it in enumerate(p["bomItems"]):
                if i in overrides_by_item:
                    it["state"] = {**(it.get("state") or {}), "rateOverrides": overrides_by_item[i]}
        r = requests.post(f"{PROD}/api/engine/calculate-multi-part", headers=H, json=p, timeout=120)
        r.raise_for_status()
        slot = (r.json().get("slots") or [None])[0]
        if not slot:
            return None, []
        items = mp_items(state)
        rows = []
        for pc in slot.get("perComponent") or []:
            if pc.get("error") or not pc.get("qty"):
                continue
            idx = next((i for i, it in enumerate(items) if it.get("id") == pc.get("itemId")), None)
            st = (items[idx].get("state") or {}) if idx is not None else {}
            rows.append(_row(idx, items[idx].get("desc") if idx is not None else pc.get("desc"), pc, st))
        return float(slot.get("sellTotal") or 0), rows
    qv = (state.get("qtys") or [])[qty_idx]
    qty = int(float(qv))
    p = single_payload(state, state, qty, qid)
    if overrides_by_item and 0 in overrides_by_item:
        p["rateOverrides"] = overrides_by_item[0]
    r = requests.post(f"{PROD}/api/engine/calculate-all", headers=H, json=p, timeout=60)
    r.raise_for_status()
    res = (r.json().get("results") or [None])[0]
    if not res or res.get("error"):
        return None, []
    row = _row(0, state.get("itemDesc") or "Item", res, state)
    return float(res.get("itemSell") or 0), [row]


def _row(idx, desc, pc, st):
    return {"idx": idx, "Component": desc, "Qty": int(pc.get("qty") or 0),
            "printOn": (st.get("printReq") or "Yes") != "No" and float(pc.get("printDirect") or 0) > 0,
            "mode": st.get("printMode") or "Satin", "sides": st.get("printSides") or "1-Sided",
            "sheets": pc.get("sheetsReq") or 0, "mk": pc.get("mkSheets") or 0, "spoil": pc.get("spoilSheets") or 0,
            "sheetW": pc.get("sheetW"), "sheetL": pc.get("sheetL"), "route": pc.get("route"),
            "printDirect": float(pc.get("printDirect") or 0), "totalMfg": float(pc.get("totalMfg") or 0),
            "itemSell": float(pc.get("itemSell") or 0)}


def main():
    H = login()
    quotes = {q["id"]: q for q in json.load(open(f"{HERE}/spot_prod_quotes.json"))}
    by_est = {}
    for q in quotes.values():
        est = (q.get("state") or {}).get("estNum") or q.get("est_num")
        if est:
            by_est[est] = q
    matched = json.load(open(f"{HERE}/print_parity_data.json"))["matched"]
    cov = coverage_map()
    mkey = {(m["SPOT Estimate #"], m["Component"], m["Qty"]): m for m in matched}
    ests = sorted({m["SPOT Estimate #"] for m in matched})
    print(f"{len(ests)} SPOT quotes to replay before/after")

    comp_rows, slot_rows, flags = [], [], []
    for n, est in enumerate(ests, 1):
        q = by_est.get(est)
        if not q:
            flags.append({"Estimate": est, "issue": "quote not found in prod dump"})
            continue
        state = q["state"]
        for qi, qv in enumerate(state.get("qtys") or []):
            try:
                if int(float(qv)) <= 0:
                    continue
            except (TypeError, ValueError):
                continue
            try:
                before_total, before = run_slot(H, q, qi)
                if before_total is None:
                    continue
                # coverage per component from the matched iQuote product
                ov = {}
                for b in before:
                    if not b["printOn"]:
                        continue
                    m = mkey.get((est, b["Component"], b["Qty"]))
                    level = cov.get((m["IdQuote"], m["iQ Option"], m["iQ Product"])) if m else None
                    ink = INK_HEAVY if level == "Heavy" else INK_STD
                    run_sheets = b["sheets"] + b["mk"] + b["spoil"]
                    ov[b["idx"]] = {"incaRate": eff_inca_rate(run_sheets, b["mode"]), "side2PrintFactor": 1.0,
                                    "regularInkRate": ink, "_cov": level or "n/a"}
                clean = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in ov.items()}
                after_total, after = run_slot(H, q, qi, clean)
                # re-check layout: if the emulated rate moved sheet selection, recompute from the new sheets once
                amap = {a["idx"]: a for a in after}
                moved = [b for b in before if b["printOn"] and amap.get(b["idx"]) and amap[b["idx"]]["sheets"] != b["sheets"]]
                if moved:
                    for b in moved:
                        a = amap[b["idx"]]
                        clean[b["idx"]]["incaRate"] = eff_inca_rate(a["sheets"] + a["mk"] + a["spoil"], b["mode"])
                    after_total, after = run_slot(H, q, qi, clean)
                    amap = {a["idx"]: a for a in after}
                    for b in moved:
                        flags.append({"Estimate": est, "Component": b["Component"], "Qty": b["Qty"],
                                      "issue": f"sheet selection moved {b['sheets']} -> {amap[b['idx']]['sheets']} under new rates (kept)"})
            except Exception as e:  # noqa
                flags.append({"Estimate": est, "issue": f"{type(e).__name__}: {e}"})
                continue

            iq_ids = set()
            slot_iq_sell, slot_matched_before, slot_matched_after, n_print, n_matched = 0.0, 0.0, 0.0, 0, 0
            for b in before:
                a = amap.get(b["idx"])
                if not a:
                    continue
                m = mkey.get((est, b["Component"], b["Qty"]))
                if b["printOn"]:
                    n_print += 1
                row = {"SPOT Estimate #": est, "Component": b["Component"], "Qty": b["Qty"], "Qty Band": band(b["Qty"]),
                       "Print in SPOT": "Yes" if b["printOn"] else "No", "Print Mode": b["mode"], "Sides": b["sides"],
                       "Route": b["route"], "Sheets before": b["sheets"], "Sheets after": a["sheets"],
                       "Ink coverage (iQ)": (ov.get(b["idx"]) or {}).get("_cov", ""),
                       "Print $ before": r2(b["printDirect"]), "Print $ after": r2(a["printDirect"]),
                       "Cost before": r2(b["totalMfg"]), "Cost after": r2(a["totalMfg"]),
                       "Sell before": r2(b["itemSell"]), "Sell after": r2(a["itemSell"]),
                       "Sell Δ $": r2(a["itemSell"] - b["itemSell"]),
                       "Sell Δ %": round((a["itemSell"] - b["itemSell"]) / b["itemSell"] * 100, 1) if b["itemSell"] else None}
                if m:
                    n_matched += 1
                    iq_ids.add(m["IdQuote"])
                    iq_sell = m["iQ Product Price $"] or 0
                    row.update({"iQuote #": m["IdQuote"], "iQ Option": m["iQ Option"], "iQ Product": m["iQ Product"],
                                "iQ Print $": m["iQ Print $"], "iQ Sell $": iq_sell,
                                "vs iQ before %": round((b["itemSell"] - iq_sell) / iq_sell * 100, 1) if iq_sell else None,
                                "vs iQ after %": round((a["itemSell"] - iq_sell) / iq_sell * 100, 1) if iq_sell else None})
                    slot_iq_sell += iq_sell
                    slot_matched_before += b["itemSell"]
                    slot_matched_after += a["itemSell"]
                comp_rows.append(row)
            if n_matched:
                slot_rows.append({"SPOT Estimate #": est, "iQuote #": ", ".join(str(i) for i in sorted(iq_ids)),
                                  "Qty slot": int(float(qv)), "Qty Band": band(int(float(qv))),
                                  "Components": len(before), "Printed": n_print, "Matched to iQ": n_matched,
                                  "Coverage": "full" if n_matched == len(before) else "partial",
                                  "Quote total before": r2(before_total), "Quote total after": r2(after_total),
                                  "Quote Δ %": round((after_total - before_total) / before_total * 100, 1) if before_total else None,
                                  "Matched comps sell before": r2(slot_matched_before), "Matched comps sell after": r2(slot_matched_after),
                                  "iQ sell (matched products)": r2(slot_iq_sell),
                                  "vs iQ before %": round((slot_matched_before - slot_iq_sell) / slot_iq_sell * 100, 1) if slot_iq_sell else None,
                                  "vs iQ after %": round((slot_matched_after - slot_iq_sell) / slot_iq_sell * 100, 1) if slot_iq_sell else None})
        if n % 15 == 0:
            print(f"  {n}/{len(ests)}", flush=True)

    json.dump({"comp": comp_rows, "slot": slot_rows, "flags": flags}, open(f"{HERE}/before_after_data{OUT_TAG}.json", "w"))
    build_workbook(comp_rows, slot_rows, flags)


def _stats(rs, key_b, key_a):
    vb = [r[key_b] for r in rs if r.get(key_b) is not None]
    va = [r[key_a] for r in rs if r.get(key_a) is not None]
    def s(v):
        if not v:
            return {}
        return {"median Δ%": round(statistics.median(v), 1), "mean |Δ%|": round(sum(abs(x) for x in v) / len(v), 1),
                "std dev Δ%": round(statistics.pstdev(v), 1), "within ±10%": sum(1 for x in v if abs(x) <= 10),
                "within ±20%": sum(1 for x in v if abs(x) <= 20), "SPOT higher": sum(1 for x in v if x > 0)}
    return s(vb), s(va)


def summarize(rows, sell_b, sell_a, iq_key, pct_b, pct_a, label):
    g = defaultdict(list)
    for r in rows:
        if r.get(iq_key):
            g[r["Qty Band"]].append(r)
    out = []
    order = [b[0] for b in QTY_BANDS] + ["ALL"]
    g["ALL"] = [r for r in rows if r.get(iq_key)]
    for k in order:
        rs = g.get(k)
        if not rs:
            continue
        sb, sa = sum(r[sell_b] for r in rs), sum(r[sell_a] for r in rs)
        iq = sum(r[iq_key] for r in rs)
        stb, sta = _stats(rs, pct_b, pct_a)
        out.append({label: k, "Rows": len(rs), "SPOT sell before": r2(sb), "SPOT sell after": r2(sa), "iQ sell": r2(iq),
                    "Agg Δ% before": round((sb - iq) / iq * 100, 1) if iq else None,
                    "Agg Δ% after": round((sa - iq) / iq * 100, 1) if iq else None,
                    **{f"{kk} BEFORE": v for kk, v in stb.items()}, **{f"{kk} AFTER": v for kk, v in sta.items()}})
    return out


def build_workbook(comp_rows, slot_rows, flags):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "README"
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 130
    for k, v in [
        ("What", "Before/after on FINAL SELL for every SPOT quote that has printed components matched to iQuote. Nothing was changed in production: 'after' is the proposed print settings pushed through the live prod engine via its per-payload rate override hook."),
        ("Proposed settings", "Inca speed Satin 144 / Gloss 102 sh/hr; $319/hr; 7 min setup per pass; 2-sided = full 2nd pass; ink Standard $0.024/sqft, Heavy $0.06/sqft (Heavy taken from the iQuote estimate's coverage level, i.e. what the estimator would toggle)."),
        ("Before", "Exactly what production produces today (verified in the earlier parity run)."),
        ("Sell", "SPOT: component itemSell / slot sellTotal from the engine (margin curve applied as today). iQuote: product TotalPrice from the export."),
        ("Component Rows", "One row per component × qty. 'vs iQ' columns only where matched to an iQuote product."),
        ("Quote Slots", "One row per SPOT quote × qty slot. 'Quote total' includes ALL components (printed or not); 'Matched comps' compares only the components matched to iQuote, apples to apples. Coverage=full means every component matched."),
        ("Variability", "std dev of Δ% and the within ±10/±20% counts are the 'tightness' measures. Lower std dev / more rows within band = less customer shock."),
        ("Flags", "Rows where the emulated rate moved sheet selection (recomputed once) or replay errors."),
    ]:
        ws.append([k, v]); ws.cell(ws.max_row, 1).font = Font(bold=True)
    matched_comp = [r for r in comp_rows if r.get("iQ Sell $")]
    write_sheet(wb, "Summary Components", summarize(matched_comp, "Sell before", "Sell after", "iQ Sell $", "vs iQ before %", "vs iQ after %", "Qty Band"))
    write_sheet(wb, "Summary Quotes (matched)", summarize(slot_rows, "Matched comps sell before", "Matched comps sell after", "iQ sell (matched products)", "vs iQ before %", "vs iQ after %", "Qty Band"))
    full = [r for r in slot_rows if r["Coverage"] == "full"]
    write_sheet(wb, "Summary Quotes (full match)", summarize(full, "Quote total before", "Quote total after", "iQ sell (matched products)", "vs iQ before %", "vs iQ after %", "Qty Band"))
    write_sheet(wb, "Quote Slots", slot_rows, widths={"SPOT Estimate #": 24, "iQuote #": 16})
    write_sheet(wb, "Component Rows", comp_rows, widths={"SPOT Estimate #": 24, "Component": 34, "iQ Product": 30})
    write_sheet(wb, "Flags", flags)
    out = f"{HERE}/SPOT_vs_iQuote_Sell_BeforeAfter{OUT_TAG}.xlsx"
    wb.save(out)
    print("wrote", out, "| components", len(comp_rows), "matched", len(matched_comp), "| slots", len(slot_rows), "| flags", len(flags))
    for r in summarize(matched_comp, "Sell before", "Sell after", "iQ Sell $", "vs iQ before %", "vs iQ after %", "Qty Band"):
        print(r)


if __name__ == "__main__":
    main()
