"""Email Quote — send the customer quote PDF via Microsoft Graph (app-only).

Sender is the shared mailbox GRAPH_MAIL_SENDER (estimates@standardprinting.com).
Requires the Entra app to have admin-consented Application permission Mail.Send.
"""
from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel

from models.schemas import User
from routes.auth import get_current_user
from routes.pdf import build_quote_pdf
from services import graph

logger = logging.getLogger("spot.email")
router = APIRouter(prefix="/api/email", tags=["email"])


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
async def send_quote(req: SendQuoteRequest, _u: User = Depends(get_current_user)) -> dict:
    if not graph.is_mail_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Email is not configured yet — IT must grant Mail.Send consent and set the sender mailbox.",
        )
    to = [a.strip() for a in (req.to or []) if a and a.strip()]
    cc = [a.strip() for a in (req.cc or []) if a and a.strip()]
    if not to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one 'To' recipient is required")

    pdf_bytes, est_num = build_quote_pdf(req.pdf)
    try:
        await graph.send_mail(
            to=to, cc=cc, subject=req.subject, body_html=req.body_html,
            attachment_name=f"quote-{est_num}.pdf", attachment_bytes=pdf_bytes,
        )
    except Exception as e:
        logger.exception("send-quote failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to send email: {e}")
    return {"status": "sent", "to": to, "cc": cc, "est_num": est_num}
