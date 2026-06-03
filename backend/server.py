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
from routes import customers as customers_routes
from routes import engine_routes
from routes import quotes as quotes_routes
from routes import freight as freight_routes
from routes import parser as parser_routes
from routes import pdf as pdf_routes
from routes import admin_rates as admin_rates_routes
from routes import admin_integrations as admin_integrations_routes
from routes import admin_sheets as admin_sheets_routes
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

# Routers
app.include_router(health_routes.router)
app.include_router(auth_routes.router)
app.include_router(customers_routes.router)
app.include_router(engine_routes.router)
app.include_router(quotes_routes.drafts_router)
app.include_router(quotes_routes.quotes_router)
app.include_router(freight_routes.router)
app.include_router(parser_routes.router)
app.include_router(pdf_routes.router)
app.include_router(admin_rates_routes.router)
app.include_router(admin_integrations_routes.router)
app.include_router(admin_sheets_routes.router)

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


@app.on_event("shutdown")
async def on_shutdown():
    from db import client
    client.close()
    logger.info("SPOT Cloud stopped")
