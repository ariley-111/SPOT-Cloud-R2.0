"""PDF generation — customer-facing Preview Quote, ported 1:1 from legacy spot_r1_5.jsx (exportQuoteHTML).

Body shape accepted:
  {
    "quote":   { "est_num", "customer_name", "state": {...} },
    "results": [ { qty, itemSell, dieLineCost, freightLine, prepressLineCost, miscLineCost, ... } ],
    "chargeMode": "Lump Sum" | "By Type" | "By Part"   (default "By Type")
  }
"""
from __future__ import annotations
import base64
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


def _fm(n) -> str:
    try: return f"${float(n):,.2f}"
    except (ValueError, TypeError): return "—"

def _fm4(n) -> str:
    try: return f"${float(n):,.4f}"
    except (ValueError, TypeError): return "—"

def _fn4(n) -> str:
    try: return f"{float(n):,.4f}"
    except (ValueError, TypeError): return "—"

def _fi(n) -> str:
    try: return f"{int(float(n)):,}"
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
    import re as _re
    s = _re.sub(r"^\d+#\s*", "", str(l))
    return s.replace("-Lite", "").replace("-White", "")


def _customer_pdf_html(quote: Dict[str, Any], results: List[Dict[str, Any]], charge_mode: str) -> str:
    state = quote.get("state", {}) or {}
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%B %d, %Y")
    exp_days = int(state.get("quoteExpDays") or 30)
    exp_date = (today + timedelta(days=exp_days)).strftime("%B %d, %Y")

    est_num   = _g(quote, "est_num") or _g(state, "estNum") or "(draft)"
    est_init  = _g(state, "estInitials", default="SPC")
    customer  = _g(quote, "customer_name", "customerName") or _g(state, "custName", default="—")
    project   = _g(state, "custRef", "projectName")
    cust_ident = _g(state, "custIdent")
    item_desc = _g(state, "itemDesc")
    box_style = _g(state, "boxStyle")
    flute     = _g(state, "flute")
    grade     = _g(state, "boardGrade")
    ol        = _g(state, "outsideLiner")
    il        = _g(state, "insideLiner")
    one_w     = _g(state, "oneUpW")
    one_l     = _g(state, "oneUpL")
    quote_fob = _g(state, "quoteFOB", default="Origin")
    ship_to   = _g(state, "quoteShipTo", "shipTo")
    dest_zip  = _g(state, "destZip")
    terms     = _g(state, "quoteTerms", default="Net 30")
    notes     = _g(state, "quoteNotes")
    fsc       = bool(state.get("fscEnabled"))

    # Spec sub-line
    spec_parts = []
    if cust_ident: spec_parts.append(str(cust_ident))
    if grade and flute: spec_parts.append(f"{grade}# {flute}")
    spec_parts.append(f"{_liner_short(ol)}/{_liner_short(il)}")
    try:
        if float(one_w) > 0 and float(one_l) > 0:
            spec_parts.append(f"{_fn4(one_w)}×{_fn4(one_l)}")
    except (ValueError, TypeError):
        pass
    if fsc: spec_parts.append("FSC")
    spec_line = " · ".join([p for p in spec_parts if p])

    title = item_desc or box_style or "Item"

    # Ship-to display
    ship_disp = ", ".join([x for x in [ship_to, dest_zip] if x]) or "—"
    fob_disp = "Origin" if str(quote_fob).startswith("Origin") else "Destination"

    # Filter priced rows
    rows = [r for r in results if r and r.get("pricable") and not r.get("error") and float(r.get("qty") or 0) > 0]
    has_line_items = any(
        float(r.get("dieLineCost") or 0) > 0 or float(r.get("freightLine") or 0) > 0
        or float(r.get("prepressLineCost") or 0) > 0 or float(r.get("miscLineCost") or 0) > 0
        for r in rows
    )
    show_charges_col = has_line_items and charge_mode != "Lump Sum"

    # Build pricing table HTML
    header_cells = ['<th class="thL">QTY</th>', '<th class="thS">EACH</th>',
                    '<th class="thS">PER/M</th>', '<th class="thS">TOTAL</th>']
    if show_charges_col:
        header_cells.append('<th class="thS">CHARGES</th>')
    header_cells.append('<th class="thS qt">QUOTE TOTAL</th>')

    body_rows = []
    for i, r in enumerate(rows):
        qty = float(r.get("qty") or 0)
        item_sell = float(r.get("itemSell") or 0)
        sell_pc = item_sell / qty if qty > 0 else 0
        die = float(r.get("dieLineCost") or 0)
        frt = float(r.get("freightLine") or 0)
        prep = float(r.get("prepressLineCost") or 0)
        misc = float(r.get("miscLineCost") or 0)
        charges_total = die + frt + prep + misc
        quote_total = item_sell + charges_total

        line_charge_bits = []
        if die > 0:  line_charge_bits.append(f"Die: {_fm(die)}")
        if frt > 0:  line_charge_bits.append(f"Freight: {_fm(frt)}")
        if prep > 0: line_charge_bits.append(f"Prepress: {_fm(prep)}")
        if misc > 0: line_charge_bits.append(f"Misc: {_fm(misc)}")

        if charge_mode == "By Part":
            charge_cell = ", ".join(line_charge_bits) or "—"
        else:
            charge_cell = _fm(charges_total) if charges_total > 0 else "—"

        bg = "#fff" if i % 2 == 0 else "#f9fafb"
        cells = [
            f'<td class="td l qty">{_fi(qty)}</td>',
            f'<td class="td r">{_fm4(sell_pc)}</td>',
            f'<td class="td r muted">{_fm(sell_pc * 1000)}</td>',
            f'<td class="td r">{_fm(item_sell)}</td>',
        ]
        if show_charges_col:
            cells.append(f'<td class="td r muted small">{charge_cell}</td>')
        cells.append(f'<td class="td r qt">{_fm(quote_total)}</td>')
        body_rows.append(f'<tr style="background:{bg}">' + "".join(cells) + "</tr>")

    if not body_rows:
        colspan = len(header_cells)
        pricing_table_body = f'<tr><td colspan="{colspan}" style="text-align:center;color:#9ca3af;padding:20pt">No priced quantities</td></tr>'
    else:
        pricing_table_body = "".join(body_rows)

    # Lump sum charges block (legacy: displayed below table)
    lump_block = ""
    if has_line_items and charge_mode == "Lump Sum" and rows:
        r0 = rows[0]
        lump = (float(r0.get("dieLineCost") or 0) + float(r0.get("freightLine") or 0)
                + float(r0.get("prepressLineCost") or 0) + float(r0.get("miscLineCost") or 0))
        if lump > 0:
            lump_block = (f'<div style="text-align:right;font-size:11pt;color:#6b7280;'
                          f'margin-top:-4pt;margin-bottom:12pt">'
                          f'One-Time Charges: <b style="color:#1f2937">{_fm(lump)}</b></div>')

    # Project + Ship-To sections (conditional)
    extras = []
    if project:
        extras.append(f'<div><div class="k">Project</div><div class="v">{project}</div></div>')
    if ship_disp != "—":
        extras.append(f'<div><div class="k">Ship To</div><div class="v">{ship_disp}</div></div>')
    extras_html = "".join(extras)

    notes_html = (f'<div style="margin-top:12pt;padding:8pt 12pt;background:#fffbeb;'
                  f'border:1pt solid #fde68a;border-radius:4pt;font-size:10pt;color:#92400e">{notes}</div>'
                  if notes else "")

    logo_html = (f'<img src="{_LOGO_DATA_URI}" alt="Standard Printing Company" '
                 f'style="height:60pt;width:auto;flex-shrink:0" />') if _LOGO_DATA_URI else ""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@page {{ size: letter; margin: 0.5in 0.65in 0.6in; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'DM Sans', Arial, sans-serif; font-size: 11pt; color: #1f2937; margin: 0; padding: 0; line-height: 1.5; }}
.head {{ border-bottom: 3pt solid #1e40af; padding-bottom: 14pt; margin-bottom: 18pt;
        display: flex; align-items: center; gap: 16pt; }}
.head .name {{ font-size: 13pt; font-weight: 700; color: #1e3a5f; letter-spacing: .04em; text-transform: uppercase; }}
.head .addr {{ font-size: 10pt; color: #6b7280; margin-top: 3pt; line-height: 1.5; }}
.meta {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10pt 32pt; margin-bottom: 18pt; }}
.meta .k {{ font-size: 9pt; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .06em; }}
.meta .v {{ font-size: 12pt; font-weight: 600; margin-top: 2pt; }}
.item-bar {{ background: #f3f4f6; border-radius: 5pt; padding: 10pt 14pt; margin-bottom: 16pt; }}
.item-bar .title {{ font-size: 12pt; font-weight: 600; }}
.item-bar .sub {{ font-size: 10pt; color: #6b7280; margin-top: 2pt; }}
table.price {{ width: 100%; border-collapse: collapse; margin-bottom: 14pt; }}
table.price th {{ border-bottom: 2pt solid #d1d5db; padding: 6pt 8pt; font-size: 9pt; font-weight: 700;
                 text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }}
table.price th.thL {{ text-align: left; }}
table.price th.thS {{ text-align: right; }}
table.price th.qt {{ color: #1e40af; }}
table.price td.td {{ padding: 7pt 8pt; border-bottom: 1pt solid #e5e7eb; font-size: 10pt; }}
table.price td.l {{ text-align: left; }}
table.price td.r {{ text-align: right; }}
table.price td.qty {{ font-weight: 600; }}
table.price td.muted {{ color: #6b7280; }}
table.price td.small {{ font-size: 9pt; }}
table.price td.qt {{ font-weight: 700; color: #1e40af; }}
.terms {{ border-top: 1pt solid #e5e7eb; padding-top: 12pt; display: grid;
         grid-template-columns: 1fr 1fr 1fr; gap: 10pt; font-size: 10pt; }}
.terms strong {{ color: #6b7280; }}
.signs {{ margin-top: 28pt; display: grid; grid-template-columns: 1fr 1fr; gap: 36pt; }}
.signs .line {{ border-bottom: 1pt solid #d1d5db; height: 32pt; }}
.signs .lbl {{ font-size: 9pt; color: #9ca3af; margin-top: 4pt; }}
.footer {{ margin-top: 20pt; text-align: center; font-size: 9pt; color: #9ca3af; }}
</style></head>
<body>

<div class="head">
  {logo_html}
  <div>
    <div class="name">Standard Printing Company</div>
    <div class="addr">1115 Cherry Ave NE, Canton, OH 44704</div>
  </div>
</div>

<div class="meta">
  <div><div class="k">Quote Number</div><div class="v">{est_num}</div></div>
  <div><div class="k">Date</div><div class="v">{today_str}</div></div>
  <div><div class="k">Customer</div><div class="v">{customer}</div></div>
  <div><div class="k">Valid Until</div><div class="v">{exp_date}</div></div>
  {extras_html}
</div>

<div class="item-bar">
  <div class="title">{title}</div>
  {f'<div class="sub">{spec_line}</div>' if spec_line else ''}
</div>

<table class="price">
  <thead><tr>{''.join(header_cells)}</tr></thead>
  <tbody>{pricing_table_body}</tbody>
</table>
{lump_block}

<div class="terms">
  <div><strong>Terms:</strong> {terms}</div>
  <div><strong>FOB:</strong> {fob_disp}</div>
  <div><strong>Valid:</strong> {exp_days} days</div>
</div>
{notes_html}

<div class="signs">
  <div><div class="line"></div><div class="lbl">Authorized Signature</div></div>
  <div><div class="line"></div><div class="lbl">Customer Acceptance</div></div>
</div>

<div class="footer">Estimate #{est_num} · Prepared by {est_init} · {today_str}</div>

</body></html>"""


@router.post("/preview-quote")
async def preview_quote(
    body: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
):
    from weasyprint import HTML  # lazy import (slow init)
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
