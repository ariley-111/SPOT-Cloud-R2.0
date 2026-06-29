"""Iteration 63 — Quote status validation + sent_at stamping (Draft/Saved/Sent only)."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend .env if env-var isn't exported into this shell
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PW = "spot-admin-2026"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"no token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture
def created_quotes():
    ids = []
    yield ids
    # teardown — cleanup test quotes
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    token = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    for qid in ids:
        try:
            s.delete(f"{BASE_URL}/api/quotes/{qid}", timeout=10)
        except Exception:
            pass


# ─── Status validation ─────────────────────────────────────────────────
def test_patch_status_rejects_invalid_status(session, created_quotes):
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_REJECT", "customer_name": "TEST_Reject",
        "state": {}, "status": "draft",
    })
    assert r.status_code == 200, r.text
    qid = r.json()["id"]
    created_quotes.append(qid)
    for bad in ["won", "lost", "hold", "foo"]:
        rr = session.patch(f"{BASE_URL}/api/quotes/{qid}/status", json={"status": bad})
        assert rr.status_code == 400, f"{bad} should be rejected: {rr.status_code} {rr.text}"


def test_patch_status_accepts_valid_statuses(session, created_quotes):
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_ACCEPT", "customer_name": "TEST_Accept",
        "state": {}, "status": "draft",
    })
    qid = r.json()["id"]
    created_quotes.append(qid)
    for ok in ["draft", "saved", "sent"]:
        rr = session.patch(f"{BASE_URL}/api/quotes/{qid}/status", json={"status": ok})
        assert rr.status_code == 200, f"{ok} should be accepted: {rr.text}"
        assert rr.json()["status"] == ok


# ─── sent_at stamping ───────────────────────────────────────────────────
def test_sent_at_stamped_on_first_sent_transition(session, created_quotes):
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_STAMP", "customer_name": "TEST_Stamp",
        "state": {}, "status": "draft",
    })
    q = r.json()
    qid = q["id"]
    created_quotes.append(qid)
    # Initially no sent_at
    assert q.get("sent_at") in (None, ""), f"draft should not have sent_at: {q.get('sent_at')}"

    # transition → sent stamps sent_at
    rr = session.patch(f"{BASE_URL}/api/quotes/{qid}/status", json={"status": "sent"})
    assert rr.status_code == 200, rr.text
    first_sent_at = rr.json().get("sent_at")
    assert first_sent_at, f"sent_at should be stamped: {rr.json()}"

    # Subsequent PATCH back to saved should NOT clear sent_at; then re-sent should preserve it
    time.sleep(1.1)
    session.patch(f"{BASE_URL}/api/quotes/{qid}/status", json={"status": "saved"})
    rr2 = session.patch(f"{BASE_URL}/api/quotes/{qid}/status", json={"status": "sent"})
    assert rr2.status_code == 200
    assert rr2.json().get("sent_at") == first_sent_at, \
        f"sent_at should be preserved on re-send: was {first_sent_at}, now {rr2.json().get('sent_at')}"


def test_post_quote_with_status_sent_returns_sent_at(session, created_quotes):
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_POST_SENT", "customer_name": "TEST_PostSent",
        "state": {}, "status": "sent",
    })
    assert r.status_code == 200, r.text
    q = r.json()
    created_quotes.append(q["id"])
    assert q.get("sent_at"), f"POST status=sent should stamp sent_at: {q}"
    assert q.get("created_at"), "created_at should be set"
    assert q.get("status") == "sent"


# ─── GET list returns created_at / sent_at ────────────────────────────
def test_list_quotes_returns_created_and_sent_at(session, created_quotes):
    # Create a sent quote
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_LIST", "customer_name": "TEST_List",
        "state": {}, "status": "sent",
    })
    qid = r.json()["id"]
    created_quotes.append(qid)
    rr = session.get(f"{BASE_URL}/api/quotes?scope=mine&limit=200")
    assert rr.status_code == 200
    rows = rr.json()
    found = next((x for x in rows if x["id"] == qid), None)
    assert found, "newly created quote should appear in list"
    assert "created_at" in found and found["created_at"], "list row needs created_at"
    assert "sent_at" in found and found["sent_at"], "sent row needs sent_at"


# ─── PUT keeps sent_at preserved ───────────────────────────────────────
def test_put_preserves_sent_at(session, created_quotes):
    r = session.post(f"{BASE_URL}/api/quotes", json={
        "est_num": "TEST_IT63_PUT", "customer_name": "TEST_Put",
        "state": {}, "status": "sent",
    })
    q = r.json()
    qid = q["id"]
    created_quotes.append(qid)
    first_sent_at = q["sent_at"]
    time.sleep(1.1)
    # PUT with status=sent should NOT update sent_at
    rr = session.put(f"{BASE_URL}/api/quotes/{qid}", json={
        "est_num": "TEST_IT63_PUT", "customer_name": "TEST_Put_v2",
        "state": {}, "status": "sent",
    })
    assert rr.status_code == 200, rr.text
    assert rr.json().get("sent_at") == first_sent_at, \
        "PUT should preserve original sent_at"
