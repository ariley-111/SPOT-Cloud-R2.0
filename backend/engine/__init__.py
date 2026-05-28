"""SPOT Pricing Engine — Python port of spot_engine.js (1,131 lines).

This module is the single source of truth for SPOT pricing math.
It is a verbatim port of the JavaScript engine, validated against
the 785-job iQuote regression dataset at R² 0.969 (segment cost).

Phase 1 of the port will populate this module. Until then, this is a placeholder.

Source files mirrored (all in /app/legacy_spot/):
  - spot_engine.js (the Node-side engine, regression-tested)
  - spot_r1_5.jsx ENGINE block at L84-877 (the live-quote mirror)
  - spot_runner.js (the orchestrator)

Calibration baseline: D-110 FINAL (2026-04-24)
  - Segment Cost R²: 0.9690
  - Segment Sell R²: 0.9496
  - Per-job Cost R²: 0.8550
  - Per-job Sell R²: 0.8360
  - Fleet cost delta vs iQuote: +6.55%
  - Fleet sell premium vs iQuote: +8.30%
"""

# Placeholder constants - populated in Phase 1
__version__ = "0.0.1-skeleton"

# Calibration baseline (read-only sanity check)
CALIBRATION_BASELINE = {
    "name": "D-110 FINAL",
    "date": "2026-04-24",
    "segment_r2_cost": 0.9690,
    "segment_r2_sell": 0.9496,
    "per_job_r2_cost": 0.8550,
    "per_job_r2_sell": 0.8360,
    "fleet_cost_delta_pct": 6.55,
    "fleet_sell_premium_pct": 8.30,
    "fleet_jobs": 773,
    "fleet_jobs_total": 785,
    "margin_lift_usd": 76488,
}
