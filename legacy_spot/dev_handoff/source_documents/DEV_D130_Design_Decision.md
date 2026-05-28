# D-130 — SPC Logo on Quote / Cost Report Exports

**Status:** ASSET STAGED · Embed deferred to R1.5.8
**Affects:** `spot_r1_5.jsx` (Quote Header, Preview Quote, Cost Report rendering)
**Source asset:** `spc_logo.png` (in install bundle root, also in this DD package)

---

## Why

Customer-facing quotes and internal cost reports have shipped from R1.5 with text-only headers — "Standard Printing Company / 1115 Cherry Ave NE, Canton, OH 44704". Brand standards include the SPC horizontal logo with cube graphic. Previous releases never embedded it.

## What

Embed `spc_logo.png` as a base64 PNG inline in the JSX so it ships with the build (no external network dependency, works offline). Render in the header of:

- **Quote Header** modal preview
- **Preview Quote** export (PDF/HTML)
- **Cost Report** export (Internal Cost Report)

## Asset Notes

Source from estimator: `SP_Logo-horz-4C-white.png` (actually a JPEG mislabeled as PNG, RGB only, 2395×608, white text + colored CMYK cube on solid black background).

Processing applied (this session):
1. **Recolor white → black** so text reads on white-paper letterheads. Hexagon outline + "STANDARD PRINTING" word marks are now black.
2. **Cube colors preserved** (cyan top / magenta left / yellow right) — these are the brand-standard CMYK accents.
3. **Black background → transparent alpha** with luminance-feathered edges to hide JPEG compression artifacts.
4. **Output**: `spc_logo.png` 2395×608 RGBA, ~130 KB.

## Layout (R1.5.8)

Header band, top of page:
- **Left:** logo at ~80px height, aspect-preserved (~315×80)
- **Right:** address block in single column:
  ```
  STANDARD PRINTING COMPANY
  1115 Cherry Ave NE
  Canton, OH 44704
  ```
- **Below:** thin horizontal rule, then quote/report content

Embed via base64 data URI in JSX:
```jsx
const SPC_LOGO_B64 = "data:image/png;base64,iVBORw0K...";
<img src={SPC_LOGO_B64} alt="Standard Printing Company" style={{height:80, width:"auto"}} />
```

## What's NOT in This Ship

- No alternate logo sizes (use single asset, scale via CSS)
- No dark-mode variant (exports are always white-paper)
- No icon embed for browser tabs (already covered by `spot.ico` from R1.5.4)
- No print-style sheet adjustments — relies on existing print CSS

## Open Question for R1.5.8

The base64 string adds ~175 KB to the built HTML (33% increase from 950 KB → ~1.1 MB). Acceptable for offline-capable single-file build. If size becomes an issue later, can move to a separate `spc_logo.png` file served by `spot_server.js` and referenced as `http://localhost:3100/spc_logo.png`.
