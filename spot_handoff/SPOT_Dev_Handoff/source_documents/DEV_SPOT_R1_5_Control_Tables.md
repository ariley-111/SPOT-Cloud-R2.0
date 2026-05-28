# SPOT R1.5.6 — Control Tables

> All calibrated rates, defaults, and business rules. Updated 2026-04-26 (D-122 Advanced Rates UI inputs + D-123 Bobst-first sheet sizing; covers D-058 through D-123 including D-110 FINAL fleet calibration, D-117 R1.5.4 point fixes, D-118 customer auto-populate + ship-to memory + late-additions reapply, D-119 SPCOC freight zones, D-121 Bobst route, D-122 Advanced Rates UI, D-123 Bobst-first sheet sizing).
> **Canonical terms: see `EST_SPOT_Canonical_Terms.md`.** This document lists numbers; the registry disambiguates SPC-specific token meanings.

---

## Machine Rates

| Machine | Rate | Default |
|---------|------|---------|
| Inca (press) | $485/hr | D-110 FINAL (was $650 → $470 → $460 → $485). 75 sh/hr Gloss and Satin (equalized per D-110). |
| CAD (cutting) | $138/hr | D-110 FINAL (was $160). 650 in/min speed. "CAD" here is a route name — see `EST_SPOT_Canonical_Terms.md`. |
| CAD setup (min) | Simple 8 / Straight 20 / Standard 25 / Complex 22 | D-110 FINAL per-difficulty (was 10/15/25/25). Engine L103, JSX L109. |
| CAD fallback (min/sheet) | Simple 2 / Straight 6 / Standard 2 / Complex 4 | D-110 FINAL per-difficulty (was 2/3/4/5). Engine L104, JSX L110. |
| CAD trim multiplier | 1.15× | On rule inch calculations |
| Crest | $45/hr | 150 sh/hr, Std 45 / Adv 90 min setup. Flat-bed die cutter — see `EST_SPOT_Canonical_Terms.md`. **D-121 (2026-04-26):** default die cost parameterized as `crestDieCost` in RATE_DEFAULTS at $1,200 (was hardcoded "0" estimator placeholder). Operator-editable in Advanced Rates. |
| Bobst | $350/hr | **D-121, UNCALIBRATED placeholder.** 3,000 sh/hr, 45 min flat setup (no Std/Adv buckets), $250 minimum charge, $1,800 default die cost. Eligibility: E or F flute only (0.060″ caliper limit), sheet within 13.78×15.75 to 41.75×29.125 envelope. Auto-route preference Bobst→Crest→CAD when all viable. Recalibrate after 90 days of shop-floor data OR ≥30 Bobst jobs, whichever first. See `DEV_D121_Design_Decision.md`. |

---


## Routes

| Route | Setup | Speed | Hourly | Min charge | Default die | Difficulty buckets | Eligibility |
|-------|-------|-------|--------|------------|-------------|--------------------|-------------|
| CAD | Simple 8 / Straight 20 / Standard 25 / Complex 22 (min) | 650 in/min | $138/hr | $0 | n/a (no die required) | Simple/Straight/Standard/Complex | All flutes, all sheet sizes within full library |
| Crest | Std 45 / Adv 90 (min) | 150 sh/hr (Adv 80% slowdown) | $45/hr | $0 | **$1,200 (D-121)** | Std/Adv | All flutes, sheet ≤ 60×120 |
| **Bobst** | **45 (flat)** | **3,000 sh/hr** | **$350/hr** | **$250** | **$1,800** | **None — flat pricing** | **E or F flute only, sheet 13.78×15.75 to 41.75×29.125** |

Auto-route preference (when multiple viable): **Bobst → Crest → CAD**. Bobst-ineligible jobs route through unchanged CAD/Crest logic. Force-route hard-blocks B/C flute (physical constraint) and out-of-envelope sheets — toast and refuse the override, do not warn.

**Sheet selection order (D-123, 2026-04-26):** For E/F flute jobs, sheet selection is run **per route** rather than once globally. Bobst tries its own envelope-eligible custom-imposition sheet (with mill-min-buy scaling for below-min orders); CAD and Crest each pick their own optimal sheets through their existing logic. Totals are then compared route-by-route, and the cheapest viable route wins. Operator override: `bobstFirstSizing="false"` in RATE_DEFAULTS reverts to the D-121 single-sheet behavior where Bobst is evaluated against CAD's chosen sheet (so it loses by default if that sheet exceeds the Bobst envelope). UI toggle in Advanced Rates / Cutting / "Bobst-First Sizing".

**Default die cost handling (D-121, post-D-085):** Both Crest and Bobst now have parameterized default die costs in RATE_DEFAULTS (`crestDieCost`, `bobstDieCost`). On any CAD→Crest or CAD→Bobst transition, the D-085 trigger auto-sets `dieTreatment="Separate Line"` and `cuttingDieCost` to the route-specific default. Crest↔Bobst transitions preserve the existing die cost (no auto-overwrite).

**RATE_DEFAULTS (D-122 / D-123 additions):**

| Key | Default | Notes |
|---|---|---|
| `crestDieCost` | "1200" | Default die cost for Crest auto-die trigger (D-121). UI: Advanced Rates → Cutting → "Crest Die Default $". |
| `bobstRate` | "350" | $/hr, uncalibrated placeholder (D-121). UI: "Bobst $/Hr". |
| `bobstSpeed` | "3000" | sh/hr, manufacturer spec (D-121). UI: "Bobst Speed sh/hr". |
| `bobstSetup` | "45" | min flat (D-121). UI: "Bobst Setup min". |
| `bobstMinChg` | "250" | $ minimum charge (D-121). UI: "Bobst Min $". |
| `bobstDieCost` | "1800" | Default die cost for Bobst auto-die trigger (D-121). UI: "Bobst Die Default $". |
| `bobstFirstSizing` | "true" | D-123 sheet-selection toggle. "true" = per-route sheet selection (Bobst gets its own envelope-eligible sheet); "false" = D-121 CAD-shaped single-sheet behavior. UI: "Bobst-First Sizing" tile pair. |

## Fees and charges

| Fee | Value | Notes |
|-----|-------|-------|
| under5MsfFee | $0 | Corrugator charge, does not apply to WF. Was $500 pre-D-089. |
| FSC/SFI | $25 | Amortized into board. Was $15; D-086 wired the $15→$25 migration on load. |
| Ink | $0.05/sqft | Business decision, LOCKED. Not a calibration target. |
| **Paper uplift** | **+10% baked into `ENGINE.base_matrix`** | **Applied at 2026-04-14 calibration pass. Not a user-settable field. All board prices in engine.js are post-uplift. Retroactively documented 2026-04-21 (D-102). See `DEV_D102_Paper_Uplift_Documentation.md`. Canonical definition in `EST_SPOT_Canonical_Terms.md`.** |

---

## Liners — customer-term to SPC-token mapping

Customers and RFQs use a mix of abbreviations and trade names. SPC liner codes are narrower than industry-standard liner terminology. When a customer term has an SPC-specific meaning that diverges from industry-standard usage, it is flagged ⚠️ and the authoritative definition lives in `EST_SPOT_Canonical_Terms.md`.

| Customer term | SPC liner | Notes |
|---------------|-----------|-------|
| ⚠️ **CKB** / Corrugated Kraft Board | **42# Kemi-Lite** | SPC-specific. Customer's "CKB" is NOT the industry's Clay-Coated Bleached Kraft folding-carton grade. See `EST_SPOT_Canonical_Terms.md`. |
| MW / Mottled White | 42# Kla-White | Maps to Kla-White at SPC, NOT to Bleached White. |
| Kemi / Kemi-Lite / clay coat | 42# Kemi-Lite | SPC's default clay-coated kraft liner. |
| White outside (generic) | 42# Kla-White | Unless the RFQ says "bleached" or "bright white". |
| Bleached / bright white | 42# Bleached White | +$17.50/MSF upgrade. |
| Kraft / brown | Kraft | Default, no upgrade charge. |
| 33# Kla-White upgrade | 33# Kla-White | Allowed on 175 / ECT 32 only (engine `allowed_board_grades`). |
| 56# Kla-White upgrade | 56# Kla-White | Allowed on 250 only. |
| Graphic White | **OPEN — EST-GRPHCWHT** | Pending estimator decision. Likely a variant of Kla-White or Bleached White. Do not resolve from training-data priors. |

Source of truth: `spot_engine.js` `liner_upgrades` (lines ~57–61) + `EST_SPOT_Canonical_Terms.md`.

---

## Print finishes

| Finish | Default | Notes |
|--------|---------|-------|
| Satin | YES | SPC default per Rule 8 / D-105 (flipped from Gloss → Satin 2026-04-21). Always default unless customer specifies otherwise. **D-114 closed in R1.5.6 (2026-04-26):** the residual `defaultPrintMode:"Gloss"` in `spot_engine.js` (an unused field — engine reads `prod.printMode` / `opts.printMode` from caller, never the RATE_DEFAULTS value) was flipped to `"Satin"` for consistency. No behavior change because the field was dead. |
| Gloss | No | Valid selection when customer requests it. Was prior default; flipped under D-105 as a business decision. D-110 FINAL equalized Gloss/Satin press speeds at 75 sh/hr — no pricing delta between finishes. |
| Matte | No | Specialty only. |
| Digital Print — Gloss Finish | available | |
| Digital Print — Satin Finish | available | (spelling verified on disk) |

---

## FOB

| FOB | Default | Notes |
|-----|---------|-------|
| Origin (ZIP 44704) | YES | Default unless customer explicitly requests Destination. |
| Destination | No | Customer request only. |

---

## Board / ECT

| ECT | Status | Notes |
|-----|--------|-------|
| 32 | Standard | |
| 44 | Uncommon | D-098 shipped the Multi-Part fallthrough half only; the ECT 44 grade-selection guardrail (popup on load + mill substitute) was scoped in the release notes but was never implemented. No popup code, no mill-substitute selector in current source (verified 2026-04-21). Open work tracked as DEV-011 in `01_OPEN_ISSUES.md`, target R1.6. Until shipped: ECT 44 loads silently and the estimator must eyeball the grade. SPC substitution policy when eventually implemented will substitute DOWN to Mullen 200# stock (grade fallback) — NOT across to another ECT grade. See `EST_SPOT_Canonical_Terms.md`. |
| 48 | Standard | |
| 51 | Standard | |
| 55 | Standard | |
| 61 | Standard | |
| 71 | Standard | |
| 82 | Standard | |

ECT grades run on Mullen sheets (grade fallback). Do not show substitution on customer-facing quotes.

---

## GM curve (D-110 FINAL, 2026-04-24)

| MSF tier | GM % |
|----------|------|
| 0–1 | 50% |
| 1–3 | 37% |
| 3–5 | 32% |
| 5–9 | 27% |
| 10+ | 25% |

P5 planned deviation — GM floors at 5+ MSF prevent iQuote-style volume giveaways (83 iQuote jobs priced below 20% GM at 5+ MSF). See `DEV_D110_Design_Decision.md`.

**D-113 (OPEN):** Pre-D-110 GM curve (48/42/36/30/25) may be cached in localStorage under `wf_default_pricing_targets`. Auto-migrate on load needed (mirror FSC $15→$25 pattern). Until D-113 ships, any machine that ran SPOT before D-110 FINAL and hasn't had `__TC_RESET_DEFAULTS()` run is quoting at old margins.

---

## State management

| Function | Pattern | Ship |
|----------|---------|------|
| applyState (single-part) | reset-first (full state replace) | D-080 (2026-04-14) |
| applyItemState (Multi-Part item switch) | reset-first | D-087 (2026-04-14) |
| applyState Multi-Part fallthrough | reset-first per item, no inheritance from previous item | D-098 (2026-04-16) |
| gatherState | active-item sync; bomItems[activeIdx] current on save | D-081 (2026-04-14) |

---

## Routing

| Rule | Value |
|------|-------|
| Route auto-selection | CAD vs Crest based on CAD hours + sheet imposition |
| Crest max piece | 60×120 (after rotation check) |
| Crest setup Std / Adv | 45 / 90 min |
| Crest → die auto-default | Separate Line $0 on first Crest routing (D-085) |
| Route Comparison panel | Visible only when both routes viable (D-090) |
| Forced-route UI | Panel persists after Switch; Reset to Auto available (D-097) |
| routeOverride in JSON | NEVER. UI-only forcing. |

---

## Stock sheets vs custom boards

| Source | Buy Min applies? |
|--------|------------------|
| Stock sheet (from Sheet Library) | NO (bypasses Buy Min per D-067) |
| Custom board | YES |
| Forced board | YES |

---

## Metadata

| Field | Default | Manual edit? |
|-------|---------|--------------|
| Initials | "SPC" for AI estimates | BLOCKED |
| FOB | Origin | Yes, customer request |
| Print finish | Satin (per Rule 8 / D-105 flipped 2026-04-21) | Yes, customer request |

---

## Window globals (debug / automation)

Shipped D-092 through D-094 (2026-04-15).

| Global | Purpose |
|--------|---------|
| `window.__SPOT_UI_VERSION` | Version string, e.g., `"R1.5.6"` |
| `window.__SPOT_SESSION_LOG` | Append-only event log for the session |
| `window.__SPOT_LOG_EVENT(name, payload)` | Programmatic event logger |
| `window.__SPOT_LOAD_JSON(obj)` | Scripted JSON load (bypass file picker) |

Runner parity note: these are UI-only globals. Runner has no DOM. See `DEV_Runner_vs_JSX_Parity_Audit.md` (D-104).

---

## Fleet calibration (locked R1.5.3 — D-110 FINAL, 2026-04-24)

Validated against 773-scoreable-job subset of 785-job iQuote dataset. Full methodology: `DEV_Calibration_Framework_v2.md`. Design rationale: `DEV_D110_Design_Decision.md`.

- Segment Cost R² (flute × MSF): 0.9690
- Segment Sell R² (flute × MSF): 0.9496
- Segment Cost R² (grade × flute × MSF, 31 segs): 0.9740
- Segment Sell R² (grade × flute × MSF, 31 segs): 0.9653
- Per-job Cost R²: 0.8550
- Per-job Sell R²: 0.8360
- Fleet total cost delta: +6.55% (within 0% to +20% tolerance)
- Fleet sell premium: +8.30% (target +8.2%, within ±2pt tolerance — P1 planned deviation)
- Margin lift: +$76,488 on 773-job fleet vs iQuote
- Paper uplift component: +10% baked into `ENGINE.base_matrix` (D-102)

Three B Kemi MSF tiers OOT on sell (1-3 by 0.6pt, 5-9 by 3.5pt, 10-24 by 7.2pt). Root-caused to volume-job cost overshoot amplified by fixed GM. Accepted for deployment with monitoring per Board Report recommendation.

> **Historical note (superseded):** The R1.5.2 baseline (pre-D-110) was R² 0.974 on 785 jobs, fleet total cost delta +2.8%. The 2026-04-21 Satin spot-check concern (Gloss 70 vs Satin 100 sh/hr pricing gap) was resolved by D-110 FINAL which equalized both at 75 sh/hr. DEV-010 and EST-RECALIB-02 are CLOSED.

> **D-123 calibration impact (2026-04-26):** No engine constants modified. Bobst rates unchanged (still uncalibrated placeholders per D-121). Fleet regression expected to remain at R² 0.974 because no historical job routes to Bobst (the 785-job iQuote fleet has zero Bobst-eligible E-flute pieces). Re-run `fleet_compare.js` post-deploy as a sanity check; flag any drift > 0.005.

---

## Archive (D-120 Phase 1, R1.5.7)

| Constant | Value | Source |
|----------|-------|--------|
| `ARCHIVE_ROOT` | `/home/claude/SPOT_QUOTES` (default) | `spot_server.js` — env-overridable via `SPOT_ARCHIVE_ROOT` |
| `MAX_FILE_BYTES` | 52428800 (50 MB per file) | `spot_server.js` |
| `MAX_FILES_PER_DROP` | 20 | `spot_server.js` |
| `EXEC_DENYLIST` | `.exe .bat .cmd .msi .com .scr .ps1` | `spot_server.js` |
| `RFQ_CLASS_EXTS` | `.pdf .png .jpg .jpeg .gif .webp .eml .msg .docx .xlsx .xls` | `spot_server.js` |
| `EST_NUM_RX` | `^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$` | `spot_server.js` |

**Folder layout:** `{ARCHIVE_ROOT}/{YYYY}/{Customer}_{EstNum}/`. Customer name normalization: illegal Windows chars (`/ \ : * ? " < > |`) → `_`, trailing whitespace stripped, trimmed to 30 chars max. Example: `International Paper Container Division` + `SPC-260426-003` → `International Paper Container_SPC-260426-003`.

**Per-folder `meta.json` schema:** `{estNum, custName, custCode, folderName, createdAt, updatedAt, files:[{filename, originalName, size, mime, class, sha256, uploadedAt}], phase1, parserStatus, syncStatus}`. Phase 1 always emits `phase1: true`, `parserStatus: "deferred"`, `syncStatus: "local-only"` for the future Phase 2 sync sweep.

**File class rule:** ext in `RFQ_CLASS_EXTS` → `class: "rfq"` (parser-eligible in Phase 1B). Otherwise → `class: "asset"` (archive-only). Anything in `EXEC_DENYLIST` is rejected at upload.

**Endpoints:**
- `POST /archive/upload` — multipart with fields `estNum`, `custName`, `custCode?`, repeated `files`
- `GET /archive/list?folder={folderName}&year=?` — returns `{folder, year, exists, files, meta}`
- `GET /archive/file?folder=&filename=&year=?` — returns file bytes with proper Content-Type
- `DELETE /archive/file?folder=&filename=&year=?` — removes file + updates meta.json
- `GET /archive/health` — returns `{root, exists, writable, folderCount}`

**Phase boundaries:** Phase 1 = drop UI + archive write + manifest + Tier 1 previews (this ship). Phase 1B = Anthropic API parser (`POST /est/parse-rfq`, awaiting API key + $500/mo cap). Phase 2 = SharePoint sync `/home/claude/SPOT_QUOTES/` → `https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/` + retrieval/browse UI.

---

## Source of truth

If any value here disagrees with `spot_engine.js`, `spot_runner.js`, or the engine section of `spot_r1_5.jsx`: the source files win. Update this table, not the code. File a D-### in `01_OPEN_ISSUES.md` describing the drift.

For SPC-specific token meanings (as opposed to numeric values), the authoritative source is `EST_SPOT_Canonical_Terms.md`. Rows here that map customer terms to SPC codes defer to that registry when they conflict.

Last consolidation audit (2026-04-20): no drift between this table and source files. incaRate=460, under5MsfFee=0, fscFee=25 all verified.
Last documentation audit (2026-04-21): ECT 44 row corrected; paper uplift row added; liners mapping table added; Satin-default spot-check note added.
Last calibration audit (2026-04-25): D-110 FINAL values verified against source. incaRate=485, cadRate=138, GM 50/37/32/27/25, PRINT_SPEEDS 75/75, CAD_SETUP 8/20/25/22, CAD_FALLBACK 2/6/2/4, E flute upcharge $0, under5MsfFee=0, fscFee=25 all confirmed. D-117 applied: printMode default Satin, GM localStorage migration, noSheet crash guard.
Last R1.5.6 ship audit (2026-04-26): D-122 + D-123 + D-118-late-additions reapply + D-114-engine-leftover flipped. SHAs (post-deploy verification target): jsx `a643cac0c60f`, engine `5ff7594d031a`, runner `8001c3a2d87d`, server `1cb6426bbd22`, fleet_compare `db6b89e4` (unchanged).
Last R1.5.7 ship (2026-04-26): D-120 Phase 1 drop-zone scaffolding. New Archive section above. Engine math unchanged. SHAs (post-deploy verification target): jsx `a96bda696e8439f7`, server `0de9817399141f73`, build_spot_r1_5 `1163985329add8f3`, html `7992f64b92762daa`. Engine, runner, fleet_compare, customerList.csv unchanged from R1.5.6.


