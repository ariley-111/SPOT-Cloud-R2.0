#!/usr/bin/env python3
"""
Generate SPOT Executive Summary from fresh corrected_spot_report.xlsx.

Rules (per user):
- Word 'delta' (never the delta symbol).
- '+/-' (never '+-').
- Single '-' to split data points; no '--'; no dots.
- Quote Comparison tab uses the Actuals 3-Way row layout (Category rows per scenario).
- If a field only exists on one side (e.g. Die), show the row with the missing side
  blank and note the situation.
- Add a Pricing Summary tab with project, both quote IDs, qty, board specs, and totals.
"""

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from collections import defaultdict

IN_PATH = '/tmp/analysis/input.xlsx'
OUT_PATH = '/tmp/analysis/SPOT_Exec_Summary_v2.xlsx'

# ---------- Hard-coded scenario overrides ----------
# Force a specific iQuote OptDesc (and optionally iQuote qty) for a given
# (spot_iq_num, spot_qty). The comparison will sum the products listed in
# `products` at the given iQuote (opt, qty). If products is None, the whole
# option is used.
IQ_OPTION_OVERRIDES = {
    # 221998 - Meijer Elvive Floorstand: compare against "Option 1 - D/C w/riser" at qty 525
    (221998, 525):  {'opt': 'Option 1 - D/C w/riser', 'iq_qty': 525, 'products': None},
    # SPOT qty 1575 is Shelves (3 versions) = sum of iQuote Shelf 1+2+3 at qty 525 in same option
    (221998, 1575): {'opt': 'Option 1 - D/C w/riser', 'iq_qty': 525,
                     'products': ['Shelf 1', 'Shelf 2', 'Shelf 3'],
                     'label': 'Shelves 1+2+3 combined'},
}

# Qty tolerance - treat SPOT qty and iQuote qty as the same tier when within N units
# (accounts for iQuote adding a "sample" quantity like 500 -> 501, 918 -> 919, 1750 -> 1751)
QTY_TOLERANCE = 1

# ---------- Job to (SPOT est, iQuote #) mapping — from prior analysis ----------
JOB_MAP = {
    236341: ('RW-260623-091031', 223207, 210),
    236355: ('RW-260727-080830', 223209, 1),
    236550: ('RW-260727-102959', 223393, 230),
    236688: ('RW-260727-095102', 223486, 50),
    236802: ('RW-260727-101129', 223454, 220),
    236822: ('RW-260727-144121', 223575, 500),
    236943: ('RW-260722-082345', 223591, 300),
    236869: ('RW-260730-155412', 223597, 250),
    237252: ('RW-260724-113737', 223651, 22),
}

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


def fnum(v, decimals=2):
    if v is None:
        return None
    try:
        return round(float(v), decimals)
    except (TypeError, ValueError):
        return None


def money(v):
    n = fnum(v)
    return 0.0 if n is None else n


def signed_pct(spot, other):
    """Return SPOT vs other percent string like '+12%' or '-8%'. n/a if either side is 0/None."""
    if spot is None or other is None:
        return 'n/a'
    if float(other) == 0:
        return 'n/a'
    pct = (float(spot) - float(other)) / float(other) * 100.0
    sign = '+' if pct >= 0 else '-'
    return f'{sign}{abs(pct):.0f}%'


def signed_delta(spot, other):
    """Return signed $ delta as float; None if either is None."""
    if spot is None or other is None:
        return None
    return round(float(spot) - float(other), 2)


def signed_pct_num(spot, other):
    """Numeric percent for SPOT vs other."""
    if spot is None or other is None or float(other) == 0:
        return None
    return round((float(spot) - float(other)) / float(other) * 100.0, 1)


# ---------- Load input ----------
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


def _int_or_none(v):
    """Coerce iQuote/qty ID to int for consistent dict keying."""
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


# Normalize keys upfront
for r in spot_rows:
    r['iQuote #'] = _int_or_none(r.get('iQuote #'))
    r['Qty'] = _int_or_none(r.get('Qty'))
for r in iq_rows:
    r['IdQuote'] = _int_or_none(r.get('IdQuote'))
    r['Quantity'] = _int_or_none(r.get('Quantity'))
for r in act_rows:
    r['job_id'] = _int_or_none(r.get('job_id'))


# ---------- Aggregate SPOT per scenario (est, iq, qty) ----------
def _f(v):
    if v is None or v == '':
        return 0.0
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return 0.0
    return float(v)


spot_scenarios = {}  # (est, iq, qty) -> dict
for r in spot_rows:
    key = (r['SPOT Estimate #'], r['iQuote #'], r['Qty'])
    s = spot_scenarios.setdefault(key, {
        'project': r['Project Name'] or '',
        'became_job': r['Became a Job'] or 'No',
        'quote_type': r['Quote Type'] or '',
        'components': [],
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'freight': 0.0,
        'total_cost': 0.0, 'sell_total': 0.0, 'quote_total': 0.0,
        'board_specs': set(),
        'has_die': False,
    })
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
    # Quote Total is the same across rows of a scenario — take max
    s['quote_total'] = max(s['quote_total'], _f(r.get('Quote Total')))
    if die > 0:
        s['has_die'] = True
    spec_bits = []
    if r.get('Board'): spec_bits.append(str(r['Board']))
    if r.get('One-Up W') and r.get('One-Up L'):
        spec_bits.append(f"{r['One-Up W']} x {r['One-Up L']}")
    if r.get('Sheet'): spec_bits.append(f"sheet {r['Sheet']}")
    specs = ' - '.join(spec_bits)
    if specs:
        s['board_specs'].add(specs)
    s['components'].append({
        'name': r.get('Component') or '',
        'print_mode': r.get('Print Mode'),
        'route': r.get('Route'),
        'inches_rule': r.get('Inches of Rule'),
        'cad_method': r.get('CAD Method'),
        'board': r.get('Board'),
        'specs': specs,
        'material': _f(r.get('Material Cost')),
        'print': _f(r.get('Print Cost')),
        'cutting': _f(r.get('Cutting Cost')),
        'hand': hand,
        'die': die,
        'sell': _f(r.get('Sell Total')),
        'strip_diff': r.get('Strip Difficulty'),
        'glue_joints': r.get('Glue Joints'),
        'tape_type': r.get('Tape Type'),
    })

# ---------- Aggregate iQuote per (iQuote#, OptDesc, qty) ----------
# A quote may have multiple OPTIONS (e.g. CAD Cut vs Die Cut). Each option holds
# 1+ components. We aggregate components INSIDE an option, then later pick the
# right option to match each SPOT scenario.
iq_options = {}  # (iq_num, opt_desc, qty) -> dict
iq_option_components = {}  # (iq_num, opt_desc, qty) -> list of component dicts keyed by product name
iq_produced_option = {}  # (iq_num, mis_job) -> opt_desc (option that actually ran)
iq_by_iqnum_qty = defaultdict(list)  # (iq_num, qty) -> list of opt_desc

for r in iq_rows:
    iq_num = r['IdQuote']
    qty = r['Quantity']
    opt = r.get('OptDesc') or ''
    key = (iq_num, opt, qty)
    s = iq_options.setdefault(key, {
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
        'total_cost': 0.0, 'sell_total': 0.0, 'components': [],
        'mis_job': None,
    })
    cutting = _f(r.get('ZundCost')) + _f(r.get('CrestCost')) + _f(r.get('SaberCost')) \
              + _f(r.get('BobstCost')) + _f(r.get('OtherUncategorizedCost'))
    hand = _f(r.get('HandStripCost')) + _f(r.get('GluingCost'))
    s['material'] += _f(r.get('MaterialCost'))
    s['print']    += _f(r.get('PressCost'))
    s['cutting']  += cutting
    s['hand']     += hand
    s['freight']  += _f(r.get('FreightCost'))
    s['not_in_spot'] += _f(r.get('NotInSpotCost'))
    s['total_cost'] += _f(r.get('TotalActualCost'))
    s['sell_total'] += _f(r.get('ComponentTotalPrice'))
    s['components'].append({
        'product': r.get('Product') or '',
        'material': _f(r.get('MaterialCost')),
        'print': _f(r.get('PressCost')),
        'cutting': cutting,
        'hand': hand,
        'sell': _f(r.get('ComponentTotalPrice')),
    })
    iq_option_components.setdefault(key, s['components'])
    mis = r.get('MISJobID')
    if mis and mis != 'NULL':
        mis_int = _int_or_none(mis)
        s['mis_job'] = mis_int
        iq_produced_option[(iq_num, mis_int)] = opt
    if opt not in iq_by_iqnum_qty[(iq_num, qty)]:
        iq_by_iqnum_qty[(iq_num, qty)].append(opt)

iq_quote_totals = {}
for r in iq_rows:
    iq_quote_totals[r['IdQuote']] = _f(r.get('TotalEstimatePrice'))


def _find_iq_qty(iq_num, spot_qty):
    """Return the actual iQuote qty tier that matches SPOT qty within QTY_TOLERANCE."""
    if not iq_by_iqnum_qty:
        return None
    # exact match first
    for (num, qty), _ in [((iq_num, spot_qty), None)]:
        if (num, qty) in iq_by_iqnum_qty:
            return qty
    # tolerance search
    candidate_qtys = [q for (n, q) in iq_by_iqnum_qty.keys() if n == iq_num]
    for q in candidate_qtys:
        if q is not None and spot_qty is not None and abs(q - spot_qty) <= QTY_TOLERANCE:
            return q
    return None


def _synthesize_option_from_products(iq_num, opt, qty, product_names):
    """Sum a subset of components inside an iQuote option to form a synthetic entity.
    The result has a SINGLE combined 'component' entry so per-component matching in
    Quote Comparison compares the whole synthetic bundle to the SPOT bundle line."""
    key = (iq_num, opt, qty)
    if key not in iq_options:
        return None
    all_comps = iq_option_components.get(key, [])
    keep = []
    lower_targets = {str(p).lower() for p in product_names}
    for c in all_comps:
        pname = str(c.get('product') or '').lower()
        if any(t in pname for t in lower_targets):
            keep.append(c)
    if not keep:
        return None
    combined = {'product': '+'.join(c['product'] for c in keep),
                'material': 0.0, 'print': 0.0, 'cutting': 0.0, 'hand': 0.0, 'sell': 0.0}
    for c in keep:
        for k in ('material', 'print', 'cutting', 'hand', 'sell'):
            combined[k] += c[k]
    agg = {'material': combined['material'], 'print': combined['print'],
           'cutting': combined['cutting'], 'hand': combined['hand'],
           'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
           'total_cost': 0.0, 'sell_total': combined['sell'],
           'components': [combined], 'mis_job': None}
    return agg


def resolve_iq_scenario(iq_num, qty, spot_sell_total, mis_job=None):
    """Pick the correct iQuote option to compare against a SPOT scenario.
    Order of precedence:
      1. IQ_OPTION_OVERRIDES exact match on (iq_num, spot_qty)
      2. produced-job option (option flagged with MISJobID)
      3. only one option available
      4. option whose sell_total is closest to SPOT sell_total
      5. first option in list
    Returns (option_data_dict, opt_desc_string) or (None, None).
    """
    # 1. Override
    if (iq_num, qty) in IQ_OPTION_OVERRIDES:
        ov = IQ_OPTION_OVERRIDES[(iq_num, qty)]
        opt = ov['opt']
        iq_qty = ov['iq_qty']
        products = ov.get('products')
        label = ov.get('label')
        key = (iq_num, opt, iq_qty)
        if key in iq_options:
            if products:
                synth = _synthesize_option_from_products(iq_num, opt, iq_qty, products)
                if synth is not None:
                    tag = f'{opt} (filtered: {label or ", ".join(products)}) at iQuote qty {iq_qty}'
                    return synth, tag
            tag = f'{opt} at iQuote qty {iq_qty}'
            return iq_options[key], tag

    # Look up iQuote qty tier with tolerance
    iq_qty = _find_iq_qty(iq_num, qty)
    if iq_qty is None:
        return None, None
    opts = iq_by_iqnum_qty.get((iq_num, iq_qty), [])
    if not opts:
        return None, None

    tag_qty = '' if iq_qty == qty else f' (iQuote qty {iq_qty})'

    # 2. Produced option
    if mis_job is not None and (iq_num, mis_job) in iq_produced_option:
        opt = iq_produced_option[(iq_num, mis_job)]
        if opt in opts:
            return iq_options[(iq_num, opt, iq_qty)], f'{opt}{tag_qty}'
    # 3. Only one option
    if len(opts) == 1:
        opt = opts[0]
        return iq_options[(iq_num, opt, iq_qty)], f'{opt}{tag_qty}' if opt else f'(single option){tag_qty}'
    # 4. Nearest sell match
    if spot_sell_total is not None and spot_sell_total > 0:
        best = min(opts, key=lambda o: abs(iq_options[(iq_num, o, iq_qty)]['sell_total'] - spot_sell_total))
        return iq_options[(iq_num, best, iq_qty)], f'{best}{tag_qty}'
    # 5. First option
    opt = opts[0]
    return iq_options[(iq_num, opt, iq_qty)], f'{opt}{tag_qty}'


def _norm_words(s):
    if not s:
        return set()
    import re
    return set(w for w in re.split(r'[^a-z0-9]+', str(s).lower()) if len(w) > 2)


def match_component(spot_name, iq_components, taken=None):
    """Find best-matching iQuote component for a SPOT component name.
    Scoring: token-overlap count as primary, sequence similarity as tiebreaker.
    Returns (component_dict, index) or (None, None)."""
    if not iq_components:
        return None, None
    from difflib import SequenceMatcher
    taken = taken or set()
    sw = _norm_words(spot_name)
    sn = str(spot_name or '').lower().strip()
    best_idx = None
    best_key = (-1, -1.0)  # (overlap_count, similarity_ratio)
    for i, c in enumerate(iq_components):
        if i in taken:
            continue
        prod = str(c.get('product') or '')
        iw = _norm_words(prod)
        overlap = len(sw & iw)
        ratio = SequenceMatcher(None, sn, prod.lower().strip()).ratio()
        key = (overlap, ratio)
        if key > best_key:
            best_key = key
            best_idx = i
    if best_idx is None:
        for i in range(len(iq_components)):
            if i not in taken:
                return iq_components[i], i
        return None, None
    return iq_components[best_idx], best_idx


# ---------- Aggregate Actuals per job_id ----------
actuals = {}  # job_id -> dict
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


# ---------- Build OUTPUT workbook ----------
wb = openpyxl.Workbook()
wb.remove(wb.active)

# ============================================================
# TAB 1: Executive Summary
# ============================================================
ws = wb.create_sheet('Executive Summary')
ws.column_dimensions['A'].width = 55
ws.column_dimensions['B'].width = 65

ws['A1'] = 'SPOT vs iQuote vs Actuals - Executive Summary'
ws['A1'].font = Font(bold=True, size=14, color='1F4E78')

n_scen = len(spot_scenarios)
n_produced = sum(1 for k, s in spot_scenarios.items() if s['became_job'] == 'Yes')
n_jobs = len(actuals)

ws['A2'] = (f'SPOT vs iQuote on {n_scen} scenarios (fresh corrected pricing engine output). '
            f'Validated against actual production costs on {n_jobs} produced jobs. '
            f'Verdicts: PASS <= +/- 10%, REVIEW <= +/- 20%, FAIL > +/- 20%.')
ws['A2'].alignment = LEFT_WRAP
ws.row_dimensions[2].height = 45
ws.merge_cells('A2:B2')

row = 4
ws.cell(row=row, column=1, value='Summary').font = Font(bold=True, size=12)
row += 1
ws.cell(row=row, column=1, value='Scenarios analyzed').font = Font(bold=True)
ws.cell(row=row, column=2, value=n_scen)
row += 1
ws.cell(row=row, column=1, value='Produced jobs with actuals').font = Font(bold=True)
ws.cell(row=row, column=2, value=n_jobs)
row += 1

# Compare median delta SPOT vs iQuote sell for matched scenarios
deltas_pct = []
for (est, iq, qty), s in spot_scenarios.items():
    iqs, _ = resolve_iq_scenario(iq, qty, s['sell_total'])
    if iqs and iqs['sell_total'] > 0:
        d = (s['sell_total'] - iqs['sell_total']) / iqs['sell_total'] * 100
        deltas_pct.append(d)
if deltas_pct:
    deltas_pct.sort()
    med = deltas_pct[len(deltas_pct)//2]
    sign = '+' if med >= 0 else '-'
    ws.cell(row=row, column=1, value='SPOT prices vs iQuote (median delta)').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'{sign}{abs(med):.1f}%')
    row += 1

# Bucket verdicts
pass_ct = review_ct = fail_ct = 0
for d in deltas_pct:
    if abs(d) <= 10:
        pass_ct += 1
    elif abs(d) <= 20:
        review_ct += 1
    else:
        fail_ct += 1
ws.cell(row=row, column=1, value='Scenarios within +/- 10% / +/- 20%').font = Font(bold=True)
ws.cell(row=row, column=2, value=f'{pass_ct} / {pass_ct+review_ct} of {len(deltas_pct)}')
row += 2

# Actuals section
if actuals:
    ws.cell(row=row, column=1, value=f'Actuals - {n_jobs} PRODUCED JOBS').font = Font(bold=True, size=12)
    row += 1
    tot_invoiced = sum(a['sell'] for a in actuals.values())
    tot_actual_cost = sum(a['total'] for a in actuals.values())
    margin_pct = (tot_invoiced - tot_actual_cost) / tot_invoiced * 100 if tot_invoiced else 0
    ws.cell(row=row, column=1, value='Invoiced vs actual cost').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'${tot_invoiced:,.0f} invoiced / ${tot_actual_cost:,.0f} cost = '
                                     f'{"+" if margin_pct>=0 else "-"}{abs(margin_pct):.0f}% margin')
    row += 1
    # Same work at SPOT prices
    tot_spot = 0
    for job_id, (est, iq, qty) in JOB_MAP.items():
        if job_id in actuals and (est, iq, qty) in spot_scenarios:
            tot_spot += spot_scenarios[(est, iq, qty)]['sell_total']
    if tot_spot > 0:
        spot_margin = (tot_spot - tot_actual_cost) / tot_spot * 100
        ws.cell(row=row, column=1, value='Same work at SPOT prices').font = Font(bold=True)
        ws.cell(row=row, column=2, value=f'${tot_spot:,.0f} = '
                                         f'{"+" if spot_margin>=0 else "-"}{abs(spot_margin):.0f}%')
        row += 1
    lost = sum(1 for a in actuals.values() if a['sell'] < a['total'])
    ws.cell(row=row, column=1, value='Jobs that lost money as invoiced').font = Font(bold=True)
    ws.cell(row=row, column=2, value=f'{lost} of {n_jobs}')
    row += 2

# Category accuracy
if actuals:
    ws.cell(row=row, column=1, value='ACCURACY vs ACTUAL COST (per category)').font = Font(bold=True, size=12)
    row += 1
    cat_actual = defaultdict(float)
    cat_spot = defaultdict(float)
    cat_iq = defaultdict(float)
    for job_id, (est, iq, qty) in JOB_MAP.items():
        if job_id not in actuals:
            continue
        a = actuals[job_id]
        s = spot_scenarios.get((est, iq, qty))
        iqs, _ = resolve_iq_scenario(iq, qty, s['sell_total'] if s else None, mis_job=job_id)
        for cat in ['material', 'print', 'cutting', 'hand', 'die']:
            cat_actual[cat] += a[cat]
            if s: cat_spot[cat] += s[cat]
            if iqs and cat != 'die':
                cat_iq[cat] += iqs.get(cat, 0)
    for cat, label in [('material', 'Material'), ('print', 'Print'),
                        ('cutting', 'Cutting'), ('hand', 'Handwork'), ('die', 'Die')]:
        act_v = cat_actual[cat]
        spot_v = cat_spot[cat]
        iq_v = cat_iq[cat] if cat != 'die' else 0
        if act_v == 0 and spot_v == 0 and iq_v == 0:
            continue
        spot_delta = signed_pct(spot_v, act_v) if act_v else 'n/a'
        iq_delta = signed_pct(iq_v, act_v) if act_v and cat != 'die' else ('n/a' if cat == 'die' else 'n/a')
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        ws.cell(row=row, column=2, value=f'SPOT {spot_delta} vs actual - iQuote {iq_delta} vs actual '
                                          f'(act ${act_v:,.0f} - spot ${spot_v:,.0f} - iq ${iq_v:,.0f})')
        row += 1

row += 1
ws.cell(row=row, column=1, value='KEY TAKEAWAYS').font = Font(bold=True, size=12)
row += 1
takeaways = [
    'SPOT pricing is closer to actual cost than iQuote in most categories on produced jobs.',
    'Materials are well calibrated (SPOT within +/- 10% of actual).',
    'Print costs: SPOT tends to be under actual; iQuote significantly more so. Print calibration warranted.',
    'Cutting throughput remains a systematic gap in both systems - Kongsberg / Zund actual rates trail estimates.',
    'Small-qty scenarios (<= 50) carry a heavy SPOT premium - review minimums policy?',
    'Die is missing from iQuote export data - noted in Quote Comparison rows where a die was priced by SPOT or run in production.',
]
for t in takeaways:
    ws.cell(row=row, column=1, value=t)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
    ws.cell(row=row, column=1).alignment = LEFT_WRAP
    ws.row_dimensions[row].height = 30
    row += 1


# ============================================================
# TAB 2: Quote Comparison (Actuals 3-Way style layout)
# ============================================================
ws = wb.create_sheet('Quote Comparison')
qc_headers = ['Project - SPOT Est - iQuote #', 'Qty', 'Category',
              'SPOT $', 'iQuote $', 'Delta $', 'Delta %', 'Verdict', 'Note']
widths = [55, 10, 22, 12, 12, 12, 11, 12, 40]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws['A1'] = 'Quote-by-Quote: SPOT vs iQuote (Category breakdown per scenario)'
ws['A1'].font = Font(bold=True, size=13, color='1F4E78')
ws.merge_cells('A1:I1')

ws['A2'] = ('Grouped by SPOT project. One block per COMPONENT within a scenario, using the '
            'Actuals 3-Way row layout (Material / Print / Cutting / Handwork / Die / TOTAL SELL). '
            'Delta % = SPOT vs iQuote where + means SPOT higher. Missing side shown blank with note. '
            'iQuote export does not include die cost (noted where SPOT priced a die).')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:I2')
ws.row_dimensions[2].height = 45

# Header
row = 4
for c, h in enumerate(qc_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = CENTER
    cell.border = BORDER
row += 1

# Sort scenarios by project name for stable output
scen_sorted = sorted(spot_scenarios.items(),
                      key=lambda kv: (kv[1]['project'], kv[0][0], kv[0][2]))


def verdict(pct):
    if pct is None:
        return ''
    ap = abs(pct)
    if ap <= 10: return 'PASS'
    if ap <= 20: return 'REVIEW'
    return 'FAIL'


def _pct_str(p):
    if p is None:
        return 'n/a'
    return f'{"+" if p >= 0 else "-"}{abs(p):.1f}%'


for (est, iq, qty), s in scen_sorted:
    iq_data, iq_opt = resolve_iq_scenario(iq, qty, None)
    became = ' - BECAME A JOB' if s['became_job'] == 'Yes' else ''
    opt_str = f' - iQuote option: {iq_opt}' if iq_opt and iq_opt.strip() else ''
    proj = s['project'] or '(no project name)'
    header_txt = f"{proj} - SPOT {est} - iQuote #{iq} - qty {qty}{became}{opt_str}"
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    c = ws.cell(row=row, column=1, value=header_txt)
    c.font = GROUP_FONT
    c.fill = GROUP_FILL
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    row += 1

    iq_components = iq_data['components'] if iq_data else []
    taken = set()

    for spot_comp in s['components']:
        iq_match, iq_idx = match_component(spot_comp['name'], iq_components, taken)
        if iq_idx is not None:
            taken.add(iq_idx)

        # Component sub-header
        comp_label = spot_comp['name'] or '(unnamed component)'
        iq_prod = iq_match['product'] if iq_match else '(no iQuote match)'
        sub_header = f'    Component: {comp_label}    -    iQuote product: {iq_prod}'
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
        c = ws.cell(row=row, column=1, value=sub_header)
        c.font = Font(italic=True, size=10, color='666666')
        c.alignment = Alignment(horizontal='left', indent=1)
        row += 1

        rows_data = [
            ('Material', spot_comp['material'], (iq_match['material'] if iq_match else None)),
            ('Print',    spot_comp['print'],    (iq_match['print']    if iq_match else None)),
            ('Cutting',  spot_comp['cutting'],  (iq_match['cutting']  if iq_match else None)),
            ('Handwork', spot_comp['hand'],     (iq_match['hand']     if iq_match else None)),
        ]
        die_spot = spot_comp['die']
        die_iq = None  # iQuote export has no die
        if die_spot > 0 or die_iq:
            rows_data.append(('Die',
                              die_spot if die_spot > 0 else None,
                              die_iq if die_iq else None))

        for cat, spot_v, iq_v in rows_data:
            d_dollar = signed_delta(spot_v, iq_v)
            d_pct = signed_pct_num(spot_v, iq_v)
            note = ''
            if spot_v is None and iq_v is not None:
                note = f'{cat} on iQuote only'
            elif iq_v is None and spot_v is not None:
                if cat == 'Die':
                    note = 'iQuote export does not include die cost'
                else:
                    note = f'{cat} on SPOT only'
            vals = [None, qty if cat == 'Material' else None, cat, spot_v, iq_v, d_dollar,
                    _pct_str(d_pct), '', note]
            for c_idx, v in enumerate(vals, 1):
                cell = ws.cell(row=row, column=c_idx, value=v)
                cell.border = BORDER
                if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
                    cell.number_format = '#,##0.00'
                if c_idx == 3:
                    cell.alignment = Alignment(horizontal='left', indent=1)
                if c_idx == 9:
                    cell.alignment = LEFT_WRAP
            row += 1

        # TOTAL SELL row for this component
        total_spot_sell = spot_comp['sell']
        total_iq_sell = iq_match['sell'] if iq_match else None
        d_dollar = signed_delta(total_spot_sell, total_iq_sell)
        d_pct = signed_pct_num(total_spot_sell, total_iq_sell)
        verd = verdict(d_pct)
        note = ''
        if total_iq_sell is None and total_spot_sell is not None:
            note = 'No matching iQuote component'
        for c_idx, v in enumerate([None, qty, 'TOTAL SELL', total_spot_sell, total_iq_sell,
                                   d_dollar, _pct_str(d_pct), verd, note], 1):
            cell = ws.cell(row=row, column=c_idx, value=v)
            cell.border = BORDER
            cell.fill = TOTAL_FILL
            cell.font = TOTAL_FONT
            if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
                cell.number_format = '#,##0.00'
            if c_idx == 3:
                cell.alignment = Alignment(horizontal='left', indent=1)
            if c_idx == 8 and verd:
                colors = {'PASS': '00B050', 'REVIEW': 'ED7D31', 'FAIL': 'C00000'}
                cell.font = Font(bold=True, color=colors.get(verd, '000000'))
        row += 1

    row += 1  # blank between scenarios


# ============================================================
# TAB 3: Pricing Summary (one row per SPOT component - totals only)
# ============================================================
ws = wb.create_sheet('Pricing Summary')
ps_headers = ['Project', 'SPOT Estimate #', 'iQuote #', 'Qty', 'Component', 'Board Specs',
              'iQuote Sell $', 'SPOT Sell $', 'Delta $', 'Delta %', 'Verdict', 'Became a Job']
widths = [32, 22, 12, 10, 40, 40, 14, 14, 14, 12, 12, 15]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws['A1'] = 'Pricing Summary - iQuote vs SPOT (totals only)'
ws['A1'].font = Font(bold=True, size=13, color='1F4E78')
ws.merge_cells('A1:L1')

ws['A2'] = ('One row per SPOT component (Multi-Part quotes have one line per variant). '
            'iQuote sell = matched iQuote component. Delta = SPOT vs iQuote where + means SPOT higher.')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:L2')
ws.row_dimensions[2].height = 30

# Header
row = 4
for c, h in enumerate(ps_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = CENTER
    cell.border = BORDER
row += 1

for (est, iq, qty), s in scen_sorted:
    iq_data, _ = resolve_iq_scenario(iq, qty, None)
    iq_components = iq_data['components'] if iq_data else []
    taken = set()
    proj = s['project'] or '(no project name)'

    for spot_comp in s['components']:
        iq_match, iq_idx = match_component(spot_comp['name'], iq_components, taken)
        if iq_idx is not None:
            taken.add(iq_idx)
        iq_sell = iq_match['sell'] if iq_match else None
        spot_sell = spot_comp['sell']
        d_dollar = signed_delta(spot_sell, iq_sell)
        d_pct = signed_pct_num(spot_sell, iq_sell)
        verd = verdict(d_pct)
        vals = [
            proj, est, iq, qty, spot_comp['name'] or '(unnamed)',
            spot_comp['specs'],
            iq_sell, spot_sell, d_dollar, _pct_str(d_pct),
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

ws['A2'] = ('Ground-truth check. Actuals joined by job ID to SPOT scenario. '
            'Small sample - use for direction, not gospel. Hand-labor actuals are $0 on some jobs '
            '(likely absorbed elsewhere in MIS costing). Die is missing from iQuote export data.')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:I2')
ws.row_dimensions[2].height = 45

row = 4
for c, h in enumerate(a3_headers, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = CENTER
    cell.border = BORDER
row += 1

job_ids_sorted = sorted(JOB_MAP.keys())

for job_id in job_ids_sorted:
    est, iq, qty = JOB_MAP[job_id]
    a = actuals.get(job_id)
    if not a:
        continue
    s = spot_scenarios.get((est, iq, qty))
    iqs, _ = resolve_iq_scenario(iq, qty, s['sell_total'] if s else None, mis_job=job_id)

    ref_txt = f'{est} - {iq}'
    cats = [
        ('Material', 'material'),
        ('Print', 'print'),
        ('Cutting', 'cutting'),
        ('Handwork', 'hand'),
        ('Die', 'die'),
    ]
    first = True
    total_spot_excl_die = 0
    total_iq_excl_die = 0
    total_act_excl_die = 0
    for label, key in cats:
        spot_v = s[key] if s else None
        iq_v = iqs[key] if (iqs and key in iqs) else (0 if key != 'die' else None)
        act_v = a[key] if a else None
        if key != 'die':
            total_spot_excl_die += (spot_v or 0)
            total_iq_excl_die += (iq_v or 0)
            total_act_excl_die += (act_v or 0)
        spot_vs_act = signed_pct(spot_v, act_v)
        iq_vs_act = signed_pct(iq_v, act_v) if iq_v is not None else 'n/a'
        note = ''
        if key == 'die' and iq_v is None and (spot_v or 0) == 0 and (act_v or 0) > 0:
            note = 'no die on quote; die ordered on actual job'
        elif key == 'die' and iq_v is None:
            note = 'iQuote export does not include die cost'
        cells = [
            job_id if first else None,
            ref_txt if first else None,
            label,
            spot_v, iq_v, act_v,
            spot_vs_act, iq_vs_act, note,
        ]
        for c_idx, v in enumerate(cells, 1):
            cell = ws.cell(row=row, column=c_idx, value=v)
            cell.border = BORDER
            if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
                cell.number_format = '#,##0.00'
        first = False
        row += 1
    # TOTAL (excl die)
    d_spot_pct = signed_pct(total_spot_excl_die, total_act_excl_die)
    d_iq_pct = signed_pct(total_iq_excl_die, total_act_excl_die)
    cells = [None, None, 'TOTAL (excl die)', total_spot_excl_die, total_iq_excl_die,
             total_act_excl_die, d_spot_pct, d_iq_pct, '']
    for c_idx, v in enumerate(cells, 1):
        cell = ws.cell(row=row, column=c_idx, value=v)
        cell.border = BORDER
        cell.fill = TOTAL_FILL
        cell.font = TOTAL_FONT
        if c_idx in (4, 5, 6) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
    row += 1
    row += 1  # blank

# Bottom summary: sold price vs actual cost
row += 1
ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
c = ws.cell(row=row, column=1, value='SOLD PRICE vs ACTUAL COST - would SPOT prices have been viable?')
c.font = Font(bold=True, size=12)
row += 1
sold_headers = ['MIS Job', 'iQuote Sold $', 'SPOT Would-Be $', 'ACTUAL Cost $',
                'Margin as Sold', 'Margin at SPOT Price']
for c_idx, h in enumerate(sold_headers, 1):
    cell = ws.cell(row=row, column=c_idx, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = BORDER
    cell.alignment = CENTER
row += 1

tot_sold = tot_spot = tot_act = 0
for job_id in job_ids_sorted:
    est, iq, qty = JOB_MAP[job_id]
    a = actuals.get(job_id)
    if not a:
        continue
    s = spot_scenarios.get((est, iq, qty))
    sold = a['sell']
    spot_sell = s['sell_total'] if s else 0
    act = a['total']
    tot_sold += sold
    tot_spot += spot_sell
    tot_act += act
    m_sold = (sold - act) / sold * 100 if sold else 0
    m_spot = (spot_sell - act) / spot_sell * 100 if spot_sell else 0
    cells = [job_id, sold, spot_sell, act,
             f'{"+" if m_sold >= 0 else "-"}{abs(m_sold):.0f}%',
             f'{"+" if m_spot >= 0 else "-"}{abs(m_spot):.0f}%']
    for c_idx, v in enumerate(cells, 1):
        cell = ws.cell(row=row, column=c_idx, value=v)
        cell.border = BORDER
        if c_idx in (2, 3, 4) and isinstance(v, (int, float)):
            cell.number_format = '#,##0.00'
    row += 1

# TOTAL
m_sold = (tot_sold - tot_act) / tot_sold * 100 if tot_sold else 0
m_spot = (tot_spot - tot_act) / tot_spot * 100 if tot_spot else 0
cells = ['TOTAL', tot_sold, tot_spot, tot_act,
         f'{"+" if m_sold >= 0 else "-"}{abs(m_sold):.0f}%',
         f'{"+" if m_spot >= 0 else "-"}{abs(m_spot):.0f}%']
for c_idx, v in enumerate(cells, 1):
    cell = ws.cell(row=row, column=c_idx, value=v)
    cell.border = BORDER
    cell.fill = TOTAL_FILL
    cell.font = Font(bold=True)
    if c_idx in (2, 3, 4) and isinstance(v, (int, float)):
        cell.number_format = '#,##0.00'
row += 2

# Findings
ws.cell(row=row, column=1, value='FINDINGS').font = Font(bold=True, size=12)
row += 1
findings = [
    f'These {len(actuals)} jobs sold for ${tot_sold:,.0f} but actually cost ${tot_act:,.0f} - '
    f'collectively sold {"+" if m_sold >= 0 else "-"}{abs(m_sold):.0f}% vs cost.',
    f'At SPOT prices (${tot_spot:,.0f}) the same work would land at '
    f'{"+" if m_spot >= 0 else "-"}{abs(m_spot):.0f}% margin - '
    'demonstrating SPOT pricing is largely justified rather than over-priced.',
    'Cutting throughput remains the systematic gap in both estimates - actuals run higher on multiple jobs.',
    'iQuote source data does not expose die cost - noted per row where relevant.',
]
for t in findings:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    ws.cell(row=row, column=1, value=t).alignment = LEFT_WRAP
    ws.row_dimensions[row].height = 30
    row += 1


# Save
wb.save(OUT_PATH)
print(f'Wrote {OUT_PATH}')
print(f'Scenarios: {len(spot_scenarios)}, iQuote options: {len(iq_options)}, Actuals: {len(actuals)}')
