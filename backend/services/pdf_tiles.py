"""High-resolution PDF tiling for the RFQ parser.

Anthropic's native PDF support downsamples every page to ~1568px on the long
edge. A large-format CAD die-line sheet (e.g. 38.9 × 16.9 in holding 30+
components) therefore renders at ~40 DPI, which makes the small dimension-arrow
callouts (~6pt text) illegible — the model then misreads or guesses dims.

This module renders large pages to a high-DPI raster and slices them into
overlapping tiles, each kept under Anthropic's legibility sweet spot (~1456px).
The tiles are sent ALONGSIDE the native PDF: the PDF gives the model the global
component list/labels, the tiles let it READ the exact numbers and flute marks.
"""
from __future__ import annotations
import base64
import io
import logging
import math
from typing import List, Dict

logger = logging.getLogger("spot.parser.tiles")

# Tuning constants
TARGET_DPI = 220        # render DPI for large sheets — high enough that a tenths
                        # decimal in a dimension callout (e.g. "1930.1") stays crisp
MAX_EDGE = 1568         # keep each tile's long edge ≤ this (Anthropic optimum)
LARGE_PAGE_IN = 10.0    # tile any page whose long edge exceeds this. Lowered
                        # from 17.0 (2026-02-13) after the TAV25-1220-R1 miss —
                        # a standard Letter-landscape CAD (11×8.5) with a tiny
                        # "CORRUGATION / horizontal" label in the bottom-left
                        # corner was invisible at Anthropic's native ~142 DPI.
                        # 10.0 catches Letter, Legal, Tabloid, and every larger
                        # CAD — small corner labels get read at ~285 DPI in a
                        # 2×2 tile grid instead of ~140 DPI native.
OVERLAP = 0.10          # fraction of tile size to overlap so straddling parts survive
MAX_TILES = 20          # hard cap on tiles per document (token/cost guard)


def render_pdf_tiles(pdf_bytes: bytes) -> List[Dict[str, str]]:
    """Return a list of {"label", "b64"} PNG tiles for large pages in the PDF.

    Returns [] for small/normal pages (native PDF render is already legible) or
    if PyMuPDF/Pillow are unavailable — the caller falls back to the PDF alone.
    """
    try:
        import fitz  # PyMuPDF
        from PIL import Image
    except Exception as e:  # pragma: no cover
        logger.warning(f"PDF tiling skipped — deps missing: {e}")
        return []

    out: List[Dict[str, str]] = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        logger.warning(f"PDF tiling skipped — open failed: {e}")
        return []

    for pno in range(doc.page_count):
        if len(out) >= MAX_TILES:
            break
        pg = doc[pno]
        r = pg.rect
        long_in = max(r.width, r.height) / 72.0
        if long_in <= LARGE_PAGE_IN:
            continue  # normal page — native PDF render is fine

        zoom = TARGET_DPI / 72.0
        try:
            pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        except Exception as e:
            logger.warning(f"PDF tiling page {pno} render failed: {e}")
            continue

        W, H = img.size
        ncol = max(1, math.ceil(W / MAX_EDGE))
        nrow = max(1, math.ceil(H / MAX_EDGE))
        # Respect the per-document tile budget across all pages.
        budget = MAX_TILES - len(out)
        while ncol * nrow > budget and (ncol > 1 or nrow > 1):
            if ncol >= nrow and ncol > 1:
                ncol -= 1
            elif nrow > 1:
                nrow -= 1
            else:
                break

        tile_w = W / ncol
        tile_h = H / nrow
        ox = tile_w * OVERLAP
        oy = tile_h * OVERLAP
        for rr in range(nrow):
            for cc in range(ncol):
                if len(out) >= MAX_TILES:
                    break
                left = max(0, int(cc * tile_w - ox))
                upper = max(0, int(rr * tile_h - oy))
                right = min(W, int((cc + 1) * tile_w + ox))
                lower = min(H, int((rr + 1) * tile_h + oy))
                crop = img.crop((left, upper, right, lower))
                if max(crop.size) > MAX_EDGE:
                    crop.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
                buf = io.BytesIO()
                crop.save(buf, format="PNG", optimize=True)
                out.append({
                    "label": f"page {pno + 1} — zoom tile row {rr + 1}/{nrow}, col {cc + 1}/{ncol}",
                    "b64": base64.standard_b64encode(buf.getvalue()).decode("utf-8"),
                })
    try:
        doc.close()
    except Exception:
        pass
    return out
