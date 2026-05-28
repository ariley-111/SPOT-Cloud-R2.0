# 09 — Codebase Walkthrough: `spot_engine.js`

1,131 lines of pure JavaScript, no dependencies. The headless pricing engine, used by `fleet_compare.js` for regression. **Mirror of the ENGINE block inside `spot_r1_5.jsx`** — they must stay in sync.

---

## What this file is and is not

**Is:**
- The math for pricing a quote
- The single point of truth for control tables in headless context
- Imported by `spot_runner.js` and `fleet_compare.js`

**Is not:**
- Loaded by the server (`spot_server.js` does not require this)
- Used by the live UI (the JSX has its own copy of the ENGINE block)

The dual existence is intentional. The JSX engine is what runs in the browser for live quotes. The Node-side engine here is what `fleet_compare.js` uses to run 785 jobs in batch without a browser. They contain the same math.

---

## Top-level structure

```
1–50      Header, version banner
50–250    base_matrix, flute_rules (the materials table)
250–400   liner_upgrades, medium_upgrades
400–550   allowed_board_grades, dim_adders, fixed_charges
550–700   Engine constants (RATE_DEFAULTS, GM tiers, route limits)
700–900   Core pricing functions (calcBoard, computeLayout)
900–1050  Route comparison, freight markup
1050–1131 Module exports
```

---

## `base_matrix` (L50–250)

The board-cost lookup table. Structure:

```javascript
const ENGINE = {
  base_matrix: {
    singlewall: {
      "200": { /* MSF tier rates */ },
      "ECT 32": { /* ... */ },
      "ECT 44": { /* ... */ },
      // ...
    },
    doublewall: {
      "ECT 42": { /* ... */ },
      // ...
    }
  },
  // ...
};
```

Each MSF tier inside a grade is keyed by tier name (`"0-1"`, `"1-3"`, etc.) and the value is a $/MSF rate.

**The +10% paper uplift (D-102) is baked into these numbers.** Every rate in `base_matrix` is post-uplift. If you need the pre-uplift rate, divide by 1.10. This was a calibration decision so the uplift is invisible to user-facing flows but still tracks the supplier's price increase.

---

## `flute_rules` (L250–290)

Per-flute MSF interpolation. Each flute has:
- `wall_type`: "singlewall" or "doublewall"
- `caliper`: thickness in inches
- `msf_interpolation`: how to combine adjacent tier rates

This is where flute-specific adjustments live. Adding a new flute means adding a `flute_rules` entry plus a `FLUTE_CALIPERS` entry plus SHEET_GROUPS rows.

---

## `liner_upgrades` (L290–350)

Per-liner cost adders, in $/MSF:

| Liner | Upgrade $/MSF | Notes |
|---|---|---|
| Kraft | $0 | Default, no upgrade |
| 42# Kemi-Lite | $18.50 | Standard clay-coated |
| 42# Kla-White | (configured value) | Mottled white |
| 42# Bleached White | $17.50 | Bleached upgrade |
| 33# Kla-White | (configured) | Lighter Kla-White |
| 56# Kla-White | (configured) | Heavier Kla-White |

The `getLinerRate(name, kemiTariff)` function pulls the right rate.

---

## `allowed_board_grades` (L350–400)

Which grades are legal for which flutes:

```javascript
allowed_board_grades: {
  "B": ["200", "ECT 32", "ECT 44", "ECT 48", "ECT 55", "ECT 61", "ECT 71", "ECT 82"],
  "C": ["200", "ECT 32", "ECT 44", "ECT 48", "ECT 55", "ECT 61", "ECT 71", "ECT 82"],
  "E": ["200", "ECT 32", "ECT 44"],
  // ...
}
```

The UI filters the grade dropdown based on the selected flute. The engine validates on load.

---

## `dim_adders` (L400–500)

Dimensional cost adders for big or small blanks. For example, blanks under a certain dimension may have a flat per-piece adder; blanks over a certain dimension may have a per-MSF surcharge.

Used by `calcBoard()` to add or subtract based on the one-up width/length.

---

## `fixed_charges` (L500–550)

The non-rate fees:
```javascript
fixed_charges: {
  under_5_msf_setup_fee: { amount: 0 },     // Rule 3 — always 0
  fsc_sfi_fee: { amount: 25 }                // D-086 — $15 → $25
}
```

---

## Engine constants (L550–700)

Same as the JSX ENGINE block (mirror). Key constants:

- `RATE_DEFAULTS` — all rates with defaults
- `PRINT_SPEEDS` — Gloss 75 / Satin 75 / OnQ Sty 50 / OnQ LB 40
- `CAD_SETUP`, `CAD_FALLBACK` — D-110 calibrated
- `GM_MSF_TIERS`, `GM_DEFAULTS`, `SELL_DEFAULTS` — GM curve
- `BOBST_MIN_W/L`, `BOBST_MAX_W/L`, `BOBST_FLUTES` — D-121 route gates
- `isBobstEligible(flute, sheetW, sheetL)` — eligibility predicate

---

## Core pricing functions (L700–900)

### `calcBoard(bi, qty, isStock)`

Computes board cost for one quote item at one quantity. Inputs:
- `bi`: BOM item (board spec + dims)
- `qty`: quantity (units)
- `isStock`: was this from the stock library?

Returns `{ totalCost, breakdown }`. Breakdown lists each component (base, liner, medium, dim adders, FSC, paper uplift, under5MsfFee).

### `computeLayout(oneUpW, oneUpL, sheetW, sheetL)`

N-out calculation. Tries both orientations:
1. Blanks parallel to sheet long edge
2. Blanks rotated 90°

Returns the orientation with higher N-out. Caps at the geometric maximum.

### `selectSheet(boardSpec, oneUpW, oneUpL, sheetGroups)`

Iterates `sheetGroups`, filters by grade/flute/liner match, computes N-out for each candidate, returns the highest-N-out option. Returns `null` if no stock sheet matches.

### `getMsfTier(msf)`

MSF-to-tier lookup (engine's own tier definitions, separate from GM_MSF_TIERS).

### `getGradeFallback(grade)`, `getMediumFallback(...)`

Substitution rules. ECT grades fall back to Mullen; bleached medium never falls back to non-bleached.

---

## Route comparison (L900–1000)

### `autoRoute(state)`

Computes the cost on each viable route (CAD / Crest / Bobst) and returns the cheapest.

```javascript
function autoRoute(state) {
  const cadCost = calcRouteCost(state, "CAD");
  const crestCost = isCrestEligible(state) ? calcRouteCost(state, "Crest") : Infinity;
  const bobstCost = isBobstEligible(state.flute, state.sheetW, state.sheetL)
    ? calcRouteCost(state, "Bobst")
    : Infinity;

  // Tie-breaker preference: Bobst > Crest > CAD
  const candidates = [
    { route: "Bobst", cost: bobstCost },
    { route: "Crest", cost: crestCost },
    { route: "CAD",   cost: cadCost   }
  ];
  return candidates.reduce((winner, c) => c.cost < winner.cost ? c : winner);
}
```

### `compareRoutes(state)`

Returns the full per-route breakdown for the Route Comparison UI panel. Includes setup hours, run hours, cost/piece at each qty slot, breakeven quantity, breakeven die cost.

### `selectBobstSheet(boardSpec, oneUpW, oneUpL)` (D-123)

Bobst-specific sheet selection. Filters SHEET_GROUPS by Bobst envelope eligibility (13.78×15.75 to 41.75×29.125), then highest N-out.

---

## Module exports (L1050–1131)

```javascript
module.exports = {
  ENGINE,
  RATE_DEFAULTS,
  PRINT_SPEEDS,
  CAD_SETUP,
  CAD_FALLBACK,
  // ...
  calcBoard,
  computeLayout,
  selectSheet,
  autoRoute,
  compareRoutes,
  // ...
  CAD_DIFF_MIGRATION,
  STRIP_DIFF_MIGRATION
};
```

`fleet_compare.js` and `spot_runner.js` import what they need.

---

## How `fleet_compare.js` uses this

```javascript
const E = require('./spot_engine.js');
const R = require('./spot_runner.js');

// Per-row processing in fleet_compare:
for (const row of rows) {
  const json = mapIqRowToSpotJson(row);
  const result = R.runEstimate(json);  // calls E.calcBoard, E.autoRoute, etc
  writeResult(row, result);
}
```

The runner is a thin wrapper that takes a SPOT JSON, calls the engine functions in order, and returns the same shape the UI would compute.

---

## Drift detection

The JSX ENGINE block and this file must agree on every value. The session SHA audit catches drift between PK and live source; the D-104 audit closed the runner-vs-JSX parity concern by validating their math is identical on three test cases.

When you edit any number in `spot_engine.js`, also edit the corresponding number in `spot_r1_5.jsx` ENGINE block (L84–155). When you ship, both must be in the release-history entry.

---

## Why two copies?

Three reasons:
1. **No transpile in regression** — `fleet_compare.js` runs directly under Node. Wrapping the JSX ENGINE block to import it would require a build step that doesn't fit the regression workflow.
2. **No DOM in engine** — the headless engine cannot reference React hooks, browser APIs, or localStorage. Keeping it separate makes accidental coupling impossible.
3. **Calibration audit** — having the engine in its own file makes the calibration target legible. The JSX has 9,000 lines; the engine has 1,131. Reviewing rate changes is much faster against the engine alone.

The cost is duplication. The mitigation is the discipline of updating both in the same ship. So far we have not shipped a math drift between them; the D-104 audit is the safety net if we ever do.
