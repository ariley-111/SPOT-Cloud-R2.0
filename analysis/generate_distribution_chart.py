"""Standalone Variance % Distribution chart with P25/P75 band and zero-crossover marker.

Usage: python3 generate_distribution_chart.py <round2_input.xlsx> <output.xlsx>
"""
import sys
import pandas as pd
import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.chart import ScatterChart, Reference, Series
from openpyxl.chart.marker import Marker
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.colors import ColorChoice


IN  = sys.argv[1] if len(sys.argv) > 1 else "input.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "SPOT_Variance_Distribution.xlsx"


# ─── Reproduce the same quote-total dataset used in Round 2 v2 ───
iq = pd.read_excel(IN, sheet_name="iQuote Data")
sp = pd.read_excel(IN, sheet_name="SPOT Data")


def norm_opt(x):
    if pd.isna(x): return ""
    s = str(x).strip().lower()
    if " - " in s: s = s.split(" - ")[0].strip()
    return s


iq["_opt"] = iq["OptDesc"].apply(norm_opt)
sp["_opt"] = sp["iQuote Option"].apply(norm_opt)

groups = sp.groupby(["iQuote Estimate #", "Quote Total"], dropna=False)
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
    rows.append({"est": int(est) if not pd.isna(est) else None,
                 "spot_est": g["SPOT Estimate #"].iloc[0],
                 "customer": g["Customer"].iloc[0],
                 "quote_total": qt,
                 "iq_sum": iq_sum})

df = pd.DataFrame(rows)
df["variance_pct"] = (df["quote_total"] - df["iq_sum"]) / df["iq_sum"] * 100
df = df.dropna(subset=["variance_pct"]).sort_values("variance_pct").reset_index(drop=True)
df.insert(0, "Rank", range(1, len(df) + 1))

vp = df["variance_pct"]
n = len(df)
med = float(vp.median())
p25 = float(vp.quantile(0.25))
p75 = float(vp.quantile(0.75))
mean = float(vp.mean())
crossover_rank = int((vp < 0).sum()) + 1  # first rank where variance >= 0
y_min = float(vp.min())
y_max = float(vp.max())


# ─── Build workbook ─────────────────────────────────────────────
wb = Workbook()
ws = wb.active
ws.title = "Distribution"

TITLE = Font(bold=True, size=16, color="1F4E78")
SUB   = Font(italic=True, size=10, color="595959")
BOLD  = Font(bold=True)

ws["A1"] = "Variance % Distribution — Quote-Total Level"
ws["A1"].font = TITLE
ws["A2"] = (
    f"n = {n} quote totals. Each dot = one quote sorted by SPOT-vs-iQuote %. "
    f"Median = {med:+.1f}%, Mean = {mean:+.1f}%, Middle-50% band = {p25:+.1f}% to {p75:+.1f}%. "
    f"Zero crossover at rank {crossover_rank} ({(crossover_rank-1)/n:.0%} of quotes have SPOT cheaper than iQuote)."
)
ws["A2"].font = SUB
ws.merge_cells("A1:F1")
ws.merge_cells("A2:F2")

# How to read
ws["A4"] = "How to read this chart"
ws["A4"].font = BOLD
ws["A5"] = "• X-axis is rank (leftmost = SPOT cheapest vs iQuote, rightmost = SPOT most expensive)."
ws["A6"] = "• Y-axis is the variance for that quote: negative = SPOT cheaper, positive = SPOT more expensive."
ws["A7"] = "• Dashed band = the middle 50% of quotes (P25 to P75). Most quotes sit inside this band."
ws["A8"] = "• Solid line at 0% = crossover between 'SPOT cheaper' (below) and 'SPOT more expensive' (above)."
ws["A9"] = "• Dotted line at median = the honest middle value (mean is inflated by right-tail outliers)."
for r in range(5, 10):
    ws.row_dimensions[r].height = 15

# ─── Data columns ───────────────────────────────────────────────
# Data block starts at row 12
DATA_ROW = 12
ws.cell(row=DATA_ROW, column=1, value="Rank"); ws.cell(row=DATA_ROW, column=1).font = BOLD
ws.cell(row=DATA_ROW, column=2, value="Variance %"); ws.cell(row=DATA_ROW, column=2).font = BOLD
ws.cell(row=DATA_ROW, column=3, value="iQuote Estimate #"); ws.cell(row=DATA_ROW, column=3).font = BOLD
ws.cell(row=DATA_ROW, column=4, value="SPOT Estimate #"); ws.cell(row=DATA_ROW, column=4).font = BOLD
ws.cell(row=DATA_ROW, column=5, value="Customer"); ws.cell(row=DATA_ROW, column=5).font = BOLD

FMT_PCT = "0.00\"%\";-0.00\"%\";0.00\"%\""

for i, row in df.iterrows():
    r = DATA_ROW + 1 + i
    ws.cell(row=r, column=1, value=int(row["Rank"]))
    c = ws.cell(row=r, column=2, value=float(row["variance_pct"])); c.number_format = FMT_PCT
    ws.cell(row=r, column=3, value=int(row["est"]) if not pd.isna(row["est"]) else None)
    ws.cell(row=r, column=4, value=row["spot_est"])
    ws.cell(row=r, column=5, value=row["customer"])

first_data_row = DATA_ROW + 1
last_data_row  = DATA_ROW + n

# ─── Reference-line data (columns G onward, kept visible so charts render) ───
# Zero line: 2 points (x=1,y=0) (x=n,y=0)
ws["G1"] = "zero_x"; ws["H1"] = "zero_y"
ws["G2"] = 1; ws["H2"] = 0
ws["G3"] = n; ws["H3"] = 0

# Median line
ws["I1"] = "med_x"; ws["J1"] = "med_y"
ws["I2"] = 1; ws["J2"] = med
ws["I3"] = n; ws["J3"] = med

# P25 line
ws["K1"] = "p25_x"; ws["L1"] = "p25_y"
ws["K2"] = 1; ws["L2"] = p25
ws["K3"] = n; ws["L3"] = p25

# P75 line
ws["M1"] = "p75_x"; ws["N1"] = "p75_y"
ws["M2"] = 1; ws["N2"] = p75
ws["M3"] = n; ws["N3"] = p75

# Zero crossover vertical line
# span y from a bit below y_min to a bit above y_max
ws["O1"] = "cross_x"; ws["P1"] = "cross_y"
ws["O2"] = crossover_rank; ws["P2"] = y_min * 1.05
ws["O3"] = crossover_rank; ws["P3"] = y_max * 1.05

# ─── Chart ──────────────────────────────────────────────────────
chart = ScatterChart()
chart.title = "Variance % Distribution — Quote-Total Level (172 quotes)"
chart.x_axis.title = "Rank (sorted low → high)"
chart.y_axis.title = "Variance % (SPOT vs iQuote)"
chart.height = 18
chart.width  = 32
chart.legend.position = "b"


def scatter_series(x_range, y_range, name, marker=None, line_color=None, line_dash=None, line_width=1.5, no_line=False):
    x_ref = Reference(ws, range_string=x_range)
    y_ref = Reference(ws, range_string=y_range)
    s = Series(y_ref, x_ref, title=name)
    if marker:
        s.marker = marker
    if no_line:
        s.graphicalProperties = GraphicalProperties()
        s.graphicalProperties.line.noFill = True
    else:
        gp = GraphicalProperties()
        gp.line = LineProperties(w=int(line_width * 12700))  # EMU
        if line_color:
            gp.line.solidFill = line_color
        if line_dash:
            gp.line.prstDash = line_dash
        s.graphicalProperties = gp
    return s


# Data points — small blue dots, no connecting line
mk = Marker(symbol="circle", size=6)
mk.graphicalProperties = GraphicalProperties(solidFill="1F4E78")
mk.graphicalProperties.line = LineProperties(solidFill="1F4E78")
data_x = f"Distribution!$A${first_data_row}:$A${last_data_row}"
data_y = f"Distribution!$B${first_data_row}:$B${last_data_row}"
chart.series.append(scatter_series(data_x, data_y, "Quote variance", marker=mk, no_line=True))

# Zero line — solid red horizontal
chart.series.append(scatter_series("Distribution!$G$2:$G$3", "Distribution!$H$2:$H$3",
                                   "0% (SPOT = iQuote)", line_color="C00000", line_width=2.0))

# Median — dotted dark green
chart.series.append(scatter_series("Distribution!$I$2:$I$3", "Distribution!$J$2:$J$3",
                                   f"Median ({med:+.1f}%)", line_color="2E7D32",
                                   line_dash="dash", line_width=2.0))

# P25 — dashed grey
chart.series.append(scatter_series("Distribution!$K$2:$K$3", "Distribution!$L$2:$L$3",
                                   f"P25 ({p25:+.1f}%)", line_color="808080",
                                   line_dash="sysDash", line_width=1.5))

# P75 — dashed grey
chart.series.append(scatter_series("Distribution!$M$2:$M$3", "Distribution!$N$2:$N$3",
                                   f"P75 ({p75:+.1f}%)", line_color="808080",
                                   line_dash="sysDash", line_width=1.5))

# Zero crossover — vertical orange dashed line
chart.series.append(scatter_series("Distribution!$O$2:$O$3", "Distribution!$P$2:$P$3",
                                   f"Zero crossover (rank {crossover_rank})",
                                   line_color="ED7D31", line_dash="dashDot", line_width=2.0))

ws.add_chart(chart, "H4")

# Column widths
ws.column_dimensions["A"].width = 8
ws.column_dimensions["B"].width = 14
ws.column_dimensions["C"].width = 18
ws.column_dimensions["D"].width = 22
ws.column_dimensions["E"].width = 28
for c in "GHIJKLMNOP":
    ws.column_dimensions[c].width = 10

wb.save(OUT)
print(f"Wrote {OUT}")
print(f"n={n}   median={med:+.2f}%   P25={p25:+.2f}%   P75={p75:+.2f}%   zero crossover at rank {crossover_rank} ({(crossover_rank-1)/n:.0%})")
