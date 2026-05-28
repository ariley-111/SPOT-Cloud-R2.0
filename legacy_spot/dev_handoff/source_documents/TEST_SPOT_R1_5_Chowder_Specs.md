# SPOT R1.5 — Chowder Test Case Specs (TC-018 through TC-025)

> **Consolidated archive — all 8 chowder TCs PASS as of 2026-04-25 (Chrome MCP).** This file replaces four prior files (`TEST_SPOT_R1_5_TC018_TC022.md`, `TEST_SPOT_TC023_D090.md`, `TEST_SPOT_TC024_D097_Forced_Route_UI.md`, `TEST_SPOT_TC025_D098.md`) into a single chowder-spec reference.
>
> Date consolidated: 2026-04-25.
> Specs preserved verbatim from source files (modulo header/section formatting).
> Authority for status: `01_OPEN_ISSUES.md` ("Recently Closed" section) + `02_RELEASE_HISTORY.md` (2026-04-25 chowder closeout entry).
>
> **Why preserved:** these TCs cover D-080, D-085, D-086, D-087, D-090, D-092/093/094, D-097, D-098 — the R1.5.2 fix wave. Specs remain useful as reference for any future regression of the same code paths.

---

# TC-018: applyState Reset-First — No Stale Field Bleed-Through (D-080)

**Purpose:** Verify that loading a JSON estimate fully replaces all state, including fields the loaded JSON doesn't mention. Pre-D-080, absent fields survived from the previous estimate (merge pattern). Post-D-080, every field resets to its RATE_DEFAULTS value before loaded values are applied.

**Precondition:** A "dirty" estimate is already open in SPOT — one with non-default settings across multiple categories.

## Setup: Create Dirty Estimate (manually or via __SPOT_LOAD_JSON)

```json
{
  "_version": 11, "estNum": "DIRTY-001", "estInitials": "SPC",
  "custName": "DIRTY TEST", "custRef": "", "custIdent": "DIRTY", "itemDesc": "Dirty Box",
  "quoteType": "Simple", "pricingMode": "Individual",
  "flute": "C", "boardGrade": "ECT 44", "outsideLiner": "42# Kla-White", "insideLiner": "42# Kemi-Lite", "medium": "26# Medium",
  "quoteMode": "One-Up", "oneUpW": "30", "oneUpL": "45",
  "qtys": ["100", "500", "", "", ""],
  "printReq": "Yes", "printMode": "Satin", "printSides": "2-Sided", "whiteInk": "Yes",
  "handStripping": "Yes", "strippingComplexity": "Difficult", "perimeterStripping": "Yes",
  "handGluing": "Yes", "jointsPerPiece": "2", "gluingComplexity": "Difficult",
  "tape": "Yes", "tapeType": "Reinforced",
  "saber": "Yes", "saberCuts": "2", "saberBlanksOut": "2",
  "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "400",
  "cadDifficulty": "Difficult", "perfPct": "0.30",
  "fscEnabled": true, "fscFee": "25.00",
  "dieTreatment": "Separate Line", "cuttingDieCost": "1200",
  "freightTreatment": "Separate Line", "freightCost": "350",
  "prepressTreatment": "Separate Line", "prepressCost": "150",
  "miscCharges": [{"desc": "Tooling", "cost": "200", "treatment": "Amortize"}],
  "pricingBasis": "Sell $/MSF",
  "sellByTier": {"0-1":800,"1-3":700,"3-5":600,"5-9":500,"10-24":450,"25-49":400,"50-74":375,"75-99":350,"100+":325}
}
```

## Load: Minimal Clean Estimate

```json
{
  "_version": 11, "estNum": "CLEAN-001", "estInitials": "SPC",
  "custName": "CLEAN TEST", "custRef": "", "custIdent": "", "itemDesc": "Simple Box",
  "quoteType": "Simple",
  "flute": "B", "boardGrade": "200",
  "outsideLiner": "42# Kemi-Lite", "insideLiner": "None", "medium": "None",
  "quoteMode": "One-Up", "oneUpW": "12", "oneUpL": "18",
  "qtys": ["500", "", "", "", ""],
  "printReq": "No",
  "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "100"
}
```

## Pass Criteria

After loading CLEAN-001 over DIRTY-001, verify **every** field below is at its default or CLEAN value — NOT the DIRTY value:

| Field | Expected | Dirty Value (must NOT appear) |
|-------|----------|-------------------------------|
| flute | B | C |
| boardGrade | 200 | ECT 44 |
| outsideLiner | 42# Kemi-Lite | 42# Kla-White |
| insideLiner | None | 42# Kemi-Lite |
| medium | None | 26# Medium |
| printReq | No | Yes |
| printMode | Satin (default) | Satin |
| printSides | 1-Sided (default) | 2-Sided |
| whiteInk | No (default) | Yes |
| handStripping | No (default) | Yes |
| strippingComplexity | Standard (default) | Difficult |
| perimeterStripping | No (default) | Yes |
| handGluing | No (default) | Yes |
| jointsPerPiece | 1 (default) | 2 |
| gluingComplexity | Standard (default) | Difficult |
| tape | No (default) | Yes |
| tapeType | Clear (default) | Reinforced |
| saber | No (default) | Yes |
| saberCuts | 1 (default) | 2 |
| saberBlanksOut | 1 (default) | 2 |
| cadDifficulty | Standard (default) | Difficult |
| perfPct | 0 (default) | 0.30 |
| fscEnabled | false (default) | true |
| dieTreatment | None (default) | Separate Line |
| cuttingDieCost | 0 (default) | 1200 |
| freightTreatment | Separate Line (default) | Separate Line (same — verify cost reset) |
| freightCost | 0 (default) | 350 |
| prepressTreatment | Auto (default) | Separate Line |
| prepressCost | 50 (default) | 150 |
| miscCharges | [] (empty) | [Tooling $200] |
| pricingBasis | Gross Margin % (default) | Sell $/MSF |
| sellByTier | GM_DEFAULTS | Custom sell tiers |

**Key check:** After load, open Advanced Controls — all rate fields (incaRate, cadRate, etc.) should show current RATE_DEFAULTS values, not any value from the dirty estimate. Rate migration fires on load, so rates are always current.

**Automation:** `window.__SPOT_LOAD_JSON(dirtyPayload)` → wait 500ms → `window.__SPOT_LOAD_JSON(cleanPayload)` → inspect all fields via `localStorage` state or DOM reads.

---

# TC-019: Crest → Die Auto-Default to Separate Line $0 (D-085)

**Purpose:** When auto-routing switches to Crest, die treatment must auto-set to "Separate Line" with cost $0 and a toast must appear. Crest always requires a steel die — the estimator is expected to fill in the actual die cost.

**Precondition:** Fresh estimate, no routeOverride set.

## Test Steps

1. Load a small-piece / low-qty estimate that routes to CAD:
```json
{
  "_version": 11, "estInitials": "SPC",
  "custName": "DIE TEST", "itemDesc": "Small Part",
  "flute": "B", "boardGrade": "200", "outsideLiner": "42# Kemi-Lite",
  "quoteMode": "One-Up", "oneUpW": "12", "oneUpL": "18",
  "qtys": ["100", "", "", "", ""],
  "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "100",
  "printReq": "No"
}
```
2. Confirm: route = CAD, dieTreatment = None, dieCost = 0.
3. Change qty from 100 → 10000 (forces CAD hours > 8 → Crest routing kicks in).
4. Wait for route tile to flip to "Crest".

## Pass Criteria

| Check | Expected |
|-------|----------|
| Route | Crest |
| Die Treatment | Separate Line |
| Die Cost | $0.00 (field visible, editable) |
| Toast | "Die added — Crest routing requires a steel die" |
| Die missing indicator | Yellow warning badge visible (dieMissing flag) |

5. Now change qty back to 100 (routes back to CAD).
6. Confirm: dieTreatment reverts to what it was before Crest auto-set it (typically "None" or "Separate Line" depending on prior state — the D-085 logic saves and restores via `dieAutoRef`).

## Edge Case

7. Force routeOverride = "Crest" on the 100-qty item (click Crest tile).
8. Confirm: die auto-sets to Separate Line $0 + toast fires.
9. Enter die cost $800. Click Auto route tile (removes override). Route flips to CAD.
10. Confirm: die cost $800 is preserved (not reset to 0) — only the treatment toggles.

---

# TC-020: FSC Wired — Default, Toggle, Quote Display, Migration (D-086)

**Purpose:** Full coverage of the FSC/SFI feature: $25 default fee, one-click toggle in board status bar, "FSC/SFI Material" text on preview quotes, and $15→$25 migration on legacy JSON load.

## Part A: Default State

1. Open fresh estimate. Verify:
   - FSC button visible in board status bar (toggle, not always-on).
   - fscEnabled = false by default.
   - fscFee = $25.00.

2. Click FSC toggle ON. Verify:
   - Board cost increases (FSC fee adds to board $/MSF).
   - Badge or indicator shows FSC active.

3. Click FSC toggle OFF. Verify:
   - Board cost returns to previous value.

## Part B: Quote Display

4. Set up a printable estimate (any valid item with qtys). Enable FSC. Open Preview Quote.
5. Verify: Board spec line includes "FSC/SFI Material" text.
6. Disable FSC. Preview Quote again.
7. Verify: "FSC/SFI Material" text is NOT present.

## Part C: Migration ($15 → $25)

8. Load a legacy JSON with `fscFee: "15"` and `fscEnabled: true`:
```json
{
  "_version": 11, "estInitials": "SPC",
  "custName": "FSC MIGRATE", "itemDesc": "Legacy FSC",
  "flute": "B", "boardGrade": "200", "outsideLiner": "42# Kemi-Lite",
  "quoteMode": "One-Up", "oneUpW": "12", "oneUpL": "18",
  "qtys": ["500", "", "", "", ""],
  "printReq": "No",
  "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "100",
  "fscEnabled": true, "fscFee": "15"
}
```
9. Verify after load:
   - fscFee = $25.00 (migrated from $15).
   - fscEnabled = true (preserved from JSON).
   - Amber toast fires: "Attention: costs updated to current rates — verify margins and pricing."

## Part D: Multi-Part BOM Migration

10. Load a multi-part JSON where BOM items have `fscFee: "15"` in their `.state`:
```json
{
  "_version": 11, "estInitials": "SPC",
  "custName": "FSC BOM", "quoteType": "Multi-Part",
  "fscEnabled": true, "fscFee": "15",
  "bomItems": [
    { "label": "Lid", "type": "Manufactured", "state": { "fscFee": "15", "fscEnabled": true, "oneUpW": "12", "oneUpL": "18", "flute": "B", "boardGrade": "200", "outsideLiner": "42# Kemi-Lite" } },
    { "label": "Base", "type": "Manufactured", "state": { "fscFee": "15", "fscEnabled": true, "oneUpW": "14", "oneUpL": "20", "flute": "B", "boardGrade": "200", "outsideLiner": "42# Kemi-Lite" } }
  ]
}
```
11. Switch between BOM tabs. Verify each item's fscFee = $25.00 (not $15).

## Pass Criteria Summary

| Check | Expected |
|-------|----------|
| Default fscFee | $25.00 |
| Default fscEnabled | false |
| Toggle ON → board cost | Increases by ~$25/MSF × oMSF |
| Preview Quote with FSC | "FSC/SFI Material" in board spec |
| Legacy $15 load → fscFee | $25.00 (migrated) |
| BOM item migration | All items' fscFee migrated to $25 |

---

# TC-021: applyItemState Reset-First — BOM Item Switching (D-087)

**Purpose:** When switching between BOM items in a multi-part estimate, every field resets to defaults before the target item's state is applied. Pre-D-087, fields from the previous item could bleed through if the target item's state didn't explicitly set them.

## Setup: Multi-Part with Divergent Items

```json
{
  "_version": 11, "estInitials": "SPC",
  "custName": "BOM SWITCH", "quoteType": "Multi-Part", "pricingMode": "Individual",
  "bomItems": [
    {
      "label": "Complex Part", "type": "Manufactured",
      "state": {
        "itemDesc": "Complex Part", "flute": "C", "boardGrade": "ECT 44",
        "outsideLiner": "42# Kla-White", "insideLiner": "42# Kemi-Lite", "medium": "26# Medium",
        "oneUpW": "30", "oneUpL": "45", "quoteMode": "One-Up",
        "qtys": ["250", "500", "", "", ""],
        "printReq": "Yes", "printMode": "Satin", "printSides": "2-Sided", "whiteInk": "Yes",
        "handStripping": "Yes", "strippingComplexity": "Difficult",
        "handGluing": "Yes", "jointsPerPiece": "2", "gluingComplexity": "Difficult",
        "tape": "Yes", "tapeType": "Reinforced",
        "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "500",
        "fscEnabled": true, "fscFee": "25.00",
        "dieTreatment": "Separate Line", "cuttingDieCost": "1500",
        "pricingBasis": "Sell $/MSF"
      }
    },
    {
      "label": "Simple Insert", "type": "Manufactured",
      "state": {
        "itemDesc": "Simple Insert", "flute": "B", "boardGrade": "200",
        "outsideLiner": "42# Kemi-Lite", "insideLiner": "None",
        "oneUpW": "10", "oneUpL": "12", "quoteMode": "One-Up",
        "qtys": ["250", "500", "", "", ""],
        "printReq": "No",
        "cadPricingMethod": "By Inches of Rule", "totalRuleInches": "80"
      }
    }
  ]
}
```

## Test Steps

1. Load the JSON via `__SPOT_LOAD_JSON`. SPOT opens on first BOM item (Complex Part).
2. Verify Complex Part fields are active (C flute, ECT 44, Kla-White, Satin, etc.).
3. Click the "Simple Insert" BOM tab.
4. Verify ALL of the following:

| Field | Expected (Simple Insert) | Bleed-through (Complex Part — MUST NOT appear) |
|-------|--------------------------|------------------------------------------------|
| flute | B | C |
| boardGrade | 200 | ECT 44 |
| outsideLiner | 42# Kemi-Lite | 42# Kla-White |
| insideLiner | None | 42# Kemi-Lite |
| medium | None | 26# Medium |
| printReq | No | Yes |
| printMode | Satin (default) | Satin |
| printSides | 1-Sided (default) | 2-Sided |
| whiteInk | No (default) | Yes |
| handStripping | No (default) | Yes |
| strippingComplexity | Standard (default) | Difficult |
| handGluing | No (default) | Yes |
| jointsPerPiece | 1 (default) | 2 |
| tape | No (default) | Yes |
| tapeType | Clear (default) | Reinforced |
| fscEnabled | false (default) | true |
| dieTreatment | None (default) | Separate Line |
| cuttingDieCost | 0 (default) | 1500 |
| pricingBasis | Gross Margin % (default) | Sell $/MSF |

5. Switch back to Complex Part. Verify all Complex Part fields restored correctly (state was snapped by gatherItemState before switching — D-081).
6. Switch to Simple Insert again. Verify same as step 4 — no accumulated bleed-through.

## Pass Criteria

Zero fields from the Complex Part appear on the Simple Insert after switching. The reset-first pattern guarantees this: every field is set to its default, then the target item's explicit values overwrite.

---

# TC-022: Window Global API Surface (D-092, D-093, D-094)

**Purpose:** Verify the three window globals added in R1.5.2 for automation and test harness support.

## Part A: __SPOT_UI_VERSION (D-092)

1. Open SPOT in Chrome. Open DevTools console.
2. Execute: `window.__SPOT_UI_VERSION`

| Check | Expected |
|-------|----------|
| Return value | `"R1.5.2"` |
| Available before interaction | Yes (set at module scope, not in useEffect) |

## Part B: __SPOT_LOG_EVENT / __SPOT_SESSION_LOG (D-093)

3. Execute: `typeof window.__SPOT_LOG_EVENT`

| Check | Expected |
|-------|----------|
| Type | `"function"` |

4. Execute: `window.__SPOT_LOG_EVENT({type: "TEST", detail: "TC-022"})`.

| Check | Expected |
|-------|----------|
| Return value | `{ts: <number>, event: {type: "TEST", detail: "TC-022"}}` |
| `ts` | Milliseconds since epoch (within last second) |

5. Execute: `window.__SPOT_SESSION_LOG`.

| Check | Expected |
|-------|----------|
| Type | Array |
| Length | ≥ 1 (contains the event from step 4) |
| Last entry | Matches step 4 return |

6. Log multiple events. Verify they accumulate in order:
```javascript
window.__SPOT_LOG_EVENT("event1");
window.__SPOT_LOG_EVENT("event2");
window.__SPOT_SESSION_LOG.length; // 3 (1 from step 4 + 2 here)
```

## Part C: __SPOT_LOAD_JSON (D-094)

7. Execute:
```javascript
window.__SPOT_LOAD_JSON({
  _version: 11, estInitials: "SPC",
  custName: "API TEST", itemDesc: "Loaded via API",
  flute: "B", boardGrade: "200", outsideLiner: "42# Kemi-Lite",
  quoteMode: "One-Up", oneUpW: "12", oneUpL: "18",
  qtys: ["500", "", "", "", ""],
  printReq: "No",
  cadPricingMethod: "By Inches of Rule", totalRuleInches: "100"
})
```

| Check | Expected |
|-------|----------|
| Return value | `true` |
| Customer name in UI | "API TEST" |
| Item desc in UI | "Loaded via API" |
| Dimensions | 12 × 18 |
| Qty slot 1 | 500 |
| Archive modal | NOT opened (direct load, no modal) |

8. Verify the load was logged:
```javascript
window.__SPOT_SESSION_LOG.filter(e => e.event?.type === "LOAD_JSON")
```

| Check | Expected |
|-------|----------|
| Length | ≥ 1 |
| Last entry `.event.estNum` | Whatever estNum was auto-generated |

9. Error handling — pass invalid input:
```javascript
window.__SPOT_LOAD_JSON(null)      // → false, console.error
window.__SPOT_LOAD_JSON("string")  // → false, console.error
window.__SPOT_LOAD_JSON(42)        // → false, console.error
```

10. Verify __SPOT_LOAD_JSON respects initials preservation:
    - Set initials to "MMG" via the UI.
    - Load a JSON with `estInitials: "SPC"`.
    - Verify initials field shows "MMG" (not "SPC" — D-086 initials preservation).

## Pass Criteria Summary

| Global | Available | Functional |
|--------|-----------|-----------|
| `__SPOT_UI_VERSION` | Yes (string "R1.5.2") | Read-only, set at parse time |
| `__SPOT_LOG_EVENT` | Yes (function) | Pushes to SESSION_LOG, returns entry |
| `__SPOT_SESSION_LOG` | Yes (array) | Accumulates all events in order |
| `__SPOT_LOAD_JSON` | Yes (function) | Loads estimate, bypasses modal, returns bool |

---

# TC-023: Production Route Comparison — compareRoutes() (D-090)

> Source: was `TEST_SPOT_TC023_D090.md`. Drafted 2026-04-15.

## Purpose

Verify that the `compareRoutes()` function correctly computes side-by-side CAD vs Crest economics, breakeven quantities, and breakeven die costs for a range of piece sizes and quantities.

## Test Method

`compareRoutes()` is a pure function — testable via the runner without DOM. Add to `spot_runner.js` exports or test directly in the JSX engine section.

## Test Cases

### TC23-01: Small piece — CAD clearly wins

```json
{ "oneUpW": "12", "oneUpL": "18", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "100",
  "qty": 500, "dieCost": 800 }
```

| Check | Expected |
|-------|----------|
| viable | true (12×18 fits Crest 60×120) |
| winner | CAD |
| delta | Positive (CAD cheaper) |
| breakeven.qty | Some qty > 500 where Crest becomes cheaper |
| Crest die cost used | $800 (input) |

### TC23-02: Medium piece, high qty — Crest clearly wins

```json
{ "oneUpW": "24", "oneUpL": "36", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "300",
  "qty": 5000, "dieCost": 800 }
```

| Check | Expected |
|-------|----------|
| viable | true |
| winner | Crest |
| delta | Negative (Crest cheaper) |
| breakeven.qty | Some qty < 5000 |
| CAD cadHrs | > 8h (this is already Crest territory in autoRoute) |

### TC23-03: Oversize piece — Crest not viable

```json
{ "oneUpW": "62", "oneUpL": "62", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "300",
  "qty": 500, "dieCost": 800 }
```

| Check | Expected |
|-------|----------|
| viable | false (62" > Crest max effective width 58") |
| No Crest data | — |

### TC23-04: Breakeven boundary — near-equal costs

```json
{ "oneUpW": "24", "oneUpL": "36", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "300",
  "qty": 1000, "dieCost": 800 }
```

| Check | Expected |
|-------|----------|
| viable | true |
| breakeven.qty | Between 500 and 2000 (reasonable range) |
| breakeven.dieCost | Positive number (the die cost at which routes are equal at qty 1000) |
| delta sign | May go either way — boundary case |

### TC23-05: No die cost input — estimated die cost

```json
{ "oneUpW": "24", "oneUpL": "36", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "300",
  "qty": 1000, "dieCost": 0 }
```

| Check | Expected |
|-------|----------|
| crest.dieEstimated | true |
| crest.dieCost | ≥ $500 (floor) and ≤ $3,000 (cap) |
| Formula | 300 ruleIn × pcsPerSheet × 1.15 × $0.02 |

### TC23-06: Skybox caddy divider — real-world spec

```json
{ "oneUpW": "48", "oneUpL": "38.5", "boardGrade": "ECT 44", "flute": "C",
  "outsideLiner": "42# Kla-White", "totalRuleInches": "504.7",
  "qty": 250, "dieCost": 1200 }
```

| Check | Expected |
|-------|----------|
| viable | true (48 and 38.5 both fit Crest 60×120) |
| CAD sheet | 60×120 (1×3=3) — same as current autoSelectSheet |
| Crest sheet | 60×120 or smaller re-imposition |
| At qty 250 | CAD likely wins (die cost dominates at low qty) |
| breakeven.qty | > 250 |

### TC23-07: Qty 1 — extreme low

```json
{ "oneUpW": "24", "oneUpL": "36", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "300",
  "qty": 1, "dieCost": 800 }
```

| Check | Expected |
|-------|----------|
| winner | CAD (die cost at qty 1 = $800, cutting at 1 sheet is negligible) |
| delta | Large positive |
| breakeven.qty | Well above 1 |

### TC23-08: Both routes use same sheet

```json
{ "oneUpW": "20", "oneUpL": "28", "boardGrade": "200", "flute": "B",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "150",
  "qty": 2000, "dieCost": 600 }
```

| Check | Expected |
|-------|----------|
| CAD and Crest boardCost | Similar (if same sheet selected for both) |
| Delta driven by | Cutting cost difference + die cost only |

### TC23-09: E flute with grade fallback

```json
{ "oneUpW": "15.3125", "oneUpL": "20.625", "boardGrade": "ECT 32", "flute": "E",
  "outsideLiner": "42# Kemi-Lite", "totalRuleInches": "222",
  "qty": 500, "dieCost": 700 }
```

| Check | Expected |
|-------|----------|
| Both paths use grade fallback | ECT 32 → 200# sheets |
| viable | true |

### TC23-10: Breakeven die cost sanity

For each of TC23-01 through TC23-09 where viable=true:

| Check | Expected |
|-------|----------|
| breakeven.dieCost | > 0 |
| If we set dieCost = breakeven.dieCost | delta ≈ 0 (±$1) |

## Pass Criteria

| Check | Tolerance |
|-------|-----------|
| viable | Exact boolean |
| winner | Exact string |
| delta sign | Correct (positive = CAD cheaper) |
| breakeven.qty | Positive integer when routes cross; null when CAD always wins |
| breakeven.dieCost | Positive number |
| Board costs | ≤ $0.01 vs independent calcBoard call |
| Cutting costs | ≤ $0.01 |
| Die cost in Crest total | Exact match to input (or estimated within bounds) |
| Estimated die cost | ≥ $500, ≤ $3,000 |
| Breakeven self-check | delta ≈ 0 when dieCost = breakeven.dieCost |

## Automation

```javascript
// After D-090 lands:
const E = require('./spot_engine.js');
const result = E.compareRoutes(24, 36, boardSpec, 1000, asmp, 800);
console.log(result.winner, result.delta, result.breakeven);
```

10 test cases. All pure-function, no DOM required. Can run in CI alongside TC-015.

---

# TC-024: Route Comparison Panel — Forced State Persistence (D-097)

> Source: was `TEST_SPOT_TC024_D097_Forced_Route_UI.md`. Drafted 2026-04-16.

## Purpose

Verify that the Route Comparison panel **stays mounted** after the user clicks "Switch to CAD" or "Switch to Crest," and that the panel renders the correct forced-state UI (forced label, route-colored text, Reset to Auto button, Switch buttons hidden).

### Background

Pre-D-097, the Route Comparison panel was computed inside a `useMemo` whose dependency array excluded `routeOverride`. When the user forced a route via the Switch buttons, the panel's memoized value went stale and the panel unmounted on the next render. D-097 added `routeOverride` to the memo deps and introduced explicit forced-state branches in the JSX so the panel remains visible and communicates "you are in a forced route" clearly.

> **D-115 fix (applied 2026-04-25):** Spec wording below updated to match the actual deployed UI: `"✓ Route forced to CAD"` with `"(auto was CAD)"` annotation, plus `"Route forced to Crest — verify die cost"` warning when forcing Crest. Code unchanged — this was a doc-only fix.

## Precondition

- SPOT running at localhost:3100 serving `SPOT_R1.5.html`
- Chrome open to localhost:3100
- `window.__SPOT_UI_VERSION === "R1.5.2"`
- Empty SPOT state (no loaded estimate)

## Test Method

DOM + state test via Chrome MCP. Load a known piece where both CAD and Crest are viable (piece ≤ 60×120 after rotation check). Click Switch to CAD, inspect panel. Click Reset to Auto, inspect panel. Click Switch to Crest, inspect panel. Verify panel is continuously mounted throughout.

## Test Cases

### TC-024.1 — Switch to CAD, panel persists

**Setup:**
- Load `TC024_Viable_Both.json` — piece 20×30, ECT 32 B-flute, qty 1000. Both routes viable. Auto-route picks CAD or Crest based on current thresholds; either is fine as starting state.

**Action:**
- Observe initial Route Comparison panel — it is visible, shows side-by-side CAD vs Crest economics, Switch buttons visible.
- Click **Switch to CAD**.

**Expected:**
- Panel remains mounted (no unmount/remount flash).
- Panel header changes to "\u2713 Route forced to CAD" with "(auto was CAD)" annotation, in CAD's route color (cyan).
- CAD column is highlighted; Crest column is dimmed.
- Switch to CAD button is hidden or disabled; Switch to Crest button remains available (for re-force) or hidden depending on the forced-state UI spec — record actual.
- **Reset to Auto** button appears.
- Economics panel (below) reflects CAD costs.

**Pass criteria:** Panel never unmounts. Forced label present and matches "CAD." Reset to Auto button present.

**Fail modes:**
- Panel disappears after Switch click (pre-D-097 regression).
- Panel re-renders empty.
- No forced label.
- Reset to Auto missing.

### TC-024.2 — Reset to Auto restores the comparison UI

**Setup:** continue from TC-024.1 — forced CAD.

**Action:** Click **Reset to Auto**.

**Expected:**
- Panel stays mounted.
- Forced label clears.
- Switch buttons return to both-visible state.
- Both columns un-dim; comparison is back to neutral.
- Economics panel reflects the auto-routed choice (same as initial state).

**Pass criteria:** Clean return to unforced state. No residual forced styling.

### TC-024.3 — Switch to Crest, panel persists

**Setup:** auto-routed state from TC-024.2.

**Action:** Click **Switch to Crest**.

**Expected:**
- Panel stays mounted.
- Panel header: "\u2713 Route forced to Crest" with "(auto was CAD)" annotation, in Crest's route color (amber/orange).
- Crest column highlighted; CAD column dimmed.
- Reset to Auto button present.
- Warning text: "Route forced to Crest — verify die cost" visible.
- Economics panel reflects Crest costs.

**Pass criteria:** Mirror of TC-024.1 but for Crest.

### TC-024.4 — Switch back and forth, no unmount

**Setup:** auto-routed state.

**Action:** rapid sequence — Switch to CAD, Switch to Crest, Reset to Auto, Switch to CAD, Reset to Auto.

**Expected:**
- Panel stays mounted throughout the sequence.
- Each click updates the forced label and column highlight consistently.
- No console errors.
- `window.__SPOT_SESSION_LOG` shows one `route_forced` event per Switch click and one `route_auto` event per Reset.

**Pass criteria:** No unmount at any point. Session log matches clicks.

### TC-024.5 — Piece too large for Crest — panel hidden, no forced-state contradiction

**Setup:**
- Load `TC024_CAD_Only.json` — piece 72×96 (exceeds Crest 60×120 even after rotation). Only CAD viable.

**Expected:**
- Route Comparison panel is **hidden** (per D-090 design: show only when both routes viable).
- No Switch buttons visible.
- Attempting `routeOverride = "Crest"` via URL or console must not force a non-viable route; confirm D-090 viability guard still fires.

**Pass criteria:** Panel correctly suppressed for non-viable comparisons. Forced-state UI does not appear for a hidden panel.

> **D-116 note (filed 2026-04-25):** Loading 72×96 piece where dims exceed all stock sheets currently throws a React crash at JSX L7459 (`Cannot read properties of undefined (reading 'pcsPerSheet')`). The whole pricing pipeline crashes, Route Comparison panel disappears as a side-effect, not as designed behavior. Should fail gracefully with a clear error. Track via D-116 in `01_OPEN_ISSUES.md`.

## Fixtures to create

- `TC024_Viable_Both.json` — 20×30, ECT 32 B, qty 1000.
- `TC024_CAD_Only.json` — 72×96, ECT 32 B, qty 500.

Store under `/test_fixtures/`.

## Source references

- `spot_r1_5.jsx` — `routeComp` `useMemo` block (grep `routeComp` and `routeOverride`).
- `spot_r1_5.jsx` — forced-state UI branches (grep `Route forced to CAD` and `Route forced to Crest`).
- `02_RELEASE_HISTORY.md` — D-097 entry (2026-04-16).
- Related TC: TC-023 (D-090 Route Comparison baseline).

## Close criteria (historical — closed 2026-04-25)

All five sub-cases PASS in Chrome (Chrome MCP, 2026-04-25). On close: TC-024 row moved from `01_OPEN_ISSUES.md` to `02_RELEASE_HISTORY.md`.

---

# TC-025: applyState Multi-Part Fallthrough (D-098)

> Source: was `TEST_SPOT_TC025_D098.md`. Drafted 2026-04-20; ECT 44 sub-cases removed 2026-04-21.

## Purpose

Verify the Multi-Part fallthrough guardrail shipped in D-098:

**Multi-Part fallthrough**: when loading a JSON estimate into an existing Multi-Part BOM, the fallthrough branch of `applyState()` must not leak fields from the previous active item into loaded items. Reset-first semantics (D-080 / D-087) must hold for every BOM item, not just the first.

> **What this TC does NOT cover**: the ECT 44 grade-selection guardrail (popup on load + mill substitute) was named in the original D-098 release notes but was never actually coded. Reconciled 2026-04-21 — see TC-025.X below. Validation of that guardrail is deferred until it ships under a new D-### (tracked as DEV-011 in `01_OPEN_ISSUES.md`, target R1.6).

## Precondition

- SPOT running at localhost:3100 serving `SPOT_R1.5.html`.
- Chrome open to localhost:3100.
- `__SPOT_UI_VERSION` reads "R1.5.2" (verify via DevTools console: `window.__SPOT_UI_VERSION`).
- `__SPOT_LOAD_JSON` is defined (for scripted load).

## Background — what D-098 actually fixed

Pre-D-098: in `applyState()`, the Multi-Part branch walked `loadedState.bomItems[]` and called `applyItemState()` per item, but the fallthrough for items missing keys fell back to the PREVIOUS item's state, not to RATE_DEFAULTS. Result: item 2 could inherit item 1's flute, board caliper, or print finish invisibly.

Post-D-098: the Multi-Part path resets every item to RATE_DEFAULTS before applying loaded values.

The second half of the original D-098 spec — an ECT 44 warning popup plus a mill-substitute guardrail — was scoped but never implemented. Grep of `spot_r1_5.jsx` and `spot_engine.js` on 2026-04-21 found only data-row references to ECT 44 (board_matrix, SHEET_GROUPS, a search-placeholder string). No popup code. No "uncommon" string. No mill-substitute selector. See DEV-011 in `01_OPEN_ISSUES.md`.

## Test Method

DOM + state test. Via Chrome MCP:

1. Load a known-dirty baseline.
2. Load a crafted Multi-Part JSON with deliberate gaps on item 2.
3. Inspect `window.__SPOT_SESSION_LOG` for the reset-first event per item.
4. Read the rendered BOM table and the Economics panel for each item.

## Test Cases

### TC-025.1 — Multi-Part reset-first on every item

**Setup:**
- Load dirty baseline: 3-item Multi-Part, item 1 flute=E, item 2 flute=C, item 3 flute=B; each with non-default caliper, print finish = Gloss (or opposite of current default), FSC = unchecked.

**Action:**
- Load `TC025_MultiPart_Clean.json` — 3-item Multi-Part where item 1 specifies flute/caliper/finish, item 2 specifies ONLY dims + qty (gaps elsewhere), item 3 specifies flute only.

**Expected:**
- Item 1 renders loaded values verbatim.
- Item 2 fields with no loaded value show RATE_DEFAULTS: flute = B, caliper = default, print finish = current system default, FSC = $25 checked, under5MsfFee = $0.
- Item 3 renders loaded flute; all other fields show RATE_DEFAULTS.
- `window.__SPOT_SESSION_LOG` contains three `applyItemState: reset` events, one per item, timestamped in load order.
- Toast: "Estimate loaded" (single, not three).

**Pass criteria:** All three items show reset-first behavior. No field from the dirty baseline bleeds into any loaded item. Economics panel per item reflects defaults where gaps exist.

**Fail modes to watch:**
- Item 2 inherits flute=E from item 1 (old fallthrough bug).
- Item 2 print finish stays at dirty-baseline value.
- Only one reset event in the session log.

### TC-025.X — PLACEHOLDER: ECT 44 grade-selection guardrail (future work)

**Status:** NOT RUNNABLE — target code does not exist in current source.

**Why this row exists:** the original D-098 release notes described a popup + mill-substitute guardrail for ECT 44 loads. Reconciliation on 2026-04-21 confirmed no such code shipped. The only references to ECT 44 in `spot_r1_5.jsx` / `spot_engine.js` are data rows (board_matrix, SHEET_GROUPS) and a search-input placeholder string. There is no popup trigger, no "uncommon" warning, and no mill-substitute selector wired to an ECT 44 load path.

**What to do:** once the guardrail is implemented under a future D-### (tracked as DEV-011 in `01_OPEN_ISSUES.md`), spin up a dedicated TC — do NOT revive it as a sub-case of TC-025. The Multi-Part fallthrough and the ECT 44 guardrail are independent code paths and should not share a TC number.

**Fixtures that WERE drafted and are now stale:**
- `TC025_ECT44.json` — deprecated (sub-case TC-025.2 removed).
- `TC025_MultiPart_ECT44.json` — deprecated (sub-case TC-025.3 removed).

Leave these fixture paths unused until the new TC is opened.

## Fixtures to create (active)

- `TC025_MultiPart_Clean.json` — 3-item Multi-Part with deliberate gaps on item 2. Store under `/test_fixtures/` on the server. Schema: standard SPOT load JSON (same as TC-018 fixtures).

## Source references

- `spot_r1_5.jsx` — `applyState()` Multi-Part branch (grep `applyItemState` within the `bomItems.forEach` block).
- `02_RELEASE_HISTORY.md` — D-098 entry (2026-04-16) + 2026-04-21 reconciliation note.
- `01_OPEN_ISSUES.md` — DEV-011 (ECT 44 grade-selection guardrail, OPEN, target R1.6).
- Related TCs: TC-018 (D-080 applyState reset-first), TC-021 (D-087 applyItemState reset-first).

## Close criteria (historical — closed 2026-04-25)

TC-025.1 PASSED in Chrome (Chrome MCP, 2026-04-25). On close: TC-025 row moved from `01_OPEN_ISSUES.md` to `02_RELEASE_HISTORY.md`.

TC-025.X stays DEFERRED indefinitely — does not block TC-025 closure.

---

# Regression Coverage

These eight TCs cover R1.5.2 fixes D-080, D-085, D-086, D-087, D-090, D-092, D-093, D-094, D-097, D-098. They should be run alongside the existing REG-01 through REG-11 regression suite after any code change to the corresponding paths. Most JSON payloads above can be automated via `__SPOT_LOAD_JSON` for harness execution.

# Sources merged into this file

| Source filename | Lines | Date drafted |
|---|---|---|
| `TEST_SPOT_R1_5_TC018_TC022.md` | 408 | 2026-04-15 |
| `TEST_SPOT_TC023_D090.md` | 186 | 2026-04-15 |
| `TEST_SPOT_TC024_D097_Forced_Route_UI.md` | 147 | 2026-04-16 |
| `TEST_SPOT_TC025_D098.md` | 103 | 2026-04-20 (rev 2026-04-21) |

After this file is uploaded, all four source files can be deleted from project knowledge — they are fully superseded by this consolidated archive.
