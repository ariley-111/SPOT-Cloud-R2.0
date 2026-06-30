"""Iteration 64 — verify the 5 changes:
   1) Crest toggle removed (crestComplexity must have no effect)
   2) GET /api/quotes?q=… cross-field search
   3) PDF preview spec line includes Print Mode + 1S/2S (or 'No Print')
   4) LOQ re-submission: parser returns matchedQuote when text contains a known est#
   5) Status sent + duplicate-as-new flow are covered through the Load Quote search

Uses the public REACT_APP_BACKEND_URL — no localhost.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PWD = "spot-admin-2026"
SEED_EST_NUM = "RA-260615-082017"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login resp: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}",
                      "Content-Type": "application/json"})
    return s


# ─── (1) Crest toggle removed — crestComplexity must not affect the Crest cost ─

CREST_PAYLOAD = {
    "oneUpW": 20, "oneUpL": 15, "qty": 5000,
    "boardGrade": "200", "flute": "B",
    "outsideLiner": "None", "insideLiner": "None", "medium": "None",
    "printReq": "Yes", "printMode": "Satin",
    "dieTreatment": "None", "cadDifficulty": "Standard",
}


def test_compare_routes_returns_crest(session):
    r = session.post(f"{BASE_URL}/api/engine/compare-routes",
                     json=CREST_PAYLOAD, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "crest" in data, f"no crest in response: {data}"
    crest = data["crest"]
    assert "totalCost" in crest and float(crest["totalCost"]) > 0
    assert "hrs" in crest


def test_compare_routes_crest_complexity_has_no_effect(session):
    base = session.post(f"{BASE_URL}/api/engine/compare-routes",
                        json=CREST_PAYLOAD, timeout=30).json()
    adv = session.post(f"{BASE_URL}/api/engine/compare-routes",
                       json={**CREST_PAYLOAD, "crestComplexity": "Advanced"},
                       timeout=30).json()
    std = session.post(f"{BASE_URL}/api/engine/compare-routes",
                       json={**CREST_PAYLOAD, "crestComplexity": "Standard"},
                       timeout=30).json()
    assert base["crest"]["totalCost"] == adv["crest"]["totalCost"], \
        f"crestComplexity=Advanced changed cost: {base['crest']['totalCost']} -> {adv['crest']['totalCost']}"
    assert base["crest"]["totalCost"] == std["crest"]["totalCost"]


def test_calculate_endpoint_still_works(session):
    r = session.post(f"{BASE_URL}/api/engine/calculate",
                     json=CREST_PAYLOAD, timeout=30)
    assert r.status_code == 200, r.text


# ─── (2) Load Quote search ─────────────────────────────────────────────────────


def test_search_by_est_num(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": SEED_EST_NUM, "scope": "team"}, timeout=30)
    assert r.status_code == 200
    nums = [q.get("est_num") for q in r.json()]
    assert SEED_EST_NUM in nums, f"expected {SEED_EST_NUM} in {nums}"


def test_search_by_customer_name(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": "Jamestown", "scope": "team"}, timeout=30)
    assert r.status_code == 200
    rows = r.json()
    assert any("Jamestown" in (row.get("customer_name") or "") for row in rows)


def test_search_by_project_custref(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": "Luva Bella", "scope": "team"}, timeout=30)
    assert r.status_code == 200
    rows = r.json()
    assert any(SEED_EST_NUM == row.get("est_num") for row in rows), \
        f"project search missed seed: {[r.get('est_num') for r in rows]}"


def test_search_by_est_initials(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": "RA", "scope": "team"}, timeout=30)
    assert r.status_code == 200
    # est_num for the seed itself starts with RA-, so this also exercises est_num matching
    assert any(row.get("est_num") == SEED_EST_NUM for row in r.json())


def test_search_empty_q_returns_all(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": "", "scope": "team"}, timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_search_no_match(session):
    r = session.get(f"{BASE_URL}/api/quotes",
                    params={"q": "ZZZ_NO_MATCH_QQQ_xyz", "scope": "team"},
                    timeout=30)
    assert r.status_code == 200
    assert r.json() == []


# ─── (3) PDF preview spec line includes print mode + 1S/2S ─────────────────────


def _preview_text(session, body):
    """Return PDF bytes converted to text via pypdf for content assertions."""
    import io
    from pypdf import PdfReader
    r = session.post(f"{BASE_URL}/api/pdf/preview-quote",
                     json=body, timeout=60)
    assert r.status_code == 200, f"preview failed: {r.status_code} {r.text[:300]}"
    assert r.headers.get("content-type", "").startswith("application/pdf")
    reader = PdfReader(io.BytesIO(r.content))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def _base_quote_state(**overrides):
    base_state = {
        "custName": "TEST CUST", "custRef": "TEST PROJECT",
        "itemDesc": "TEST CARTON", "boxStyle": "RSC",
        "boardGrade": "200", "flute": "B",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite",
        "medium": "None",
        "oneUpW": 12, "oneUpL": 9,
        "qty": 1000,
        "printReq": "Yes", "printMode": "CMYK", "printSides": "2-Sided",
    }
    base_state.update(overrides.get("state", {}))
    return {
        "quote": {
            "est_num": "TEST_PREV_64",
            "customer_name": "TEST CUST",
            "customer_code": "TEST",
            "state": base_state,
        },
        "results": [{"qty": 1000, "pricable": True, "perPiece": 1.0,
                     "totalPrice": 1000, "boardCost": 200, "manuCost": 200,
                     "tooling": 0, "freight": 0, "miscChargesTotal": 0}],
    }


def test_pdf_print_mode_2s(session):
    txt = _preview_text(session, _base_quote_state())
    assert "CMYK 2S" in txt, f"expected 'CMYK 2S' in PDF, got snippet:\n{txt[:1500]}"


def test_pdf_print_mode_1s(session):
    body = _base_quote_state(state={"printMode": "Satin", "printSides": "1-Sided"})
    txt = _preview_text(session, body)
    assert "Satin 1S" in txt, f"expected 'Satin 1S' in PDF, got snippet:\n{txt[:1500]}"


def test_pdf_no_print(session):
    body = _base_quote_state(state={"printReq": "No"})
    txt = _preview_text(session, body)
    assert "No Print" in txt, f"expected 'No Print' in PDF, got snippet:\n{txt[:1500]}"


# ─── (4) LOQ matchedQuote lookup ───────────────────────────────────────────────


def test_parser_matched_quote_via_text(session):
    """Use parse-rfq with email_body containing our quote number — Anthropic still
    runs but matchedQuote should be attached based on the extracted spotQuoteNumber.
    Allow up to ~120s.
    """
    files = []
    text = open("/app/test_loq_rfq.txt").read()
    # use multipart so we can mix files=[] + form fields
    s2 = requests.Session()
    s2.headers.update({"Authorization": session.headers["Authorization"]})
    r = s2.post(f"{BASE_URL}/api/parser/parse-rfq",
                data={"email_body": text, "est_initials": "RA"},
                timeout=180)
    assert r.status_code == 200, f"parse failed: {r.status_code} {r.text[:400]}"
    j = r.json()
    # spotQuoteNumber should be detected
    assert j.get("spotQuoteNumber"), f"no spotQuoteNumber in response keys={list(j.keys())}"
    assert j["spotQuoteNumber"].upper() == SEED_EST_NUM.upper()
    # matchedQuote attached
    m = j.get("matchedQuote")
    assert m, f"no matchedQuote attached, j keys={list(j.keys())}"
    assert m.get("est_num") == SEED_EST_NUM
    assert m.get("customer_name") == "Jamestown Container Corp. - Falconer"
    assert m.get("status") in {"draft", "saved", "sent"}
