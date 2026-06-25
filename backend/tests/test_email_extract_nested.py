"""Backend tests for nested-email extraction + saved RFQ file API.

Covers:
1) utils.email_extract.extract_email_file recursion (UNIT — no LLM):
   - recursive=True flattens nested .eml's attachments, appends FORWARDED block
   - recursive=False keeps the nested .eml as a single attachment
2) /api/parser/files endpoints for an admin saved quote (preview + download).
"""
from __future__ import annotations
import base64
import os
import sys
from email.message import EmailMessage

import pytest
import requests

# Make backend importable
sys.path.insert(0, "/app/backend")

from utils.email_extract import extract_email_file  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-estimator.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PW = "spot-admin-2026"
ADMIN_QUOTE_ID = "5d32e0cd-1e8b-4eb2-8a56-885ded2d6f6d"  # est SA-260622-140401


# ---------------- helpers ---------------- #

def _build_nested_eml() -> bytes:
    """Outer multipart/mixed email holding a message/rfc822 attachment whose
    inner body is text/plain 'Qty 500, 1000, 2500' and a base64 PDF 'part.pdf'.
    """
    # Inner email
    inner = EmailMessage()
    inner["Subject"] = "Inner RFQ for SPOT"
    inner["From"] = "buyer@example.com"
    inner["To"] = "sales@standardprinting.com"
    inner.set_content("Qty 500, 1000, 2500\nNeed quote ASAP.")
    pdf_bytes = b"%PDF-1.4\n%FAKE TEST PDF\n%%EOF"
    inner.add_attachment(
        pdf_bytes, maintype="application", subtype="pdf", filename="part.pdf"
    )

    # Outer email with the inner attached as message/rfc822
    outer = EmailMessage()
    outer["Subject"] = "FW: Inner RFQ for SPOT"
    outer["From"] = "forwarder@example.com"
    outer["To"] = "sales@standardprinting.com"
    outer.set_content("FYI — see attached original.")
    outer.add_attachment(
        inner, filename="Original RFQ.eml"  # message/rfc822 attachment
    )
    # Force base64 transfer-encoding on the PDF leaf (already default for binary)
    return outer.as_bytes()


# ---------------- 1) Unit tests for extract_email_file ---------------- #

class TestNestedEmailRecursion:
    def test_recursive_true_flattens_and_appends_forwarded_block(self):
        raw = _build_nested_eml()
        out = extract_email_file("outer.eml", raw, recursive=True)

        # Attachments flattened: must contain part.pdf, NO message/rfc822 wrapper
        names = [a["filename"] for a in out["attachments"]]
        mimes = [a["mime"] for a in out["attachments"]]
        assert "part.pdf" in names, f"expected flattened part.pdf, got {names}"
        assert "message/rfc822" not in mimes, (
            "nested eml wrapper should be dropped on recursive=True"
        )
        pdf_att = next(a for a in out["attachments"] if a["filename"] == "part.pdf")
        assert pdf_att["mime"] == "application/pdf"
        assert pdf_att["bytes"].startswith(b"%PDF"), "pdf bytes preserved"

        # Body has the FORWARDED marker + inner subject/from + qty line
        body = out["body"]
        assert "FORWARDED EMAIL" in body, body[:300]
        assert "Inner RFQ for SPOT" in body
        assert "buyer@example.com" in body
        assert "Qty 500, 1000, 2500" in body

    def test_recursive_false_keeps_nested_email_as_attachment(self):
        raw = _build_nested_eml()
        out = extract_email_file("outer.eml", raw, recursive=False)

        # Single nested email attachment (preview path)
        names = [a["filename"] for a in out["attachments"]]
        mimes = [a["mime"] for a in out["attachments"]]
        assert "Original RFQ.eml" in names, names
        assert "message/rfc822" in mimes, mimes
        # part.pdf must NOT be flattened up here
        assert "part.pdf" not in names, (
            "preview path must keep nested eml whole, not flatten its PDF"
        )

        # Outer body present
        assert "FYI" in out["body"]
        assert out["subject"].startswith("FW:")


# ---------------- 2) API tests on saved quote files ---------------- #

@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


class TestSavedRFQFilesAPI:
    def test_list_files_for_admin_quote(self, admin_session):
        r = admin_session.get(
            f"{BASE_URL}/api/parser/files",
            params={"quote_id": ADMIN_QUOTE_ID}, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        data = r.json()
        # Accept both {files:[...]} or [...] shapes
        files = data.get("files") if isinstance(data, dict) else data
        assert isinstance(files, list) and len(files) >= 1, (
            f"expected ≥1 saved file on quote {ADMIN_QUOTE_ID}, got {data}"
        )
        # Pick first file id for downstream tests
        fid = files[0].get("id") or files[0].get("_id") or files[0].get("file_id")
        assert fid, f"no file id field in {files[0]}"
        pytest.first_file_id = fid
        pytest.first_file_meta = files[0]

    def test_preview_returns_payload(self, admin_session):
        fid = getattr(pytest, "first_file_id", None)
        if not fid:
            pytest.skip("file id unavailable (list test failed)")
        r = admin_session.get(
            f"{BASE_URL}/api/parser/files/{fid}/preview", timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        # Either JSON {kind:..., ...} or binary inline preview
        ctype = r.headers.get("content-type", "")
        if "application/json" in ctype:
            j = r.json()
            assert j, "empty preview JSON"
            kind = j.get("kind") or j.get("type")
            assert kind, f"preview JSON missing kind: {j}"
        else:
            assert len(r.content) > 0, "empty preview payload"

    def test_download_returns_bytes(self, admin_session):
        fid = getattr(pytest, "first_file_id", None)
        if not fid:
            pytest.skip("file id unavailable (list test failed)")
        r = admin_session.get(
            f"{BASE_URL}/api/parser/files/{fid}/download", timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert len(r.content) > 0, "download body empty"
