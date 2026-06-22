"""Test: Local Delivery freight is a flat published rate — NEVER marked up.

Business rule (legacy parity): local delivery = our own truck, determined by
the destination ZIP (the freight quote resolves the carrier to "SPC Local
Delivery"). Freight markup only applies to common-carrier shipments. The bug
report: a $70 local-delivery quote was showing $80.50 ($70 + 15%) on the quote
and $150.50 in matched-set mode.

The fix forces freightMarkup=0 in build_prod_inputs whenever the resolved
freightCarrier is local — regardless of any freightMarkup value sent.
"""
import sys
sys.path.insert(0, "/app/backend")

from engine.runner import run_estimate


def _payload(carrier, markup="0.15"):
    return {
        "oneUpW": "12", "oneUpL": "18",
        "qtys": ["5000"], "qty": "5000",
        "boardGrade": "200", "flute": "B",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
        "printReq": "Yes", "printMode": "Satin", "printSides": "1-Sided",
        "pricingBasis": "Gross Margin %",
        "quoteFOB": "Destination",
        "freightTreatment": "Separate Line",
        "freightCost": "70",
        "freightMarkup": markup,
        "freightCarrier": carrier,
    }


def test_local_delivery_no_markup_even_when_markup_sent():
    """Carrier=SPC Local Delivery with a 15% markup field → freight line = flat $70."""
    r = run_estimate(_payload("SPC Local Delivery", markup="0.15"))
    assert abs(r["freightLine"] - 70.0) < 0.01, r["freightLine"]


def test_common_carrier_keeps_markup():
    """Non-local carrier → 15% markup applies: $70 → $80.50."""
    r = run_estimate(_payload("FedEx Freight", markup="0.15"))
    assert abs(r["freightLine"] - 80.50) < 0.01, r["freightLine"]


def test_local_delivery_alt_name():
    """Carrier='Local Delivery' (alt label) → also flat, no markup."""
    r = run_estimate(_payload("Local Delivery", markup="0.15"))
    assert abs(r["freightLine"] - 70.0) < 0.01, r["freightLine"]


def test_no_carrier_uses_sent_markup():
    """No carrier resolved yet → honor the sent markup (15%)."""
    r = run_estimate(_payload("", markup="0.15"))
    assert abs(r["freightLine"] - 80.50) < 0.01, r["freightLine"]
