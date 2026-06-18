"""Regression for services.pdf_tiles — the high-DPI tiler that fixes illegible
dimension callouts on large-format CAD sheets (the 'Amon Ra' 38.9×16.9in case).
"""
from __future__ import annotations
import base64
import pytest

fitz = pytest.importorskip("fitz")
from services.pdf_tiles import render_pdf_tiles, MAX_TILES, LARGE_PAGE_IN  # noqa: E402


def _make_pdf(width_in: float, height_in: float) -> bytes:
    doc = fitz.open()
    doc.new_page(width=width_in * 72, height=height_in * 72)
    return doc.tobytes()


def test_large_sheet_is_tiled_into_multiple_legible_tiles():
    tiles = render_pdf_tiles(_make_pdf(38.9, 16.9))  # the real CAD geometry
    assert len(tiles) > 1, "large-format sheet must be split into multiple tiles"
    assert len(tiles) <= MAX_TILES
    for t in tiles:
        assert t["b64"] and t["label"]
        png = base64.b64decode(t["b64"])
        assert png[:8] == b"\x89PNG\r\n\x1a\n", "tile must be a valid PNG"


def test_normal_page_is_not_tiled():
    # A letter-size page renders legibly under native PDF support → no tiles.
    assert render_pdf_tiles(_make_pdf(8.5, 11.0)) == []


def test_just_over_threshold_tiles():
    tiles = render_pdf_tiles(_make_pdf(LARGE_PAGE_IN + 1, 11.0))
    assert len(tiles) >= 1


def test_garbage_bytes_returns_empty():
    assert render_pdf_tiles(b"not a pdf") == []
