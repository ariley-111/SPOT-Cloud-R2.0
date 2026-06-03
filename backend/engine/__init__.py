"""SPOT Pricing Engine — Python port of spot_engine.js (R1.6.5.1).

Verbatim port. The math, constants, control flow, and edge cases mirror
the JavaScript engine exactly. Calibration baseline: D-110 FINAL (2026-04-24).

Public API:
  run_estimate(json, slot_index=0)  — main entry point (mirrors spot_runner.js)
  calc_board, compute_layout, auto_select_sheet, auto_route, calc_wf, calc_shipment
  ENGINE, APPROVED_SHEETS, RATE_DEFAULTS, GM_DEFAULTS, SELL_DEFAULTS
"""
from .core import (
    ENGINE, SHEET_GROUPS, APPROVED_SHEETS,
    FLUTE_CALIPERS, PRINT_SPEEDS, CAD_SETUP, CAD_FALLBACK,
    STRIP_DEFAULTS, GLUE_DEFAULTS,
    CAD_DIFF_MIGRATION, STRIP_DIFF_MIGRATION, SPOT_SCHEMA_VERSION,
    GM_MSF_TIERS, GM_DEFAULTS, SELL_DEFAULTS,
    GRADE_ADDER_DEFAULTS, ECT_GRADE_FALLBACK, MULLEN_UPGRADE,
    MEDIUM_ORDER, MEDIUM_FALLBACK_POOL,
    CREST_MAX_W, CREST_MAX_L,
    BOBST_MIN_W, BOBST_MIN_L, BOBST_MAX_W, BOBST_MAX_L, BOBST_FLUTES,
    RATE_DEFAULTS,
    pn, ceil_int, is_finite,
    get_msf_tier, get_gm_msf_tier, get_dim_adder, get_liner_rate,
    get_grade_fallback, get_medium_fallback,
    calc_board, compute_layout,
)
from .routing import (
    select_bobst_sheet, auto_select_sheet, auto_route, select_override_sheet,
)
from .pricing import (
    calc_wf, allocate_job_cost,
    GRADE_LINER_DEFAULTS, FLUTE_TAKEUP, SKID_SIZES, TRAILER_FEET, SKID_MAX_PRODUCT_HEIGHT,
    calc_board_weight, auto_select_skid, calc_pieces_per_skid_layer, calc_shipment,
)
from .runner import (
    run_estimate, build_board_spec, build_asmp, build_prod_inputs, ASMP_DEFAULTS,
)

__version__ = "1.0.0-phase1"

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
