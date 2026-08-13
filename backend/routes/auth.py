"""Authentication — JWT-based, dev mode. SSO swaps in Phase 5."""
from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from db import db, COL_USERS
from models.schemas import (
    LoginResponse, User, UserCreate, UserLogin, UserPublic,
)

JWT_SECRET = os.environ.get("JWT_SECRET", "spot-cloud-dev-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXPIRES_HOURS = 12

router = APIRouter(prefix="/api/auth", tags=["auth"])
_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False  # SSO-only users have no password hash
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def make_token(user_id: str, email: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_HOURS)
    payload = {"sub": user_id, "email": email, "role": role, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(token: Optional[str] = Depends(_oauth2)) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user_doc = await db[COL_USERS].find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return User(**user_doc)


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


@router.post("/register", response_model=UserPublic)
async def register(body: UserCreate, _admin: User = Depends(require_admin)) -> UserPublic:
    """Admin-only registration. SSO replaces this in Phase 5."""
    existing = await db[COL_USERS].find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "User with that email exists")
    user = User(
        email=body.email.lower(),
        name=body.name,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    doc = user.model_dump()
    await db[COL_USERS].insert_one(doc)
    return UserPublic(id=user.id, email=user.email, name=user.name, role=user.role)


@router.post("/login", response_model=LoginResponse)
async def login(body: UserLogin) -> LoginResponse:
    if os.environ.get("SSO_REQUIRED", "false").lower() == "true":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Password login is disabled — please use Microsoft SSO",
        )
    user_doc = await db[COL_USERS].find_one({"email": body.email.lower()}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    user = User(**user_doc)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = make_token(user.id, user.email, user.role)
    await db[COL_USERS].update_one(
        {"id": user.id}, {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
    )
    return LoginResponse(
        access_token=token,
        user=UserPublic(id=user.id, email=user.email, name=user.name, role=user.role),
    )


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic(id=user.id, email=user.email, name=user.name, role=user.role)


@router.get("/config")
async def auth_config() -> dict:
    """Public — frontend reads this on the login screen to know whether to
    render the Entra button and/or hide the password form."""
    # Defer import to avoid a circular dep at module-import time.
    from routes.auth_entra import is_sso_configured, _settings as _sso_settings
    _sso = _sso_settings()
    _allowed = sorted(_sso["allowed_domains"])
    return {
        "sso_enabled": is_sso_configured(),
        "sso_required": os.environ.get("SSO_REQUIRED", "false").lower() == "true",
        # New: list of every domain we accept. `allowed_domain` (singular) is
        # kept for backward compat with older frontends — it's the primary
        # (first, alphabetically-sorted) domain.
        "allowed_domains": _allowed,
        "allowed_domain": _allowed[0] if _allowed else "standardprinting.com",
    }


@router.post("/logout")
async def logout(_user: User = Depends(get_current_user)) -> dict:
    """Stateless JWT — logout is client-side (just discard token)."""
    return {"status": "ok"}


@router.post("/seed-admin")
async def seed_admin() -> dict:
    """Idempotently seed the initial admin user. Open endpoint for first-time setup.

    Credentials read from env vars SPOT_ADMIN_EMAIL / SPOT_ADMIN_PASSWORD with safe defaults.
    """
    admin_email = os.environ.get("SPOT_ADMIN_EMAIL", "admin@standardprinting.com").lower()
    admin_password = os.environ.get("SPOT_ADMIN_PASSWORD", "spot-admin-2026")
    admin_name = os.environ.get("SPOT_ADMIN_NAME", "SPOT Admin")
    existing = await db[COL_USERS].find_one({"email": admin_email})
    if existing:
        return {"status": "exists", "email": admin_email}
    user = User(
        email=admin_email, name=admin_name, role="admin",
        password_hash=hash_password(admin_password),
    )
    await db[COL_USERS].insert_one(user.model_dump())
    return {"status": "created", "email": admin_email}
