"""Smoke test for /api/parser/files/{id}/attachment/{idx}/preview.

Builds a synthetic .eml with a PDF + text attachment, runs them through the
shared `_build_preview_payload` (same code path the endpoint uses), and
verifies each kind comes back correctly.
"""
import base64
import email
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from routes.parser import _build_preview_payload
from utils.email_extract import extract_email_file


def _build_test_eml() -> bytes:
    msg = MIMEMultipart()
    msg["Subject"] = "Test RFQ"
    msg["From"] = "tester@example.com"
    msg.attach(MIMEText("Please quote the attached CAD.", "plain"))
    # Minimal valid PDF — 1-page empty doc
    pdf_bytes = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
        b"0000000058 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n170\n%%EOF\n"
    )
    pdf = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf.add_header("Content-Disposition", "attachment", filename="quote.pdf")
    msg.attach(pdf)
    txt = MIMEApplication(b"qty,1000,2500,5000\n", _subtype="csv")
    txt.add_header("Content-Disposition", "attachment", filename="specs.csv")
    msg.attach(txt)
    return msg.as_bytes()


def test_eml_attachments_extracted():
    raw = _build_test_eml()
    extracted = extract_email_file("test.eml", raw)
    assert extracted["subject"] == "Test RFQ"
    atts = extracted["attachments"]
    names = sorted(a["filename"] for a in atts)
    assert names == ["quote.pdf", "specs.csv"]


def test_preview_payload_pdf_attachment():
    raw = _build_test_eml()
    extracted = extract_email_file("test.eml", raw)
    pdf = next(a for a in extracted["attachments"] if a["filename"] == "quote.pdf")
    out = _build_preview_payload(pdf["filename"], pdf["mime"], pdf["bytes"])
    assert out["kind"] == "pdf"
    assert out["filename"] == "quote.pdf"
    # data should be base64 of original pdf bytes
    assert base64.b64decode(out["data"]) == pdf["bytes"]


def test_preview_payload_csv_attachment():
    raw = _build_test_eml()
    extracted = extract_email_file("test.eml", raw)
    csv = next(a for a in extracted["attachments"] if a["filename"] == "specs.csv")
    out = _build_preview_payload(csv["filename"], csv["mime"], csv["bytes"])
    # csv is a text-like kind
    assert out["kind"] == "text"
    assert "1000" in out["data"]


def test_preview_payload_unknown_kind_falls_back_to_binary():
    out = _build_preview_payload("weird.xyz", "application/octet-stream", b"\x00\x01\x02")
    assert out["kind"] == "binary"
