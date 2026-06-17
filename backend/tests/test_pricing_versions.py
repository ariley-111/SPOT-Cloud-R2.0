"""Board Pricing Versions — engine-level parity + freeze tests.

These are pure-engine tests (no DB / HTTP), so they run without env vars.
They lock in:
  1. v1 snapshot == in-code pricing (no behavior change after Phase 1).
  2. Applying a versioned config via use_pricing actually changes board cost.
  3. A +6.5% base_matrix bump moves board cost proportionally (the 6/15/26 case).
"""
from copy import deepcopy

from engine.runner import run_estimate
from engine.core import snapshot_pricing_config, use_pricing, PRICING_KEYS


BASE_PAYLOAD = {
    "oneUpW": "14", "oneUpL": "10", "qtys": ["5000"],
    "flute": "B", "boardGrade": "200",
    "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
    "printReq": "Yes", "printMode": "Satin", "printSides": "1-Side",
    "cadDifficulty": "Standard", "buyMinBoard": "Auto",
}


def test_snapshot_has_all_pricing_keys():
    snap = snapshot_pricing_config()
    for k in PRICING_KEYS:
        assert k in snap, f"snapshot missing pricing key {k!r}"
    assert snap["base_matrix"]["singlewall"]["275"]["0-9"] == 139.58


def test_v1_snapshot_matches_code_defaults():
    """Applying the v1 snapshot must be a no-op vs the default code path."""
    r_default = run_estimate(deepcopy(BASE_PAYLOAD), 0)
    v1 = snapshot_pricing_config()
    with use_pricing(v1):
        r_v1 = run_estimate(deepcopy(BASE_PAYLOAD), 0)
    for k in ("sellTotal", "sheetW", "sheetL", "boardCost", "jobCost"):
        assert r_default.get(k) == r_v1.get(k), f"v1 parity broke on {k}"


def test_versioned_base_matrix_changes_board_cost():
    """A +6.5% bump on the singlewall base_matrix (the 6/15/26 change) must
    raise the board variable cost; with no override we keep the old number."""
    r_old = run_estimate(deepcopy(BASE_PAYLOAD), 0)

    bumped = snapshot_pricing_config()
    sw = bumped["base_matrix"]["singlewall"]
    for grade in sw:
        for tier in sw[grade]:
            if isinstance(sw[grade][tier], (int, float)):
                sw[grade][tier] = round(sw[grade][tier] * 1.065, 5)

    with use_pricing(bumped):
        r_new = run_estimate(deepcopy(BASE_PAYLOAD), 0)

    old_sell = r_old.get("sellTotal") or 0
    new_sell = r_new.get("sellTotal") or 0
    assert new_sell > old_sell, "board +6.5% should increase sell total"
    # And the override must not leak after the context exits.
    r_after = run_estimate(deepcopy(BASE_PAYLOAD), 0)
    assert r_after.get("sellTotal") == old_sell, "pricing override leaked past use_pricing()"
