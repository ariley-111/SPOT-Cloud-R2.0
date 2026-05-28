"""Health & metadata routes for SPOT Cloud."""
from datetime import datetime, timezone
from fastapi import APIRouter
from engine import CALIBRATION_BASELINE

router = APIRouter(prefix="/api", tags=["health"])

SPOT_CLOUD_VERSION = "0.1.0-phase0"
_started_at = datetime.now(timezone.utc)


@router.get("/health")
async def health():
    """Liveness sentinel. Used for monitoring + parity-check vs legacy SPOT's /api/health."""
    uptime_sec = (datetime.now(timezone.utc) - _started_at).total_seconds()
    return {
        "status": "ok",
        "service": "SPOT Cloud",
        "version": SPOT_CLOUD_VERSION,
        "uptime_sec": uptime_sec,
        "started": _started_at.isoformat(),
        "phase": "Phase 0 — Foundation",
    }


@router.get("/version")
async def version():
    """Full version + reference metadata."""
    return {
        "version": SPOT_CLOUD_VERSION,
        "legacy_reference": "SPOT R1.6.5.1",
        "calibration_baseline": CALIBRATION_BASELINE,
    }


@router.get("/calibration/baseline")
async def calibration_baseline():
    """Read-only display of the D-110 FINAL baseline. Locked target for engine parity."""
    return CALIBRATION_BASELINE
