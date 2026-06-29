"""Microsoft Graph — app-only (client-credentials) helpers.

Reuses the same Entra app registration as SSO (auth_entra.py). The ONLY extra
requirement is admin-consented APPLICATION permissions on that app:
  - Mail.Send        (send the quote email from a shared mailbox)
  - Sites.Read.All   (read the customer file from SharePoint)
  - Files.Read.All

Config (env, set per environment like the ENTRA_* SSO vars):
  - ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET   (shared with SSO)
  - GRAPH_MAIL_SENDER          shared mailbox UPN, e.g. estimates@standardprinting.com
  - SHAREPOINT_SITE_PATH       e.g. standardprinting.sharepoint.com:/sites/Estimating
  - SHAREPOINT_FILE_PATH       drive path to the customer file, e.g. /Customers/CustomerMaster.xlsx
"""
from __future__ import annotations
import logging
import os
from typing import Optional

import httpx
import msal

logger = logging.getLogger("spot.graph")

GRAPH = "https://graph.microsoft.com/v1.0"
_SCOPE = ["https://graph.microsoft.com/.default"]


def _creds() -> dict:
    return {
        "tenant_id": os.environ.get("ENTRA_TENANT_ID", "").strip(),
        "client_id": os.environ.get("ENTRA_CLIENT_ID", "").strip(),
        "client_secret": os.environ.get("ENTRA_CLIENT_SECRET", "").strip(),
        "mail_sender": os.environ.get("GRAPH_MAIL_SENDER", "").strip(),
        "site_path": os.environ.get("SHAREPOINT_SITE_PATH", "").strip(),
        "file_path": os.environ.get("SHAREPOINT_FILE_PATH", "").strip(),
    }


def is_mail_configured() -> bool:
    c = _creds()
    return bool(c["tenant_id"] and c["client_id"] and c["client_secret"] and c["mail_sender"])


def is_sharepoint_configured() -> bool:
    c = _creds()
    return bool(c["tenant_id"] and c["client_id"] and c["client_secret"]
                and c["site_path"] and c["file_path"])


def _acquire_token() -> str:
    c = _creds()
    if not (c["tenant_id"] and c["client_id"] and c["client_secret"]):
        raise RuntimeError("Graph app credentials not configured (ENTRA_* env vars)")
    app = msal.ConfidentialClientApplication(
        client_id=c["client_id"],
        client_credential=c["client_secret"],
        authority=f"https://login.microsoftonline.com/{c['tenant_id']}",
    )
    result = app.acquire_token_for_client(scopes=_SCOPE)
    if "access_token" not in result:
        raise RuntimeError(f"Graph token error: {result.get('error_description') or result.get('error')}")
    return result["access_token"]


async def send_mail(to: list[str], cc: list[str], subject: str, body_html: str,
                    attachment_name: Optional[str] = None,
                    attachment_bytes: Optional[bytes] = None) -> None:
    """Send mail app-only from GRAPH_MAIL_SENDER. PDF attached inline (<3MB).

    SAFE-TEST MODE: if EMAIL_TEST_RECIPIENT is set, ALL mail is redirected to
    that single address (real To/CC ignored), the subject is tagged [TEST], and
    the intended recipients are noted at the top of the body. This guarantees no
    real customer is emailed while validating the live Graph send. Unset the
    env var to go fully live.
    """
    import base64
    c = _creds()
    if not c["mail_sender"]:
        raise RuntimeError("GRAPH_MAIL_SENDER not configured")

    test_recipient = os.environ.get("EMAIL_TEST_RECIPIENT", "").strip()
    if test_recipient:
        intended = f"<b>[TEST MODE]</b> Intended To: {', '.join(to) or '—'} · CC: {', '.join(cc) or '—'}<br/><hr/>"
        body_html = intended + body_html
        subject = f"[TEST] {subject}"
        to = [test_recipient]
        cc = []

    token = _acquire_token()
    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": [{"emailAddress": {"address": a}} for a in to if a],
        "ccRecipients": [{"emailAddress": {"address": a}} for a in cc if a],
    }
    if attachment_bytes and attachment_name:
        message["attachments"] = [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": attachment_name,
            "contentType": "application/pdf",
            "contentBytes": base64.b64encode(attachment_bytes).decode("ascii"),
        }]
    url = f"{GRAPH}/users/{c['mail_sender']}/sendMail"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {token}"},
                                 json={"message": message, "saveToSentItems": True})
    if resp.status_code not in (202, 200):
        logger.error("Graph sendMail failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Graph sendMail failed ({resp.status_code}): {resp.text[:300]}")


async def download_customer_file() -> bytes:
    """Download the customer master file from SharePoint by site + drive path."""
    c = _creds()
    if not (c["site_path"] and c["file_path"]):
        raise RuntimeError("SharePoint site/file path not configured")
    token = _acquire_token()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60) as client:
        site_resp = await client.get(f"{GRAPH}/sites/{c['site_path']}", headers=headers)
        if site_resp.status_code != 200:
            raise RuntimeError(f"Graph site lookup failed ({site_resp.status_code}): {site_resp.text[:300]}")
        site_id = site_resp.json()["id"]
        fp = c["file_path"].lstrip("/")
        dl = await client.get(f"{GRAPH}/sites/{site_id}/drive/root:/{fp}:/content",
                              headers=headers, follow_redirects=True)
        if dl.status_code != 200:
            raise RuntimeError(f"Graph file download failed ({dl.status_code}): {dl.text[:300]}")
        return dl.content
