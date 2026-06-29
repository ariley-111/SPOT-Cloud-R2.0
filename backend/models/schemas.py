"""SPOT Cloud — Pydantic models for users, quotes, drafts, customers, audit."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field
import uuid


def _uuid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── USER ─────────────────────────────────────────────────────────────────
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    email: str
    name: str
    role: str = "estimator"  # admin | estimator | test
    password_hash: str = ""           # empty for SSO-only users
    auth_provider: str = "local"      # "local" | "entra"
    entra_oid: Optional[str] = None
    created_at: str = Field(default_factory=_utc_now)
    last_login: Optional[str] = None


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: str


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    role: str = "estimator"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ─── CUSTOMER ─────────────────────────────────────────────────────────────
class Customer(BaseModel):
    model_config = ConfigDict(extra="allow")
    code: str
    name: str
    address_1: Optional[str] = None
    address_2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    po_required: Optional[str] = None
    on_credit_hold: Optional[str] = None
    credit_limit: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None              # customer contact (email To: default)
    terms_code: Optional[str] = None
    sales_tax_code: Optional[str] = None
    active: Optional[str] = None
    csr: Optional[str] = None                # Customer service rep / CAM (email CC)
    csr_id: Optional[str] = None
    csr_email: Optional[str] = None
    salesperson: Optional[str] = None        # Assigned salesperson (email CC)
    salesperson_id: Optional[str] = None
    salesperson_email: Optional[str] = None


# ─── QUOTE / DRAFT ────────────────────────────────────────────────────────
class QuoteState(BaseModel):
    """The full state of a quote — mirrors the JSON shape spot_runner.runEstimate expects.

    Permissive — accept any fields the engine recognizes plus UI-only state.
    """
    model_config = ConfigDict(extra="allow")


class QuoteDraft(BaseModel):
    """Per-user in-progress quote ('tab')."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    owner_id: str
    est_num: Optional[str] = None
    label: Optional[str] = None
    state: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)


class QuoteDraftCreate(BaseModel):
    label: Optional[str] = None
    state: Optional[Dict[str, Any]] = None


class QuoteDraftUpdate(BaseModel):
    label: Optional[str] = None
    state: Optional[Dict[str, Any]] = None
    est_num: Optional[str] = None


class Quote(BaseModel):
    """Formal saved quote."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    owner_id: str
    est_num: str
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    schema_version: int = 3
    status: str = "draft"  # draft | saved | sent
    state: Dict[str, Any] = Field(default_factory=dict)
    results: Optional[List[Dict[str, Any]]] = None
    test_mode: bool = False
    # Board Pricing Freeze (Phase 1): the pricing version this quote is pinned to.
    # Set at save time; preserved on update. Re-pricing is only via Duplicate.
    pricing_version_id: Optional[str] = None
    # Rate Freeze (Phase 2): admin rate snapshot pinned at save/duplicate so the
    # quote keeps its CAD/machine/grade/markup rates on recalc. Drafts have none.
    rate_snapshot: Optional[Dict[str, Any]] = None
    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)
    sent_at: Optional[str] = None  # set when status first becomes "sent" (emailed)


class QuoteCreate(BaseModel):
    est_num: str
    state: Dict[str, Any]
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    status: str = "draft"
    test_mode: bool = False
    pricing_version_id: Optional[str] = None


# ─── PRICING VERSIONS (Board Pricing Update + Freeze) ──────────────────────
class PricingVersion(BaseModel):
    """A versioned snapshot of board-supplier pricing (base_matrix + adders).
    `config` holds the PRICING_KEYS payload the engine overlays at calc time."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    label: str                              # e.g. "2026-06-15"
    effective_date: Optional[str] = None    # supplier effective date (ISO)
    status: str = "archived"                # active | archived | draft
    config: Dict[str, Any] = Field(default_factory=dict)
    change_summary: Optional[Dict[str, Any]] = None  # diff vs prior active version
    source_file: Optional[str] = None       # original filename, for the record
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str = Field(default_factory=_utc_now)
    activated_at: Optional[str] = None
    is_baseline: bool = False               # v1 = the in-code 4.14.25 snapshot


# ─── ENGINE ───────────────────────────────────────────────────────────────
class EngineCalculateRequest(BaseModel):
    """Input shape for /api/engine/calculate — mirrors spot_runner.runEstimate."""
    model_config = ConfigDict(extra="allow")
    slot_index: int = 0


class EngineCalculateAllRequest(BaseModel):
    """Run all qty slots."""
    model_config = ConfigDict(extra="allow")


# ─── PARSER ───────────────────────────────────────────────────────────────
class ParserBudget(BaseModel):
    model_config = ConfigDict(extra="ignore")
    month: str
    spend_usd: float = 0.0
    calls: int = 0
    cap_usd: float = 500.0


# ─── AUDIT ────────────────────────────────────────────────────────────────
class AuditLogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=_uuid)
    quote_id: Optional[str] = None
    draft_id: Optional[str] = None
    user_id: str
    field: str
    old_value: Any = None
    new_value: Any = None
    source: str = "user"  # user | parser | engine | system
    timestamp: str = Field(default_factory=_utc_now)


# ─── FREIGHT ──────────────────────────────────────────────────────────────
class FreightQuoteRequest(BaseModel):
    origin_zip: Optional[str] = None  # default 44704 (Canton)
    dest_zip: str
    weight_lbs: float
    skid_count: int = 1
    skid_type: str = "S"  # S | L | WF
    trailer_feet: Optional[int] = None
