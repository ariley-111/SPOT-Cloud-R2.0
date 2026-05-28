# 04 — Control Tables Reference

Every calibrated number in SPOT, with its source line, current value, and rationale. **The source files win when they disagree with this table.** When you change a number, update both.

---

## Machine Rates (the big four)

| Rate | Value | Source location | Why this value |
|---|---|---|---|
| Inca press | **$485/hr** | `spot_engine.js` `RATE_DEFAULTS.incaRate`; JSX L~62 mirror | D-110 FINAL (was $650→$470→$460→$485) |
| CAD cutting | **$138/hr** | `spot_engine.js` `RATE_DEFAULTS.cadRate` | D-110 FINAL (was $160) |
| Crest | **$45/hr** | `spot_engine.js` `RATE_DEFAULTS.crestRate` | Stable, machine + operator |
| Bobst | **$350/hr** | `spot_engine.js` `RATE_DEFAULTS.bobstRate` | D-121 UNCALIBRATED placeholder |

The Inca and CAD rates are the two most heavily exercised. Both were tuned under D-110 FINAL against the 773-job fleet baseline. Bobst is on placeholder pending 90 days of shop data or ≥30 Bobst jobs.

## Speeds

| Machine / mode | Speed | Source |
|---|---|---|
| Inca, Gloss | 75 sh/hr | `PRINT_SPEEDS.Gloss` — D-110 equalized (was 70) |
| Inca, Satin | 75 sh/hr | `PRINT_SPEEDS.Satin` — D-110 equalized (was 100) |
| Inca, OnQ Styrene | 50 sh/hr | `PRINT_SPEEDS["OnQ Styrene"]` |
| Inca, OnQ Lightbox | 40 sh/hr | `PRINT_SPEEDS["OnQ Lightbox"]` |
| CAD | 650 in/min | `RATE_DEFAULTS.cadSpeed` |
| Crest | 150 sh/hr | `RATE_DEFAULTS.crestSpeed` — Adv tier runs 80% slower |
| Bobst | 3,000 sh/hr | `RATE_DEFAULTS.bobstSpeed` — manufacturer spec |

The Gloss/Satin equalization under D-110 closed a calibration concern raised on 2026-04-21: Gloss at 70 vs Satin at 100 produced a pricing gap that didn't match observed press performance. Equalizing at 75 hit fleet sell within tolerance.

## Setup Times (CAD)

| Difficulty | Setup (min) | Fallback (min/sheet) | Source |
|---|---|---|---|
| Simple | 8 | 2 | `CAD_SETUP.Simple` / `CAD_FALLBACK.Simple` |
| Straight | 20 | 6 | `CAD_SETUP.Straight` / `CAD_FALLBACK.Straight` |
| Standard | 25 | 2 | `CAD_SETUP.Standard` / `CAD_FALLBACK.Standard` |
| Complex | 22 | 4 | `CAD_SETUP.Complex` / `CAD_FALLBACK.Complex` |

Were 10/15/25/25 setup and 2/3/4/5 fallback pre-D-110. Per-difficulty fleet calibration found the Straight tier was under-setup and the Complex tier was over-setup.

**D-106 difficulty rename:** Old labels were Simple / Standard / Complex / Extreme. Now Simple / Straight / Standard / Complex. The migration table `CAD_DIFF_MIGRATION` handles loaded estimates with old labels.

## Setup Times (Crest)

| Tier | Setup (min) | Notes |
|---|---|---|
| Std | 45 | `RATE_DEFAULTS.crestSetupStd` |
| Adv | 90 | `RATE_DEFAULTS.crestSetupAdv` |

Adv tier also runs the press at 80% speed (120 sh/hr instead of 150).

## Crest die default (D-121)

- `crestDieCost: "1200"` — was hardcoded "0" pre-D-121, now parameterized in RATE_DEFAULTS
- On any CAD→Crest transition, the D-085 trigger auto-sets `dieTreatment="Separate Line"` and `cuttingDieCost` to this default
- Crest↔Bobst transitions preserve the existing die cost (no auto-overwrite)

## Bobst route (D-121, UNCALIBRATED)

| Key | Value | Notes |
|---|---|---|
| `bobstRate` | "350" | $/hr placeholder |
| `bobstSpeed` | "3000" | sh/hr manufacturer spec |
| `bobstSetup` | "45" | min flat — no Std/Adv tiers |
| `bobstMinChg` | "250" | $ minimum charge |
| `bobstDieCost` | "1800" | $ default die cost |
| `bobstFirstSizing` | "true" | D-123: per-route sheet selection |

Eligibility: E or F flute only (0.060″ caliper limit); sheet within 13.78×15.75 to 41.75×29.125 envelope. Force-route on B/C flute is hard-blocked at the UI level — the toast refuses the override, no warning option.

## GM Curve (D-110 FINAL)

| MSF tier | GM | Sell default |
|---|---|---|
| 0–1 | 50% | $600/MSF |
| 1–3 | 37% | $500/MSF |
| 3–5 | 32% | $450/MSF |
| 5–9 | 27% | $400/MSF |
| 10–24 | 25% | $375/MSF |
| 25–49 | 25% | $325/MSF |
| 50–74 | 25% | $300/MSF |
| 75–99 | 25% | $285/MSF |
| 100+ | 25% | $260/MSF |

Source: `GM_DEFAULTS` and `SELL_DEFAULTS` in `spot_engine.js`. The 25% floor from 10 MSF onward is a P5 planned deviation — preventing iQuote-style volume giveaways. Was 52/46/42/32/28 in earlier calibration.

## Fees

| Fee | Value | Source / notes |
|---|---|---|
| `under5MsfFee` | $0 | Rule 3. WF shop doesn't carry this. Was $500 pre-D-089. |
| FSC/SFI | $25 | Amortized into board. $15→$25 migration fires on load (D-086). |
| Ink | $0.05/sqft | LOCKED business decision. Not a calibration target. `regularInkRate` in RATE_DEFAULTS. |
| Paper uplift | +10% baked into `base_matrix` | D-102. Not a user-settable field. |

## SPCOC Freight Zones (D-119)

| Zone | Rate | Coverage |
|---|---|---|
| Canton ZIPs | $45 | Local |
| Akron ZIPs | $70 | Near |
| Cleveland ZIPs | $95 | Regional |

Gate: ≤10,000 lbs **AND** ≤24 trailer-ft. Above either threshold → UTS API fallback. 15% markup applied client-side, visible/editable.

## Liners (customer term → SPC code)

| Customer term | SPC liner | Notes |
|---|---|---|
| ⚠️ **CKB** / Corrugated Kraft Board | 42# Kemi-Lite | **SPC-specific. NOT industry CKB.** |
| MW / Mottled White | 42# Kla-White | Maps to Kla-White, NOT Bleached |
| Kemi / Kemi-Lite / clay coat | 42# Kemi-Lite | Default clay-coated kraft |
| White outside (generic) | 42# Kla-White | Unless RFQ says "bleached" or "bright" |
| Bleached / bright white | 42# Bleached White | +$17.50/MSF upgrade |
| Kraft / brown | Kraft | Default, no upgrade |
| 33# Kla-White upgrade | 33# Kla-White | Allowed on 175 / ECT 32 only |
| 56# Kla-White upgrade | 56# Kla-White | Allowed on 250 only |
| Graphic White | **OPEN — EST-GRPHCWHT** | Pending estimator decision |

Source: `liner_upgrades` in `spot_engine.js` plus the canonical terms registry.

## Route Limits

| Route | Constraint |
|---|---|
| CAD | All flutes, all sheet sizes in full library |
| Crest | All flutes, sheet ≤ 60 × 120 |
| Bobst | E or F flute only, sheet 13.78×15.75 to 41.75×29.125 |

Route comparison panel visible only when both CAD and Crest are viable (D-090). Forced-route UI stays mounted after Switch; Reset to Auto is available (D-097).

## Stock Sheets vs Custom Boards

| Source | Buy Min applies? |
|---|---|
| Stock sheet (from Sheet Library) | NO — bypasses Buy Min per D-067 |
| Custom board | YES |
| Forced board | YES |

## Metadata

| Field | Default | Manual edit? |
|---|---|---|
| Initials | "SPC" for AI estimates | **BLOCKED** (Rule 2) |
| FOB | Origin | Yes, customer request |
| Print finish | Satin (Rule 8 / D-105) | Yes, customer request |
| `under5MsfFee` | "0" | No — Rule 3 |
| `routeOverride` | (omit) | No — Rule 1, UI-only forcing |

## Archive Constants (D-120)

| Constant | Value | Source |
|---|---|---|
| `ARCHIVE_ROOT` | `/home/claude/SPOT_QUOTES` (env-overridable via `SPOT_ARCHIVE_ROOT`) | `spot_server.js` |
| `MAX_FILE_BYTES` | 52,428,800 (50 MB per file) | `spot_server.js` |
| `MAX_FILES_PER_DROP` | 20 | `spot_server.js` |
| `EXEC_DENYLIST` | .exe .bat .cmd .msi .com .scr .ps1 | `spot_server.js` |
| `RFQ_CLASS_EXTS` | .pdf .png .jpg .jpeg .gif .webp .eml .msg .docx .xlsx .xls | `spot_server.js` |
| `EST_NUM_RX` | `^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$` | `spot_server.js` |

Folder layout: `{ARCHIVE_ROOT}/{YYYY}/{Customer}_{EstNum}/`. Customer name normalization: illegal Windows chars (`/ \ : * ? " < > |`) → `_`, trailing whitespace stripped, trimmed to 30 chars.

## Fleet Calibration (locked, D-110 FINAL)

Validated against 773-job subset of 785-job iQuote dataset:

| Metric | Value |
|---|---|
| Segment Cost R² (flute × MSF) | 0.9690 |
| Segment Sell R² (flute × MSF) | 0.9496 |
| Segment Cost R² (grade × flute × MSF, 31 segs) | 0.9740 |
| Segment Sell R² (grade × flute × MSF, 31 segs) | 0.9653 |
| Per-job Cost R² | 0.8550 |
| Per-job Sell R² | 0.8360 |
| Fleet total cost delta | +6.55% |
| Fleet sell premium vs iQuote | +8.30% (target +8.2%) |
| Margin lift | +$76,488 on 773-job fleet |

Three B Kemi MSF tiers out-of-tolerance on sell (1-3 by 0.6pt, 5-9 by 3.5pt, 10-24 by 7.2pt). Accepted for deployment with monitoring per Board Report recommendation.

## Window globals (debug/automation)

| Global | Purpose |
|---|---|
| `window.__SPOT_UI_VERSION` | Version string, e.g. "R1.6.5.1" |
| `window.__SPOT_SESSION_LOG` | Append-only event log |
| `window.__SPOT_LOG_EVENT(name, payload)` | Programmatic logger |
| `window.__SPOT_LOAD_JSON(obj)` | Scripted JSON load (Chrome MCP entry point) |

---

## Source of truth precedence

If this table disagrees with the engine source, **the engine source wins**. Update the table to match, file a D-### in `01_OPEN_ISSUES.md` describing the drift, do not silently re-edit.

For SPC-specific token meanings, the authoritative source is `EST_SPOT_Canonical_Terms.md` (in source documents). Customer-term-to-SPC-code rows in this table defer to that registry when they conflict.

Last calibration audit (2026-04-25, D-110 FINAL verification): all values above confirmed against source files. Last R1.6.5 ship audit: SHAs matched ledger entries.
