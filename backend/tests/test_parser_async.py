"""Async parser job lifecycle tests (iter49).

Covers the new POST /api/parser/parse-rfq-async + GET /api/parser/jobs/{id}
polling pattern that replaced the synchronous 120s Anthropic call. Also
exercises the legacy sync endpoint to make sure backwards compat is intact
and verifies the 400 path when nothing is submitted.
"""
import os
import time
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASSWORD = "spot-admin-2026"

RFQ_TEXT = "100 corrugated boxes 12x10x8 kraft qty 500 customer ACME"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, f"no access_token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ─── Async submit returns 202 + job_id ────────────────────────────────────
def test_parse_rfq_async_returns_202(auth_headers):
    files = {"files": ("rfq.txt", io.BytesIO(RFQ_TEXT.encode()), "text/plain")}
    r = requests.post(
        f"{BASE_URL}/api/parser/parse-rfq-async",
        headers=auth_headers, files=files, timeout=30,
    )
    assert r.status_code == 202, f"expected 202, got {r.status_code}: {r.text}"
    body = r.json()
    assert "job_id" in body and isinstance(body["job_id"], str) and len(body["job_id"]) > 0
    assert body.get("status") == "pending"
    assert isinstance(body.get("files"), list) and len(body["files"]) >= 1
    assert "persistedFiles" in body


# ─── Poll job until done, verify result shape ─────────────────────────────
def test_async_job_completes_with_expected_shape(auth_headers):
    files = {"files": ("rfq2.txt", io.BytesIO(RFQ_TEXT.encode()), "text/plain")}
    r = requests.post(
        f"{BASE_URL}/api/parser/parse-rfq-async",
        headers=auth_headers, files=files, timeout=30,
    )
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    deadline = time.time() + 90  # generous for Anthropic
    final = None
    saw_pending = False
    while time.time() < deadline:
        time.sleep(3)
        g = requests.get(
            f"{BASE_URL}/api/parser/jobs/{job_id}",
            headers=auth_headers, timeout=15,
        )
        assert g.status_code == 200, f"poll failed: {g.status_code} {g.text}"
        doc = g.json()
        status = doc.get("status")
        if status == "pending":
            saw_pending = True
            continue
        if status in ("done", "error"):
            final = doc
            break

    assert final is not None, "job did not finish within 90s"
    assert final["status"] == "done", f"job errored: {final}"
    result = final.get("result")
    assert isinstance(result, dict), f"result missing: {final}"
    for k in ("parsed", "sources", "method", "asks", "confidence", "files", "persistedFiles"):
        assert k in result, f"result missing key '{k}': keys={list(result.keys())}"
    # saw_pending may legitimately be False if Anthropic was very fast; just
    # log it. Either way the lifecycle terminated correctly.
    print(f"job {job_id} done, saw_pending={saw_pending}, method={result.get('method')}, conf={result.get('confidence')}")


# ─── Unknown job id → 404 ─────────────────────────────────────────────────
def test_get_unknown_job_returns_404(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/parser/jobs/does-not-exist-xyz",
        headers=auth_headers, timeout=10,
    )
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


# ─── Empty submit → 400 (async endpoint) ──────────────────────────────────
def test_async_empty_submit_returns_400(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/parser/parse-rfq-async",
        headers=auth_headers, data={}, timeout=15,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ─── Legacy sync endpoint still works + shape parity ──────────────────────
def test_legacy_sync_parse_still_works(auth_headers):
    files = {"files": ("rfq_sync.txt", io.BytesIO(RFQ_TEXT.encode()), "text/plain")}
    r = requests.post(
        f"{BASE_URL}/api/parser/parse-rfq",
        headers=auth_headers, files=files, timeout=120,
    )
    assert r.status_code == 200, f"sync parse failed: {r.status_code} {r.text[:500]}"
    body = r.json()
    for k in ("parsed", "sources", "method", "asks", "confidence", "files", "persistedFiles"):
        assert k in body, f"sync result missing '{k}': keys={list(body.keys())}"


# ─── Empty submit on sync endpoint → 400 (backwards-compat for the rule) ──
def test_sync_empty_submit_returns_400(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/parser/parse-rfq",
        headers=auth_headers, data={}, timeout=15,
    )
    assert r.status_code == 400
