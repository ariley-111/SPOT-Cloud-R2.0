# SPOT Calibration Framework v2

**Version:** 2.0
**Date:** 2026-04-24
**Supersedes:** Ad-hoc tuning practice pre-D-110
**Referenced by:** `DEV_D110_Design_Decision.md`, `TEST_SPOT_R1_5_Testing_Guide.md`

> This is the standard methodology for recalibrating SPOT against fleet data. Every future fleet calibration (D-### that touches engine rates, GM curve, print speeds, or flute upcharges) must follow this framework. The D-110 session was the first full application — see `DEV_Session_Learnings_2026-04-24.md` for what we learned while developing the framework.

---

## 1. Philosophy

SPOT calibration is an iterative process with three required inputs:

1. **A full fleet dataset** from iQuote or equivalent production history (currently `WF_Quoting_Tool_Test_Data.xlsx` with 785 jobs, 24-month window).
2. **An explicit list of Planned Changes (P1, P2, …)** — intentional deviations from the baseline with documented targets and rationale.
3. **An explicit Tolerance Framework** — the ±band each metric is allowed to deviate outside of planned changes.

A calibration is complete when (a) every planned change hits its target and (b) every unplanned deviation lands inside the tolerance band, OR the out-of-tolerance items are flagged with diagnosis and board acceptance.

---

## 2. Calibration Playbook (Standard Procedure)

Run this sequence for any fleet recalibration. Each step produces output that feeds the next.

### Step 1 — Define Planned Changes BEFORE Tuning

Before touching any engine constant, write down:
- What is changing vs the current production engine
- Why (business rationale, 1-2 sentences each)
- What the measurable target is
- How it will be validated

Planned changes are typically one of:
- **Rate calibration** (e.g., incaRate tracks press actuals)
- **Pass-through** (e.g., E flute sheet efficiency flows through to customer)
- **Systematic correction** (e.g., ink area basis, corrugated hike pass-through)
- **Structural override** (e.g., GM floors that reject iQuote giveaway pricing)

Document these in a companion `DEV_Dxxx_Design_Decision.md` file referenced by the open issue.

### Step 2 — Set Tolerance Bands BEFORE Tuning

Tolerance bands are set *before* parameter sweeping, not after. Otherwise you find yourself widening the band to accommodate your last sweep — classic over-fit.

Standard tolerance bands (see `DEV_D110_Design_Decision.md`):
- Material: ±2pt of +10% target
- Press: ±5% of iQuote
- Cutting: ±5% of iQuote
- Glue: ±10% of iQuote
- Fleet sell: ±2pt of +8% target
- Per-tier B flute sell: ±3pt of +8% target

Adjust these only with explicit justification.

### Step 3 — Load the Fleet, Score, Reconcile by Component

Use `DEV_fleet_compare.js` to score the full fleet. Produce a component reconciliation table:

| Component | iQuote Total | SPOT Total | Δ$ | Δ% | In Tolerance? |
|---|---|---|---|---|---|
| Material | … | … | … | … | ✓/✗ |
| Ink | … | … | … | … | ✓/✗ (likely excluded — see P4 in Design Decision) |
| Press | … | … | … | … | ✓/✗ |
| Cutting | … | … | … | … | ✓/✗ |
| Glue | … | … | … | … | ✓/✗ |
| **Total** | … | … | … | … | ✓/✗ |

### Step 4 — Tune Out-of-Tolerance Components One at a Time

For each component flagged ✗ OUT:

1. Identify the engine parameter that drives that component:
   - Press → `incaRate`, `PRINT_SPEEDS`
   - CAD cutting → `cadRate`, `CAD_SETUP`, `CAD_FALLBACK`
   - Crest cutting → `crestRate`, `crestSetupStd/Adv`, die adjustment
   - Material → `base_matrix` rates (grade × wall × MSF tier)
   - Glue → `handGlueRate`, per-joint formulas

2. Run a parameter sweep (minimum 12 values across a meaningful range).

3. Plot/table the sweep against the in-tolerance target for that component.

4. Pick the value that lands the component at the center of tolerance, not the edge.

5. Re-run the full fleet. Re-check ALL components — tuning one can shift others.

**Do not batch multiple parameter changes without re-running the fleet in between.** Compound changes hide interactions.

### Step 5 — Tune GM Curve for Per-Tier Sell Target

After components are in tolerance, tune GM curve for per-tier sell performance:

1. For each MSF tier, compute observed B Kemi sell Δ%.
2. For each OOT tier, compute the GM change needed to land it at +8% sell.
3. Candidate GM curves should be evaluated against BOTH B Kemi AND E Kemi simultaneously (tuning for one can break the other — especially E flute pass-through cases).
4. Run the fleet with each candidate curve. Pick the curve that minimizes max deviation from +8% target on B Kemi while preserving E flute pass-through on E Kemi.

### Step 6 — Validate Statistical Correlation at Segment Level

Per-job R² is misleading because it includes within-segment production noise. The correct calibration metric is **segment-level R²**:

- Aggregate jobs into segments by (flute × MSF tier).
- Compute R² on segment totals.
- Expect R² > 0.95 on cost and > 0.90 on sell for a well-calibrated engine.

Also compute:
- Grade × flute × MSF segment-level R² (finest grouping, ~30 segments).
- MSF-tier-only rollup (6 segments).
- Per-component segment R² (Material, Press, Cutting should be > 0.90).

Ink and Glue segment R² are typically lower (0.2–0.4) — by design for ink, per-job formula variance for glue. These are not defects.

### Step 7 — Audit iQuote Volume-Tier Giveaway Pattern

For every calibration, check: how many iQuote jobs were priced below 20% GM at 5+ MSF tiers? If significant (>10% of volume jobs), the GM floor design choice is justified. Document the giveaway count in the Design Decision.

### Step 8 — Classify Every Deviation

Final deliverable: a table of every deviation, classified:

| Deviation | Type | Within Tolerance? | Action |
|---|---|---|---|
| Material +11.4% | Planned (P3) | ✓ within ±2pt | Document |
| Press −0.5% | Unplanned | ✓ within ±5% | Document |
| Cutting −2.8% | Unplanned | ✓ within ±5% | Document |
| Glue +7.0% | Unplanned | ✓ within ±10% | Document |
| Fleet sell +8.3% | Planned (P1) | ✓ within ±2pt | Document |
| B 1-3 MSF sell +11.6% | Unplanned | ✗ 0.6pt over | Flag for board |
| B 5-9 MSF sell +14.5% | Unplanned | ✗ 3.5pt over | Flag for board, thin sample |
| B 10-24 MSF sell +18.2% | Unplanned | ✗ 7.2pt over | Flag for board, thin sample |

### Step 9 — Produce Board & Full Validation Reports

Final deliverable is two PDFs using the framework documented in this playbook:

- **Board Report** (~8 pages) — executive-level, leading with planned changes, tolerance framework, and compliance status. R² reported as footnote, not headline.
- **Full Validation Report** (~11 pages) — engineering depth, component-by-component, per-tier diagnosis, segment-level R², iQuote giveaway analysis.

Templates and example output: `/mnt/user-data/outputs/SPOT_D110_Board_Report.pdf` and `SPOT_D110_Final_Validation_Report.pdf`.

---

## 3. Comparison Script Requirements (`fleet_compare.js`)

The comparison script must support:

- **Rule-inches mode** — when iQuote provides `CuttingInchesPerSheet`, use it (divided by `NumberUp`) as `totalRuleInches` for SPOT. More accurate than difficulty-mode fallback.
- **Hand glue enablement** — set `handGluing: "Yes"` when iQuote `ActualHandglueCost > 0`; otherwise `"No"`.
- **Crest die adjustment** — add `$1,200/job` to SPOT cost on Crest-routed jobs to account for iQuote's bundled die cost.
- **FSC enablement** — set `fscEnabled: true` when the iQuote spec string contains "FSC" (case-insensitive).
- **Satin print default** — iQuote did not differentiate print mode; SPOT should use Satin as the default unless ColorsBack > 0 (then 2-Sided is set).

Per-job output: cost, sell, cost Δ, sell Δ, route, MSF tier, difficulty, flute, grade.
Fleet output: component totals (material, ink, press, cutting, glue), fleet cost/sell Δ, cost/sell R² (per-job), segment-level R² (flute × MSF, grade × flute × MSF).

---

## 4. Test Framework Integration

See `TEST_SPOT_R1_5_Testing_Guide.md` Section 4 "Fleet Regression" for the standard fleet regression test. Baseline expectations after D-110:

| Metric | Expected |
|---|---|
| Fleet cost Δ | +6.5% ± 0.5% |
| Fleet sell Δ | +8.3% ± 0.5% |
| Per-job cost R² | 0.85 ± 0.02 |
| Segment cost R² (flute × MSF) | 0.97 ± 0.02 |
| Segment sell R² (flute × MSF) | 0.95 ± 0.02 |
| Material component Δ | +11.4% ± 2pt |
| Press component Δ | −0.5% ± 2pt |
| Cutting component Δ | −2.8% ± 2pt |
| Glue component Δ | +7.0% ± 3pt |

If any metric deviates by more than the tolerance shown, flag for investigation before shipping.

---

## 5. Common Pitfalls

- **Tuning before tolerance bands are set** — leads to moving-goalpost syndrome.
- **Batching parameter changes** — compound changes hide interactions.
- **Using per-job R² as calibration quality metric** — includes within-segment production noise unrelated to calibration.
- **Forgetting hand glue enablement** — missed $92K on the D-110 baseline until corrected.
- **Using difficulty mode when rule-inches mode is available** — difficulty mode is coarser.
- **Chasing outliers** — thin-sample tiers (25+ MSF has 8 jobs) shift wildly on single outliers.
- **Over-fitting to iQuote's historical pricing** — forces SPOT to replicate iQuote's flaws, defeating the calibration.
- **Treating E flute pass-through as a defect** — P2 is a design choice; don't try to mitigate it out.

---



## Bobst — UNCALIBRATED (D-121, 2026-04-26)

**Status:** Cost class P (Planned deviation). Ship as placeholder, recalibrate after shop-floor data accumulates.

**Reason calibration is deferred:**

The 785-job iQuote fleet contains zero historical SPC E-flute jobs that fit Bobst's 41.75×29.125 envelope. Every E-flute job in the fleet ran on 48×96, 60×120, 63×126, 50×117, or 63×98 sheets — all too large for Bobst. There is no historical baseline to regress against.

**Pricing parameters (placeholder values):**

| Parameter | Value | Rationale |
|---|---|---|
| Hourly rate | $350/hr | Mid-range between cost-accounting math ($135–270/hr) and premium positioning ($750/hr considered, rejected as too aggressive) |
| Run speed | 3,000 sh/hr | Manufacturer spec for E/F flute work |
| Setup time | 45 min flat | No Std/Adv differentiation per machine spec |
| Minimum charge | $250 | Slot-cost floor for the press |
| Default die cost | $1,800 | Typical small-format steel rule die for Bobst-class work |

**Calibration trigger:**

Recalibrate when EITHER condition is met first:
- 90 days post-deploy
- ≥30 Bobst jobs run on the shop floor

**What recalibration looks like:**

1. Pull actual production data from Bobst floor reports (setup time observed, sheets/hr observed, total cost per job).
2. Compute observed `bobstRate` = (cost − minor consumables) / (setup_hr + run_hr).
3. Compare observed rate to placeholder $350. If delta > 15%, flag for adjustment.
4. Compute observed Bobst sell delta vs CAD/Crest equivalent for the same job (where alternative route was theoretically viable). Confirm Bobst sells at expected production-economics gap (Bobst should be cheaper at scale per smoke test: $688 advantage on 5K-sheet × 4-up E-flute job).
5. Update RATE_DEFAULTS.bobstRate (and bobstSpeed/bobstSetup/bobstMinChg/bobstDieCost as needed). Bump to a calibrated entry. File a D-### at recalibration time.

**Hard constraint preserved:**

Standard tier difficulty multiplier remains at 1.00× per D-099 (785-job R² 0.974 fleet). Bobst math is a parallel addition that does NOT couple with the calibrated CAD/Crest equation. The fleet regression baseline is intact — running fleet_compare.js against the historical CSV will produce the same R² because no historical jobs route to Bobst.

**Smoke test reference:**

5,000-sheet × 4-up E-flute job at $350/hr Bobst vs $45/hr Crest:
- Bobst: 2.42 hr × $350 = $846 cutter cost (45 min setup + 100 min run @ 3000 sh/hr)
- Crest: 34.08 hr × $45 = $1,534 cutter cost (45 min setup + 33.3 hr run @ 150 sh/hr)
- Bobst is $688 cheaper at this scale — production-economics-correct given 20× speed advantage.

This is sanity-check math, not calibration. The $350/hr rate is unproven against actual SPC production overhead until shop-floor data exists.

**Sheet-selection-artifact addendum (D-123, 2026-04-26):**

The original D-121 framing — "the 785-job iQuote fleet contains zero historical SPC E-flute jobs that fit Bobst's 41.75×29.125 envelope" — is technically true but materially misleading as a calibration finding. The fleet's lack of Bobst-eligible jobs is **a sheet-selection-logic artifact, not an inherent property of E-flute work at SPC**.

Specifically: every historical E-flute job was costed against the CAD-optimal sheet (largest sheet that fits, e.g. 63×126 at 8×10 one-up) because that's how iQuote and pre-D-123 SPOT both worked. The sheet was always too large to run on Bobst, so Bobst was never even considered. The pieces themselves frequently could have been imposed on a Bobst-eligible custom sheet (34×22 for the canonical 8×10 example) — the historical job records just don't show that path because the path didn't exist in either tool.

D-123 changes the sheet-selection logic: E/F flute jobs now run sheet selection per route, with Bobst getting its own envelope-eligible custom sheet (mill-min-buy scaled when the order is below corrugator minimum). The 785-job historical fleet, re-scored under D-123, may produce different routing decisions than under D-121. **Re-run `fleet_compare.js` against the historical CSV post-deploy.** Expectation: R² 0.974 ± 0.005. If R² moves more than that, jobs are now newly routing to Bobst — investigate which segment, and whether the new routing decisions are economically correct or whether mill-min penalty makes them worse than CAD/Crest at low qty.

This does NOT invalidate the 90-day Bobst recalibration trigger. It just means the trigger may fire faster than expected if D-123 routing pushes more jobs through Bobst than the original "zero historical Bobst jobs" estimate implied.

**File touchpoints:**
- `spot_r1_5.jsx` RATE_DEFAULTS (line ~158, post-D-121)
- `spot_engine.js` RATE_DEFAULTS (line ~158, post-D-121)
- `spot_runner.js` ASMP_DEFAULTS (line ~22, post-D-121)
- All three coordinated — change RATE_DEFAULTS in one, update all three.

**Spec:** `DEV_D121_Design_Decision.md`, `DEV_D123_Design_Decision.md`
**Open issue:** none yet — recalibration tracked outside the issue ledger until trigger fires.

## 6. Files Produced by a Fleet Calibration

Every fleet calibration produces this standard set of deliverables:

1. `DEV_D###_Design_Decision.md` — planned changes, tolerance framework, rationale.
2. Updated source files — `spot_engine.js`, `spot_r1_5.jsx`, `fleet_compare.js`.
3. Updated control tables — `DEV_SPOT_R1_5_Control_Tables.md` (current rates).
4. Updated testing guide — `TEST_SPOT_R1_5_Testing_Guide.md` (expected fleet metrics).
5. Release entry — `02_RELEASE_HISTORY.md` (append-only, under the active release).
6. Board Report PDF — executive-level validation.
7. Full Validation Report PDF — engineering-depth validation.

These are the minimum. Session learnings go in a dated file like `DEV_Session_Learnings_YYYY-MM-DD.md`.

