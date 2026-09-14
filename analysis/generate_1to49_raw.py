"""Raw 1-49 qty band export for review."""
import os, shutil
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from collections import defaultdict

ANALYSIS_DIR = "/app/analysis"
STATIC_DIR = "/app/backend/static_assets"
OUT_FILE = "SPOT_1to49_RawJoined.xlsx"

# Load matched
wb_src = openpyxl.load_workbook(os.path.join(STATIC_DIR, "SPOT_JobType_Variance_v3.xlsx"), data_only=False)
ws = wb_src["All Matched"]
h = [c.value for c in ws[1]]
matched = [dict(zip(h, r)) for r in ws.iter_rows(min_row=2, values_only=True)]

# Load input for dimensions/board
wb_in = openpyxl.load_workbook(os.path.join(ANALYSIS_DIR, "input.xlsx"), data_only=True)
sp = wb_in["SPOT Data"]
sph = [c.value for c in sp[1]]
sp_rows = [dict(zip(sph, r)) for r in sp.iter_rows(min_row=2, values_only=True)]
# key = (iQuote#, SPOT est#, qty, close-$)
sp_lookup = defaultdict(list)
for r in sp_rows:
    q = r.get("iQuote Estimate #")
    if q:
        sp_lookup[(q, r.get("Qty"))].append(r)

# Load spot_full for cost breakdown
wb_full = openpyxl.load_workbook(os.path.join(ANALYSIS_DIR, "spot_full.xlsx"), data_only=True)
wf = wb_full["Testing Comparison"]
wfh = [c.value for c in wf[1]]
sf_lookup = defaultdict(list)
for r in wf.iter_rows(min_row=2, values_only=True):
    d = dict(zip(wfh, r))
    try: q = int(d.get("iQuote #") or 0) or None
    except (ValueError, TypeError): q = None
    if q:
        sf_lookup[(q, d.get("One-Up W"), d.get("One-Up L"))].append(d)

# Filter to 1-49 band
in_band = [r for r in matched if r["Qty Band"] == "1-49"]
# Enrich with dims/board/costs
for r in in_band:
    # find matching SPOT input row by (iQuote, qty, price close)
    candidates = sp_lookup.get((r["iQuote #"], r["Qty"]), [])
    best = None; best_diff = 1e12
    for c in candidates:
        diff = abs((c.get("Component Total") or 0) - (r["SPOT $"] or 0))
        if diff < best_diff:
            best = c; best_diff = diff
    if best:
        r["W"] = best.get("Width"); r["L"] = best.get("Length")
        r["Board"] = best.get("Board"); r["Sheet"] = best.get("Sheet")
        r["PrintMode"] = best.get("Print Mode"); r["Route"] = best.get("Route")
    sf_rows = sf_lookup.get((r["iQuote #"], r.get("W"), r.get("L")), [])
    r["Print $"] = max((s.get("Print Cost") or 0) for s in sf_rows) if sf_rows else 0
    r["Cut $"] = max((s.get("Cutting Cost") or 0) for s in sf_rows) if sf_rows else 0
    r["Strip $"] = max((s.get("Strip Cost") or 0) for s in sf_rows) if sf_rows else 0
    r["Glue $"] = max((s.get("Glue Cost") or 0) for s in sf_rows) if sf_rows else 0
    r["Tape $"] = max((s.get("Tape Cost") or 0) for s in sf_rows) if sf_rows else 0

# Sort by job type -> qty -> δ%
in_band.sort(key=lambda r: (r["Job Type"], r["Qty"], -(r["Δ %"] or 0)))

# Write workbook
wb = openpyxl.Workbook()
ws_out = wb.active
ws_out.title = "1-49 Raw Joined"

HDR_FILL = PatternFill("solid", fgColor="1F4E78")
HDR_FONT = Font(bold=True, color="FFFFFF")
JT_FILL = {
    "Cut Only": PatternFill("solid", fgColor="FFF2CC"),
    "Print + Cut": PatternFill("solid", fgColor="D0E0E3"),
    "Print + Cut + Finishing": PatternFill("solid", fgColor="D9EAD3"),
}

cols = [
    "iQuote #", "SPOT Estimate #", "Project", "Customer",
    "Job Type", "Component (SPOT)", "iQuote Product",
    "Qty", "W", "L", "Board", "Sheet", "Print Mode", "Route",
    "SPOT $", "iQuote $", "Δ $", "Δ %",
    "Print Cost", "Cut Cost", "Strip Cost", "Glue Cost", "Tape Cost",
]
for c, label in enumerate(cols, start=1):
    cell = ws_out.cell(row=1, column=c, value=label)
    cell.fill = HDR_FILL; cell.font = HDR_FONT
    cell.alignment = Alignment(horizontal="center", vertical="center")

for i, r in enumerate(in_band, start=2):
    for c, key in enumerate(cols, start=1):
        if key == "Component (SPOT)":
            v = r.get("Component")
        elif key == "Print Cost": v = r.get("Print $")
        elif key == "Cut Cost": v = r.get("Cut $")
        elif key == "Strip Cost": v = r.get("Strip $")
        elif key == "Glue Cost": v = r.get("Glue $")
        elif key == "Tape Cost": v = r.get("Tape $")
        else:
            v = r.get(key)
        cell = ws_out.cell(row=i, column=c, value=v)
        # Formatting
        if key in ("SPOT $","iQuote $","Δ $","Print Cost","Cut Cost","Strip Cost","Glue Cost","Tape Cost") and isinstance(v,(int,float)):
            cell.number_format = '"$"#,##0.00'
        elif key == "Δ %" and isinstance(v,(int,float)):
            cell.number_format = "0.00%"
        # Row fill by job type
        jt = r.get("Job Type")
        if jt in JT_FILL and c <= 7:
            cell.fill = JT_FILL[jt]

# Widths
widths = [10, 18, 40, 28, 24, 40, 30, 8, 10, 10, 14, 14, 14, 12, 12, 12, 12, 10, 12, 12, 12, 12, 12]
for i, w in enumerate(widths, start=1):
    ws_out.column_dimensions[get_column_letter(i)].width = w
ws_out.freeze_panes = "A2"

# Also add a Summary tab at end
ws_sum = wb.create_sheet("Summary")
ws_sum["A1"] = "1-49 Qty Band — Summary"
ws_sum["A1"].font = Font(bold=True, size=14, color="1F4E78")
import statistics
row = 3
for jt in ["Cut Only", "Print + Cut", "Print + Cut + Finishing"]:
    group = [r for r in in_band if r["Job Type"] == jt]
    if not group: continue
    pcts = [r["Δ %"]*100 for r in group]
    ws_sum.cell(row=row, column=1, value=jt).font = Font(bold=True)
    ws_sum.cell(row=row, column=2, value=f"n = {len(group)}")
    ws_sum.cell(row=row, column=3, value=f"Median: {statistics.median(pcts):+.2f}%")
    ws_sum.cell(row=row, column=4, value=f"Mean: {statistics.mean(pcts):+.2f}%")
    ws_sum.cell(row=row, column=5, value=f"Min: {min(pcts):+.1f}%")
    ws_sum.cell(row=row, column=6, value=f"Max: {max(pcts):+.1f}%")
    row += 1

for i, w in enumerate([28, 12, 22, 22, 18, 18], start=1):
    ws_sum.column_dimensions[get_column_letter(i)].width = w

local_path = os.path.join(ANALYSIS_DIR, OUT_FILE)
wb.save(local_path)
os.makedirs(STATIC_DIR, exist_ok=True)
shutil.copy(local_path, os.path.join(STATIC_DIR, OUT_FILE))
print(f"Wrote: {local_path}")
print(f"Rows exported: {len(in_band)}")

# Print summary to console too
from collections import Counter
print(f"\nJob type breakdown in 1-49:")
for jt, n in Counter(r["Job Type"] for r in in_band).most_common():
    print(f"  {jt}: {n}")
