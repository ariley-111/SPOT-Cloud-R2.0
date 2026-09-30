"""SPOT vs iQuote — PRINT cost decomposition.

Inputs : iquote_cost_breakdown.xlsx (Inca + Ink tab), spot_prod_quotes.json (prod API dump)
Engine : PRODUCTION SPOT API (read-only calculate calls) so numbers == the app.
Output : SPOT_vs_iQuote_Print.xlsx
"""
import json
import math
import os
import re
import sys
from collections import defaultdict

import openpyxl
import requests
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

PROD = "https://ai-connect-33.emergent.host"
HERE = "/app/analysis/print"
_MISSING = object()

# ---------------------------------------------------------------- iQuote model (decoded from export)
IQ_RATE = 319.0            # $/hr (209 fixed + 110 variable)
IQ_SETUP_MIN_PER_PASS = 10
IQ_WASTE_SHEETS = 2        # setup waste, charged as board, not press time (3 on 2-pass jobs)
IQ_SPEED = {"Satin": 144, "Gloss": 102}
IQ_INK_MEDIAN = 0.047      # $/sqft/pass (coverage based; median across export)

# ---------------------------------------------------------------- SPOT model (engine/pricing.py)
SP_RATE = 485.0
SP_SPEED = {"Gloss": 75, "Satin": 75, "OnQ Styrene": 50, "OnQ Lightbox": 40}
SP_MR = 5
SP_MR_WHITE = 15
SP_SPOIL = 0.02
SP_INK = 0.05
SP_WHITE_FACTOR = 0.5
SP_SIDE2 = 0.6

QTY_BANDS = [("1-49", 1, 49), ("50-199", 50, 199), ("200-999", 200, 999),
             ("1000-4999", 1000, 4999), ("5000+", 5000, 10 ** 12)]


def band(q):
    for lab, lo, hi in QTY_BANDS:
        if lo <= (q or 0) <= hi:
            return lab
    return "n/a"


def f(v):
    if v in (None, "NULL", ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def r2(x):
    return round(float(x or 0), 2)


# ---------------------------------------------------------------- SPOT payload helpers (useEngine.js parity)
_MP_ITEM_KEYS = [
    "itemDesc", "boxStyle", "custIdent", "quoteMode", "oneUpW", "oneUpL", "sheetSizeW", "sheetSizeL",
    "sheetPcsPerSheet", "corrFlipped", "overrideSheetId", "qtys", "selSlot", "flute", "boardGrade",
    "outsideLiner", "insideLiner", "medium", "mediumTreatment", "fscEnabled", "fscFee", "buyMinBoard",
    "boardSubstitution", "printReq", "printMode", "printSides", "whiteInk", "colorsFront", "colorsBack",
    "routeOverride", "cadDifficulty", "cadPricingMethod", "cadMethodTouched", "totalRuleInches", "perfPct",
    "productMats", "saber", "saberCuts", "saberBlanksOut", "handStripping", "perimeterStripping",
    "strippingComplexity", "handGluing", "jointsPerPiece", "gluingComplexity", "tape", "tapeType",
    "tapeStrips", "tapeStripLength", "prepressTreatment", "prepressCost", "proofTreatment", "proofCost",
    "proofMarkup", "dieTreatment", "cuttingDieCost", "dieAmortMethod", "miscCharges", "freightType",
    "freightTreatment", "freightCost", "freightMarkup", "freightCarrier", "freightByQty", "forcedSellPc",
    "gmByTier", "sellByTier", "pricingBasis", "miscChargeMarkup",
]


def mp_items(state):
    items = [dict(it) for it in (state.get("bomItems") or [])]
    active = state.get("activeItemIdx") or 0
    if isinstance(active, int) and 0 <= active < len(items):
        merged = dict(items[active].get("state") or {})
        for k in _MP_ITEM_KEYS:
            if k in state:
                merged[k] = state[k]
        items[active] = {**items[active], "state": merged}
    return items


def mp_payload(state, quote_id):
    keys = ["quoteType", "pricingMode", "setMarginPct", "setMarginOverride", "fulfillmentMarginPct",
            "purchasedMarginPct", "qtys", "estInitials", "custName", "custCode", "custRef", "destZip",
            "quoteFOB", "freightScope", "freightAllocMethod", "jobFreightCost", "jobFreightTreatment",
            "jobFreightBySlot", "freightMarkup", "freightCarrier", "prepressScope", "prepressAllocMethod",
            "jobPrepressCost", "jobPrepressTreatment", "pricingVersionId"]
    p = {k: state[k] for k in keys if k in state and state[k] is not None}
    p.setdefault("pricingMode", "Matched Set")
    p["qtys"] = [str(x) if x is not None else "" for x in (state.get("qtys") or [])]
    p["activeItemIdx"] = state.get("activeItemIdx") or 0
    p["bomItems"] = mp_items(state)
    p["quoteId"] = quote_id
    return p


def single_payload(item_state, top, qty, quote_id):
    st = dict(item_state)
    st["qtys"] = [str(qty)]
    for k in ("estInitials", "custName", "destZip", "quoteFOB"):
        if k in top:
            st.setdefault(k, top[k])
    ro = st.get("routeOverride")
    if not ro or ro == "Auto":
        st.pop("routeOverride", None)
    if top.get("pricingVersionId"):
        st["pricingVersionId"] = top["pricingVersionId"]
    st["quoteId"] = quote_id
    return st


# ---------------------------------------------------------------- production API
def login():
    r = requests.post(f"{PROD}/api/auth/login", json={
        "email": "admin@standardprinting.com", "password": "spot-admin-2026"}, timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def engine_detail(H, payload):
    r = requests.post(f"{PROD}/api/engine/calculate-all", headers=H, json=payload, timeout=60)
    r.raise_for_status()
    res = (r.json().get("results") or [])
    return res[0] if res else {"error": "no result"}


def spot_rows(H, q):
    """One row per (component, qty) with full print detail from the engine."""
    state = q.get("state") or {}
    qid = q.get("id")
    est = state.get("estNum") or q.get("est_num") or ""
    base = {"SPOT Estimate #": est, "iQuote # (SPOT)": str(state.get("iquoteNum") or "").strip(),
            "iQuote Option (SPOT)": state.get("iquoteOption") or "", "Customer": state.get("custName") or "",
            "Project": state.get("custRef") or "", "Quote Type": state.get("quoteType") or "Simple",
            "Pricing Mode": state.get("pricingMode") or ""}
    out = []
    is_mp = state.get("quoteType") == "Multi-Part" and bool(state.get("bomItems"))
    if is_mp:
        r = requests.post(f"{PROD}/api/engine/calculate-multi-part", headers=H,
                          json=mp_payload(state, qid), timeout=120)
        r.raise_for_status()
        data = r.json()
        items = mp_items(state)
        seen = set()
        for slot in (data.get("slots") or []):
            for pc in (slot.get("perComponent") or []):
                if pc.get("error") or not pc.get("qty"):
                    continue
                idx = pc.get("itemIndex")
                if idx is None:
                    idx = next((i for i, it in enumerate(items) if it.get("id") == pc.get("itemId")), None)
                if idx is None or (idx, pc["qty"]) in seen:
                    continue
                seen.add((idx, pc["qty"]))
                item = items[idx]
                if (item.get("type") or "MFG") not in ("MFG", "Manufactured", ""):
                    continue
                det = engine_detail(H, single_payload(item.get("state") or {}, state, pc["qty"], qid))
                row = _detail_row(base, item.get("desc") or (item.get("state") or {}).get("itemDesc") or f"Item {idx+1}",
                                  pc["qty"], det, item.get("state") or {})
                row["MP printDirect xcheck Δ"] = r2(float(det.get("printDirect") or 0) - float(pc.get("printDirect") or 0))
                out.append(row)
    else:
        for qv in (state.get("qtys") or []):
            try:
                qty = int(float(qv))
            except (TypeError, ValueError):
                continue
            if qty <= 0:
                continue
            det = engine_detail(H, single_payload(state, state, qty, qid))
            row = _detail_row(base, state.get("itemDesc") or "Item", qty, det, state)
            row["MP printDirect xcheck Δ"] = 0
            out.append(row)
    return out


def _detail_row(base, desc, qty, det, st):
    return {**base, "Component": desc, "Qty": qty, "Qty Band": band(qty),
            "SPOT error": det.get("error") or "",
            "SPOT Print Req": st.get("printReq") or "Yes",
            "SPOT Print Mode": st.get("printMode") or "Satin",
            "SPOT Sides": st.get("printSides") or "1-Sided",
            "SPOT White Ink": st.get("whiteInk") or "No",
            "SPOT Route": det.get("route") or "",
            "SPOT Sheet W": det.get("sheetW"), "SPOT Sheet L": det.get("sheetL"),
            "SPOT Pcs/Sheet": det.get("pcsPerSheet"),
            "SPOT Sheets": det.get("sheetsReq"),
            "SPOT MR Sheets": det.get("mkSheets"), "SPOT Spoil Sheets": det.get("spoilSheets"),
            "SPOT Press Hrs": r2(det.get("pressHrs")) if det.get("pressHrs") is not None else None,
            "SPOT Press $": r2(det.get("pressCost")), "SPOT Ink $": r2(det.get("inkCost")),
            "SPOT White $": r2(det.get("whiteCost")), "SPOT Side2 $": r2(det.get("side2Cost")),
            "SPOT Print $": r2(det.get("printDirect")),
            "SPOT Total Cost": r2(det.get("totalMfg")), "SPOT Sell": r2(det.get("itemSell"))}


# ---------------------------------------------------------------- iQuote load
def load_iquote():
    wb = openpyxl.load_workbook(f"{HERE}/iquote_cost_breakdown.xlsx", read_only=True, data_only=True)
    ws = wb["Inca + Ink Cost Raw Data"]
    rows = list(ws.iter_rows(values_only=True))
    h = rows[0]
    recs = [dict(zip(h, r)) for r in rows[1:]]
    key = lambda r: (int(r["IdQuote"]), str(r["OptDesc"]), str(r["Product"]).strip(), int(r["Qty"]))
    inca = {key(r): r for r in recs if r["CostAccountDesc"] == "Inca"}
    ink = {key(r): r for r in recs if r["CostAccountDesc"] == "Press Raw Material"}
    out = []
    for k, r in inca.items():
        i = ink.get(k, {})
        passes = int(r["ProcessCount"] or 1)
        speed = f(r["RunSpeed"]) or 0
        run_min = f(r["EngRunTime"]) or 0
        gross = f(r["GrossSheets"]) or 0
        net = run_min * speed / 60 / passes if speed else None
        w, l = f(r["MaterialWidth"]) or 0, f(r["MaterialLength"]) or 0
        sqft = w * l / 144
        ink_cost = f(i.get("Cost")) or 0
        out.append({
            "IdQuote": k[0], "iQ Option": k[1], "iQ Product": k[2], "iQ Qty": k[3],
            "iQ Status": r["Status"], "iQ Customer": r["Customer"], "iQ Desc": r["QuoteDesc"],
            "iQ Sheet W": w, "iQ Sheet L": l, "iQ Basis": r["BasisWeight"], "iQ Flute": r["Flute"],
            "iQ Finish": r["Finish"], "iQ NumberUp": r["NumberUp"], "iQ Gross Sheets": gross,
            "iQ Net Sheets (run)": round(net, 2) if net is not None else None,
            "iQ Waste Sheets": round(gross - net, 2) if net is not None else None,
            "iQ Passes": passes, "iQ Speed sh/hr": speed, "iQ Setup Hrs": r2(f(r["EstSetupHours"])),
            "iQ Run Hrs": r2(f(r["EstRunHours"])), "iQ $/hr": r2(f(r["CostPerHour"])),
            "iQ Press $": r2(f(r["Cost"])), "iQ Ink $": r2(ink_cost),
            "iQ Ink $/sqft/pass": round(ink_cost / (gross * sqft) / passes, 4) if gross and sqft else None,
            "iQ Print $": r2((f(r["Cost"]) or 0) + ink_cost),
            "iQ Process": r["ProcessDesc"], "iQ Ganged": gross != int(gross) if gross else False,
            "iQ Est Total $": r2(f(r["TotalEstimatePrice"])), "iQ Product Price $": r2(f(r["TotalPrice"])),
        })
    return out


# ---------------------------------------------------------------- matching
_STOP = {"the", "and", "of", "a", "w", "with", "x", "-", "&", "for", "version", "ver", "v"}


def toks(s):
    return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if t and t not in _STOP}


def sim(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def match_quote(spot, iq):
    """Greedy one-to-one match inside a single iQuote #."""
    pairs = []
    for si, s in enumerate(spot):
        for ii, i in enumerate(iq):
            sq, iqq = s["Qty"], i["iQ Qty"]
            if sq == iqq:
                qs = 3.0
            elif iqq and abs(sq - iqq) / iqq <= 0.10:
                qs = 1.5
            else:
                qs = 0.0
            ds = sim(s["Component"], i["iQ Product"])
            opt = 0.5 if (s["iQuote Option (SPOT)"] and str(s["iQuote Option (SPOT)"]).lower() in str(i["iQ Option"]).lower()) else 0
            score = qs + ds + opt
            if qs > 0:
                pairs.append((score, si, ii, qs, ds))
    pairs.sort(reverse=True)
    used_s, used_i, out = set(), set(), []
    for score, si, ii, qs, ds in pairs:
        if si in used_s or ii in used_i:
            continue
        used_s.add(si); used_i.add(ii)
        conf = "exact qty" if qs == 3 else ("qty ±10%" if qs == 1.5 else "name only")
        if ds >= 0.5:
            conf += " + name"
        out.append((si, ii, round(score, 2), conf))
    return out, [i for i in range(len(spot)) if i not in used_s], [i for i in range(len(iq)) if i not in used_i]


# ---------------------------------------------------------------- decomposition
def spot_formula(sheets, sqft, mode, white, two_sided, *, speed=None, rate=SP_RATE, mr=None,
                 spoil=SP_SPOIL, ink=SP_INK, setup_min=0.0, waste_not_run=0, passes=1):
    speed = speed or SP_SPEED.get(mode, 75)
    mr = SP_MR_WHITE if (mr is None and white) else (SP_MR if mr is None else mr)
    spoil_sheets = math.ceil(sheets * spoil) if spoil else 0
    run_sheets = sheets + mr + spoil_sheets - waste_not_run
    hrs = run_sheets / speed * passes + setup_min / 60 * passes
    press = hrs * rate
    ink_c = run_sheets * sqft * ink * passes
    white_c = SP_WHITE_FACTOR * (ink_c + press) if white else 0  # board term excluded on purpose (print-only)
    side1 = press + ink_c + white_c
    side2 = side1 * SP_SIDE2 if two_sided else 0
    return {"press": press, "ink": ink_c, "white": white_c, "side2": side2, "total": side1 + side2}


def decompose(row):
    """Waterfall from SPOT's actual print $ to iQuote's print $."""
    mode = row["SPOT Print Mode"]
    white = row["SPOT White Ink"] == "Yes"
    two = row["SPOT Sides"] == "2-Sided"
    iq_sheets = row["iQ Gross Sheets"] or 0
    iq_sqft = (row["iQ Sheet W"] or 0) * (row["iQ Sheet L"] or 0) / 144
    iq_speed = row["iQ Speed sh/hr"] or IQ_SPEED.get(row["iQ Finish"], 75)
    passes = row["iQ Passes"] or 1
    waste = int(round(row["iQ Waste Sheets"] or IQ_WASTE_SHEETS))

    spot_actual = row["SPOT Print $"] or 0
    # 1) SPOT structure at iQuote's sheet count + sheet size (layout neutralised)
    s1 = spot_formula(iq_sheets, iq_sqft, mode, white, two)["total"]
    # 2) + iQuote speed
    s2 = spot_formula(iq_sheets, iq_sqft, mode, white, two, speed=iq_speed)["total"]
    # 3) + iQuote $/hr
    s3 = spot_formula(iq_sheets, iq_sqft, mode, white, two, speed=iq_speed, rate=IQ_RATE)["total"]
    # 4) + iQuote waste model (no MR/spoil run, 10 min setup/pass, N waste sheets not run)
    s4 = spot_formula(iq_sheets, iq_sqft, mode, white, two, speed=iq_speed, rate=IQ_RATE, mr=0, spoil=0,
                      setup_min=IQ_SETUP_MIN_PER_PASS, waste_not_run=waste, passes=passes)
    s4t = s4["total"]
    # 5) + iQuote actual ink $ (coverage) instead of flat $0.05
    s5 = s4["press"] + (row["iQ Ink $"] or 0) + (s4["white"] + s4["side2"])
    iq = row["iQ Print $"] or 0
    return {
        "SPOT Print $ (actual)": r2(spot_actual),
        "SPOT @ iQ sheets": r2(s1),
        "Δ Layout/Sheets": r2(s1 - spot_actual),
        "Δ Speed (75→iQ)": r2(s2 - s1),
        "Δ Rate ($485→$319)": r2(s3 - s2),
        "Δ Waste/Setup model": r2(s4t - s3),
        "Δ Ink (flat→coverage)": r2(s5 - s4t),
        "Δ Residual (passes/white/2S)": r2(iq - s5),
        "iQ Print $": r2(iq),
        "Δ Total (SPOT−iQ) $": r2(spot_actual - iq),
        "Δ Total %": round((spot_actual - iq) / iq * 100, 1) if iq else None,
        "Δ Sheets (SPOT−iQ gross)": r2((row["SPOT Sheets"] or 0) - iq_sheets),
        "Same Sheet Size": "Yes" if (row["SPOT Sheet W"] and abs(float(row["SPOT Sheet W"]) - (row["iQ Sheet W"] or 0)) < 0.6
                                     and abs(float(row["SPOT Sheet L"]) - (row["iQ Sheet L"] or 0)) < 0.6) else "No",
        "Same Finish": "Yes" if (row["iQ Finish"] or "").lower() == mode.lower() else "No",
    }


# ---------------------------------------------------------------- workbook
HDR_FILL = PatternFill("solid", fgColor="1F3A5F")
HDR_FONT = Font(bold=True, color="FFFFFF")
SUB_FILL = PatternFill("solid", fgColor="E8EEF6")


def write_sheet(wb, title, rows, cols=None, widths=None):
    ws = wb.create_sheet(title)
    if not rows:
        ws["A1"] = "(no rows)"
        return ws
    cols = cols or list(rows[0].keys())
    ws.append(cols)
    for c in ws[1]:
        c.fill, c.font = HDR_FILL, HDR_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center")
    for r in rows:
        ws.append([r.get(c) for c in cols])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for i, c in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(c, max(10, min(28, len(str(c)) + 2)))
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            if isinstance(cell.value, float):
                cell.number_format = "#,##0.00"
    return ws


def summarize(rows, key):
    groups = defaultdict(list)
    for r in rows:
        groups[r[key]].append(r)
    out = []
    order = [b[0] for b in QTY_BANDS] if key == "Qty Band" else sorted(groups)
    for g in order:
        rs = groups.get(g)
        if not rs:
            continue
        sp = sum(r["SPOT Print $ (actual)"] for r in rs)
        iq = sum(r["iQ Print $"] for r in rs)
        pcts = sorted(r["Δ Total %"] for r in rs if r["Δ Total %"] is not None)
        med = pcts[len(pcts) // 2] if pcts else None
        out.append({
            key: g, "Rows": len(rs),
            "SPOT Print $": r2(sp), "iQ Print $": r2(iq), "Δ $": r2(sp - iq),
            "Δ % (aggregate)": round((sp - iq) / iq * 100, 1) if iq else None,
            "Δ % (median row)": med,
            "Rows SPOT higher": sum(1 for r in rs if r["Δ Total (SPOT−iQ) $"] > 0),
            "Rows SPOT lower": sum(1 for r in rs if r["Δ Total (SPOT−iQ) $"] < 0),
            "Σ Δ Layout/Sheets": r2(sum(r["Δ Layout/Sheets"] for r in rs)),
            "Σ Δ Speed": r2(sum(r["Δ Speed (75→iQ)"] for r in rs)),
            "Σ Δ Rate": r2(sum(r["Δ Rate ($485→$319)"] for r in rs)),
            "Σ Δ Waste/Setup": r2(sum(r["Δ Waste/Setup model"] for r in rs)),
            "Σ Δ Ink": r2(sum(r["Δ Ink (flat→coverage)"] for r in rs)),
            "Σ Δ Residual": r2(sum(r["Δ Residual (passes/white/2S)"] for r in rs)),
            "Same sheet size %": round(100 * sum(1 for r in rs if r["Same Sheet Size"] == "Yes") / len(rs)),
        })
    return out


def rate_fit(rows):
    """Grid-search SPOT speed (per finish) + $/hr that minimise |Δ| vs iQuote, keeping SPOT's structure."""
    out = []
    for fin in ("Satin", "Gloss"):
        rs = [r for r in rows if r["SPOT Print Mode"] == fin and r["Same Finish"] == "Yes" and r["iQ Print $"] > 0]
        if not rs:
            continue
        best = None
        for speed in range(60, 260, 5):  # $/hr held at $485 — press $ depends only on rate/speed ratio
            err = 0.0
            for r in rs:
                sq = (r["iQ Sheet W"] or 0) * (r["iQ Sheet L"] or 0) / 144
                est = spot_formula(r["iQ Gross Sheets"] or 0, sq, fin, r["SPOT White Ink"] == "Yes",
                                   r["SPOT Sides"] == "2-Sided", speed=speed)["total"]
                err += abs(est - r["iQ Print $"]) / r["iQ Print $"]
            mape = err / len(rs) * 100
            if best is None or mape < best[0]:
                best = (mape, speed)
        cur = sum(abs(r["SPOT @ iQ sheets"] - r["iQ Print $"]) / r["iQ Print $"] for r in rs) / len(rs) * 100
        out.append({"Finish": fin, "Rows": len(rs), "Current SPOT speed": SP_SPEED[fin], "SPOT $/hr (held)": SP_RATE,
                    "Current SPOT press $/sheet": round(SP_RATE / SP_SPEED[fin], 2),
                    "Current MAPE % (@ iQ sheets)": round(cur, 1),
                    "Best-fit speed sh/hr": best[1], "Best-fit press $/sheet": round(SP_RATE / best[1], 2),
                    "Best-fit MAPE %": round(best[0], 1),
                    "iQuote speed": IQ_SPEED[fin], "iQuote $/hr": IQ_RATE,
                    "iQuote press $/sheet (run)": round(IQ_RATE / IQ_SPEED[fin], 2)})
    return out


README = [
    ("Purpose", "Print-only cost parity: SPOT (production engine, live re-run) vs iQuote Inca press + ink cost account."),
    ("SPOT source", f"{PROD} — every quote with an iQuote # was re-run through /api/engine (read-only). Numbers equal the app."),
    ("iQuote source", "iquote cost breakdown analysis.xlsx → 'Inca + Ink Cost Raw Data' (Inca = press, Press Raw Material = ink)."),
    ("Join", "iQuote # (SPOT field) = IdQuote; then per component: exact qty (3 pts) or qty ±10% (1.5) required; product-name token similarity breaks ties; 1-to-1 greedy within a quote. 'Match Confidence' says which rule fired."),
    ("iQuote press model (decoded)", "run time = (GrossSheets − ~2 waste) ÷ speed × passes; speed Satin 144 / Gloss 102 sh/hr; setup 10 min per pass; $319/hr; ink separate, coverage-based (~$0.047/sqft/pass median)."),
    ("SPOT press model", "run sheets = sheets + 5 MR (15 white) + ceil(2%) spoil; hrs = run sheets ÷ 75 sh/hr; $485/hr; ink flat $0.05/sqft × run sheets; white +50%; 2-sided +60%. No setup time."),
    ("Waterfall (Matched Rows)", "SPOT actual → [Δ Layout/Sheets] SPOT formula at iQuote's sheet count & size → [Δ Speed] 75→iQ speed → [Δ Rate] $485→$319 → [Δ Waste/Setup] MR+spoil-run-through-press → 2 waste + 10 min setup → [Δ Ink] flat $0.05 → iQuote actual ink → [Δ Residual] passes/white/2-sided differences → iQuote actual. Steps are sequential; signs: positive = that step raises cost."),
    ("Δ Total", "SPOT Print $ − iQ Print $ (positive = SPOT higher)."),
    ("Rate Fit", "Grid search of SPOT speed + $/hr (keeping SPOT's MR/spoil/ink structure) that minimises mean |Δ%| vs iQuote, per finish, at iQuote's sheet count. Decision-support only."),
    ("Caveats", "iQ Ganged = fractional GrossSheets (versions ganged on shared sheets) — SPOT does not gang; treat those rows with care. 'Same Sheet Size = No' rows include a layout decision difference. Rows where SPOT has no print (printReq=No) are listed in 'SPOT no print'."),
]


def main():
    H = login()
    quotes = json.load(open(f"{HERE}/spot_prod_quotes.json"))
    iq_rows = load_iquote()
    iq_by_id = defaultdict(list)
    for r in iq_rows:
        iq_by_id[r["IdQuote"]].append(r)

    spot_by_id = defaultdict(list)
    errors = []
    cache_path = f"{HERE}/spot_replay_cache.json"
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) and "--refresh" not in sys.argv else {}
    todo = [q for q in quotes if str((q.get("state") or {}).get("iquoteNum") or "").strip().rstrip(".0").isdigit()]
    print(f"{len(todo)} SPOT quotes with iQuote #; {len(iq_by_id)} iQuote ids with print rows")
    for n, q in enumerate(todo, 1):
        iqn = int(float(str(q["state"]["iquoteNum"]).strip()))
        if iqn not in iq_by_id:
            continue
        if q["id"] in cache:
            spot_by_id[iqn].extend(cache[q["id"]])
            continue
        try:
            rows = spot_rows(H, q)
        except Exception as e:  # noqa
            errors.append({"SPOT Estimate #": q["state"].get("estNum"), "iQuote #": iqn, "error": f"{type(e).__name__}: {e}"})
            continue
        cache[q["id"]] = rows
        spot_by_id[iqn].extend(rows)
        if n % 20 == 0:
            print(f"  {n}/{len(todo)} quotes replayed", flush=True)
    json.dump(cache, open(cache_path, "w"))

    matched, un_spot, un_iq, no_print = [], [], [], []
    for iqn, iqs in iq_by_id.items():
        sp_all = spot_by_id.get(iqn, [])
        sp = [r for r in sp_all if r["SPOT Print Req"] != "No" and not r["SPOT error"]]
        no_print += [r for r in sp_all if r["SPOT Print Req"] == "No" or r["SPOT error"]]
        if not sp:
            un_iq += [{**i, "Reason": "no SPOT quote replayed for this iQuote #" if not sp_all else "SPOT components have no print"} for i in iqs]
            continue
        pairs, us, ui = match_quote(sp, iqs)
        for si, ii, score, conf in pairs:
            row = {**sp[si], **iqs[ii], "Match Score": score, "Match Confidence": conf}
            row.update(decompose(row))
            matched.append(row)
        un_spot += [{**sp[i], "Reason": "no iQuote product with compatible qty/name"} for i in us]
        un_iq += [{**iqs[i], "Reason": "no SPOT component with compatible qty/name"} for i in ui]

    matched.sort(key=lambda r: (r["IdQuote"], r["iQ Qty"], r["Component"]))
    print(f"matched {len(matched)} rows · unmatched SPOT {len(un_spot)} · unmatched iQuote {len(un_iq)} · SPOT no-print {len(no_print)} · errors {len(errors)}")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "README"
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 140
    for k, v in README:
        ws.append([k, v])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
        ws.cell(ws.max_row, 2).alignment = Alignment(wrap_text=True, vertical="top")
    ws.append([]); ws.append(["Matched rows", len(matched)]); ws.append(["Unmatched SPOT rows", len(un_spot)])
    ws.append(["Unmatched iQuote rows", len(un_iq)]); ws.append(["SPOT rows w/o print", len(no_print)]); ws.append(["Replay errors", len(errors)])

    write_sheet(wb, "Summary by Qty Band", summarize(matched, "Qty Band"))
    write_sheet(wb, "Summary by Finish", summarize(matched, "SPOT Print Mode"))
    clean = [r for r in matched if not r["iQ Ganged"] and r["Same Finish"] == "Yes"]
    write_sheet(wb, "Summary (clean rows)", summarize(clean, "Qty Band"))
    write_sheet(wb, "Rate Fit", rate_fit([r for r in matched if not r["iQ Ganged"]]))

    cols = ["SPOT Estimate #", "IdQuote", "iQ Option", "Customer", "Project", "Quote Type", "Pricing Mode",
            "Component", "iQ Product", "Match Confidence", "Match Score", "Qty", "iQ Qty", "Qty Band",
            "SPOT Print Mode", "iQ Finish", "Same Finish", "SPOT Sides", "SPOT White Ink", "iQ Passes", "iQ Process",
            "SPOT Route", "SPOT Sheet W", "SPOT Sheet L", "iQ Sheet W", "iQ Sheet L", "Same Sheet Size",
            "SPOT Pcs/Sheet", "iQ NumberUp", "SPOT Sheets", "iQ Gross Sheets", "iQ Net Sheets (run)", "Δ Sheets (SPOT−iQ gross)",
            "SPOT MR Sheets", "SPOT Spoil Sheets", "iQ Waste Sheets",
            "SPOT Press Hrs", "iQ Setup Hrs", "iQ Run Hrs", "iQ Speed sh/hr", "iQ $/hr",
            "SPOT Press $", "iQ Press $", "SPOT Ink $", "iQ Ink $", "iQ Ink $/sqft/pass", "SPOT White $", "SPOT Side2 $",
            "SPOT Print $ (actual)", "SPOT @ iQ sheets", "Δ Layout/Sheets", "Δ Speed (75→iQ)", "Δ Rate ($485→$319)",
            "Δ Waste/Setup model", "Δ Ink (flat→coverage)", "Δ Residual (passes/white/2S)", "iQ Print $",
            "Δ Total (SPOT−iQ) $", "Δ Total %", "iQ Ganged", "iQ Status", "SPOT Total Cost", "SPOT Sell",
            "iQ Product Price $", "iQ Est Total $", "MP printDirect xcheck Δ"]
    write_sheet(wb, "Matched Rows", matched, cols, {"Component": 34, "iQ Product": 34, "Project": 40, "Customer": 28})
    write_sheet(wb, "Unmatched SPOT", un_spot)
    write_sheet(wb, "Unmatched iQuote", un_iq)
    write_sheet(wb, "SPOT no print", no_print)
    write_sheet(wb, "Replay errors", errors)
    out = f"{HERE}/SPOT_vs_iQuote_Print.xlsx"
    wb.save(out)
    json.dump({"matched": matched, "un_spot": un_spot, "un_iq": un_iq}, open(f"{HERE}/print_parity_data.json", "w"), default=str)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
