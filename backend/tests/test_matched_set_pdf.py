"""Lock the Matched Set PDF layout — legacy parity (spot_r1_5.jsx L4606-4702).

Asserts the rendered HTML for a Matched Set quote contains:
  - Spec table with all components
  - Per-component pricing grid header
  - Price/Set row
  - QUOTE TOTAL row
  - SETS row
And that per-component sell/pc uses itemSell/qty (not sellTotal/qty).
"""
from __future__ import annotations

from routes.pdf import _customer_pdf_html


def _make_quote(component_pricing, results, *, mode="Matched Set"):
    return {
        "state": {
            "quoteType": "Multi-Part",
            "pricingMode": mode,
            "qtys": ["2500", "", "", "", ""],
            "estNum": "TEST-MS-001",
            "custName": "Test Customer",
            "quoteFOB": "Origin",
            "bomItems": [
                {"id": "it_a", "desc": "Item A", "type": "Manufactured", "pcsPerSet": 6,
                 "state": {"flute": "B/C", "boardGrade": "275 DW", "outsideLiner": "None",
                           "insideLiner": "None", "oneUpW": "10", "oneUpL": "10"}},
                {"id": "it_b", "desc": "Item B", "type": "Manufactured", "pcsPerSet": 1,
                 "state": {"flute": "B", "boardGrade": "200", "outsideLiner": "None",
                           "insideLiner": "None", "oneUpW": "10", "oneUpL": "10"}},
            ],
        },
        "est_num": "TEST-MS-001",
        "customer_name": "Test Customer",
    }


def test_matched_set_pdf_has_per_component_grid():
    component_pricing = [
        {"itemId": "it_a", "itemIndex": 0, "desc": "Item A", "type": "Manufactured",
         "pcsPerSet": 6,
         "boardSpec": {"boardGrade": "275 DW", "flute": "B/C", "outsideLiner": "None",
                       "insideLiner": "None", "oneUpW": "10", "oneUpL": "10"},
         "rows": [{"slotIdx": 0, "qty": 15000, "setQty": 2500, "sellPc": 7.50,
                   "itemSell": 112500.00, "sellTotal": 112500.00, "totalMfg": 84375.00}]},
        {"itemId": "it_b", "itemIndex": 1, "desc": "Item B", "type": "Manufactured",
         "pcsPerSet": 1,
         "boardSpec": {"boardGrade": "200", "flute": "B", "outsideLiner": "None",
                       "insideLiner": "None", "oneUpW": "10", "oneUpL": "10"},
         "rows": [{"slotIdx": 0, "qty": 2500, "setQty": 2500, "sellPc": 0.72,
                   "itemSell": 1791.02, "sellTotal": 3171.02, "totalMfg": 1146.84,
                   "dieLineCost": 1380.00}]},
    ]
    results = [
        {"slot": 0, "qty": 2500, "setQty": 2500, "pricable": True,
         "sellPc": 234.74, "itemSell": 114291.02, "sellTotal": 115671.02,
         "dieLineCost": 1380.00, "freightLine": 0, "prepressLineCost": 0, "miscLineCost": 0},
    ]
    quote = _make_quote(component_pricing, results)

    html = _customer_pdf_html(quote, results, "By Type",
                              component_pricing=component_pricing,
                              job_totals={})

    # Legacy structure markers
    assert "Per-Component Pricing" in html, "missing per-component grid header"
    assert "Price/Set" in html, "missing Price/Set row"
    assert "QUOTE TOTAL" in html, "missing QUOTE TOTAL row"
    assert "SETS" in html, "missing SETS row"
    assert "Matched Set" in html, "matched set label missing"

    # Components both present in grid
    assert "Item A" in html
    assert "Item B" in html

    # Legacy parity for Sell/Pc in BOM grid: should use itemSell/qty
    # Item B: itemSell=1791.02 / qty=2500 = $0.7164 → displayed as "$0.72"
    # NOT sellTotal/qty=$3171.02/2500=$1.27
    assert "$0.72" in html, "Item B Sell/Pc should be $0.72 (itemSell/qty), not $1.27 (sellTotal/qty)"
    assert "$1.27" not in html, "$1.27 indicates Sell/Pc uses sellTotal/qty (wrong — that includes die)"

    # Die row should appear since dieLineCost > 0
    assert ">Die<" in html or "Die</td>" in html


def test_matched_set_pdf_no_die_row_when_no_dies():
    """When all components have zero die cost, the Die row should not render."""
    component_pricing = [
        {"itemId": "it_a", "itemIndex": 0, "desc": "Item A", "type": "Manufactured",
         "pcsPerSet": 1,
         "boardSpec": {"boardGrade": "200", "flute": "B"},
         "rows": [{"slotIdx": 0, "qty": 2500, "setQty": 2500, "sellPc": 5.00,
                   "itemSell": 12500, "sellTotal": 12500, "totalMfg": 9000}]},
    ]
    results = [
        {"slot": 0, "qty": 2500, "setQty": 2500, "pricable": True,
         "sellPc": 5.00, "itemSell": 12500, "sellTotal": 12500,
         "dieLineCost": 0, "freightLine": 0, "prepressLineCost": 0, "miscLineCost": 0},
    ]
    quote = _make_quote(component_pricing, results)
    quote["state"]["bomItems"] = quote["state"]["bomItems"][:1]
    html = _customer_pdf_html(quote, results, "By Type",
                              component_pricing=component_pricing, job_totals={})

    assert "QUOTE TOTAL" in html
    # No line-charge row rendered when all amounts are zero
    assert ">Die<" not in html and "Die</td>" not in html
