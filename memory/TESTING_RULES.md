# Testing Rules — READ BEFORE RUNNING ANY TEST

## Incident (June 2026)
A broad `pytest backend/tests` run executed the pre-existing email tests
(`test_email_quote.py`, `test_email_send_concurrency.py`). Microsoft Graph mail IS configured
in this preview (`GRAPH_MAIL_SENDER` set), so `/api/email/send-quote` sent **real emails**
(8× HTTP 202 from graph.microsoft.com). The user did not ask for email testing.

## Hard rules
1. **NEVER run the full test suite** (`pytest`, `pytest backend/tests`, `pytest -k ...` without a file path).
   Always run a single named file: `pytest backend/tests/test_print_factor.py`.
2. **NEVER call `/api/email/*`**, `/api/pdf/*` send paths, or anything touching Microsoft Graph,
   unless the user explicitly asks for email testing and approves the recipients.
3. Email tests are now opt-in only. Both email test modules skip at import unless `SPOT_ALLOW_EMAIL_TESTS=1`,
   and `backend/tests/conftest.py` additionally skips any module whose filename contains
   `email`/`mail`/`graph`/`send`. Do not remove either guard.
4. Preview is NOT side-effect-free: Entra SSO, Graph mail and production-like data are live here.
5. When briefing the testing_agent, state explicitly: "Do NOT run the full pytest suite. Do NOT call any
   email or Graph endpoint. Run only <named test files>."
