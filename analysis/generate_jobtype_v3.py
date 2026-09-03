"""
SPOT vs iQuote — Component-Level Job Type × Qty Band Variance Analysis (v3, CORRECTED)

Fixes v2's broken join:
- Groups components by quote, sorts both sides by (qty desc, price desc), pairs positionally.
- Applies user-specified overrides for the 4 known ambiguous quotes.
- Classifies each SPOT component via cost signals from spot_full.xlsx.

Output: /app/backend/static_assets/SPOT_JobType_Variance_v3.xlsx
Also copies to /app/analysis/.
"""
from __future__ import annotations
import os
import shutil
import statistics
from collections import defaultdict
from typing import Any

import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

# ------------------------------------------------------------------------ paths
ANALYSIS_DIR = "/app/analysis"
STATIC_DIR = "/app/backend/static_assets"
INPUT_XLSX = os.path.join(ANALYSIS_DIR, "input.xlsx")
SPOT_FULL_XLSX = os.path.join(ANALYSIS_DIR, "spot_full.xlsx")
OUT_FILE = "SPOT_JobType_Variance_v3.xlsx"

# ------------------------------------------------------------------------ config
QTY_BANDS = [
    ("1-49", 1, 49),
    ("50-199", 50, 199),
    ("200-999", 200, 999),
    ("1000-4999", 1000, 4999),
    ("5000+", 5000, 10**12),
]

JOB_TYPES = ["Cut Only", "Print + Cut", "Print + Cut + Finishing"]

# User overrides ------------------------------------------------------------
# 223864: drop iQuote rows with qty in {800, 1600} (estimator skipped in SPOT)
DROP_IQUOTE_ROWS = {
    223864: [800, 1600],
    224377: [68],  # HSC Bin — SPOT didn't price qty=68
}
# 222971: SPOT qty 520 == iQuote qty 521 (hard proofs)
IQUOTE_QTY_REMAP = {
    222971: {521: 520},
}
# 224322: SPOT row (W=46.375, Board 250 C) qty should be 315 not 600
SPOT_QTY_OVERRIDE = {
    # (iQuote #, W match) -> new qty
    (224322, 46.375): 315,
}


def gt0(x: Any) -> bool:
    return isinstance(x, (int, float)) and x > 0


def classify(print_cost: Any, strip_cost: Any, glue_cost: Any, tape_cost: Any) -> str:
    has_print = gt0(print_cost)
    has_finish = gt0(strip_cost) or gt0(glue_cost) or gt0(tape_cost)
    if not has_print:
        return "Cut Only"
    if has_print and not has_finish:
        return "Print + Cut"
    return "Print + Cut + Finishing"


def qty_band(qty: int) -> str:
    for label, lo, hi in QTY_BANDS:
        if lo <= qty <= hi:
            return label
    return "n/a"


# ---------------------------------------------------------------- data loading
def load_data():
    wb1 = openpyxl.load_workbook(INPUT_XLSX, data_only=True)
    sp = wb1["SPOT Data"]; iq = wb1["iQuote Data"]
    sph = [c.value for c in sp[1]]; iqh = [c.value for c in iq[1]]
    sp_data = [dict(zip(sph, r)) for r in sp.iter_rows(min_row=2, values_only=True)]
    iq_data = [dict(zip(iqh, r)) for r in iq.iter_rows(min_row=2, values_only=True)]

    wb2 = openpyxl.load_workbook(SPOT_FULL_XLSX, data_only=True)
    ws = wb2["Testing Comparison"]
    h = [c.value for c in ws[1]]
    sf_data = [dict(zip(h, r)) for r in ws.iter_rows(min_row=2, values_only=True)]

    # Cost-signal lookup: (iQuote #, W, L) -> list[spot_full rows]
    cost_lookup = defaultdict(list)
    for r in sf_data:
        try:
            q = int(r["iQuote #"]) if r["iQuote #"] is not None else None
        except (ValueError, TypeError):
            q = None
        if q is None:
            continue
        cost_lookup[(q, r.get("One-Up W"), r.get("One-Up L"))].append(r)
    return sp_data, iq_data, cost_lookup


def apply_overrides(sp_data, iq_data):
    # SPOT qty override
    for r in sp_data:
        q = r.get("iQuote Estimate #")
        w = r.get("Width")
        if (q, w) in SPOT_QTY_OVERRIDE:
            r["Qty"] = SPOT_QTY_OVERRIDE[(q, w)]

    # iQuote qty remap
    for r in iq_data:
        q = r.get("IdQuote")
        remap = IQUOTE_QTY_REMAP.get(q, {})
        old = r.get("Quantity")
        if old in remap:
            r["Quantity"] = remap[old]

    # Drop iQuote rows
    kept = []
    for r in iq_data:
        q = r.get("IdQuote")
        drops = DROP_IQUOTE_ROWS.get(q, [])
        if r.get("Quantity") in drops:
            continue
        kept.append(r)
    return sp_data, kept


def build_component_pairs(sp_data, iq_data, cost_lookup):
    sp_by = defaultdict(list); iq_by = defaultdict(list)
    for r in sp_data:
        if r.get("iQuote Estimate #"):
            sp_by[r["iQuote Estimate #"]].append(r)
    for r in iq_data:
        if r.get("IdQuote"):
            iq_by[r["IdQuote"]].append(r)

    matched_pairs = []
    unmatched_rows = []

    for q in sp_by:
        srows = sp_by[q]
        irows = iq_by.get(q, [])
        s_sorted = sorted(srows, key=lambda r: (-(r.get("Qty") or 0), -(r.get("Component Total") or 0)))
        i_sorted = sorted(irows, key=lambda r: (-(r.get("Quantity") or 0), -(r.get("ComponentTotalPrice") or 0)))

        n = min(len(s_sorted), len(i_sorted))
        for k in range(n):
            s = s_sorted[k]; i = i_sorted[k]
            if s.get("Qty") != i.get("Quantity"):
                unmatched_rows.append({
                    "iQuote #": q,
                    "Project": s.get("Project Name"),
                    "Reason": f"Qty mismatch: SPOT={s.get('Qty')} iQuote={i.get('Quantity')}",
                    "SPOT $": s.get("Component Total"),
                    "iQuote $": i.get("ComponentTotalPrice"),
                })
                continue
            # Cost signal lookup
            sf_rows = cost_lookup.get((q, s.get("Width"), s.get("Length")), [])
            print_cost = max((r.get("Print Cost") or 0) for r in sf_rows) if sf_rows else 0
            strip_cost = max((r.get("Strip Cost") or 0) for r in sf_rows) if sf_rows else 0
            glue_cost = max((r.get("Glue Cost") or 0) for r in sf_rows) if sf_rows else 0
            tape_cost = max((r.get("Tape Cost") or 0) for r in sf_rows) if sf_rows else 0
            comp_name = sf_rows[0].get("Component") if sf_rows else None

            spot_price = s.get("Component Total") or 0
            iq_price = i.get("ComponentTotalPrice") or 0
            if iq_price == 0:
                continue  # avoid div/0
            delta = spot_price - iq_price
            delta_pct = (delta / iq_price) * 100.0

            matched_pairs.append({
                "iQuote #": q,
                "SPOT Estimate #": s.get("SPOT Estimate #"),
                "Project": s.get("Project Name"),
                "Customer": s.get("Customer"),
                "Component": comp_name or i.get("Product"),
                "iQuote Product": i.get("Product"),
                "Qty": s.get("Qty"),
                "Qty Band": qty_band(s.get("Qty")),
                "SPOT $": spot_price,
                "iQuote $": iq_price,
                "Δ $": delta,
                "Δ %": delta_pct,
                "Job Type": classify(print_cost, strip_cost, glue_cost, tape_cost),
                "Print Cost": print_cost,
                "Strip Cost": strip_cost,
                "Glue Cost": glue_cost,
                "Tape Cost": tape_cost,
            })
        # Unmatched extras
        if len(s_sorted) > n:
            for s in s_sorted[n:]:
                unmatched_rows.append({
                    "iQuote #": q,
                    "Project": s.get("Project Name"),
                    "Reason": "Extra SPOT row (no iQuote counterpart)",
                    "SPOT $": s.get("Component Total"),
                    "iQuote $": None,
                })
        if len(i_sorted) > n:
            for i in i_sorted[n:]:
                unmatched_rows.append({
                    "iQuote #": q,
                    "Project": srows[0].get("Project Name") if srows else None,
                    "Reason": "Extra iQuote row (no SPOT counterpart)",
                    "SPOT $": None,
                    "iQuote $": i.get("ComponentTotalPrice"),
                })

    return matched_pairs, unmatched_rows


# --------------------------------------------------------------- workbook build
HDR_FILL = PatternFill("solid", fgColor="1F4E78")
HDR_FONT = Font(bold=True, color="FFFFFF")
SECTION_FONT = Font(bold=True, size=12, color="1F4E78")
BORDER = Border(*[Side(style="thin", color="D0D0D0")] * 4)


def apply_header(cell):
    cell.fill = HDR_FILL
    cell.font = HDR_FONT
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = BORDER


def write_summary_tab(ws, matched):
    # Group data
    by_type = defaultdict(list)
    for m in matched:
        by_type[m["Job Type"]].append(m)

    # Title
    ws.cell(row=1, column=1, value="SPOT vs iQuote Variance by Job Type × Qty Band").font = Font(bold=True, size=14, color="1F4E78")
    ws.cell(row=2, column=1, value="Component-level analysis. Job Type is determined per component from Print/Strip/Glue/Tape cost signals.").font = Font(italic=True, color="606060")

    # ---- Job Type Totals ----
    r = 4
    ws.cell(row=r, column=1, value="Component Counts by Job Type").font = SECTION_FONT
    r += 1
    for c, label in enumerate(["Job Type", "Components", "Avg Variance %", "Median Variance %"], start=1):
        cell = ws.cell(row=r, column=c, value=label); apply_header(cell)
    r += 1
    for jt in JOB_TYPES:
        rows = by_type.get(jt, [])
        pcts = [m["Δ %"] for m in rows]
        ws.cell(row=r, column=1, value=jt)
        ws.cell(row=r, column=2, value=len(rows))
        ws.cell(row=r, column=3, value=(statistics.mean(pcts) / 100.0) if pcts else None)
        ws.cell(row=r, column=4, value=(statistics.median(pcts) / 100.0) if pcts else None)
        ws.cell(row=r, column=3).number_format = "0.00%"
        ws.cell(row=r, column=4).number_format = "0.00%"
        r += 1

    # ---- Per-type × Qty band, then Combined ----
    charts_specs = []  # (title, data_start_row, data_end_row, hdr_row)

    for jt in JOB_TYPES:
        r += 1
        ws.cell(row=r, column=1, value=jt).font = SECTION_FONT
        r += 1
        hdr_row = r
        for c, label in enumerate(["Qty Band", "Count", "Avg Variance %", "Median Variance %"], start=1):
            cell = ws.cell(row=r, column=c, value=label); apply_header(cell)
        r += 1
        data_start = r
        rows = by_type.get(jt, [])
        for band_label, lo, hi in QTY_BANDS:
            band_rows = [m for m in rows if lo <= (m["Qty"] or 0) <= hi]
            pcts = [m["Δ %"] for m in band_rows]
            ws.cell(row=r, column=1, value=band_label)
            ws.cell(row=r, column=2, value=len(band_rows))
            avg_cell = ws.cell(row=r, column=3, value=(statistics.mean(pcts) / 100.0) if pcts else None)
            med_cell = ws.cell(row=r, column=4, value=(statistics.median(pcts) / 100.0) if pcts else None)
            avg_cell.number_format = "0.00%"
            med_cell.number_format = "0.00%"
            r += 1
        data_end = r - 1
        charts_specs.append((f"{jt} Avg vs Median Variance % by Qty Band", data_start, data_end, hdr_row))

    # ---- Combined Median % matrix ----
    r += 2
    ws.cell(row=r, column=1, value="Combined Median Variance % by Job Type × Qty Band").font = SECTION_FONT
    r += 1
    combined_hdr = r
    ws.cell(row=r, column=1, value="Qty Band"); apply_header(ws.cell(row=r, column=1))
    for c, jt in enumerate(JOB_TYPES, start=2):
        cell = ws.cell(row=r, column=c, value=jt); apply_header(cell)
    r += 1
    combined_start = r
    for band_label, lo, hi in QTY_BANDS:
        ws.cell(row=r, column=1, value=band_label)
        for c, jt in enumerate(JOB_TYPES, start=2):
            band_rows = [m for m in by_type.get(jt, []) if lo <= (m["Qty"] or 0) <= hi]
            pcts = [m["Δ %"] for m in band_rows]
            cell = ws.cell(row=r, column=c, value=(statistics.median(pcts) / 100.0) if pcts else None)
            cell.number_format = "0.00%"
        r += 1
    combined_end = r - 1

    # Column widths
    for col_i in range(1, 6):
        ws.column_dimensions[get_column_letter(col_i)].width = 22

    # ---- Charts ----
    # Per-job-type charts (side by side to the right, columns starting at F)
    for idx, (title, ds, de, hr) in enumerate(charts_specs):
        chart = BarChart()
        chart.type = "col"
        chart.title = title
        chart.y_axis.title = "Variance %"
        chart.x_axis.title = "Qty Band"
        chart.height = 8; chart.width = 18
        data = Reference(ws, min_col=3, max_col=4, min_row=hr, max_row=de)
        cats = Reference(ws, min_col=1, min_row=ds, max_row=de)
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        anchor_row = 5 + idx * 17
        ws.add_chart(chart, f"F{anchor_row}")

    # Combined chart
    chart = BarChart()
    chart.type = "col"
    chart.title = "Combined Median Variance % by Job Type × Qty Band"
    chart.y_axis.title = "Median Variance %"
    chart.x_axis.title = "Qty Band"
    chart.height = 8; chart.width = 18
    data = Reference(ws, min_col=2, max_col=1 + len(JOB_TYPES), min_row=combined_hdr, max_row=combined_end)
    cats = Reference(ws, min_col=1, min_row=combined_start, max_row=combined_end)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    ws.add_chart(chart, f"F{5 + 3 * 17}")


def write_detail_tab(wb, tab_name, rows):
    ws = wb.create_sheet(tab_name)
    cols = ["iQuote #", "SPOT Estimate #", "Project", "Customer", "Component", "Qty",
            "Qty Band", "SPOT $", "iQuote $", "Δ $", "Δ %", "Job Type"]
    for c, label in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=label); apply_header(cell)
    for i, row in enumerate(rows, start=2):
        for c, key in enumerate(cols, start=1):
            v = row.get(key)
            cell = ws.cell(row=i, column=c, value=v)
            if key in ("SPOT $", "iQuote $", "Δ $") and isinstance(v, (int, float)):
                cell.number_format = "$#,##0.00"
            elif key == "Δ %" and isinstance(v, (int, float)):
                cell.value = v / 100.0
                cell.number_format = "0.00%"
    # widths
    widths = [12, 20, 45, 30, 30, 8, 12, 14, 14, 14, 12, 22]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    return ws


def write_unmatched_tab(wb, rows):
    ws = wb.create_sheet("Unmatched")
    cols = ["iQuote #", "Project", "Reason", "SPOT $", "iQuote $"]
    for c, label in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=label); apply_header(cell)
    for i, row in enumerate(rows, start=2):
        for c, key in enumerate(cols, start=1):
            v = row.get(key)
            cell = ws.cell(row=i, column=c, value=v)
            if key in ("SPOT $", "iQuote $") and isinstance(v, (int, float)):
                cell.number_format = "$#,##0.00"
    widths = [12, 45, 55, 14, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def write_methodology_tab(wb, matched_count, unmatched_count):
    ws = wb.create_sheet("Methodology")
    ws["A1"] = "Methodology"
    ws["A1"].font = Font(bold=True, size=14, color="1F4E78")
    lines = [
        "",
        "PURPOSE",
        "Compare SPOT vs iQuote component-level SELL PRICES across job-type and qty buckets.",
        "",
        "DATA SOURCES",
        "  • input.xlsx (SPOT Data / iQuote Data) — clean 1:1 quote-level dataset.",
        "  • spot_full.xlsx (Testing Comparison) — all-fields SPOT dump for job-type classification.",
        "",
        "JOIN METHOD (component-level)",
        "  Step 1: Group both SPOT and iQuote rows by iQuote quote #.",
        "  Step 2: Within each quote, sort both sides by (qty desc, price desc).",
        "  Step 3: Pair positionally (row 1 ↔ row 1, row 2 ↔ row 2, …).",
        "  Step 4: Any pair whose qty doesn't match after sort → Unmatched tab.",
        "",
        "USER-SPECIFIED OVERRIDES",
        "  • Quote 223864: Dropped iQuote rows with qty 800 (×2) and qty 1600 (×1).",
        "                 (Estimator did not price these tiers in SPOT.)",
        "  • Quote 222971: SPOT qty 520 matched to iQuote qty 521 (iQuote 'hard proofs').",
        "  • Quote 224322: SPOT row W=46.375 qty overridden 600 → 315 (SPOT reporting bug).",
        "  • Quote 224377: Dropped iQuote HSC Bin row (qty 68 — not priced in SPOT).",
        "",
        "JOB TYPE CLASSIFICATION (per component)",
        "  • Cut Only               → no Print Cost.",
        "  • Print + Cut            → Print Cost > 0 AND no Strip / Glue / Tape.",
        "  • Print + Cut + Finishing → Print Cost > 0 AND (Strip OR Glue OR Tape) > 0.",
        "",
        "QTY BANDS",
        "  1-49, 50-199, 200-999, 1000-4999, 5000+.",
        "",
        "PRICE (NOT COST)",
        "  SPOT: 'Component Total' (from input.xlsx SPOT Data).",
        "  iQuote: 'ComponentTotalPrice' (from input.xlsx iQuote Data).",
        "",
        f"MATCHED COMPONENTS: {matched_count}",
        f"UNMATCHED (see 'Unmatched' tab): {unmatched_count}",
    ]
    for i, line in enumerate(lines, start=2):
        ws.cell(row=i, column=1, value=line)
        if line and line == line.upper() and not line.startswith(" "):
            ws.cell(row=i, column=1).font = Font(bold=True, color="1F4E78")
    ws.column_dimensions["A"].width = 110


def main():
    sp_data, iq_data, cost_lookup = load_data()
    sp_data, iq_data = apply_overrides(sp_data, iq_data)
    matched, unmatched = build_component_pairs(sp_data, iq_data, cost_lookup)

    print(f"Matched component pairs: {len(matched)}")
    print(f"Unmatched: {len(unmatched)}")
    from collections import Counter
    print("By job type:", Counter(m["Job Type"] for m in matched))
    print("By qty band:", Counter(m["Qty Band"] for m in matched))

    wb = openpyxl.Workbook()
    summary = wb.active
    summary.title = "Job-Type Variance"
    write_summary_tab(summary, matched)

    # Detail tabs per job type
    for jt in JOB_TYPES:
        rows = [m for m in matched if m["Job Type"] == jt]
        rows.sort(key=lambda r: (r["Qty Band"], -abs(r["Δ %"])))
        tab_name = jt.replace(" + ", "+").replace(" ", "")[:31]
        write_detail_tab(wb, tab_name, rows)

    # All matched (single sheet for filtering)
    all_matched = sorted(matched, key=lambda r: (r["Job Type"], r["Qty Band"], -abs(r["Δ %"])))
    write_detail_tab(wb, "All Matched", all_matched)

    write_unmatched_tab(wb, unmatched)
    write_methodology_tab(wb, len(matched), len(unmatched))

    local_path = os.path.join(ANALYSIS_DIR, OUT_FILE)
    wb.save(local_path)
    os.makedirs(STATIC_DIR, exist_ok=True)
    shutil.copy(local_path, os.path.join(STATIC_DIR, OUT_FILE))
    print(f"\nWrote: {local_path}")
    print(f"       {os.path.join(STATIC_DIR, OUT_FILE)}")


if __name__ == "__main__":
    main()
