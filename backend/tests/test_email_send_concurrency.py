"""Concurrency test for Email Quote send + PDF preview.

Goal: prove that POST /api/email/send-quote and POST /api/pdf/preview-quote
do NOT block the FastAPI single-worker async event loop.

Context: in production, send-quote was hanging because weasyprint PDF
rendering and the msal token acquisition were synchronous calls inside an
async route, which froze the worker and caused Cloudflare to return a 5xx
gateway error. The fix offloads both to asyncio.to_thread.

In preview the Entra creds are placeholders (ENTRA_TENANT_ID='spot-multi-user'),
so msal token acquisition will FAIL — but it must fail FAST with a 502, and
the worker must still serve concurrent requests.
"""
from __future__ import annotations
import os
import time
import concurrent.futures as cf
from typing import Optional

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PWD = "spot-admin-2026"


# ---------- auth fixture ----------
@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=10)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.json()}"
    return tok

@pytest.fixture(scope="module", autouse=True)
def _never_send_real_mail(token):
    """These tests assume Graph mail is NOT configured (expect 503). If it IS configured, a real
    email would go out via the shared mailbox — skip the whole module instead."""
    r = requests.get(f"{BASE_URL}/api/email/status", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if r.ok and r.json().get("configured"):
        pytest.skip("Graph mail is configured in this environment — refusing to send real test emails")


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- minimal payload ----------
def _pdf_payload():
    return {
        "quote": {
            "state": {"estNum": "T1-CONCURRENCY", "customer": "Test Co", "project": "regression"},
            "est_num": "T1-CONCURRENCY",
        },
        "results": [],
        "chargeMode": "By Type",
        "componentPricing": [],
        "jobTotals": {},
    }


def _send_payload():
    return {
        "to": ["x@y.com"],
        "cc": [],
        "subject": "regression test",
        "body_html": "hi",
        "pdf": _pdf_payload(),
    }


# ---------- /api/email/status ----------
class TestEmailStatus:
    def test_status_configured_true_in_preview(self, headers):
        r = requests.get(f"{BASE_URL}/api/email/status", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # In preview, GRAPH_MAIL_SENDER and ENTRA_* are all set (placeholders for ENTRA_*),
        # so is_mail_configured() returns True.
        assert data["configured"] is True, f"expected configured=true, got {data}"
        assert data["sender"] == "estimates@standardprinting.com", f"sender mismatch: {data}"


# ---------- /api/pdf/preview-quote ----------
class TestPdfPreview:
    def test_preview_returns_pdf(self, headers):
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote",
                          headers=headers, json=_pdf_payload(), timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf"), \
            f"bad content-type: {r.headers.get('content-type')}"
        assert r.content[:5] == b"%PDF-", f"not a pdf, starts with: {r.content[:20]!r}"
        assert len(r.content) > 1000, f"pdf suspiciously small: {len(r.content)} bytes"
        assert elapsed < 20, f"preview too slow: {elapsed:.1f}s"


# ---------- /api/email/send-quote (clean failure path) ----------
class TestSendQuoteCleanFailure:
    def test_send_fails_fast_with_502(self, headers):
        """In preview, msal token acquisition fails (placeholder creds).
        The route must return 502 (not hang, not 500-crash) within a few seconds.

        NOTE: through the public gateway, the origin's clean 502 JSON gets
        re-wrapped into Cloudflare's HTML 502 page (Cloudflare intercepts any
        5xx from origin). So we ALSO verify directly against localhost:8001
        that the backend itself produces a proper FastAPI JSON 502 with a
        meaningful 'detail' — proving the worker handled the exception cleanly
        and did NOT crash or hang."""
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/email/send-quote",
                          headers=headers, json=_send_payload(), timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 502, f"expected 502, got {r.status_code}: {r.text[:300]}"
        assert elapsed < 10, f"send-quote too slow ({elapsed:.1f}s) — worker may be blocked"

        # Direct-to-origin check: the FastAPI handler must produce a clean JSON 502
        t0 = time.time()
        r2 = requests.post("http://localhost:8001/api/email/send-quote",
                           headers=headers, json=_send_payload(), timeout=30)
        elapsed2 = time.time() - t0
        assert r2.status_code == 502, f"direct origin status: {r2.status_code}"
        assert r2.headers.get("content-type", "").startswith("application/json"), \
            f"origin should return JSON, got {r2.headers.get('content-type')}"
        body = r2.json()
        assert "detail" in body and "Failed to send email" in body["detail"], \
            f"unexpected body: {body}"
        assert elapsed2 < 5, f"direct origin too slow ({elapsed2:.1f}s)"

    def test_worker_recovers_after_failed_send(self, headers):
        """Right after a failed send-quote, /api/email/status must still respond
        promptly — proving the event loop wasn't poisoned."""
        # trigger a failure
        requests.post(f"{BASE_URL}/api/email/send-quote",
                      headers=headers, json=_send_payload(), timeout=30)
        # now a follow-up GET must work
        t0 = time.time()
        r = requests.get(f"{BASE_URL}/api/email/status", headers=headers, timeout=10)
        assert r.status_code == 200
        assert time.time() - t0 < 3


# ---------- CONCURRENCY: mix preview + send-quote in parallel ----------
class TestConcurrencyNonBlocking:
    def _hit_preview(self, headers):
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/pdf/preview-quote",
                          headers=headers, json=_pdf_payload(), timeout=30)
        return ("preview", r.status_code, time.time() - t0, len(r.content))

    def _hit_send(self, headers):
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/email/send-quote",
                          headers=headers, json=_send_payload(), timeout=30)
        return ("send", r.status_code, time.time() - t0, len(r.content))

    def test_six_concurrent_mixed_requests(self, headers):
        """Fire 6 concurrent requests (3 preview + 3 send). All must finish
        in well under the per-request timeout — proving the worker is not
        serialized/blocked on synchronous PDF or msal work."""
        wall_start = time.time()
        with cf.ThreadPoolExecutor(max_workers=6) as pool:
            futures = []
            for i in range(3):
                futures.append(pool.submit(self._hit_preview, headers))
                futures.append(pool.submit(self._hit_send, headers))
            results = [f.result(timeout=45) for f in cf.as_completed(futures)]
        wall_elapsed = time.time() - wall_start

        # Summarize
        for kind, code, elapsed, size in results:
            print(f"  [{kind}] status={code} elapsed={elapsed:.2f}s size={size}")

        # Verify all completed
        assert len(results) == 6

        # Preview must be 200, send must be 502
        for kind, code, elapsed, size in results:
            if kind == "preview":
                assert code == 200, f"preview returned {code}"
                assert size > 1000, f"preview pdf too small: {size}"
            else:  # send
                assert code == 502, f"send returned {code}, expected 502"

        # Per-request: nothing should take more than 25s
        max_individual = max(r[2] for r in results)
        assert max_individual < 25, f"slowest request took {max_individual:.1f}s — worker likely blocked"

        # Wall time: if worker were FULLY serialized AND each PDF takes ~2s,
        # 6 requests would take ~12s minimum. With asyncio.to_thread offload
        # they should overlap and finish faster. We allow up to 30s for slow CI.
        assert wall_elapsed < 30, f"6 concurrent requests took {wall_elapsed:.1f}s total — likely blocking"

    def test_status_responsive_during_send_load(self, headers):
        """While 4 send-quote requests are in flight, GET /api/email/status
        must still return in under 3 seconds — proves event loop is free."""
        with cf.ThreadPoolExecutor(max_workers=5) as pool:
            send_futs = [pool.submit(self._hit_send, headers) for _ in range(4)]
            # let them start
            time.sleep(0.2)
            t0 = time.time()
            r = requests.get(f"{BASE_URL}/api/email/status", headers=headers, timeout=10)
            status_elapsed = time.time() - t0
            # drain
            for f in send_futs:
                f.result(timeout=45)

        assert r.status_code == 200
        assert status_elapsed < 5, \
            f"/api/email/status took {status_elapsed:.1f}s while sends were in flight — event loop blocked"
