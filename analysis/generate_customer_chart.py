"""Chart-only workbook: Top 15 Customers × Qty Band (Median Variance %).

Two views: heatmap-style color-scaled table + a grouped horizontal bar chart.

Usage: python3 generate_customer_chart.py <round2_input.xlsx> <output.xlsx>
"""
import sys
import pandas as pd
import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import ColorScaleRule


IN  = sys.argv[1] if len(sys.argv) > 1 else "input.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "SPOT_Customer_QtyBand_Chart.xlsx"

# Rebuild the quote-total dataset (same rule as Round 2 v2)
iq = pd.read_excel(IN, sheet_name="iQuote Data")
sp = pd.read_excel(IN, sheet_name="SPOT Data")

def norm_opt(x):
    if pd.isna(x): return ""
    s = str(x).strip().lower()
    if " - " in s: s = s.split(" - ")[0].strip()
    return s

iq["_opt"] = iq["OptDesc"].apply(norm_opt)
sp["_opt"] = sp["iQuote Option"].apply(norm_opt)

groups = sp.groupby(["iQuote Estimate #","Quote Total"], dropna=False)
rows = []
for (est, qt), g in groups:
    pairs = set(zip(g["_opt"], g["Qty"]))
    iq_pool = iq[iq["IdQuote"] == est]
    matched = iq_pool[iq_pool.apply(lambda r: (r["_opt"], r["Quantity"]) in pairs, axis=1)]
    if len(matched) == 0:
        matched = iq_pool[iq_pool["Quantity"].isin(set(g["Qty"].tolist()))]
    if len(matched) == 0:
        matched = iq_pool
    iq_sum = matched["ComponentTotalPrice"].sum() if len(matched) > 0 else np.nan
    rows.append({
        "Customer": g["Customer"].iloc[0],
        "quote_total": qt,
        "iq_sum": iq_sum,
        "qty_max": g["Qty"].max(),
    })
df = pd.DataFrame(rows)
df["variance_pct"] = (df["quote_total"] - df["iq_sum"]) / df["iq_sum"] * 100

def qty_band(q):
    if pd.isna(q): return "Unknown"
    q = int(q)
    if q < 50: return "1-49"
    if q < 200: return "50-199"
    if q < 1000: return "200-999"
    if q < 5000: return "1000-4999"
    return "5000+"

df["Qty Band"] = df["qty_max"].apply(qty_band)

BANDS = ["1-49","50-199","200-999","1000-4999","5000+"]
top15 = df.groupby("Customer").size().sort_values(ascending=False).head(15).index.tolist()

sub = df[df["Customer"].isin(top15)]
counts = sub.groupby("Customer").size().reindex(top15)


def build_sheet(wb, title, aggfunc, subtitle_metric):
    pivot = sub.pivot_table(index="Customer", columns="Qty Band", values="variance_pct", aggfunc=aggfunc)
    pivot = pivot.reindex(columns=BANDS).reindex(top15)

    ws = wb.create_sheet(title) if wb.sheetnames != ["Sheet"] else wb.active
    if ws.title == "Sheet":
        ws.title = title

    TITLE = Font(bold=True, size=16, color="1F4E78")
    SUB   = Font(italic=True, size=10, color="595959")
    HDR   = Font(bold=True, color="FFFFFF", size=11)
    HDR_FILL = PatternFill("solid", fgColor="1F4E78")
    BOLD  = Font(bold=True)
    THIN  = Side(border_style="thin", color="BFBFBF")
    BORDER= Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
    CENTER= Alignment(horizontal="center", vertical="center")
    FMT_PCT = "0.00\"%\";-0.00\"%\";0.00\"%\""
    FMT_INT = "#,##0"

    ws["A1"] = f"{subtitle_metric} Variance % — Top 15 Customers × Qty Band"
    ws["A1"].font = TITLE
    ws["A2"] = ("Quote-total level. Green = SPOT cheaper, Red = SPOT more expensive, White = near parity. "
                "Blank cell = no quotes from that customer in that qty band.")
    ws["A2"].font = SUB
    ws.merge_cells("A1:H1"); ws.merge_cells("A2:H2")

    headers = ["Customer"] + BANDS + ["Quote Count"]
    for j, h in enumerate(headers, start=1):
        c = ws.cell(row=4, column=j, value=h)
        c.font = HDR; c.fill = HDR_FILL; c.alignment = CENTER; c.border = BORDER

    for i, cust in enumerate(top15, start=5):
        ws.cell(row=i, column=1, value=cust).font = BOLD
        ws.cell(row=i, column=1).border = BORDER
        for j, band in enumerate(BANDS, start=2):
            v = pivot.loc[cust, band]
            c = ws.cell(row=i, column=j, value=None if pd.isna(v) else float(v))
            c.number_format = FMT_PCT
            c.border = BORDER; c.alignment = CENTER
        nc = ws.cell(row=i, column=7, value=int(counts.loc[cust]))
        nc.number_format = FMT_INT; nc.border = BORDER; nc.alignment = CENTER

    # Heat scale — Mean sheet uses wider bounds since means blow up
    if subtitle_metric == "Avg":
        rule = ColorScaleRule(start_type="num", start_value=-30, start_color="63BE7B",
                              mid_type="num", mid_value=0, mid_color="FFFFFF",
                              end_type="num", end_value=150, end_color="F8696B")
    else:
        rule = ColorScaleRule(start_type="num", start_value=-30, start_color="63BE7B",
                              mid_type="num", mid_value=0, mid_color="FFFFFF",
                              end_type="num", end_value=60, end_color="F8696B")
    ws.conditional_formatting.add(f"B5:F{4+len(top15)}", rule)

    ws.column_dimensions["A"].width = 42
    for c in "BCDEFG":
        ws.column_dimensions[c].width = 12
    ws.freeze_panes = "B5"

    chart = BarChart()
    chart.type = "bar"; chart.style = 11; chart.grouping = "clustered"
    chart.title = f"{subtitle_metric} Variance % — by Customer × Qty Band"
    chart.x_axis.title = f"{subtitle_metric} Variance %"
    chart.y_axis.title = "Customer"
    chart.height = 22; chart.width = 32
    chart.legend.position = "b"
    data_ref = Reference(ws, min_col=2, max_col=6, min_row=4, max_row=4 + len(top15))
    cats_ref = Reference(ws, min_col=1, min_row=5, max_row=4 + len(top15))
    chart.add_data(data_ref, titles_from_data=True)
    chart.set_categories(cats_ref)
    ws.add_chart(chart, "I4")


# ─── Build workbook with both sheets ────────────────────────────
wb = Workbook()
build_sheet(wb, "Median", "median", "Median")
build_sheet(wb, "Avg (Mean)", "mean", "Avg")

wb.save(OUT)
print(f"Wrote {OUT}")
print(f"Customers: {len(top15)}, Bands: {len(BANDS)}")
