"""PDF generation — customer-facing Preview Quote.

Verbatim 1:1 port of legacy `exportQuoteHTML` (spot_r1_5.jsx L4599-4870).
Includes: company header with logo + address + phone + fax + website, QUOTATION
right block, customer/date/project/valid/ship-to/FOB grid, item bar with full
specs (incl. customer ident + FSC), pricing table with Qty/Each/Per/M/[charges
columns]/Total, Terms & Conditions block (Payment, FOB, Ship To, bullet list,
optional notes), Sincerely + initials block, footer note.

NO signature lines (per user) — legacy template does not include them either.

Body shape accepted:
  {
    "quote":   { "est_num", "customer_name", "state": {...} },
    "results": [ { qty, itemSell, sellTotal, sellPc, dieLineCost, freightLine,
                   prepressLineCost, miscLineCost, ... } ],
    "chargeMode": "Lump Sum" | "By Type" | "By Part"   (default "By Type")
  }
"""
from __future__ import annotations
import base64
import re
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

# ─── Logo (PNG → base64 data URI) ────────────────────────────────────
_LOGO_PATH = Path(__file__).resolve().parent.parent / "static_assets" / "spc_logo.png"
try:
    _LOGO_DATA_URI = "data:image/png;base64," + base64.b64encode(_LOGO_PATH.read_bytes()).decode("ascii")
except FileNotFoundError:
    _LOGO_DATA_URI = ""

# ─── Formatters (mirror legacy fm/fn helpers) ────────────────────────
def _fm(n) -> str:
    try: return f"${float(n):,.2f}"
    except (ValueError, TypeError): return "—"

def _fn(n, d=0) -> str:
    try: return f"{float(n):,.{d}f}"
    except (ValueError, TypeError): return "—"

def _g(d: Dict[str, Any], *keys, default=""):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []): return v
    return default

def _liner_short(l: str) -> str:
    """Legacy fmLnr (spot_r1_5.jsx L1218): None→Kraft, strip weight + -Lite/-White."""
    if not l or l == "None":
        return "Kraft"
    s = re.sub(r"^\d+#\s*", "", str(l))
    return s.replace("-Lite", "").replace("-White", "")


def _ship_to_addr(quote_ship_to: str, dest_zip: str) -> str:
    """Legacy line 4817/4862: strip 5-digit ZIP already in address, then append destZip."""
    if not quote_ship_to and not dest_zip:
        return ""
    addr = re.sub(r"\b\d{5}\b", "", quote_ship_to or "").strip().rstrip(",").strip()
    if addr and dest_zip:
        return f"{addr}, {dest_zip}"
    return dest_zip or quote_ship_to or ""


def _matched_set_pricing_grid(bom_items: List[Dict[str, Any]],
                              component_pricing: List[Dict[str, Any]],
                              results: List[Dict[str, Any]],
                              fsc_global: bool) -> str:
    """Render the legacy Matched Set Preview pricing grid (spot_r1_5.jsx L4639-4702):

    - Per-component pricing: Component × qty-tier (sell/pc per tier, using
      itemSell/qty — clean, no embedded line charges; legacy L4655).
    - Price/Set row: per-tier sellPerSet.
    - Line charge rows (Die / Freight / Prepress / Misc) when present.
    - QUOTE TOTAL row (per-tier).
    - SETS row.

    Each `results` entry corresponds to one active qty tier (slot) in matched
    set mode — `qty` field holds setQty for that tier.
    """
    # Only show tiers that are pricable and have qty > 0 (matches legacy L4602)
    active_tiers = [r for r in results
                    if r and r.get("pricable") and float(r.get("qty") or 0) > 0]
    if not active_tiers:
        return ('<div style="padding:18pt;text-align:center;color:#9ca3af;font-size:12px">'
                'No priced set quantities</div>')

    th = ('padding:6px 8px;text-align:right;font-size:11px;font-weight:700;'
          'text-transform:uppercase;letter-spacing:.05em;color:#374151')
    dash = "\u2014"

    # ─── Component spec table (legacy L4609-4638) ────────────────────
    spec_rows = []
    for i, it in enumerate(bom_items):
        ist = it.get("state") or {}
        desc = it.get("desc") or ist.get("itemDesc") or f"Item {i+1}"
        pcs = it.get("pcsPerSet") or 1
        typ = it.get("type") or "Manufactured"
        brd, dims = "", dash
        if typ == "Manufactured":
            fl = ist.get("flute") or ""
            gr = ist.get("boardGrade") or ""
            ol = _liner_short(ist.get("outsideLiner"))
            il = _liner_short(ist.get("insideLiner"))
            brd = f"{gr} {fl} {ol}/{il}"
            if ist.get("fscEnabled") or fsc_global:
                brd += " \u00B7 FSC/SFI"
            try:
                iw, il_ = float(ist.get("oneUpW") or 0), float(ist.get("oneUpL") or 0)
                if iw > 0 and il_ > 0: dims = f"{_fn(iw, 4)}\u00D7{_fn(il_, 4)}"
            except (ValueError, TypeError): pass
        else:
            brd = "Purchased" if typ == "Purchased" else "Fulfillment"
        spec_rows.append(
            f'<tr><td style="padding:3px 6px;font-weight:600;width:18px">{i+1}</td>'
            f'<td style="padding:3px 6px">{desc}</td>'
            f'<td style="padding:3px 6px;color:#6b7280">{brd}</td>'
            f'<td style="padding:3px 6px;color:#6b7280">{dims}</td>'
            f'<td style="padding:3px 6px;text-align:right">{pcs}/set</td></tr>'
        )

    spec_table = (
        f'<div style="background:#f3f4f6;border-radius:6px;padding:10px 14px;margin-bottom:14px">'
        f'<div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px">'
        f'Matched Set \u2014 {len(bom_items)} Items</div>'
        f'<table style="width:100%;font-size:12px;border-collapse:collapse">'
        f'<thead><tr style="border-bottom:1px solid #d1d5db">'
        f'<th style="text-align:left;padding:3px 6px;font-size:11px;font-weight:700;color:#9ca3af">#</th>'
        f'<th style="text-align:left;padding:3px 6px;font-size:11px;font-weight:700;color:#9ca3af">Component</th>'
        f'<th style="text-align:left;padding:3px 6px;font-size:11px;font-weight:700;color:#9ca3af">Board</th>'
        f'<th style="text-align:left;padding:3px 6px;font-size:11px;font-weight:700;color:#9ca3af">Blank</th>'
        f'<th style="text-align:right;padding:3px 6px;font-size:11px;font-weight:700;color:#9ca3af">Pcs/Set</th>'
        f'</tr></thead><tbody>{"".join(spec_rows)}</tbody></table></div>'
    )

    # ─── Per-component pricing grid (legacy L4641-4659) ──────────────
    # Build a lookup: itemId → componentPricing entry
    cp_by_id = {c.get("itemId"): c for c in (component_pricing or [])}
    cp_by_idx = {c.get("itemIndex"): c for c in (component_pricing or [])}
    set_qtys = [int(float(r.get("qty") or 0)) for r in active_tiers]

    header_cells = [
        f'<th style="text-align:left;padding:6px 8px;font-size:11px;font-weight:700;color:#374151">Component</th>'
    ]
    for sq in set_qtys:
        header_cells.append(f'<th style="{th}">{_fn(sq, 0)} sets</th>')

    grid_rows = []
    for i, it in enumerate(bom_items):
        cp = cp_by_id.get(it.get("id")) or cp_by_idx.get(i) or {}
        rows = cp.get("rows") or []
        # Map slotIdx → row for fast lookup
        row_by_slot = {int(r.get("slotIdx") or 0): r for r in rows}
        bg = "#f9fafb" if i % 2 else "#fff"
        cells = [
            f'<td style="padding:4px 8px;background:{bg}"><b>{i+1}.</b> {it.get("desc") or f"Item {i+1}"}</td>'
        ]
        for ti, tier in enumerate(active_tiers):
            slot_i = int(tier.get("slot") or 0)
            r = row_by_slot.get(slot_i)
            sell_pc = 0.0
            if r:
                # LEGACY L4655: sell/pc in BOM grid = itemSell / qty (clean, no charges)
                qv = float(r.get("qty") or 0)
                isell = float(r.get("itemSell") or 0)
                sell_pc = isell / qv if qv > 0 else 0
            # Legacy preview prints "$X.XX/pc" suffix in component cells
            cell_val = f"{_fm(sell_pc)}/pc" if sell_pc > 0 else dash
            cells.append(
                f'<td style="padding:4px 8px;text-align:right;background:{bg}">{cell_val}</td>'
            )
        grid_rows.append(f"<tr>{''.join(cells)}</tr>")

    # Price/Set row (legacy L4660-4662)
    ps_cells = [f'<td style="padding:6px 8px;color:#1e40af;font-weight:700">Price/Set</td>']
    for tier in active_tiers:
        sps = float(tier.get("sellPc") or 0)  # In MP matched set, results[i].sellPc = sellPerSet
        # Fallback: derive from itemSell/qty
        if sps == 0:
            isell = float(tier.get("itemSell") or 0)
            qv = float(tier.get("qty") or 0)
            sps = isell / qv if qv > 0 else 0
        ps_cells.append(
            f'<td style="padding:6px 8px;text-align:right;color:#1e40af;font-weight:700">'
            f'{_fm(sps) if sps > 0 else dash}</td>'
        )

    # Line charge rows — Die / Freight / Prepress / Misc (legacy L4665-4692)
    # Die, Prepress, Misc are typically flat across tiers; Freight varies per-tier.
    charge_rows_html = []
    die_per_tier = [float(t.get("dieLineCost") or 0) for t in active_tiers]
    frt_per_tier = [float(t.get("freightLine") or 0) for t in active_tiers]
    pp_per_tier  = [float(t.get("prepressLineCost") or 0) for t in active_tiers]
    misc_per_tier = [float(t.get("miscLineCost") or 0) for t in active_tiers]

    def _charge_row(label: str, vals: List[float]) -> str:
        if not any(v > 0 for v in vals): return ""
        cells = [f'<td style="padding:4px 8px;color:#6b7280;font-style:italic">{label}</td>']
        for v in vals:
            cells.append(
                f'<td style="padding:4px 8px;text-align:right;color:#6b7280">'
                f'{_fm(v) if v > 0 else dash}</td>'
            )
        return f'<tr>{"".join(cells)}</tr>'

    charge_rows_html.append(_charge_row("Die", die_per_tier))
    charge_rows_html.append(_charge_row("Freight", frt_per_tier))
    charge_rows_html.append(_charge_row("Prepress", pp_per_tier))
    charge_rows_html.append(_charge_row("Misc", misc_per_tier))
    charge_rows_html = [r for r in charge_rows_html if r]

    # QUOTE TOTAL row (legacy L4694-4699) — uses sellTotal directly (already
    # includes all line charges via the engine).
    qt_cells = [f'<td style="padding:8px;color:#1e40af;font-weight:700;font-size:12px">QUOTE TOTAL</td>']
    for tier in active_tiers:
        st = float(tier.get("sellTotal") or 0)
        qt_cells.append(
            f'<td style="padding:8px;text-align:right;color:#1e40af;font-weight:700;font-size:13px">'
            f'{_fm(st)}</td>'
        )

    # SETS row (legacy L4700-4702)
    sets_cells = [f'<td style="padding:3px 8px;font-size:11px;color:#9ca3af">SETS</td>']
    for sq in set_qtys:
        sets_cells.append(
            f'<td style="padding:3px 8px;text-align:right;font-size:11px;color:#9ca3af">'
            f'{_fn(sq, 0)} sets</td>'
        )

    grid = (
        f'<div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;'
        f'letter-spacing:.05em;margin-bottom:6px">Per-Component Pricing</div>'
        f'<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">'
        f'<thead><tr style="border-bottom:2px solid #d1d5db">{"".join(header_cells)}</tr></thead>'
        f'<tbody>{"".join(grid_rows)}'
        f'<tr style="border-top:2px solid #1e40af">{"".join(ps_cells)}</tr>'
        f'{"".join(charge_rows_html)}'
        f'<tr style="border-top:2px solid #1e40af;background:#f0f4ff">{"".join(qt_cells)}</tr>'
        f'<tr>{"".join(sets_cells)}</tr>'
        f'</tbody></table>'
    )

    return spec_table + grid


def _customer_pdf_html(quote: Dict[str, Any], results: List[Dict[str, Any]], charge_mode: str,
                       component_pricing: List[Dict[str, Any]] = None,
                       job_totals: Dict[str, Any] = None) -> str:
    state = quote.get("state", {}) or {}
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%B %d, %Y")
    exp_days = int(state.get("quoteExpDays") or 30)
    exp_date = (today + timedelta(days=exp_days)).strftime("%B %d, %Y")

    est_num    = _g(quote, "est_num") or _g(state, "estNum") or "(draft)"
    est_init   = _g(state, "estInitials", default="SPC")
    cust_name  = _g(quote, "customer_name", "customerName") or _g(state, "custName", default="—")
    cust_ref   = _g(state, "custRef", "projectName")
    cust_ident = _g(state, "custIdent")
    item_desc  = _g(state, "itemDesc")
    box_style  = _g(state, "boxStyle")
    flute      = _g(state, "flute")
    grade      = _g(state, "boardGrade")
    ol         = _g(state, "outsideLiner")
    il         = _g(state, "insideLiner")
    one_w      = _g(state, "oneUpW")
    one_l      = _g(state, "oneUpL")
    quote_fob  = _g(state, "quoteFOB", default="Origin")
    ship_to    = _g(state, "quoteShipTo", "shipTo")
    dest_zip   = _g(state, "destZip")
    terms      = _g(state, "quoteTerms", default="Net 30")
    notes      = _g(state, "quoteNotes")
    fsc        = bool(state.get("fscEnabled"))

    # ─── MP-5: Multi-Part rendering ─────────────────────────────────
    is_mp = state.get("quoteType") == "Multi-Part" and isinstance(state.get("bomItems"), list) and len(state["bomItems"]) > 0
    bom_items = state.get("bomItems") or []
    pricing_mode = state.get("pricingMode") or "Matched Set"
    # MP-Individual switches the pricing area to per-component sections.
    mp_individual = is_mp and pricing_mode == "Individual" and bool(component_pricing)
    # MP-Matched Set renders the legacy per-component pricing grid (component
    # × qty-tier with sell/pc, Price/Set row, line charges, Quote Total row).
    mp_matched = is_mp and pricing_mode == "Matched Set"

    if mp_matched:
        # Spec table renders inside the pricing grid — no separate item bar.
        item_bar = ""
    elif is_mp and not mp_individual:
        # BOM bar — list each component with its key specs
        bom_rows = []
        for i, it in enumerate(bom_items):
            ist = it.get("state") or {}
            pcs = it.get("pcsPerSet") or 1
            desc = it.get("desc") or ist.get("itemDesc") or f"Item {i+1}"
            typ = it.get("type") or "Manufactured"
            ident = it.get("custIdent") or ist.get("custIdent") or ""
            sp = []
            if ident: sp.append(str(ident))
            ig = ist.get("boardGrade"); ifl = ist.get("flute")
            if ig and ifl: sp.append(f"{ig}# {ifl}")
            iol = ist.get("outsideLiner"); iil = ist.get("insideLiner")
            if iol or iil: sp.append(f"{_liner_short(iol)}/{_liner_short(iil)}")
            iw = ist.get("oneUpW"); il_ = ist.get("oneUpL")
            try:
                if float(iw or 0) > 0 and float(il_ or 0) > 0:
                    sp.append(f"{_fn(iw, 4)}\u00D7{_fn(il_, 4)}")
            except (ValueError, TypeError): pass
            line = " \u00B7 ".join([p for p in sp if p])
            type_color = ("#3b82f6" if typ == "Manufactured" else
                          "#06b6d4" if typ == "Purchased" else "#22c55e")
            bom_rows.append(
                f'<tr style="border-bottom:1px solid #e5e7eb">'
                f'<td style="padding:6px 10px;font-weight:600">{desc}</td>'
                f'<td style="padding:6px 10px;text-align:center;font-size:11px;color:{type_color};font-weight:700">{typ}</td>'
                f'<td style="padding:6px 10px;text-align:center;font-size:11px;color:#6b7280">{pcs}/set</td>'
                f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{line}</td>'
                f'</tr>'
            )
        title = item_desc or box_style or cust_ref or f"Multi-Part Display ({len(bom_items)} components)"
        _fsc_tag = " \u00B7 FSC/SFI" if fsc else ""
        item_bar = (
            f'<div style="background:#fef3c722;border:1px solid #f59e0b66;border-radius:6px;padding:10px 14px;margin-bottom:16px">'
            f'<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">'
            f'<div style="font-size:14px;font-weight:700">{title}</div>'
            f'<div style="font-size:11px;color:#f59e0b;font-weight:700;text-transform:uppercase;letter-spacing:.06em">'
            f'Multi-Part \u00B7 {pricing_mode}{_fsc_tag}</div>'
            f'</div>'
            f'<table style="width:100%;border-collapse:collapse;font-size:12px">'
            f'<thead><tr style="border-bottom:1px solid #d1d5db;color:#6b7280">'
            f'<th style="text-align:left;padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Component</th>'
            f'<th style="text-align:center;padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Type</th>'
            f'<th style="text-align:center;padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Pcs/Set</th>'
            f'<th style="text-align:left;padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Specs</th>'
            f'</tr></thead>'
            f'<tbody>{"".join(bom_rows)}</tbody></table>'
            f'</div>'
        )
    elif mp_individual:
        # No item bar — per-component sections render directly below the meta grid.
        item_bar = ""
    else:
        # ─── Single-piece item spec line (legacy L4706-4716) ────────
        spec_parts: List[str] = []
        if cust_ident: spec_parts.append(str(cust_ident))
        if grade and flute: spec_parts.append(f"{grade}# {flute}")
        spec_parts.append(f"{_liner_short(ol)}/{_liner_short(il)}")
        try:
            if float(one_w) > 0 and float(one_l) > 0:
                spec_parts.append(f"{_fn(one_w, 4)}\u00D7{_fn(one_l, 4)}")
        except (ValueError, TypeError):
            pass
        if fsc: spec_parts.append("FSC/SFI Material")
        spec_line = " \u00B7 ".join([p for p in spec_parts if p])
        title = item_desc or box_style or "Item"
        item_bar = (
            f'<div style="background:#f3f4f6;border-radius:6px;padding:10px 14px;margin-bottom:16px">'
            f'<div style="font-size:14px;font-weight:600">{title}</div>'
            f'{f"""<div style="font-size:12px;color:#6b7280;margin-top:2px">{spec_line}</div>""" if spec_line else ""}'
            f'</div>'
        )

    fob_disp = "Will-Call" if str(quote_fob).startswith("Origin") else "Ship (Destination)"
    ship_addr = _ship_to_addr(ship_to, dest_zip)

    # ─── Pricing rows (legacy L4602: filter wf.pricable, not excluded) ─
    rows = [r for r in results if r and r.get("pricable") and not r.get("error")
            and float(r.get("qty") or 0) > 0]

    # ─── Charge-mode column model ───────────────────────────────────────
    #  • By Type  → single combined "Charges" column (sum of one-time charges)
    #  • By Part  → one column per charge TYPE present (Die | Freight | Prepress
    #               | <each misc name>) each summing into the Quote Total
    #  • Lump Sum → no charge column; a per-qty descriptive list is shown below
    s_die  = any(float(r.get("dieLineCost") or 0)      > 0 for r in rows)
    s_frt  = any(float(r.get("freightLine") or 0)      > 0 for r in rows)
    s_pp   = any(float(r.get("prepressLineCost") or 0) > 0 for r in rows)
    s_misc = any(float(r.get("miscLineCost") or 0)     > 0 for r in rows)
    has_line_charges = s_die or s_frt or s_pp or s_misc
    by_part = charge_mode == "By Part" and has_line_charges
    by_type = charge_mode == "By Type" and has_line_charges
    is_lump = charge_mode == "Lump Sum" and has_line_charges

    def _row_misc_items(r):
        return [li for li in (r.get("miscLineItems") or []) if float(li.get("amt") or 0) > 0]

    misc_names: List[str] = []
    if by_part:
        for r in rows:
            for li in _row_misc_items(r):
                nm = li.get("name") or "Misc"
                if nm not in misc_names:
                    misc_names.append(nm)
        if not misc_names and s_misc:
            misc_names.append("Misc")

    def _row_misc_amt(r, name):
        for li in _row_misc_items(r):
            if (li.get("name") or "Misc") == name:
                return float(li.get("amt") or 0)
        if name == "Misc" and not (r.get("miscLineItems")):
            return float(r.get("miscLineCost") or 0)
        return 0.0

    def _row_charge_label(r):
        parts = []
        if float(r.get("freightLine") or 0) > 0: parts.append("Freight")
        if float(r.get("dieLineCost") or 0) > 0: parts.append("Die")
        if float(r.get("prepressLineCost") or 0) > 0: parts.append("Prepress")
        items = _row_misc_items(r)
        if items:
            for li in items: parts.append(li.get("name") or "Misc")
        elif float(r.get("miscLineCost") or 0) > 0:
            parts.append("Misc")
        return " + ".join(parts)

    th_s = ('padding:8px 10px;text-align:right;font-size:11px;font-weight:700;'
            'text-transform:uppercase;letter-spacing:.06em;color:#6b7280')

    # Build header row — for MP, "Each" becomes "Per Set" and "Per/M" becomes "Per/M Sets"
    each_label = "Per Set" if is_mp else "Each"
    perm_label = "Per/M Sets" if is_mp else "Per/M"
    qty_label = "Sets" if is_mp else "Qty"
    header_cells = [
        f'<th style="{th_s};text-align:left">{qty_label}</th>',
        f'<th style="{th_s}">{each_label}</th>',
        f'<th style="{th_s}">{perm_label}</th>',
    ]
    if by_type:
        header_cells.append(f'<th style="{th_s}">Charges</th>')
    if by_part:
        if s_die:  header_cells.append(f'<th style="{th_s}">Die</th>')
        if s_frt:  header_cells.append(f'<th style="{th_s}">Freight</th>')
        if s_pp:   header_cells.append(f'<th style="{th_s}">Prepress</th>')
        for nm in misc_names:
            header_cells.append(f'<th style="{th_s}">{nm}</th>')
    header_cells.append(f'<th style="{th_s};color:#1e40af">Total</th>')

    DASH = "\u2014"
    # Body rows — Each = sellPc (legacy: all-in per pc), Total = sellTotal
    body_rows = []
    for i, r in enumerate(rows):
        qty = float(r.get("qty") or 0)
        sell_pc = float(r.get("sellPc") or 0)
        if sell_pc == 0 and qty > 0:
            sell_pc = (float(r.get("sellTotal") or r.get("itemSell") or 0)) / qty
        sell_total = float(r.get("sellTotal") or r.get("itemSell") or 0)
        die  = float(r.get("dieLineCost") or 0)
        frt  = float(r.get("freightLine") or 0)
        prep = float(r.get("prepressLineCost") or 0)
        misc = float(r.get("miscLineCost") or 0)
        charges_sum = die + frt + prep + misc

        bg = "#fff" if i % 2 == 0 else "#f9fafb"
        cells = [
            f'<td style="padding:8px 10px;font-weight:600">{_fn(qty, 0)}</td>',
            f'<td style="padding:8px 10px;text-align:right">{_fm(sell_pc)}</td>',
            f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(sell_pc * 1000)}</td>',
        ]
        if by_type:
            cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(charges_sum) if charges_sum > 0 else DASH}</td>')
        if by_part:
            if s_die:  cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(die)  if die  > 0 else DASH}</td>')
            if s_frt:  cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(frt)  if frt  > 0 else DASH}</td>')
            if s_pp:   cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(prep) if prep > 0 else DASH}</td>')
            for nm in misc_names:
                v = _row_misc_amt(r, nm)
                cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(v) if v > 0 else DASH}</td>')
        cells.append(f'<td style="padding:8px 10px;text-align:right;font-weight:700;color:#1e40af">{_fm(sell_total)}</td>')
        body_rows.append(f'<tr style="border-bottom:1px solid #e5e7eb;background:{bg}">{"".join(cells)}</tr>')

    # Lump Sum: one descriptive line per qty tier (charge types + combined sum)
    lump_html = ""
    if is_lump:
        lump_lines = []
        for r in rows:
            ssum = (float(r.get("dieLineCost") or 0) + float(r.get("freightLine") or 0)
                    + float(r.get("prepressLineCost") or 0) + float(r.get("miscLineCost") or 0))
            if ssum <= 0:
                continue
            lbl = _row_charge_label(r)
            qty_word = "Set" if is_mp else "Qty"
            lump_lines.append(
                f'<div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;padding:2px 0">'
                f'<span>{lbl} @ {qty_word} {_fn(float(r.get("qty") or 0), 0)}</span>'
                f'<b style="color:#1f2937">{_fm(ssum)}</b></div>'
            )
        if lump_lines:
            lump_html = (
                '<div style="margin-top:-8px;margin-bottom:14px">'
                '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;'
                'letter-spacing:.06em;margin-bottom:4px">One-Time Charges</div>'
                + "".join(lump_lines) + '</div>'
            )

    pricing_table = (
        f'<table style="width:100%;border-collapse:collapse;margin-bottom:16px">'
        f'<thead><tr style="border-bottom:2px solid #d1d5db">{"".join(header_cells)}</tr></thead>'
        f'<tbody>{"".join(body_rows) or f"""<tr><td colspan="{len(header_cells)}" style="padding:20pt;text-align:center;color:#9ca3af">No priced quantities</td></tr>"""}</tbody>'
        f'</table>'
        + lump_html
    )

    # ─── MP-Matched Set: replace aggregate table with legacy per-component grid ─
    if mp_matched:
        pricing_table = _matched_set_pricing_grid(bom_items, component_pricing, results, fsc)

    # ─── MP-Individual: per-component sections replace the aggregate table ─
    if mp_individual:
        # Build per-component blocks. Each component is its own titled section
        # with its own qty rows: Qty | Each | Per/M | Freight | Die | Prepress | Total
        excl_map = state.get("exportExcludeByComponent") or {}
        sections_html: List[str] = []
        # Totals for footer
        total_base_sell = 0.0
        total_per_item_frt = 0.0
        total_per_item_die = 0.0
        total_per_item_prep = 0.0

        for c in component_pricing:
            item_id_c = c.get("itemId") or ""
            desc_c = c.get("desc") or f"Component {c.get('itemIndex', 0) + 1}"
            bs = c.get("boardSpec") or {}
            spec_parts_c: List[str] = []
            if bs.get("custIdent"): spec_parts_c.append(str(bs["custIdent"]))
            if bs.get("boardGrade") and bs.get("flute"):
                spec_parts_c.append(f'{bs["boardGrade"]}# {bs["flute"]}')
            if bs.get("outsideLiner") or bs.get("insideLiner"):
                spec_parts_c.append(f'{_liner_short(bs.get("outsideLiner"))}/{_liner_short(bs.get("insideLiner"))}')
            # Legacy L5909: include medium when not "None"
            med_c = bs.get("medium") or "None"
            if med_c and med_c != "None":
                spec_parts_c.append(str(med_c).replace("# Medium", "#").replace("# Bleached Medium", "# Bl"))
            try:
                if float(bs.get("oneUpW") or 0) > 0 and float(bs.get("oneUpL") or 0) > 0:
                    spec_parts_c.append(f'{_fn(bs["oneUpW"], 4)}\u00D7{_fn(bs["oneUpL"], 4)}')
            except (ValueError, TypeError):
                pass
            spec_parts_c.append(f'{c.get("pcsPerSet", 1)} pc/set')
            spec_line_c = " \u00B7 ".join([p for p in spec_parts_c if p])

            excl_slots = set(excl_map.get(item_id_c) or [])
            rows_c = [r for r in (c.get("rows") or []) if r.get("slotIdx") not in excl_slots]

            body_rows_c: List[str] = []
            for ri, r in enumerate(rows_c):
                qty_c = float(r.get("qty") or 0)
                sell_pc_c = float(r.get("sellPc") or 0)
                per_m_c = sell_pc_c * 1000.0
                frt_c = float(r.get("freightLine") or 0)
                die_c = float(r.get("dieLineCost") or 0)
                prep_c = float(r.get("prepressLineCost") or 0)
                total_c = float(r.get("sellTotal") or 0)
                total_base_sell += float(r.get("itemSell") or 0)
                total_per_item_frt += frt_c
                total_per_item_die += die_c
                total_per_item_prep += prep_c
                bg_c = "#fff" if ri % 2 == 0 else "#f9fafb"
                # Per legacy preview (spot_r1_5.jsx L4757-4758): per-component
                # section table is Qty | Each | Per/M | Total — no freight/die/
                # prepress columns (those live in the Quote Summary footer).
                body_rows_c.append(
                    f'<tr style="border-bottom:1px solid #e5e7eb;background:{bg_c}">'
                    f'<td style="padding:6px 10px;font-weight:600">{_fn(qty_c, 0)}</td>'
                    f'<td style="padding:6px 10px;text-align:right">{_fm(sell_pc_c)}</td>'
                    f'<td style="padding:6px 10px;text-align:right;color:#6b7280">{_fm(per_m_c)}</td>'
                    f'<td style="padding:6px 10px;text-align:right;font-weight:700;color:#1e40af">{_fm(total_c)}</td>'
                    f'</tr>'
                )
            if not body_rows_c:
                body_rows_c.append(
                    f'<tr><td colspan="4" style="padding:14pt;text-align:center;color:#9ca3af;font-size:12px">No qty entered</td></tr>'
                )

            sections_html.append(
                f'<div style="margin-bottom:16px">'
                f'<div style="background:#f3f4f6;border-radius:6px;padding:8px 12px;margin-bottom:4px">'
                f'<div style="font-size:13px;font-weight:700">{desc_c}</div>'
                f'<div style="font-size:11px;color:#6b7280;margin-top:2px">{spec_line_c}</div>'
                f'</div>'
                f'<table style="width:100%;border-collapse:collapse">'
                f'<thead><tr style="border-bottom:1px solid #d1d5db">'
                f'<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Qty</th>'
                f'<th style="padding:6px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Each</th>'
                f'<th style="padding:6px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Per/M</th>'
                f'<th style="padding:6px 10px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#1e40af">Total</th>'
                f'</tr></thead>'
                f'<tbody>{"".join(body_rows_c)}</tbody>'
                f'</table>'
                f'</div>'
            )

        # Job Totals footer — only when per-job costs or multiple components exist
        per_job_frt = float(job_totals.get("jobFreightCost") or 0) if (job_totals.get("freightScope") == "Per Job") else 0.0
        per_job_prep = float(job_totals.get("jobPrepressCost") or 0) if (job_totals.get("prepressScope") == "Per Job") else 0.0
        grand_total = total_base_sell + total_per_item_frt + total_per_item_die + total_per_item_prep + per_job_frt + per_job_prep

        footer_rows: List[str] = []
        footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Items (base sell)</td><td style="padding:3px 0;text-align:right">{_fm(total_base_sell)}</td></tr>')
        if total_per_item_frt > 0:
            footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Per-Item Freight</td><td style="padding:3px 0;text-align:right">{_fm(total_per_item_frt)}</td></tr>')
        if total_per_item_die > 0:
            footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Per-Item Die</td><td style="padding:3px 0;text-align:right">{_fm(total_per_item_die)}</td></tr>')
        if total_per_item_prep > 0:
            footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Per-Item Prepress</td><td style="padding:3px 0;text-align:right">{_fm(total_per_item_prep)}</td></tr>')
        if per_job_frt > 0:
            footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Per-Job Freight</td><td style="padding:3px 0;text-align:right">{_fm(per_job_frt)}</td></tr>')
        if per_job_prep > 0:
            footer_rows.append(f'<tr><td style="padding:3px 0;color:#6b7280">Per-Job Prepress</td><td style="padding:3px 0;text-align:right">{_fm(per_job_prep)}</td></tr>')
        footer_rows.append(
            f'<tr style="border-top:1px solid #d1d5db">'
            f'<td style="padding:6px 0 0;font-weight:700;color:#1e40af">Quote Total</td>'
            f'<td style="padding:6px 0 0;text-align:right;font-weight:700;font-size:15px;color:#1e40af">{_fm(grand_total)}</td>'
            f'</tr>'
        )
        job_totals_html = (
            f'<div style="margin-top:12px;padding:10px 14px;border-radius:6px;background:#f9fafb;border:1px solid #e5e7eb">'
            f'<div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Quote Summary</div>'
            f'<table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>{"".join(footer_rows)}</tbody></table>'
            f'</div>'
        )

        # Replace the aggregate pricing_table with per-component sections + footer
        pricing_table = "".join(sections_html) + job_totals_html

    # ─── Item description bar — already built above (see MP-5 branch).
    # No duplicate item_bar here; just use what we have.

    # ─── Meta grid (legacy L4857-4864) ─────────────────────────────
    meta_rows = [
        ('Customer',     cust_name,   'font-weight:600'),
        ('Date',         today_str,   'font-weight:600'),
    ]
    if cust_ref:
        meta_rows.append(('Project', str(cust_ref), ''))
    meta_rows.append(('Valid Until', exp_date, 'font-weight:600'))
    if ship_addr:
        meta_rows.append(('Ship To', ship_addr, ''))
    meta_rows.append(('FOB', fob_disp, ''))
    meta_html = ''.join(
        f'<div><div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">{lbl}</div>'
        f'<div style="font-size:13px;{style}">{val}</div></div>'
        for (lbl, val, style) in meta_rows
    )

    # ─── Terms block (legacy L4812-4828) ───────────────────────────
    ship_to_row = (f'<div style="grid-column:span 2"><b>Ship To:</b> {ship_addr}</div>'
                   if ship_addr else "")
    notes_row = (f'<div style="margin-top:4px"><b>Notes:</b> {notes}</div>'
                 if notes else "")
    initials_display = "Standard Printing Estimating" if est_init == "SPC" else est_init

    terms_html = f"""
<div style="margin-top:24px;padding-top:16px;border-top:2px solid #1e40af">
  <div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Terms &amp; Conditions</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:11px;color:#374151">
    <div><b>Payment:</b> {terms}</div><div><b>FOB:</b> {fob_disp}</div>
    {ship_to_row}
  </div>
  <div style="margin-top:10px;font-size:12px;color:#6b7280;line-height:1.6">
    <div>&bull; All quantities quoted are -0/+5% of quoted quantity unless otherwise noted.</div>
    <div>&bull; Quantity includes 1 hard proof.</div>
    <div>&bull; Artwork to be supplied print-ready by customer or pick up existing files.</div>
    {notes_row}
  </div>
  <div style="margin-top:24px;font-size:12px;color:#374151">
    <div>Sincerely,</div>
    <div style="margin-top:20px;font-weight:600">{initials_display}</div>
  </div>
</div>
"""

    # ─── Header block (legacy L4844-4856) ──────────────────────────
    logo_html = (f'<img src="{_LOGO_DATA_URI}" alt="Standard Printing Company" '
                 f'style="height:64px;width:auto;flex-shrink:0" />' if _LOGO_DATA_URI else "")

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Quote — {est_num}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'DM Sans',Arial,sans-serif;background:#fff;color:#1f2937;padding:0;font-size:13px;line-height:1.5}}
@page{{size:letter;margin:0.6in 0.65in 0.5in 0.65in}}
table{{page-break-inside:avoid}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e40af;padding-bottom:14px;margin-bottom:18px">
  <div style="display:flex;align-items:center;gap:18px">
    {logo_html}
    <div>
      <div style="font-size:14px;font-weight:700;color:#1e3a5f;letter-spacing:.04em;text-transform:uppercase">Standard Printing Company</div>
      <div style="font-size:12px;color:#6b7280;margin-top:3px;line-height:1.5">1115 Cherry Ave NE, Canton, OH 44704<br>Phone 330-453-8247 &middot; Fax 330-453-8730 &middot; www.spcoc.com</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:16px;font-weight:700;color:#1e40af;letter-spacing:.02em">QUOTATION</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px">Estimate {est_num}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 32px;margin-bottom:18px">
  {meta_html}
</div>

{item_bar}
{pricing_table}
{terms_html}

<div style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#9ca3af">This price quoted is valid for 90 days from the date of this estimate.</div>

</body></html>"""


@router.post("/preview-quote")
async def preview_quote(
    body: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
):
    from weasyprint import HTML  # lazy import
    quote = body.get("quote", {})
    results = body.get("results", [])
    charge_mode = body.get("chargeMode") or "By Type"
    # MP-Individual: per-component sections render in place of the aggregate pricing table.
    component_pricing = body.get("componentPricing") or []
    job_totals = body.get("jobTotals") or {}
    html = _customer_pdf_html(quote, results, charge_mode,
                              component_pricing=component_pricing, job_totals=job_totals)
    pdf_bytes = HTML(string=html).write_pdf()
    est_num = quote.get("est_num") or quote.get("state", {}).get("estNum") or "draft"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="quote-{est_num}.pdf"'},
    )
