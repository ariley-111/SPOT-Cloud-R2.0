"""Email file extraction — .eml (RFC822/MIME) and .msg (Outlook).

Given raw bytes of an email file, return:
  {
    "body":        str   (plain-text body, html stripped),
    "subject":     str,
    "from":        str,
    "attachments": [ {"filename": str, "mime": str, "bytes": bytes}, ... ],
  }

Only PDFs / images / docx / txt attachments are returned (the rest are dropped —
no need to feed signature-block GIFs / .ics / etc to the parser).
"""
from __future__ import annotations
import email
import io
import re
from email import policy
from typing import Any, Dict, List

# MIME types we forward to the parser (matches parser.py's file-type whitelist)
PARSER_KEEP_MIME = {
    "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
    "image/heic", "image/heif",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/msword",  # .doc
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
    "application/vnd.ms-excel",  # .xls
    "text/csv", "text/tab-separated-values", "text/plain",
    "application/rtf", "text/rtf",
    # Nested emails (forwarded RFQ chains) — kept so they can be recursively
    # expanded; the wrapper is dropped after expansion (see extract_email_file).
    "message/rfc822", "application/vnd.ms-outlook",
}
PARSER_KEEP_EXT = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif",
    ".docx", ".doc", ".xlsx", ".xls", ".csv", ".tsv", ".txt", ".rtf",
    # Nested email files (see above).
    ".eml", ".msg",
}

# Email file extensions — used to detect nested emails for recursive expansion.
EMAIL_EXT = {".eml", ".msg"}
EMAIL_MIME = {"message/rfc822", "application/vnd.ms-outlook"}
# Cap recursion so a maliciously / accidentally deep mail chain can't loop.
MAX_EMAIL_DEPTH = 6


def _is_email_attachment(filename: str, mime: str) -> bool:
    if (mime or "").lower() in EMAIL_MIME:
        return True
    name_lower = (filename or "").lower()
    return any(name_lower.endswith(ext) for ext in EMAIL_EXT)


def _is_parser_attachment(filename: str, mime: str) -> bool:
    if mime in PARSER_KEEP_MIME:
        return True
    name_lower = (filename or "").lower()
    return any(name_lower.endswith(ext) for ext in PARSER_KEEP_EXT)


def _html_to_text(html: str) -> str:
    """Cheap HTML→text — strips tags, decodes entities, collapses whitespace."""
    import html as _html
    txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    txt = re.sub(r"<br\s*/?>", "\n", txt, flags=re.I)
    txt = re.sub(r"</p>", "\n\n", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", "", txt)
    txt = _html.unescape(txt)
    return re.sub(r"\n{3,}", "\n\n", txt).strip()


def extract_eml(raw: bytes) -> Dict[str, Any]:
    msg = email.message_from_bytes(raw, policy=policy.default)
    body_text, body_html = "", ""
    attachments: List[Dict[str, Any]] = []

    # Manual traversal that treats a nested email (message/rfc822) as a single
    # leaf attachment instead of descending into it — Message.walk() is
    # unreliable across nested message boundaries (get_payload(decode=True) is
    # None for message/* parts and the inner tree leaks into the outer body).
    def _iter(part):
        if part.get_content_type() == "message/rfc822":
            yield part
            return
        if part.is_multipart():
            for sub in part.iter_parts():
                yield from _iter(sub)
        else:
            yield part

    for part in _iter(msg):
        ctype = (part.get_content_type() or "").lower()
        cd = part.get("Content-Disposition") or ""
        filename = part.get_filename() or ""

        # Nested email → grab its raw bytes so extract_email_file can recurse.
        if ctype == "message/rfc822":
            try:
                inner = part.get_content()  # contained Message
                sub_bytes = inner.as_bytes()
            except Exception:
                continue
            attachments.append({
                "filename": filename or f"forwarded-{len(attachments)+1}.eml",
                "mime": "message/rfc822", "bytes": sub_bytes,
            })
            continue

        if "attachment" in cd.lower() or filename:
            payload = part.get_payload(decode=True)
            if not payload or not _is_parser_attachment(filename, ctype):
                continue
            attachments.append({"filename": filename or f"attachment-{len(attachments)+1}",
                                "mime": ctype, "bytes": payload})
            continue
        # Body parts (no filename, not attachment)
        if ctype == "text/plain" and not body_text:
            try: body_text = part.get_content()
            except Exception:
                pl = part.get_payload(decode=True) or b""
                body_text = pl.decode(part.get_content_charset() or "utf-8", errors="replace")
        elif ctype == "text/html" and not body_html:
            try: body_html = part.get_content()
            except Exception:
                pl = part.get_payload(decode=True) or b""
                body_html = pl.decode(part.get_content_charset() or "utf-8", errors="replace")

    body = body_text.strip() or _html_to_text(body_html)
    return {
        "body": body,
        "subject": str(msg.get("Subject") or ""),
        "from": str(msg.get("From") or ""),
        "attachments": attachments,
    }


def extract_msg(raw: bytes) -> Dict[str, Any]:
    """Outlook .msg file. Uses extract-msg library.

    Notes on Outlook quirks (verified 2026-06-01):
    - `m.body` is often None when the message only has an HTML body. We fall
      back to `m.htmlBody` and strip tags.
    - Attachment filenames come back with a trailing NULL byte (\\x00). Must
      strip before doing extension checks or whitelist lookup.
    - Outlook auto-generates inline images named `imageNNN.png` for sig logos
      and inline embeds. We filter those out — they're noise to the parser.
    """
    import extract_msg as em
    m = em.openMsg(io.BytesIO(raw))
    attachments: List[Dict[str, Any]] = []
    for att in (m.attachments or []):
        fname_raw = (getattr(att, "longFilename", None) or
                     getattr(att, "shortFilename", None) or "")
        if isinstance(fname_raw, bytes):
            fname_raw = fname_raw.decode("utf-8", errors="replace")
        # Strip trailing NULLs + whitespace (extract-msg leaves \x00 terminators)
        fname = str(fname_raw).strip("\x00").strip()

        payload = getattr(att, "data", None) or b""
        if isinstance(payload, str):
            payload = payload.encode("utf-8", errors="replace")
        if not payload:
            continue

        # Skip Outlook inline auto-embeds (image001.png, image002.gif, etc).
        # These are signature logos / inline embeds, not user attachments.
        if re.match(r"^image\d+\.(png|gif|jpe?g|bmp)$", fname, re.I):
            continue

        # Sniff MIME from extension (Outlook's mimetype attr is unreliable)
        ext = "." + fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        mime_map = {
            ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
            ".heic": "image/heic", ".heif": "image/heif",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".doc": "application/msword",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xls": "application/vnd.ms-excel",
            ".csv": "text/csv", ".tsv": "text/tab-separated-values",
            ".rtf": "application/rtf", ".txt": "text/plain",
            ".eml": "message/rfc822", ".msg": "application/vnd.ms-outlook",
        }
        mime = mime_map.get(ext, "application/octet-stream")
        if not _is_parser_attachment(fname, mime):
            continue
        attachments.append({"filename": fname, "mime": mime, "bytes": payload})

    # Body: prefer plain, fall back to html→text
    body_raw = getattr(m, "body", None)
    if isinstance(body_raw, bytes):
        body_raw = body_raw.decode("utf-8", errors="replace")
    body = (body_raw or "").strip()
    if not body and getattr(m, "htmlBody", None):
        html = m.htmlBody
        if isinstance(html, bytes):
            html = html.decode("utf-8", errors="replace")
        body = _html_to_text(html)

    return {
        "body": body,
        "subject": str(getattr(m, "subject", "") or "").strip("\x00").strip(),
        "from": str(getattr(m, "sender", "") or "").strip("\x00").strip(),
        "attachments": attachments,
    }


def _extract_one(filename: str, raw: bytes) -> Dict[str, Any]:
    """Dispatch a single email blob on extension (no recursion)."""
    name_lower = (filename or "").lower()
    if name_lower.endswith(".msg"):
        return extract_msg(raw)
    return extract_eml(raw)  # .eml or unknown → MIME parser


def extract_email_file(filename: str, raw: bytes, recursive: bool = False,
                       _depth: int = 0) -> Dict[str, Any]:
    """Extract an email file's body + attachments.

    When `recursive=True` (parser path), any attachment that is itself an email
    (.eml / .msg — e.g. a forwarded RFQ inside another email) is expanded in
    place: its subject/from/body are appended to the parent body text, its
    non-email attachments are flattened into the parent attachment list, and
    the email wrapper itself is dropped (so the parser never receives raw MIME).
    Depth-capped at MAX_EMAIL_DEPTH to guard against mail-bomb loops.

    When `recursive=False` (preview path), attachments are returned as-is so
    the UI can render a nested email as a clickable attachment.
    """
    ext = _extract_one(filename, raw)
    if not recursive or _depth >= MAX_EMAIL_DEPTH:
        return ext

    flat_attachments: List[Dict[str, Any]] = []
    body_parts: List[str] = [ext.get("body") or ""]
    for att in ext.get("attachments", []):
        a_name = att.get("filename") or ""
        a_mime = att.get("mime") or ""
        a_bytes = att.get("bytes") or b""
        if _is_email_attachment(a_name, a_mime):
            # Recurse into the nested email and merge its contents upward.
            try:
                nested = extract_email_file(a_name, a_bytes, recursive=True,
                                            _depth=_depth + 1)
            except Exception as e:  # don't let one bad nested email kill the parse
                flat_attachments.append(att)  # keep the raw blob as a fallback
                body_parts.append(f"\n[Could not expand nested email '{a_name}': {e}]")
                continue
            header = []
            if nested.get("subject"): header.append(f"SUBJECT: {nested['subject']}")
            if nested.get("from"):    header.append(f"FROM: {nested['from']}")
            block = "\n".join(header + ([nested["body"]] if nested.get("body") else []))
            body_parts.append(
                f"\n\n──── FORWARDED EMAIL ({a_name}) ────\n{block}")
            flat_attachments.extend(nested.get("attachments", []))
        else:
            flat_attachments.append(att)

    ext["body"] = "\n".join(p for p in body_parts if p).strip()
    ext["attachments"] = flat_attachments
    return ext
