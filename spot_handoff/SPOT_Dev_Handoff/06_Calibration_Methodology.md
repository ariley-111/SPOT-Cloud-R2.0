# 06 — Calibration Methodology

This file is the playbook for any future fleet recalibration. The full methodology was developed under D-110 and documented in `DEV_Calibration_Framework_v2.md`. This file is the working summary.

---

## The philosophy

Recalibration is an iterative process that requires three inputs:

1. **A full fleet dataset** — historical job records. Currently `WF_Quoting_Tool_Test_Data.xlsx` with 785 jobs, 24-month window.
2. **An explicit list of Planned Changes (P1, P2, …)** — intentional deviations from baseline with documented targets and rationale.
3. **An explicit Tolerance Framework** — the ±band each metric is allowed to deviate, outside of planned changes.

A calibration is complete when (a) every planned change hits its target and (b) every unplanned deviation lands inside tolerance, or the OOT items are flagged with diagnosis and accepted by the board.

---

## The standard procedure

### Step 1 — Define Planned Changes BEFORE tuning

Before touching any engine constant, write down:
- What is changing vs the current production engine
- Why (business rationale, 1–2 sentences each)
- What the measurable target is
- How it will be validated

Planned changes are usually one of:
- **Rate calibration** (e.g. `incaRate` tracks press actuals)
- **Pass-through** (e.g. E flute sheet efficiency flows through to customer)
- **Systematic correction** (e.g. ink area basis, corrugated hike pass-through)
- **Structural override** (e.g. GM floors that reject iQuote giveaway pricing)

Document these in a companion `DEV_D###_Design_Decision.md` file referenced by the open issue.

### Step 2 — Set Tolerance Bands BEFORE tuning

Tolerance bands are set *before* parameter sweeping, not after. Otherwise you find yourself widening the band to fit your last sweep — classic overfit.

Standard tolerance bands (D-110):

| Component | Tolerance |
|---|---|
| Material | ±2pt of +10% target |
| Press | ±5% of iQuote |
| Cutting | ±5% of iQuote |
| Glue | ±10% of iQuote |
| Fleet sell | ±2pt of +8% target |
| Per-tier B flute sell | ±3pt of +8% target |

Adjust only with explicit justification.

### Step 3 — Load fleet, score, reconcile by component

Use `fleet_compare.js` to score the full fleet. Produce a component reconciliation table:

| Component | iQuote Total | SPOT Total | Δ$ | Δ% | In Tolerance? |
|---|---|---|---|---|---|
| Material | … | … | … | … | ✓/✗ |
| Ink | … | … | … | … | ✓/✗ (often excluded — P4) |
| Press | … | … | … | … | ✓/✗ |
| Cutting | … | … | … | … | ✓/✗ |
| Glue | … | … | … | … | ✓/✗ |
| **Total** | … | … | … | … | ✓/✗ |

### Step 4 — Tune OOT components one at a time

For each component flagged ✗:

1. Identify the engine parameter that drives that component:
   - Press → `incaRate`, `PRINT_SPEEDS`
   - CAD cutting → `cadRate`, `CAD_SETUP`, `CAD_FALLBACK`
   - Crest cutting → `crestRate`, `crestSetupStd/Adv`, die adjustment
   - Material → `base_matrix` rates (grade × wall × MSF tier)
   - Glue → `handGlueRate`, per-joint formulas

2. Single-parameter sweep — change one number, re-run, observe.

3. Bisect to find the value that lands inside tolerance.

4. Validate that other components didn't drift out as a side-effect. Recalibration of one parameter can shift the loading of others.

### Step 5 — Validate at segment level

Per-job R² is a noisy metric. Segment-level R² (jobs grouped by flute × MSF tier, or grade × flute × MSF) is more stable and reflects how SPOT performs across the natural shop mix.

The D-110 FINAL targets were:
- Segment Cost R² > 0.95 (achieved 0.969)
- Segment Sell R² > 0.94 (achieved 0.949)
- Fleet sell premium target +8.2%, tolerance ±2pt (achieved +8.30%)

### Step 6 — Document and ship

The recalibration ships as a single D-### in `01_OPEN_ISSUES.md`, with a companion design doc in `DEV_D###_Design_Decision.md`. After ship:
- The new rates land in source
- The release-history entry records the SHAs of the changed files
- The control table (`04_Control_Tables_Reference.md`) updates to match
- Open issue closes; release history appends

---

## Why we don't recalibrate continuously

Three reasons:

1. **Estimator trust.** When rates change, every saved estimate becomes a moving target. Estimators need to know "the price I quoted last week reflects last week's rates" — Rule 6 protects that, but only if rate changes are visible and discrete.
2. **Validation cost.** Each recalibration requires re-running the 773-job fleet, segmenting, validating tolerance, writing a design doc. ~4–6 hours per cycle.
3. **Drift detection.** If you recalibrate every week, you can't tell whether a 2% per-job error is a calibration miss or a real shop change. Slow cycle catches systematic drift, fast cycle masks it.

D-110 was the first full application of this framework. Future recalibrations follow the same playbook.

---

## When NOT to recalibrate

Don't recalibrate when:
- A single customer complains about one quote. Investigate that quote first — it may be an input error.
- A new flute or grade is introduced. That's a product expansion, not a calibration drift. Add the new material to the engine; don't tune existing rates against it.
- Fleet metrics drift by less than tolerance. Within ±2pt segment-level, leave it alone.
- The drift correlates with a recent design decision. Re-validate D-### didn't unintentionally shift loading.

Do recalibrate when:
- Per-job R² has dropped below 0.80 fleet-wide
- A specific MSF tier is consistently out by >5pt
- A material cost change (paper hike, ink price change) has been confirmed by procurement
- The shop adds a new piece of equipment or retires one

---

## Operational fleet_compare workflow

```bash
# In the install folder
cd /path/to/SPOT/install
npm install xlsx                 # one-time
node fleet_compare.js            # reads WF_Quoting_Tool_Test_Data.xlsx
                                 # writes fleet_results.csv, fleet_summary.json
```

Outputs:
- **`fleet_results.csv`** — per-job SPOT vs iQuote cost/sell
- **`fleet_summary.json`** — fleet-level stats + outlier list
- **`fleet_unparseable.csv`** — rows dropped for bad board spec

Inspect `fleet_summary.json` for R² and tier-level deltas. Inspect outliers in `fleet_results.csv` (filter by `|Δ%| > 10`).

---

## What changes invalidate the calibration

Any change to these files requires fleet revalidation:

- `spot_engine.js` — full revalidation (engine math)
- `spot_runner.js` — sanity check (runner shouldn't change math)
- ENGINE block of `spot_r1_5.jsx` — if it's a math change, also update `spot_engine.js` and revalidate

Changes that DON'T require revalidation:
- UI-only changes (modals, layouts, button labels)
- Server-side changes (endpoints, parser prompt)
- Customer list, sheet library
- Documentation

The line between math and non-math is sometimes blurry. When in doubt, revalidate.

---

## Last calibration baseline

| Metric | Value | Date |
|---|---|---|
| Segment Cost R² (flute × MSF) | 0.9690 | D-110 FINAL, 2026-04-24 |
| Segment Sell R² (flute × MSF) | 0.9496 | D-110 FINAL |
| Per-job Cost R² | 0.8550 | D-110 FINAL |
| Per-job Sell R² | 0.8360 | D-110 FINAL |
| Fleet total cost delta | +6.55% | D-110 FINAL |
| Fleet sell premium | +8.30% (target +8.2%) | D-110 FINAL |
| Margin lift vs iQuote | +$76,488 | D-110 FINAL |

When you re-run fleet_compare after a change, you're comparing against this baseline. Drift of less than 0.005 in segment R² is within noise. Drift of more is a flag.
