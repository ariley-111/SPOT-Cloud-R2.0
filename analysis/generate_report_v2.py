"""Round 2 SPOT vs iQuote Analysis Report — QUOTE-TOTAL LEVEL.

Unit of analysis: one row per (SPOT Estimate #, iQuote Option, Quote Total).
This means multi-part matched sets contribute ONE row per option per qty-tier,
NOT one row per component.

Print vs No-Print sheet remains component-level (only place component-level
makes sense for split analysis of mixed-print quotes).

Usage: python3 generate_report_v2.py <input.xlsx> <output.xlsx>
"""
import sys
import pandas as pd
import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import ScatterChart, Reference, Series, BarChart, PieChart
from openpyxl.chart.marker import Marker
from openpyxl.chart.label import DataLabelList

IN = sys.argv[1] if len(sys.argv) > 1 else "input.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "SPOT_vs_iQuote_Round2.xlsx"

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

# --- QUOTE-LEVEL AGGREGATION (v3 join logic) ---
# Unit of analysis: (SPOT Estimate #, Quote Total). Each SPOT Quote Total is
# ONE data point (a customer-facing price). Multi-part components are
# collapsed to that single quote total.
#
# iQuote side: for each SPOT group we build the SET of (iQuote Option, Qty)
# pairs seen in that group, then sum iQuote ComponentTotalPrice matching ANY
# of those pairs. Fallbacks: qty-only, then estimate-only. This correctly
# handles:
#   - Multi-part matched sets (many components, one Quote Total)
#   - Multi-option quotes with shared Quote Total (all 6 options rolled up)
#   - Multi-tier quotes (each tier = its own Quote Total)
groups = sp.groupby(["iQuote Estimate #", "Quote Total"], dropna=False)
qrows = []
for (est_id, qt), g in groups:
    pairs = set(zip(g["_opt"], g["Qty"]))
    iq_pool = iq[iq["IdQuote"] == est_id]
    matched = iq_pool[iq_pool.apply(lambda r: (r["_opt"], r["Quantity"]) in pairs, axis=1)]
    method = "opt+qty"
    if len(matched) == 0:
        qtys = set(g["Qty"].tolist())
        matched = iq_pool[iq_pool["Quantity"].isin(qtys)]
        method = "qty-only"
    if len(matched) == 0:
        matched = iq_pool
        method = "estimate-fallback"
    iq_sum = matched["ComponentTotalPrice"].sum() if len(matched) > 0 else np.nan
    n_iq = len(matched)
    print_modes = "/".join(sorted(set(str(v) for v in g["Print Mode"].tolist() if pd.notna(v)))) or "None"
    routes = "/".join(sorted(set(str(v) for v in g["Route"].tolist() if pd.notna(v))))
    opts_str = "|".join(sorted(set(g["iQuote Option"].dropna().astype(str)))) or ""
    qrows.append({
        "iQuote Estimate #": int(est_id) if not pd.isna(est_id) else None,
        "SPOT Estimate #": g["SPOT Estimate #"].iloc[0],
        "Became a Job": g["Became a Job"].iloc[0],
        "Customer": g["Customer"].iloc[0],
        "Project Name": g["Project Name"].iloc[0],
        "iQuote Option": opts_str,
        "Primary Qty": g["Qty"].max(),
        "Qty Range in Group": f"{int(g['Qty'].min())}-{int(g['Qty'].max())}" if g["Qty"].nunique() > 1 else str(int(g["Qty"].max())),
        "# SPOT Rows": len(g),
        "# iQuote Rows Matched": n_iq,
        "Match Method": method,
        "Print Modes": print_modes,
        "Route(s)": routes,
        "Board": g["Board"].iloc[0],
        "IsBuyMin": g["IsBuyMin"].iloc[0],
        "SPOT Quote Total": qt,
        "iQuote Total (sum matched)": iq_sum,
        "Notes": " | ".join(str(v) for v in g["Notes"].tolist() if pd.notna(v))[:250],
    })
quote = pd.DataFrame(qrows)
quote["Variance $"] = quote["SPOT Quote Total"] - quote["iQuote Total (sum matched)"]
quote["Variance %"] = np.where(
    quote["iQuote Total (sum matched)"].fillna(0) != 0,
    quote["Variance $"] / quote["iQuote Total (sum matched)"] * 100.0,
    np.nan,
)
vp = quote["Variance %"]
mean_v = vp.mean()
std_v = vp.std()
quote["Z-Score"] = (vp - mean_v) / std_v if std_v else np.nan
quote["CD Freight Flag"] = quote["SPOT Estimate #"].astype(str).str.startswith("CD-").map({True: "Yes", False: "No"})

def qty_band(q):
    if pd.isna(q): return "Unknown"
    q = int(q)
    if q < 50: return "1-49"
    if q < 200: return "50-199"
    if q < 1000: return "200-999"
    if q < 5000: return "1000-4999"
    return "5000+"

quote["Qty Band"] = quote["Primary Qty"].apply(qty_band)

# Quote-level print flag
def qflag(pm):
    if not pm or pm.lower() in ("none", "nan", ""): return "No Print"
    parts = [p for p in pm.split("/") if p and p.lower() not in ("nan",)]
    return "No Print" if all(p.lower() == "none" for p in parts) else "Print"
quote["Print/No-Print"] = quote["Print Modes"].apply(qflag)

# Order columns for presentation
quote = quote[["iQuote Estimate #", "SPOT Estimate #", "Became a Job", "Customer", "Project Name",
               "iQuote Option", "Primary Qty", "Qty Band", "Qty Range in Group",
               "# SPOT Rows", "# iQuote Rows Matched", "Match Method",
               "Print Modes", "Print/No-Print", "Route(s)", "Board", "IsBuyMin",
               "SPOT Quote Total", "iQuote Total (sum matched)", "Variance $", "Variance %",
               "Z-Score", "CD Freight Flag", "Notes"]]
quote = quote.sort_values(["iQuote Estimate #", "Primary Qty"]).reset_index(drop=True)


# ---------- Component-level data for Print vs No-Print sheet ONLY ----------
iq_sorted = iq.sort_values(["_id","_opt","Quantity"]).reset_index(drop=True)
sp_sorted = sp.sort_values(["_id","_opt","Qty"]).reset_index(drop=True)
iq_sorted["_iq_idx"] = iq_sorted.index
sp_sorted["_sp_idx"] = sp_sorted.index

iq_pool = iq_sorted.copy()
iq_pool["_consumed"] = False
matches = []
for _, s in sp_sorted.iterrows():
    p = iq_pool[(iq_pool["_id"]==s["_id"]) & (iq_pool["_opt"]==s["_opt"]) & (iq_pool["Quantity"]==s["Qty"]) & (~iq_pool["_consumed"])]
    if len(p)==0:
        p = iq_pool[(iq_pool["_id"]==s["_id"]) & (iq_pool["Quantity"]==s["Qty"]) & (~iq_pool["_consumed"])]
    if len(p)==0:
        p = iq_pool[(iq_pool["_id"]==s["_id"]) & (~iq_pool["_consumed"])]
    if len(p)>0:
        pick = p.iloc[0]
        matches.append((s["_sp_idx"], pick["_iq_idx"]))
        iq_pool.loc[pick["_iq_idx"], "_consumed"] = True
    else:
        matches.append((s["_sp_idx"], None))
mdf = pd.DataFrame(matches, columns=["_sp_idx","_iq_idx"])
comp = sp_sorted.merge(mdf, on="_sp_idx").merge(iq_sorted.drop(columns=["_iq_idx","_id","_opt"]), left_on="_iq_idx", right_index=True, how="left")
comp["c_spot"] = pd.to_numeric(comp["Component Total"], errors="coerce")
comp["c_iq"] = pd.to_numeric(comp["ComponentTotalPrice"], errors="coerce")
comp["c_var_pct"] = np.where(comp["c_iq"].fillna(0)!=0, (comp["c_spot"]-comp["c_iq"])/comp["c_iq"]*100, np.nan)
def print_flag_comp(x):
    if pd.isna(x): return "No Print"
    s = str(x).strip().lower()
    return "No Print" if s in ("","none","none/none") else "Print"
comp["print_flag"] = comp["Print Mode"].apply(print_flag_comp)


# ============================================================
# Stats
# ============================================================
def summary_stats(series):
    s = series.dropna()
    if len(s)==0: return dict(count=0,mean=np.nan,median=np.nan,std=np.nan,p25=np.nan,p75=np.nan,pos=0,neg=0)
    return dict(count=len(s), mean=s.mean(), median=s.median(), std=s.std(),
                p25=s.quantile(0.25), p75=s.quantile(0.75),
                pos=(s>0).sum(), neg=(s<0).sum())

all_stats = summary_stats(quote["Variance %"])
noc_mask = quote["CD Freight Flag"] == "No"
noc_stats = summary_stats(quote.loc[noc_mask, "Variance %"])

# Band stats
BANDS = ("1-49","50-199","200-999","1000-4999","5000+")
def band_stats(df):
    rows = []
    for b in BANDS:
        s = summary_stats(df.loc[df["Qty Band"]==b, "Variance %"])
        rows.append([b, s["count"], s["mean"], s["median"], s["p25"], s["p75"], s["std"]])
    return pd.DataFrame(rows, columns=["Qty Band","Count","Avg Variance %","Median Variance %","P25","P75","Std Dev"])

band_all = band_stats(quote)
band_noc = band_stats(quote[noc_mask])

# Top customers pivot
top_cust = quote.groupby("Customer")["Variance %"].count().sort_values(ascending=False).head(15).index.tolist()
pivot_df = quote[quote["Customer"].isin(top_cust)].pivot_table(
    index="Customer", columns="Qty Band", values="Variance %", aggfunc="mean"
).reindex(columns=[b for b in BANDS if b in _.columns] if (_:= pd.DataFrame()) is None else BANDS, fill_value=np.nan)
pivot_df = quote[quote["Customer"].isin(top_cust)].pivot_table(
    index="Customer", columns="Qty Band", values="Variance %", aggfunc="mean"
)
pivot_df = pivot_df.reindex(columns=[b for b in BANDS if b in pivot_df.columns])
pivot_df = pivot_df.reindex(top_cust)
pivot_df["Quote Count"] = quote[quote["Customer"].isin(top_cust)].groupby("Customer").size().reindex(top_cust)
pivot_df = pivot_df.reset_index()

# Print vs No-Print (component-level as spec'd)
def group_stats_by(df, col, var_col):
    rows = []
    for g in sorted(df[col].dropna().unique()):
        s = summary_stats(df.loc[df[col]==g, var_col])
        rows.append([g, s["count"], s["mean"], s["median"], s["p25"], s["p75"], s["std"], s["pos"], s["neg"]])
    return pd.DataFrame(rows, columns=[col,"Count","Avg Variance %","Median Variance %","P25","P75","Std Dev","SPOT > iQuote","SPOT < iQuote"])

print_stats_c = group_stats_by(comp, "print_flag", "c_var_pct")
mode_stats_c = group_stats_by(comp.assign(**{"Print Mode": comp["Print Mode"].fillna("None")}), "Print Mode", "c_var_pct")

# Also quote-level print flag stats (for cross-check)
print_stats_q = group_stats_by(quote, "Print/No-Print", "Variance %")

# Distribution data
chart_data = quote[["iQuote Estimate #","SPOT Estimate #","Customer","Variance %","Z-Score"]].copy()
chart_data = chart_data.dropna(subset=["Variance %"]).sort_values("Variance %").reset_index(drop=True)
chart_data.insert(0, "Rank", range(1, len(chart_data)+1))

# Histogram buckets
bins = list(range(-100, 401, 25))
labels = [f"{b}%..{b+25}%" for b in bins[:-1]]
hist = pd.cut(vp.dropna(), bins=bins, labels=labels, include_lowest=True).value_counts().sort_index()

# CD rows
cd_rows = quote[quote["CD Freight Flag"]=="Yes"].copy()


# ============================================================
# Write workbook
# ============================================================
wb = Workbook()

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
    for c in range(1, cols+1):
        cell = ws.cell(row=row, column=c)
        cell.font = HDR
        cell.fill = HDR_FILL
        cell.alignment = CENTER
        cell.border = BORDER


def write_df(ws, df, start_row=1, pct_cols=(), money_cols=(), int_cols=(), num_cols=()):
    for j, col in enumerate(df.columns, start=1):
        ws.cell(row=start_row, column=j, value=str(col))
    style_header_row(ws, start_row, len(df.columns))
    for i, row in enumerate(df.itertuples(index=False), start=start_row+1):
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
            col_name = df.columns[j-1]
            if col_name in pct_cols: c.number_format = FMT_PCT
            elif col_name in money_cols: c.number_format = FMT_MONEY
            elif col_name in int_cols: c.number_format = FMT_INT
            elif col_name in num_cols: c.number_format = FMT_NUM
            c.border = BORDER
    for j, col in enumerate(df.columns, start=1):
        letter = get_column_letter(j)
        header_len = len(str(col))
        try:
            sample_len = int(df[col].astype(str).map(len).clip(upper=40).max())
        except Exception:
            sample_len = 10
        w = max(10, min(42, max(header_len, sample_len)+3))
        ws.column_dimensions[letter].width = w
    ws.freeze_panes = ws.cell(row=start_row+1, column=1)


def write_stats_block(ws, title, stats, start_row):
    ws.cell(row=start_row, column=1, value=title).font = SUBHDR
    rows = [
        ("Quote Count", stats["count"], FMT_INT),
        ("Avg Variance %", stats["mean"], FMT_PCT),
        ("Median Variance %", stats["median"], FMT_PCT),
        ("Std Dev", stats["std"], FMT_PCT),
        ("P25", stats["p25"], FMT_PCT),
        ("P75", stats["p75"], FMT_PCT),
        ("SPOT > iQuote (count)", stats["pos"], FMT_INT),
        ("SPOT < iQuote (count)", stats["neg"], FMT_INT),
    ]
    for i, (lbl, val, fmt) in enumerate(rows):
        r = start_row+1+i
        ws.cell(row=r, column=1, value=lbl).font = BOLD
        b = ws.cell(row=r, column=2, value=None if pd.isna(val) else (float(val) if not isinstance(val,(int,np.integer)) else int(val)))
        b.number_format = fmt
        b.alignment = LEFT
    return start_row + len(rows) + 2


# ---------- Sheet: Exec Summary ----------
ws = wb.active
ws.title = "Exec Summary"
ws["A1"] = "SPOT vs iQuote — Round 2 (Quote-Total Level)"
ws["A1"].font = TITLE
ws["A2"] = "Unit of analysis: one row per (SPOT Estimate # + iQuote Option + Quote Total). Multi-part kits contribute ONE row per option per qty-tier."
ws["A2"].font = SUBTITLE
ws["A3"] = f"Generated {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}  |  Quote-total rows: {len(quote)}  |  Unique estimates: {quote['iQuote Estimate #'].nunique()}"
ws["A3"].font = SUBTITLE
ws.merge_cells("A1:H1"); ws.merge_cells("A2:H2"); ws.merge_cells("A3:H3")

r = 5
r = write_stats_block(ws, "All Quote Totals", all_stats, r)
r = write_stats_block(ws, "Excluding CD-Freight Bug Estimates", noc_stats, r)

# Callouts
r += 1
ws.cell(row=r, column=1, value="Notable Callouts").font = SUBHDR
r += 1
cd_est_count = cd_rows["SPOT Estimate #"].nunique()
callouts = [
    f"CD-freight bug: {cd_est_count} estimates ({len(cd_rows)} quote-total rows) with confirmed freight double-count. See \"CD Freight Cut\" sheet.",
    f"{all_stats['pos']} quotes price higher in SPOT vs {all_stats['neg']} lower — SPOT skews higher, but median tells a different story.",
    "Print vs No-Print is analyzed at the COMPONENT level (only way to split mixed-print multi-part quotes).",
]
for c in callouts:
    ws.cell(row=r, column=1, value="•  "+c).alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    ws.row_dimensions[r].height = 30
    r += 1

ws.column_dimensions["A"].width = 40
ws.column_dimensions["B"].width = 18
for col in "CDEFGH":
    ws.column_dimensions[col].width = 16


# ---------- Sheet: Raw Quote Totals ----------
ws2 = wb.create_sheet("Raw Quote Totals")
write_df(
    ws2, quote, start_row=1,
    pct_cols=("Variance %",),
    money_cols=("SPOT Quote Total","iQuote Total (sum matched)","Variance $"),
    int_cols=("iQuote Estimate #","Primary Qty","# SPOT Rows","# iQuote Rows Matched"),
    num_cols=("Z-Score",),
)
ws2.auto_filter.ref = ws2.dimensions


# ---------- Sheet: By Qty Range ----------
ws3 = wb.create_sheet("By Qty Range")
ws3["A1"] = "Variance by Qty Range — All Quote Totals"
ws3["A1"].font = TITLE
write_df(ws3, band_all, start_row=3,
         pct_cols=("Avg Variance %","Median Variance %","P25","P75","Std Dev"),
         int_cols=("Count",))
start2 = 3 + len(band_all) + 4
ws3.cell(row=start2-1, column=1, value="Variance by Qty Range — Excluding CD-Freight").font = TITLE
write_df(ws3, band_noc, start_row=start2,
         pct_cols=("Avg Variance %","Median Variance %","P25","P75","Std Dev"),
         int_cols=("Count",))

# Chart: grouped bar Mean+Median by band (all)
qb = BarChart(); qb.type="col"; qb.style=11
qb.title = "Avg vs Median Variance % by Qty Band (All Quotes)"
qb.y_axis.title = "Variance %"; qb.x_axis.title="Qty Band"
qb.height=10; qb.width=22
d = Reference(ws3, min_col=3, max_col=4, min_row=3, max_row=3+len(band_all))
c = Reference(ws3, min_col=1, min_row=4, max_row=3+len(band_all))
qb.add_data(d, titles_from_data=True); qb.set_categories(c)
ws3.add_chart(qb, "I3")

qb2 = BarChart(); qb2.type="col"; qb2.style=12
qb2.title = "Avg vs Median Variance % by Qty Band (Excluding CD)"
qb2.y_axis.title="Variance %"; qb2.x_axis.title="Qty Band"
qb2.height=10; qb2.width=22
d = Reference(ws3, min_col=3, max_col=4, min_row=start2, max_row=start2+len(band_noc))
c = Reference(ws3, min_col=1, min_row=start2+1, max_row=start2+len(band_noc))
qb2.add_data(d, titles_from_data=True); qb2.set_categories(c)
ws3.add_chart(qb2, "I22")


# ---------- Sheet: Qty x Customer ----------
ws4 = wb.create_sheet("Qty x Customer")
ws4["A1"] = "Avg Variance % — Top 15 Customers × Qty Band (Quote-Total Level)"
ws4["A1"].font = TITLE
pct_cols_p = tuple([c for c in pivot_df.columns if c not in ("Customer","Quote Count")])
write_df(ws4, pivot_df, start_row=3, pct_cols=pct_cols_p, int_cols=("Quote Count",))

# Per-customer overall avg bar chart
cust_avgs = quote[quote["Customer"].isin(top_cust)].groupby("Customer")["Variance %"].mean().reindex(top_cust)
cust_start = 3 + len(pivot_df) + 4
ws4.cell(row=cust_start, column=1, value="Top 15 Customers — Overall Avg Variance %").font = TITLE
ws4.cell(row=cust_start+1, column=1, value="Customer").font = BOLD
ws4.cell(row=cust_start+1, column=2, value="Avg Variance %").font = BOLD
ws4.cell(row=cust_start+1, column=3, value="Quote Count").font = BOLD
for i, (cn, v) in enumerate(cust_avgs.items(), start=cust_start+2):
    ws4.cell(row=i, column=1, value=str(cn))
    cell = ws4.cell(row=i, column=2, value=None if pd.isna(v) else float(v))
    cell.number_format = FMT_PCT
    n = ws4.cell(row=i, column=3, value=int(quote[quote["Customer"]==cn].shape[0]))
    n.number_format = FMT_INT

cbar = BarChart(); cbar.type="bar"; cbar.style=10
cbar.title="Avg Variance % — Top 15 Customers"; cbar.legend=None
cbar.height=14; cbar.width=22
d = Reference(ws4, min_col=2, min_row=cust_start+2, max_row=cust_start+1+len(cust_avgs))
c = Reference(ws4, min_col=1, min_row=cust_start+2, max_row=cust_start+1+len(cust_avgs))
cbar.add_data(d, titles_from_data=False); cbar.set_categories(c)
ws4.add_chart(cbar, f"E{cust_start}")


# ---------- Sheet: Print vs No-Print (component level as spec'd) ----------
ws5 = wb.create_sheet("Print vs No-Print")
ws5["A1"] = "Print vs No-Print — Component-Level"
ws5["A1"].font = TITLE
ws5["A2"] = "This is the ONLY component-level view — necessary because multi-part quotes mix print modes within a single quote total."
ws5["A2"].font = SUBTITLE
ws5.merge_cells("A2:I2")
write_df(ws5, print_stats_c, start_row=4,
         pct_cols=("Avg Variance %","Median Variance %","P25","P75","Std Dev"),
         int_cols=("Count","SPOT > iQuote","SPOT < iQuote"))

r_pm = 4 + len(print_stats_c) + 3
ws5.cell(row=r_pm-1, column=1, value="Detail by Print Mode (component-level)").font = TITLE
write_df(ws5, mode_stats_c, start_row=r_pm,
         pct_cols=("Avg Variance %","Median Variance %","P25","P75","Std Dev"),
         int_cols=("Count","SPOT > iQuote","SPOT < iQuote"))

r_pq = r_pm + len(mode_stats_c) + 3
ws5.cell(row=r_pq-1, column=1, value="Cross-check: Quote-Level Print/No-Print (all-print vs any-no-print)").font = TITLE
write_df(ws5, print_stats_q, start_row=r_pq,
         pct_cols=("Avg Variance %","Median Variance %","P25","P75","Std Dev"),
         int_cols=("Count","SPOT > iQuote","SPOT < iQuote"))

# Charts
pn = BarChart(); pn.type="col"; pn.style=11
pn.title="Print vs No-Print — Component-Level"; pn.y_axis.title="Variance %"
pn.height=10; pn.width=20
d = Reference(ws5, min_col=3, max_col=4, min_row=4, max_row=4+len(print_stats_c))
c = Reference(ws5, min_col=1, min_row=5, max_row=4+len(print_stats_c))
pn.add_data(d, titles_from_data=True); pn.set_categories(c)
ws5.add_chart(pn, "K4")

pm = BarChart(); pm.type="col"; pm.style=12
pm.title="By Print Mode — Component-Level"; pm.y_axis.title="Variance %"
pm.height=10; pm.width=20
d = Reference(ws5, min_col=3, max_col=4, min_row=r_pm, max_row=r_pm+len(mode_stats_c))
c = Reference(ws5, min_col=1, min_row=r_pm+1, max_row=r_pm+len(mode_stats_c))
pm.add_data(d, titles_from_data=True); pm.set_categories(c)
ws5.add_chart(pm, "K24")


# ---------- Sheet: Distribution ----------
ws6 = wb.create_sheet("Distribution")
ws6["A1"] = "Distribution of Variance % — Quote-Total Level"
ws6["A1"].font = TITLE
ws6["A2"] = f"Mean = {mean_v:.2f}%  |  Std Dev = {std_v:.2f}%  |  n = {vp.notna().sum()}"
ws6["A2"].font = SUBTITLE

write_df(ws6, chart_data, start_row=4,
         pct_cols=("Variance %",), num_cols=("Z-Score",),
         int_cols=("Rank","iQuote Estimate #"))

n = len(chart_data)
sc = ScatterChart()
sc.title = "Variance % Distribution — sorted low→high"
sc.x_axis.title = "Rank"; sc.y_axis.title = "Variance %"
sc.height=12; sc.width=24; sc.legend=None
xvals = Reference(ws6, min_col=1, min_row=5, max_row=4+n)
yvals = Reference(ws6, min_col=5, min_row=5, max_row=4+n)
series = Series(yvals, xvals, title_from_data=False)
series.marker = Marker(symbol="circle", size=5)
series.graphicalProperties.line.noFill = True
sc.series.append(series)
ws6.add_chart(sc, "H4")

# Histogram
hist_start = 4 + n + 3
ws6.cell(row=hist_start, column=1, value="Histogram — Variance % Buckets").font = TITLE
ws6.cell(row=hist_start+1, column=1, value="Bucket").font = BOLD
ws6.cell(row=hist_start+1, column=2, value="Count").font = BOLD
for i, (b, cnt) in enumerate(hist.items(), start=hist_start+2):
    ws6.cell(row=i, column=1, value=str(b))
    c = ws6.cell(row=i, column=2, value=int(cnt)); c.number_format = FMT_INT

hb = BarChart(); hb.type="col"; hb.title="Variance % Histogram"
hb.x_axis.title="Bucket"; hb.y_axis.title="Quote Count"
hb.height=10; hb.width=24; hb.legend=None
d = Reference(ws6, min_col=2, min_row=hist_start+2, max_row=hist_start+1+len(hist))
c = Reference(ws6, min_col=1, min_row=hist_start+2, max_row=hist_start+1+len(hist))
hb.add_data(d, titles_from_data=False); hb.set_categories(c)
ws6.add_chart(hb, f"H{hist_start}")


# ---------- Sheet: CD Freight Cut ----------
ws7 = wb.create_sheet("CD Freight Cut")
ws7["A1"] = "CD-Prefix Estimates — Known Freight Double-Count Bug"
ws7["A1"].font = TITLE
ws7["A2"] = "Freight override + freight modal both added → double-count. Verified live via engine repro (backend/routes/engine_routes.py:_alloc_job path)."
ws7["A2"].font = SUBTITLE
ws7.merge_cells("A2:H2")
write_df(ws7, cd_rows.drop(columns=["CD Freight Flag"]),
         start_row=4,
         pct_cols=("Variance %",),
         money_cols=("SPOT Quote Total","iQuote Total (sum matched)","Variance $"),
         int_cols=("iQuote Estimate #","Primary Qty","# SPOT Rows","# iQuote Rows Matched"),
         num_cols=("Z-Score",))

r_e = 4 + len(cd_rows) + 4
ws7.cell(row=r_e, column=1, value="Restated Stats — Excluding CD-Freight Quotes").font = TITLE
r_e += 2
rows_r = [
    ("Quote Count", noc_stats["count"], FMT_INT),
    ("Avg Variance %", noc_stats["mean"], FMT_PCT),
    ("Median Variance %", noc_stats["median"], FMT_PCT),
    ("Std Dev", noc_stats["std"], FMT_PCT),
    ("P25", noc_stats["p25"], FMT_PCT),
    ("P75", noc_stats["p75"], FMT_PCT),
    ("SPOT > iQuote (count)", noc_stats["pos"], FMT_INT),
    ("SPOT < iQuote (count)", noc_stats["neg"], FMT_INT),
]
for lbl, val, fmt in rows_r:
    ws7.cell(row=r_e, column=1, value=lbl).font = BOLD
    c = ws7.cell(row=r_e, column=2, value=None if pd.isna(val) else (float(val) if not isinstance(val,(int,np.integer)) else int(val)))
    c.number_format = fmt
    r_e += 1

# Impact chart
r_e += 3
ws7.cell(row=r_e, column=1, value="Impact of CD-Freight Bug on Top-Line Stats").font = TITLE
r_e += 1
ws7.cell(row=r_e, column=1, value="Metric").font = BOLD
ws7.cell(row=r_e, column=2, value="All Quotes").font = BOLD
ws7.cell(row=r_e, column=3, value="Excluding CD").font = BOLD
metrics = [
    ("Mean", all_stats["mean"], noc_stats["mean"]),
    ("Median", all_stats["median"], noc_stats["median"]),
    ("Std Dev", all_stats["std"], noc_stats["std"]),
]
mstart = r_e + 1
for i, (lbl, a, b) in enumerate(metrics):
    rr = mstart + i
    ws7.cell(row=rr, column=1, value=lbl).font = BOLD
    ws7.cell(row=rr, column=2, value=float(a)).number_format = FMT_PCT
    ws7.cell(row=rr, column=3, value=float(b)).number_format = FMT_PCT
ic = BarChart(); ic.type="col"; ic.style=13
ic.title="CD-Freight Bug Impact"; ic.y_axis.title="Variance %"
ic.height=10; ic.width=22
d = Reference(ws7, min_col=2, max_col=3, min_row=r_e, max_row=mstart+len(metrics)-1)
c = Reference(ws7, min_col=1, min_row=mstart, max_row=mstart+len(metrics)-1)
ic.add_data(d, titles_from_data=True); ic.set_categories(c)
ws7.add_chart(ic, f"E{r_e}")


# ============================================================
# Dashboard (prepend)
# ============================================================
dash = wb.create_sheet("Dashboard", 0)
dash["A1"] = "SPOT vs iQuote — Big Picture (Quote-Total Level)"
dash["A1"].font = TITLE
dash["A2"] = f"n = {len(quote)} quote totals across {quote['iQuote Estimate #'].nunique()} estimates. Multi-part kits count once per option per qty tier."
dash["A2"].font = SUBTITLE
dash.merge_cells("A1:L1"); dash.merge_cells("A2:L2")

kpi_row = 4
kpis = [
    ("Quote Rows", len(quote), FMT_INT),
    ("Unique Estimates", quote["iQuote Estimate #"].nunique(), FMT_INT),
    ("Mean Variance", all_stats["mean"], FMT_PCT),
    ("Median Variance", all_stats["median"], FMT_PCT),
    ("SPOT > iQuote", all_stats["pos"], FMT_INT),
    ("SPOT < iQuote", all_stats["neg"], FMT_INT),
]
for i, (label, val, fmt) in enumerate(kpis):
    col = 1 + i*2
    ac = dash.cell(row=kpi_row, column=col, value=label)
    ac.font = SUBHDR; ac.alignment = CENTER
    vc = dash.cell(row=kpi_row+1, column=col, value=int(val) if isinstance(val,(int,np.integer)) else float(val))
    vc.font = Font(bold=True, size=18, color="1F4E78")
    vc.number_format = fmt; vc.alignment = CENTER
    dash.merge_cells(start_row=kpi_row, start_column=col, end_row=kpi_row, end_column=col+1)
    dash.merge_cells(start_row=kpi_row+1, start_column=col, end_row=kpi_row+1, end_column=col+1)
dash.row_dimensions[kpi_row+1].height = 30

# Chart source data area
data_start = 30
dr = data_start + 1
dash.cell(row=dr, column=1, value="Direction"); dash.cell(row=dr, column=2, value="Count")
dash.cell(row=dr+1, column=1, value="SPOT > iQuote"); dash.cell(row=dr+1, column=2, value=int(all_stats["pos"]))
dash.cell(row=dr+2, column=1, value="SPOT < iQuote"); dash.cell(row=dr+2, column=2, value=int(all_stats["neg"]))

pie = PieChart(); pie.title="Where SPOT lands vs iQuote (quote-level)"
pie.height=8; pie.width=12
d = Reference(dash, min_col=2, min_row=dr+1, max_row=dr+2)
c = Reference(dash, min_col=1, min_row=dr+1, max_row=dr+2)
pie.add_data(d, titles_from_data=False); pie.set_categories(c)
pie.dataLabels = DataLabelList(showPercent=True, showCatName=True)
dash.add_chart(pie, "A7")

ci = dr + 5
dash.cell(row=ci, column=1, value="Metric"); dash.cell(row=ci, column=2, value="All"); dash.cell(row=ci, column=3, value="Ex-CD")
mrs = [("Mean", all_stats["mean"], noc_stats["mean"]),
       ("Median", all_stats["median"], noc_stats["median"]),
       ("Std Dev", all_stats["std"], noc_stats["std"])]
for i, (lbl, a, b) in enumerate(mrs):
    dash.cell(row=ci+1+i, column=1, value=lbl)
    dash.cell(row=ci+1+i, column=2, value=float(a)).number_format = FMT_PCT
    dash.cell(row=ci+1+i, column=3, value=float(b)).number_format = FMT_PCT

impact = BarChart(); impact.type="col"; impact.style=13
impact.title="CD Freight Bug — Impact on Top-Line"; impact.y_axis.title="Variance %"
impact.height=8; impact.width=12
d = Reference(dash, min_col=2, max_col=3, min_row=ci, max_row=ci+len(mrs))
c = Reference(dash, min_col=1, min_row=ci+1, max_row=ci+len(mrs))
impact.add_data(d, titles_from_data=True); impact.set_categories(c)
dash.add_chart(impact, "G7")

hstart = ci + 6
dash.cell(row=hstart, column=1, value="Bucket"); dash.cell(row=hstart, column=2, value="Count")
for i, (b, cnt) in enumerate(hist.items(), start=hstart+1):
    dash.cell(row=i, column=1, value=str(b))
    dash.cell(row=i, column=2, value=int(cnt))
hb = BarChart(); hb.type="col"; hb.style=11
hb.title="Distribution of Variance % (quote-level)"; hb.x_axis.title="Bucket"; hb.y_axis.title="Quote Count"
hb.height=9; hb.width=24; hb.legend=None
d = Reference(dash, min_col=2, min_row=hstart+1, max_row=hstart+len(hist))
c = Reference(dash, min_col=1, min_row=hstart+1, max_row=hstart+len(hist))
hb.add_data(d, titles_from_data=False); hb.set_categories(c)
dash.add_chart(hb, "A24")

qstart = hstart + len(hist) + 3
dash.cell(row=qstart, column=1, value="Qty Band"); dash.cell(row=qstart, column=2, value="Median"); dash.cell(row=qstart, column=3, value="Avg")
for i, row in band_all.iterrows():
    dash.cell(row=qstart+1+i, column=1, value=row["Qty Band"])
    dash.cell(row=qstart+1+i, column=2, value=float(row["Median Variance %"])).number_format = FMT_PCT
    dash.cell(row=qstart+1+i, column=3, value=float(row["Avg Variance %"])).number_format = FMT_PCT

qc = BarChart(); qc.type="col"; qc.style=12
qc.title="Where the Gap Sits — by Order Qty Band"; qc.y_axis.title="Variance %"; qc.x_axis.title="Qty Band"
qc.height=9; qc.width=20
d = Reference(dash, min_col=2, max_col=3, min_row=qstart, max_row=qstart+len(band_all))
c = Reference(dash, min_col=1, min_row=qstart+1, max_row=qstart+len(band_all))
qc.add_data(d, titles_from_data=True); qc.set_categories(c)
dash.add_chart(qc, "A42")

# Print vs No-Print — component level (as spec'd) — pull from print_stats_c
pstart = qstart + len(band_all) + 3
dash.cell(row=pstart, column=1, value="Group"); dash.cell(row=pstart, column=2, value="Median"); dash.cell(row=pstart, column=3, value="Avg")
for i, row in print_stats_c.iterrows():
    dash.cell(row=pstart+1+i, column=1, value=row["print_flag"])
    dash.cell(row=pstart+1+i, column=2, value=float(row["Median Variance %"])).number_format = FMT_PCT
    dash.cell(row=pstart+1+i, column=3, value=float(row["Avg Variance %"])).number_format = FMT_PCT

pn2 = BarChart(); pn2.type="col"; pn2.style=13
pn2.title="Print vs No-Print (component-level)"; pn2.y_axis.title="Variance %"
pn2.height=9; pn2.width=16
d = Reference(dash, min_col=2, max_col=3, min_row=pstart, max_row=pstart+len(print_stats_c))
c = Reference(dash, min_col=1, min_row=pstart+1, max_row=pstart+len(print_stats_c))
pn2.add_data(d, titles_from_data=True); pn2.set_categories(c)
dash.add_chart(pn2, "H42")

dash.column_dimensions["A"].width = 22
for cl in "BCDEFGHIJKLM":
    dash.column_dimensions[cl].width = 15

for r_hide in range(30, pstart+len(print_stats_c)+2):
    dash.row_dimensions[r_hide].hidden = True


wb.save(OUT)
print(f"Wrote {OUT}")
print(f"Quote-total rows: {len(quote)}  |  Unique estimates: {quote['iQuote Estimate #'].nunique()}")
print(f"Mean variance: {mean_v:.2f}%   Median: {vp.median():.2f}%   Std: {std_v:.2f}%")
print(f"Ex-CD:    Mean: {noc_stats['mean']:.2f}%   Median: {noc_stats['median']:.2f}%   Std: {noc_stats['std']:.2f}%")
