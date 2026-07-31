import csv, statistics
import openpyxl
from collections import defaultdict
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.chart import BarChart, ScatterChart, Reference, Series
from openpyxl.utils import get_column_letter

import sys
sys.path.insert(0, '/app/analysis/spotiq')
from matcher import matches, JOBS, spot_cat, iq_cat, act_cat, spot_rows, f

CATS = ['Material', 'Print', 'Cutting', 'Strip', 'Glue', 'Freight']
OUTLIER_NOTES = {
    ('RW-260723-084853', '8'): "Eggcrate component anomaly: SPOT $9,570 vs iQuote $523 (~18x) on 'Bottom Shelf Eggcrate & 4th Roll Up' (Saber + D/C route). Other components on quote are +20-35%. Suspected SPOT setup/route bug — under investigation.",
    ('RW-260723-084853', '15'): "Same eggcrate anomaly ($7,840 vs $648). SPOT prices qty 8 HIGHER than qty 15 — inverted, confirms something is wrong in that component.",
    ('RW-260720-082503', '918+1750'): "Modeling mismatch: SPOT priced ONE header at 2 qty tiers; iQuote priced TWO distinct products (222300 + 222301) as a kit. BECAME A JOB at iQuote's $16,354 — verify the SPOT estimate captured both items before treating as engine error.",
}

import re
for m in matches:
    m['dpct'] = (m['spot_sell'] - m['iq_sell']) / m['iq_sell'] * 100 if m['iq_sell'] else 0
    m['cdpct'] = (m['spot_cost'] - m['iq_cost']) / m['iq_cost'] * 100 if m['iq_cost'] else 0
    m['outlier'] = (m['est'], m['qty']) in OUTLIER_NOTES
    m['verdict'] = 'PASS' if abs(m['dpct']) <= 10 else ('REVIEW' if abs(m['dpct']) <= 20 else 'FAIL')
    m['rep_qty'] = int(re.search(r'\d+', str(m['qty'])).group())
matches.sort(key=lambda m: abs(m['dpct']), reverse=True)
clean = [m for m in matches if not m['outlier']]

GREEN = PatternFill('solid', start_color='D9EAD3')
AMBER = PatternFill('solid', start_color='FFF3CD')
RED = PatternFill('solid', start_color='F4CCCC')
HDRF = PatternFill('solid', start_color='1F3864')
HDR_F = Font(bold=True, color='FFFFFF', size=10)
TITLE = Font(bold=True, size=14, color='1F3864')
SUB = Font(bold=True, size=11, color='1F3864')
THIN_FONT = Font(size=9)
VFILL = {'PASS': GREEN, 'REVIEW': AMBER, 'FAIL': RED}

wb = openpyxl.Workbook()


def style_header(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HDRF
        cell.font = HDR_F
        cell.alignment = Alignment(wrap_text=True, vertical='center')


def stats_block(ws, r, label, ms):
    d = [m['dpct'] for m in ms]
    cd = [m['cdpct'] for m in ms]
    jd = [m['dpct'] for m in ms if m['job'] == 'Yes']
    rows = [
        (label, ''),
        ('Scenarios compared', len(ms)),
        ('Sell Delta % median (+ = SPOT higher)', f"{statistics.median(d):+.1f}%"),
        ('Sell Delta % mean', f"{statistics.mean(d):+.1f}%"),
        ('Direct-cost Delta % median *', f"{statistics.median(cd):+.1f}%"),
        ('Within +/-10% (PASS)', f"{sum(1 for x in d if abs(x) <= 10)} of {len(d)}"),
        ('Within +/-20% (PASS+REVIEW)', f"{sum(1 for x in d if abs(x) <= 20)} of {len(d)}"),
        ('Became-a-Job only: n / median Delta %', f"{len(jd)} / {statistics.median(jd):+.1f}%"),
    ]
    for i, (a, b) in enumerate(rows):
        ws.cell(row=r + i, column=1, value=a).font = SUB if i == 0 else Font(size=10)
        ws.cell(row=r + i, column=2, value=b).font = Font(size=10, bold=(i == 0))
    return r + len(rows) + 1


# ── 1. SUMMARY ──
ws = wb.active
ws.title = 'Summary'
ws.column_dimensions['A'].width = 42
ws.column_dimensions['B'].width = 22
for col in 'CDEF':
    ws.column_dimensions[col].width = 14
ws['A1'] = 'SPOT vs iQuote — Pricing Accuracy Comparison'
ws['A1'].font = TITLE
ws['A2'] = ('Method: 38 flagged SPOT estimates matched to 34 iQuote quotes (49 comparable scenarios) by iQuote #, qty tier and route/option. '
            'Verdict thresholds mirror legacy parity testing: PASS <= +/-10%, REVIEW <= +/-20%, FAIL > +/-20%. '
            '* Direct cost = Material+Print+Cutting+Strip+Glue+Freight summed identically on BOTH sides (iQuote TotalActualCost is NOT used for cost comparison — it contains uncategorized cost with no SPOT counterpart).')
ws['A2'].font = Font(size=9, italic=True)
ws['A2'].alignment = Alignment(wrap_text=True)
ws.row_dimensions[2].height = 52
ws.merge_cells('A2:F2')

r = stats_block(ws, 4, 'ALL MATCHED SCENARIOS (incl. outliers)', matches)
r = stats_block(ws, r, 'EXCLUDING 3 OUTLIER SCENARIOS (see Outliers tab)', clean)

ws.cell(row=r, column=1, value='CATEGORY COST TOTALS — outliers excluded').font = SUB
r += 1
cat_hdr = ['Category', 'SPOT $', 'iQuote $', 'Delta %', 'Note']
for c, h in enumerate(cat_hdr, 1):
    ws.cell(row=r, column=c, value=h)
style_header(ws, r, len(cat_hdr))
cat_notes = {
    'Material': 'SPOT board book is +6.5% vs iQuote era; like-for-like ~ -11%. Actuals: SPOT within +/-10% of real cost',
    'Print': 'vs ACTUALS: SPOT -14%, iQuote -49% — iQuote under-costs print; SPOT close to reality',
    'Cutting': 'BOTH systems under actuals (~-32/-41%) — legacy-inherited cut speed; fix bookmarked (Cutting Deep-Dive tab)',
    'Strip': 'Verify what iQuote HandStrip includes before concluding',
    'Glue': 'Small dollars',
    'Freight': 'Well aligned',
}
r += 1
for k in CATS:
    sp = sum(m['scats'][k] for m in clean)
    iqv = sum(m['icats'][k] for m in clean)
    dd = (sp - iqv) / iqv * 100 if iqv else 0
    vals = [k, round(sp, 2), round(iqv, 2), f"{dd:+.1f}%", cat_notes[k]]
    for c, v in enumerate(vals, 1):
        ws.cell(row=r, column=c, value=v).font = Font(size=10)
    if abs(dd) > 20:
        ws.cell(row=r, column=4).fill = RED if abs(dd) > 30 else AMBER
    r += 1
r += 1

d_all = [m['dpct'] for m in clean]
cd_all = [m['cdpct'] for m in clean]
findings = [
    'KEY FINDINGS',
    f"1. SPOT prices a median {statistics.median(d_all):+.1f}% vs iQuote (outliers excluded); direct-cost delta median {statistics.median(cd_all):+.1f}%.",
    '2. Ground truth (9 produced jobs): invoiced $18,131 vs actual cost $22,305 = -23% margin; 5 of 9 lost money. At SPOT prices ($21,277) the work is near break-even (-5%). iQuote has been winning work below cost.',
    '3. vs ACTUALS: SPOT is closer than iQuote in every category (Material +/-10%, Print -14% vs -49%, Cutting -32% vs -41%).',
    '4. Cutting under-costing is legacy-inherited (650 in/min assumed vs ~165 real). Fix = two admin values, BOOKMARKED pending leadership.',
    '5. Small quantities (<=50) skew SPOT-high (+45-88%); a few large die-cut kits run SPOT-low (-16 to -34%).',
    '6. Outliers: eggcrate component anomaly (~18x, suspected bug, not yet traced) and one kit modeling mismatch that became a job at ~2x SPOT price.',
]
for line in findings:
    ws.cell(row=r, column=1, value=line).font = SUB if line == 'KEY FINDINGS' else Font(size=10)
    ws.cell(row=r, column=1).alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    ws.row_dimensions[r].height = 26 if line != 'KEY FINDINGS' else 14
    r += 1

# ── 2/3. MATCHED TABLES ──
COLS = ['SPOT Estimate #', 'iQuote #', 'Became Job', 'Qty', 'iQuote Option', 'SPOT Sell $', 'iQuote Sell $',
        'Delta $', 'Delta %', 'SPOT Direct Cost $', 'iQuote Direct Cost $', 'Cost Delta %', 'Verdict', 'Outlier', 'Note']


def write_table(ws, ms):
    ws.append(COLS)
    style_header(ws, 1, len(COLS))
    for m in ms:
        note = OUTLIER_NOTES.get((m['est'], m['qty']), m['note'])
        ws.append([m['est'], m['iq'], m['job'], m['qty'], m['opt'],
                   round(m['spot_sell'], 2), round(m['iq_sell'], 2),
                   round(m['spot_sell'] - m['iq_sell'], 2), round(m['dpct'], 1),
                   round(m['spot_cost'], 2), round(m['iq_cost'], 2), round(m['cdpct'], 1),
                   m['verdict'], 'YES' if m['outlier'] else '', note])
        rr = ws.max_row
        ws.cell(row=rr, column=13).fill = VFILL[m['verdict']]
        if m['outlier']:
            ws.cell(row=rr, column=14).fill = RED
        for c in range(1, len(COLS) + 1):
            ws.cell(row=rr, column=c).font = THIN_FONT
    ws.freeze_panes = 'A2'
    widths = [17, 9, 8, 11, 22, 11, 11, 10, 8, 12, 13, 9, 9, 8, 50]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.append([])
    ws.append(['Direct cost = Material+Print+Cutting+Strip+Glue+Freight categories summed identically on both sides. iQuote TotalActualCost is not used (contains uncategorized cost with no SPOT counterpart).'])
    ws.cell(row=ws.max_row, column=1).font = Font(size=8, italic=True)


write_table(wb.create_sheet('Matched Quotes (All)'), matches)
write_table(wb.create_sheet('Excl. Outliers'), clean)

# ── 4. OUTLIERS ──
ws = wb.create_sheet('Outliers')
ws['A1'] = 'Outlier Scenarios — excluded from the clean run'
ws['A1'].font = TITLE
ws.append([])
ws.append(COLS[:13] + ['Explanation'])
style_header(ws, 3, 14)
for m in [m for m in matches if m['outlier']]:
    ws.append([m['est'], m['iq'], m['job'], m['qty'], m['opt'],
               round(m['spot_sell'], 2), round(m['iq_sell'], 2),
               round(m['spot_sell'] - m['iq_sell'], 2), round(m['dpct'], 1),
               round(m['spot_cost'], 2), round(m['iq_cost'], 2), round(m['cdpct'], 1),
               m['verdict'], OUTLIER_NOTES[(m['est'], m['qty'])]])
    rr = ws.max_row
    ws.cell(row=rr, column=13).fill = RED
    ws.cell(row=rr, column=14).alignment = Alignment(wrap_text=True)
    ws.row_dimensions[rr].height = 55
    for c in range(1, 15):
        ws.cell(row=rr, column=c).font = THIN_FONT
for i, w in enumerate([17, 9, 8, 11, 20, 11, 11, 10, 8, 12, 13, 9, 9, 75], 1):
    ws.column_dimensions[get_column_letter(i)].width = w

# ── 5. CHARTS ──
ws = wb.create_sheet('Charts')
ws['A1'] = 'Decision Charts (outliers excluded)'
ws['A1'].font = TITLE
bins = [(-100, -30, '< -30%'), (-30, -20, '-30 to -20%'), (-20, -10, '-20 to -10%'), (-10, 0, '-10 to 0%'),
        (0, 10, '0 to +10%'), (10, 20, '+10 to +20%'), (20, 30, '+20 to +30%'), (30, 50, '+30 to +50%'), (50, 999, '> +50%')]
hist_start = 5
ws.cell(row=hist_start - 1, column=1, value='Bin').font = Font(bold=True)
ws.cell(row=hist_start - 1, column=2, value='Quotes')
for i, (lo, hi, lab) in enumerate(bins):
    ws.cell(row=hist_start + i, column=1, value=lab)
    ws.cell(row=hist_start + i, column=2, value=sum(1 for m in clean if lo <= m['dpct'] < hi))
ch = BarChart()
ch.title = 'Distribution of Sell Delta % (SPOT vs iQuote) — target: clustered at 0'
ch.height, ch.width = 9, 18
ch.add_data(Reference(ws, min_col=2, min_row=hist_start - 1, max_row=hist_start + len(bins) - 1), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=hist_start, max_row=hist_start + len(bins) - 1))
ch.legend = None
ws.add_chart(ch, 'D3')

sc_start = hist_start + len(bins) + 3
ws.cell(row=sc_start - 1, column=1, value='iQuote Sell $').font = Font(bold=True)
ws.cell(row=sc_start - 1, column=2, value='SPOT Sell $')
for i, m in enumerate(clean):
    ws.cell(row=sc_start + i, column=1, value=round(m['iq_sell'], 2))
    ws.cell(row=sc_start + i, column=2, value=round(m['spot_sell'], 2))
mx = max(max(m['iq_sell'], m['spot_sell']) for m in clean)
ws.cell(row=sc_start, column=3, value=0)
ws.cell(row=sc_start + 1, column=3, value=round(mx, 0))
ws.cell(row=sc_start, column=4, value=0)
ws.cell(row=sc_start + 1, column=4, value=round(mx, 0))
sch = ScatterChart()
sch.title = 'SPOT vs iQuote sell price — points above the line = SPOT higher'
sch.x_axis.title = 'iQuote Sell $'
sch.y_axis.title = 'SPOT Sell $'
sch.height, sch.width = 12, 18
xs = Reference(ws, min_col=1, min_row=sc_start, max_row=sc_start + len(clean) - 1)
ys = Reference(ws, min_col=2, min_row=sc_start, max_row=sc_start + len(clean) - 1)
s1 = Series(ys, xs, title='Quotes')
s1.marker.symbol = 'circle'
s1.graphicalProperties.line.noFill = True
xl = Reference(ws, min_col=3, min_row=sc_start, max_row=sc_start + 1)
yl = Reference(ws, min_col=4, min_row=sc_start, max_row=sc_start + 1)
sch.series.append(s1)
sch.series.append(Series(yl, xl, title='Perfect match (y=x)'))
ws.add_chart(sch, 'D22')

qb_start = sc_start + len(clean) + 3
buckets = [(0, 50, '<= 50'), (51, 250, '51-250'), (251, 600, '251-600'), (601, 10**9, '> 600')]
ws.cell(row=qb_start - 1, column=1, value='Qty bucket').font = Font(bold=True)
ws.cell(row=qb_start - 1, column=2, value='Median Sell Delta %')
for i, (lo, hi, lab) in enumerate(buckets):
    ds = [m['dpct'] for m in clean if lo <= m['rep_qty'] <= hi]
    ws.cell(row=qb_start + i, column=1, value=lab)
    ws.cell(row=qb_start + i, column=2, value=round(statistics.median(ds), 1) if ds else 0)
ch2 = BarChart()
ch2.title = 'Median Sell Delta % by quantity — SPOT premium concentrates at small runs'
ch2.height, ch2.width = 9, 18
ch2.add_data(Reference(ws, min_col=2, min_row=qb_start - 1, max_row=qb_start + len(buckets) - 1), titles_from_data=True)
ch2.set_categories(Reference(ws, min_col=1, min_row=qb_start, max_row=qb_start + len(buckets) - 1))
ch2.legend = None
ws.add_chart(ch2, 'D47')

cb_start = qb_start + len(buckets) + 3
ws.cell(row=cb_start - 1, column=1, value='Category').font = Font(bold=True)
ws.cell(row=cb_start - 1, column=2, value='SPOT $')
ws.cell(row=cb_start - 1, column=3, value='iQuote $')
for i, k in enumerate(CATS):
    ws.cell(row=cb_start + i, column=1, value=k)
    ws.cell(row=cb_start + i, column=2, value=round(sum(m['scats'][k] for m in clean), 2))
    ws.cell(row=cb_start + i, column=3, value=round(sum(m['icats'][k] for m in clean), 2))
ch3 = BarChart()
ch3.title = 'Estimated cost by category — SPOT vs iQuote'
ch3.height, ch3.width = 9, 18
ch3.add_data(Reference(ws, min_col=2, max_col=3, min_row=cb_start - 1, max_row=cb_start + len(CATS) - 1), titles_from_data=True)
ch3.set_categories(Reference(ws, min_col=1, min_row=cb_start, max_row=cb_start + len(CATS) - 1))
ws.add_chart(ch3, 'D66')
ws.column_dimensions['A'].width = 14
ws.column_dimensions['B'].width = 18
ws.column_dimensions['C'].width = 12

# ── 6. ACTUALS 3-WAY ──
ws = wb.create_sheet('Actuals 3-Way')
ws['A1'] = 'Three-Way: iQuote estimate vs SPOT estimate vs ACTUAL job cost (9 produced jobs)'
ws['A1'].font = TITLE
ws['A2'] = ('Ground-truth check. Per-category comparison uses identical category definitions on all three sides. '
            'DIRECT TOTAL = Material+Print+Cutting+Hand (freight excluded: actuals pull has no freight; die shown separately). '
            'Caveats: small sample; actuals may include overs/rework; hand-labor actuals are $0 on every job (likely absorbed elsewhere in MIS costing).')
ws['A2'].font = Font(size=9, italic=True)
ws['A2'].alignment = Alignment(wrap_text=True)
ws.merge_cells('A2:J2')
ws.row_dimensions[2].height = 40

r = 4
cols = ['MIS Job', 'SPOT Est / iQuote #', 'Category', 'SPOT Est $', 'iQuote Est $', 'ACTUAL $', 'SPOT vs Actual', 'iQuote vs Actual', 'Note']
for c, h in enumerate(cols, 1):
    ws.cell(row=r, column=c, value=h)
style_header(ws, r, len(cols))
r += 1
ACATS = ['Material', 'Print', 'Cutting', 'Hand', 'Die']


def pct(x, base):
    return f"{(x - base) / base * 100:+.0f}%" if base else 'n/a'


for job_id, est, sq, qid, opt, iqq, note in JOBS:
    s, i, a = spot_cat(est, sq), iq_cat(qid, opt, iqq), act_cat(job_id)
    first = True
    for k in ACATS + ['DIRECT TOTAL']:
        if k == 'DIRECT TOTAL':
            sv = sum(s[x] for x in ['Material', 'Print', 'Cutting', 'Hand'])
            iv = sum(i[x] for x in ['Material', 'Print', 'Cutting', 'Hand'])
            av = sum(a[x] for x in ['Material', 'Print', 'Cutting', 'Hand'])
        else:
            sv, iv, av = s[k], i[k], a[k]
        ws.append([job_id if first else '', f"{est} / {qid}" if first else '', k,
                   round(sv, 2), round(iv, 2), round(av, 2), pct(sv, av), pct(iv, av), note if first else ''])
        rr = ws.max_row
        for c in range(1, 10):
            ws.cell(row=rr, column=c).font = Font(size=9, bold=k.startswith('DIRECT'))
        if av:
            for c, v in ((7, sv), (8, iv)):
                dd = abs((v - av) / av * 100)
                ws.cell(row=rr, column=c).fill = GREEN if dd <= 15 else (AMBER if dd <= 30 else RED)
        first = False
    ws.append([])
r = ws.max_row + 1

ws.cell(row=r, column=1, value='INVOICED PRICE vs ACTUAL COST — would SPOT prices have been viable?').font = SUB
r += 1
cols2 = ['MIS Job', 'Invoiced $', 'SPOT Would-Be $', 'ACTUAL Cost $', 'Margin as Invoiced', 'Margin at SPOT Price']
for c, h in enumerate(cols2, 1):
    ws.cell(row=r, column=c, value=h)
style_header(ws, r, len(cols2))
r += 1
tot = [0, 0, 0]
for job_id, est, sq, qid, opt, iqq, note in JOBS:
    s, a = spot_cat(est, sq), act_cat(job_id)
    inv, sp, cost = a['Sell'], s['Sell'], a['Total']
    tot[0] += inv; tot[1] += sp; tot[2] += cost
    m1, m2 = (inv - cost) / inv * 100, (sp - cost) / sp * 100
    ws.append([job_id, round(inv, 2), round(sp, 2), round(cost, 2), f"{m1:+.0f}%", f"{m2:+.0f}%"])
    rr = ws.max_row
    ws.cell(row=rr, column=5).fill = GREEN if m1 > 10 else (AMBER if m1 > 0 else RED)
    ws.cell(row=rr, column=6).fill = GREEN if m2 > 10 else (AMBER if m2 > 0 else RED)
    for c in range(1, 7):
        ws.cell(row=rr, column=c).font = Font(size=9)
m1, m2 = (tot[0] - tot[2]) / tot[0] * 100, (tot[1] - tot[2]) / tot[1] * 100
ws.append(['TOTAL', round(tot[0], 2), round(tot[1], 2), round(tot[2], 2), f"{m1:+.0f}%", f"{m2:+.0f}%"])
rr = ws.max_row
for c in range(1, 7):
    ws.cell(row=rr, column=c).font = Font(size=10, bold=True)
ws.cell(row=rr, column=5).fill = RED
ws.cell(row=rr, column=6).fill = AMBER
r = rr + 2
for line in [
    'FINDINGS (small sample — direction, not gospel)',
    '1. These 9 jobs invoiced $18,131 but actually cost $22,305 — invoiced 23% BELOW cost. 5 of 9 lost money. Invoices include dies and shipping; actual-cost pull has no freight column, so true margins are slightly worse.',
    "2. At SPOT's prices ($21,277) the same work is near break-even (-5%). The SPOT premium on won jobs was largely justified pricing.",
    '3. PRINT: actual $4,541 vs SPOT -14% vs iQuote -49% (excl blowout). SPOT print is close to reality; iQuote badly under.',
    '4. MATERIAL: SPOT within +/-10% of actual — well calibrated.',
    '5. CUTTING (machine-family aligned, excl 236943 route mismatch): CAD route SPOT -32% (7 jobs); Crest -50% (1 job). See Cutting Deep-Dive for root cause and bookmarked fix.',
    '6. Blowout job 236943: sold at CAD-pricing $4,353, actual cost $9,468. SPOT would have quoted $6,774 — still a loss, but $2,400 less. SPOT quoted Crest/die route, ran Kongsberg (CAD) — excluded from cutting calibration.',
]:
    ws.cell(row=r, column=1, value=line).font = SUB if line.startswith('FINDINGS') else Font(size=10)
    ws.cell(row=r, column=1).alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
    ws.row_dimensions[r].height = 28 if not line.startswith('FINDINGS') else 14
    r += 1
for i, w in enumerate([10, 26, 15, 11, 11, 11, 13, 14, 40], 1):
    ws.column_dimensions[get_column_letter(i)].width = w

# ── 7. CUTTING DEEP-DIVE ──
det = list(csv.DictReader(open('/app/analysis/spotiq/cutting_detail.csv', encoding='utf-8-sig')))
ws = wb.create_sheet('Cutting Deep-Dive')
for i, w in enumerate([24, 12, 12, 12, 12, 12, 12, 12, 60], 1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws['A1'] = 'Cutting Cost Deep-Dive — 1 year of wide-format production (1,045 cutting ops)'
ws['A1'].font = TITLE
r = 3
ws.cell(row=r, column=1, value='1. MACHINE MIX & RATES (why "blended vs LG Zund" is moot)').font = SUB
r += 1
hdr = ['Work center', 'Ops', 'Ops %', 'Cost $', 'Cost %', 'Hours', 'WC rate $/hr', '$/op']
for c, h in enumerate(hdr, 1):
    ws.cell(row=r, column=c, value=h)
style_header(ws, r, len(hdr))
r += 1
g = defaultdict(lambda: {'n': 0, 'cost': 0.0, 'hrs': 0.0, 'rate': ''})
for o in det:
    k = o['work_center_desc']
    g[k]['n'] += 1
    g[k]['cost'] += float(o['TotalProductionCost'] or 0)
    g[k]['hrs'] += float(o['TotalHours'] or 0)
    g[k]['rate'] = o['WorkCenterRate']
tot_c = sum(v['cost'] for v in g.values())
for k, v in sorted(g.items(), key=lambda x: -x[1]['cost']):
    ws.append([k, v['n'], f"{v['n']/len(det)*100:.0f}%", round(v['cost'], 0), f"{v['cost']/tot_c*100:.0f}%",
               round(v['hrs'], 1), v['rate'], round(v['cost']/v['n'], 0)])
    for c in range(1, 9):
        ws.cell(row=ws.max_row, column=c).font = THIN_FONT
    r += 1
r += 1
ws.cell(row=r, column=1, value='CAD-family rates are uniform ($69-72/hr) — machine drift at schedule time is NOT a rate risk. Blended CAD rate remains the right model.').font = Font(size=9, italic=True)
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
r += 2
ws.cell(row=r, column=1, value='2. HOURS DECOMPOSITION — produced jobs (SPOT estimated vs actual)').font = SUB
r += 1
hdr2 = ['MIS Job', 'Machine ran', 'SPOT hrs', 'Actual hrs', 'Hours Delta', 'SPOT $/hr', 'Actual WC $/hr', 'SPOT cut $', 'Actual cut $']
for c, h in enumerate(hdr2, 1):
    ws.cell(row=r, column=c, value=h)
style_header(ws, r, len(hdr2))
r += 1
by_job = {}
for o in det:
    by_job.setdefault(int(o['job_id']), []).append(o)
for job_id, est, sq, qid, opt, iqq, note in JOBS:
    ops = by_job.get(job_id, [])
    if not ops:
        continue
    srows_ = [x for x in spot_rows if x['SPOT Estimate #'] == est and x['Qty'] == sq]
    s_hrs = sum(f(x['Route Hours']) for x in srows_)
    s_cut = sum(f(x['Cutting Cost']) for x in srows_)
    a_hrs = sum(float(o['TotalHours']) for o in ops)
    a_cost = sum(float(o['TotalProductionCost']) for o in ops)
    mach = '/'.join(sorted(set(o['work_center_desc'] for o in ops)))
    rate = '/'.join(sorted(set(o['WorkCenterRate'] for o in ops)))
    hd = (s_hrs - a_hrs) / a_hrs * 100
    ws.append([job_id, mach, round(s_hrs, 2), round(a_hrs, 2), f"{hd:+.0f}%",
               round(s_cut / s_hrs, 0) if s_hrs else '', rate, round(s_cut, 0), round(a_cost, 0)])
    rr = ws.max_row
    ws.cell(row=rr, column=5).fill = RED if hd < -40 else AMBER
    for c in range(1, 10):
        ws.cell(row=rr, column=c).font = THIN_FONT
    r += 1
r += 2
ws.cell(row=r, column=1, value='3. ROOT CAUSE & BOOKMARKED RECOMMENDATION (NO CHANGES APPLIED)').font = SUB
r += 1
for line in [
    "• Setup: SPOT assumes 25 min (Standard). Logged actual setups: LG Zund ~16 min, Sm Zund ~18, Kongsberg ~32 median. SETUP IS FINE. (Caveat: setup logging inconsistent — ~40% of ops log none; those hours sit inside run time, so calibration uses TOTAL hours.)",
    "• Run speed: SPOT assumes 650 in/min cut speed — inherited verbatim from legacy R1.5. Effective actual throughput (total-hours method): ~165 in/min — ~3.5x slower. THIS IS THE MISS. 650 is plausibly head speed; real throughput includes sheet load/unload/registration.",
    "• Rate: SPOT charges $138/hr (also legacy-inherited) vs actual CAD-family WC rate $69-72/hr. The inflated rate historically masked ~half of the speed miss (compensating errors).",
    "",
    "RECOMMENDED FIX (admin console only, reversible, BOOKMARKED pending leadership):",
    "   Option B (preferred): cadRegularSpeed 650 -> ~165 in/min  AND  cadRate $138 -> $72/hr.",
    "   Costs land the same place as Option A but hours become real — also fixes route auto-selection fairness (CAD vs Crest vs Bobst compete on honest numbers).",
    "   Option A (single knob): cadRate $138 -> ~$203/hr. Quicker, but hours stay fictional.",
    "   Either way: revisit at ~25 produced Test-flagged jobs. Speed fit based on 5 jobs with known rule inches — thin but consistent.",
    "   Crest: rate already matches WC ($191). Crest hours also ~50% low on the one produced crest job — insufficient data to act (n=1).",
    "   Ask of production: consistent setup logging on Zunds/Kongsberg would let the next pull separate setup vs run cleanly and validate the difficulty curve.",
]:
    ws.cell(row=r, column=1, value=line).font = Font(size=10, bold=line.startswith('RECOMMENDED'))
    ws.cell(row=r, column=1).alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
    ws.row_dimensions[r].height = 30 if len(line) > 90 else 15
    r += 1

wb.save('/app/frontend/public/SPOT_vs_iQuote_Analysis.xlsx')
d2 = [m['cdpct'] for m in clean]
print('saved:', wb.sheetnames)
print(f"corrected direct-cost Delta% median (excl outliers): {statistics.median(d2):+.1f}%  mean {statistics.mean(d2):+.1f}%")
print(f"sell Delta% median unchanged: {statistics.median([m['dpct'] for m in clean]):+.1f}%")
