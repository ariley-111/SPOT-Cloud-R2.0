"""PDF generation — customer-facing Preview Quote, ported 1:1 from legacy spot_r1_5.jsx (exportQuoteHTML)."""
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


def _fmt_money(n) -> str:
    try:
        return f"${float(n):,.2f}"
    except (ValueError, TypeError):
        return "—"

def _fmt_money_per(n) -> str:
    try:
        return f"${float(n):,.2f}"
    except (ValueError, TypeError):
        return "—"

def _fmt_int(n) -> str:
    try:
        return f"{int(float(n)):,}"
    except (ValueError, TypeError):
        return "—"

def _g(state, *keys, default=""):
    """Get first non-empty value of given keys from state dict."""
    for k in keys:
        v = state.get(k)
        if v not in (None, "", []):
            return v
    return default


def _customer_pdf_html(quote: Dict[str, Any], results: List[Dict[str, Any]]) -> str:
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
    item_desc = _g(state, "itemDesc", default="Item")
    box_style = _g(state, "boxStyle")
    flute     = _g(state, "flute")
    grade     = _g(state, "boardGrade")
    ol        = _g(state, "outsideLiner")
    il        = _g(state, "insideLiner")
    one_w     = _g(state, "oneUpW")
    one_l     = _g(state, "oneUpL")
    quote_fob = _g(state, "quoteFOB", default="Origin")
    ship_to   = _g(state, "shipTo", "quoteShipTo")
    dest_zip  = _g(state, "destZip")
    terms     = _g(state, "quoteTerms", default="Net 30")

    # Build spec sub-line — "200# E · Kla-White/Kla-White · 31.375×32.3125"
    spec_parts = []
    if grade:
        spec_parts.append(f"{grade}#" if not str(grade).endswith("#") and not str(grade).startswith("ECT") and grade not in ("NT",) else str(grade))
    if flute:
        spec_parts.append(flute)
    if ol or il:
        liner_join = f"{(ol or 'Kraft').replace('42# ', '').replace('33# ', '')}/{(il or 'Kraft').replace('42# ', '').replace('33# ', '')}"
        spec_parts.append(liner_join)
    if one_w and one_l:
        spec_parts.append(f"{one_w}×{one_l}")
    spec_line = " · ".join(spec_parts)

    # Title (item)
    title = box_style or item_desc or "Item"

    # Build ship-to display
    if ship_to and dest_zip and str(dest_zip) not in ship_to:
        ship_disp = f"{ship_to}, {dest_zip}"
    else:
        ship_disp = ship_to or dest_zip or "—"
    fob_disp = "Canton, OH (Our Dock)" if str(quote_fob).startswith("Origin") else "Destination"

    # Pricing table rows
    rows_html = []
    for r in results:
        if r.get("error"):
            continue
        qty = _fmt_int(r.get("qty", 0))
        each = _fmt_money_per(r.get("sellPc", 0))
        per_m = _fmt_money(r.get("sellMSF", 0))
        total = _fmt_money(r.get("sellTotal", 0))
        rows_html.append(f"""
        <tr>
          <td class="qty">{qty}</td>
          <td class="num">{each}</td>
          <td class="num">{per_m}</td>
          <td class="num strong">{total}</td>
        </tr>""")

    pricing_table = "".join(rows_html) or '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:20pt 0">No priced quantities</td></tr>'

    sign_off = "Standard Printing Estimating" if est_init == "SPC" else est_init

    logo_html = f'<img src="{_LOGO_DATA_URI}" alt="Standard Printing Company" style="height:64pt;width:auto;flex-shrink:0" />' if _LOGO_DATA_URI else ""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@page {{ size: letter; margin: 0.5in 0.65in 0.7in; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'DM Sans', 'Segoe UI', Helvetica, sans-serif; font-size: 10pt; color: #1f2937; margin: 0; padding: 0; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3pt solid #1e40af; padding-bottom: 14pt; margin-bottom: 18pt; }}
.brand {{ display: flex; align-items: center; gap: 14pt; }}
.brand .lines .name {{ font-size: 14pt; font-weight: 700; color: #1e3a5f; letter-spacing: 0.04em; text-transform: uppercase; }}
.brand .lines .addr {{ font-size: 9pt; color: #6b7280; margin-top: 3pt; line-height: 1.5; }}
.q-meta {{ text-align: right; }}
.q-meta .label {{ font-size: 13pt; font-weight: 700; color: #1e40af; letter-spacing: 0.02em; }}
.q-meta .num {{ font-size: 10pt; color: #6b7280; margin-top: 2pt; }}
.fields {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10pt 32pt; margin-bottom: 18pt; }}
.fields .k {{ font-size: 9pt; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; }}
.fields .v {{ font-size: 10pt; font-weight: 600; color: #1f2937; margin-top: 2pt; }}
.item-bar {{ background: #f3f4f6; padding: 10pt 14pt; border-radius: 4pt; margin: 6pt 0 4pt; }}
.item-bar .title {{ font-size: 13pt; font-weight: 700; color: #1f2937; }}
.item-bar .sub {{ font-size: 10pt; color: #6b7280; margin-top: 3pt; }}
table.price {{ width: 100%; border-collapse: collapse; margin-top: 4pt; }}
table.price th {{ text-align: left; padding: 8pt 10pt 6pt; font-size: 9pt; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1pt solid #e5e7eb; }}
table.price th.num {{ text-align: right; }}
table.price td {{ padding: 10pt; border-bottom: 1pt solid #e5e7eb; font-size: 10pt; }}
table.price td.qty {{ font-weight: 700; }}
table.price td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
table.price td.strong {{ font-weight: 700; color: #1e40af; }}
.terms-block {{ margin-top: 20pt; padding-top: 14pt; border-top: 3pt solid #1e40af; }}
.terms-block h3 {{ font-size: 11pt; font-weight: 700; color: #1e40af; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 8pt; }}
.terms-row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 32pt; font-size: 10pt; margin-bottom: 8pt; }}
.terms-row .k {{ font-weight: 700; color: #1f2937; }}
.terms-row .v {{ color: #4b5563; }}
.terms-list {{ font-size: 10pt; color: #4b5563; line-height: 1.6; margin: 4pt 0 0; padding: 0; list-style: none; }}
.terms-list li {{ margin: 3pt 0; }}
.terms-list li:before {{ content: "•  "; color: #9ca3af; }}
.signoff {{ margin-top: 24pt; font-size: 10pt; color: #1f2937; }}
.signoff .name {{ margin-top: 18pt; font-weight: 700; }}
.footer {{ margin-top: 24pt; padding-top: 10pt; border-top: 1pt solid #e5e7eb; text-align: center; font-size: 9pt; color: #9ca3af; }}
</style></head>
<body>
<div class="header">
  <div class="brand">
    {logo_html}
    <div class="lines">
      <div class="name">Standard Printing Company</div>
      <div class="addr">1115 Cherry Ave NE, Canton, OH 44704<br>Phone 330-453-8247 · Fax 330-453-8730 · www.spcoc.com</div>
    </div>
  </div>
  <div class="q-meta">
    <div class="label">QUOTATION</div>
    <div class="num">Estimate {est_num}</div>
  </div>
</div>

<div class="fields">
  <div><div class="k">Customer</div><div class="v">{customer}</div></div>
  <div><div class="k">Date</div><div class="v">{today_str}</div></div>
  {f'<div><div class="k">Project</div><div class="v">{project}</div></div>' if project else '<div></div>'}
  <div><div class="k">Valid Until</div><div class="v">{exp_date}</div></div>
  <div><div class="k">Ship To</div><div class="v">{ship_disp}</div></div>
  <div><div class="k">FOB</div><div class="v">{fob_disp}</div></div>
  {f'<div><div class="k">Customer Ident</div><div class="v">{cust_ident}</div></div>' if cust_ident else ''}
</div>

<div class="item-bar">
  <div class="title">{title}</div>
  {f'<div class="sub">{spec_line}</div>' if spec_line else ''}
</div>

<table class="price">
  <thead><tr>
    <th>QTY</th><th class="num">EACH</th><th class="num">PER/M</th><th class="num">TOTAL</th>
  </tr></thead>
  <tbody>{pricing_table}</tbody>
</table>

<div class="terms-block">
  <h3>Terms &amp; Conditions</h3>
  <div class="terms-row">
    <div><span class="k">Payment:</span> <span class="v">{terms}</span></div>
    <div><span class="k">FOB:</span> <span class="v">{fob_disp}</span></div>
    {f'<div><span class="k">Ship To:</span> <span class="v">{ship_disp}</span></div>' if ship_disp != "—" else '<div></div>'}
  </div>
  <ul class="terms-list">
    <li>All quantities quoted are -0/+5% of quoted quantity unless otherwise noted.</li>
    <li>Quantity includes 1 hard proof.</li>
    <li>Artwork to be supplied print-ready by customer or pick up existing files.</li>
  </ul>
</div>

<div class="signoff">
  Sincerely,
  <div class="name">{sign_off}</div>
</div>

<div class="footer">This price quoted is valid for {exp_days} days from the date of this estimate.</div>
</body></html>"""


@router.post("/preview-quote")
async def preview_quote(
    body: Dict[str, Any] = Body(...),
    _u: User = Depends(get_current_user),
):
    """Generate a customer-facing PDF. Body: { quote: {...}, results: [...] }"""
    from weasyprint import HTML  # lazy import (slow init)
    quote = body.get("quote", {})
    results = body.get("results", [])
    html = _customer_pdf_html(quote, results)
    pdf_bytes = HTML(string=html).write_pdf()
    est_num = quote.get("est_num") or quote.get("state", {}).get("estNum") or "draft"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="quote-{est_num}.pdf"'},
    )
