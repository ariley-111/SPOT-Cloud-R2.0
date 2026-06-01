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


def _customer_pdf_html(quote: Dict[str, Any], results: List[Dict[str, Any]], charge_mode: str) -> str:
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

    # ─── Item spec line (legacy L4706-4716) ────────────────────────
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
    fob_disp = "Canton, OH (Our Dock)" if str(quote_fob).startswith("Origin") else "Destination"
    ship_addr = _ship_to_addr(ship_to, dest_zip)

    # ─── Pricing rows (legacy L4602: filter wf.pricable, not excluded) ─
    rows = [r for r in results if r and r.get("pricable") and not r.get("error")
            and float(r.get("qty") or 0) > 0]

    # ─── Detect which charge columns to show (legacy L4717-4723) ───
    s_die  = any(float(r.get("dieLineCost") or 0)      > 0 for r in rows)
    s_frt  = any(float(r.get("freightLine") or 0)      > 0 for r in rows)
    s_pp   = any(float(r.get("prepressLineCost") or 0) > 0 for r in rows)
    s_misc = any(float(r.get("miscLineCost") or 0)     > 0 for r in rows)
    has_line_charges = s_die or s_frt or s_pp or s_misc
    by_type = charge_mode in ("By Type", "By Part") and has_line_charges
    show_combined_charges = has_line_charges and not by_type

    th_s = ('padding:8px 10px;text-align:right;font-size:11px;font-weight:700;'
            'text-transform:uppercase;letter-spacing:.06em;color:#6b7280')

    # Build header row
    header_cells = [
        f'<th style="{th_s};text-align:left">Qty</th>',
        f'<th style="{th_s}">Each</th>',
        f'<th style="{th_s}">Per/M</th>',
    ]
    if by_type:
        if s_die:  header_cells.append(f'<th style="{th_s}">Die</th>')
        if s_frt:  header_cells.append(f'<th style="{th_s}">Freight</th>')
        if s_pp:   header_cells.append(f'<th style="{th_s}">Prepress</th>')
        if s_misc: header_cells.append(f'<th style="{th_s}">Misc</th>')
    elif show_combined_charges:
        header_cells.append(f'<th style="{th_s}">Charges</th>')
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
            if s_die:  cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(die)  if die  > 0 else DASH}</td>')
            if s_frt:  cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(frt)  if frt  > 0 else DASH}</td>')
            if s_pp:   cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(prep) if prep > 0 else DASH}</td>')
            if s_misc: cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(misc) if misc > 0 else DASH}</td>')
        elif show_combined_charges:
            cells.append(f'<td style="padding:8px 10px;text-align:right;color:#6b7280">{_fm(charges_sum) if charges_sum > 0 else DASH}</td>')
        cells.append(f'<td style="padding:8px 10px;text-align:right;font-weight:700;color:#1e40af">{_fm(sell_total)}</td>')
        body_rows.append(f'<tr style="border-bottom:1px solid #e5e7eb;background:{bg}">{"".join(cells)}</tr>')

    pricing_table = (
        f'<table style="width:100%;border-collapse:collapse;margin-bottom:16px">'
        f'<thead><tr style="border-bottom:2px solid #d1d5db">{"".join(header_cells)}</tr></thead>'
        f'<tbody>{"".join(body_rows) or f"""<tr><td colspan="{len(header_cells)}" style="padding:20pt;text-align:center;color:#9ca3af">No priced quantities</td></tr>"""}</tbody>'
        f'</table>'
    )

    # ─── Item description bar (legacy L4714-4716) ──────────────────
    item_bar = (
        f'<div style="background:#f3f4f6;border-radius:6px;padding:10px 14px;margin-bottom:16px">'
        f'<div style="font-size:14px;font-weight:600">{title}</div>'
        f'{f"""<div style="font-size:12px;color:#6b7280;margin-top:2px">{spec_line}</div>""" if spec_line else ""}'
        f'</div>'
    )

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
    html = _customer_pdf_html(quote, results, charge_mode)
    pdf_bytes = HTML(string=html).write_pdf()
    est_num = quote.get("est_num") or quote.get("state", {}).get("estNum") or "draft"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="quote-{est_num}.pdf"'},
    )
