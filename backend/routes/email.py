"""Email Quote — send the customer quote PDF via Microsoft Graph (app-only).

Sender is the shared mailbox GRAPH_MAIL_SENDER (estimates@standardprinting.com).
Requires the Entra app to have admin-consented Application permission Mail.Send.
"""
from __future__ import annotations
import asyncio
import base64
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel

from models.schemas import User
from routes.auth import get_current_user
from routes.pdf import build_quote_pdf
from services import graph

logger = logging.getLogger("spot.email")
router = APIRouter(prefix="/api/email", tags=["email"])

# Logo embedded inline in the signature (reuses the PDF header logo).
_LOGO_PATH = Path(__file__).resolve().parent.parent / "static_assets" / "spc_logo.png"
_LOGO_BYTES = _LOGO_PATH.read_bytes() if _LOGO_PATH.exists() else b""

# Company contact details for the signature (shared main line).
_OFFICE_PHONE = "330.453.8247"
_WEBSITE = "www.standardprinting.com"
_ADDR_1 = "1115 Cherry Ave NE"
_ADDR_2 = "Canton, Ohio 44704"


def _signature_html(full_name: str) -> str:
    """Dynamic HTML signature: logo + 'The Estimating Team' + the estimator's
    first name (per logged-in user) + the company contact block."""
    first = (full_name or "").strip().split(" ")[0] if full_name else ""
    name_line = f"The Estimating Team<br/>{first}" if first else "The Estimating Team"
    logo = (f'<img src="cid:splogo" alt="Standard Printing Company" height="46" '
            f'style="display:block;height:46px;width:auto;border:0;margin-bottom:10px;"/>'
            if _LOGO_BYTES else "")
    return (
        '<br/>'
        '<table cellpadding="0" cellspacing="0" border="0" '
        'style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;border-collapse:collapse;">'
        f'<tr><td style="padding:0;">{logo}</td></tr>'
        f'<tr><td style="padding:0;font-size:18px;font-weight:bold;line-height:1.3;">{name_line}</td></tr>'
        '<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>'
        '<tr><td style="padding:0;font-size:13px;line-height:1.6;color:#1a1a1a;">'
        f'<b>Office:</b> {_OFFICE_PHONE}<br/>'
        f'<a href="https://{_WEBSITE}" style="color:#7c3aed;text-decoration:underline;">{_WEBSITE}</a>'
        '</td></tr>'
        '<tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>'
        f'<tr><td style="padding:0;font-size:13px;line-height:1.6;color:#1a1a1a;">{_ADDR_1}<br/>{_ADDR_2}</td></tr>'
        '</table>'
    )


class SendQuoteRequest(BaseModel):
    to: List[str]
    cc: List[str] = []
    subject: str
    body_html: str
    pdf: Dict[str, Any]  # same payload shape as /api/pdf/preview-quote


@router.get("/status")
async def email_status(_u: User = Depends(get_current_user)) -> dict:
    """Whether Graph email sending is configured (Mail.Send + sender mailbox)."""
    return {"configured": graph.is_mail_configured(),
            "sender": graph._creds().get("mail_sender") or None}


@router.post("/send-quote")
async def send_quote(req: SendQuoteRequest, user: User = Depends(get_current_user)) -> dict:
    if not graph.is_mail_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Email is not configured yet — IT must grant Mail.Send consent and set the sender mailbox.",
        )
    to = [a.strip() for a in (req.to or []) if a and a.strip()]
    cc = [a.strip() for a in (req.cc or []) if a and a.strip()]
    if not to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one 'To' recipient is required")

    # Append the dynamic HTML signature (logo + Estimating Team + first name).
    body_html = req.body_html + _signature_html(user.name or "")
    inline_images = ([{
        "name": "spc_logo.png", "content_type": "image/png",
        "content_bytes": _LOGO_BYTES, "content_id": "splogo",
    }] if _LOGO_BYTES else None)

    pdf_bytes, est_num = await asyncio.to_thread(build_quote_pdf, req.pdf)
    try:
        await graph.send_mail(
            to=to, cc=cc, subject=req.subject, body_html=body_html,
            attachment_name=f"quote-{est_num}.pdf", attachment_bytes=pdf_bytes,
            inline_images=inline_images,
        )
    except Exception as e:
        logger.exception("send-quote failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to send email: {e}")
    return {"status": "sent", "to": to, "cc": cc, "est_num": est_num}
