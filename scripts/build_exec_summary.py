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
import csv as _csv
import os as _os

IN_PATH = '/tmp/analysis/input.xlsx'
WF_MARGIN_CSV = '/app/scripts/WFMargin.csv'  # 12-month historical wide-format job margins
WF_EXCLUDE_JOBS = {228117}  # outsource digital material misallocated to single job
OUT_PATH = '/tmp/analysis/SPOT_Exec_Summary_v2.xlsx'

# ---------- Overrides ----------
IQ_OPTION_OVERRIDES = {
    223860: 'Die Cut 2510223768',
}

# Per-(iq_num, spot_qty) overrides for opt/iq_qty/product-filter/product-exclude.
IQ_PER_QTY_OVERRIDES = {
    (221998, 525):  {'opt': 'Option 1 - D/C w/riser', 'iq_qty': 525,
                     'exclude': ['Shelf 1', 'Shelf 2', 'Shelf 3'],
                     'label': 'Panels + Riser + Box (qty 525 - excl shelves)'},
    (221998, 1575): {'opt': 'Option 1 - D/C w/riser', 'iq_qty': 525,
                     'products': ['Shelf 1', 'Shelf 2', 'Shelf 3'],
                     'label': 'Shelves 1+2+3 at qty 525'},
}

# Force these iQuote #s to be treated as split-by-qty (each SPOT qty = own scenario).
FORCE_SPLIT_BY_QTY_IQ_NUMS = {221998}

# Per-scenario notes to surface in the report (keyed by SPOT Estimate #)
SCENARIO_NOTES = {
    'RW-260622-133707': [
        'SPOT D/C Tray was priced as saber + CAD - 3 cuts, 4 blanks out on a 60x120 sheet (unusual case).',
        'iQuote quoted both bobst AND zund for the same component.',
    ],
    'RW-260730-153734': [
        'Cento actual sold price is a PRE-INVOICE of $1,218.84 (near iQuote price), not a final invoice. Treat margin figures as directional.',
    ],
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
    237334: ('RW-260730-153734', 223837),
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


# ---------- Aggregate iQuote per (iq_num, opt_desc, qty) - per-qty totals ----------
iq_by_key = {}  # (iq_num, opt_desc, qty) -> aggregated dict for that specific qty tier
iq_options_by_iqnum = defaultdict(set)  # iq_num -> set of opt_desc
iq_qtys_for_opt = defaultdict(set)  # (iq_num, opt_desc) -> set of qtys present
iq_produced_option = {}  # (iq_num, mis_job) -> opt_desc (option run to production)
iq_quote_totals = {}  # iq_num -> TotalEstimatePrice

for r in iq_rows:
    iq_num = r['IdQuote']
    opt = r.get('OptDesc') or ''
    qty = r['Quantity']
    key = (iq_num, opt, qty)
    a = iq_by_key.setdefault(key, {
        'material': 0.0, 'print': 0.0, 'cutting': 0.0,
        'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
        'total_cost': 0.0, 'sell_total': 0.0, 'products': [],
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
    a['products'].append({'product': str(r.get('Product') or ''), 'qty': qty,
                          'sell': _f(r.get('ComponentTotalPrice'))})
    iq_options_by_iqnum[iq_num].add(opt)
    iq_qtys_for_opt[(iq_num, opt)].add(qty)

    mis = r.get('MISJobID')
    if mis and mis != 'NULL':
        mis_int = _int_or_none(mis)
        iq_produced_option[(iq_num, mis_int)] = opt

    iq_quote_totals[iq_num] = _f(r.get('TotalEstimatePrice'))


# ---------- Detect "all options are single-component variants" iQuote #s ----------
# Signature: for a given iq_num, EVERY row has TotalEstimatePrice == its own ComponentTotalPrice
# AND every OptDesc has only ONE row. Means each option = 1 distinct variant that together
# form the whole quote scope. These should be SUMMED (not picked from) when SPOT has variants.
_iq_row_signature = defaultdict(list)  # iq_num -> list of (opt, qty, comp_price, tot_est)
for r in iq_rows:
    _iq_row_signature[r['IdQuote']].append((r.get('OptDesc') or '',
                                              r.get('Quantity'),
                                              _f(r.get('ComponentTotalPrice')),
                                              _f(r.get('TotalEstimatePrice'))))

VARIANTS_STYLE_IQ = set()  # iq_num for which iQuote should SUM all options at matched qty
for iq_num, rows in _iq_row_signature.items():
    if len(rows) < 2:
        continue
    all_single = all(abs(tot - cp) < 0.01 for (opt, qty, cp, tot) in rows)
    # Count rows per OptDesc
    per_opt = defaultdict(int)
    for opt, qty, cp, tot in rows:
        per_opt[opt] += 1
    all_options_single_row = all(v == 1 for v in per_opt.values())
    if all_single and all_options_single_row:
        VARIANTS_STYLE_IQ.add(iq_num)


def _sum_option_products(iq_num, opt, iq_qty, products=None, exclude=None):
    """Sum a specific iQuote option's rows at a specific qty, with optional include/exclude filter."""
    k = (iq_num, opt, iq_qty)
    if k not in iq_by_key:
        return None
    d = iq_by_key[k]
    if not products and not exclude:
        return d
    agg = {'material': 0.0, 'print': 0.0, 'cutting': 0.0,
           'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
           'total_cost': 0.0, 'sell_total': 0.0, 'products': []}
    include_lower = {str(p).lower() for p in (products or [])}
    exclude_lower = {str(p).lower() for p in (exclude or [])}
    # We need per-row product breakdowns. iq_by_key rolls per (iq, opt, qty). Recompute from raw rows.
    for r in iq_rows:
        if r['IdQuote'] != iq_num or (r.get('OptDesc') or '') != opt or r['Quantity'] != iq_qty:
            continue
        pname = str(r.get('Product') or '').lower()
        if include_lower and not any(t in pname for t in include_lower):
            continue
        if exclude_lower and any(t in pname for t in exclude_lower):
            continue
        cutting = _f(r.get('ZundCost')) + _f(r.get('CrestCost')) + _f(r.get('SaberCost')) \
                  + _f(r.get('BobstCost')) + _f(r.get('OtherUncategorizedCost'))
        hand = _f(r.get('HandStripCost')) + _f(r.get('GluingCost'))
        agg['material'] += _f(r.get('MaterialCost'))
        agg['print']    += _f(r.get('PressCost'))
        agg['cutting']  += cutting
        agg['hand']     += hand
        agg['freight']  += _f(r.get('FreightCost'))
        agg['sell_total'] += _f(r.get('ComponentTotalPrice'))
        agg['products'].append({'product': str(r.get('Product') or ''),
                                'qty': iq_qty, 'sell': _f(r.get('ComponentTotalPrice'))})
    return agg if agg['products'] else None


def _sum_option_at_qtys(iq_num, opt, qtys_to_sum):
    """Sum iq_by_key rows for a given (iq_num, opt) at a specific set of qtys."""
    agg = {'material': 0.0, 'print': 0.0, 'cutting': 0.0,
           'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
           'total_cost': 0.0, 'sell_total': 0.0, 'products': [], 'qtys': set()}
    for q in qtys_to_sum:
        k = (iq_num, opt, q)
        if k not in iq_by_key:
            continue
        d = iq_by_key[k]
        for f in ('material', 'print', 'cutting', 'hand', 'die',
                  'freight', 'not_in_spot', 'total_cost', 'sell_total'):
            agg[f] += d[f]
        agg['products'].extend(d['products'])
        agg['qtys'].add(q)
    return agg if agg['sell_total'] > 0 or agg['products'] else None


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
    # Force split by qty for iq_num in FORCE_SPLIT_BY_QTY_IQ_NUMS
    alt_tier = _is_alt_tier(rows) or (iq_num in FORCE_SPLIT_BY_QTY_IQ_NUMS)
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
def _match_qtys(iq_num, opt, spot_qtys):
    """Return the set of iQuote qtys (in this option) that match any SPOT qty within tolerance."""
    iq_qtys = iq_qtys_for_opt.get((iq_num, opt), set())
    matched = set()
    for sq in spot_qtys:
        if sq is None:
            continue
        for iq_q in iq_qtys:
            if iq_q is not None and abs(iq_q - sq) <= QTY_TOLERANCE:
                matched.add(iq_q)
    return matched


def resolve_iq(iq_num, scen_qtys, spot_sell, mis_job=None, spot_row_count=0):
    """Return (option_dict, opt_desc_str, resolution_note).
    Sums iQuote entries for the chosen option at ONLY the qty tiers matching
    the SPOT scenario's qtys (with tolerance). Falls back to all qtys if none match.
    spot_row_count is the number of SPOT rows in the scenario - used to decide
    whether to SUM all variant-style iQuote options.
    """
    if iq_num is None:
        return None, None, 'No iQuote # on SPOT scenario'
    if iq_num not in iq_options_by_iqnum:
        return None, None, 'iQuote # not found in iQuote export'

    scen_qtys = set(scen_qtys) if scen_qtys else set()

    # 0. Per-(iq, qty) override (product include/exclude filter)
    single_qty = next(iter(scen_qtys)) if len(scen_qtys) == 1 else None
    if single_qty is not None and (iq_num, single_qty) in IQ_PER_QTY_OVERRIDES:
        ov = IQ_PER_QTY_OVERRIDES[(iq_num, single_qty)]
        opt = ov['opt']
        iq_qty = ov['iq_qty']
        agg = _sum_option_products(iq_num, opt, iq_qty,
                                     products=ov.get('products'),
                                     exclude=ov.get('exclude'))
        if agg is not None:
            label = ov.get('label', '')
            return agg, opt, f'per-qty override: {opt!r} at iQuote qty {iq_qty} - {label}'

    def build(opt, note_prefix):
        matched_qtys = _match_qtys(iq_num, opt, scen_qtys)
        all_qtys = iq_qtys_for_opt.get((iq_num, opt), set())
        if matched_qtys:
            qty_note = ('matched iQuote qty ' + ', '.join(str(q) for q in sorted(matched_qtys))
                        if matched_qtys != scen_qtys else '')
            agg = _sum_option_at_qtys(iq_num, opt, matched_qtys)
            n = f'{note_prefix} - {qty_note}' if qty_note else note_prefix
            return agg, opt, n
        agg = _sum_option_at_qtys(iq_num, opt, all_qtys)
        qtys_str = ', '.join(str(q) for q in sorted(all_qtys))
        n = f'{note_prefix} - no qty overlap with SPOT; using all iQuote qtys ({qtys_str})'
        return agg, opt, n

    # 1. Whole-option override
    if iq_num in IQ_OPTION_OVERRIDES:
        opt = IQ_OPTION_OVERRIDES[iq_num]
        if (iq_num, opt) in iq_qtys_for_opt:
            return build(opt, f'override: forced OptDesc {opt!r}')

    all_opts = iq_options_by_iqnum[iq_num]

    # 2. Produced-job option (for actuals resolution)
    if mis_job is not None and (iq_num, mis_job) in iq_produced_option:
        opt = iq_produced_option[(iq_num, mis_job)]
        if opt in all_opts:
            return build(opt, f'produced job {mis_job} ran option {opt!r}')

    # 3. VARIANTS-STYLE iQuote: each option is one distinct variant. SUM all at matched qtys.
    if iq_num in VARIANTS_STYLE_IQ and spot_row_count > 1:
        agg = {'material': 0.0, 'print': 0.0, 'cutting': 0.0,
               'hand': 0.0, 'die': 0.0, 'freight': 0.0, 'not_in_spot': 0.0,
               'total_cost': 0.0, 'sell_total': 0.0, 'products': [], 'qtys': set()}
        for opt in all_opts:
            matched_qtys = _match_qtys(iq_num, opt, scen_qtys) or iq_qtys_for_opt[(iq_num, opt)]
            a = _sum_option_at_qtys(iq_num, opt, matched_qtys)
            if a is None:
                continue
            for f in ('material', 'print', 'cutting', 'hand', 'die',
                      'freight', 'not_in_spot', 'total_cost', 'sell_total'):
                agg[f] += a[f]
            agg['products'].extend(a['products'])
            agg['qtys'].update(a['qtys'])
        return agg, f'ALL {len(all_opts)} options', \
               f'variants-style iQuote: summed all {len(all_opts)} single-component options'

    # 4. Single option
    if len(all_opts) == 1:
        opt = next(iter(all_opts))
        return build(opt, 'only one option available')

    # 5. Multi-option: pick option with best qty overlap + closest sell match
    def score(opt):
        oqtys = iq_qtys_for_opt[(iq_num, opt)]
        cover = 0
        for sq in scen_qtys:
            for oq in oqtys:
                if sq is not None and oq is not None and abs(oq - sq) <= QTY_TOLERANCE:
                    cover += 1
                    break
        matched = _match_qtys(iq_num, opt, scen_qtys)
        sell_at_match = sum(iq_by_key[(iq_num, opt, q)]['sell_total'] for q in matched)
        near = -abs(sell_at_match - (spot_sell or 0))
        return (cover, near)

    ranked = sorted(all_opts, key=score, reverse=True)
    if ranked:
        return build(ranked[0], 'best qty overlap + closest sell match')
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
    iq_data, _, _ = resolve_iq(iq, s['qtys'], s['sell_total'], spot_row_count=len(s.get('components', [])))
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
    iq_data, iq_opt, iq_note = resolve_iq(iq, s['qtys'], s['sell_total'], spot_row_count=len(s.get('components', [])))

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

    # Per-scenario custom notes
    for note_line in SCENARIO_NOTES.get(est, []):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
        c = ws.cell(row=row, column=1, value=f'    Note: {note_line}')
        c.font = Font(italic=True, size=9, color='C00000')
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
    iq_data, iq_opt, _ = resolve_iq(iq, s['qtys'], s['sell_total'], spot_row_count=len(s.get('components', [])))
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
    iq_data, _, _ = resolve_iq(iq, s['qtys'], s['sell_total'], spot_row_count=len(s.get('components', [])))
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


# ============================================================
# TAB 7: Qty Bucket Analysis - where SPOT protects from historical loss
# ============================================================
ws = wb.create_sheet('Qty Bucket Analysis')
for col, w in enumerate([16, 6, 12, 12, 13, 13, 14, 13, 14, 13, 13, 13], 1):
    ws.column_dimensions[get_column_letter(col)].width = w

ws['A1'] = 'Qty Bucket Analysis - wide-format produced jobs'
ws['A1'].font = Font(bold=True, size=14, color='1F4E78')
ws.merge_cells('A1:L1')

ws['A2'] = ('Historical context: SPOT was built to eliminate wide-format under-pricing on '
            'moderate-to-high qty jobs. This tab compares actual print cost vs iQuote and '
            'SPOT estimates by qty bucket on 9 produced jobs, then shows margin as sold vs '
            'margin if the same work had been priced at SPOT rates.')
ws['A2'].alignment = LEFT_WRAP
ws.merge_cells('A2:L2')
ws.row_dimensions[2].height = 55

# Build qty bucket data from JOB_MAP + actuals + spot + iq
def _qb(q):
    if q is None: return 'unknown'
    if q < 100: return '< 100'
    if q < 250: return '100-249'
    if q < 500: return '250-499'
    return '500+'

# Aggregate per bucket
bucket_data = {}
# Index SPOT raw rows by iQuote # + qty for accurate produced-qty match
_spot_by_iq_qty = defaultdict(lambda: defaultdict(list))
for r in spot_rows:
    _spot_by_iq_qty[r['iQuote #']][r['Qty']].append(r)

for job_id in sorted(JOB_MAP.keys()):
    est, iq_num = JOB_MAP[job_id]
    a = actuals.get(job_id)
    if not a:
        continue

    # Find iQuote produced-option qtys for this job (that's the qty the job actually ran at)
    prod_qtys = set()
    for r in iq_rows:
        if r['IdQuote'] == iq_num and r.get('MISJobID') and r.get('MISJobID') != 'NULL':
            try:
                if int(r.get('MISJobID')) == job_id:
                    prod_qtys.add(r['Quantity'])
            except (TypeError, ValueError):
                pass

    # Sum SPOT rows for this iq at the produced qtys (with tolerance)
    spot_print = 0.0
    spot_sell = 0.0
    matched_qty = None
    for q, rows in _spot_by_iq_qty.get(iq_num, {}).items():
        for pq in prod_qtys:
            if q is not None and pq is not None and abs(q - pq) <= QTY_TOLERANCE:
                for r in rows:
                    spot_print += _f(r.get('Print Cost'))
                    spot_sell += _f(r.get('Sell Total'))
                    if matched_qty is None or q > matched_qty:
                        matched_qty = q
                break

    # iQuote produced option data
    iq_prod_print = 0.0
    iq_prod_sell = 0.0
    for r in iq_rows:
        if r['IdQuote'] == iq_num and r.get('MISJobID') and r.get('MISJobID') != 'NULL':
            try:
                if int(r.get('MISJobID')) == job_id:
                    iq_prod_print += _f(r.get('PressCost'))
                    iq_prod_sell += _f(r.get('ComponentTotalPrice'))
            except (TypeError, ValueError):
                pass

    qty = matched_qty or (max(prod_qtys) if prod_qtys else 0)
    b = _qb(qty)
    d = bucket_data.setdefault(b, {'n':0, 'sold':0, 'cost':0, 'spot_sell':0, 'iq_sell':0,
                                    'p_act':0, 'p_iq':0, 'p_spot':0,
                                    'jobs':[]})
    d['n'] += 1
    d['sold']      += a['sell']
    d['cost']      += a['total']
    d['spot_sell'] += spot_sell
    d['iq_sell']   += iq_prod_sell
    d['p_act']     += a['print']
    d['p_iq']      += iq_prod_print
    d['p_spot']    += spot_print
    d['jobs'].append(job_id)


# --- Table 1: Print vs actual by bucket ---
row = 4
ws.cell(row=row, column=1, value='Print cost - actual vs iQuote estimate vs SPOT estimate').font = Font(bold=True, size=12)
row += 1
hdrs = ['Qty bucket', 'Jobs', 'Actual Print $', 'iQuote Print $', 'iQuote vs Actual',
        'SPOT Print $', 'SPOT vs Actual']
for c, h in enumerate(hdrs, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL; cell.border = BORDER; cell.alignment = CENTER
row += 1
t1_start = row
order = ['< 100', '100-249', '250-499', '500+']
for b in order:
    if b not in bucket_data:
        continue
    d = bucket_data[b]
    iq_pct = (d['p_iq'] - d['p_act']) / d['p_act'] * 100 if d['p_act'] else 0
    sp_pct = (d['p_spot'] - d['p_act']) / d['p_act'] * 100 if d['p_act'] else 0
    vals = [b, d['n'], round(d['p_act']), round(d['p_iq']),
            f'{"+" if iq_pct>=0 else "-"}{abs(iq_pct):.0f}%',
            round(d['p_spot']),
            f'{"+" if sp_pct>=0 else "-"}{abs(sp_pct):.0f}%']
    for c, v in enumerate(vals, 1):
        cell = ws.cell(row=row, column=c, value=v); cell.border = BORDER
        if c in (3, 4, 6) and isinstance(v, (int, float)):
            cell.number_format = '"$"#,##0'
        if c == 5 and iq_pct <= -20:
            cell.font = Font(bold=True, color='C00000')
        if c == 7 and abs(sp_pct) <= 20:
            cell.font = Font(bold=True, color='00B050')
    row += 1
t1_end = row - 1

# Chart 1: Print by bucket - actual vs iQuote vs SPOT
ch = BarChart()
ch.type = 'col'; ch.style = 12; ch.grouping = 'clustered'
ch.title = 'Print $ - actual vs iQuote estimate vs SPOT estimate (by qty)'
ch.y_axis.title = 'Print $'
ch.x_axis.title = 'Qty bucket'
# Data spans Actual (col 3), iQuote (col 4), SPOT (col 6). We need contiguous columns.
# Build a separate contiguous block for the chart.
row += 2
chart_hdr_row = row
ws.cell(row=row, column=1, value='Chart data - Print $ by bucket').font = Font(bold=True)
row += 1
for c, h in enumerate(['Qty bucket', 'Actual $', 'iQuote est $', 'SPOT est $'], 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
row += 1
c_start = row
for b in order:
    if b not in bucket_data:
        continue
    d = bucket_data[b]
    ws.cell(row=row, column=1, value=b)
    ws.cell(row=row, column=2, value=round(d['p_act']))
    ws.cell(row=row, column=3, value=round(d['p_iq']))
    ws.cell(row=row, column=4, value=round(d['p_spot']))
    row += 1
c_end = row - 1

data = Reference(ws, min_col=2, min_row=c_start-1, max_row=c_end, max_col=4)
cats = Reference(ws, min_col=1, min_row=c_start, max_row=c_end)
ch.add_data(data, titles_from_data=True)
ch.set_categories(cats)
ch.height = 10; ch.width = 20
ws.add_chart(ch, 'I4')

row += 2
# --- Table 2: Margin analysis by bucket ---
ws.cell(row=row, column=1, value='Margin as sold vs margin at SPOT prices').font = Font(bold=True, size=12)
row += 1
hdrs2 = ['Qty bucket', 'Jobs', 'Sold $', 'Actual Cost $', 'Margin as sold',
         'SPOT would-be $', 'Margin at SPOT', 'Would-be swing $']
for c, h in enumerate(hdrs2, 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL; cell.border = BORDER; cell.alignment = CENTER
row += 1
t2_start = row
tot_sold = tot_cost = tot_spot = 0
for b in order:
    if b not in bucket_data:
        continue
    d = bucket_data[b]
    m_sold = (d['sold'] - d['cost']) / d['sold'] * 100 if d['sold'] else 0
    m_spot = (d['spot_sell'] - d['cost']) / d['spot_sell'] * 100 if d['spot_sell'] else 0
    swing = d['spot_sell'] - d['sold']
    tot_sold += d['sold']; tot_cost += d['cost']; tot_spot += d['spot_sell']
    vals = [b, d['n'], round(d['sold']), round(d['cost']),
            f'{"+" if m_sold>=0 else "-"}{abs(m_sold):.0f}%',
            round(d['spot_sell']),
            f'{"+" if m_spot>=0 else "-"}{abs(m_spot):.0f}%',
            round(swing)]
    for c, v in enumerate(vals, 1):
        cell = ws.cell(row=row, column=c, value=v); cell.border = BORDER
        if c in (3, 4, 6, 8) and isinstance(v, (int, float)):
            cell.number_format = '"$"#,##0'
        if c == 5 and m_sold < 0:
            cell.font = Font(bold=True, color='C00000')
        if c == 7 and m_spot > 0:
            cell.font = Font(bold=True, color='00B050')
    row += 1

m_sold_t = (tot_sold - tot_cost) / tot_sold * 100 if tot_sold else 0
m_spot_t = (tot_spot - tot_cost) / tot_spot * 100 if tot_spot else 0
swing_t = tot_spot - tot_sold
totrow = [f'TOTAL ({sum(bucket_data[b]["n"] for b in order if b in bucket_data)} jobs)',
          '',
          round(tot_sold), round(tot_cost),
          f'{"+" if m_sold_t>=0 else "-"}{abs(m_sold_t):.0f}%',
          round(tot_spot),
          f'{"+" if m_spot_t>=0 else "-"}{abs(m_spot_t):.0f}%',
          round(swing_t)]
for c, v in enumerate(totrow, 1):
    cell = ws.cell(row=row, column=c, value=v)
    cell.border = BORDER; cell.fill = TOTAL_FILL; cell.font = Font(bold=True)
    if c in (3, 4, 6, 8) and isinstance(v, (int, float)):
        cell.number_format = '"$"#,##0'
row += 1
t2_end = row - 1

# Chart 2: Sold vs SPOT would-be vs actual cost by bucket
row += 2
ws.cell(row=row, column=1, value='Chart data - Margin analysis').font = Font(bold=True)
row += 1
for c, h in enumerate(['Qty bucket', 'Sold $', 'SPOT would-be $', 'Actual cost $'], 1):
    cell = ws.cell(row=row, column=c, value=h)
    cell.font = HEADER_FONT; cell.fill = HEADER_FILL
row += 1
c2_start = row
for b in order:
    if b not in bucket_data:
        continue
    d = bucket_data[b]
    ws.cell(row=row, column=1, value=b)
    ws.cell(row=row, column=2, value=round(d['sold']))
    ws.cell(row=row, column=3, value=round(d['spot_sell']))
    ws.cell(row=row, column=4, value=round(d['cost']))
    row += 1
c2_end = row - 1

ch2 = BarChart()
ch2.type = 'col'; ch2.style = 12; ch2.grouping = 'clustered'
ch2.title = 'Sold price vs SPOT would-be price vs actual cost (by qty)'
ch2.y_axis.title = '$'
ch2.x_axis.title = 'Qty bucket'
data = Reference(ws, min_col=2, min_row=c2_start-1, max_row=c2_end, max_col=4)
cats = Reference(ws, min_col=1, min_row=c2_start, max_row=c2_end)
ch2.add_data(data, titles_from_data=True)
ch2.set_categories(cats)
ch2.height = 10; ch2.width = 20
ws.add_chart(ch2, 'I' + str(t2_start - 1))

# --- Key findings box ---
row += 2
ws.cell(row=row, column=1, value='Key findings').font = Font(bold=True, size=12)
row += 1
findings = [
    'Under 100 qty: both systems undershoot Print by ~55% vs actual. Print $ total is tiny so it did not drive losses.',
    '100-249 qty: SPOT Print is within +/- 1% of actual. iQuote is -39% low. SPOT already correcting here.',
    '250-499 qty: this is the historical loss zone. Sold at -67% margin. iQuote priced Print -68% vs actual. SPOT priced Print -21% (still low but far closer) and would have delivered +7% margin overall vs -67% as sold.',
    '500+ qty: iQuote is -80% below actual on Print. SPOT is -35% (better but still low). Even so, would-be margin at SPOT is +64% vs +6% as sold.',
    'Total 9 produced jobs: sold at -23% margin (losing money). Same work priced at SPOT would be +13% margin. Total dollar swing = +$7,611.',
    'Historical loss pattern is real and concentrated in 250-499 qty wide-format work. SPOT is doing what it was designed to do.',
]
for t in findings:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=8)
    cell = ws.cell(row=row, column=1, value=t)
    cell.alignment = LEFT_WRAP
    ws.row_dimensions[row].height = 30
    row += 1


# ============================================================
# TAB 8: Historical Wide-Format Margin Analysis (12-month backlog)
# ============================================================
if _os.path.exists(WF_MARGIN_CSV):
    wf_rows = []
    with open(WF_MARGIN_CSV, encoding='utf-8-sig') as _fh:
        for _r in _csv.DictReader(_fh):
            try:
                jid = int(str(_r.get('job_id', '')).strip())
            except (TypeError, ValueError):
                continue
            if jid in WF_EXCLUDE_JOBS:
                continue
            wf_rows.append({
                'job_id': jid,
                'customer': _r.get('customer') or '',
                'qty': _f(_r.get('Qty')),
                'invoice': _f(_r.get('InvoiceAmt')),
                'cost': _f(_r.get('TotalCost')),
                'gm': _f(_r.get('GrossMargin')),
                'gm_pct': _f(_r.get('GrossMarginPct')) * 100,
            })

    ws = wb.create_sheet('Historical WF Margin')
    for col, w in enumerate([12, 8, 13, 13, 13, 10, 13, 40], 1):
        ws.column_dimensions[get_column_letter(col)].width = w

    ws['A1'] = 'Historical Wide-Format Margin Analysis - past 12 months'
    ws['A1'].font = Font(bold=True, size=14, color='1F4E78')
    ws.merge_cells('A1:H1')

    excl_str = ', '.join(str(j) for j in sorted(WF_EXCLUDE_JOBS))
    ws['A2'] = (f'{len(wf_rows)} produced wide-format jobs. Excludes job {excl_str} (outsource digital '
                f'material misallocated to a single job - would distort loss pattern).')
    ws['A2'].alignment = LEFT_WRAP
    ws.merge_cells('A2:H2')
    ws.row_dimensions[2].height = 32

    # --- Headline stats ---
    tot_inv = sum(r['invoice'] for r in wf_rows)
    tot_cost = sum(r['cost'] for r in wf_rows)
    tot_gm = sum(r['gm'] for r in wf_rows)
    losers = [r for r in wf_rows if r['gm'] < 0]
    tot_loss = sum(r['gm'] for r in losers)

    row = 4
    ws.cell(row=row, column=1, value='Headline numbers').font = Font(bold=True, size=12); row += 1
    for label, val in [
        ('Total jobs', len(wf_rows)),
        ('Total invoice', tot_inv),
        ('Total cost', tot_cost),
        ('Gross margin ($)', tot_gm),
        ('Gross margin (%)', f'{tot_gm/tot_inv*100:.1f}%'),
        ('Jobs that LOST money', f'{len(losers)} of {len(wf_rows)} ({len(losers)/len(wf_rows)*100:.0f}%)'),
        ('Total dollar losses', tot_loss),
    ]:
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        c = ws.cell(row=row, column=2, value=val)
        if isinstance(val, (int, float)) and abs(val) > 100:
            c.number_format = '"$"#,##0'
            if val < 0:
                c.font = Font(bold=True, color='C00000')
        row += 1

    # --- By qty bucket ---
    def _qb(q):
        if q < 100: return '< 100'
        if q < 250: return '100-249'
        if q < 500: return '250-499'
        if q < 1000: return '500-999'
        if q < 5000: return '1000-4999'
        return '5000+'

    buckets = defaultdict(lambda: {'n':0, 'inv':0, 'cost':0, 'gm':0, 'losers':0, 'loser_gm':0})
    for r in wf_rows:
        b = _qb(r['qty'])
        d = buckets[b]
        d['n'] += 1
        d['inv'] += r['invoice']; d['cost'] += r['cost']; d['gm'] += r['gm']
        if r['gm'] < 0:
            d['losers'] += 1
            d['loser_gm'] += r['gm']

    row += 2
    ws.cell(row=row, column=1, value='Margin by qty bucket').font = Font(bold=True, size=12); row += 1
    hdrs = ['Qty bucket', 'Jobs', 'Invoice $', 'Cost $', 'GM $', 'GM %', 'Loss jobs', 'Losses $']
    for c, h in enumerate(hdrs, 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = HEADER_FONT; cell.fill = HEADER_FILL; cell.border = BORDER; cell.alignment = CENTER
    row += 1
    order = ['< 100', '100-249', '250-499', '500-999', '1000-4999', '5000+']
    bucket_chart_start = row
    for b in order:
        if b not in buckets: continue
        d = buckets[b]
        gm_pct = d['gm']/d['inv']*100 if d['inv'] else 0
        vals = [b, d['n'], round(d['inv']), round(d['cost']), round(d['gm']),
                f'{gm_pct:.1f}%',
                f'{d["losers"]}/{d["n"]}',
                round(d['loser_gm'])]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(row=row, column=c, value=v); cell.border = BORDER
            if c in (3, 4, 5, 8) and isinstance(v, (int, float)):
                cell.number_format = '"$"#,##0'
                if isinstance(v, (int, float)) and v < 0:
                    cell.font = Font(bold=True, color='C00000')
            # Flag loss-zone buckets
            if b in ('250-499', '500-999') and c == 6:
                cell.font = Font(bold=True, color='C00000')
        row += 1
    bucket_chart_end = row - 1

    # Chart data for GM% by bucket
    row += 2
    ws.cell(row=row, column=1, value='Chart data - GM % by bucket').font = Font(bold=True); row += 1
    for c, h in enumerate(['Qty bucket', 'GM %'], 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    row += 1
    c_start = row
    for b in order:
        if b not in buckets: continue
        d = buckets[b]
        ws.cell(row=row, column=1, value=b)
        ws.cell(row=row, column=2, value=round(d['gm']/d['inv']*100, 1) if d['inv'] else 0)
        row += 1
    c_end = row - 1

    ch = BarChart()
    ch.type = 'col'; ch.style = 12
    ch.title = 'GM % by qty bucket - loss zone is 250-999'
    ch.y_axis.title = 'GM %'
    ch.x_axis.title = 'Qty bucket'
    data = Reference(ws, min_col=2, min_row=c_start-1, max_row=c_end, max_col=2)
    cats = Reference(ws, min_col=1, min_row=c_start, max_row=c_end)
    ch.add_data(data, titles_from_data=True)
    ch.set_categories(cats)
    ch.height = 9; ch.width = 18
    ws.add_chart(ch, 'J' + str(bucket_chart_start - 1))

    # Chart data for LOSSES $ by bucket
    row += 2
    ws.cell(row=row, column=1, value='Chart data - Losses $ by bucket').font = Font(bold=True); row += 1
    for c, h in enumerate(['Qty bucket', 'Losses on losing jobs $'], 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = HEADER_FONT; cell.fill = HEADER_FILL
    row += 1
    c2_start = row
    for b in order:
        if b not in buckets: continue
        d = buckets[b]
        ws.cell(row=row, column=1, value=b)
        ws.cell(row=row, column=2, value=round(-d['loser_gm']))  # positive number for chart clarity
        row += 1
    c2_end = row - 1
    ch2 = BarChart()
    ch2.type = 'col'; ch2.style = 12
    ch2.title = 'Total dollar losses by qty bucket'
    ch2.y_axis.title = 'Losses $ (positive scale)'
    ch2.x_axis.title = 'Qty bucket'
    data = Reference(ws, min_col=2, min_row=c2_start-1, max_row=c2_end, max_col=2)
    cats = Reference(ws, min_col=1, min_row=c2_start, max_row=c2_end)
    ch2.add_data(data, titles_from_data=True)
    ch2.set_categories(cats)
    ch2.height = 9; ch2.width = 18
    ws.add_chart(ch2, 'J' + str(c_end + 3))

    # --- SPOT sweet spot summary ---
    row += 2
    ws.cell(row=row, column=1, value='SPOT sweet spot - 250-999 qty range').font = Font(bold=True, size=12); row += 1
    sweet = [r for r in wf_rows if 250 <= r['qty'] < 1000]
    sweet_loss = [r for r in sweet if r['gm'] < 0]
    sweet_inv = sum(r['invoice'] for r in sweet)
    sweet_cost = sum(r['cost'] for r in sweet)
    sweet_gm = sum(r['gm'] for r in sweet)
    sweet_loss_gm = sum(r['gm'] for r in sweet_loss)
    for label, val in [
        ('Jobs in 250-999 qty', len(sweet)),
        ('Losing jobs', f'{len(sweet_loss)} of {len(sweet)} ({len(sweet_loss)/len(sweet)*100:.0f}%)'),
        ('Total invoice', sweet_inv),
        ('Total cost', sweet_cost),
        ('Combined GM', f'${sweet_gm:,.0f} ({sweet_gm/sweet_inv*100:.1f}%)'),
        ('Losses in this range', sweet_loss_gm),
        ('Recover 50% of losses = SPOT value/yr', -sweet_loss_gm * 0.5),
        ('Recover 100% of losses = SPOT value/yr', -sweet_loss_gm),
    ]:
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        c = ws.cell(row=row, column=2, value=val)
        if isinstance(val, (int, float)) and abs(val) > 100:
            c.number_format = '"$"#,##0'
            if val < 0:
                c.font = Font(bold=True, color='C00000')
            elif label.startswith('Recover'):
                c.font = Font(bold=True, color='00B050')
        row += 1

    # --- Top 10 individual losses ---
    row += 2
    ws.cell(row=row, column=1, value='Top 10 individual losses').font = Font(bold=True, size=12); row += 1
    hdrs = ['Job', 'Qty', 'Invoiced $', 'Cost $', 'Loss $', 'GM %', 'Customer']
    for c, h in enumerate(hdrs, 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = HEADER_FONT; cell.fill = HEADER_FILL; cell.border = BORDER; cell.alignment = CENTER
    row += 1
    top_losses = sorted(wf_rows, key=lambda r: r['gm'])[:10]
    for r in top_losses:
        vals = [r['job_id'], int(r['qty']), round(r['invoice']), round(r['cost']),
                round(r['gm']), f'{r["gm_pct"]:.0f}%', r['customer']]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(row=row, column=c, value=v); cell.border = BORDER
            if c in (3, 4, 5) and isinstance(v, (int, float)):
                cell.number_format = '"$"#,##0'
                if v < 0:
                    cell.font = Font(bold=True, color='C00000')
        row += 1

    # --- Customer concentration ---
    row += 2
    ws.cell(row=row, column=1, value='Top 10 customers by total dollar loss').font = Font(bold=True, size=12); row += 1
    cust_loss = defaultdict(lambda: {'n':0, 'gm':0, 'inv':0, 'losers':0})
    for r in wf_rows:
        c_d = cust_loss[r['customer']]
        c_d['n'] += 1; c_d['gm'] += r['gm']; c_d['inv'] += r['invoice']
        if r['gm'] < 0: c_d['losers'] += 1
    hdrs = ['Customer', 'Total Loss $', 'Losing/Total Jobs', 'Invoiced $']
    for c, h in enumerate(hdrs, 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = HEADER_FONT; cell.fill = HEADER_FILL; cell.border = BORDER; cell.alignment = CENTER
    row += 1
    top_cust = sorted(cust_loss.items(), key=lambda kv: kv[1]['gm'])[:10]
    for cust, d in top_cust:
        vals = [cust, round(d['gm']), f'{d["losers"]}/{d["n"]}', round(d['inv'])]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(row=row, column=c, value=v); cell.border = BORDER
            if c in (2, 4) and isinstance(v, (int, float)):
                cell.number_format = '"$"#,##0'
                if c == 2 and v < 0:
                    cell.font = Font(bold=True, color='C00000')
        row += 1

    # --- Findings ---
    row += 2
    ws.cell(row=row, column=1, value='Key findings').font = Font(bold=True, size=12); row += 1
    findings = [
        f'{len(losers)} of {len(wf_rows)} wide-format jobs ({len(losers)/len(wf_rows)*100:.0f}%) lost money in the past 12 months.',
        f'Total dollar losses: ${-tot_loss:,.0f}. Concentration in the 250-999 qty bucket: ${-sweet_loss_gm:,.0f}.',
        f'The 250-999 qty band matches the SPOT test data zone where SPOT prices 20-40% higher than iQuote.',
        f'Recovering half of the 250-999 losses via SPOT pricing = ${-sweet_loss_gm*0.5:,.0f}/year in margin.',
        'Top 6 of 10 largest individual losses come from PCA Pennsylvania - worth a separate account-level review.',
    ]
    for t in findings:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=7)
        c = ws.cell(row=row, column=1, value=t)
        c.alignment = LEFT_WRAP
        ws.row_dimensions[row].height = 28
        row += 1


# ---------- Save ----------
wb.save(OUT_PATH)
print(f'Wrote {OUT_PATH}')
print(f'Scenarios: {len(spot_scenarios)}  iQuote (opt, qty) keys: {len(iq_by_key)}  Actuals: {len(actuals)}')
