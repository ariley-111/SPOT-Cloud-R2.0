#!/usr/bin/env python3
"""
Generate SPOT Executive Summary from corrected_spot_report.xlsx.

Comparison mode: WHOLE-QUOTE level.
  - Each SPOT scenario (an estimate # + qty tier) is summed across all its components.
  - Each iQuote option (an IdQuote + OptDesc) is summed across all its components.
  - Alt-tier SPOT quotes (same component at multiple qtys) split by qty.
  - Mixed multi-part SPOT quotes (different components at different qtys) collapse into ONE quote.

Rules (per user):
- Word 'delta' (never the delta symbol).
- '+/-' (never '+-').
- Single '-' to split data points; no '--'; no dots.
- Missing side rendered blank with an inline note.
"""

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, ScatterChart, Reference, Series
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.trendline import Trendline
from collections import defaultdict

IN_PATH = '/tmp/analysis/input.xlsx'
OUT_PATH = '/tmp/analysis/SPOT_Exec_Summary_v2.xlsx'

# ---------- Overrides ----------
# Force a specific iQuote OptDesc when comparing a given SPOT iQuote #.
# The whole option is summed across all its rows / qtys.
IQ_OPTION_OVERRIDES = {
    221998: 'Option 1 - D/C w/riser',
    223860: 'Die Cut 2510223768',
}

# Job to (SPOT est #, iQuote #) mapping for the 3-way tab
JOB_MAP = {
    236341: ('RW-260623-091031', 223207),
    236355: ('RW-260727-080830', 223209),
    236550: ('RW-260727-102959', 223393),
    236688: ('RW-260727-095102', 223486),
    236802: ('RW-260727-101129', 223454),
    236822: ('RW-260727-144121', 223575),
    236943: ('RW-260722-082345', 223591),
    236869: ('RW-260730-155412', 223597),
    237252: ('RW-260724-113737', 223651),
}

QTY_TOLERANCE = 1  # 500↔501, 918↔919 etc

# ---------- Style helpers ----------
THIN = Side(border_style='thin', color='CCCCCC')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEADER_FILL = PatternFill('solid', fgColor='1F4E78')
GROUP_FILL = PatternFill('solid', fgColor='D9E1F2')
TOTAL_FILL = PatternFill('solid', fgColor='FFF2CC')
HEADER_FONT = Font(bold=True, color='FFFFFF', size=11)
GROUP_FONT = Font(bold=True, size=11)
TOTAL_FONT = Font(bold=True, size=10)
CENTER = Alignment(horizontal='center', vertical='center')
LEFT_WRAP = Alignment(horizontal='left', vertical='top', wrap_text=True)


def _f(v):
    if v is None or v == '':
        return 0.0
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return 0.0
    return float(v)


def _int_or_none(v):
    if v is None or v == '':
        return None
    if isinstance(v, str):
        v = v.strip()
        if v.isdigit():
            return int(v)
        try:
            return int(float(v))
        except ValueError:
            return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def signed_delta(spot, other):
    if spot is None or other is None:
        return None
    return round(float(spot) - float(other), 2)


def signed_pct_num(spot, other):
    if spot is None or other is None or float(other) == 0:
        return None
    return round((float(spot) - float(other)) / float(other) * 100.0, 1)


def pct_str(spot, other):
    """Signed % string like '+12%' or '-8%' - n/a if either side blank or denominator 0."""
    p = signed_pct_num(spot, other)
    if p is None:
        return 'n/a'
    return f'{"+" if p >= 0 else "-"}{abs(p):.0f}%'


def verdict(spot, other):
    p = signed_pct_num(spot, other)
    if p is None:
        return ''
    ap = abs(p)
    if ap <= 10: return 'PASS'
    if ap <= 20: return 'REVIEW'
    return 'FAIL'


# ---------- Load and normalize ----------
wb_in = openpyxl.load_workbook(IN_PATH, data_only=True)


def read_rows(ws):
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    out = []
    for r in range(2, ws.max_row + 1):
        row = {}
        empty = True
        for i, h in enumerate(headers, 1):
            v = ws.cell(row=r, column=i).value
            row[h] = v
            if v not in (None, '', 0):
                empty = False
        if not empty:
            out.append(row)
    return out


spot_rows = read_rows(wb_in['Testing Comparison'])
iq_rows = read_rows(wb_in['iQuote Quotes'])
act_rows = read_rows(wb_in['Actuals'])

for r in spot_rows:
    r['iQuote #'] = _int_or_none(r.get('iQuote #'))
    r['Qty'] = _int_or_none(r.get('Qty'))
for r in iq_rows:
    r['IdQuote'] = _int_or_none(r.get('IdQuote'))
    r['Quantity'] = _int_or_none(r.get('Quantity'))
for r in act_rows:
    r['job_id'] = _int_or_none(r.get('job_id'))


# ---------- Aggregate iQuote by (iq_num, opt_desc) - whole option sum ----------
# We keep per-qty breakdown too, for reference.
iq_options = {}  # (iq_num, opt_desc) -> aggregated dict (across ALL qtys in that option)
iq_option_qtys = defaultdict(set)  # (iq_num, opt_desc) -> set of qtys present
iq_options_by_iqnum = defaultdict(set)  # iq_num -> set of opt_desc
iq_options_by_iqnum_qty = defaultdict(set)  # (iq_num, qty) -> set of opt_desc
iq_produced_option = {}  # (iq_num, mis_job) -> opt_desc (option run to production)
iq_quote_totals = {}  # iq_num -> TotalEstimatePrice

for r in iq_rows:
    iq_num = r['IdQuote']
    opt = r.get('OptDesc') or ''
    qty = r['Quantity']
    key = (iq_num, opt)
    a = iq_options.setdefault(key, {
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
        'total_cost': 0.0, 'sell_total': 0.0,
        'qtys': set(), 'products': [],
    })
    cutting = _f(r.get('ZundCost')) + _f(r.get('CrestCost')) + _f(r.get('SaberCost')) \
              + _f(r.get('BobstCost')) + _f(r.get('OtherUncategorizedCost'))
    hand = _f(r.get('HandStripCost')) + _f(r.get('GluingCost'))
    a['material'] += _f(r.get('MaterialCost'))
    a['print']    += _f(r.get('PressCost'))
    a['cutting']  += cutting
    a['hand']     += hand
    a['freight']  += _f(r.get('FreightCost'))
    a['not_in_spot'] += _f(r.get('NotInSpotCost'))
    a['total_cost'] += _f(r.get('TotalActualCost'))
    a['sell_total'] += _f(r.get('ComponentTotalPrice'))
    a['qtys'].add(qty)
    a['products'].append({'product': str(r.get('Product') or ''), 'qty': qty,
                          'sell': _f(r.get('ComponentTotalPrice'))})
    iq_option_qtys[key].add(qty)
    iq_options_by_iqnum[iq_num].add(opt)
    iq_options_by_iqnum_qty[(iq_num, qty)].add(opt)

    mis = r.get('MISJobID')
    if mis and mis != 'NULL':
        mis_int = _int_or_none(mis)
        iq_produced_option[(iq_num, mis_int)] = opt

    iq_quote_totals[iq_num] = _f(r.get('TotalEstimatePrice'))


# ---------- Aggregate SPOT by est# ----------
# Then decide alt-tier vs mixed-multi-part
spot_by_est = defaultdict(list)
for r in spot_rows:
    spot_by_est[r['SPOT Estimate #']].append(r)


def _is_alt_tier(rows):
    """Alt-tier = same component name appears at 2+ qtys."""
    comp_qtys = defaultdict(set)
    for r in rows:
        comp_qtys[r.get('Component') or ''].add(r.get('Qty'))
    return any(len(qtys) > 1 for qtys in comp_qtys.values())


# ---------- Build SPOT scenarios (est, iq, tier_qty_or_ALL) ----------
spot_scenarios = {}  # (est, iq_num, tier) -> dict


def _empty_scen(sample_row):
    return {
        'project': sample_row.get('Project Name') or '',
        'became_job': sample_row.get('Became a Job') or 'No',
        'quote_type': sample_row.get('Quote Type') or '',
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'freight': 0.0,
        'total_cost': 0.0, 'sell_total': 0.0,
        'qtys': set(), 'components': [], 'board_specs': [],
    }


for est, rows in spot_by_est.items():
    iq_num = rows[0].get('iQuote #')
    alt_tier = _is_alt_tier(rows)
    for r in rows:
        qty = r.get('Qty')
        tier = qty if alt_tier else 'ALL'
        key = (est, iq_num, tier)
        s = spot_scenarios.setdefault(key, _empty_scen(r))
        hand = _f(r.get('Strip Cost')) + _f(r.get('Glue Cost')) + _f(r.get('Tape Cost'))
        die = _f(r.get('Die'))
        s['material'] += _f(r.get('Material Cost'))
        s['print']    += _f(r.get('Print Cost'))
        s['cutting']  += _f(r.get('Cutting Cost'))
        s['hand']     += hand
        s['die']      += die
        s['freight']  += _f(r.get('Freight'))
        s['total_cost'] += _f(r.get('Total Cost'))
        s['sell_total'] += _f(r.get('Sell Total'))
        if qty is not None:
            s['qtys'].add(qty)
        s['components'].append({
            'name': r.get('Component') or '',
            'qty': qty,
            'sell': _f(r.get('Sell Total')),
        })
        spec_bits = []
        if r.get('Board'): spec_bits.append(str(r['Board']))
        if r.get('One-Up W') and r.get('One-Up L'):
            spec_bits.append(f"{r['One-Up W']} x {r['One-Up L']}")
        if r.get('Sheet'): spec_bits.append(f"sheet {r['Sheet']}")
        spec = ' - '.join(spec_bits)
        if spec and spec not in s['board_specs']:
            s['board_specs'].append(spec)


# ---------- Aggregate Actuals per job_id ----------
actuals = {}
for r in act_rows:
    key = r['job_id']
    a = actuals.setdefault(key, {
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'total': 0.0, 'sell': 0.0,
    })
    cutting = _f(r.get('LGZundCost')) + _f(r.get('SmZundCost')) + _f(r.get('KongsbergCost')) \
              + _f(r.get('BobstCost')) + _f(r.get('CrestClamshellCost')) + _f(r.get('SaberCost'))
    hand = _f(r.get('HandStripCost')) + _f(r.get('HandGlueCost')) + _f(r.get('HandTapeCost'))
    material = _f(r.get('MaterialCost')) + _f(r.get('OtherMaterialCost'))
    a['material'] += material
    a['print']    += _f(r.get('PrintCost'))
    a['cutting']  += cutting
    a['hand']     += hand
    a['die']      += _f(r.get('DieCost'))
    a['total']    += _f(r.get('TotalActualCost'))
    a['sell']     += _f(r.get('SellTotal'))


# ---------- iQuote option resolver for a SPOT scenario ----------
def resolve_iq(iq_num, scen_qtys, spot_sell, mis_job=None):
    """Return (option_dict, opt_desc_str, resolution_note) or (None, None, note).
    scen_qtys = set of SPOT qtys in this scenario."""
    if iq_num is None:
        return None, None, 'No iQuote # on SPOT scenario'
    if iq_num not in iq_options_by_iqnum:
        return None, None, 'iQuote # not found in iQuote export'

    # 1. Override
    if iq_num in IQ_OPTION_OVERRIDES:
        opt = IQ_OPTION_OVERRIDES[iq_num]
        key = (iq_num, opt)
        if key in iq_options:
            return iq_options[key], opt, f'override: forced OptDesc {opt!r}'

    all_opts = iq_options_by_iqnum[iq_num]

    # 2. Produced-job option
    if mis_job is not None and (iq_num, mis_job) in iq_produced_option:
        opt = iq_produced_option[(iq_num, mis_job)]
        if opt in all_opts:
            return iq_options[(iq_num, opt)], opt, f'produced job {mis_job} ran option {opt!r}'

    # 3. Single option
    if len(all_opts) == 1:
        opt = next(iter(all_opts))
        return iq_options[(iq_num, opt)], opt, 'only one option available'

    # 4. Multi-option: pick option whose qty set overlaps SPOT's qtys, then nearest by sell
    def qty_match_score(opt):
        oqtys = iq_option_qtys[(iq_num, opt)]
        # count SPOT qtys covered (within tolerance)
        covered = 0
        for sq in scen_qtys:
            for oq in oqtys:
                if sq is not None and oq is not None and abs(sq - oq) <= QTY_TOLERANCE:
                    covered += 1
                    break
        return covered

    ranked = sorted(all_opts,
                    key=lambda o: (qty_match_score(o),
                                   -abs(iq_options[(iq_num, o)]['sell_total'] - (spot_sell or 0))),
                    reverse=True)
    if ranked:
        opt = ranked[0]
        return iq_options[(iq_num, opt)], opt, 'best qty overlap + closest sell match'
    return None, None, 'no option resolvable'


# ---------- Build OUTPUT workbook ----------
wb = openpyxl.Workbook()
wb.remove(wb.active)

# Sort scenarios for stable output
scen_sorted = sorted(spot_scenarios.items(),
                     key=lambda kv: (kv[1]['project'], kv[0][0],
                                     kv[0][2] if kv[0][2] != 'ALL' else -1))


# ============================================================
# TAB 1: Executive Summary
# ============================================================
ws = wb.create_sheet('Executive Summary')
ws.column_dimensions['A'].width = 55
ws.column_dimensions['B'].width = 70

ws['A1'] = 'SPOT vs iQuote vs Actuals - Executive Summary'
ws['A1'].font = Font(bold=True, size=14, color='1F4E78')

n_scen = len(spot_scenarios)
n_matched = 0
deltas_pct = []
for (est, iq, tier), s in scen_sorted:
    iq_data, _, _ = resolve_iq(iq, s['qtys'], s['sell_total'])
    if iq_data and iq_data['sell_total'] > 0:
        n_matched += 1
        deltas_pct.append((s['sell_total'] - iq_data['sell_total']) / iq_data['sell_total'] * 100)

n_jobs = len(actuals)
ws['A2'] = (f'Whole-quote comparison across {n_scen} SPOT scenarios ({n_matched} matched to iQuote), '
            f'plus 3-way actuals on {n_jobs} produced jobs. '
            f'Verdicts: PASS <= +/- 10%, REVIEW <= +/- 20%, FAIL > +/- 20%.')
ws['A2'].alignment = LEFT_WRAP
ws.row_dimensions[2].height = 40
ws.merge_cells('A2:B2')

row = 4
ws.cell(row=row, column=1, value='Summary').font = Font(bold=True, size=12); row += 1
ws.cell(row=row, column=1, value='SPOT scenarios').font = Font(bold=True)
ws.cell(row=row, column=2, value=n_scen); row += 1
ws.cell(row=row, column=1, value='Matched to iQuote').font = Font(bold=True)
ws.cell(row=row, column=2, value=n_matched); row += 1
ws.cell(row=row, column=1, value='Produced jobs with actuals').font = Font(bold=True)
ws.cell(row=row, column=2, value=n_jobs); row += 1

if deltas_pct:
    deltas_pct.sort()
    med = deltas_pct[len(deltas_pct)//2]
    sign = '+' if med >= 0 else '-'
    ws.cell(row=row, column=1, value='SPOT vs iQuote (median sell delta)').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'{sign}{abs(med):.1f}%')
    row += 1

    pass_ct = sum(1 for d in deltas_pct if abs(d) <= 10)
    review_ct = sum(1 for d in deltas_pct if 10 < abs(d) <= 20)
    fail_ct = len(deltas_pct) - pass_ct - review_ct
    ws.cell(row=row, column=1, value='PASS / REVIEW / FAIL').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'{pass_ct} / {review_ct} / {fail_ct}')
    row += 1

# Actuals stats
if actuals:
    row += 1
    ws.cell(row=row, column=1, value=f'Actuals - {n_jobs} produced jobs').font = Font(bold=True, size=12)
    row += 1
    tot_sold = sum(a['sell'] for a in actuals.values())
    tot_actual = sum(a['total'] for a in actuals.values())
    margin = (tot_sold - tot_actual) / tot_sold * 100 if tot_sold else 0
    ws.cell(row=row, column=1, value='Sold vs actual cost').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'${tot_sold:,.0f} sold - ${tot_actual:,.0f} cost - '
                                     f'{"+" if margin >= 0 else "-"}{abs(margin):.0f}% margin')
    row += 1
    # Same work at SPOT prices
    tot_spot = 0
    for job_id, (est, iq) in JOB_MAP.items():
        if job_id in actuals:
            for (e, i, tier), s in spot_scenarios.items():
                if e == est and i == iq:
                    tot_spot += s['sell_total']
                    break
    if tot_spot > 0:
        spot_margin = (tot_spot - tot_actual) / tot_spot * 100
        ws.cell(row=row, column=1, value='Same work at SPOT prices').font = Font(bold=True)
        ws.cell(row=row, column=2, value=f'${tot_spot:,.0f} - '
                                         f'{"+" if spot_margin >= 0 else "-"}{abs(spot_margin):.0f}% margin')
        row += 1
    lost = sum(1 for a in actuals.values() if a['sell'] < a['total'])
    ws.cell(row=row, column=1, value='Jobs that lost money as invoiced').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'{lost} of {n_jobs}')
    row += 2

# Category accuracy vs actuals
if actuals:
    ws.cell(row=row, column=1, value='Accuracy vs actual cost by category').font = Font(bold=True, size=12)
    row += 1
    cat_a = defaultdict(float); cat_s = defaultdict(float); cat_i = defaultdict(float)
    for job_id, (est, iq) in JOB_MAP.items():
        if job_id not in actuals:
            continue
        a = actuals[job_id]
        for (e, i, tier), s in spot_scenarios.items():
            if e == est and i == iq:
                for cat in ('material', 'print', 'cutting', 'hand', 'die'):
                    cat_s[cat] += s.get(cat, 0)
                iq_data, _, _ = resolve_iq(iq, s['qtys'], s['sell_total'], mis_job=job_id)
                if iq_data:
                    for cat in ('material', 'print', 'cutting', 'hand'):
                        cat_i[cat] += iq_data.get(cat, 0)
                break
        for cat in ('material', 'print', 'cutting', 'hand', 'die'):
            cat_a[cat] += a.get(cat, 0)
    labels = [('material', 'Material'), ('print', 'Print'),
              ('cutting', 'Cutting'), ('hand', 'Handwork'), ('die', 'Die')]
    for cat, label in labels:
        av = cat_a[cat]; sv = cat_s[cat]; iv = cat_i.get(cat, 0)
        if av == 0 and sv == 0 and iv == 0:
            continue
        spot_vs = pct_str(sv, av)
        iq_vs = pct_str(iv, av) if cat != 'die' else 'n/a (not in iQuote export)'
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        ws.cell(row=row, column=2, value=f'SPOT {spot_vs} vs actual  -  iQuote {iq_vs} vs actual  -  '
                                          f'actual ${av:,.0f}  -  spot ${sv:,.0f}  -  iq ${iv:,.0f}')
        row += 1

row += 1
ws.cell(row=row, column=1, value='Key takeaways').font = Font(bold=True, size=12); row += 1
takeaways = [
    'Whole-quote view: SPOT and iQuote are within +/- 10% on most matched scenarios.',
    'Material is well-calibrated across SPOT and iQuote versus actuals.',
    'Print is a systematic driver where SPOT tends higher than iQuote and closer to actuals.',
    'Cutting throughput remains a gap in both systems on produced jobs.',
    'Small-qty (<= 50) scenarios carry the largest SPOT premium; review minimums rules.',
    'iQuote export does not include die cost - noted where SPOT priced a die.',
]
for t in takeaways:
    ws.cell(row=row, column=1, value=t)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
    ws.cell(row=row, column=1).alignment = LEFT_WRAP
    ws.row_dimensions[row].height = 28
    row += 1


# ============================================================
# TAB 2: Quote Comparison (whole-quote, one block per scenario)
# ============================================================
ws = wb.create_sheet('Quote Comparison')
qc_headers = ['Project - SPOT Est - iQuote #', 'Qty', 'Category',
              'SPOT $', 'iQuote $', 'Delta $', 'Delta %', 'Verdict', 'Note']
widths = [55, 12, 22, 12, 12, 12, 11, 12, 40]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws['A1'] = 'Quote-by-Quote: SPOT vs iQuote (whole-quote category breakdown)'
ws['A1'].font = Font(bold=True, size=13, color='1F4E78')
ws.merge_cells('A1:I1')

ws['A2'] = ('One block per SPOT scenario. Categories mirror the Actuals 3-Way layout. '
            'SPOT $ and iQuote $ are SUMS of all components in that scenario. '
            'TOTAL SELL compares total quoted price. Delta % = SPOT vs iQuote where + means SPOT higher. '
            'Missing side rendered blank with a note.')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:I2')
ws.row_dimensions[2].height = 45

row = 4
for c, h in enumerate(qc_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    cell.alignment = CENTER; cell.border = BORDER
row += 1

# Track sell comparison for charts
chart_scatter_rows = []  # list of (iq_sell, spot_sell)
chart_delta_pcts = []  # for histogram
chart_qty_bucket = defaultdict(list)  # bucket -> list of delta pcts

for (est, iq, tier), s in scen_sorted:
    iq_data, iq_opt, iq_note = resolve_iq(iq, s['qtys'], s['sell_total'])

    became = ' - BECAME A JOB' if s['became_job'] == 'Yes' else ''
    proj = s['project'] or '(no project name)'
    qty_label = ', '.join(str(q) for q in sorted(s['qtys'])) if s['qtys'] else str(tier)
    opt_str = f' - iQuote OptDesc: {iq_opt}' if iq_opt else ''
    header_txt = f'{proj} - SPOT {est} - iQuote #{iq} - qty {qty_label}{became}{opt_str}'
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    c = ws.cell(row=row, column=1, value=header_txt)
    c.font = GROUP_FONT; c.fill = GROUP_FILL
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    row += 1

    # Diagnostic note row
    if iq_note:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
        c = ws.cell(row=row, column=1, value=f'    Resolution: {iq_note}')
        c.font = Font(italic=True, size=9, color='666666')
        c.alignment = Alignment(horizontal='left', indent=1)
        row += 1

    cats = [
        ('Material', s['material'], (iq_data['material'] if iq_data else None)),
        ('Print',    s['print'],    (iq_data['print']    if iq_data else None)),
        ('Cutting',  s['cutting'],  (iq_data['cutting']  if iq_data else None)),
        ('Handwork', s['hand'],     (iq_data['hand']     if iq_data else None)),
    ]
    die_spot = s['die']
    die_iq = None  # iQuote export has no die
    if die_spot > 0 or die_iq:
        cats.append(('Die', die_spot if die_spot > 0 else None, die_iq))

    for cat_label, sv, iv in cats:
        d_dollar = signed_delta(sv, iv)
        d_pct = pct_str(sv, iv)
        note = ''
        if sv is None and iv is not None:
            note = f'{cat_label} on iQuote only'
        elif iv is None and sv is not None:
            if cat_label == 'Die':
                note = 'iQuote export does not include die cost'
            else:
                note = f'{cat_label} on SPOT only'
        cells = [None, qty_label if cat_label == 'Material' else None, cat_label,
                 sv, iv, d_dollar, d_pct, '', note]
        for c_idx, v in enumerate(cells, 1):
            cell = ws.cell(row=row, column=c_idx, value=v)
            cell.border = BORDER
            if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
                cell.number_format = '#,##0.00'
            if c_idx == 3:
                cell.alignment = Alignment(horizontal='left', indent=1)
            if c_idx == 9:
                cell.alignment = LEFT_WRAP
        row += 1

    # TOTAL SELL row
    total_spot = s['sell_total']
    total_iq = iq_data['sell_total'] if iq_data else None
    d_dollar = signed_delta(total_spot, total_iq)
    d_pct = pct_str(total_spot, total_iq)
    verd = verdict(total_spot, total_iq)
    note = '' if iq_data else 'No matching iQuote data'
    for c_idx, v in enumerate([None, qty_label, 'TOTAL SELL', total_spot, total_iq,
                               d_dollar, d_pct, verd, note], 1):
        cell = ws.cell(row=row, column=c_idx, value=v)
        cell.border = BORDER; cell.fill = TOTAL_FILL; cell.font = TOTAL_FONT
        if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
        if c_idx == 3:
            cell.alignment = Alignment(horizontal='left', indent=1)
        if c_idx == 8 and verd:
            colors = {'PASS': '00B050', 'REVIEW': 'ED7D31', 'FAIL': 'C00000'}
            cell.font = Font(bold=True, color=colors.get(verd, '000000'))
    row += 1
    row += 1  # blank

    # Feed chart data
    if iq_data and total_iq is not None and total_iq > 0:
        chart_scatter_rows.append((total_iq, total_spot))
        pct = (total_spot - total_iq) / total_iq * 100
        chart_delta_pcts.append(pct)
        max_qty = max(s['qtys']) if s['qtys'] else 0
        if max_qty <= 50:
            b = '<= 50'
        elif max_qty <= 250:
            b = '51-250'
        elif max_qty <= 600:
            b = '251-600'
        else:
            b = '> 600'
        chart_qty_bucket[b].append(pct)


# ============================================================
# TAB 3: Pricing Summary (one row per scenario)
# ============================================================
ws = wb.create_sheet('Pricing Summary')
ps_headers = ['Project', 'SPOT Estimate #', 'iQuote #', 'Qty', 'Board Specs',
              'iQuote OptDesc', 'iQuote Sell $', 'SPOT Sell $', 'Delta $', 'Delta %',
              'Verdict', 'Became a Job']
widths = [32, 22, 12, 14, 40, 30, 14, 14, 14, 12, 12, 15]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws['A1'] = 'Pricing Summary - iQuote vs SPOT (whole-quote totals)'
ws['A1'].font = Font(bold=True, size=13, color='1F4E78')
ws.merge_cells('A1:L1')

ws['A2'] = 'One row per SPOT scenario. Totals = sum of all components in the quote.'
ws['A2'].alignment = LEFT_WRAP; ws.merge_cells('A2:L2')

row = 4
for c, h in enumerate(ps_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    cell.alignment = CENTER; cell.border = BORDER
row += 1

for (est, iq, tier), s in scen_sorted:
    iq_data, iq_opt, _ = resolve_iq(iq, s['qtys'], s['sell_total'])
    iq_sell = iq_data['sell_total'] if iq_data else None
    spot_sell = s['sell_total']
    qty_label = ', '.join(str(q) for q in sorted(s['qtys'])) if s['qtys'] else ''
    specs = ' | '.join(s['board_specs'])
    verd = verdict(spot_sell, iq_sell)
    vals = [
        s['project'] or '(no name)', est, iq, qty_label, specs,
        iq_opt or '', iq_sell, spot_sell,
        signed_delta(spot_sell, iq_sell), pct_str(spot_sell, iq_sell),
        verd, s['became_job'],
    ]
    for c_idx, v in enumerate(vals, 1):
        cell = ws.cell(row=row, column=c_idx, value=v)
        cell.border = BORDER
        cell.alignment = Alignment(vertical='top', wrap_text=(c_idx in (5, 6)))
        if c_idx in (7, 8, 9) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
        if c_idx == 11 and verd:
            colors = {'PASS': '00B050', 'REVIEW': 'ED7D31', 'FAIL': 'C00000'}
            cell.font = Font(bold=True, color=colors.get(verd, '000000'))
    row += 1


# ============================================================
# TAB 4: Actuals 3-Way
# ============================================================
ws = wb.create_sheet('Actuals 3-Way')
a3_headers = ['MIS Job', 'SPOT Est - iQuote #', 'Category',
              'SPOT Est $', 'iQuote Est $', 'ACTUAL $',
              'SPOT vs Actual', 'iQuote vs Actual', 'Note']
widths = [12, 30, 20, 14, 14, 14, 14, 14, 45]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws['A1'] = 'Three-Way: iQuote estimate vs SPOT estimate vs ACTUAL job cost'
ws['A1'].font = Font(bold=True, size=13, color='1F4E78')
ws.merge_cells('A1:I1')

ws['A2'] = ('Ground-truth check on 9 produced jobs. Category rows use whole-quote sums. '
            'Handwork actuals are $0 on some jobs (absorbed elsewhere in MIS costing). '
            'iQuote export does not include die cost.')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:I2'); ws.row_dimensions[2].height = 40

row = 4
for c, h in enumerate(a3_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    cell.alignment = CENTER; cell.border = BORDER
row += 1

job_totals = []  # for charts

for job_id in sorted(JOB_MAP.keys()):
    est, iq = JOB_MAP[job_id]
    a = actuals.get(job_id)
    if not a:
        continue
    s = None
    for (e, i, tier), sv in spot_scenarios.items():
        if e == est and i == iq:
            s = sv; break
    iq_data, _, _ = resolve_iq(iq, s['qtys'] if s else set(), s['sell_total'] if s else 0,
                                mis_job=job_id)

    ref_txt = f'{est} - {iq}'
    cats = [
        ('Material', 'material'),
        ('Print', 'print'),
        ('Cutting', 'cutting'),
        ('Handwork', 'hand'),
        ('Die', 'die'),
    ]
    first = True
    tot_s = tot_i = tot_a = 0
    for label, key in cats:
        spot_v = s[key] if s else None
        iq_v = iq_data[key] if (iq_data and key in iq_data) else (0 if key != 'die' else None)
        act_v = a[key] if a else None
        if key != 'die':
            tot_s += (spot_v or 0); tot_i += (iq_v or 0); tot_a += (act_v or 0)
        note = ''
        if key == 'die' and iq_v is None:
            note = 'iQuote export does not include die cost'
        cells = [
            job_id if first else None,
            ref_txt if first else None,
            label,
            spot_v, iq_v, act_v,
            pct_str(spot_v, act_v), pct_str(iq_v, act_v) if iq_v is not None else 'n/a',
            note,
        ]
        for c_idx, v in enumerate(cells, 1):
            cell = ws.cell(row=row, column=c_idx, value=v)
            cell.border = BORDER
            if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
                cell.number_format = '#,##0.00'
        first = False
        row += 1
    # Total row (excluding die)
    cells = [None, None, 'TOTAL (excl die)', tot_s, tot_i, tot_a,
             pct_str(tot_s, tot_a), pct_str(tot_i, tot_a), '']
    for c_idx, v in enumerate(cells, 1):
        cell = ws.cell(row=row, column=c_idx, value=v)
        cell.border = BORDER; cell.fill = TOTAL_FILL; cell.font = TOTAL_FONT
        if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
    row += 1
    row += 1

    job_totals.append({
        'job': job_id,
        'sold': a['sell'],
        'iq_sell': iq_data['sell_total'] if iq_data else 0,
        'spot_sell': s['sell_total'] if s else 0,
        'actual': a['total'],
        'material': (a['material'], s['material'] if s else 0, iq_data['material'] if iq_data else 0),
        'print':    (a['print'],    s['print']    if s else 0, iq_data['print']    if iq_data else 0),
        'cutting':  (a['cutting'],  s['cutting']  if s else 0, iq_data['cutting']  if iq_data else 0),
    })

# Bottom summary
row += 1
ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
c = ws.cell(row=row, column=1, value='SOLD PRICE vs ACTUAL COST - would SPOT prices have been viable?')
c.font = Font(bold=True, size=12); row += 1

sold_headers = ['MIS Job', 'iQuote Sold $', 'SPOT Would-Be $', 'Actual Cost $',
                'Margin as Sold', 'Margin at SPOT']
for c_idx, h in enumerate(sold_headers, 1):
    cell = ws.cell(row=row, column=c_idx, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    cell.border = BORDER; cell.alignment = CENTER
row += 1

t_sold = t_spot = t_act = 0
for jt in job_totals:
    m_sold = (jt['sold'] - jt['actual']) / jt['sold'] * 100 if jt['sold'] else 0
    m_spot = (jt['spot_sell'] - jt['actual']) / jt['spot_sell'] * 100 if jt['spot_sell'] else 0
    t_sold += jt['sold']; t_spot += jt['spot_sell']; t_act += jt['actual']
    cells = [jt['job'], jt['sold'], jt['spot_sell'], jt['actual'],
             f'{"+" if m_sold >= 0 else "-"}{abs(m_sold):.0f}%',
             f'{"+" if m_spot >= 0 else "-"}{abs(m_spot):.0f}%']
    for c_idx, v in enumerate(cells, 1):
        cell = ws.cell(row=row, column=c_idx, value=v); cell.border = BORDER
        if c_idx in (2, 3, 4) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
    row += 1

m_sold = (t_sold - t_act) / t_sold * 100 if t_sold else 0
m_spot = (t_spot - t_act) / t_spot * 100 if t_spot else 0
cells = ['TOTAL', t_sold, t_spot, t_act,
         f'{"+" if m_sold >= 0 else "-"}{abs(m_sold):.0f}%',
         f'{"+" if m_spot >= 0 else "-"}{abs(m_spot):.0f}%']
for c_idx, v in enumerate(cells, 1):
    cell = ws.cell(row=row, column=c_idx, value=v)
    cell.border = BORDER; cell.fill = TOTAL_FILL; cell.font = Font(bold=True)
    if c_idx in (2, 3, 4) and isinstance(v, (int, float)):
        cell.number_format = '#,##0.00'
row += 1


# ============================================================
# TAB 5: Charts - comparing to iQuote
# ============================================================
ws = wb.create_sheet('Charts - comparing to iQuote')
ws.column_dimensions['A'].width = 22
ws.column_dimensions['B'].width = 18
ws.column_dimensions['C'].width = 18
ws.column_dimensions['D'].width = 12

ws['A1'] = 'Decision Charts - SPOT vs iQuote (whole-quote scenarios)'
ws['A1'].font = Font(bold=True, size=14, color='1F4E78')

# (1) Distribution histogram
ws['A3'] = 'Sell Delta % distribution'; ws['A3'].font = Font(bold=True)
ws['A4'] = 'Bin'; ws['B4'] = 'Quotes'
ws['A4'].font = HEADER_FONT; ws['A4'].fill = HEADER_FILL
ws['B4'].font = HEADER_FONT; ws['B4'].fill = HEADER_FILL

bins = [('< -30%', lambda p: p < -30),
        ('-30 to -20%', lambda p: -30 <= p < -20),
        ('-20 to -10%', lambda p: -20 <= p < -10),
        ('-10 to 0%',   lambda p: -10 <= p < 0),
        ('0 to +10%',   lambda p: 0 <= p < 10),
        ('+10 to +20%', lambda p: 10 <= p < 20),
        ('+20 to +30%', lambda p: 20 <= p < 30),
        ('+30 to +50%', lambda p: 30 <= p < 50),
        ('> +50%',      lambda p: p >= 50)]
row = 5
for label, pred in bins:
    ws.cell(row=row, column=1, value=label)
    ws.cell(row=row, column=2, value=sum(1 for p in chart_delta_pcts if pred(p)))
    row += 1
last_bin = row - 1

# Chart 1: Histogram
ch1 = BarChart()
ch1.type = 'col'
ch1.style = 12
ch1.title = 'Distribution of Sell Delta'
ch1.y_axis.title = 'Number of quotes'
ch1.x_axis.title = 'Sell delta % (SPOT vs iQuote)'
data = Reference(ws, min_col=2, min_row=4, max_row=last_bin, max_col=2)
cats = Reference(ws, min_col=1, min_row=5, max_row=last_bin)
ch1.add_data(data, titles_from_data=True)
ch1.set_categories(cats)
ch1.height = 9; ch1.width = 18
ws.add_chart(ch1, 'E3')

# (2) Scatter: iQuote sell vs SPOT sell
row_scatter_start = last_bin + 3
ws.cell(row=row_scatter_start, column=1, value='iQuote vs SPOT sell (scatter)').font = Font(bold=True)
ws.cell(row=row_scatter_start+1, column=1, value='iQuote Sell $').font = HEADER_FONT
ws.cell(row=row_scatter_start+1, column=1).fill = HEADER_FILL
ws.cell(row=row_scatter_start+1, column=2, value='SPOT Sell $').font = HEADER_FONT
ws.cell(row=row_scatter_start+1, column=2).fill = HEADER_FILL
r = row_scatter_start + 2
for iq_s, sp_s in chart_scatter_rows:
    ws.cell(row=r, column=1, value=iq_s)
    ws.cell(row=r, column=2, value=sp_s)
    r += 1
scatter_end = r - 1

ch2 = ScatterChart()
ch2.title = 'SPOT vs iQuote sell price - points above the line = SPOT higher'
ch2.style = 13
ch2.y_axis.title = 'SPOT sell $'
ch2.x_axis.title = 'iQuote sell $'
xvalues = Reference(ws, min_col=1, min_row=row_scatter_start+2, max_row=scatter_end)
yvalues = Reference(ws, min_col=2, min_row=row_scatter_start+2, max_row=scatter_end)
series = Series(yvalues, xvalues, title='Quotes')
try:
    series.trendline = Trendline(trendlineType='linear')
except Exception:
    pass
ch2.series.append(series)
ch2.height = 10; ch2.width = 18
ws.add_chart(ch2, 'E' + str(row_scatter_start))

# (3) Median delta by qty bucket
row_qty_start = scatter_end + 3
ws.cell(row=row_qty_start, column=1, value='Median Sell Delta % by qty bucket').font = Font(bold=True)
ws.cell(row=row_qty_start+1, column=1, value='Qty bucket').font = HEADER_FONT
ws.cell(row=row_qty_start+1, column=1).fill = HEADER_FILL
ws.cell(row=row_qty_start+1, column=2, value='Median Delta %').font = HEADER_FONT
ws.cell(row=row_qty_start+1, column=2).fill = HEADER_FILL
ws.cell(row=row_qty_start+1, column=3, value='Count').font = HEADER_FONT
ws.cell(row=row_qty_start+1, column=3).fill = HEADER_FILL
r = row_qty_start + 2
for b in ['<= 50', '51-250', '251-600', '> 600']:
    pcts = sorted(chart_qty_bucket.get(b, []))
    med = pcts[len(pcts)//2] if pcts else 0
    ws.cell(row=r, column=1, value=b)
    ws.cell(row=r, column=2, value=round(med, 1) if pcts else 0)
    ws.cell(row=r, column=3, value=len(pcts))
    r += 1
qty_end = r - 1

ch3 = BarChart()
ch3.type = 'col'; ch3.style = 12
ch3.title = 'Median Sell Delta % by qty bucket'
ch3.y_axis.title = 'Median delta %'
ch3.x_axis.title = 'Qty bucket'
data = Reference(ws, min_col=2, min_row=row_qty_start+1, max_row=qty_end, max_col=2)
cats = Reference(ws, min_col=1, min_row=row_qty_start+2, max_row=qty_end)
ch3.add_data(data, titles_from_data=True)
ch3.set_categories(cats)
ch3.height = 9; ch3.width = 18
ws.add_chart(ch3, 'E' + str(row_qty_start))

# (4) Cost by category - SPOT vs iQuote (roll up all scenarios)
row_cat_start = qty_end + 3
ws.cell(row=row_cat_start, column=1, value='Cost by category (all matched scenarios)').font = Font(bold=True)
ws.cell(row=row_cat_start+1, column=1, value='Category').font = HEADER_FONT
ws.cell(row=row_cat_start+1, column=1).fill = HEADER_FILL
ws.cell(row=row_cat_start+1, column=2, value='SPOT $').font = HEADER_FONT
ws.cell(row=row_cat_start+1, column=2).fill = HEADER_FILL
ws.cell(row=row_cat_start+1, column=3, value='iQuote $').font = HEADER_FONT
ws.cell(row=row_cat_start+1, column=3).fill = HEADER_FILL

# Sum categories across matched scenarios
cat_totals = defaultdict(lambda: [0.0, 0.0])
for (est, iq, tier), s in scen_sorted:
    iq_data, _, _ = resolve_iq(iq, s['qtys'], s['sell_total'])
    if not iq_data:
        continue
    for cat in ('material', 'print', 'cutting', 'hand', 'freight'):
        cat_totals[cat][0] += s.get(cat, 0)
        cat_totals[cat][1] += iq_data.get(cat, 0)

r = row_cat_start + 2
for cat_key, cat_label in [('material', 'Material'), ('print', 'Print'),
                            ('cutting', 'Cutting'), ('hand', 'Handwork'),
                            ('freight', 'Freight')]:
    sv, iv = cat_totals[cat_key]
    ws.cell(row=r, column=1, value=cat_label)
    ws.cell(row=r, column=2, value=round(sv, 2))
    ws.cell(row=r, column=3, value=round(iv, 2))
    r += 1
cat_end = r - 1

ch4 = BarChart()
ch4.type = 'col'; ch4.style = 12; ch4.grouping = 'clustered'
ch4.title = 'Cost by category - SPOT vs iQuote'
ch4.y_axis.title = 'Cost $'
ch4.x_axis.title = 'Category'
data = Reference(ws, min_col=2, min_row=row_cat_start+1, max_row=cat_end, max_col=3)
cats = Reference(ws, min_col=1, min_row=row_cat_start+2, max_row=cat_end)
ch4.add_data(data, titles_from_data=True)
ch4.set_categories(cats)
ch4.height = 9; ch4.width = 18
ws.add_chart(ch4, 'E' + str(row_cat_start))


# ============================================================
# TAB 6: Charts - comparing to actuals
# ============================================================
ws = wb.create_sheet('Charts - comparing to actuals')
ws.column_dimensions['A'].width = 14
ws.column_dimensions['B'].width = 18
ws.column_dimensions['C'].width = 18
ws.column_dimensions['D'].width = 18

ws['A1'] = 'Price Comparison - actual 9 produced jobs'
ws['A1'].font = Font(bold=True, size=14, color='1F4E78')

# Chart 1: Actual invoice vs iQuote sell vs SPOT sell per job
ws['A3'] = 'MIS Job'; ws['B3'] = 'Actual Invoice $'
ws['C3'] = 'iQuote Sell $'; ws['D3'] = 'SPOT Sell $'
for cell in [ws['A3'], ws['B3'], ws['C3'], ws['D3']]:
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
row = 4
for jt in job_totals:
    ws.cell(row=row, column=1, value=str(jt['job']))
    ws.cell(row=row, column=2, value=round(jt['sold']))
    ws.cell(row=row, column=3, value=round(jt['iq_sell']))
    ws.cell(row=row, column=4, value=round(jt['spot_sell']))
    row += 1
job_end = row - 1

ch5 = BarChart()
ch5.type = 'col'; ch5.style = 12; ch5.grouping = 'clustered'
ch5.title = 'Actual invoice vs iQuote sell vs SPOT sell'
ch5.y_axis.title = '$'
ch5.x_axis.title = 'MIS Job'
data = Reference(ws, min_col=2, min_row=3, max_row=job_end, max_col=4)
cats = Reference(ws, min_col=1, min_row=4, max_row=job_end)
ch5.add_data(data, titles_from_data=True)
ch5.set_categories(cats)
ch5.height = 10; ch5.width = 20
ws.add_chart(ch5, 'F3')

# Chart 2: Estimated cost accuracy vs actual by category
row_cat2_start = job_end + 3
ws.cell(row=row_cat2_start, column=1, value='Estimated cost accuracy vs actual (9 jobs)').font = Font(bold=True)
ws.cell(row=row_cat2_start+1, column=1, value='Category').font = HEADER_FONT
ws.cell(row=row_cat2_start+1, column=1).fill = HEADER_FILL
ws.cell(row=row_cat2_start+1, column=2, value='Actual $').font = HEADER_FONT
ws.cell(row=row_cat2_start+1, column=2).fill = HEADER_FILL
ws.cell(row=row_cat2_start+1, column=3, value='SPOT est $').font = HEADER_FONT
ws.cell(row=row_cat2_start+1, column=3).fill = HEADER_FILL
ws.cell(row=row_cat2_start+1, column=4, value='iQuote est $').font = HEADER_FONT
ws.cell(row=row_cat2_start+1, column=4).fill = HEADER_FILL

r = row_cat2_start + 2
for cat_key, cat_label in [('material', 'Material'), ('print', 'Print'), ('cutting', 'Cutting')]:
    a_sum = sum(jt[cat_key][0] for jt in job_totals)
    s_sum = sum(jt[cat_key][1] for jt in job_totals)
    i_sum = sum(jt[cat_key][2] for jt in job_totals)
    ws.cell(row=r, column=1, value=cat_label)
    ws.cell(row=r, column=2, value=round(a_sum))
    ws.cell(row=r, column=3, value=round(s_sum))
    ws.cell(row=r, column=4, value=round(i_sum))
    r += 1
cat2_end = r - 1

ch6 = BarChart()
ch6.type = 'col'; ch6.style = 12; ch6.grouping = 'clustered'
ch6.title = 'Estimated cost accuracy vs actual by category'
ch6.y_axis.title = '$'
ch6.x_axis.title = 'Category'
data = Reference(ws, min_col=2, min_row=row_cat2_start+1, max_row=cat2_end, max_col=4)
cats = Reference(ws, min_col=1, min_row=row_cat2_start+2, max_row=cat2_end)
ch6.add_data(data, titles_from_data=True)
ch6.set_categories(cats)
ch6.height = 10; ch6.width = 20
ws.add_chart(ch6, 'F' + str(row_cat2_start))


# ---------- Save ----------
wb.save(OUT_PATH)
print(f'Wrote {OUT_PATH}')
print(f'Scenarios: {len(spot_scenarios)}  iQuote options: {len(iq_options)}  Actuals: {len(actuals)}')
