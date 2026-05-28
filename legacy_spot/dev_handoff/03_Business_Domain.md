# 03 — Business Domain

A new developer working on SPOT needs a working understanding of corrugated packaging — what the materials are, how they're made, and what terms estimators use. Without this, the variable names in the engine will read as alphabet soup.

This file is a domain primer. It's not exhaustive — pick it up as you need it — but it covers the terms that appear most in the code.

---

## What is corrugated board?

A sheet of corrugated board is three layers of paper glued together:

```
   ─────────────────  Outside liner  (the printable face)
   ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿  Medium / fluting (the wavy middle)
   ─────────────────  Inside liner   (touches the product)
```

The middle wavy layer is called the **medium** (or "fluting"). The peaks of the waves are what give corrugated its strength. The peak frequency and height define the **flute size**.

Corrugated comes in two main wall configurations:

- **Singlewall** — one medium between two liners (most common at SPC)
- **Doublewall** — two mediums separated by an extra liner, between an outer pair of liners (heavier products, displays)

---

## Flutes

Flute size is named by letter. Smaller letter = thicker flute (mostly). The flutes SPOT supports:

| Flute | Approx. thickness | Where it's used |
|---|---|---|
| **A** | 0.187" | Heavy-duty shipping cartons. Rare at SPC. |
| **B** | 0.125" | The workhorse flute. Most shop work runs B. |
| **C** | 0.156" | Heavier B-equivalent. Slightly more stack strength. |
| **E** | 0.0625" | Thin, high-quality printable surface. Retail packaging. |
| **F** | 0.030" | Very thin. Premium retail boxes. SPOT supports it but SPC doesn't run it as a stock material today. |
| **BC** | 0.250" | Doublewall: B + C. Heavy displays. |
| **EB** | 0.187" | Doublewall: E + B. Lighter doublewall, premium displays. |

In the engine code, flute is a single-letter string (`"B"`, `"C"`, `"E"`, `"BC"`, etc.). The lookup table `FLUTE_CALIPERS` maps each flute to its caliper (thickness in inches), used by sheet selection and stack-height checks.

---

## Liner grades and weights

The liners are kraft paper, characterized by weight in pounds per 1,000 square feet. At SPC, the most common liners are:

| Liner code | What it is | Used when |
|---|---|---|
| **Kraft** (also "brown") | Standard unbleached kraft. The default. | Most jobs, unless customer asks otherwise |
| **42# Kemi-Lite** | Clay-coated kraft, smooth printable surface | Print-quality jobs |
| **42# Kla-White** | Mottled-white kraft | "White outside" jobs, default for "MW" |
| **42# Bleached White** | Fully bleached, bright white | Customer requests "bright white" or "bleached" |
| **33# Kla-White** | Lighter Kla-White | Upgrade on 175 / ECT 32 only |
| **56# Kla-White** | Heavier Kla-White | Upgrade on 250 only |

The number is the basis weight (lb / 1,000 sqft). "42#" means 42 pounds per thousand square feet.

**⚠️ SPC-specific gotcha — CKB:** When a customer or RFQ says "CKB", they mean **Corrugated Kraft Board = 42# Kemi-Lite** at SPC. Industry-standard "CKB" means Clay-Coated Bleached Kraft, which is a folding-carton (non-corrugated) grade — a completely different product. The canonical registry in `16_Glossary.md` codifies this. Never let training-data priors expand SPC-specific terms.

**⚠️ Another one — Mottled White (MW):** Customers say "MW" or "mottled white." At SPC this maps to **42# Kla-White**, NOT 42# Bleached White. Same letters mean different things at different mills.

---

## Grades and ECT

A board's strength rating is expressed two ways:

**Mullen burst test** — measured in pounds per square inch. "200 Mullen" or just "200" means 200 lb/in² burst strength. Higher number = stronger board.

**ECT (Edge Crush Test)** — measured in pounds per linear inch on the edge. "ECT 32" means 32 lb/in. Different test, different number, different physical property (stack strength vs burst strength).

SPC's stock grades:

**Singlewall:** 200, ECT 32, ECT 44, ECT 48, ECT 51, ECT 55, ECT 61, ECT 71, ECT 82
**Doublewall:** ECT 42, ECT 48, ECT 51, ECT 61, ECT 71, ECT 82

**The grade fallback rule:** ECT grades at SPC run on Mullen-stock sheets via substitution. If a customer asks for ECT 32, SPC actually cuts the job from 200# Mullen stock; the math works out because ECT 32 and 200# Mullen are comparable strength ratings. **This substitution is never shown on customer-facing quotes** — the customer sees "ECT 32" because that's what they asked for. The substitution is a shop-floor procurement decision.

ECT 44 is a special case at SPC: uncommon, manual mill-substitute check, no popup guardrail. See DEV-011 in the open-work roadmap.

---

## Mediums

The middle wavy layer also has a weight. SPC's options:

- **None** (most common — uses default 26# medium without itemizing it)
- **26# Medium**
- **33# Medium**
- **35HPL# Medium** (high-performance liner-grade)
- **40# Medium**
- **42# Bleached Medium**

You'll rarely see medium explicitly chosen except on premium jobs. The default "None" means "engine, pick a sensible medium for this flute and grade."

---

## Sheet sizes and N-out

SPC runs from a library of approved stock sheets. A sheet has a width and a length (in inches). For example, `60 × 120` means 60 inches wide, 120 inches long.

The library (`SHEET_GROUPS` in `spot_engine.js`) groups sheets by:
- Grade (`g`)
- Flute (`f`)
- Outside liner (`ol`)
- Inside liner (`il`)
- Medium (`md`)
- Available sizes (`sizes`)

Around 216 distinct sheet specs are in the library.

When SPOT prices a job, it determines:
1. The **blank size** (`oneUpW` × `oneUpL`) — the flat layout of one box
2. The **best stock sheet** — which sheet from the library to cut from
3. The **N-out** — how many blanks fit on one sheet, considering rotation

A blank that's 24" × 18" can be cut as **5 N-out** from a 60×96 sheet (5 columns × 1 row = 5 blanks), or **6 N-out** from a 72×120 sheet, etc. The algorithm in `computeLayout()` finds the highest N-out within the sheet's dimensions.

Higher N-out = lower per-piece cost. Sheet selection is run per-route and tries to maximize N-out within size constraints.

---

## Routes (CAD, Crest, Bobst)

A "route" in SPC parlance is the production path for cutting the blank from the sheet. SPC has three:

### CAD (Computer-Aided Dieless)

**⚠️ At SPC, "CAD" is a route, not the design software.** It refers to a rotary cutting machine that uses CAD files instead of physical dies.

- Rate: $138/hr
- Speed: 650 inches/minute
- Setup (per difficulty): Simple 8 min / Straight 20 min / Standard 25 min / Complex 22 min
- Strength: No die cost; fastest setup; works on any sheet
- Weakness: Slower per-piece on long runs

CAD is the default route for most jobs.

### Crest

A flat-bed die-cutter. "Crest" is a brand name but at SPC it's used as the route name.

- Rate: $45/hr (operator + machine)
- Speed: 150 sheets/hour
- Setup: Standard 45 min / Advanced 90 min
- Die cost: Default $1,200 (parameterized as `crestDieCost`)
- Strength: Fast per-piece on long runs
- Weakness: Die cost amortized across the order; setup time longer than CAD
- Eligibility: Sheet ≤ 60 × 120 (after rotation check)

Crest typically wins on volume — a 10,000-piece job goes Crest because the die cost spreads thin across many units.

### Bobst (D-121, uncalibrated)

Another flat-bed die-cutter, faster than Crest, with tighter sheet eligibility.

- Rate: $350/hr (uncalibrated placeholder)
- Speed: 3,000 sheets/hour
- Setup: 45 min flat (no difficulty tiers)
- Min charge: $250
- Die cost: $1,800 default
- Eligibility: E or F flute only; sheet between 13.78×15.75 and 41.75×29.125

Bobst is for high-volume E-flute retail jobs. Underutilized at SPC currently — calibration awaits more shop-floor data (target: 90 days or ≥30 Bobst jobs).

### Auto-route

When all three routes are viable for a job, SPOT picks the cheapest. The preference order is **Bobst → Crest → CAD** for tie-breaking. The estimator can force a route via the UI, but `routeOverride` is never set in the JSON (Rule 1).

The sheet-selection logic for E/F-flute jobs runs per-route after D-123 — Bobst tries its own envelope-eligible sheets, CAD and Crest each pick their own. The cheapest route-plus-sheet combination wins.

---

## Print finishes

What gets printed on the outside of the box. At SPC:

| Finish | Default? | Notes |
|---|---|---|
| **Satin** | YES (since 2026-04-21, D-105) | Equalized at 75 sh/hr with Gloss |
| **Gloss** | No (was previously default; flipped under D-105) | Opt-in only; customer must request explicitly |
| **Matte** | No | Specialty |
| **OnQ Styrene** | No | 50 sh/hr — specialty substrate + finish |
| **OnQ Lightbox** | No | 40 sh/hr — specialty substrate + finish |
| **No print** | No | Plain kraft |

**⚠️ Default is Satin.** Never default to Gloss. This was a business decision under D-105 and a violation appears in every quote-quality review.

The "1-Sided" / "2-Sided" / "White" print-sides selection is separate from finish. A typical "full color outside" job is `printSides: "1-Sided"` with `numColors: 4`.

---

## Ops (die, glue, stitch, perf, saber)

Beyond cutting and printing, jobs may have:

- **Die** — for Crest/Bobst routes. Default die cost is parameterized. CAD doesn't need a die.
- **Glue** — manual or machine glue joints. Hand-glue rate per joint.
- **Stitch** — wire-stitching, used on heavy doublewall.
- **Perf** — perforation for tear-strips.
- **Saber** — Saber cutting path for irregular shapes. Set `saber: "Yes"` + `saberCuts` + `saberBlanksOut`.

Each adds a per-piece time, which the engine costs out using the relevant machine rate.

---

## Quantities and MSF

A "qty slot" in SPOT is one customer-quantity to price. SPOT supports 1–5 slots per estimate (formerly up to 10 in older releases).

**MSF** = Thousand Square Feet. The fundamental unit of corrugated production. If a blank is 24"×18", that's 432 in² = 3 ft² per piece. A 1,000-piece order is 3,000 ft² = 3 MSF.

The GM (Gross Margin) curve is keyed on MSF tiers:

| MSF tier | GM target |
|---|---|
| 0–1 MSF | 50% |
| 1–3 MSF | 37% |
| 3–5 MSF | 32% |
| 5–9 MSF | 27% |
| 10+ MSF | 25% |

Lower MSF → higher GM (small jobs cost more to handle per piece). Higher MSF → lower GM (volume discount, but with a floor at 25%).

This curve was set under D-110 FINAL. The floor at 5+ MSF prevents iQuote-style volume giveaways — a deliberate P5 planned deviation. See `06_Calibration_Methodology.md` for the full rationale.

---

## FOB and freight

**FOB** = Freight On Board. Two values:

- **FOB: Origin** — customer pays freight from SPC's ZIP (44704). Default.
- **FOB: Destination** — SPC pays freight to the customer's dock. Only when customer explicitly asks.

Freight quoting goes through two paths:

1. **SPCOC local zones** (D-119): three flat rates for Canton ($45), Akron ($70), Cleveland ($95) ZIPs, gated on ≤10,000 lbs AND ≤24 trailer-feet. Most local jobs use this.
2. **UTS API** (`/api/freight`): for everything else, an external API call returns carrier quotes.

A 15% markup is applied client-side (visible, editable in the Freight Dashboard).

---

## FSC/SFI

A chain-of-custody fee, amortized into board cost. $25/order at SPC (was $15 pre-D-086; the $15 → $25 migration fires on load of older estimates).

FSC and SFI are real certification programs (Forest Stewardship Council, Sustainable Forestry Initiative). SPC charges one fee that covers participation in both programs.

---

## "Under 5 MSF Fee" — historically nonzero, currently zero

There's a setting `under5MsfFee` in every JSON. **It is always set to `"0"`** at SPC (Rule 3). Historically it was $500 — a corrugator surcharge for runs under 5 MSF. The WF (Wide-Format) shop, which is what SPOT prices, doesn't carry this charge. The field exists for backward compatibility with legacy estimates but the value is always zero.

If you see `under5MsfFee: "500"` in a JSON, the migration on load will rewrite it to `"0"` and fire an amber toast.

---

## Paper uplift

A +10% adjustment baked into the engine's `base_matrix` at the 2026-04-14 calibration pass (D-102). This is not exposed as a user-editable field. Every board price in `spot_engine.js` is post-uplift.

The uplift represents pass-through of a corrugator price increase from the supplier. When raw paper prices change, this is where future adjustments would go — either rolled into the matrix or exposed as a separate multiplier. For now, it's invisible to the user.

---

## Multi-Part quotes

When a customer asks for a multi-piece kit (like a tray + lid + insert, or a display with header + base + multiple shelves), SPOT switches to **Multi-Part mode**. Each piece is a BOM item; the UI shows item tabs in the BOM strip.

- `quoteType: "Multi-Part"` (vs "Simple" for single-piece)
- `pricingMode: "Matched Set"` (vs "Individual") — all items priced together at a set-level GM
- `setMarginPct` — the target margin for the matched set

The parser (D-129/D-131) handles multi-part RFQs explicitly. Each BOM item gets its own dims, board, route, ops, and quantities; freight rolls up to the whole order.

---

## Customers, ship-to, terms

Customer records come from `customerList.csv`. The columns are:
- `cust_code`, `cust_name`
- `address_1`, `address_2`, `address_3`, `city`, `state`, `zip`
- `phone`
- `terms_code` — payment terms (e.g. "Net 30", "Cash", "On Receipt")
- `sales_agent_id`, `sales_tax_code`
- `po_required`, `oncredithold`, `credit_limit`

The server normalizes `terms_code` to a fixed set ("30", "45", "60", "COD", "DOR", "PREPAID") via `normalizeTermsCode()`.

Per-customer ship-to history is in localStorage (`wf_shipto_history`), keyed by customer code. When an estimator picks a customer that has prior ship-to history, the UI offers to populate the ship-to fields from memory.

---

## Tying it back to the code

When you look at the engine and see:

```javascript
const PRINT_SPEEDS = { Gloss: 75, Satin: 75, "OnQ Styrene": 50, "OnQ Lightbox": 40 };
```

That's the press speed in sheets/hour for each print finish. Equalized between Gloss and Satin under D-110.

```javascript
const CAD_SETUP = { Simple: 8, Straight: 20, Standard: 25, Complex: 22 };
```

That's the CAD route setup time in minutes, by difficulty. Fleet-calibrated under D-110.

```javascript
const GM_DEFAULTS = { "0-1": 0.50, "1-3": 0.37, "3-5": 0.32, "5-9": 0.27, "10-24": 0.25, ... };
```

That's the GM curve keyed by MSF tier. Set under D-110 FINAL.

Every number in the engine has a business story. The control tables (`04_Control_Tables_Reference.md`) walk through all of them.
