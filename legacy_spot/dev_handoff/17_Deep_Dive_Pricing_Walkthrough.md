# 17 — Deep Dive: Pricing Walkthrough

This file traces a single quote through the entire calculation pipeline. Every variable, every formula, every branch. The goal: by the end of this file, you should be able to predict SPOT's number on paper before running it.

The example: **10,000 pieces, 12×9 RSC, 32 ECT, B-flute, 4-color print one side.**

---

## Step 1 — User inputs (the eight required fields)

These come from the UI in `spot_r1_5.jsx` and land in component state as `item` and `prod`:

| Field | Variable | Example value |
|---|---|---|
| Customer | `tab.cust` | `"Acme Co."` |
| Estimator initials | `tab.initials` | `"SPC"` (locked for AI) |
| Order quantity | `prod.orderQty` | `10000` |
| One-up width (corrugation dir) | `prod.oneUpWidth` | `12` |
| One-up length | `prod.oneUpLength` | `9` |
| Board grade | `item.boardGrade` | `"32 ECT"` |
| Flute | `item.flute` | `"B"` |
| Print colors | `prod.numColors` | `4` |

That's the minimum. Everything else has a default per `RATE_DEFAULTS` (engine line 148) or per the canonical defaults in `EST_SPOT_Quoting_Rules.md`.

---

## Step 2 — Grade fallback (ECT → Mullen)

ECT grades are not actually stocked at SPC. They roll up to Mullen equivalents via `ECT_GRADE_FALLBACK`:

```
ECT 32 → 200 Mullen
ECT 44 → 275 Mullen
ECT 51 → 350 Mullen
ECT 71 → 400 Mullen
```

Engine function: `getGradeFallback(grade)` at line 201. This is **transparent** — the quote shows ECT to the customer, but board cost lookups use the Mullen row. See **Rule 4** in `05_Business_Rules.md`.

In our example: `32 ECT` → `200` for matrix lookups.

---

## Step 3 — Board cost (calcBoard, engine L227)

`calcBoard(bi, qty, isStock)` computes the per-MSF cost of the raw board.

**Sub-step 3a — Base rate lookup:**
```
mk  = ENGINE.flute_rules["B"].wall_type    // "singlewall"
tier = getMsfTier(orderMsf)                 // 0-1, 1-3, 3-5, 5-9, 10+
base = ENGINE.base_matrix[mk][bg][tier]     // base $/MSF
```

For our example with `orderMsf` ≈ 10.8 MSF (calculated below), the 10+ tier applies. The matrix at engine L23 gives the actual number — values shift with each calibration ship, so consult `DEV_SPOT_R1_5_Control_Tables.md` for the current row.

**Sub-step 3b — Adders:**
```
medium_adder = ENGINE.medium_upgrades[bi.medium]?.amount_per_msf || 0
width_adder  = getDimAdder(widthIn, ENGINE.dimensional_adders.width)
length_adder = getDimAdder(lengthIn, ENGINE.dimensional_adders.length)
liner_o      = getLinerRate(outsideLiner, kemiTariff)
liner_i      = getLinerRate(insideLiner, kemiTariff)
```

Width adders kick in above 50″ (engine L23 — see `dimensional_adders.width`). Length adders kick in above 96″. Liner upgrades (Mottled White, Bleached Kraft, etc.) come from `ENGINE.liner_upgrades`. **Defaults are `"None"`** — meaning unbleached Kraft (Kemi-Lite at SPC). See **D-146** in release history for the canonical-engine-value bug fix.

**Sub-step 3c — Setup fee under 5 MSF:**
```
setup = (orderMsf < 5) ? (bi.under5MsfFee || 0) : 0
```
Per current calibration, `under5MsfFee = 0` (Rule 3). This is a corrugator charge, not a WF charge — SPC absorbs it.

**Sub-step 3d — Total per-MSF and totals:**
```
ratePerMsf = base + medium_adder + width_adder + length_adder + liner_o + liner_i
oMsf       = (widthIn * lengthIn * qty) / 144000   // order MSF
total      = (ratePerMsf * oMsf) + setup + (fscFee ? 25 : 0)
```

That `+ 25` is the amortized FSC/SFI certification fee (Rule 9 in the calibration block of project instructions).

**Returns:** `{ ratePerMsf, oMsf, total, effWithFsc, costPc, pricable, meetMin }`.

If `meetMin === false`, the board is below mill minimum. `calcBoard` is called again with the minimum order, scaled back to the requested quantity. **Stock sheets bypass this** (D-067) — they're in inventory, no mill min applies.

---

## Step 4 — Sheet selection (autoSelectSheet, engine L336)

Given the one-up piece size and the board spec, choose the best sheet to print on.

**The candidates:**
- All `APPROVED_SHEETS` matching `(grade, flute, outsideLiner, insideLiner, medium)`
- Same set with the ECT-grade fallback applied to grade match (Rule 4)
- A custom sheet sized exactly to fit N-up × N-out + trim, if no stock fits

**For each candidate:**
```
layout = computeLayout(oneUpW, oneUpL, sheetW, sheetL)
       → { numUp, numOut, pcsPerSheet, wastePct }
sheetsReq = ceil(totalQty / pcsPerSheet)
bc = calcBoard(boardWithSheetSize, sheetsReq, isStock=true)
totalCost = bc.total
```

**Scoring:** all viable candidates are sorted by **total job cost = board + press + cutting projected for that sheet size**. The estimator score formula at engine L627 uses `incaRate/100` (press per sheet) and `cadRate/240` (cutting per sheet) as a quick proxy. Lowest total wins.

**Custom sheet exception:** if no stock candidate is viable but a custom-sized sheet fits within mill minimums, the engine builds one. Custom sheets carry full board cost (no stock bypass).

The result is `{ sheet, layout, sheetsReq, bc, totalCost, stockMode, customOrder }`.

---

## Step 5 — CAD hours estimate

Before routing decides CAD vs Crest vs Bobst, the engine needs to know how long CAD would take. This is the input to `autoRoute`.

```
linealInches = (totalRuleInches * pcsPerSheet * sheetsReq)
cadMinutes   = (linealInches / cadSpeedInPerMin) + cadSetupMinutes
cadHrs       = cadMinutes / 60
```

`cadSetupMinutes` varies by complexity per `RATE_DEFAULTS.cadSetupMinutes`:
- Simple: 8
- Straight: 20
- Standard: 25
- Complex: 22

When `totalRuleInches` is not provided (no CAD file yet), a fallback per-sheet minute count is used: 2 / 6 / 2 / 4 (Simple / Straight / Standard / Complex). See `RATE_DEFAULTS.cadFallbackMinPerSheet`.

---

## Step 6 — Routing (autoRoute, engine L559)

Three routes. The engine tries them in order:

**Branch A — Bobst (D-121/D-123):**
- Eligibility: E or F flute, piece within Bobst envelope, `bobstFirstSizing !== "false"`.
- Calls `selectBobstSheet` (L283) — handles below-mill-min via stock-min-buy scaling.
- Bobst constants: 3000 sh/hr, $350/hr, 45 min setup, $250 min, $1800 default die.
- If viable, returns immediately — Bobst wins by default for E/F.

**Branch B — CAD (default):**
- Triggers if `cadHrs ≤ 8`.
- Uses the sheet from autoSelectSheet as-is.
- This is the most common path for B-flute and larger pieces.

**Branch C — Crest (high-volume cut):**
- Triggers if CAD hours exceed 8 AND the piece fits within `CREST_MAX_W × CREST_MAX_L` (60×120).
- Re-imposes the piece on a Crest-sized sheet: `nUp = floor((60-2)/oneUpW)`, `nOut = floor((120-2)/oneUpL)`.
- Sheet size = `nUp*oneUpW + 2` × `nOut*oneUpL + 2` (trim allowance).
- If the custom sheet hits mill min, **stock fallback fires** — looks for any approved sheet within Crest limits, scales mill-min cost to actual qty.
- **Rule inches warning:** if `sheetRuleInches > 1000`, emit a "needs approval before ordering die" warning. The Crest die is the expensive consumable.

**Branch D — Saber + D/C (fallback):**
- Triggers only if CAD exceeds 8 hours AND no Crest re-impose works.
- Carries a warning: "Too many CAD hours and no Crest die fits".
- Rare. Indicates the piece doesn't fit anything.

**For our example (12×9 RSC, 10K pieces, B-flute):** Bobst is not eligible (B-flute), CAD hours are well under 8 with an 8-piece stock sheet, so **Route: CAD**.

---

## Step 7 — Press cost (calcWF, engine L662)

The press is the Inca digital press. Per-sheet rate, fixed sheets-per-hour.

```
pressHrs   = printRunSheets / incaSheetsPerHour
pressCost  = pressHrs * incaRate
grossSqFt  = (sheetW * sheetL * printRunSheets) / 144
inkCost    = printOn ? grossSqFt * regularInkRate : 0
whiteCost  = whiteInk ? whiteInkFactor * (matTotal + inkCost + pressCost) : 0
side1Print = pressCost + inkCost + whiteCost
```

**Current calibration values** (consult Control Tables for live numbers):
- `incaSheetsPerHour`: 75 (Gloss and Satin equalized — D-114)
- `incaRate`: $485/hr
- `regularInkRate`: $0.05/sqft (LOCKED — business decision, Rule 8 in calibration block)

**Print run sheets** = sheets needed + waste + makeready. The exact formula is in `calcWF` — production sheets plus a per-run makeready count based on numColors.

**Side 2:** if `printBothSides`, same calculation runs again with side 2 colors. `side2Cost = pressHrs2 * incaRate + inkCost2 + whiteCost2`.

**Default print finish is Satin** (Rule 8 / D-114). Never default Gloss — the rates are equalized but the finish choice is left to the customer.

---

## Step 8 — Cutting cost (Saber + D/C OR Crest OR CAD)

This branch is decided by the route:

**CAD:**
```
cadCost = cadHrs * cadRate
```
- `cadRate`: $138/hr
- `cadHrs`: from Step 5

**Crest:**
```
crestSetupHrs = (crestComplexity === "Advanced") ? 1.5 : 0.75    // 90 or 45 min
crestRunHrs   = sheetsReq / crestSheetsPerHour                    // 150 sh/hr
crestCost     = (crestSetupHrs + crestRunHrs) * crestRate         // $45/hr
dieCost       = dieAmortized || (sheetRuleInches * dieRateInches) // varies
```

**Bobst:**
```
bobstSetupHrs = 0.75  // 45 min
bobstRunHrs   = sheetsReq / 3000
bobstCost     = (bobstSetupHrs + bobstRunHrs) * 350
              + max(250, calculated)     // $250 min charge
dieCost       = $1800 default
```

---

## Step 9 — Misc charges and add-ons

Per-product extras handled by the engine pass-through:

- Hand-applied tape, gluing, banding, etc. — set as line items on `prod.miscCharges`.
- Each carries `cost` (raw $) and `miscChargeMarkup` (default from `RATE_DEFAULTS.miscChargeMarkup`).
- Marked-up: `marked = cost * (1 + markup)`.

Sum: `miscTotal = Σ marked` per product.

---

## Step 10 — Job-level cost and allocation

For multi-part jobs, certain costs are job-level (e.g., a shared CAD die for two parts). `allocateJobCost(items, totalCost, method)` distributes:

- **"By MSF"** — share proportional to each item's order MSF.
- **"Equal"** — split evenly across MFG items.
- **FUL items** (purchased-finished-goods) get 0 regardless.

---

## Step 11 — Cost roll-up

```
costPerPc = (boardCost + pressCost + cutCost + dieCost + miscTotal + allocatedJobCost) / orderQty
```

This is the **delivered cost per piece** before margin.

---

## Step 12 — Margin and sell price (GM curve)

The GM curve is volume-tiered:

| Order MSF | GM target |
|---|---|
| 0 – 1 | 50% |
| 1 – 3 | 37% |
| 3 – 5 | 32% |
| 5 – 9 | 27% |
| 10 + | 25% |

For our example, ~10.8 MSF → 25% target margin.

```
sellPerPc  = costPerPc / (1 - gmTarget)
totalSell  = sellPerPc * orderQty
```

The user can override the GM target per-product in the pricing targets panel. The default is loaded from `wf_default_pricing_targets` in localStorage.

---

## Step 13 — Freight (calcShipment + UTS API)

```
totalWeight = boardWeightPerMsf * totalMsf
skidCount   = ceil(orderQty / piecesPerSkid)
trailerFt   = skidCount * skidFt
```

**SPCOC gate (D-119):**
- If `totalWeight ≤ 10000 lbs` AND `trailerFt ≤ 24` AND destination ZIP matches a SPCOC zone:
  - Canton ZIPs → $45
  - Akron ZIPs → $70
  - Cleveland ZIPs → $95
- Else: UTS API call for outside freight quote.

15% freight markup applied client-side, visible and editable in the freight panel.

**FOB:** Origin (ZIP 44704) unless customer explicitly requests Destination (Rule 9).

---

## Step 14 — Final quote object

The full quote object has roughly this shape (simplified):

```javascript
{
  tab: { cust, contact, estNum, initials: "SPC", ... },
  prod: { orderQty, oneUpWidth, oneUpLength, numColors, ... },
  item: { boardGrade, flute, outsideLiner, insideLiner, ... },
  results: {
    boardCost, pressCost, cutCost, dieCost, miscTotal,
    costPerPc, sellPerPc, totalSell,
    route, sheet: { id, w, l, layout },
    freight: { totalWeight, trailerFt, zoneRate, utsRate, ... }
  },
  pricingTargets: { gmPerMsfTier },
  qtyPricing: [ {qty, costPc, sellPc, gm}, ... ]  // per-qty grid
}
```

---

## Step 15 — Qty pricing grid

The qty pricing grid in the UI recalculates cost+sell for each row. Each row re-runs the full pipeline above with a different `orderQty`. **This is why changing certain inputs (board, flute, dims) triggers a full grid recalc — it's not cheap.** The recalc batch is debounced in `spot_r1_5.jsx`.

---

## Step 16 — Sanity check

If you've worked through this file, you should now be able to:

1. Read a quote object and explain every number.
2. Predict which route SPOT will choose for any given piece/qty.
3. Identify the calibration knobs that move the final price.
4. Trace a customer complaint ("this is too high") back to a specific multiplier.

The big knobs, in order of impact:
1. `gmCurve` — moves sell directly.
2. `incaRate` and `incaSheetsPerHour` — moves press cost.
3. `cadRate`, `crestRate`, `bobstRate` — moves cut cost.
4. `base_matrix` and `dimensional_adders` — moves board cost.
5. `linerUpgrades` and `mediumUpgrades` — moves board cost for spec'd liners.
6. Freight rates — moves delivered total.

---

## Where to look in code

| Calculation | File | Function | Approx line |
|---|---|---|---|
| Board cost | `spot_engine.js` | `calcBoard` | 227 |
| Sheet selection | `spot_engine.js` | `autoSelectSheet` | 336 |
| Bobst sheet | `spot_engine.js` | `selectBobstSheet` | 283 |
| Routing | `spot_engine.js` | `autoRoute` | 559 |
| Press cost | `spot_engine.js` | `calcWF` | 662 |
| Weight | `spot_engine.js` | `calcBoardWeight` | 887 |
| Shipment | `spot_engine.js` | `calcShipment` | 962 |
| Job allocation | `spot_engine.js` | `allocateJobCost` | 639 |
| Route compare | `spot_engine.js` | `compareRoutes` | 993 |

JSX mirrors live in the `═══ ENGINE` block of `spot_r1_5.jsx` (see file 09 for drift detection).

---

**Next:** read file 18 for routing logic in more detail (Bobst eligibility, Crest re-impose, Saber fallback).
