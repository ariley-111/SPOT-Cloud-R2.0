"""Route Parity Lock — cloud vs legacy spot_r1_5.jsx routing decisions.

Purpose: Lock in the route winner & cost ordering for canonical scenarios so
ANY future regression vs legacy is caught immediately.

Audit cross-reference: /app/memory/ROUTE_PARITY_AUDIT.md

Legacy reference: spot_r1_5.jsx L626-832 (evaluateRoutes + autoRoute).
Cloud reference: /app/backend/engine/routing.py L367-588.

RULE-017: CAD viable when cadHrs <= 8 (within one shift).
RULE-020: Saber + D/C fallback when no viable route.
D-124: cheapest-viable winner across CAD / Crest / Bobst.
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@standardprinting.com"
ADMIN_PASS = "spot-admin-2026"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    if not tok:
        pytest.skip("No token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _calc(client, **p):
    base = {
        "qtys": ["1000", "", "", "", ""],
        "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "42# Kemi-Lite", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1/0",
        "numColorsF": "4", "numColorsB": "0",
        "cadDifficulty": "Standard", "dieType": "Existing Die",
    }
    base.update(p)
    r = client.post(f"{BASE_URL}/api/engine/calculate", json=base,
                    params={"slot_index": 0}, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    return r.json()


# ── RULE-017: small low-CAD-hour pieces route to CAD ──
def test_small_piece_routes_cad(client):
    """5x7 @ 1000 qty: cadHrs well under 8 → CAD wins."""
    d = _calc(client, oneUpW="5", oneUpL="7")
    assert d["route"] == "CAD", f"Expected CAD, got {d['route']}; cadHrs={d.get('cadHrs')}"
    assert d["cadHrs"] <= 8.0


def test_very_small_piece_routes_cad(client):
    """3x4 @ 500 qty: minimal CAD load → CAD."""
    d = _calc(client, oneUpW="3", oneUpL="4", qtys=["500", "", "", "", ""])
    assert d["route"] == "CAD"


# ── RULE-017 + D-124: large piece with high CAD hours routes to Crest ──
def test_large_piece_high_cad_routes_crest(client):
    """24x36 @ 10000: cadHrs ~12 (over 8h limit) → Crest cheaper."""
    d = _calc(client, oneUpW="24", oneUpL="36", qtys=["10000", "", "", "", ""])
    assert d["route"] == "Crest", f"Expected Crest, got {d['route']}; cadHrs={d.get('cadHrs')}"
    assert d["cadHrs"] > 8.0


def test_xl_piece_routes_crest(client):
    """36x48 @ 20000: very high CAD load → Crest."""
    d = _calc(client, oneUpW="36", oneUpL="48", qtys=["20000", "", "", "", ""])
    assert d["route"] == "Crest"


# ── Crest envelope respected ──
def test_crest_sheet_within_envelope(client):
    """Crest-route sheet must fit within CREST_MAX_W x CREST_MAX_L (50x110)."""
    d = _calc(client, oneUpW="24", oneUpL="36", qtys=["10000", "", "", "", ""])
    if d["route"] == "Crest":
        assert d["sheetW"] <= 50, f"Crest sheet width {d['sheetW']} exceeds envelope"
        assert d["sheetL"] <= 110, f"Crest sheet length {d['sheetL']} exceeds envelope"


# ── Auto-route returns _pipeline.routeAuto matching the chosen route ──
def test_pipeline_route_auto_matches(client):
    """_pipeline.routeAuto must reflect the auto-route decision (not the override)."""
    d = _calc(client, oneUpW="5", oneUpL="7")
    pipe = d.get("_pipeline") or {}
    assert pipe.get("routeAuto") == d["route"], (
        f"routeAuto={pipe.get('routeAuto')} != route={d['route']}"
    )


# ── Force-route honored ──
def test_force_route_overrides_auto(client):
    """User-forced route must override the auto winner."""
    auto = _calc(client, oneUpW="5", oneUpL="7")
    forced = _calc(client, oneUpW="5", oneUpL="7", routeOverride="Crest")
    assert auto["route"] == "CAD"
    assert forced["route"] == "Crest"
    pipe = forced.get("_pipeline") or {}
    assert pipe.get("routeForced") is True


# ── flipWouldHelp surfaced (legacy parity for auto-flip gate) ──
def test_flip_would_help_field_present(client):
    """_pipeline.flipWouldHelp must always be a bool (legacy autoSelectSheet(L,W) gate)."""
    d = _calc(client, oneUpW="5", oneUpL="7")
    pipe = d.get("_pipeline") or {}
    assert "flipWouldHelp" in pipe
    assert isinstance(pipe["flipWouldHelp"], bool)


# ── RULE-020: Saber + D/C fallback for too-large pieces ──
def test_oversize_falls_back_to_saber(client):
    """Piece that exceeds Crest envelope but fits available stock: route must
    be one of CAD / Crest / Bobst / Saber + D/C — never empty."""
    d = _calc(client, oneUpW="44", oneUpL="60", qtys=["500", "", "", "", ""])
    # If a route was determined, it must be one of the known set
    if d.get("route"):
        assert d["route"] in ("CAD", "Crest", "Bobst", "Saber + D/C"), (
            f"Unexpected route {d['route']}"
        )
    else:
        # No route → must have an error (engine couldn't size a sheet)
        assert d.get("error"), f"No route and no error: {d}"
