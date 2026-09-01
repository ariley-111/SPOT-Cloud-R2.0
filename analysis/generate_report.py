"""Round 2 SPOT vs iQuote Analysis Report generator.

Usage: python3 generate_report.py <input.xlsx> <output.xlsx>
"""
import sys
import pandas as pd
import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import ScatterChart, Reference, Series, BarChart, PieChart, LineChart
from openpyxl.chart.trendline import Trendline
from openpyxl.chart.marker import Marker
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.layout import Layout, ManualLayout


IN = sys.argv[1] if len(sys.argv) > 1 else "input.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "SPOT_vs_iQuote_Round2.xlsx"


# ---------- Load & normalize ----------
iq = pd.read_excel(IN, sheet_name="iQuote Data")
sp = pd.read_excel(IN, sheet_name="SPOT Data")


def norm_opt(x):
    if pd.isna(x):
        return ""
    s = str(x).strip().lower()
    if " - " in s:
        s = s.split(" - ")[0].strip()
    return s


iq["_opt"] = iq["OptDesc"].apply(norm_opt)
sp["_opt"] = sp["iQuote Option"].apply(norm_opt)
iq["_id"] = iq["IdQuote"].astype("Int64")
sp["_id"] = sp["iQuote Estimate #"].astype("Int64")

iq = iq.sort_values(["_id", "_opt", "Quantity"]).reset_index(drop=True)
sp = sp.sort_values(["_id", "_opt", "Qty"]).reset_index(drop=True)
iq["_iq_idx"] = iq.index
sp["_sp_idx"] = sp.index


# ---------- Component-level match ----------
iq_available = iq.copy()
iq_available["_consumed"] = False
pairs = []
for _, s in sp.iterrows():
    pool = iq_available[
        (iq_available["_id"] == s["_id"])
        & (iq_available["_opt"] == s["_opt"])
        & (iq_available["Quantity"] == s["Qty"])
        & (~iq_available["_consumed"])
    ]
    if len(pool) == 0:
        pool = iq_available[
            (iq_available["_id"] == s["_id"])
            & (iq_available["Quantity"] == s["Qty"])
            & (~iq_available["_consumed"])
        ]
    if len(pool) == 0:
        pool = iq_available[(iq_available["_id"] == s["_id"]) & (~iq_available["_consumed"])]
    if len(pool) > 0:
        pick = pool.iloc[0]
        pairs.append((s["_sp_idx"], pick["_iq_idx"]))
        iq_available.loc[pick["_iq_idx"], "_consumed"] = True
    else:
        pairs.append((s["_sp_idx"], None))

pairs_df = pd.DataFrame(pairs, columns=["_sp_idx", "_iq_idx"])
iq_for_merge = iq.drop(columns=["_iq_idx", "_id", "_opt"])
m = sp.merge(pairs_df, on="_sp_idx").merge(
    iq_for_merge,
    left_on="_iq_idx",
    right_index=True,
    how="left",
)


# ---------- Compute variance ----------
m["SPOT Component Total"] = pd.to_numeric(m["Component Total"], errors="coerce")
m["iQuote Component Total"] = pd.to_numeric(m["ComponentTotalPrice"], errors="coerce")
m["Variance $"] = m["SPOT Component Total"] - m["iQuote Component Total"]
m["Variance %"] = np.where(
    m["iQuote Component Total"].fillna(0) != 0,
    m["Variance $"] / m["iQuote Component Total"] * 100.0,
    np.nan,
)

# Z-score of Variance %
vp = m["Variance %"]
mean_v = vp.mean()
std_v = vp.std()
m["Z-Score"] = (vp - mean_v) / std_v if std_v else np.nan

# IQR outlier flag
q1, q3 = vp.quantile([0.25, 0.75])
iqr = q3 - q1
lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
m["IQR Outlier"] = ((vp < lo) | (vp > hi)).map({True: "Yes", False: "No"})

# CD freight flag
m["CD Freight Flag"] = m["SPOT Estimate #"].astype(str).str.startswith("CD-").map({True: "Yes", False: "No"})

# Qty band
def qty_band(q):
    if pd.isna(q):
        return "Unknown"
    q = int(q)
    if q < 50:
        return "1-49"
    if q < 200:
        return "50-199"
    if q < 1000:
        return "200-999"
    if q < 5000:
        return "1000-4999"
    return "5000+"


m["Qty Band"] = m["Qty"].apply(qty_band)

# Print / No-Print
def print_flag(x):
    if pd.isna(x):
        return "No Print"
    s = str(x).strip().lower()
    if s in ("", "none", "none/none", "no", "no print"):
        return "No Print"
    return "Print"


m["Print/No-Print"] = m["Print Mode"].apply(print_flag)


# ---------- Prepare Raw Variance frame ----------
raw = pd.DataFrame(
    {
        "iQuote Estimate #": m["_id"].astype("Int64"),
        "SPOT Estimate #": m["SPOT Estimate #"],
        "Became a Job": m["Became a Job"],
        "Customer": m["Customer"],
        "Project Name": m["Project Name"],
        "Status": m["Status"],
        "iQuote Option": m["OptDesc"],
        "Product": m["Product"],
        "Qty": m["Qty"],
        "Qty Band": m["Qty Band"],
        "Width": m["Width"],
        "Length": m["Length"],
        "Board": m["Board"],
        "Print Mode": m["Print Mode"],
        "Print/No-Print": m["Print/No-Print"],
        "Route": m["Route"],
        "IsBuyMin": m["IsBuyMin"],
        "SPOT Component Total": m["SPOT Component Total"],
        "iQuote Component Total": m["iQuote Component Total"],
        "Variance $": m["Variance $"],
        "Variance %": m["Variance %"],
        "Z-Score": m["Z-Score"],
        "IQR Outlier": m["IQR Outlier"],
        "CD Freight Flag": m["CD Freight Flag"],
        "Notes": m["Notes"],
    }
)


# ---------- Stats helpers ----------
def summary_stats(series):
    s = series.dropna()
    if len(s) == 0:
        return dict(count=0, mean=np.nan, median=np.nan, std=np.nan, p25=np.nan, p75=np.nan, pos=0, neg=0)
    return dict(
        count=len(s),
        mean=s.mean(),
        median=s.median(),
        std=s.std(),
        p25=s.quantile(0.25),
        p75=s.quantile(0.75),
        pos=(s > 0).sum(),
        neg=(s < 0).sum(),
    )


all_stats = summary_stats(raw["Variance %"])
# IQR-trimmed
mask_trim = raw["IQR Outlier"] == "No"
trim_stats = summary_stats(raw.loc[mask_trim, "Variance %"])
# Excluding CD freight
mask_no_cd = raw["CD Freight Flag"] == "No"
noc_stats = summary_stats(raw.loc[mask_no_cd, "Variance %"])
# Both IQR trim & no CD
mask_both = mask_trim & mask_no_cd
both_stats = summary_stats(raw.loc[mask_both, "Variance %"])


# ---------- Qty band stats ----------
def band_stats(df, bands=("1-49", "50-199", "200-999", "1000-4999", "5000+")):
    rows = []
    for b in bands:
        s = summary_stats(df.loc[df["Qty Band"] == b, "Variance %"])
        rows.append([b, s["count"], s["mean"], s["median"], s["p25"], s["p75"], s["std"]])
    return pd.DataFrame(rows, columns=["Qty Band", "Count", "Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev"])


band_raw = band_stats(raw)
band_trim = band_stats(raw.loc[mask_trim])


# ---------- Qty x Customer pivot (top 15) ----------
top_cust = raw.groupby("Customer")["Variance %"].count().sort_values(ascending=False).head(15).index.tolist()
pivot_df = raw[raw["Customer"].isin(top_cust)].pivot_table(
    index="Customer", columns="Qty Band", values="Variance %", aggfunc="mean"
)
band_order = ["1-49", "50-199", "200-999", "1000-4999", "5000+"]
pivot_df = pivot_df.reindex(columns=[b for b in band_order if b in pivot_df.columns])
pivot_df = pivot_df.reindex(top_cust)
pivot_df["Component Count"] = raw[raw["Customer"].isin(top_cust)].groupby("Customer").size().reindex(top_cust)
pivot_df = pivot_df.reset_index()


# ---------- Print vs No-Print stats ----------
def group_stats_by(df, col):
    rows = []
    for g in sorted(df[col].dropna().unique()):
        s = summary_stats(df.loc[df[col] == g, "Variance %"])
        rows.append([g, s["count"], s["mean"], s["median"], s["p25"], s["p75"], s["std"], s["pos"], s["neg"]])
    return pd.DataFrame(
        rows,
        columns=[col, "Count", "Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev", "SPOT > iQuote", "SPOT < iQuote"],
    )


print_stats = group_stats_by(raw, "Print/No-Print")
# also by Print Mode
mode_stats = group_stats_by(raw.assign(**{"Print Mode": raw["Print Mode"].fillna("None")}), "Print Mode")


# ---------- Distribution (Z-score) sheet data ----------
dist = raw.copy().sort_values("Z-Score", key=lambda x: x.abs(), ascending=False)
# for chart: index (1..N) vs variance % sorted ascending
chart_data = raw[["iQuote Estimate #", "SPOT Estimate #", "Customer", "Variance %", "Z-Score"]].copy()
chart_data = chart_data.dropna(subset=["Variance %"]).sort_values("Variance %").reset_index(drop=True)
chart_data.insert(0, "Rank", range(1, len(chart_data) + 1))


# ---------- CD Freight rows ----------
cd_rows = raw[raw["CD Freight Flag"] == "Yes"].copy()


# ============================================================
# Write workbook
# ============================================================
wb = Workbook()

# Styles
HDR = Font(bold=True, color="FFFFFF", size=11)
HDR_FILL = PatternFill("solid", fgColor="1F4E78")
SUBHDR = Font(bold=True, size=11, color="1F4E78")
BOLD = Font(bold=True)
TITLE = Font(bold=True, size=16, color="1F4E78")
SUBTITLE = Font(italic=True, size=10, color="595959")
THIN = Side(border_style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center")

FMT_PCT = "0.00\"%\";-0.00\"%\";0.00\"%\""
FMT_MONEY = "$#,##0.00;[Red]-$#,##0.00"
FMT_INT = "#,##0"
FMT_NUM = "0.0000"


def style_header_row(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = HDR
        cell.fill = HDR_FILL
        cell.alignment = CENTER
        cell.border = BORDER


def autosize(ws, df_cols, min_w=10, max_w=42):
    for i, col in enumerate(df_cols, start=1):
        letter = get_column_letter(i)
        width = max(min_w, min(max_w, int(len(str(col)) * 1.2) + 3))
        ws.column_dimensions[letter].width = width


def write_df(ws, df, start_row=1, pct_cols=(), money_cols=(), int_cols=(), num_cols=()):
    # header
    for j, col in enumerate(df.columns, start=1):
        ws.cell(row=start_row, column=j, value=str(col))
    style_header_row(ws, start_row, len(df.columns))
    # rows
    for i, row in enumerate(df.itertuples(index=False), start=start_row + 1):
        for j, val in enumerate(row, start=1):
            if pd.isna(val):
                v = None
            elif isinstance(val, (np.integer,)):
                v = int(val)
            elif isinstance(val, (np.floating,)):
                v = float(val) if not pd.isna(val) else None
            else:
                v = val
            c = ws.cell(row=i, column=j, value=v)
            col_name = df.columns[j - 1]
            if col_name in pct_cols:
                c.number_format = FMT_PCT
            elif col_name in money_cols:
                c.number_format = FMT_MONEY
            elif col_name in int_cols:
                c.number_format = FMT_INT
            elif col_name in num_cols:
                c.number_format = FMT_NUM
            c.border = BORDER
    # widths
    for j, col in enumerate(df.columns, start=1):
        letter = get_column_letter(j)
        header_len = len(str(col))
        try:
            sample_len = int(df[col].astype(str).map(len).clip(upper=40).max())
        except Exception:
            sample_len = 10
        w = max(10, min(42, max(header_len, sample_len) + 3))
        ws.column_dimensions[letter].width = w
    ws.freeze_panes = ws.cell(row=start_row + 1, column=1)


# ---------- Sheet 1: Executive Summary ----------
ws = wb.active
ws.title = "Exec Summary"
ws["A1"] = "SPOT vs iQuote — Round 2 Analysis"
ws["A1"].font = TITLE
ws["A2"] = "Variance = (SPOT − iQuote) / iQuote, computed at component level"
ws["A2"].font = SUBTITLE
ws["A3"] = f"Generated {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}   |   Components: {len(raw)}   |   Unique estimates: {raw['iQuote Estimate #'].nunique()}"
ws["A3"].font = SUBTITLE

ws.merge_cells("A1:F1")
ws.merge_cells("A2:F2")
ws.merge_cells("A3:F3")


def write_stats_block(ws, title, stats, start_row):
    ws.cell(row=start_row, column=1, value=title).font = SUBHDR
    labels = [
        ("Component Count", stats["count"], FMT_INT),
        ("Avg Variance %", stats["mean"], FMT_PCT),
        ("Median Variance %", stats["median"], FMT_PCT),
        ("Std Dev", stats["std"], FMT_PCT),
        ("P25", stats["p25"], FMT_PCT),
        ("P75", stats["p75"], FMT_PCT),
        ("SPOT > iQuote (count)", stats["pos"], FMT_INT),
        ("SPOT < iQuote (count)", stats["neg"], FMT_INT),
    ]
    for i, (lbl, val, fmt) in enumerate(labels):
        r = start_row + 1 + i
        a = ws.cell(row=r, column=1, value=lbl)
        a.font = BOLD
        b = ws.cell(row=r, column=2, value=None if pd.isna(val) else float(val) if not isinstance(val, (int, np.integer)) else int(val))
        b.number_format = fmt
        b.alignment = LEFT
    return start_row + len(labels) + 2


r = 5
r = write_stats_block(ws, "All Components (Raw)", all_stats, r)
r = write_stats_block(ws, "IQR-Trimmed (1.5×IQR beyond Q1/Q3)", trim_stats, r)
r = write_stats_block(ws, "Excluding CD-Freight Bug Estimates", noc_stats, r)
r = write_stats_block(ws, "IQR-Trimmed AND Excluding CD-Freight", both_stats, r)

# Z-Score bands
zbands = pd.cut(
    raw["Z-Score"].dropna(),
    bins=[-np.inf, -3, -2, -1, 0, 1, 2, 3, np.inf],
    labels=["<-3", "-3 to -2", "-2 to -1", "-1 to 0", "0 to 1", "1 to 2", "2 to 3", ">3"],
)
zb_counts = zbands.value_counts().sort_index()
ws.cell(row=r, column=1, value="Z-Score Distribution").font = SUBHDR
r += 1
ws.cell(row=r, column=1, value="Band").font = BOLD
ws.cell(row=r, column=2, value="Count").font = BOLD
r += 1
for band, cnt in zb_counts.items():
    ws.cell(row=r, column=1, value=str(band))
    c = ws.cell(row=r, column=2, value=int(cnt))
    c.number_format = FMT_INT
    r += 1
r += 1

# Callouts
ws.cell(row=r, column=1, value="Notable Callouts").font = SUBHDR
r += 1
cd_est_count = raw.loc[raw["CD Freight Flag"] == "Yes", "SPOT Estimate #"].nunique()
callouts = [
    f"CD-freight bug: {cd_est_count} estimates ({len(cd_rows)} components) use CD- prefix and known freight double-count on estimate 224377 (~$15k). Detailed on \"CD Freight Cut\" sheet.",
    f"IQR outlier count: {(raw['IQR Outlier']=='Yes').sum()} components fall beyond 1.5×IQR of Variance %.",
    f"Records with |Z|>2: {(raw['Z-Score'].abs()>2).sum()} components (see \"Distribution\" sheet).",
    "See \"Print vs No-Print\" for print-mode split; multi-part quotes contribute per-component.",
]
for c in callouts:
    ws.cell(row=r, column=1, value="•  " + c).alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    ws.row_dimensions[r].height = 30
    r += 1

ws.column_dimensions["A"].width = 40
ws.column_dimensions["B"].width = 18
for col in "CDEFGH":
    ws.column_dimensions[col].width = 16


# ---------- Sheet 2: Raw Variances ----------
ws2 = wb.create_sheet("Raw Variances")
write_df(
    ws2,
    raw,
    start_row=1,
    pct_cols=("Variance %",),
    money_cols=("SPOT Component Total", "iQuote Component Total", "Variance $"),
    int_cols=("iQuote Estimate #", "Qty"),
    num_cols=("Z-Score", "Width", "Length"),
)
ws2.auto_filter.ref = ws2.dimensions


# ---------- Sheet 3: Variance by Qty Range ----------
ws3 = wb.create_sheet("By Qty Range")
ws3["A1"] = "Variance by Qty Range — Raw"
ws3["A1"].font = TITLE
write_df(ws3, band_raw, start_row=3,
         pct_cols=("Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev"),
         int_cols=("Count",))
start2 = 3 + len(band_raw) + 4
ws3.cell(row=start2 - 1, column=1, value="Variance by Qty Range — IQR-Trimmed").font = TITLE
write_df(ws3, band_trim, start_row=start2,
         pct_cols=("Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev"),
         int_cols=("Count",))

# Chart: grouped bar — Avg + Median by Qty Band (raw)
qb_chart = BarChart()
qb_chart.type = "col"
qb_chart.style = 11
qb_chart.title = "Avg vs Median Variance % by Qty Band (Raw)"
qb_chart.y_axis.title = "Variance %"
qb_chart.x_axis.title = "Qty Band"
qb_chart.height = 10
qb_chart.width = 22
data_ref = Reference(ws3, min_col=3, max_col=4, min_row=3, max_row=3 + len(band_raw))
cats_ref = Reference(ws3, min_col=1, min_row=4, max_row=3 + len(band_raw))
qb_chart.add_data(data_ref, titles_from_data=True)
qb_chart.set_categories(cats_ref)
ws3.add_chart(qb_chart, "I3")

# Chart: IQR-trimmed comparison
qb_chart2 = BarChart()
qb_chart2.type = "col"
qb_chart2.style = 12
qb_chart2.title = "Avg vs Median Variance % by Qty Band (IQR-Trimmed)"
qb_chart2.y_axis.title = "Variance %"
qb_chart2.x_axis.title = "Qty Band"
qb_chart2.height = 10
qb_chart2.width = 22
data_ref2 = Reference(ws3, min_col=3, max_col=4, min_row=start2, max_row=start2 + len(band_trim))
cats_ref2 = Reference(ws3, min_col=1, min_row=start2 + 1, max_row=start2 + len(band_trim))
qb_chart2.add_data(data_ref2, titles_from_data=True)
qb_chart2.set_categories(cats_ref2)
ws3.add_chart(qb_chart2, "I22")


# ---------- Sheet 4: Qty x Customer pivot ----------
ws4 = wb.create_sheet("Qty x Customer")
ws4["A1"] = "Avg Variance % — Top 15 Customers × Qty Band"
ws4["A1"].font = TITLE
pct_cols_p = tuple([c for c in pivot_df.columns if c not in ("Customer", "Component Count")])
write_df(ws4, pivot_df, start_row=3, pct_cols=pct_cols_p, int_cols=("Component Count",))

# Chart: horizontal bar — each customer's average variance across all bands
cust_avgs = raw[raw["Customer"].isin(top_cust)].groupby("Customer")["Variance %"].mean().reindex(top_cust)
cust_start = 3 + len(pivot_df) + 4
ws4.cell(row=cust_start, column=1, value="Top 15 Customers — Overall Avg Variance %").font = TITLE
ws4.cell(row=cust_start + 1, column=1, value="Customer").font = BOLD
ws4.cell(row=cust_start + 1, column=2, value="Avg Variance %").font = BOLD
ws4.cell(row=cust_start + 1, column=3, value="Component Count").font = BOLD
for i, (c, v) in enumerate(cust_avgs.items(), start=cust_start + 2):
    ws4.cell(row=i, column=1, value=str(c))
    cell = ws4.cell(row=i, column=2, value=None if pd.isna(v) else float(v))
    cell.number_format = FMT_PCT
    n_cell = ws4.cell(row=i, column=3, value=int(raw[raw["Customer"] == c].shape[0]))
    n_cell.number_format = FMT_INT

cust_bar = BarChart()
cust_bar.type = "bar"
cust_bar.style = 10
cust_bar.title = "Avg Variance % — Top 15 Customers (sorted by volume)"
cust_bar.y_axis.title = "Customer"
cust_bar.x_axis.title = "Avg Variance %"
cust_bar.height = 14
cust_bar.width = 22
cust_bar.legend = None
dref = Reference(ws4, min_col=2, min_row=cust_start + 2, max_row=cust_start + 1 + len(cust_avgs))
cref = Reference(ws4, min_col=1, min_row=cust_start + 2, max_row=cust_start + 1 + len(cust_avgs))
cust_bar.add_data(dref, titles_from_data=False)
cust_bar.set_categories(cref)
ws4.add_chart(cust_bar, f"E{cust_start}")


# ---------- Sheet 5: Print vs No-Print ----------
ws5 = wb.create_sheet("Print vs No-Print")
ws5["A1"] = "Print vs No-Print — Component-Level"
ws5["A1"].font = TITLE
write_df(
    ws5,
    print_stats,
    start_row=3,
    pct_cols=("Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev"),
    int_cols=("Count", "SPOT > iQuote", "SPOT < iQuote"),
)
r2 = 3 + len(print_stats) + 4
ws5.cell(row=r2 - 1, column=1, value="Detail by Print Mode").font = TITLE
write_df(
    ws5,
    mode_stats,
    start_row=r2,
    pct_cols=("Avg Variance %", "Median Variance %", "P25", "P75", "Std Dev"),
    int_cols=("Count", "SPOT > iQuote", "SPOT < iQuote"),
)

# Chart: Print vs No-Print — Avg + Median side by side
pn_chart = BarChart()
pn_chart.type = "col"
pn_chart.style = 11
pn_chart.title = "Print vs No-Print — Avg / Median Variance %"
pn_chart.y_axis.title = "Variance %"
pn_chart.x_axis.title = "Print Mode"
pn_chart.height = 10
pn_chart.width = 20
d = Reference(ws5, min_col=3, max_col=4, min_row=3, max_row=3 + len(print_stats))
c = Reference(ws5, min_col=1, min_row=4, max_row=3 + len(print_stats))
pn_chart.add_data(d, titles_from_data=True)
pn_chart.set_categories(c)
ws5.add_chart(pn_chart, "K3")

# Chart: Print Mode detail
pm_chart = BarChart()
pm_chart.type = "col"
pm_chart.style = 12
pm_chart.title = "By Print Mode — Avg / Median Variance %"
pm_chart.y_axis.title = "Variance %"
pm_chart.height = 10
pm_chart.width = 20
d2 = Reference(ws5, min_col=3, max_col=4, min_row=r2, max_row=r2 + len(mode_stats))
c2 = Reference(ws5, min_col=1, min_row=r2 + 1, max_row=r2 + len(mode_stats))
pm_chart.add_data(d2, titles_from_data=True)
pm_chart.set_categories(c2)
ws5.add_chart(pm_chart, "K22")


# ---------- Sheet 6: Distribution (Z-Scores) + chart ----------
ws6 = wb.create_sheet("Distribution")
ws6["A1"] = "Distribution of Variance % — How Quotes Fall from the Mean"
ws6["A1"].font = TITLE
ws6["A2"] = f"Mean = {mean_v:.2f}%   |   Std Dev = {std_v:.2f}%   |   n = {vp.notna().sum()}"
ws6["A2"].font = SUBTITLE

write_df(
    ws6,
    chart_data,
    start_row=4,
    pct_cols=("Variance %",),
    num_cols=("Z-Score",),
    int_cols=("Rank", "iQuote Estimate #"),
)

# scatter chart: Rank (x) vs Variance % (y)
n = len(chart_data)
chart = ScatterChart()
chart.title = "Variance % Distribution (each dot = one component, sorted low→high)"
chart.x_axis.title = "Rank (sorted ascending)"
chart.y_axis.title = "Variance %"
chart.height = 12
chart.width = 24
chart.legend = None

xvals = Reference(ws6, min_col=1, min_row=5, max_row=4 + n)
yvals = Reference(ws6, min_col=5, min_row=5, max_row=4 + n)  # col E = Variance %
series = Series(yvals, xvals, title_from_data=False)
series.marker = Marker(symbol="circle", size=5)
series.graphicalProperties.line.noFill = True
chart.series.append(series)
ws6.add_chart(chart, "H4")

# Histogram-style data helper (for a second view): buckets of variance %
bins = list(range(-100, 401, 25))
labels = [f"{b}%..{b+25}%" for b in bins[:-1]]
hist = pd.cut(vp.dropna(), bins=bins, labels=labels, include_lowest=True).value_counts().sort_index()
hist_start = 4 + n + 3
ws6.cell(row=hist_start, column=1, value="Histogram — Variance % Bucket Counts").font = TITLE
ws6.cell(row=hist_start + 1, column=1, value="Bucket").font = BOLD
ws6.cell(row=hist_start + 1, column=2, value="Count").font = BOLD
for i, (b, c) in enumerate(hist.items(), start=hist_start + 2):
    ws6.cell(row=i, column=1, value=str(b))
    cc = ws6.cell(row=i, column=2, value=int(c))
    cc.number_format = FMT_INT

# Bar chart on histogram
bar = BarChart()
bar.type = "col"
bar.title = "Variance % Histogram"
bar.x_axis.title = "Variance % Bucket"
bar.y_axis.title = "Component Count"
bar.height = 10
bar.width = 24
bar.legend = None
data_ref = Reference(ws6, min_col=2, min_row=hist_start + 2, max_row=hist_start + 1 + len(hist))
cats_ref = Reference(ws6, min_col=1, min_row=hist_start + 2, max_row=hist_start + 1 + len(hist))
bar.add_data(data_ref, titles_from_data=False)
bar.set_categories(cats_ref)
ws6.add_chart(bar, f"H{hist_start}")


# ---------- Sheet 7: CD Freight Cut ----------
ws7 = wb.create_sheet("CD Freight Cut")
ws7["A1"] = "CD-Prefix Estimates — Known Freight Double-Count Bug"
ws7["A1"].font = TITLE
ws7["A2"] = (
    "Estimates 224297, 224362, 224377, 224504 were quoted under initials \"CD\" with manual freight "
    "overrides. On 224377 (~$15,217 freight) SPOT also added freight as a separate line — double-counting."
)
ws7["A2"].font = SUBTITLE
ws7.merge_cells("A2:H2")

write_df(
    ws7,
    cd_rows.drop(columns=["CD Freight Flag"]),
    start_row=4,
    pct_cols=("Variance %",),
    money_cols=("SPOT Component Total", "iQuote Component Total", "Variance $"),
    int_cols=("iQuote Estimate #", "Qty"),
    num_cols=("Z-Score", "Width", "Length"),
)

# Restated exec summary excluding CD freight rows
r_e = 4 + len(cd_rows) + 4
ws7.cell(row=r_e, column=1, value="Restated Exec Summary — Excluding CD-Freight Components").font = TITLE
r_e += 2
labels = [
    ("Component Count", noc_stats["count"], FMT_INT),
    ("Avg Variance %", noc_stats["mean"], FMT_PCT),
    ("Median Variance %", noc_stats["median"], FMT_PCT),
    ("Std Dev", noc_stats["std"], FMT_PCT),
    ("P25", noc_stats["p25"], FMT_PCT),
    ("P75", noc_stats["p75"], FMT_PCT),
    ("SPOT > iQuote (count)", noc_stats["pos"], FMT_INT),
    ("SPOT < iQuote (count)", noc_stats["neg"], FMT_INT),
]
for lbl, val, fmt in labels:
    ws7.cell(row=r_e, column=1, value=lbl).font = BOLD
    c = ws7.cell(row=r_e, column=2, value=None if pd.isna(val) else (float(val) if not isinstance(val, (int, np.integer)) else int(val)))
    c.number_format = fmt
    r_e += 1

# Impact bar: All vs Excluding-CD (Mean, Median, Std Dev)
r_e += 3
ws7.cell(row=r_e, column=1, value="Impact of CD-Freight Bug on Top-Line Stats").font = TITLE
r_e += 1
ws7.cell(row=r_e, column=1, value="Metric").font = BOLD
ws7.cell(row=r_e, column=2, value="All Components").font = BOLD
ws7.cell(row=r_e, column=3, value="Excluding CD-Freight").font = BOLD
metrics = [
    ("Mean Variance %", all_stats["mean"], noc_stats["mean"]),
    ("Median Variance %", all_stats["median"], noc_stats["median"]),
    ("Std Dev %", all_stats["std"], noc_stats["std"]),
]
metric_start = r_e + 1
for i, (lbl, a, b) in enumerate(metrics):
    rr = metric_start + i
    ws7.cell(row=rr, column=1, value=lbl).font = BOLD
    ca = ws7.cell(row=rr, column=2, value=float(a))
    ca.number_format = FMT_PCT
    cb = ws7.cell(row=rr, column=3, value=float(b))
    cb.number_format = FMT_PCT

impact_chart = BarChart()
impact_chart.type = "col"
impact_chart.style = 13
impact_chart.title = "CD-Freight Bug — Impact on Top-Line Variance Stats"
impact_chart.y_axis.title = "Variance %"
impact_chart.height = 10
impact_chart.width = 22
d = Reference(ws7, min_col=2, max_col=3, min_row=r_e, max_row=metric_start + len(metrics) - 1)
c = Reference(ws7, min_col=1, min_row=metric_start, max_row=metric_start + len(metrics) - 1)
impact_chart.add_data(d, titles_from_data=True)
impact_chart.set_categories(c)
ws7.add_chart(impact_chart, f"E{r_e}")


# ============================================================
# Dashboard sheet — prepend at position 0
# ============================================================
dash = wb.create_sheet("Dashboard", 0)
dash["A1"] = "SPOT vs iQuote — Big Picture"
dash["A1"].font = TITLE
dash["A2"] = "Component-level variance. Green shows where the mean drops after removing the CD freight bug."
dash["A2"].font = SUBTITLE
dash.merge_cells("A1:L1")
dash.merge_cells("A2:L2")

# KPI tiles row (rows 4-5)
kpi_row = 4
kpis = [
    ("Components", len(raw), FMT_INT),
    ("Unique Estimates", raw["iQuote Estimate #"].nunique(), FMT_INT),
    ("Mean Variance", all_stats["mean"], FMT_PCT),
    ("Median Variance", all_stats["median"], FMT_PCT),
    ("SPOT > iQuote", all_stats["pos"], FMT_INT),
    ("SPOT < iQuote", all_stats["neg"], FMT_INT),
]
for i, (label, val, fmt) in enumerate(kpis):
    col = 1 + i * 2
    ac = dash.cell(row=kpi_row, column=col, value=label)
    ac.font = SUBHDR
    ac.alignment = CENTER
    vc = dash.cell(row=kpi_row + 1, column=col, value=int(val) if isinstance(val, (int, np.integer)) else float(val))
    vc.font = Font(bold=True, size=18, color="1F4E78")
    vc.number_format = fmt
    vc.alignment = CENTER
    dash.merge_cells(start_row=kpi_row, start_column=col, end_row=kpi_row, end_column=col + 1)
    dash.merge_cells(start_row=kpi_row + 1, start_column=col, end_row=kpi_row + 1, end_column=col + 1)
dash.row_dimensions[kpi_row + 1].height = 30

# Data blocks the charts reference (put below the visible area, hidden columns not needed)
data_start = 30
dash.cell(row=data_start, column=1, value="[chart source data]").font = SUBTITLE

# 1) Direction split
dr = data_start + 1
dash.cell(row=dr, column=1, value="Direction")
dash.cell(row=dr, column=2, value="Count")
dash.cell(row=dr + 1, column=1, value="SPOT > iQuote")
dash.cell(row=dr + 1, column=2, value=int(all_stats["pos"]))
dash.cell(row=dr + 2, column=1, value="SPOT < iQuote")
dash.cell(row=dr + 2, column=2, value=int(all_stats["neg"]))

pie = PieChart()
pie.title = "Where does SPOT land vs iQuote?"
pie.height = 8
pie.width = 12
d = Reference(dash, min_col=2, min_row=dr + 1, max_row=dr + 2)
c = Reference(dash, min_col=1, min_row=dr + 1, max_row=dr + 2)
pie.add_data(d, titles_from_data=False)
pie.set_categories(c)
pie.dataLabels = DataLabelList(showPercent=True, showCatName=True)
dash.add_chart(pie, "A7")

# 2) Impact of CD bug on Mean/Median/Std
ci = dr + 5
dash.cell(row=ci, column=1, value="Metric")
dash.cell(row=ci, column=2, value="All")
dash.cell(row=ci, column=3, value="Ex-CD")
rows_ci = [
    ("Mean", all_stats["mean"], noc_stats["mean"]),
    ("Median", all_stats["median"], noc_stats["median"]),
    ("Std Dev", all_stats["std"], noc_stats["std"]),
]
for i, (lbl, a, b) in enumerate(rows_ci):
    dash.cell(row=ci + 1 + i, column=1, value=lbl)
    dash.cell(row=ci + 1 + i, column=2, value=float(a)).number_format = FMT_PCT
    dash.cell(row=ci + 1 + i, column=3, value=float(b)).number_format = FMT_PCT

impact = BarChart()
impact.type = "col"
impact.style = 13
impact.title = "CD Freight Bug Impact — All vs Excluding-CD"
impact.y_axis.title = "Variance %"
impact.height = 8
impact.width = 12
d = Reference(dash, min_col=2, max_col=3, min_row=ci, max_row=ci + len(rows_ci))
c = Reference(dash, min_col=1, min_row=ci + 1, max_row=ci + len(rows_ci))
impact.add_data(d, titles_from_data=True)
impact.set_categories(c)
dash.add_chart(impact, "G7")

# 3) Histogram — same data as Distribution sheet
hstart = ci + 6
dash.cell(row=hstart, column=1, value="Bucket")
dash.cell(row=hstart, column=2, value="Count")
for i, (b, cnt) in enumerate(hist.items(), start=hstart + 1):
    dash.cell(row=i, column=1, value=str(b))
    dash.cell(row=i, column=2, value=int(cnt))

hist_chart = BarChart()
hist_chart.type = "col"
hist_chart.style = 11
hist_chart.title = "Distribution of Variance % (all components)"
hist_chart.x_axis.title = "Variance % Bucket"
hist_chart.y_axis.title = "Component Count"
hist_chart.height = 9
hist_chart.width = 24
hist_chart.legend = None
d = Reference(dash, min_col=2, min_row=hstart + 1, max_row=hstart + len(hist))
c = Reference(dash, min_col=1, min_row=hstart + 1, max_row=hstart + len(hist))
hist_chart.add_data(d, titles_from_data=False)
hist_chart.set_categories(c)
dash.add_chart(hist_chart, "A24")

# 4) By Qty Band — Median Variance
qstart = hstart + len(hist) + 3
dash.cell(row=qstart, column=1, value="Qty Band")
dash.cell(row=qstart, column=2, value="Median")
dash.cell(row=qstart, column=3, value="Avg")
for i, row in band_raw.iterrows():
    dash.cell(row=qstart + 1 + i, column=1, value=row["Qty Band"])
    dash.cell(row=qstart + 1 + i, column=2, value=float(row["Median Variance %"])).number_format = FMT_PCT
    dash.cell(row=qstart + 1 + i, column=3, value=float(row["Avg Variance %"])).number_format = FMT_PCT

qty_chart = BarChart()
qty_chart.type = "col"
qty_chart.style = 12
qty_chart.title = "Where the Gap Sits — by Order Qty Band"
qty_chart.y_axis.title = "Variance %"
qty_chart.x_axis.title = "Qty Band"
qty_chart.height = 9
qty_chart.width = 20
d = Reference(dash, min_col=2, max_col=3, min_row=qstart, max_row=qstart + len(band_raw))
c = Reference(dash, min_col=1, min_row=qstart + 1, max_row=qstart + len(band_raw))
qty_chart.add_data(d, titles_from_data=True)
qty_chart.set_categories(c)
dash.add_chart(qty_chart, "A42")

# 5) Print vs No-Print — Median
pstart = qstart + len(band_raw) + 3
dash.cell(row=pstart, column=1, value="Group")
dash.cell(row=pstart, column=2, value="Median")
dash.cell(row=pstart, column=3, value="Avg")
for i, row in print_stats.iterrows():
    dash.cell(row=pstart + 1 + i, column=1, value=row["Print/No-Print"])
    dash.cell(row=pstart + 1 + i, column=2, value=float(row["Median Variance %"])).number_format = FMT_PCT
    dash.cell(row=pstart + 1 + i, column=3, value=float(row["Avg Variance %"])).number_format = FMT_PCT

pn_chart2 = BarChart()
pn_chart2.type = "col"
pn_chart2.style = 13
pn_chart2.title = "Print vs No-Print"
pn_chart2.y_axis.title = "Variance %"
pn_chart2.height = 9
pn_chart2.width = 16
d = Reference(dash, min_col=2, max_col=3, min_row=pstart, max_row=pstart + len(print_stats))
c = Reference(dash, min_col=1, min_row=pstart + 1, max_row=pstart + len(print_stats))
pn_chart2.add_data(d, titles_from_data=True)
pn_chart2.set_categories(c)
dash.add_chart(pn_chart2, "H42")

# Column widths
dash.column_dimensions["A"].width = 22
for col_letter in "BCDEFGHIJKLM":
    dash.column_dimensions[col_letter].width = 15

# Hide the scratch data area rows (30+) so the dashboard stays clean
for r_hide in range(30, pstart + len(print_stats) + 2):
    dash.row_dimensions[r_hide].hidden = True


wb.save(OUT)
print(f"Wrote {OUT}")
print(f"Rows: {len(raw)}  |  Components matched: {raw['iQuote Component Total'].notna().sum()}")
print(f"Mean variance: {mean_v:.2f}%   Median: {vp.median():.2f}%   Std: {std_v:.2f}%")
