"""PDF generation — customer-facing Preview Quote + internal Cost Report.

Uses weasyprint for HTML→PDF (visual fidelity to existing SPOT PDFs).
This is a first-draft template; Phase 3 polishes to match the legacy PDF
look exactly once we have estimator screenshots/sample PDFs to compare.
"""
from __future__ import annotations
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/pdf", tags=["pdf"])


def _fmt_money(n: float) -> str:
    try:
        return f"${float(n):,.2f}"
    except (ValueError, TypeError):
        return "—"


def _fmt_int(n: float) -> str:
    try:
        return f"{int(n):,}"
    except (ValueError, TypeError):
        return "—"


def _customer_pdf_html(quote: Dict[str, Any], results: List[Dict[str, Any]]) -> str:
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    est_num = quote.get("est_num") or "(draft)"
    customer = quote.get("customer_name") or quote.get("customerName") or "Customer"
    project = quote.get("projectName") or quote.get("state", {}).get("projectName") or ""

    rows_html = []
    for r in results:
        if r.get("error"):
            continue
        qty = _fmt_int(r.get("qty", 0))
        sell_total = _fmt_money(r.get("sellTotal", 0))
        sell_pc = _fmt_money(r.get("sellPc", 0))
        rows_html.append(f"""
        <tr>
          <td class="qty">{qty}</td>
          <td class="price">{sell_pc} / pc</td>
          <td class="price">{sell_total}</td>
        </tr>
        """)

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@page {{ size: letter; margin: 0.6in 0.7in; }}
body {{ font-family: 'Helvetica', sans-serif; font-size: 10pt; color: #222; }}
.header {{ border-bottom: 3px solid #D52E6B; padding-bottom: 12pt; margin-bottom: 18pt; display: flex; justify-content: space-between; align-items: flex-start; }}
.logo-block h1 {{ margin: 0; font-size: 22pt; letter-spacing: -0.02em; color: #1A1B1E; }}
.logo-block p {{ margin: 2pt 0 0; color: #555; font-size: 9pt; }}
.quote-meta {{ text-align: right; font-size: 9pt; }}
.quote-meta strong {{ color: #1A1B1E; }}
h2 {{ font-size: 11pt; text-transform: uppercase; letter-spacing: 0.08em; color: #888; border-bottom: 1px solid #ddd; padding-bottom: 4pt; margin-top: 18pt; }}
.specs {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8pt 18pt; margin: 8pt 0; }}
.specs div {{ font-size: 10pt; }}
.specs strong {{ display: inline-block; min-width: 110pt; color: #555; font-weight: 600; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 6pt; }}
th {{ text-align: left; padding: 8pt 10pt; background: #F5F1E8; color: #1A1B1E; font-size: 9pt; letter-spacing: 0.06em; text-transform: uppercase; }}
td {{ padding: 8pt 10pt; border-bottom: 1px solid #eee; }}
td.qty {{ font-weight: 700; }}
td.price {{ text-align: right; font-variant-numeric: tabular-nums; }}
.terms {{ margin-top: 20pt; font-size: 8.5pt; color: #555; line-height: 1.5; }}
.terms p {{ margin: 4pt 0; }}
.footer {{ position: fixed; bottom: 0.3in; left: 0.7in; right: 0.7in; font-size: 7.5pt; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 6pt; }}
</style></head>
<body>
<div class="header">
  <div class="logo-block">
    <h1>Standard Printing Company</h1>
    <p>1115 Cherry Ave NE · Canton, OH 44704</p>
    <p>(330) 453-8247 · standardprinting.com</p>
  </div>
  <div class="quote-meta">
    <div><strong>QUOTE #</strong> {est_num}</div>
    <div><strong>DATE</strong> {today}</div>
    <div><strong>VALID</strong> 30 days</div>
  </div>
</div>

<h2>Quoted to</h2>
<div><strong>{customer}</strong>{(" · " + project) if project else ""}</div>

<h2>Specifications</h2>
<div class="specs">
  <div><strong>Finished size:</strong> {quote.get('state', {}).get('oneUpW', '—')} × {quote.get('state', {}).get('oneUpL', '—')}″</div>
  <div><strong>Board:</strong> {quote.get('state', {}).get('boardGrade', '—')} {quote.get('state', {}).get('flute', '')} flute</div>
  <div><strong>Outer liner:</strong> {quote.get('state', {}).get('outsideLiner', '—')}</div>
  <div><strong>Inner liner:</strong> {quote.get('state', {}).get('insideLiner', '—')}</div>
  <div><strong>Print:</strong> {quote.get('state', {}).get('printReq', '—')}{(" · " + quote.get('state', {}).get('printSides', '')) if quote.get('state', {}).get('printReq') == 'Yes' else ''}</div>
  <div><strong>FOB:</strong> {quote.get('state', {}).get('quoteFOB', 'Origin')}</div>
</div>

<h2>Pricing</h2>
<table>
  <thead><tr><th>Quantity</th><th style="text-align:right;">Per piece</th><th style="text-align:right;">Total</th></tr></thead>
  <tbody>{''.join(rows_html) or '<tr><td colspan="3" style="text-align:center;color:#999;">No priced quantities</td></tr>'}</tbody>
</table>

<div class="terms">
  <p><strong>Terms:</strong> Net 30. Quote valid for 30 days from the date above. Pricing assumes a single production run; setup applies per release.</p>
  <p><strong>Freight:</strong> FOB Origin unless otherwise noted. Freight quoted separately on request.</p>
  <p><strong>Artwork:</strong> Customer-supplied print-ready artwork. Standard prepress included.</p>
</div>

<div class="footer">Standard Printing Company · Quote {est_num} · Generated by SPOT</div>
</body></html>
"""


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
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="quote-{quote.get("est_num","draft")}.pdf"'},
    )
