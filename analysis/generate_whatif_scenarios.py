"""
SPOT Print Pricing What-If Scenarios (for leadership decision)

Models 3 scenarios — 10%, 15%, and 20% print price cuts applied to BOTH
the 1-49 and 200-999 qty bands — vs. Current v3 corrected baseline.

Output: /app/backend/static_assets/SPOT_Print_WhatIf_Scenarios.xlsx
"""
from __future__ import annotations
import os
import shutil
import statistics
from collections import defaultdict

import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

ANALYSIS_DIR = "/app/analysis"
STATIC_DIR = "/app/backend/static_assets"
SOURCE_FILE = os.path.join(STATIC_DIR, "SPOT_JobType_Variance_v3.xlsx")
OUT_FILE = "SPOT_Print_WhatIf_Scenarios.xlsx"

BANDS = ["1-49", "50-199", "200-999", "1000-4999", "5000+"]
PRINT_TYPES = ["Print + Cut", "Print + Cut + Finishing"]
CUT_BANDS = {"1-49", "200-999"}  # scenarios apply here only

# Styles
HDR_FILL = PatternFill("solid", fgColor="1F4E78")
HDR_FONT = Font(bold=True, color="FFFFFF")
SECTION_FONT = Font(bold=True, size=12, color="1F4E78")
TITLE_FONT = Font(bold=True, size=14, color="1F4E78")
BORDER = Border(*[Side(style="thin", color="D0D0D0")] * 4)
POS_FILL = PatternFill("solid", fgColor="FFF2CC")   # yellow-ish for +overprice
NEG_FILL = PatternFill("solid", fgColor="F4CCCC")   # red-ish for -underprice
NEUTRAL_FILL = PatternFill("solid", fgColor="D9EAD3")  # green for near parity
CUT_CELL_FILL = PatternFill("solid", fgColor="CFE2F3")  # light blue for cut bands


def apply_hdr(cell):
    cell.fill = HDR_FILL
    cell.font = HDR_FONT
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = BORDER


def shade_variance(cell, pct):
    """Color code a variance % cell."""
    if pct is None:
        return
    abs_p = abs(pct)
    if abs_p < 8:
        cell.fill = NEUTRAL_FILL
    elif pct < -15:
        cell.fill = NEG_FILL
    elif pct > 15:
        cell.fill = POS_FILL


def load_matched():
    wb = openpyxl.load_workbook(SOURCE_FILE, data_only=False)
    ws = wb["All Matched"]
    h = [c.value for c in ws[1]]
    rows = [dict(zip(h, r)) for r in ws.iter_rows(min_row=2, values_only=True)]
    # Original SPOT $ preserved
    for r in rows:
        r["_orig_SPOT $"] = r["SPOT $"]
    return rows


def compute_scenario(rows, cut_pct: float):
    """Apply cut_pct to Print jobs in CUT_BANDS. Returns list of stats per (JobType, Band)."""
    scenario_rows = []
    for r in rows:
        sp = r["_orig_SPOT $"]
        if r["Job Type"] in PRINT_TYPES and r["Qty Band"] in CUT_BANDS and cut_pct > 0:
            sp = sp * (1 - cut_pct / 100)
        iq = r["iQuote $"] or 0
        if iq == 0:
            continue
        d_pct = (sp - iq) / iq
        scenario_rows.append({
            **r,
            "SPOT $": sp,
            "Δ $": sp - iq,
            "Δ %": d_pct,
        })
    return scenario_rows


def summarize(rows):
    """Group by (Job Type, Band) → (count, avg%, med%)."""
    out = {}
    for jt in PRINT_TYPES:
        for band in BANDS:
            sub = [r for r in rows if r["Job Type"] == jt and r["Qty Band"] == band]
            pcts = [r["Δ %"] for r in sub if r["Δ %"] is not None]
            if pcts:
                out[(jt, band)] = {
                    "n": len(sub),
                    "avg": statistics.mean(pcts),
                    "med": statistics.median(pcts),
                    "spot_total": sum(r["SPOT $"] for r in sub),
                    "iq_total": sum(r["iQuote $"] for r in sub),
                }
            else:
                out[(jt, band)] = {"n": 0, "avg": None, "med": None, "spot_total": 0, "iq_total": 0}
    return out


def write_scenario_tab(wb, tab_name, subtitle, summary, cut_pct):
    ws = wb.create_sheet(tab_name)
    ws.column_dimensions["A"].width = 16
    for i in range(2, 6):
        ws.column_dimensions[get_column_letter(i)].width = 22

    ws["A1"] = "SPOT Print Pricing — Variance by Qty Band"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = subtitle
    ws["A2"].font = Font(italic=True, color="606060")

    charts = []
    row_cursor = 4

    for jt in PRINT_TYPES:
        # Section header
        ws.cell(row=row_cursor, column=1, value=jt).font = SECTION_FONT
        row_cursor += 1
        hdr_row = row_cursor
        for c, label in enumerate(["Qty Band", "Count", "Avg Variance %", "Median Variance %"], start=1):
            cell = ws.cell(row=row_cursor, column=c, value=label)
            apply_hdr(cell)
        row_cursor += 1

        data_start = row_cursor
        for band in BANDS:
            s = summary[(jt, band)]
            band_cell = ws.cell(row=row_cursor, column=1, value=band)
            count_cell = ws.cell(row=row_cursor, column=2, value=s["n"])
            avg_val = s["avg"]
            med_val = s["med"]
            avg_cell = ws.cell(row=row_cursor, column=3, value=avg_val)
            med_cell = ws.cell(row=row_cursor, column=4, value=med_val)
            if avg_val is not None:
                avg_cell.number_format = "0.00%"
                shade_variance(avg_cell, avg_val * 100)
            if med_val is not None:
                med_cell.number_format = "0.00%"
                shade_variance(med_cell, med_val * 100)
            # Cut marker
            if band in CUT_BANDS and cut_pct > 0:
                band_cell.fill = CUT_CELL_FILL
                count_cell.fill = CUT_CELL_FILL
                band_cell.value = f"{band}  (cut {cut_pct:.0f}%)"
            row_cursor += 1
        data_end = row_cursor - 1

        # Chart for this job type
        chart = BarChart()
        chart.type = "col"
        chart.title = f"{jt} — Avg vs Median Variance % by Qty Band"
        chart.y_axis.title = "Variance %"
        chart.x_axis.title = "Qty Band"
        chart.height = 8
        chart.width = 18
        data_ref = Reference(ws, min_col=3, max_col=4, min_row=hdr_row, max_row=data_end)
        cats_ref = Reference(ws, min_col=1, min_row=data_start, max_row=data_end)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cats_ref)
        # Fixed y axis for cross-scenario comparison
        chart.y_axis.scaling.min = -0.40
        chart.y_axis.scaling.max = 1.00
        charts.append((chart, row_cursor))
        row_cursor += 2

    # Anchor charts side of the data
    for i, (chart, _) in enumerate(charts):
        anchor_row = 4 + i * 17
        ws.add_chart(chart, f"F{anchor_row}")


def write_comparison_tab(wb, all_summaries):
    """Side-by-side matrix — 1 row per (JobType, Band), columns per scenario."""
    ws = wb.create_sheet("Scenario Comparison", 0)  # first tab
    ws["A1"] = "Print Pricing — Scenario Comparison"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Shading: green = within ±8% (near parity)  •  yellow = +overprice  •  red = -underprice  •  blue = qty band where cut applied"
    ws["A2"].font = Font(italic=True, color="606060")

    scenario_names = ["Current", "10% cut", "15% cut", "20% cut"]
    cut_pcts = [0, 10, 15, 20]

    # Median % view
    row = 4
    ws.cell(row=row, column=1, value="MEDIAN Variance % — Print jobs by qty band").font = SECTION_FONT
    row += 1
    hdr_row = row
    for c, label in enumerate(["Job Type", "Qty Band", "n", *scenario_names], start=1):
        cell = ws.cell(row=row, column=c, value=label); apply_hdr(cell)
    row += 1

    for jt in PRINT_TYPES:
        for band in BANDS:
            n = all_summaries[0][(jt, band)]["n"]
            if n == 0:
                continue
            ws.cell(row=row, column=1, value=jt)
            band_cell = ws.cell(row=row, column=2, value=band)
            ws.cell(row=row, column=3, value=n)
            for i, summary in enumerate(all_summaries):
                v = summary[(jt, band)]["med"]
                cell = ws.cell(row=row, column=4 + i, value=v)
                if v is not None:
                    cell.number_format = "0.00%"
                    shade_variance(cell, v * 100)
            if band in CUT_BANDS:
                band_cell.fill = CUT_CELL_FILL
            row += 1

    row += 2
    ws.cell(row=row, column=1, value="AVG Variance % — Print jobs by qty band").font = SECTION_FONT
    row += 1
    for c, label in enumerate(["Job Type", "Qty Band", "n", *scenario_names], start=1):
        cell = ws.cell(row=row, column=c, value=label); apply_hdr(cell)
    row += 1
    for jt in PRINT_TYPES:
        for band in BANDS:
            n = all_summaries[0][(jt, band)]["n"]
            if n == 0:
                continue
            ws.cell(row=row, column=1, value=jt)
            band_cell = ws.cell(row=row, column=2, value=band)
            ws.cell(row=row, column=3, value=n)
            for i, summary in enumerate(all_summaries):
                v = summary[(jt, band)]["avg"]
                cell = ws.cell(row=row, column=4 + i, value=v)
                if v is not None:
                    cell.number_format = "0.00%"
                    shade_variance(cell, v * 100)
            if band in CUT_BANDS:
                band_cell.fill = CUT_CELL_FILL
            row += 1

    # Revenue impact rollup
    row += 2
    ws.cell(row=row, column=1, value="Revenue Impact vs Current (sample-level)").font = SECTION_FONT
    row += 1
    for c, label in enumerate(["Scenario", "Print rows in cut bands", "Total SPOT $ (baseline)", "Total SPOT $ (scenario)", "Δ vs iQuote before", "Δ vs iQuote after", "Revenue give-back"], start=1):
        cell = ws.cell(row=row, column=c, value=label); apply_hdr(cell)
    row += 1

    # Cache the impacted-band totals per scenario
    for scen_idx, cut_pct in enumerate(cut_pcts):
        n_rows = 0; base_sp = 0; new_sp = 0; iq_tot = 0
        for jt in PRINT_TYPES:
            for band in CUT_BANDS:
                s0 = all_summaries[0][(jt, band)]
                si = all_summaries[scen_idx][(jt, band)]
                n_rows += s0["n"]
                base_sp += s0["spot_total"]
                new_sp += si["spot_total"]
                iq_tot += s0["iq_total"]
        ws.cell(row=row, column=1, value=scenario_names[scen_idx])
        ws.cell(row=row, column=2, value=n_rows)
        c3 = ws.cell(row=row, column=3, value=base_sp); c3.number_format = '"$"#,##0'
        c4 = ws.cell(row=row, column=4, value=new_sp); c4.number_format = '"$"#,##0'
        c5 = ws.cell(row=row, column=5, value=base_sp - iq_tot); c5.number_format = '"$"#,##0;-"$"#,##0'
        c6 = ws.cell(row=row, column=6, value=new_sp - iq_tot); c6.number_format = '"$"#,##0;-"$"#,##0'
        c7 = ws.cell(row=row, column=7, value=new_sp - base_sp); c7.number_format = '"$"#,##0;-"$"#,##0'
        row += 1

    # Column widths
    widths = [26, 20, 8, 18, 18, 18, 18, 18]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def write_recommendation_tab(wb):
    ws = wb.create_sheet("Recommendation")
    ws["A1"] = "Reading This Model"
    ws["A1"].font = TITLE_FONT
    lines = [
        "",
        "WHAT IT SHOWS",
        "  • The 10/15/20% print-price cut is applied to Print + Cut and Print + Cut + Finishing",
        "    components in the 1-49 and 200-999 qty bands ONLY.",
        "  • All other bands (50-199, 1000-4999, 5000+) are unchanged.",
        "  • Cut Only components are unchanged — this is a print-only scenario.",
        "",
        "BASELINE NOTE",
        "  This tab uses the CORRECTED v3 join. The screenshot you were reviewing showed",
        "  v2 numbers with a join bug (e.g., Print+Cut 200-999 Avg showed 85.88% because",
        "  a Shelf@1000 was mis-paired with a Header@1000). The corrected baseline has",
        "  Avg +20.91% for that cell.",
        "",
        "HOW TO USE",
        "  1. Compare 'Scenario Comparison' tab for the side-by-side matrix.",
        "  2. Drill into each 'Scenario Nn%' tab for full tables + charts.",
        "  3. Read the Revenue-Impact table at the bottom of 'Scenario Comparison'.",
        "",
        "WHAT THE 3 SCENARIOS DO TO EACH BAND",
        "  1-49:",
        "    • 10% cut → Print + Cut median moves +31% → +18% (still elevated).",
        "    • 15% cut → +31% → +12% (getting closer).",
        "    • 20% cut → +31% → +5%  (near parity).",
        "  200-999:",
        "    • 10% cut → Print + Cut median +24% → +11% (near parity).",
        "    • 15% cut → +24% → +5%  (parity).",
        "    • 20% cut → +24% → -1%  (slight underprice).",
        "",
        "OBSERVED PATTERN",
        "  • The 1-49 band starts wider (+31% median) than 200-999 (+24%).",
        "  • Same-% cut has different effect: 20% brings 1-49 to parity but pushes",
        "    200-999 slightly UNDER iQuote.",
        "  • If your goal is BOTH bands at parity, the honest answer is to split the",
        "    lever: 20% in 1-49 and 10% in 200-999 (see prior analysis).",
        "",
        "NOTE ON 5000+ BAND",
        "  Intentionally excluded from this what-if. Only 3 data points, all from one",
        "  quote (Q224297 Die Cut Hand Formed). Decision deferred pending more data.",
    ]
    for i, line in enumerate(lines, start=2):
        cell = ws.cell(row=i, column=1, value=line)
        if line and line.isupper() and not line.startswith(" "):
            cell.font = Font(bold=True, color="1F4E78")
    ws.column_dimensions["A"].width = 110


def main():
    rows = load_matched()

    # Compute summaries for each scenario
    scenarios = [
        (0, "Current (v3 Corrected Baseline)", "No price cut applied. Same numbers as the SPOT_JobType_Variance_v3.xlsx report."),
        (10, "Scenario A — 10% Cut", "10% price cut applied to Print + Cut and Print + Cut + Finishing components in the 1-49 and 200-999 qty bands."),
        (15, "Scenario B — 15% Cut", "15% price cut applied to Print + Cut and Print + Cut + Finishing components in the 1-49 and 200-999 qty bands."),
        (20, "Scenario C — 20% Cut", "20% price cut applied to Print + Cut and Print + Cut + Finishing components in the 1-49 and 200-999 qty bands."),
    ]

    all_summaries = []
    for cut_pct, _, _ in scenarios:
        scen_rows = compute_scenario(rows, cut_pct)
        all_summaries.append(summarize(scen_rows))

    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove default sheet

    # Comparison tab first
    write_comparison_tab(wb, all_summaries)

    # One tab per scenario
    for i, (cut_pct, tab_name, subtitle) in enumerate(scenarios):
        write_scenario_tab(wb, tab_name.split(" — ")[0][:31] if " — " in tab_name else tab_name[:31], subtitle, all_summaries[i], cut_pct)

    write_recommendation_tab(wb)

    local_path = os.path.join(ANALYSIS_DIR, OUT_FILE)
    wb.save(local_path)
    os.makedirs(STATIC_DIR, exist_ok=True)
    shutil.copy(local_path, os.path.join(STATIC_DIR, OUT_FILE))
    print(f"Wrote: {local_path}")
    print(f"       {os.path.join(STATIC_DIR, OUT_FILE)}")


if __name__ == "__main__":
    main()
