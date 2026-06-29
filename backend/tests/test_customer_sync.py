"""Customer sync (Ignition push) endpoint tests."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://spot-estimator.preview.emergentagent.com").rstrip("/")
IGN_KEY = "spot_ign_VBEY4wqvt4s-WfKfWFfKNHZ3ilpLb4CtJzKMcMMW3NhGs0oDTnyzGQ"
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PW = "spot-admin-2026"

SAMPLE = [
    {
        "cust_code": "TEST_IGN001", "cust_name": "Acme Test Co.",
        "csr_name": "Jane CSR", "csr_email_address": "jane@acme.test",
        "sales_agent_name": "Bob Sales", "sales_agent_email_address": "bob@acme.test",
        "oncredithold": "N", "credit_limit": "10000",
        "city": "Cleveland", "state": "OH", "zip": "44101",
    },
    {
        "cust_code": "TEST_IGN002", "cust_name": "Beta Print LLC",
        "csr_name": "Sam CSR", "csr_email_address": "sam@beta.test",
        "sales_agent_name": "Alice Sales", "sales_agent_email_address": "alice@beta.test",
        "oncredithold": "N", "credit_limit": "5000",
        "city": "Akron", "state": "OH", "zip": "44301",
    },
    {
        "cust_code": "TEST_IGN003", "cust_name": "Gamma Boxes",
        "csr_name": "Pat CSR", "csr_email_address": "pat@gamma.test",
        "sales_agent_name": "", "sales_agent_email_address": "",
        "oncredithold": "Y", "credit_limit": "0",
        "city": "Toledo", "state": "OH", "zip": "43601",
    },
]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token")


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_sync_wrong_key_401():
    r = requests.post(f"{BASE_URL}/api/customers/sync",
                      headers={"Authorization": "Bearer wrong-key"},
                      json=SAMPLE, timeout=20)
    assert r.status_code == 401, r.text


def test_sync_empty_array_400():
    r = requests.post(f"{BASE_URL}/api/customers/sync",
                      headers={"Authorization": f"Bearer {IGN_KEY}"},
                      json=[], timeout=20)
    assert r.status_code == 400, r.text


def test_sync_ok_and_field_mapping(admin_token):
    r = requests.post(f"{BASE_URL}/api/customers/sync",
                      headers={"Authorization": f"Bearer {IGN_KEY}"},
                      json=SAMPLE, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "ok"
    assert body.get("rows_loaded") == 3
    assert body.get("source") == "ignition"

    # Status endpoint requires user JWT
    s = requests.get(f"{BASE_URL}/api/customers/sync/status",
                     headers=_auth(admin_token), timeout=20)
    assert s.status_code == 200, s.text
    sb = s.json()
    assert sb["total"] == 3
    assert sb["last_sync"]["rows"] == 3
    assert sb["last_sync"]["source"] == "ignition"
    assert sb["last_sync"].get("ts")

    # Field mapping for one record
    g = requests.get(f"{BASE_URL}/api/customers/TEST_IGN001",
                     headers=_auth(admin_token), timeout=20)
    assert g.status_code == 200, g.text
    c = g.json()
    assert c["name"] == "Acme Test Co."
    assert c["csr"] == "Jane CSR"
    assert c["csr_email"] == "jane@acme.test"
    assert c["salesperson"] == "Bob Sales"
    assert c["salesperson_email"] == "bob@acme.test"
    assert c["city"] == "Cleveland"
    assert c["state"] == "OH"
    assert c["zip"] == "44101"


def test_negative_does_not_wipe(admin_token):
    """After the prior tests, list has 3 rows. A failed push (401/400) must not wipe it."""
    requests.post(f"{BASE_URL}/api/customers/sync",
                  headers={"Authorization": "Bearer bad"}, json=SAMPLE, timeout=20)
    requests.post(f"{BASE_URL}/api/customers/sync",
                  headers={"Authorization": f"Bearer {IGN_KEY}"}, json=[], timeout=20)
    s = requests.get(f"{BASE_URL}/api/customers/sync/status",
                     headers=_auth(admin_token), timeout=20)
    assert s.status_code == 200
    assert s.json()["total"] >= 1
