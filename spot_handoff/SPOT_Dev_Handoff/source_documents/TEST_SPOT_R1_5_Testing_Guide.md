# SPOT R1.5.3 — Testing Channel: Estimating Validation Guide

> Purpose: Systematic test coverage of every routing choice, board selection path, liner substitution, pricing tier, and edge case in the SPOT estimating engine.
> Audience: Testing channel AI assistant or human tester.
> Updated: 2026-04-25 — R1.5.3 deployed (D-109 version bump, D-110 FINAL calibration, D-111 fleet_compare fix, D-112 estNum fallback). TC-018–025 CLOSED via chowder run 2026-04-25.

---

## 1. HOW TO TEST

### Setup
- SPOT running at localhost:3100 (start via `START_SPOT.bat` or `node spot_server.js`)
- Chrome open to localhost:3100
- Each test: push JSON into SPOT via Load, read results, compare to expected.

### Version sanity at session start
- DevTools console: `window.__SPOT_UI_VERSION` → expect `"R1.5.3"`.
- If the version differs, stop and reconcile against `02_RELEASE_HISTORY.md` before running any TC.

### Result logging
- PASS/FAIL with actual values.
- Failures: file name, line, expected vs actual, reproduction steps → append to `01_OPEN_ISSUES.md` as a new D-### or TC-### row.
- Shipped closures: move the row to `02_RELEASE_HISTORY.md`.

---

## 2. CURRENT TEST CASE COVERAGE (R1.5.3)

| TC | Target | Status | Spec location |
|----|--------|--------|---------------|
| TC-001..TC-017 | Core engine + routing | PASS (pre-existing) | `TEST_SPOT_R1_5_UI_Test_Suite.md` |
| TC-015 | BCI 91-9013 routing | PASS 27/27 (2026-04-16) | `02_RELEASE_HISTORY.md` |
| TC-018 | D-080 applyState reset-first | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-019 | D-085 Crest→die auto-default | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-020 | D-086 FSC wiring | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-021 | D-087 applyItemState reset-first | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-022 | D-092/093/094 window globals | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-023 | D-090 Route Comparison baseline | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-024 | D-097 Forced-route panel persistence | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-025 | D-098 Multi-Part fallthrough | **PASS** (2026-04-25 chowder) | `TEST_SPOT_R1_5_Chowder_Specs.md` |
| TC-026 | D-106 rename + migration regression | PASS (2026-04-21) | `02_RELEASE_HISTORY.md` |

D-080 through D-098 shipped in R1.5.2. D-109 shipped as R1.5.3 version bump. D-110 FINAL calibration applied. For per-fix descriptions, cross-reference `02_RELEASE_HISTORY.md` — do not re-spec here.

---

## 3. REGRESSION SUITE (REG-01 through REG-11)

The 11 regressions guard core engine contracts. Run after any source change to `spot_engine.js`, `spot_runner.js`, or the engine section of `spot_r1_5.jsx`.

| REG | Guards | Trigger |
|-----|--------|---------|
| REG-01 | Inca rate **$485** (D-110 FINAL) in engine + runner + JSX defaults | Any D-### touching rates |
| REG-02 | under5MsfFee $0 | Any D-### touching fees |
| REG-03 | FSC/SFI $25 + migration on load | Any D-### touching FSC |
| REG-04 | applyState reset-first (single-part) | Any D-### touching applyState |
| REG-05 | applyItemState reset-first (Multi-Part) | Any D-### touching applyItemState |
| REG-06 | autoRoute CAD vs Crest agreement (runner ↔ app) | Any D-### touching routing |
| REG-07 | ECT grade map includes 32/44/48/51/55/61/71/82 | Any D-### touching board |
| REG-08 | Stock sheets bypass Buy Min | Any D-### touching Buy Min |
| REG-09 | GM curve **50/37/32/27/25** (D-110 FINAL) by MSF tier | Any D-### touching pricing strategy |
| REG-10 | Ink locked at $0.05/sqft | Any D-### touching ink |
| REG-11 | Initials = "SPC", blocked from manual entry | Any D-### touching initials / metadata |

Run via `node spot_runner.js` with the REG fixture set in `/test_fixtures/reg/`.

---

## 4. FLEET REGRESSION — Post D-110 FINAL Baseline

Fleet regression runs the 773-scoreable-job subset of the 785-job iQuote dataset (`WF_Quoting_Tool_Test_Data.xlsx`) through `DEV_fleet_compare.js` and diffs against iQuote baselines.

**Methodology**: See `DEV_Calibration_Framework_v2.md` for the 9-step playbook. Report segment-level R² as primary metric, not per-job R².

### Expected fleet metrics (D-110 FINAL baseline — 2026-04-24)

| Metric | Expected | Tolerance |
|---|---|---|
| Jobs scored | 773 of 785 (98.5%) | ±2 jobs |
| Fleet cost Δ | +6.55% | ±0.5% |
| Fleet sell Δ | +8.30% | ±0.5% |
| Per-job cost R² | 0.8550 | ±0.02 |
| Per-job sell R² | 0.8360 | ±0.02 |
| **Segment cost R²** (flute × MSF) | **0.9690** | ±0.02 |
| **Segment sell R²** (flute × MSF) | **0.9496** | ±0.02 |
| Segment cost R² (grade × flute × MSF, 31 segs) | 0.9740 | ±0.02 |
| Segment sell R² (grade × flute × MSF, 31 segs) | 0.9653 | ±0.02 |

### Expected component deltas (tolerance bands per `DEV_D110_Design_Decision.md`)

| Component | Expected | Tolerance Band |
|---|---|---|
| Material | +11.4% | +8% to +12% (±2pt of +10%) |
| Ink | +54.8% | (P4 planned — no check) |
| Press | −0.5% | −5% to +5% |
| Cutting | −2.8% | −5% to +5% |
| Glue | +7.0% | −10% to +10% |
| Total fleet cost | +6.55% | 0% to +20% |
| Fleet sell premium | +8.30% | +6% to +10% (±2pt of +8%) |

### Expected per-tier B Kemi sell (±3pt of +8% = +5% to +11%)

| Tier | Jobs | Sell Δ | Status |
|---|---|---|---|
| B 0-1 MSF | 82 | +8.7% | ✓ IN |
| B 1-3 MSF | 69 | +11.6% | ✗ OUT by 0.6pt (known, monitored) |
| B 3-5 MSF | 37 | +9.2% | ✓ IN |
| B 5-9 MSF | 37 | +14.5% | ✗ OUT by 3.5pt (thin sample, monitored) |
| B 10-24 MSF | 13 | +18.2% | ✗ OUT by 7.2pt (thin sample, monitored) |

### Ship-blocker criteria

**If any of the following deviate from the expected values above by more than listed tolerance, flag for investigation BEFORE shipping:**
- Segment cost R² drops below 0.95
- Segment sell R² drops below 0.93
- Any cost component exceeds ±2pt tolerance band
- Fleet sell premium drops below +6% or exceeds +10%
- Material component deviates from +10% target by >2pt
- New per-tier B Kemi sell tier becomes OOT (beyond the 3 known OOT tiers above)
- iQuote giveaway count (jobs <20% GM at 5+ MSF) changes significantly

### iQuote giveaway audit (part of fleet regression)

Standard check: count iQuote jobs with implied GM < 20% at 5+ MSF tiers. Expected at D-110 FINAL: **83 jobs** (56 at 5-9 MSF, 21 at 10-24 MSF, 6 at 25+ MSF). SPOT's 25-27% GM floors reject this pattern — P5 planned deviation. Document in the release PDF validation reports.

### Running the fleet regression

```bash
node DEV_fleet_compare.js ./WF_Quoting_Tool_Test_Data.xlsx
```

Outputs:
- CSV of per-job results with cost/sell deltas
- JSON summary with fleet totals, component breakdowns, R² values

---

## 5. TEST FIXTURES

All fixtures live under `/test_fixtures/` on the server. Naming convention:

- `TCnnn_<short_name>.json` — single-case fixtures (e.g., `TC025_ECT44.json`).
- `REGnn_<short_name>.json` — regression fixtures (e.g., `REG01_IncaRate.json`).
- `FLEET_iQuote_785.csv` — fleet baseline (external; not in project knowledge yet).

Fixtures are SPOT load JSON — same schema as any saved estimate.

---

## 6. WHEN A TEST FAILS

1. Do not modify the source.
2. Capture: DOM state, console errors, `window.__SPOT_SESSION_LOG` dump, expected-vs-actual numbers.
3. File a D-### in `01_OPEN_ISSUES.md` with the reproduction.
4. Hand off to Dev channel (MODE: DEV).
5. After Dev ships the fix: re-run the TC, update the TC row with result, move to `02_RELEASE_HISTORY.md` if PASS.

---

## 7. WHEN A TEST PASSES

1. Update the TC row in `01_OPEN_ISSUES.md` with PASS + date + version.
2. Move the row to `02_RELEASE_HISTORY.md` under the active release's "Test Case Closures" table.
3. Do not delete the old row. Move it.

---

## 8. VERSION / SHA cross-reference

Current R1.5.4 source (D-110 FINAL + D-111 + D-112 + D-117 + D-119 + D-118 final applied):
- `spot_r1_5.jsx` — 7,654 lines, SHA `6abf9ab182035cb7`
- `spot_engine.js` — 1,001 lines, SHA `51992bba2682de1f`
- `spot_runner.js` — 352 lines, SHA `e5af029ca5bf979c`
- `spot_server.js` — 553 lines, SHA `47a42cd0fe89445b`
- `build_spot_r1_5.js` — 57 lines, SHA `5f5aed3afa23d913`
- `fleet_compare.js` — 366 lines, SHA `db6b89e4e55c81bd`
- `SPOT_R1.5.html` — deployed, SHA `b1649e685f4d033d`
- `customerList.csv` — 385 lines (384 customers + header), SHA `08e31e001f0b85ff`

Verification: `incaRate` = `"485"` and `GM_DEFAULTS["0-1"]` = 0.50 confirms D-110 FINAL. `RATE_DEFAULTS.defaultPrintMode` = `"Satin"` confirms D-114. `window.__SPOT_UI_VERSION` = `"R1.5.4"` confirms D-118 version bump. `SPCOC_ZONES` present in `spot_server.js` confirms D-119. `/customers/search` endpoint + `normalizeTermsCode()` function present confirms D-118. `wf_shipto_history` localStorage key + `setShipToConfirm` state in JSX confirms D-118 late additions.

