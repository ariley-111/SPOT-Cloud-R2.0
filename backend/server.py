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
from routes.customers import ensure_customers_loaded

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

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("spot")


@app.on_event("startup")
async def on_startup():
    logger.info("SPOT Cloud starting — Phase 2 (Backend APIs)")
    await ensure_customers_loaded()
    logger.info("Customer list loaded")


@app.on_event("shutdown")
async def on_shutdown():
    from db import client
    client.close()
    logger.info("SPOT Cloud stopped")
