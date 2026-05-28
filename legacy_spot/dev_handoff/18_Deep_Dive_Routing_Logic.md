# 18 — Deep Dive: Routing Logic

SPOT decides between four cutting/converting routes automatically:

1. **Bobst** — high-speed flatbed die-cutter, E/F flute only
2. **CAD** — flatbed digital cutter, default for small-to-mid runs
3. **Crest** — production die-cutter, big-volume cut with custom die
4. **Saber + D/C** — rotary die-cut fallback

The user **cannot override the route** in the JSON loader (Rule 1 / Rule 10 — auto-route only). The UI exposes the chosen route after calculation.

---

## The decision tree

`autoRoute(cadHrs, selectedSheet, oneUpW, oneUpL, boardSpec, totalQty, assumptions)` — engine line 559.

```
┌──────────────────────────────────────────────┐
│ ENTRY                                         │
│   inputs: cadHrs, selectedSheet, piece dims, │
│           board spec, qty, assumptions        │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
        ┌────────────────────────┐
        │ Bobst eligible?        │
        │  • bobstFirstSizing on │
        │  • E or F flute        │
        │  • fits Bobst envelope │
        └─────┬──────────────────┘
              │
        ┌─────┴─────┐
        │           │
       YES         NO
        │           │
        ▼           ▼
   selectBobst    cadHrs ≤ 8?
   if viable          │
   → BOBST       ┌────┴────┐
                YES        NO
                 │          │
                 ▼          ▼
             → CAD     fits Crest
                       envelope?
                       (60×120)
                          │
                      ┌───┴───┐
                     YES      NO
                      │        │
                      ▼        ▼
                 Re-impose  → SABER + D/C
                 on Crest     (warning)
                 sheet
                      │
                  ┌───┴───────┐
                  │           │
              custom         stock
              viable?        candidates
                  │           │
                  ▼           ▼
              → CREST    sort by cost
              (custom)   → CREST (stock)
```

---

## Branch A — Bobst (D-121, D-123)

**Eligibility filter (in `selectBobstSheet`, L283):**

```javascript
if (boardSpec.flute !== "E" && boardSpec.flute !== "F") return null;
if (assumptions.bobstFirstSizing === "false") return null;
// piece must fit envelope: 50×40 max usable area, approximately
```

**Why E/F only:** the Bobst is a high-speed flatbed designed for thin-flute, high-volume cosmetic and retail packaging. B/C-flute pieces are too thick to feed reliably at Bobst speeds.

**Why `bobstFirstSizing === "false"` check is reversed:** the default is on. The flag exists to *disable* Bobst-first for testing. So the engine checks for the explicit string "false", not boolean false.

**Sheet sizing:** `selectBobstSheet` picks a Bobst-sized sheet that maximizes pieces per sheet within the press feed envelope. It handles below-mill-min boards by scaling up to mill min and discounting back to requested qty.

**Cost model:**
- Press: 3000 sheets/hour, $350/hour
- Setup: 45 minutes
- Minimum charge: $250
- Default die: $1800

These are hard-coded in `selectBobstSheet` and in the cost roll-up. They are NOT in `RATE_DEFAULTS` — be careful if you need to recalibrate Bobst rates, they live in the engine.

**Output:** `{ route: "Bobst", sheet: bSel, warning: null, cadHrs }`.

---

## Branch B — CAD (default, RULE-017)

```javascript
if (cadHrs <= 8) return { route: "CAD", sheet: selectedSheet, warning: null };
```

This is the simplest branch. If the piece is small enough that CAD can handle it in 8 hours or less, use the sheet that `autoSelectSheet` already picked.

**Why 8 hours:** the threshold matches a typical CAD shift. Past 8 hours, the math tilts toward Crest (which has a setup but runs faster). 8 is calibrated, not arbitrary — see calibration framework for the curve fit.

**No re-imposition:** CAD uses whatever sheet was picked by `autoSelectSheet`. This is usually a stock sheet from `APPROVED_SHEETS`, occasionally a custom-sized sheet.

**CAD hours calculation:**
```
linealInches = totalRuleInches * pcsPerSheet * sheetsReq
cadMinutes   = (linealInches / cadSpeedInPerMin) + cadSetupMinutes
cadHrs       = cadMinutes / 60
```

- `cadSpeedInPerMin`: 650 in/min (current calibration)
- `cadSetupMinutes`: complexity-keyed — 8/20/25/22

If `totalRuleInches` is not yet known (no CAD file), a fallback applies — `cadFallbackMinPerSheet` × sheetsReq. The fallback is intentionally pessimistic so CAD-vs-Crest doesn't flip when the real rule inches come in.

---

## Branch C — Crest (RULE-018)

**Two sub-branches:** custom Crest sheet OR stock-fallback Crest sheet.

### Sub-branch C1 — Custom Crest sheet

```javascript
const nUp  = Math.floor((CREST_MAX_W - 2) / oneUpW);    // CREST_MAX_W = 60
const nOut = Math.floor((CREST_MAX_L - 2) / oneUpL);    // CREST_MAX_L = 120
if (nUp >= 1 && nOut >= 1) {
  const shW = nUp * oneUpW + 2;    // +2 trim allowance
  const shL = nOut * oneUpL + 2;
  // ... build board calc, return Crest result
}
```

- Sheet is sized exactly to fit `nUp × nOut` pieces plus 2-inch trim.
- `pcsPerSheet = nUp * nOut`.
- Cost runs through `calcBoard` with the custom sheet dims.
- If `bc.pricable` (above mill min), this is the result.

**Why no rotation:** the comment at L575 spells it out — "Cannot rotate piece orientation — first dimension is corrugation direction in industry standard." Swapping W↔L would misalign flutes with the piece structure, hurting box strength. The engine respects the input orientation.

### Sub-branch C2 — Stock Crest fallback

If the custom Crest sheet is below mill min (`!bc.pricable`):

```javascript
const stockCandidates = [];
APPROVED_SHEETS.forEach(sh => {
  // must match grade (or ECT fallback), flute, liners, medium
  // must fit within Crest envelope (≤60×120)
  // compute layout, sheetsReq, board cost
  // if pricable as-is OR pricable with mill-min scaling, add
});
stockCandidates.sort((a,b) => totalCostA - totalCostB);
return { route: "Crest", sheet: stockCandidates[0], ... };
```

This is the **D-067 stock-bypass** rule applied to Crest — stock sheets bypass mill minimums even when used on Crest.

### Crest die warning

```javascript
const ruleInPerPc      = pn(assumptions.totalRuleInches || 0);
const sheetRuleInches  = ruleInPerPc > 0 ? ruleInPerPc * pcsPerSheet * 1.15 : 0;
const warning = sheetRuleInches > 1000
  ? `Crest die has ${Math.round(sheetRuleInches)} rule inches per sheet (over 1,000) — needs approval before ordering die`
  : null;
```

Rule inches drive die cost. A die over 1,000 rule inches is expensive enough that estimators need to know before quoting. The 1.15 multiplier accounts for waste and crossovers.

### Crest cost roll-up

In `calcWF`:

```
crestSetupHrs = (crestComplexity === "Advanced") ? 1.5 : 0.75
crestRunHrs   = sheetsReq / crestSheetsPerHour       // 150
crestCost     = (crestSetupHrs + crestRunHrs) * crestRate    // $45
dieCost       = dieAmortized || (sheetRuleInches * dieRateInches)
```

**Current calibration:** $45/hr, 150 sh/hr, Standard 45 / Advanced 90 min setup.

---

## Branch D — Saber + D/C fallback (RULE-020)

```javascript
return {
  route: "Saber + D/C",
  sheet: selectedSheet,
  warning: "Too many CAD hours and no Crest die fits — falling back to Saber + die cut",
  cadHrs
};
```

This branch fires when:
- CAD hours exceed 8, AND
- The piece doesn't fit `60 × 120` Crest envelope, OR no Crest sheet (custom or stock) is viable.

It's rare. When it fires, the warning is the headline — the estimator needs to look at this manually before quoting.

---

## How sheets get reused — `compareRoutes` (engine L993)

For the **route comparison panel** in the UI, `compareRoutes` runs the same logic for each route and returns the three results side-by-side. This is used for sanity-checking, not for the default flow.

```javascript
function compareRoutes(oneUpW, oneUpL, boardSpec, totalQty, asmp, opts) {
  // Returns { cad: {...}, crest: {...}, bobst: {...} }
  // Each has cost, sheetsReq, sheet selection, viability
}
```

This is also how the qty pricing grid sometimes flips routes between qty rows — at 1K, CAD wins; at 25K, Crest wins. The grid recalcs per row.

---

## Common questions

**Q: Why did SPOT pick Bobst when I wanted Crest?**  
A: Bobst-first sizing is on, the flute is E or F, and Bobst was viable. To force a different route for testing, set `assumptions.bobstFirstSizing = "false"`. For production, you cannot override — Rule 1.

**Q: Why is my CAD job going to Crest at a lower qty than expected?**  
A: `cadHrs` is the gate, not qty. A short-rule piece can stay on CAD at higher qtys; a long-rule piece flips earlier. Check `totalRuleInches` in the inputs.

**Q: Why is Crest using a stock sheet that's bigger than necessary?**  
A: Stock-bypass (D-067) — the custom Crest sheet was below mill min, so the engine swapped to a stock sheet that fits within Crest limits. The total cost should still be lower than the mill-min penalty would have been.

**Q: Where's the routing override?**  
A: There isn't one. Rule 1: auto-route only. The only way to influence routing is via inputs (rule inches, qty, flute).

---

## Files involved

| Concern | File | Function |
|---|---|---|
| Decision tree | `spot_engine.js` | `autoRoute` (L559) |
| Bobst sheet selection | `spot_engine.js` | `selectBobstSheet` (L283) |
| Stock sheet selection | `spot_engine.js` | `autoSelectSheet` (L336) |
| Layout math | `spot_engine.js` | `computeLayout` (L261) |
| Three-way compare | `spot_engine.js` | `compareRoutes` (L993) |
| UI rendering | `spot_r1_5.jsx` | Route badge + warnings panel |

---

**Next:** read file 19 for the RFQ parser pipeline.
