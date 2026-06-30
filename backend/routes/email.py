"""Email Quote — send the customer quote PDF via Microsoft Graph (app-only).

Sender is the shared mailbox GRAPH_MAIL_SENDER (estimates@standardprinting.com).
Requires the Entra app to have admin-consented Application permission Mail.Send.
"""
from __future__ import annotations
import asyncio
import base64
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel

from db import db, COL_EMAIL_JOBS
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


def _first_name(full_name: str) -> str:
    """Extract the first name from a directory name, handling both
    "First Last" and "Last, First" formats (e.g. 'Riley, Dean' → 'Dean')."""
    n = (full_name or "").strip()
    if not n:
        return ""
    if "," in n:                       # "Last, First" → take the part after the comma
        n = n.split(",", 1)[1].strip()
    return n.split(" ")[0] if n else ""


def _signature_html(full_name: str) -> str:
    """Dynamic HTML signature: logo + 'The Estimating Team' + the estimator's
    first name (per logged-in user) + the company contact block."""
    first = _first_name(full_name)
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


@router.post("/send-quote", status_code=202)
async def send_quote(req: SendQuoteRequest, user: User = Depends(get_current_user)) -> dict:
    """Start an async email send. Returns a job_id immediately (HTTP 202) so the
    request can't hit the Cloudflare/proxy gateway timeout while MSAL + Graph
    network calls run. Poll GET /api/email/job/{job_id} for the outcome — on
    failure the job carries the EXACT MSAL/Graph error string for diagnosis."""
    if not graph.is_mail_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Email is not configured yet — IT must grant Mail.Send consent and set the sender mailbox.",
        )
    to = [a.strip() for a in (req.to or []) if a and a.strip()]
    cc = [a.strip() for a in (req.cc or []) if a and a.strip()]
    if not to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one 'To' recipient is required")

    job_id = uuid.uuid4().hex
    await db[COL_EMAIL_JOBS].insert_one({
        "job_id": job_id, "status": "pending", "owner": user.email,
        "created_at": datetime.now(timezone.utc),
    })
    asyncio.create_task(_run_send_job(job_id, req, to, cc, user.name or ""))
    return {"job_id": job_id, "status": "pending"}


async def _run_send_job(job_id: str, req: SendQuoteRequest,
                        to: List[str], cc: List[str], user_name: str) -> None:
    """Background worker — renders the PDF, sends via Graph, and records the
    outcome (incl. the full error string on failure). Never raises."""
    stage = "starting"
    try:
        stage = "rendering PDF"
        pdf_body = {**req.pdf, "signerName": user_name}
        pdf_bytes, est_num = await asyncio.to_thread(build_quote_pdf, pdf_body)

        body_html = req.body_html + _signature_html(user_name)
        inline_images = ([{
            "name": "spc_logo.png", "content_type": "image/png",
            "content_bytes": _LOGO_BYTES, "content_id": "splogo",
        }] if _LOGO_BYTES else None)

        stage = "acquiring Microsoft Graph token / sending mail"
        await graph.send_mail(
            to=to, cc=cc, subject=req.subject, body_html=body_html,
            attachment_name=f"quote-{est_num}.pdf", attachment_bytes=pdf_bytes,
            inline_images=inline_images,
        )
        await db[COL_EMAIL_JOBS].update_one(
            {"job_id": job_id},
            {"$set": {"status": "done", "est_num": est_num, "to": to, "cc": cc,
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as e:
        logger.exception("send-quote job %s failed during %s", job_id, stage)
        detail = f"Email failed while {stage}: {e}"
        await db[COL_EMAIL_JOBS].update_one(
            {"job_id": job_id},
            {"$set": {"status": "error", "error": detail, "stage": stage,
                      "finished_at": datetime.now(timezone.utc).isoformat()}},
        )


@router.get("/job/{job_id}")
async def get_send_job(job_id: str, _u: User = Depends(get_current_user)) -> dict:
    """Poll an async email-send job. Returns {status: pending|done|error, ...}.
    On error, `error` carries the exact MSAL/Graph failure for IT to act on."""
    doc = await db[COL_EMAIL_JOBS].find_one({"job_id": job_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Email job not found (may have expired)")
    doc.pop("created_at", None)
    return doc
