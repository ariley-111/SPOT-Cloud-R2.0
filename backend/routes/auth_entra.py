"""Microsoft Entra ID SSO — OIDC Authorization Code flow.

Backend-centric OIDC: FastAPI is the confidential client. Browser only ever
sees our internal JWT (same one /api/auth/login issues). Flow:

  1. SPA navigates → GET /api/auth/entra/login
  2. We build Microsoft auth URL + state cookie, 302 to login.microsoftonline.com
  3. User authenticates with Microsoft
  4. Microsoft 302s back to GET /api/auth/entra/callback?code=...&state=...
  5. We exchange code for tokens via MSAL ConfidentialClientApplication
  6. Validate ID token + email domain (allowed list; see ALLOWED_EMAIL_DOMAIN)
  7. Upsert MongoDB user. New users default to estimator unless email is in
     the SSO_ADMIN_EMAILS bootstrap list, then admin.
  8. Issue internal JWT (identical shape to make_token in auth.py)
  9. 302 → ${APP_BASE_URL}/auth/callback?token=<jwt> — the SPA stores the
     token in localStorage exactly like the password flow does today.

Required env vars (set per environment in Admin Console → Integrations later):
  - ENTRA_TENANT_ID
  - ENTRA_CLIENT_ID
  - ENTRA_CLIENT_SECRET
  - APP_BASE_URL                e.g. https://spot-estimator.preview.emergentagent.com
                                (this is the same host the redirect URI uses)
  - ALLOWED_EMAIL_DOMAIN        comma-separated list of allowed sign-in
                                domains (e.g. `standardprinting.com,spcoc.com`).
                                Default is both — reflects the ongoing UPN
                                migration off @spcoc.com. Once every user has
                                been rotated in Entra, drop spcoc.com from
                                the env var.
  - SSO_ADMIN_EMAILS            comma-separated, lowercased. Bootstrap admin
                                allowlist — email match → admin regardless of
                                group membership.
  - ENTRA_MGMT_GROUP_ID         Optional. Object ID (GUID) of the "SPOT Quoting
                                System Management" Entra security group. When
                                set, users in this group land as admin (Admin
                                Console + Board Engine visible); everyone else
                                is estimator. IMPORTANT: the Entra app
                                registration must be configured to include the
                                `groups` claim in ID tokens for this to work.
                                Portal → App Registration → Token Configuration
                                → Add groups claim → Security groups.
  - SSO_REQUIRED                "true" disables password login

The redirect URI you must register in Entra:
  ${APP_BASE_URL}/api/auth/entra/callback
"""
from __future__ import annotations
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer

import msal

from db import db, COL_USERS
from models.schemas import User
from routes.auth import make_token

logger = logging.getLogger("spot.entra")
router = APIRouter(prefix="/api/auth/entra", tags=["auth"])

# State cookie name + signing serializer (signed, NOT encrypted — only the
# nonce + return_to live in it; signing prevents tampering).
_STATE_COOKIE = "spot_entra_state"
_STATE_SECRET = os.environ.get("SSO_STATE_SECRET", os.environ.get("JWT_SECRET", "spot-cloud-dev-secret-change-me"))
_signer = URLSafeTimedSerializer(_STATE_SECRET, salt="entra-oidc-v1")
_STATE_MAX_AGE = 600  # 10 minutes — login should complete well within this


def _settings() -> dict:
    # Resolve every SSO setting through the integrations overlay so admins
    # can edit them from Admin Console → Integrations → Microsoft Entra SSO
    # without a redeploy. Fallback chain: DB override → .env → default.
    from services.integrations import get_effective

    def _pick(key: str, default: str = "") -> str:
        return (get_effective(key) or os.environ.get(key, default) or default).strip()

    raw_domains = _pick("ALLOWED_EMAIL_DOMAIN", "standardprinting.com,spcoc.com")
    allowed = {d.strip().lower().lstrip("@") for d in raw_domains.split(",") if d.strip()}
    return {
        "tenant_id": _pick("ENTRA_TENANT_ID"),
        "client_id": _pick("ENTRA_CLIENT_ID"),
        "client_secret": _pick("ENTRA_CLIENT_SECRET"),
        "app_base_url": os.environ.get("APP_BASE_URL", "").rstrip("/"),
        "allowed_domains": allowed,
        "admin_emails": {
            e.strip().lower()
            for e in _pick("SSO_ADMIN_EMAILS", "").split(",")
            if e.strip()
        },
        # Object ID (GUID) of the "SPOT Quoting System Management" Entra group.
        # Members of this group get role=admin (Admin Console + Board Engine visible).
        # Non-members can still sign in — they just land in estimator UI. Leave
        # blank to disable the group gate (legacy behavior: SSO_ADMIN_EMAILS only).
        "mgmt_group_id": _pick("ENTRA_MGMT_GROUP_ID"),
    }


def is_sso_configured() -> bool:
    """True when all Entra creds are present in env. UI gates the button on this."""
    s = _settings()
    return bool(s["tenant_id"] and s["client_id"] and s["client_secret"] and s["app_base_url"])


def _build_msal_app(s: dict) -> msal.ConfidentialClientApplication:
    return msal.ConfidentialClientApplication(
        client_id=s["client_id"],
        client_credential=s["client_secret"],
        authority=f"https://login.microsoftonline.com/{s['tenant_id']}",
    )


def _redirect_uri(s: dict) -> str:
    return f"{s['app_base_url']}/api/auth/entra/callback"


# ─── /login ──────────────────────────────────────────────────────────────
@router.get("/login")
async def entra_login(request: Request, return_to: Optional[str] = None):
    if not is_sso_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Entra SSO is not configured on this environment yet")
    s = _settings()
    app = _build_msal_app(s)

    # MSAL initiate_auth_code_flow returns {auth_uri, state, code_verifier, ...}.
    # We persist the entire dict (signed) in a short-lived cookie so /callback
    # can verify the state and complete PKCE.
    flow = app.initiate_auth_code_flow(
        scopes=[],  # MSAL auto-adds openid+profile+offline_access; passing any of
                    # those explicitly raises "reserved scope" ValueError.
        redirect_uri=_redirect_uri(s),
    )
    if "auth_uri" not in flow:
        logger.error("MSAL initiate_auth_code_flow failed: %s", flow)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            f"SSO init failed: {flow.get('error_description', flow)}")

    cookie_payload = {"flow": flow, "return_to": return_to or "/"}
    signed = _signer.dumps(cookie_payload)

    resp = RedirectResponse(url=flow["auth_uri"], status_code=302)
    resp.set_cookie(
        key=_STATE_COOKIE,
        value=signed,
        max_age=_STATE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",  # OIDC callback is top-level navigation → Lax allowed
        path="/api/auth/entra",
    )
    return resp


# ─── /callback ───────────────────────────────────────────────────────────
@router.get("/callback")
async def entra_callback(request: Request):
    if not is_sso_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Entra SSO not configured")
    s = _settings()

    cookie = request.cookies.get(_STATE_COOKIE)
    if not cookie:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing or expired SSO state cookie")
    try:
        payload = _signer.loads(cookie, max_age=_STATE_MAX_AGE)
    except BadSignature:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tampered SSO state cookie")

    flow = payload.get("flow") or {}
    return_to = payload.get("return_to") or "/"

    # Build the auth response dict MSAL expects (query params from the
    # callback: code, state, session_state, etc.)
    auth_response = dict(request.query_params)
    if "error" in auth_response:
        logger.warning("Entra returned error: %s", auth_response)
        return _bounce_with_error(s["app_base_url"], auth_response.get("error_description") or auth_response["error"])

    app = _build_msal_app(s)
    try:
        result = app.acquire_token_by_auth_code_flow(flow, auth_response)
    except Exception as e:
        logger.exception("acquire_token_by_auth_code_flow raised")
        return _bounce_with_error(s["app_base_url"], f"SSO token exchange failed: {e}")

    if "error" in result:
        logger.warning("MSAL token-exchange error: %s", result)
        return _bounce_with_error(s["app_base_url"], result.get("error_description") or result["error"])

    claims = result.get("id_token_claims") or {}
    email = (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
        or ""
    ).strip().lower()
    if not email or "@" not in email:
        return _bounce_with_error(s["app_base_url"], "No email claim returned by Entra")

    domain = email.split("@", 1)[1]
    if domain not in s["allowed_domains"]:
        allowed_pretty = " or ".join(f"@{d}" for d in sorted(s["allowed_domains"]))
        return _bounce_with_error(
            s["app_base_url"],
            f"Sign-in restricted to {allowed_pretty} accounts. ({email} not allowed.)",
        )

    # ─── Determine admin authorization ───
    # Precedence:
    #   1. Email in SSO_ADMIN_EMAILS  → admin (bootstrap escape hatch)
    #   2. Entra group membership     → admin iff mgmt group in claims["groups"]
    #   3. Neither → estimator
    # Entra returns group Object IDs in the `groups` claim only if the app
    # registration explicitly requests groups membership. If ENTRA_MGMT_GROUP_ID
    # is unset we skip the group check entirely (legacy behavior: everyone who
    # signs in is estimator unless their email is on the admin allowlist).
    _groups = claims.get("groups") or []
    _in_mgmt_group = bool(s["mgmt_group_id"] and s["mgmt_group_id"] in _groups)
    _is_admin_email = email in s["admin_emails"]
    _sso_role = "admin" if (_is_admin_email or _in_mgmt_group) else "estimator"
    logger.info(
        "SSO login: email=%s admin_email=%s in_mgmt_group=%s → role=%s (groups_returned=%d)",
        email, _is_admin_email, _in_mgmt_group, _sso_role, len(_groups),
    )

    # ─── Upsert user ───
    name = (claims.get("name") or email.split("@", 1)[0]).strip()
    entra_oid = claims.get("oid") or claims.get("sub")
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = await db[COL_USERS].find_one({"email": email})
    if existing:
        # Sync SSO role each login so revoking group membership takes effect
        # on the next sign-in without an admin having to touch the DB.
        update = {
            "$set": {
                "auth_provider": "entra",
                "entra_oid": entra_oid,
                "last_login": now_iso,
                "role": _sso_role,
                "in_mgmt_group": _in_mgmt_group,
            }
        }
        await db[COL_USERS].update_one({"email": email}, update)
        user_doc = await db[COL_USERS].find_one({"email": email}, {"_id": 0})
    else:
        user = User(
            email=email,
            name=name,
            role=_sso_role,
            password_hash="",  # SSO users have no password
        )
        doc = user.model_dump()
        doc["auth_provider"] = "entra"
        doc["entra_oid"] = entra_oid
        doc["last_login"] = now_iso
        doc["in_mgmt_group"] = _in_mgmt_group
        await db[COL_USERS].insert_one(doc)
        user_doc = doc

    token = make_token(user_doc["id"], user_doc["email"], user_doc["role"])

    # Bounce to the SPA with the token in the URL fragment. The SPA's
    # /auth/callback route reads it, stores in localStorage, then replaces
    # the URL — same shape as the password flow's localStorage.setItem.
    qs = urlencode({"token": token})
    spa_url = f"{s['app_base_url']}/auth/callback?{qs}&return_to={return_to}"
    resp = RedirectResponse(url=spa_url, status_code=302)
    resp.delete_cookie(_STATE_COOKIE, path="/api/auth/entra")
    return resp


def _bounce_with_error(base_url: str, message: str) -> RedirectResponse:
    qs = urlencode({"sso_error": message})
    return RedirectResponse(url=f"{base_url}/login?{qs}", status_code=302)
