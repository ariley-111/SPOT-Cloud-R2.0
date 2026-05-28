# D-123 Design Decision — Bobst-First Sheet Sizing for E/F Flute

**Status:** DESIGN — awaiting operator sign-off
**Filed:** 2026-04-26
**Spec source:** `DEV_D123_Kickoff_Brief.md` (`L=66 SHA=6e404ca4`)
**Predecessor:** `DEV_D121_Design_Decision.md` (Bobst route addition, R1.5.5)
**Target version:** R1.5.6
**Calibration:** No CAD/Crest math change. Bobst rates remain uncalibrated placeholders per D-121 (90-day recal trigger preserved).

---

## 1. Problem Statement

D-121 added Bobst as a first-class route, but the live R1.5.5 smoke test on E-flute one-up 8×10 / qty 5,000 / dieTreatment Separate Line rendered:

> Bobst not viable: board not pricable at Bobst sheet size

…in the comparison panel. CAD won at 63×126. The Bobst $688 cost advantage that D-121 §12 projected against Crest never reached the screen, and the live route logic also fell through to CAD.

This is not a Bobst pricing problem. It is a **sheet-selection problem** that prevents Bobst from ever being scored on its own production envelope.

---

## 2. Root Cause Analysis

Two distinct failures compose into the symptom:

### 2.1 Sheet library has zero Bobst-eligible SKUs

Programmatic audit of `SHEET_GROUPS` (jsx L88, engine L77):

| Flute | Sizes in library | Bobst-eligible (13.78×15.75 to 41.75×29.125) |
|---|---|---|
| B | (60,120) (63,63) (63,98) (63,126) | none |
| C | (60,120) (63,63) (63,98) (63,126) | none |
| E | (48,96) (60,120) (63,63) (63,126) | **none** |
| F | not stocked | n/a |

Both `autoRoute` (jsx L527-543) and the proposed Bobst stock-sheet scan in this design require at least one Bobst-eligible SKU to find a candidate. Today there are zero.

### 2.2 Custom Bobst sheet trips the mill minimum

For an 8×10 one-up E-flute / 5,000 qty / 200 ECT 32:
- Bobst-imposed sheet: bNup=4, bNout=2, bShW=34″, bShL=22″
- bReq = 625 sheets, sheet sqft = 5.19, oSqFt = 3,247, oMSF ≈ 3.25
- Mill minimum (non-kraft custom): 25,000 sqft → `meetMin=false` → `pricable=false`

`compareRoutes` Bobst path (jsx L724-727) treats this as a hard fail: emits "board not pricable at Bobst sheet size" and sets `bobstViable=false`. **No stock-sheet fallback, no min-buy scaling.**

`autoRoute` Bobst path (jsx L520-543) attempts a stock-sheet fallback within the Bobst envelope, but per §2.1 no such sheet exists — falls through to CAD.

### 2.3 Why this is structural, not parametric

`autoSelectSheet` is the same call for every route, and it ranks candidates by all-in cost using a **CAD-shaped** press+cut cost model (jsx L372-374: `_pressPerSh`, `_cutPerSh` use `cadRate`). The picked sheet is therefore CAD-optimal: 63×126 for our E-flute test. That sheet is then handed to `autoRoute`, which can no longer reroute to Bobst because the sheet exceeds the envelope.

Decoupling per-route sheet selection is the only fix. Tuning Bobst rates downward, widening the envelope, or seeding the library — none of these alone can recover Bobst on a job whose CAD-optimal sheet is 63×126.

---

## 3. Decision

For E and F flute one-ups, run sheet selection **per route** rather than once globally:

1. **Bobst sheet selection** — try a Bobst-imposed custom sheet at the optimal layout within the envelope. If below mill minimum, scale via stock min-buy. If still no candidate, scan stock sheets within the Bobst envelope. If still no candidate, mark Bobst not viable with a specific reason.
2. **CAD sheet selection** — `autoSelectSheet` as today, no change.
3. **Crest sheet selection** — best fit ≤60×120 from stock + custom, as today.
4. **Compare totals** — pick the cheapest viable route.

For B/C flute and one-ups that exceed the Bobst envelope, behavior is unchanged (Bobst is silently skipped, not just routed away from).

---

## 4. New Parameter

```js
bobstFirstSizing: "true"
```

Added to `RATE_DEFAULTS` in jsx L152, engine L147, runner L25. Boolean string (matches existing convention). Default `"true"`.

When `"false"`, sheet selection collapses back to D-121 behavior: `autoSelectSheet` runs once globally, `autoRoute` and `compareRoutes` evaluate Bobst against the CAD-optimal sheet (D-121 status quo). This is the revert path if shop floor experience exposes Bobst overselling and operations wants to back off without a code change.

Surfaced in Advanced Rates UI as a toggle next to the new D-122 Bobst rate inputs (single tile pair: On / Off, mirrors `Default Print` block at jsx L5597).

JSON schema: `gatherState` adds `bobstFirstSizing`. `applyState` restores it. Rate-migration `_ck` array (jsx L2604-2605 area) includes it. Pre-D-123 JSONs load cleanly — absent key keeps `useState` default `"true"`.

---

## 5. Sheet Library Strategy — Starter Set

Per §2.1 the library has zero Bobst-eligible SKUs. Two options:

### Option A — Custom-imposition only (recommended for ship)

D-123 ships with the new custom-Bobst path that handles below-minimum via stock-min-buy scaling (§6.1). No library seed. Bobst always orders a custom-cut imposition; mill minimum is paid but per-piece cost amortizes correctly. **No SKU adds, no operator confirmation needed to ship.**

### Option B — Seed common Bobst SKUs

Adds explicit stock SKUs to the library so common short-run E-flute jobs hit pre-stocked Bobst sheets without paying full mill min. Proposed starter set (operator confirms):

| Grade | Flute | OL | IL | Medium | Sizes |
|---|---|---|---|---|---|
| 200 | E | 42# Kemi-Lite | 42# Kemi-Lite | None | (28,40), (24,36), (20,28) |
| 200 | E | 42# Kemi-Lite | None | None | (28,40), (24,36) |
| ECT 44 | E | 42# Kemi-Lite | 42# Kemi-Lite | None | (28,40), (24,36) |
| ECT 44 | E | 42# Kemi-Lite | None | None | (28,40), (24,36) |

All 11 sizes fit within Bobst envelope (28×40 → swapped to 28W×40L violates length limit; **proposed sizes need swap to W≤41.75 / L≤29.125 — operator review before commit**).

**Recommendation:** ship Option A in D-123. Re-evaluate Option B after ~10 Bobst jobs have run; if a common imposition pattern emerges (e.g., 28×22 keeps showing up as the imposed custom), seed it then. Avoids speculative SKU additions.

---

## 6. compareRoutes Restructure

### 6.1 New helper `selectBobstSheet(oneUpW, oneUpL, boardSpec, totalQty, asmp)`

Returns `{sheet, layout, sheetsReq, bc, totalCost, isStock} | {viable:false, reason}`.

Logic (mirror of `autoSelectSheet` shape, scoped to Bobst envelope):

```
1. Compute custom Bobst layout: bNup = floor((BOBST_MAX_W-2)/oneUpW), bNout = floor((BOBST_MAX_L-2)/oneUpL).
2. If bNup<1 or bNout<1: return {viable:false, reason:"piece exceeds Bobst envelope"}.
3. bShW = max(BOBST_MIN_W, bNup*oneUpW+2); bShL = max(BOBST_MIN_L, bNout*oneUpL+2).
4. If bShW > BOBST_MAX_W or bShL > BOBST_MAX_L: return {viable:false, reason:"computed sheet exceeds Bobst envelope"}.
5. bBc = calcBoard({...spec, widthIn:bShW, lengthIn:bShL}, bReq).
6. If bBc.pricable: return custom-imposition result.
7. If bBc.hasPrice && !bBc.meetMin: stock-min-buy scale (mirror jsx L319-334 pattern). Compute minBuy = ceil(minSqFt/sheetSqFt), recompute at minBuy, scale total by req/minBuy. Return scaled-cost result with isStock:false but stockMode:true marker.
8. (Option B only — currently no-op): scan APPROVED_SHEETS within Bobst envelope for stock candidates with the spec-matching grade/liner/medium chain. Return cheapest pricable.
9. If nothing pricable: return {viable:false, reason:"no Bobst-eligible board pricing — even at mill minimum"}.
```

Step 7 is the key new behavior. It allows custom Bobst sheets that fall below mill min to still produce a per-piece cost using the same mill-min-buy-with-scale pattern that `autoSelectSheet` uses for stock sheets at jsx L319-334. The job pays a full mill minimum but the math amortizes; the operator sees the resulting per-piece cost and the comparison panel can compare it fairly to CAD.

### 6.2 compareRoutes call shape (jsx L614, engine L918)

```
compareRoutes(oneUpW, oneUpL, boardSpec, totalQty, asmp, opts) {
  if(asmp.bobstFirstSizing !== "false") {
    bobstSel = selectBobstSheet(...);
  } else {
    bobstSel = legacyBobstFromCadSheet(cadSel);  // D-121 behavior
  }
  cadSel = autoSelectSheet(...);   // unchanged
  crestSel = best-of-Crest-candidates;  // unchanged
  // compute press/cut/die costs per route on per-route sheets
  // pick winner = min(cad.total, crest.total, bobst.total)
}
```

Return shape extension (already in D-121, refined):
- `bobst: {w, l, pps, req, board, press, cut, hrs, die, dieEstimated, total, isStock, isMillMinScaled}` or `null`
- `bobstReason` — populated only when `bobst===null`
- `winner` field accepts `"Bobst"` (already added in D-121, unchanged)

`isMillMinScaled` flag is new — fires when step 7 fired. Used by the comparison panel footer to render an annotation: `Bobst pays mill min — actual sheets {bReq}, billed {minBuySheets}` so the operator understands the cost basis.

### 6.3 Engine.js parity (closes D-121 gap)

`spot_engine.js` `compareRoutes` (L918-1000) ships with no Bobst column at all — D-121's claim that "JSX and engine.js parallel implementations both need the same change" was honored only for `calcWF`, not for `compareRoutes` or `autoRoute`. D-123 closes this gap by porting the full Bobst-first restructure to engine.js. Net effect on runner-driven fleet regression: zero (no historical jobs would route to Bobst even with the fix in place — calibration framework §Bobst is preserved).

---

## 7. autoRoute Restructure

JSX `autoRoute` (L500-546) already has a Bobst-first preference block from D-121, but it (a) doesn't use `selectBobstSheet`, (b) doesn't try mill-min scaling on custom Bobst, and (c) silently falls through to CAD/Crest if no stock-Bobst sheet is found.

D-123 changes:

1. Replace the inline Bobst block with a single `selectBobstSheet` call.
2. If `selectBobstSheet` returns viable, return `{route:"Bobst", sheet:bobstSel, warning:null, cadHrs}`.
3. If `bobstFirstSizing === "false"`, skip the call and fall through to CAD (D-121 status quo).
4. Engine.js `autoRoute` (L495-559) gets the Bobst-first block ported in (currently absent — D-121 parity gap).

Force-route behavior (jsx L5208-5223 `tryForceBobst`) is unchanged in D-123 — the existing hard-blocks on flute and envelope stay; the brief's open question about a "no Bobst-eligible sheet available" hard-block is moot once `selectBobstSheet` always returns a viable mill-min-scaled custom sheet for in-envelope E/F jobs.

If the user forces Bobst on a job where `selectBobstSheet` returns `{viable:false}` (piece exceeds envelope after computation, or pricing has no entry at any size), `tryForceBobst` toasts the specific `reason` from `selectBobstSheet` and refuses the override. Surface this by passing the result through to the existing toast-and-bail logic.

---

## 8. JSON Schema

```json
{
  "...": "...",
  "bobstFirstSizing": "true",
  "...": "..."
}
```

- `gatherState` adds the field.
- `applyState` restores it via the existing `if(s.bobstFirstSizing) setBobstFirstSizing(s.bobstFirstSizing)` pattern (jsx ~L2533 area).
- Rate-migration `_ck` array (jsx ~L2604-2605, parallel to engine's `_D = E.RATE_DEFAULTS`) is extended.
- `newEstimate` seed includes the field alongside other rate state (jsx ~L2466 / L2483 area).

Pre-D-123 JSONs: no `bobstFirstSizing` key → `useState` default `"true"` applies. Behavior change for pre-D-123 estimates loaded into D-123: now-Bobst-eligible E/F jobs will recompute and may flip route to Bobst. This is deliberate (the whole point of the patch). Operators reviewing legacy quotes should expect the change; the comparison panel will show the new Bobst column whenever eligible.

---

## 9. Engine Math (calcWF)

**No change.** D-121's Bobst branch in `calcWF` (jsx L867-874, engine L665-672) consumed `cadHrs` from the routing decision and computed cutter direct using flat Bobst rates. That math is preserved verbatim — D-123 only changes which sheet is fed in.

---

## 10. Force-Route Behavior

| Condition | Behavior |
|---|---|
| Flute is B or C | Hard-block (D-121, unchanged) |
| Sheet outside envelope | Hard-block (D-121, unchanged) |
| `selectBobstSheet` returns `{viable:false, reason:X}` | Hard-block. Toast: `Cannot route to Bobst: ${reason}`. `routeOverride` unchanged. |
| E/F flute + valid Bobst sheet via `selectBobstSheet` | Apply override normally |

`tryForceBobst` calls `selectBobstSheet` once before applying the override and uses its `reason` field for the toast text when not viable.

---

## 11. Smoke Test (Predicted Outcomes)

Test job: E-flute one-up 8×10 / qty 5,000 / 200 ECT 32 / Kemi-Lite both sides / Standard CAD difficulty / dieTreatment Separate Line / no entered die cost.

**Pre-D-123 (R1.5.5):**
- autoSelectSheet → 63×126 stock sheet
- autoRoute → CAD (Bobst-first block fails: custom Bobst not pricable, no stock Bobst sheet exists)
- compareRoutes → 3 columns; "Bobst not viable: board not pricable at Bobst sheet size"
- Estimate runs on CAD route at 63×126

**Post-D-123 (R1.5.6) with `bobstFirstSizing="true"`:**
- selectBobstSheet → custom 34×22 imposition, below mill min, scaled via min-buy
- autoSelectSheet → 63×126 (CAD's path, unchanged)
- compareRoutes returns 4 columns:
  - CAD on 63×126: $X cad cost
  - Crest on best ≤60×120: $1,534 cut + die $1,800 + board
  - **Bobst on 34×22 (mill-min-scaled): $846 cut + die $1,800 + scaled board, `isMillMinScaled:true`**
  - Winner: depends on board math (mill-min penalty vs. material savings) — math projection below
- autoRoute: routes to Bobst if its total beats CAD; else CAD
- Footer annotates: `Bobst pays mill min — actual sheets 625, billed {minBuySheets}`

**Math check on board:**
- 200 ECT 32 E flute, oMSF for `pricable` requires 25,000 sqft = 4,816 sheets at 5.19 sqft each
- minBuy = 4,816, scale = 625/4,816 = 0.130
- Board at min: 4,816 × 5.19 sqft / 1000 × $87.7/MSF (ECT 32 1-3 MSF tier) ≈ $2,191 + Kemi liner upcharges + pallet prep + FSC
- Scaled to 625 sheets: $2,191 × 0.130 ≈ $285 board cost
- Crest at 63×126 stock 5,000 qty: ~$680 board (multiple pcs/sheet, far fewer sheets needed)
- Bobst total: ~$285 board + $846 cut + $1,800 die + ~$0 press (no print on this job per smoke) ≈ $2,931
- Crest total (recompute): ~$680 board + $1,534 cut + $1,800 die + ~$0 press ≈ $4,014
- **Bobst wins by ~$1,083. Comparison panel shows "Bobst wins" header.**

(With print on, Inca press cost is roughly equivalent across routes since it's per-printed-sheet not per-cutting-sheet, so the $1,083 delta survives.)

If the math projection holds, this is the smoke test for sign-off. If it does not — i.e., mill-min penalty exceeds Bobst cut savings at 5,000 qty — the Bobst-first design still works but the win threshold moves higher up the qty curve. That outcome is interesting in its own right; document it.

**Sub-scenario — qty 1,000 (breakeven check):**
- Bobst cut: (45/60 + 1000/3000) × $350 = $379
- Crest cut: (45/60 + 1000/150) × $45 = $334
- Bobst still pays full mill min on board (1,000/8 = 125 sheets, ~0.65 MSF, far below 25 MSF)
- Bobst board scaled: $2,191 × (125/4,816) ≈ $57 — but the mill-min full-cost is $2,191. Operator pays $2,191 for the board.
- Per-piece basis still scales — Bobst totals (1000 × $0.057 board + $379 cut + $1,800 die)/1000 = $2,236 / 1000 = $2.24/pc
- Crest: ($680 board + $334 cut + $1,800 die)/1000 = $2.81/pc
- Bobst still wins per-piece, but at this qty the absolute mill-min cash outlay is meaningful — this is where the operator-level "do we really want to commit to a $2,191 mill order for 1,000 pcs?" judgment kicks in. **Recommend a UI annotation when `isMillMinScaled && bReq < minBuy` so operators see the cash-vs-per-piece distinction.**

**Sub-scenario — B flute job (regression check):**
- B flute fails `BOBST_FLUTES.includes` check at the top of `selectBobstSheet`.
- Returns `{viable:false, reason:"B flute exceeds Bobst's 0.060″ caliper limit"}`.
- compareRoutes shows 3 columns (CAD + Crest, no Bobst), footer annotates with reason.
- autoRoute skips Bobst block, goes to RULE-017.
- **No regression on B/C jobs.**

---

## 12. Calibration Impact

- **CAD/Crest math unchanged.** No engine constants modified.
- **Bobst pricing unchanged.** `bobstRate=$350/hr`, `bobstSpeed=3000 sh/hr`, `bobstSetup=45 min`, `bobstMinChg=$250`, `bobstDieCost=$1,800` all preserved per D-121.
- **Fleet regression: no new run.** Per `DEV_Calibration_Framework_v2.md` §Bobst, the 785-job iQuote fleet has zero historical Bobst-routed jobs. Re-running `fleet_compare.js` against the historical CSV will produce R² 0.974 unchanged because no historical job matches the Bobst envelope check (their sheets exceeded it then; the new sizing logic doesn't retroactively reroute past jobs because their `bobstFirstSizing` would default `"true"` but their pieces' Bobst-imposed sheet would still need to be pricable — a soft check we've validated for the smoke job above; for the historical fleet, with quantities mostly in the 5K-50K range, a similar mill-min-scale pattern may now route to Bobst). **Smoke this against the fleet pre-merge as a sanity check: if R² moves more than 0.005 in either direction, we have a Bobst-leaks-into-fleet finding to investigate.**
- **90-day Bobst recalibration trigger preserved.** Per D-121 §13.

---

## 13. Out of Scope

- Library SKU seeding (Option B in §5) — deferred unless ~10 Bobst jobs surface a common imposition pattern.
- Multi-up Bobst layout optimization beyond the simple `floor((MAX-2)/oneUp)` math — the existing math is already optimal for rectilinear single-piece layouts; non-rectilinear nesting is out of scope.
- Bobst-specific QC/print-quality flags (covered by general printMode).
- Fleet recalibration against historical CSV (no path to a Bobst baseline; 90-day recal is the plan).
- Customer-specific zone overrides for Bobst routing preference (Phase 2+ from D-121).

---

## 14. Files Changed

| File | L (before → after, est.) | Notes |
|---|---|---|
| `spot_r1_5.jsx` | 7844 → ~7920 | New `selectBobstSheet` helper (~50 lines), refactored Bobst blocks in `autoRoute` and `compareRoutes`, new `bobstFirstSizing` state + JSON wiring, optional UI toggle in Advanced Rates (paired with D-122 inputs) |
| `spot_engine.js` | 1021 → ~1100 | Same surface changes ported; closes D-121 parity gap (autoRoute + compareRoutes Bobst blocks newly added). Also flips `defaultPrintMode:"Gloss"` → `"Satin"` per §8.2 (cosmetic, unused field) |
| `spot_runner.js` | 356 → ~358 | `ASMP_DEFAULTS.bobstFirstSizing` added; no logic change |
| `build_spot_r1_5.js` | 57 → 57 | HTML title bumped R1.5.5 → R1.5.6 |
| `DEV_SPOT_R1_5_Control_Tables.md` | 211 → ~218 | Routes section gets a "Sheet selection order" footnote noting per-route sheet selection; rate row for `bobstFirstSizing` added |
| `DEV_Calibration_Framework_v2.md` | 263 → ~270 | Bobst section appended with note that fleet's lack of Bobst-eligible jobs may be a sizing-logic artifact pre-D-123, and that R² should be smoked post-merge |

**Version strings to bump R1.5.5 → R1.5.6 in 5 sites** (mirrors D-121 §15):
- `spot_r1_5.jsx` line 4 (header comment)
- `spot_r1_5.jsx` line 6 (`window.__SPOT_UI_VERSION`)
- `spot_r1_5.jsx` line ~2863 (browser tab title)
- `spot_r1_5.jsx` line ~4552 (UI badge)
- `build_spot_r1_5.js` line ~43 (HTML `<title>`)
- `spot_server.js` line 1 (header comment) — IF §8.1 server reconciliation also lands in this release; otherwise leave for separate ship.

`spot_server.js` itself: **unchanged** by D-123. The drift in §8.1 is a separate item.

---

## 15. Tests Filed

### TC-029 unblock (no new sub-cases)

Existing 14 TC-029 sub-cases (filed 2026-04-26, R1.5.5 target) become executable post-D-123 because the Bobst route can actually win in the live UI. No spec change to TC-029 required — re-target as R1.5.6.

### TC-030 — D-123 Bobst-first sheet sizing validation (5 sub-cases, R1.5.6 target)

| Sub-case | Test |
|---|---|
| .1 | `bobstFirstSizing="true"` (default) + E-flute 8×10 / 5K → Bobst column renders in compareRoutes with `isMillMinScaled:true` annotation; "Bobst wins" header |
| .2 | `bobstFirstSizing="false"` → reverts to D-121 path; comparison panel renders 3 columns (Bobst not viable: board not pricable at Bobst sheet size) — confirms revert flag honored |
| .3 | B flute 8×10 / 5K → 3 columns, Bobst not viable, reason cites flute caliper. autoRoute picks CAD/Crest, no regression |
| .4 | E flute one-up 50×30 (exceeds Bobst envelope on first dim) → 3 columns, Bobst not viable, reason cites envelope. No regression |
| .5 | Force-Bobst on B flute → toast hard-blocks with caliper reason. Force-Bobst on out-of-envelope E job → toast hard-blocks with envelope reason. Force-Bobst on a viable mill-min-scaled E job → applies override, comparison panel reflects forced state |

### Fleet smoke (no new TC, runs as part of regression suite)

Per §12, run `fleet_compare.js` post-merge against the historical CSV. Expected R² 0.974 ± 0.005. If R² moves outside that band, investigate which jobs newly route to Bobst — they may invalidate the "no historical Bobst routing" assumption that makes D-121's calibration deferral defensible.

---

## 16. Audit-Verifiable Surface List

For the post-merge audit, these are the concrete code surfaces that change. An auditor should be able to grep for each and confirm presence:

```
spot_r1_5.jsx:
  function selectBobstSheet(           # new — ~L275 (before autoSelectSheet)
  bobstFirstSizing                      # 8+ hits (state, gather, apply, migration, UI, routing)
  isMillMinScaled                       # 2-3 hits in compareRoutes return + UI footer
  asmp.bobstFirstSizing                 # 3 hits (autoRoute, compareRoutes, UI conditional)

spot_engine.js:
  function selectBobstSheet(            # new — ~L270 (before autoSelectSheet)
  // ─── D-121 RULE-021: Bobst first-preference ───   # newly present in autoRoute (was absent)
  // ─── D-121: Bobst path                            # newly present in compareRoutes (was absent)
  bobstFirstSizing                      # in RATE_DEFAULTS
  defaultPrintMode:"Satin"              # was "Gloss" (§8.2 fold-in)

spot_runner.js:
  bobstFirstSizing: "true"              # in ASMP_DEFAULTS
```

Smoke commands for audit (post-deploy):

```bash
# Source line counts and SHAs
wc -l spot_r1_5.jsx spot_engine.js spot_runner.js build_spot_r1_5.js
sha256sum spot_r1_5.jsx spot_engine.js spot_runner.js build_spot_r1_5.js | cut -c1-12

# Bobst-first parity check (engine vs jsx)
grep -c "selectBobstSheet" spot_r1_5.jsx spot_engine.js
grep -c "bobstFirstSizing" spot_r1_5.jsx spot_engine.js spot_runner.js

# Browser smoke (manual)
# - Load TC-030.1 JSON via __SPOT_LOAD_JSON
# - Confirm 4-column comparison panel
# - Confirm "Bobst wins" header and isMillMinScaled annotation footer
```

---

**Hand-off:** on operator sign-off of this design, ship the patch bundle with file replacements per §14. The bundle covers JSX + engine.js + runner.js + build script + Control Tables + Calibration Framework as a single atomic R1.5.5 → R1.5.6 release. `spot_server.js` left for §8.1 reconciliation in a separate cycle unless the operator wants to bundle them.
