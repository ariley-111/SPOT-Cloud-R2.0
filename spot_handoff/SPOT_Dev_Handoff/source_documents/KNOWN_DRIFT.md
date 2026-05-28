# Known Drift — Audit Findings (Updated 2026-04-27 after R1.5.10 ship)

This document tracks drift between project knowledge and the running localhost. After R1.5.10, the high-severity drift is resolved. Only minor cosmetic items remain.

---

## Drift item 1 — `spot_server.js` missing R1.5.7.3 parser/archive endpoints

**Status:** ✅ **RESOLVED in R1.5.10**

The real R1.5.7.3 server (1797 lines, SHA `f7d7f00181b4eda0`) is now in the install kit, with the R1.5.9 client-key patch baked in (3-edit minimal change to `anthropicParseRfqBatch` + `req_.apiKey` extraction). All 14 endpoints intact:

- `GET /` (index)
- `GET /api/health` (returns `version: "R1.5.10"`)
- `POST /api/freight` (UTS proxy)
- `GET /customers/search`, `POST /customers/refresh`, `GET /customers/:code`
- `POST /archive/upload`, `GET /archive/list`, `GET /archive/file`, `DELETE /archive/file`, `GET /archive/health`, `GET /archive/folders`
- `POST /est/parse-rfq` (now accepts optional `apiKey` in body — R1.5.10 patch)
- `GET /est/parser-budget`, `POST /est/reload-key`

Verified by `node --check` and endpoint enumeration. Operator (Michael) supplied the original R1.5.7.3 file from his localhost; integrity confirmed via SHA before patching.

---

## Drift item 1b — `customerList.csv` missing from project knowledge

**Status:** ✅ **RESOLVED in R1.5.10** (caught after R1.5.10 cut as "1b" because Michael's first R1.5.10 install showed `D-118: rowCount=0`)

The 384-customer export was bundled in past install kits (R1.5.4 through R1.5.7.1) but never persisted into project knowledge. When my R1.5.10 install kit shipped without it, fresh installs had `rowCount=0` and the customer typeahead + R1.5.10 auto-customer-lookup feature were both non-functional.

R1.5.10 install kit now bundles BOTH:
- `customerList.csv` — 384 rows, 15-column schema matching server parser exactly, SHA `9c41a30de202a3d8`
- `customerList.xlsx` — source-of-truth Excel, for refresh workflow

Both land at `<install>/` so they're picked up at server startup via candidate path #3. Refresh procedure: re-export from SharePoint, drop both files into install folder (or just the CSV), `fs.watch` triggers reload within ~5s. No restart needed.

---

## Drift item 2 — Missing R1.5.7.x release history entries

**Severity:** LOW. Documentation only.

**State:** `02_RELEASE_HISTORY.md` jumps from R1.5.6.1 to R1.5.8 to R1.5.9 to R1.5.10. Missing inline entries for: R1.5.7 (D-120 Phase 1), R1.5.7.1 (D-126 hotfix), R1.5.7.2 (D-127 + D-128), R1.5.7.3 (D-129 server backend).

**Cross-reference:** `01_OPEN_ISSUES.md` Recently Closed has full prose for D-120 Phase 1, D-126, D-127, D-128, D-129-server citing R1.5.7.x ship versions. The closures are documented; just not in the canonical release history file.

**Impact:** Cosmetic. Anyone reading release history would see R1.5.6.1 → R1.5.8 → R1.5.9 → R1.5.10 and wonder what happened in R1.5.7.x. The answer is in Recently Closed.

**Fix:** Future doc-sweep ship — backfill 4 entries between R1.5.6.1 and R1.5.8 sections. Source material is in the Recently Closed prose plus the four design docs (D-126/D-127/D-128/D-129).

---

## Drift item 3 — `build_spot_r1_5.js` static title was stale

**Status:** ✅ **RESOLVED in R1.5.8 ship.** Build script now emits `<title>SPOT R1.5.10</title>` (or whatever current ship is) plus three no-cache meta tags (`Cache-Control`, `Pragma`, `Expires`). Each new ship just bumps the version in line 43.

---

## Drift item 4 — Engine/runner version comments

**Status:** Stale but accurate. `spot_engine.js` line 2 says `// R1.5.6` and `spot_runner.js` line 3 says `// SPOT R1.5.6`. These comments are accurate — engine and runner have not been touched since R1.5.6. Optional annotation `(still current as of R1.5.10 — JSX/server-only ships in between)` could be added in a future doc-sweep, but no functional impact.

---

## Summary

| Drift | Status |
|---|---|
| 1. Server missing parser/archive endpoints | ✅ Resolved (R1.5.10) |
| 1b. customerList.csv missing from project knowledge | ✅ Resolved (R1.5.10 — bundled .csv + .xlsx) |
| 2. Missing R1.5.7.x release entries | Low priority — doc sweep TBD |
| 3. Build script stale title | ✅ Resolved (R1.5.8) |
| 4. Engine/runner comment freshness | Cosmetic — optional |

**No blocking drift remains.** The install kit is now truly fresh-installable end-to-end.
