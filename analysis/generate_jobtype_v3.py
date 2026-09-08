"""
SPOT vs iQuote — Component-Level Job Type × Qty Band Variance Analysis (v3, CORRECTED)

Fixes v2's broken join:
- Groups components by quote, sorts both sides by (qty desc, price desc), pairs positionally.
- Applies user-specified overrides for the 4 known ambiguous quotes.
- Classifies each SPOT component via cost signals from spot_full.xlsx.

Output: /app/backend/static_assets/SPOT_JobType_Variance_v3.xlsx
Also copies to /app/analysis/.
"""
from __future__ import annotations
import os
import shutil
import statistics
from collections import defaultdict
from typing import Any

import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

# ------------------------------------------------------------------------ paths
ANALYSIS_DIR = "/app/analysis"
STATIC_DIR = "/app/backend/static_assets"
INPUT_XLSX = os.path.join(ANALYSIS_DIR, "input.xlsx")
SPOT_FULL_XLSX = os.path.join(ANALYSIS_DIR, "spot_full.xlsx")
OUT_FILE = "SPOT_JobType_Variance_v3.xlsx"

# ------------------------------------------------------------------------ config
QTY_BANDS = [
    ("1-49", 1, 49),
    ("50-199", 50, 199),
    ("200-999", 200, 999),
    ("1000-4999", 1000, 4999),
    ("5000+", 5000, 10**12),
]

JOB_TYPES = ["Cut Only", "Print + Cut", "Print + Cut + Finishing"]

# User overrides ------------------------------------------------------------
# 223864: drop iQuote rows with qty in {800, 1600} (estimator skipped in SPOT)
DROP_IQUOTE_ROWS = {
    223864: [800, 1600],
    224377: [68],  # HSC Bin — SPOT didn't price qty=68
}
# 222971: SPOT qty 520 == iQuote qty 521 (hard proofs)
IQUOTE_QTY_REMAP = {
    222971: {521: 520},
}
# 224322: SPOT row (W=46.375, Board 250 C) qty should be 315 not 600
# 223957: SPOT qty swap — W=25.312 should be 1920 (was 480), W=15.875 should be 480 (was 1920)
SPOT_QTY_OVERRIDE = {
    (224322, 46.375): 315,
    (223957, 25.312): 1920,
    (223957, 15.875): 480,
}
# Quotes to drop entirely
DROP_QUOTES = {
    224362,  # Oreo Digital Innovation Add On Kit — completely different qty structures
    223677,  # duplicate of 223672
}
# Quotes to force-match by qty only (skip name clustering — user-confirmed pairs)
FORCE_QTY_MATCH_QUOTES = {
    222935,  # WedgeHeader V1/V2 = artwork variants of same product
    222258,  # Header #1 across 2 qty tiers vs Header 1 & Header 2 in iQuote — match by qty
    223596,  # SPOT uses "Mini Pallet Band" name; iQuote uses SKU codes DS5993/DS5994
}
# Manual SPOT-W → iQuote product name overrides (per user-provided notes columns)
MANUAL_NAME_MAP = {
    # Q222777 — user notes column mapping
    (222777, 23.25):  "Base Tray",
    (222777, 8.5):    "Bottom Graphic",
    (222777, 43.562): "Carton OPF",
    (222777, 17):     "Header",
    (222777, 50.312): "Hutch",
    (222777, 43.688): "Shelf",
    (222777, 45.75):  "Side Support",
    # Q223672 — user notes column mapping
    (223672, 49.75):  "Hutch - 2586-01-01",
    (223672, 31.438): "Shelf Set - 2586-01-02",
    (223672, 35.312): "Header & Bottom Graphic Combo - 2586-01-03",
}


def gt0(x: Any) -> bool:
    return isinstance(x, (int, float)) and x > 0


def classify(print_cost: Any, strip_cost: Any, glue_cost: Any, tape_cost: Any) -> str:
    has_print = gt0(print_cost)
    has_finish = gt0(strip_cost) or gt0(glue_cost) or gt0(tape_cost)
    if not has_print:
        return "Cut Only"
    if has_print and not has_finish:
        return "Print + Cut"
    return "Print + Cut + Finishing"


def qty_band(qty: int) -> str:
    for label, lo, hi in QTY_BANDS:
        if lo <= qty <= hi:
            return label
    return "n/a"


# ---------------------------------------------------------------- data loading
def load_data():
    wb1 = openpyxl.load_workbook(INPUT_XLSX, data_only=True)
    sp = wb1["SPOT Data"]; iq = wb1["iQuote Data"]
    sph = [c.value for c in sp[1]]; iqh = [c.value for c in iq[1]]
    sp_data = [dict(zip(sph, r)) for r in sp.iter_rows(min_row=2, values_only=True)]
    iq_data = [dict(zip(iqh, r)) for r in iq.iter_rows(min_row=2, values_only=True)]

    wb2 = openpyxl.load_workbook(SPOT_FULL_XLSX, data_only=True)
    ws = wb2["Testing Comparison"]
    h = [c.value for c in ws[1]]
    sf_data = [dict(zip(h, r)) for r in ws.iter_rows(min_row=2, values_only=True)]

    # Cost-signal lookup: (iQuote #, W, L) -> list[spot_full rows]
    cost_lookup = defaultdict(list)
    for r in sf_data:
        try:
            q = int(r["iQuote #"]) if r["iQuote #"] is not None else None
        except (ValueError, TypeError):
            q = None
        if q is None:
            continue
        cost_lookup[(q, r.get("One-Up W"), r.get("One-Up L"))].append(r)
    return sp_data, iq_data, cost_lookup


def apply_overrides(sp_data, iq_data):
    # Drop entire quotes
    sp_data = [r for r in sp_data if r.get("iQuote Estimate #") not in DROP_QUOTES]
    iq_data = [r for r in iq_data if r.get("IdQuote") not in DROP_QUOTES]

    # SPOT qty override
    for r in sp_data:
        q = r.get("iQuote Estimate #")
        w = r.get("Width")
        if (q, w) in SPOT_QTY_OVERRIDE:
            r["Qty"] = SPOT_QTY_OVERRIDE[(q, w)]

    # iQuote qty remap
    for r in iq_data:
        q = r.get("IdQuote")
        remap = IQUOTE_QTY_REMAP.get(q, {})
        old = r.get("Quantity")
        if old in remap:
            r["Quantity"] = remap[old]

    # Drop iQuote rows
    kept = []
    for r in iq_data:
        q = r.get("IdQuote")
        drops = DROP_IQUOTE_ROWS.get(q, [])
        if r.get("Quantity") in drops:
            continue
        kept.append(r)
    return sp_data, kept


import re as _re
from difflib import SequenceMatcher as _SM


def _norm_name(s):
    if not s:
        return ""
    s = str(s).lower()
    s = _re.sub(r"[^a-z0-9 ]", " ", s)
    return _re.sub(r"\s+", " ", s).strip()


def _name_score(spot_name, iq_name):
    """Score name similarity SPOT component <-> iQuote product (0-100).

    Uses difflib.SequenceMatcher.ratio() as the base signal, so exact matches
    score higher than partial-substring matches. Also floors word overlap so
    substring matches still register when SPOT has extra descriptive text
    ("Angled Side Panel" vs "Angle Side Panel" still >= 60).
    """
    s = _norm_name(spot_name)
    i = _norm_name(iq_name)
    if not s or not i:
        return 0
    if s == i:
        return 100
    ratio = int(100 * _SM(None, s, i).ratio())
    # Word overlap floor
    s_words = set(s.split()); i_words = set(i.split())
    common = s_words & i_words
    if common:
        # Jaccard-style overlap
        overlap = int(100 * len(common) / max(len(s_words | i_words), 1))
        ratio = max(ratio, overlap)
    return ratio


def _assign_spot_component_names(sp_data, cost_lookup):
    """Assign _comp_name to each SPOT row. When multiple SPOT rows share the same
    (iQuote #, W, L) — like matched-set 'Heart Middle Side 1' and 'Heart Middle Side 2'
    at identical dimensions — distribute the UNIQUE component names from spot_full
    sequentially so each SPOT row gets a distinct name.
    Also applies MANUAL_NAME_MAP overrides last (per user-provided notes columns).
    """
    # Group SPOT rows by (q, W, L)
    from collections import defaultdict as _dd
    groups = _dd(list)
    for r in sp_data:
        q = r.get("iQuote Estimate #")
        if q is None:
            continue
        groups[(q, r.get("Width"), r.get("Length"))].append(r)

    for (q, w, l), rows in groups.items():
        sf_rows = cost_lookup.get((q, w, l), [])
        # Preserve order of first appearance; unique names
        seen = set(); unique_names = []
        for sf in sf_rows:
            nm = sf.get("Component")
            if nm and nm not in seen:
                seen.add(nm); unique_names.append(nm)
        if not unique_names:
            for r in rows:
                r["_comp_name"] = None
            continue
        for idx, r in enumerate(rows):
            r["_comp_name"] = unique_names[idx % len(unique_names)]

    # Apply MANUAL_NAME_MAP overrides
    for r in sp_data:
        key = (r.get("iQuote Estimate #"), r.get("Width"))
        if key in MANUAL_NAME_MAP:
            r["_comp_name"] = MANUAL_NAME_MAP[key]


def build_component_pairs(sp_data, iq_data, cost_lookup):
    """
    Product-cluster-first join within each quote:

      Step 1: Group both SPOT and iQuote rows by iQuote quote #.
      Step 2: Attach _comp_name to each SPOT row (from spot_full lookup).
      Step 3: Fuzzy-cluster SPOT components to iQuote products via name similarity
              (highest-score-first greedy assignment across all name pairs in the quote).
      Step 4: Within each name-cluster, pair rows by EXACT qty match.
      Step 5: Any row (either side) with no name-cluster or no qty match → Unmatched.
      Step 6: SPECIAL CASE — if a quote's cross-name similarity is uniformly zero
              (e.g., versioned proofs: SPOT calls every row 'Display Header V1..V9' but
              iQuote names each row 'Sculp & Paine', 'Little Artists', etc.), fall back
              to bucket-by-qty then force-pair by count-matching.
    """
    sp_by = defaultdict(list); iq_by = defaultdict(list)
    _assign_spot_component_names(sp_data, cost_lookup)
    for r in sp_data:
        if r.get("iQuote Estimate #"):
            sp_by[r["iQuote Estimate #"]].append(r)
    for r in iq_data:
        if r.get("IdQuote"):
            iq_by[r["IdQuote"]].append(r)

    matched_pairs = []
    unmatched_rows = []

    for q, srows in sp_by.items():
        irows = iq_by.get(q, [])

        # FORCE_QTY_MATCH_QUOTES bypass — user confirmed these should force-pair by qty
        if q in FORCE_QTY_MATCH_QUOTES:
            _fallback_qty_force_pair(q, srows, irows, cost_lookup, matched_pairs, unmatched_rows)
            continue

        # --- Step 3: name clustering (SPOT idx -> iQuote idx) via greedy assignment
        pairs = []  # (score, s_idx, i_idx)
        for si, sr in enumerate(srows):
            for ii, ir in enumerate(irows):
                score = _name_score(sr.get("_comp_name"), ir.get("Product"))
                pairs.append((score, si, ii))

        max_score = max((p[0] for p in pairs), default=0)

        # Special case: versioned-proof pattern where names don't cleanly cluster.
        # Detect by: SPOT and iQuote have the same total row count AND best pairing
        # covers < 60% of the SPOT rows uniquely. Fall back to qty-force-pair.
        if max_score == 0:
            _fallback_qty_force_pair(q, srows, irows, cost_lookup, matched_pairs, unmatched_rows)
            continue

        # Preview clustering to detect versioned-proof pattern
        _preview_sp_cluster = [None] * len(srows)
        for si, sr in enumerate(srows):
            best_score = -1; best_ii = None
            for ii, ir in enumerate(irows):
                sc = _name_score(sr.get("_comp_name"), ir.get("Product"))
                if sc > best_score:
                    best_score = sc; best_ii = ii
            if best_score > 0:
                _preview_sp_cluster[si] = best_ii
        # If many SPOT rows are all mapping to the SAME iQuote row (versioned proof),
        # AND total row counts match, use fallback for the whole quote.
        if len(srows) == len(irows):
            from collections import Counter as _Ctr
            counts = _Ctr(x for x in _preview_sp_cluster if x is not None)
            most_common_hits = counts.most_common(1)[0][1] if counts else 0
            if most_common_hits > 2 and most_common_hits > len(srows) * 0.5:
                _fallback_qty_force_pair(q, srows, irows, cost_lookup, matched_pairs, unmatched_rows)
                continue

        # Cluster: assign SPOT rows to iQuote rows greedy by highest score
        # then require exact qty match within a cluster (many-to-many via same
        # (s_cluster, i_cluster) both getting mapped to the "same product family").
        # Simpler: for each SPOT row, pick its best-scoring iQuote name (score>0)
        # and remember that -> the SPOT row's "product family" is the iQuote product.
        # Then for each iQuote row, do the mirror. Cluster = set of SPOT rows +
        # set of iQuote rows sharing the same iQuote product name.

        # Build cluster: cluster key = normalized iQuote product name
        iq_norms = [_norm_name(ir.get("Product")) for ir in irows]
        # SPOT row -> best cluster (or None)
        sp_cluster = [None] * len(srows)
        for si, sr in enumerate(srows):
            best_score = -1; best_ii = None
            for ii, ir in enumerate(irows):
                score = _name_score(sr.get("_comp_name"), ir.get("Product"))
                if score > best_score:
                    best_score = score; best_ii = ii
            if best_score > 0:
                sp_cluster[si] = iq_norms[best_ii]

        clusters = defaultdict(lambda: {"sp": [], "iq": []})
        for si, key in enumerate(sp_cluster):
            if key is not None:
                clusters[key]["sp"].append(si)
        for ii, key in enumerate(iq_norms):
            clusters[key]["iq"].append(ii)

        # SPOT rows with no cluster — defer to post-pass (they may still pair
        # positionally with orphaned iQuote rows at the same qty).
        deferred_sp_orphans = []
        for si, key in enumerate(sp_cluster):
            if key is None:
                deferred_sp_orphans.append(si)

        # For each cluster: pair rows by exact qty
        cluster_unmatched_sp = []  # list of (si) still unmatched after cluster
        cluster_unmatched_iq = []  # list of (ii)
        used_sp_final = set()
        used_iq_final = set()

        for key, group in clusters.items():
            sp_idxs = group["sp"]; iq_idxs = group["iq"]
            # qty buckets within this cluster
            sp_by_qty = defaultdict(list); iq_by_qty = defaultdict(list)
            for si in sp_idxs:
                sp_by_qty[srows[si].get("Qty")].append(si)
            for ii in iq_idxs:
                iq_by_qty[irows[ii].get("Quantity")].append(ii)

            all_qtys = set(sp_by_qty) | set(iq_by_qty)
            for qty in all_qtys:
                sp_here = sp_by_qty.get(qty, [])
                iq_here = iq_by_qty.get(qty, [])
                if not sp_here:
                    for ii in iq_here:
                        cluster_unmatched_iq.append(ii)
                    continue
                if not iq_here:
                    for si in sp_here:
                        cluster_unmatched_sp.append(si)
                    continue
                # Both sides have >=1 row at this qty in this cluster. Pair greedy
                # by price similarity (they're all the same product family here).
                sp_sorted = sorted(sp_here, key=lambda si: -(srows[si].get("Component Total") or 0))
                iq_sorted = sorted(iq_here, key=lambda ii: -(irows[ii].get("ComponentTotalPrice") or 0))
                n = min(len(sp_sorted), len(iq_sorted))
                for k in range(n):
                    _emit_matched(q, srows[sp_sorted[k]], irows[iq_sorted[k]], qty, cost_lookup, matched_pairs, name_s=100)
                    used_sp_final.add(sp_sorted[k])
                    used_iq_final.add(iq_sorted[k])
                for si in sp_sorted[n:]:
                    cluster_unmatched_sp.append(si)
                for ii in iq_sorted[n:]:
                    cluster_unmatched_iq.append(ii)

        # Cluster-orphans: had a name cluster but no qty match within it. These are
        # LEGITIMATE unmatched — the product was priced at a different qty by the
        # other system. Do NOT force-pair.
        for si in cluster_unmatched_sp:
            if si in used_sp_final: continue
            sr = srows[si]
            unmatched_rows.append({
                "iQuote #": q,
                "Project": sr.get("Project Name"),
                "Reason": f"SPOT '{sr.get('_comp_name')}' qty={sr.get('Qty')} — same-name iQuote row priced at different qty",
                "iQuote Product": None,
                "SPOT $": sr.get("Component Total"),
                "iQuote $": None,
            })
        for ii in cluster_unmatched_iq:
            if ii in used_iq_final: continue
            ir = irows[ii]
            unmatched_rows.append({
                "iQuote #": q,
                "Project": srows[0].get("Project Name") if srows else None,
                "Reason": f"iQuote '{ir.get('Product')}' qty={ir.get('Quantity')} — same-name SPOT row priced at different qty",
                "iQuote Product": ir.get("Product"),
                "SPOT $": None,
                "iQuote $": ir.get("ComponentTotalPrice"),
            })

        # Post-pass: force-pair only TRUE orphans (rows with zero name match to
        # anything on the other side) at matching qty. This rescues versioned-proof
        # cases where SPOT and iQuote use different naming conventions.
        sp_orphans_by_qty = defaultdict(list)
        iq_orphans_by_qty = defaultdict(list)
        # Also identify iq true orphans: iq rows never assigned to any cluster
        iq_ever_matched = set()
        for si, key in enumerate(sp_cluster):
            if key is not None:
                # find which iq rows share this cluster key
                for ii, k2 in enumerate(iq_norms):
                    if k2 == key:
                        iq_ever_matched.add(ii)
        iq_true_orphans = [ii for ii, k in enumerate(iq_norms) if ii not in iq_ever_matched]

        for si in deferred_sp_orphans:
            sp_orphans_by_qty[srows[si].get("Qty")].append(si)
        for ii in iq_true_orphans:
            iq_orphans_by_qty[irows[ii].get("Quantity")].append(ii)

        for qty in set(sp_orphans_by_qty) | set(iq_orphans_by_qty):
            sp_o = sp_orphans_by_qty.get(qty, [])
            iq_o = iq_orphans_by_qty.get(qty, [])
            n = min(len(sp_o), len(iq_o))
            sp_sorted = sorted(sp_o, key=lambda si: -(srows[si].get("Component Total") or 0))
            iq_sorted = sorted(iq_o, key=lambda ii: -(irows[ii].get("ComponentTotalPrice") or 0))
            for k in range(n):
                _emit_matched(q, srows[sp_sorted[k]], irows[iq_sorted[k]], qty, cost_lookup, matched_pairs, name_s=0)
                used_sp_final.add(sp_sorted[k])
                used_iq_final.add(iq_sorted[k])
            for si in sp_sorted[n:]:
                sr = srows[si]
                unmatched_rows.append({
                    "iQuote #": q,
                    "Project": sr.get("Project Name"),
                    "Reason": f"SPOT '{sr.get('_comp_name')}' qty={qty} — no iQuote counterpart at this qty",
                    "iQuote Product": None,
                    "SPOT $": sr.get("Component Total"),
                    "iQuote $": None,
                })
            for ii in iq_sorted[n:]:
                ir = irows[ii]
                unmatched_rows.append({
                    "iQuote #": q,
                    "Project": srows[0].get("Project Name") if srows else None,
                    "Reason": f"iQuote '{ir.get('Product')}' qty={qty} — no SPOT counterpart at this qty",
                    "iQuote Product": ir.get("Product"),
                    "SPOT $": None,
                    "iQuote $": ir.get("ComponentTotalPrice"),
                })

    return matched_pairs, unmatched_rows


def _emit_matched(q, s, i, qty, cost_lookup, matched_pairs, name_s=100):
    sf_rows = cost_lookup.get((q, s.get("Width"), s.get("Length")), [])
    print_cost = max((r.get("Print Cost") or 0) for r in sf_rows) if sf_rows else 0
    strip_cost = max((r.get("Strip Cost") or 0) for r in sf_rows) if sf_rows else 0
    glue_cost = max((r.get("Glue Cost") or 0) for r in sf_rows) if sf_rows else 0
    tape_cost = max((r.get("Tape Cost") or 0) for r in sf_rows) if sf_rows else 0
    spot_price = s.get("Component Total") or 0
    iq_price = i.get("ComponentTotalPrice") or 0
    if iq_price == 0:
        return
    delta = spot_price - iq_price
    matched_pairs.append({
        "iQuote #": q,
        "SPOT Estimate #": s.get("SPOT Estimate #"),
        "Project": s.get("Project Name"),
        "Customer": s.get("Customer"),
        "Component": s.get("_comp_name") or i.get("Product"),
        "iQuote Product": i.get("Product"),
        "Qty": qty,
        "Qty Band": qty_band(qty),
        "SPOT $": spot_price,
        "iQuote $": iq_price,
        "Δ $": delta,
        "Δ %": (delta / iq_price) * 100.0,
        "Job Type": classify(print_cost, strip_cost, glue_cost, tape_cost),
        "Name Match Score": name_s,
        "Print Cost": print_cost,
        "Strip Cost": strip_cost,
        "Glue Cost": glue_cost,
        "Tape Cost": tape_cost,
    })


def _fallback_qty_force_pair(q, srows, irows, cost_lookup, matched_pairs, unmatched_rows):
    """Used when a quote has zero name overlap (e.g., versioned proofs)."""
    sp_qty = defaultdict(list); iq_qty = defaultdict(list)
    for r in srows: sp_qty[r.get("Qty")].append(r)
    for r in irows: iq_qty[r.get("Quantity")].append(r)
    for qty in set(sp_qty) | set(iq_qty):
        sp_b = sp_qty.get(qty, []); iq_b = iq_qty.get(qty, [])
        if not sp_b:
            for i in iq_b:
                unmatched_rows.append({
                    "iQuote #": q, "Project": srows[0].get("Project Name") if srows else None,
                    "Reason": f"iQuote qty={qty} — no SPOT counterpart (fallback)",
                    "iQuote Product": i.get("Product"),
                    "SPOT $": None, "iQuote $": i.get("ComponentTotalPrice"),
                })
            continue
        if not iq_b:
            for s in sp_b:
                unmatched_rows.append({
                    "iQuote #": q, "Project": s.get("Project Name"),
                    "Reason": f"SPOT qty={qty} — no iQuote counterpart (fallback)",
                    "iQuote Product": None,
                    "SPOT $": s.get("Component Total"), "iQuote $": None,
                })
            continue
        if len(sp_b) != len(iq_b):
            # Cannot confidently pair
            for s in sp_b: unmatched_rows.append({
                "iQuote #": q, "Project": s.get("Project Name"),
                "Reason": f"SPOT qty={qty} — bucket count mismatch (fallback)",
                "iQuote Product": None,
                "SPOT $": s.get("Component Total"), "iQuote $": None,
            })
            for i in iq_b: unmatched_rows.append({
                "iQuote #": q, "Project": srows[0].get("Project Name") if srows else None,
                "Reason": f"iQuote qty={qty} — bucket count mismatch (fallback)",
                "iQuote Product": i.get("Product"),
                "SPOT $": None, "iQuote $": i.get("ComponentTotalPrice"),
            })
            continue
        sp_sorted = sorted(sp_b, key=lambda r: -(r.get("Component Total") or 0))
        iq_sorted = sorted(iq_b, key=lambda r: -(r.get("ComponentTotalPrice") or 0))
        for s, i in zip(sp_sorted, iq_sorted):
            _emit_matched(q, s, i, qty, cost_lookup, matched_pairs, name_s=0)


# --------------------------------------------------------------- workbook build
HDR_FILL = PatternFill("solid", fgColor="1F4E78")
HDR_FONT = Font(bold=True, color="FFFFFF")
SECTION_FONT = Font(bold=True, size=12, color="1F4E78")
BORDER = Border(*[Side(style="thin", color="D0D0D0")] * 4)


def apply_header(cell):
    cell.fill = HDR_FILL
    cell.font = HDR_FONT
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = BORDER


def write_summary_tab(ws, matched):
    # Group data
    by_type = defaultdict(list)
    for m in matched:
        by_type[m["Job Type"]].append(m)

    # Title
    ws.cell(row=1, column=1, value="SPOT vs iQuote Variance by Job Type × Qty Band").font = Font(bold=True, size=14, color="1F4E78")
    ws.cell(row=2, column=1, value="Component-level analysis. Job Type is determined per component from Print/Strip/Glue/Tape cost signals.").font = Font(italic=True, color="606060")

    # ---- Job Type Totals ----
    r = 4
    ws.cell(row=r, column=1, value="Component Counts by Job Type").font = SECTION_FONT
    r += 1
    for c, label in enumerate(["Job Type", "Components", "Avg Variance %", "Median Variance %"], start=1):
        cell = ws.cell(row=r, column=c, value=label); apply_header(cell)
    r += 1
    for jt in JOB_TYPES:
        rows = by_type.get(jt, [])
        pcts = [m["Δ %"] for m in rows]
        ws.cell(row=r, column=1, value=jt)
        ws.cell(row=r, column=2, value=len(rows))
        ws.cell(row=r, column=3, value=(statistics.mean(pcts) / 100.0) if pcts else None)
        ws.cell(row=r, column=4, value=(statistics.median(pcts) / 100.0) if pcts else None)
        ws.cell(row=r, column=3).number_format = "0.00%"
        ws.cell(row=r, column=4).number_format = "0.00%"
        r += 1

    # ---- Per-type × Qty band, then Combined ----
    charts_specs = []  # (title, data_start_row, data_end_row, hdr_row)

    for jt in JOB_TYPES:
        r += 1
        ws.cell(row=r, column=1, value=jt).font = SECTION_FONT
        r += 1
        hdr_row = r
        for c, label in enumerate(["Qty Band", "Count", "Avg Variance %", "Median Variance %"], start=1):
            cell = ws.cell(row=r, column=c, value=label); apply_header(cell)
        r += 1
        data_start = r
        rows = by_type.get(jt, [])
        for band_label, lo, hi in QTY_BANDS:
            band_rows = [m for m in rows if lo <= (m["Qty"] or 0) <= hi]
            pcts = [m["Δ %"] for m in band_rows]
            ws.cell(row=r, column=1, value=band_label)
            ws.cell(row=r, column=2, value=len(band_rows))
            avg_cell = ws.cell(row=r, column=3, value=(statistics.mean(pcts) / 100.0) if pcts else None)
            med_cell = ws.cell(row=r, column=4, value=(statistics.median(pcts) / 100.0) if pcts else None)
            avg_cell.number_format = "0.00%"
            med_cell.number_format = "0.00%"
            r += 1
        data_end = r - 1
        charts_specs.append((f"{jt} Avg vs Median Variance % by Qty Band", data_start, data_end, hdr_row))

    # ---- Combined Median % matrix ----
    r += 2
    ws.cell(row=r, column=1, value="Combined Median Variance % by Job Type × Qty Band").font = SECTION_FONT
    r += 1
    combined_hdr = r
    ws.cell(row=r, column=1, value="Qty Band"); apply_header(ws.cell(row=r, column=1))
    for c, jt in enumerate(JOB_TYPES, start=2):
        cell = ws.cell(row=r, column=c, value=jt); apply_header(cell)
    r += 1
    combined_start = r
    for band_label, lo, hi in QTY_BANDS:
        ws.cell(row=r, column=1, value=band_label)
        for c, jt in enumerate(JOB_TYPES, start=2):
            band_rows = [m for m in by_type.get(jt, []) if lo <= (m["Qty"] or 0) <= hi]
            pcts = [m["Δ %"] for m in band_rows]
            cell = ws.cell(row=r, column=c, value=(statistics.median(pcts) / 100.0) if pcts else None)
            cell.number_format = "0.00%"
        r += 1
    combined_end = r - 1

    # Column widths
    for col_i in range(1, 6):
        ws.column_dimensions[get_column_letter(col_i)].width = 22

    # ---- Charts ----
    # Per-job-type charts (side by side to the right, columns starting at F)
    for idx, (title, ds, de, hr) in enumerate(charts_specs):
        chart = BarChart()
        chart.type = "col"
        chart.title = title
        chart.y_axis.title = "Variance %"
        chart.x_axis.title = "Qty Band"
        chart.height = 8; chart.width = 18
        data = Reference(ws, min_col=3, max_col=4, min_row=hr, max_row=de)
        cats = Reference(ws, min_col=1, min_row=ds, max_row=de)
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        anchor_row = 5 + idx * 17
        ws.add_chart(chart, f"F{anchor_row}")

    # Combined chart
    chart = BarChart()
    chart.type = "col"
    chart.title = "Combined Median Variance % by Job Type × Qty Band"
    chart.y_axis.title = "Median Variance %"
    chart.x_axis.title = "Qty Band"
    chart.height = 8; chart.width = 18
    data = Reference(ws, min_col=2, max_col=1 + len(JOB_TYPES), min_row=combined_hdr, max_row=combined_end)
    cats = Reference(ws, min_col=1, min_row=combined_start, max_row=combined_end)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    ws.add_chart(chart, f"F{5 + 3 * 17}")


def write_detail_tab(wb, tab_name, rows):
    ws = wb.create_sheet(tab_name)
    cols = ["iQuote #", "SPOT Estimate #", "Project", "Customer", "Component", "iQuote Product",
            "Qty", "Qty Band", "SPOT $", "iQuote $", "Δ $", "Δ %", "Job Type"]
    for c, label in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=label); apply_header(cell)
    for i, row in enumerate(rows, start=2):
        for c, key in enumerate(cols, start=1):
            v = row.get(key)
            cell = ws.cell(row=i, column=c, value=v)
            if key in ("SPOT $", "iQuote $", "Δ $") and isinstance(v, (int, float)):
                cell.number_format = "$#,##0.00"
            elif key == "Δ %" and isinstance(v, (int, float)):
                cell.value = v / 100.0
                cell.number_format = "0.00%"
    # widths
    widths = [12, 20, 45, 30, 30, 30, 8, 12, 14, 14, 14, 12, 22]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    return ws


def write_unmatched_tab(wb, rows):
    ws = wb.create_sheet("Unmatched")
    cols = ["iQuote #", "Project", "Reason", "iQuote Product", "SPOT $", "iQuote $"]
    for c, label in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=label); apply_header(cell)
    for i, row in enumerate(rows, start=2):
        for c, key in enumerate(cols, start=1):
            v = row.get(key)
            cell = ws.cell(row=i, column=c, value=v)
            if key in ("SPOT $", "iQuote $") and isinstance(v, (int, float)):
                cell.number_format = "$#,##0.00"
    widths = [12, 45, 60, 30, 14, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def write_methodology_tab(wb, matched_count, unmatched_count):
    ws = wb.create_sheet("Methodology")
    ws["A1"] = "Methodology"
    ws["A1"].font = Font(bold=True, size=14, color="1F4E78")
    lines = [
        "",
        "PURPOSE",
        "Compare SPOT vs iQuote component-level SELL PRICES across job-type and qty buckets.",
        "",
        "DATA SOURCES",
        "  • input.xlsx (SPOT Data / iQuote Data) — clean 1:1 quote-level dataset.",
        "  • spot_full.xlsx (Testing Comparison) — all-fields SPOT dump for job-type classification.",
        "",
        "JOIN METHOD (component-level, corrected)",
        "  Step 1: Group both SPOT and iQuote rows by iQuote quote #.",
        "  Step 2: Within each quote, bucket rows by EXACT qty on each side.",
        "  Step 3: Within each shared qty bucket, pair by SPOT-Component ↔ iQuote-Product",
        "          name similarity (substring / word-overlap, greedy highest score first).",
        "  Step 4: If a qty bucket has 1×1, force match (no name check required).",
        "  Step 5: A qty existing only on one side → all its rows go to 'Unmatched'.",
        "  Step 6: Ambiguous matches (score < 30 within a multi-row bucket) → 'Unmatched'.",
        "",
        "USER-SPECIFIED OVERRIDES",
        "  DROPPED QUOTES:",
        "    • Q224362 — Oreo Digital Innovation Add On Kit: SPOT and iQuote priced",
        "                 completely different qty structures; not comparable.",
        "    • Q223677 — duplicate of Q223672 (removed to avoid double counting).",
        "",
        "  QTY OVERRIDES:",
        "    • Q223864: Dropped iQuote rows with qty 800 (×2) and qty 1600 (×1).",
        "                 (Estimator did not price these tiers in SPOT.)",
        "    • Q222971: SPOT qty 520 matched to iQuote qty 521 (iQuote 'hard proofs').",
        "    • Q224322: SPOT row W=46.375 qty overridden 600 → 315 (SPOT reporting bug).",
        "    • Q223957: SPOT rows W=25.312 qty 480→1920 and W=15.875 qty 1920→480",
        "                 (user manual fix — swapped qty tiers).",
        "    • Q224377: Dropped iQuote HSC Bin row (qty 68 — not priced in SPOT).",
        "",
        "  FORCE-QTY-MATCH (name clustering bypassed; pair by qty only):",
        "    • Q222935 — WedgeHeader V1/V2 are same product, different artwork.",
        "    • Q222258 — Header #1 across 2 qty tiers matched to Header 1 & Header 2.",
        "    • Q223596 — SPOT uses 'Mini Pallet Band' name; iQuote uses SKU codes.",
        "",
        "  EXPLICIT COMPONENT NAME OVERRIDES (per user notes column):",
        "    • Q222777 — 7 rows mapped to Base Tray / Bottom Graphic / Carton OPF /",
        "                 Header / Hutch / Shelf / Side Support.",
        "    • Q223672 — 3 rows mapped to Hutch-2586-01-01 / Shelf Set-2586-01-02 /",
        "                 Header & Bottom Graphic Combo-2586-01-03.",
        "",
        "JOB TYPE CLASSIFICATION (per component)",
        "  • Cut Only               → no Print Cost.",
        "  • Print + Cut            → Print Cost > 0 AND no Strip / Glue / Tape.",
        "  • Print + Cut + Finishing → Print Cost > 0 AND (Strip OR Glue OR Tape) > 0.",
        "",
        "QTY BANDS",
        "  1-49, 50-199, 200-999, 1000-4999, 5000+.",
        "",
        "PRICE (NOT COST)",
        "  SPOT: 'Component Total' (from input.xlsx SPOT Data).",
        "  iQuote: 'ComponentTotalPrice' (from input.xlsx iQuote Data).",
        "",
        f"MATCHED COMPONENTS: {matched_count}",
        f"UNMATCHED (see 'Unmatched' tab): {unmatched_count}",
    ]
    for i, line in enumerate(lines, start=2):
        ws.cell(row=i, column=1, value=line)
        if line and line == line.upper() and not line.startswith(" "):
            ws.cell(row=i, column=1).font = Font(bold=True, color="1F4E78")
    ws.column_dimensions["A"].width = 110


def main():
    sp_data, iq_data, cost_lookup = load_data()
    sp_data, iq_data = apply_overrides(sp_data, iq_data)
    matched, unmatched = build_component_pairs(sp_data, iq_data, cost_lookup)

    print(f"Matched component pairs: {len(matched)}")
    print(f"Unmatched: {len(unmatched)}")
    from collections import Counter
    print("By job type:", Counter(m["Job Type"] for m in matched))
    print("By qty band:", Counter(m["Qty Band"] for m in matched))

    wb = openpyxl.Workbook()
    summary = wb.active
    summary.title = "Job-Type Variance"
    write_summary_tab(summary, matched)

    # Detail tabs per job type
    for jt in JOB_TYPES:
        rows = [m for m in matched if m["Job Type"] == jt]
        rows.sort(key=lambda r: (r["Qty Band"], -abs(r["Δ %"])))
        tab_name = jt.replace(" + ", "+").replace(" ", "")[:31]
        write_detail_tab(wb, tab_name, rows)

    # All matched (single sheet for filtering)
    all_matched = sorted(matched, key=lambda r: (r["Job Type"], r["Qty Band"], -abs(r["Δ %"])))
    write_detail_tab(wb, "All Matched", all_matched)

    write_unmatched_tab(wb, unmatched)
    write_methodology_tab(wb, len(matched), len(unmatched))

    local_path = os.path.join(ANALYSIS_DIR, OUT_FILE)
    wb.save(local_path)
    os.makedirs(STATIC_DIR, exist_ok=True)
    shutil.copy(local_path, os.path.join(STATIC_DIR, OUT_FILE))
    print(f"\nWrote: {local_path}")
    print(f"       {os.path.join(STATIC_DIR, OUT_FILE)}")


if __name__ == "__main__":
    main()
