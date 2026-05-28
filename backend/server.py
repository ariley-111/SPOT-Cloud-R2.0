"""SPOT Cloud — FastAPI application entry point.

Ports the SPOT (Standard Printing Optimization Tool) corrugated packaging quoting
tool from a local Node.js+JSX desktop app to a cloud-hosted React + FastAPI + MongoDB
service.

Reference source code: /app/legacy_spot/ (read-only)
Phased implementation: see /app/memory/PRD.md
"""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Routes
from routes import health as health_routes

# ─── App ───────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SPOT Cloud",
    description="Standard Printing Optimization Tool — Cloud Edition",
    version="0.1.0-phase0",
)

# CORS — preview env serves frontend and backend on the same domain, but
# we keep this permissive for now; tighten before go-live.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ───────────────────────────────────────────────────────────────
app.include_router(health_routes.router)


# ─── Lifecycle ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("spot")


@app.on_event("startup")
async def on_startup():
    logger.info("SPOT Cloud starting — phase 0 skeleton")


@app.on_event("shutdown")
async def on_shutdown():
    from db import client
    client.close()
    logger.info("SPOT Cloud stopped")
