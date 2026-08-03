"""Health & metadata routes for SPOT Cloud."""
from datetime import datetime, timezone
from fastapi import APIRouter
from engine import CALIBRATION_BASELINE

router = APIRouter(prefix="/api", tags=["health"])

SPOT_CLOUD_VERSION = "0.2.0-phase2"
_started_at = datetime.now(timezone.utc)


@router.get("/health")
async def health():
    """Liveness sentinel. Used for monitoring + parity-check vs legacy SPOT's /api/health."""
    uptime_sec = (datetime.now(timezone.utc) - _started_at).total_seconds()
    # Fingerprint of which report code the running container has. Comparing this
    # to what the codebase currently exports proves whether prod is running the
    # latest fixes or a stale image.
    features: list[str] = []
    col_count = 0
    try:
        from routes.quotes import _REPORT_COLUMNS  # type: ignore
        col_count = len(_REPORT_COLUMNS)
        features = [c for c in _REPORT_COLUMNS if c in ("CAD Method", "Cutter Basis")]
    except Exception:
        pass
    return {
        "status": "ok",
        "service": "SPOT Cloud",
        "version": SPOT_CLOUD_VERSION,
        "uptime_sec": uptime_sec,
        "started": _started_at.isoformat(),
        "phase": "Phase 2 — Backend APIs",
        "report_columns_new": features,  # empty → stale image, present → fresh
        "report_column_count": col_count,  # should be 45 with fix, 43 without
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
