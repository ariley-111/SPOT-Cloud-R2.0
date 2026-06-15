"""HTTP-level integration tests for parser_files reassign bug fix.

Bug: parser_files were orphaned when:
  - local tab id (`local-xxx`) → persisted draft id (autosave) 
  - draft id → saved quote id (createQuote)

Fix: /api/parser/files/reassign endpoint re-keys records.
"""
import os
import io
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PW = "spot-admin-2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ── reassign endpoint shape tests ──
class TestReassignEndpoint:
    def test_empty_ids_returns_zero(self, headers):
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          headers=headers,
                          json={"from_id": "", "to_id": ""}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("updated") == 0
        assert "from_id" in body and "to_id" in body

    def test_same_ids_returns_zero(self, headers):
        same = f"local-{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          headers=headers,
                          json={"from_id": same, "to_id": same}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("updated") == 0

    def test_no_matching_records_returns_zero(self, headers):
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          headers=headers,
                          json={"from_id": f"nx-{uuid.uuid4().hex}",
                                "to_id": f"tgt-{uuid.uuid4().hex}"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("updated") == 0

    def test_unauthenticated_rejected(self):
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          json={"from_id": "a", "to_id": "b"}, timeout=15)
        assert r.status_code in (401, 403)


# ── full lifecycle test (file upload → reassign → list/preview) ──
class TestFileLifecycle:
    def test_full_local_to_draft_to_quote_flow(self, headers):
        local_id = f"local-{uuid.uuid4().hex[:8]}"
        draft_id = f"draft-{uuid.uuid4().hex}"
        quote_id = f"quote-{uuid.uuid4().hex}"

        # Upload tiny .txt — save_parser_file runs BEFORE Anthropic call,
        # so file persists even if parse fails on budget/network.
        body = b"TEST_reassign file lifecycle - tiny content\n"
        files = {"files": ("reassign_lifecycle.txt", io.BytesIO(body), "text/plain")}
        data = {"quote_id": local_id}
        # Use long timeout in case parse runs, but ignore non-2xx (file still saved)
        try:
            requests.post(f"{BASE_URL}/api/parser/parse-rfq",
                          headers=headers, files=files, data=data, timeout=180)
        except requests.RequestException:
            pass  # parser may fail; we only care about persisted file

        # Verify file under local_id
        r = requests.get(f"{BASE_URL}/api/parser/files",
                         headers=headers, params={"quote_id": local_id}, timeout=15)
        assert r.status_code == 200, r.text
        files_under_local = r.json().get("files", [])
        assert len(files_under_local) >= 1, \
            f"file not persisted under local id {local_id}: {files_under_local}"
        file_id = files_under_local[0]["id"]
        assert files_under_local[0]["filename"] == "reassign_lifecycle.txt"

        # local → draft
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          headers=headers,
                          json={"from_id": local_id, "to_id": draft_id}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("updated", 0) >= 1

        # Old id should be empty
        r = requests.get(f"{BASE_URL}/api/parser/files",
                         headers=headers, params={"quote_id": local_id}, timeout=15)
        assert len(r.json().get("files", [])) == 0

        # File should appear under draft id
        r = requests.get(f"{BASE_URL}/api/parser/files",
                         headers=headers, params={"quote_id": draft_id}, timeout=15)
        assert r.status_code == 200
        assert any(f["id"] == file_id for f in r.json().get("files", []))

        # draft → quote (Save Quote)
        r = requests.post(f"{BASE_URL}/api/parser/files/reassign",
                          headers=headers,
                          json={"from_id": draft_id, "to_id": quote_id}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("updated", 0) >= 1

        # File should appear under quote id
        r = requests.get(f"{BASE_URL}/api/parser/files",
                         headers=headers, params={"quote_id": quote_id}, timeout=15)
        assert r.status_code == 200
        assert any(f["id"] == file_id for f in r.json().get("files", []))

        # Preview still works (disk_path is absolute, not affected by reassign)
        r = requests.get(f"{BASE_URL}/api/parser/files/{file_id}/preview",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        payload = r.json()
        assert payload.get("kind") == "text"
        assert "TEST_reassign" in payload.get("data", "")

        # Download still works
        r = requests.get(f"{BASE_URL}/api/parser/files/{file_id}/download",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        assert b"TEST_reassign" in r.content

        # Cleanup
        requests.delete(f"{BASE_URL}/api/parser/files/{file_id}",
                        headers=headers, timeout=15)
