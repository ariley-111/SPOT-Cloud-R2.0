"""SPOT Cloud — FastAPI application entry point."""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from routes import health as health_routes
from routes import auth as auth_routes
from routes import auth_entra as auth_entra_routes
from routes import customers as customers_routes
from routes import engine_routes
from routes import quotes as quotes_routes
from routes import freight as freight_routes
from routes import parser as parser_routes
from routes import pdf as pdf_routes
from routes import email as email_routes
from routes import admin_rates as admin_rates_routes
from routes import admin_integrations as admin_integrations_routes
from routes import admin_sheets as admin_sheets_routes
from routes import admin_pricing as admin_pricing_routes
from routes import admin_matched_set as admin_matched_set_routes
from routes import bom_templates as bom_templates_routes
from routes.customers import ensure_customers_loaded
from services.rate_overrides import load_overrides_from_db
from services.integrations import load_integrations_from_db
from services.sheet_library import load_sheets_from_db

app = FastAPI(
    title="SPOT Cloud",
    description="Standard Printing Optimization Tool — Cloud Edition",
    version="0.2.0-phase2",
)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache_api_responses(request, call_next):
    """Force browsers to never cache /api/* responses. This prevents the
    long-standing "I just redeployed but the app still shows old data"
    problem where downloads (Excel reports) and JSON responses were
    served from the browser's disk cache after a deploy."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Routers
app.include_router(health_routes.router)
app.include_router(health_routes.root_router)
app.include_router(auth_routes.router)
app.include_router(auth_entra_routes.router)
app.include_router(customers_routes.router)
app.include_router(engine_routes.router)
app.include_router(quotes_routes.drafts_router)
app.include_router(quotes_routes.quotes_router)
app.include_router(quotes_routes.audit_router)
app.include_router(freight_routes.router)
app.include_router(parser_routes.router)
app.include_router(pdf_routes.router)
app.include_router(email_routes.router)
app.include_router(admin_rates_routes.router)
app.include_router(admin_integrations_routes.router)
app.include_router(admin_sheets_routes.router)
app.include_router(admin_pricing_routes.router)
app.include_router(admin_matched_set_routes.router)
app.include_router(bom_templates_routes.router)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("spot")


@app.on_event("startup")
async def on_startup():
    logger.info("SPOT Cloud starting — Phase 2 (Backend APIs)")
    await ensure_customers_loaded()
    logger.info("Customer list loaded")
    n = await load_overrides_from_db()
    logger.info(f"Rate overrides applied: {n}")
    ni = await load_integrations_from_db()
    logger.info(f"Integration overrides applied: {ni}")
    ns = await load_sheets_from_db()
    logger.info(f"Sheet library loaded: {ns}")
    # Board Pricing Freeze: seed v1 baseline (4.14.25 == in-code rates) + pin
    # all existing quotes to it. Idempotent — no-op once initialized.
    from services.pricing_versions import ensure_initialized
    active_pv = await ensure_initialized()
    logger.info(f"Pricing versions initialized; active={active_pv}")
    # Rate Freeze (Phase 2): backfill quotes saved before the freeze existed with
    # the in-code BASELINE rates so they keep their original CAD/machine/grade
    # rates on recalc. Idempotent — only touches docs missing a snapshot.
    from services.rate_overrides import baseline_snapshot
    from db import db as _dbq, COL_QUOTES as _CQ
    bf = await _dbq[_CQ].update_many(
        {"rate_snapshot": {"$exists": False}},
        {"$set": {"rate_snapshot": baseline_snapshot()}})
    logger.info(f"Rate-freeze backfill: {bf.modified_count} legacy quotes pinned to baseline rates")
    # BUG-2026-02-hotfix: heal-qtys accidentally wrote `updated_at` as a
    # datetime (BSON Date) instead of the ISO string the rest of the codebase
    # uses. Pydantic Quote.updated_at: str then 500'd the /api/quotes list
    # (empty Load Quote modal in PROD). Coerce back to ISO string on boot —
    # idempotent, safe to run every startup.
    from db import COL_QUOTE_DRAFTS as _CQD
    for _coll in (_CQ, _CQD):
        try:
            fixed = 0
            async for _d in _dbq[_coll].find(
                {"updated_at": {"$type": "date"}}, {"_id": 1, "updated_at": 1}
            ):
                _ua = _d.get("updated_at")
                _iso = _ua.isoformat() if hasattr(_ua, "isoformat") else str(_ua)
                await _dbq[_coll].update_one(
                    {"_id": _d["_id"]}, {"$set": {"updated_at": _iso}}
                )
                fixed += 1
            if fixed:
                logger.warning(f"updated_at coerce (bson→iso): {_coll} fixed={fixed}")
        except Exception as e:
            logger.warning(f"updated_at coerce skipped for {_coll}: {e}")
    # Async parse jobs — TTL index purges completed/abandoned jobs after 24h.
    from db import db as _dbj, COL_PARSER_JOBS, COL_EMAIL_JOBS
    try:
        await _dbj[COL_PARSER_JOBS].create_index("created_at", expireAfterSeconds=86400)
        await _dbj[COL_PARSER_JOBS].create_index("job_id", unique=True)
    except Exception as e:
        logger.warning(f"parser_jobs index create skipped: {e}")
    try:
        await _dbj[COL_EMAIL_JOBS].create_index("created_at", expireAfterSeconds=86400)
        await _dbj[COL_EMAIL_JOBS].create_index("job_id", unique=True)
    except Exception as e:
        logger.warning(f"email_jobs index create skipped: {e}")
    # One-time admin role grants. Idempotent — only updates when role differs.
    from db import db as _db, COL_USERS
    admin_grants = ["rwalter@standardprinting.com"]
    for em in admin_grants:
        u = await _db[COL_USERS].find_one({"email": em})
        if u and u.get("role") != "admin":
            await _db[COL_USERS].update_one({"email": em}, {"$set": {"role": "admin"}})
            logger.info(f"Granted admin role to {em}")


@app.on_event("shutdown")
async def on_shutdown():
    from db import client
    client.close()
    logger.info("SPOT Cloud stopped")
