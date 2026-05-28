# D-124 Design Decision — autoRoute Bobst-First vs compareRoutes Cost-Winner

**Status:** RESOLVED 2026-04-26 — Option A selected, ship paired with Bobst rate calibration (held for 90-day shop-floor data window or ≥30 Bobst jobs, whichever first)
**Filed by:** R1.5.6 sign-off audit (OBS-02, 2026-04-26)
**Target ship:** R1.5.7 (held — ships with Bobst rate calibration when calibration data lands)
**Mode:** DEV
**Pairs with:** Bobst rate calibration (DEV_Calibration_Framework_v2.md, 90-day trigger or ≥30 Bobst jobs)

---

## §1. Problem Statement

R1.5.6 sign-off audit smoke math under current placeholder Bobst rates ($350/hr, 3000 sh/hr, 45 min setup, $250 min, $1,800 die):

| Scenario (E flute, 8×10 oneUp, 200 ECT 32, kraft) | CAD | Crest | Bobst | Cost-winner | autoRoute returns |
|---|---|---|---|---|---|
| qty 5,000, no print | $698 | $2,212 | $2,545 | **CAD** | **Bobst** |
| qty 5,000, print Satin | $1,086 | $2,632 | $6,587 | **CAD** | **Bobst** |
| qty 50,000, print Satin | $10,174 | $9,570 | $47,257 | **Crest** | **Bobst** |

The same engine produces two contradictory signals:
- **`autoRoute`** picks **Bobst** (D-121 first-preference rule when `bobstFirstSizing="true"` and `selectBobstSheet` returns viable)
- **`compareRoutes.winner`** picks **CAD** or **Crest** (lowest total cost)

UI consequence: Operator sees the route badge "Bobst" while the comparison panel header reads "CAD wins" (or "Crest wins"). Two contradictory signals on the same screen. Spec-conformant per D-121 ("Auto-route preference: Bobst → Crest → CAD when all viable") but practically confusing.

## §2. Why It Looks Bad

The R1.5.6 smoke math reveals a structural reason Bobst loses on cost despite being the fastest cutter:

- **Press inefficiency dominates.** Bobst sheets are small (≤41.75×29.125, typically ~34×22 for an 8×10 piece). CAD's 63×126 sheet carries ~84 pieces vs Bobst's ~8. On printed jobs, Bobst's 10× sheet count means 10× press hours. The Inca press cost ($485/hr) eats any cutter savings.
- **Mill-min scaling on custom Bobst sheets.** A small custom Bobst sheet hits the 25,000 sqft mill minimum at ~2,888 sheets — but a 5,000-piece job only needs 625 sheets. Path B in `selectBobstSheet` (R1.5.6) correctly scales cost up by 4.6×, making board cost punitive at low volumes.
- **No stock library overlap (audit §6).** Library has 0 E/F flute SKUs in the Bobst envelope, so every Bobst-routed job today triggers custom-mill-order pricing.

The D-121 spec's "Bobst-first preference" was likely reasoning about **shop-floor utility** (Bobst is fast, frees CAD capacity, better registration on small pieces) rather than **per-job cost**. SPOT prices per-job, not by shop scheduling, so the spec's heuristic produces visible cost penalties.

## §3. Resolution Options

### Option A — autoRoute uses cost-winner (recommended)

`autoRoute` returns lowest-cost viable route. `compareRoutes.winner` and `autoRoute` always agree.

**Implementation (~10 lines, jsx + engine):**
```js
// spot_engine.js + spot_r1_5.jsx — replace the current bobstFirstSizing branch in autoRoute
if (assumptions.bobstFirstSizing !== "false") {
  const bSel = selectBobstSheet(oneUpW, oneUpL, boardSpec, totalQty, assumptions);
  if (bSel && bSel.viable) {
    // D-124: Compare Bobst vs CAD totals; pick lowest
    // (selectedSheet here is the CAD-shaped sheet from autoSelectSheet)
    const cadTotal = (selectedSheet?.bc?.total || 0)
                   + Math.max(cadHrs * (assumptions.cadRate||138), assumptions.cadMinCharge||0);
    const bobstCutHrs = (assumptions.bobstSetup||45)/60
                      + bSel.sheetsReq / (assumptions.bobstSpeed||3000);
    const bobstTotal = bSel.bc.total
                     + Math.max(bobstCutHrs * (assumptions.bobstRate||350),
                                assumptions.bobstMinCharge||0);
    if (bobstTotal < cadTotal) {
      return { route:"Bobst", sheet:bSel, warning:null, cadHrs };
    }
    // else fall through to existing CAD/Crest logic
  }
}
```

**Pros:**
- Single source of truth (autoRoute and winner agree).
- Default behavior matches operator cost expectation.
- Self-corrects when Bobst rates calibrate: as Bobst's true cost lands, this comparison will route Bobst-first naturally on jobs where Bobst genuinely wins.
- Existing "Switch to Bobst" button in the comparison panel still serves as the manual override path for shop-floor scheduling cases.

**Cons:**
- Drops the D-121 spec line "Auto-route preference: Bobst → Crest → CAD when all viable." Spec must be revised in `02_RELEASE_HISTORY.md` (D-121 entry) and `DEV_D121_Design_Decision.md`.
- Loses the "use Bobst when fast turnaround needed" workflow as default. Operator must click Switch to Bobst manually each time.

**Calibration path:** No changes needed. As Bobst rates calibrate, this option produces the right answer automatically.

---

### Option B — Keep Bobst-first, add advisory text

`autoRoute` stays as-is (Bobst-first). Comparison panel adds an advisory when `winner !== autoRoute.route`:

> ⚠ Auto-routed Bobst (D-121 preference). Lowest cost is **CAD** ($1,847 cheaper). Click "Switch to CAD" if cost is the priority.

**Implementation (~15 lines, jsx only):**
- Compute mismatch flag in the comparison panel render.
- Conditional advisory render below the route header.
- No engine change.

**Pros:**
- Preserves D-121 spec. No release-history rewrite.
- Quick fix; UI-only.

**Cons:**
- Two-source-of-truth confusion remains. Operator has to read advisory.
- Does not self-correct when Bobst rates calibrate — even if Bobst is genuinely the cheapest, the advisory mechanism will still fire for any cost gap between routes (potentially noisy).
- Adds UI clutter on every Bobst-eligible estimate.

---

### Option C — Calibration-confidence gate

`autoRoute` does Bobst-first only when Bobst rates have been calibrated to a confidence threshold. Otherwise falls back to cost-winner.

**Implementation (~50+ lines):**
- New `RATE_DEFAULTS.bobstCalibrated` flag (default `"false"`).
- New per-rate confidence metadata (low/med/high for each Bobst rate).
- autoRoute branches: if `bobstCalibrated === "true"` use Bobst-first, else cost-winner.
- New UI: calibration status indicator in Advanced Rates.
- New event log entry when operator marks rates calibrated.

**Pros:**
- Most rigorous. Bobst-first becomes earned, not assumed.
- Aligns with the D-110 "P-class planned deviation" framework in DEV_Calibration_Framework_v2.md.

**Cons:**
- Over-engineered for current state. Defining "confidence" formally is a project unto itself.
- Adds metadata burden across save/load/migration.
- Defers the answer: still need to specify what cost-winner vs Bobst-first looks like once calibrated.

---

### Option D — Bobst-first as togglable estimator preference

`autoRoute` uses cost-winner by default. New per-estimator toggle in Advanced Rates: "Prefer Bobst when viable" (default OFF). When ON, autoRoute reverts to D-121 first-preference.

**Implementation (~20 lines, jsx + engine):**
- New state `bobstAutoPreference` (default `"false"`).
- Add to RATE_DEFAULTS, gatherState, applyState, migration.
- autoRoute branches on `assumptions.bobstAutoPreference === "true"`.
- New tile pair in Advanced Rates / Cutting (mirror of `bobstFirstSizing` toggle).

**Pros:**
- Operator chooses behavior. Resolves UX confusion.
- Preserves D-121 intent as opt-in for shop-floor scheduling cases.
- Default matches cost expectations.

**Cons:**
- Adds another config knob. Slight cognitive load on operator to understand the toggle's meaning.
- Two semi-overlapping flags now: `bobstFirstSizing` (controls `selectBobstSheet` invocation) and `bobstAutoPreference` (controls autoRoute behavior). Operator must understand both.

---

## §4. Recommendation

**Option A — autoRoute uses cost-winner.**

Rationale:

1. **The Switch to Bobst button already exists** (D-121 release history confirms it's wired into the comparison panel). That button IS the manual preference mechanism. No new state needed.
2. **Operator expectation of "auto"** is "best for the customer's wallet." Surveying the codebase confirms every other auto-decision in SPOT (sheet selection, route selection, freight rate selection) optimizes for cost. Bobst-first was the only exception.
3. **Self-corrects with calibration.** When Bobst rates calibrate, Bobst will win on cost on jobs where it's genuinely cheapest, and lose on jobs where it isn't. Same code, no new branches.
4. **Lowest implementation surface** of the four options. ~10 lines of code, one entry in 02_RELEASE_HISTORY.md, one paragraph in DEV_D121_Design_Decision.md to revise.

**Reject Option B** because the advisory mechanism will fire on every Bobst-eligible estimate today (since Bobst loses on cost across all current scenarios), creating chronic UI noise that operators will learn to ignore.

**Reject Option C** because it's over-engineered for the current need. If a calibration-confidence framework becomes useful later for other rates (cadRate, crestRate, etc.), build it then as a cross-cutting concern, not a Bobst-specific bandaid.

**Reject Option D** unless Michael explicitly wants the togglable preference. If the answer is "I want Bobst-first sometimes," Option D is the cleanest way to ship it. If the answer is "I want cost-winner," Option A is simpler.

---

## §5. Implementation Plan (if Option A)

**Files to change:**

| File | Change | Approx LOC |
|---|---|---|
| `spot_r1_5.jsx` | Replace `autoRoute` Bobst-first branch with cost-comparison branch | +12 / -3 |
| `spot_engine.js` | Same replacement, parity | +12 / -3 |
| `spot_runner.js` | No change (calls engine directly) | 0 |
| `spot_server.js` | No change | 0 |
| `build_spot_r1_5.js` | Title bump R1.5.6 → R1.5.7 | 1 |
| `02_RELEASE_HISTORY.md` | New R1.5.7 entry; revise D-121 first-preference language with D-124 supersession note | +50 |
| `01_OPEN_ISSUES.md` | Move D-124 from Currently Open to Recently Closed | +5 / -1 |
| `DEV_D121_Design_Decision.md` | Add D-124 supersession note to "Auto-route preference" section | +10 |
| `DEV_SPOT_R1_5_Control_Tables.md` | Update "Auto-route policy" row | +1 / -1 |
| `EST_SPOT_Quoting_Rules.md` | References block: SHA refresh + R1.5.7 line counts | +5 / -5 |

Total: ~110 LOC of mostly doc updates + 24 LOC of source.

**Test additions:**

- TC-032 (3 sub-cases) — D-124 cost-winner validation:
  - .1 E-flute 8×10 qty 5K → autoRoute returns CAD (matches winner). Confirm route badge says "CAD" not "Bobst."
  - .2 Calibrate Bobst rate to a known-cheaper-than-CAD value (e.g., $50/hr placeholder) → autoRoute returns Bobst, winner returns Bobst, both agree.
  - .3 Switch to Bobst button still works post-D-124 — manual override produces forced-Bobst routing identical to pre-D-124.

**Revert path:** If shop-floor experience after R1.5.7 ship reveals Option A is wrong (e.g., operators want Bobst-first for non-cost reasons), revert via Option D (~20 LOC) preserving Option A as default with togglable opt-in. Cost-winner remains the no-config-needed default.

---

## §6. Bundling with Bobst Rate Calibration

D-124 is most safely shipped **before** Bobst rate calibration, not after. Reasoning:

- **Now (uncalibrated rates):** Option A produces fewer surprises because Bobst is rarely the cost-winner today. Operator learns to expect "auto = CAD or Crest" with manual Bobst override available. When calibration lands, Bobst will start winning on legitimate cases — cheap upgrade.
- **If we wait for calibration first:** D-124 ships into a world where Bobst is sometimes the cost-winner. Operator who learned the D-121 first-preference behavior may be surprised when auto-route flips to CAD on borderline cases. More cognitive churn.

**Recommendation:** Ship D-124 (Option A) as **R1.5.7** ahead of any rate calibration work. Once calibration data lands (90 days post-deploy or ≥30 Bobst jobs), update placeholder rates with no behavior change to autoRoute logic — D-124's cost-winner code handles the new rates naturally.

---

## §7. Resolved Decisions (2026-04-26)

All three open questions answered by Michael:

1. **Option A confirmed** — autoRoute uses cost-winner. Reject Options B (advisory text), C (calibration-confidence gate), D (togglable preference). Single source of truth between autoRoute and `compareRoutes.winner`.
2. **R1.5.7 timing: pair with calibration** — do NOT ship standalone. R1.5.7 held until Bobst rate calibration data lands (DEV_Calibration_Framework_v2.md trigger: 90 days post-R1.5.5 deploy or ≥30 Bobst jobs through SPOT, whichever first). Reasoning: shipping D-124 against placeholder rates today would silently flip every Bobst-eligible auto-route to CAD overnight — a noticeable behavior change for operators just settling into R1.5.6.1. Bundling with calibrated rates means the autoRoute behavior change happens at the same moment the underlying cost math gets real numbers, so any "auto = CAD where it used to say Bobst" cases will be backed by real cost data the operator can defend.
3. **Switch to Bobst button verified live** on R1.5.6.1 (Michael 2026-04-26). Button renders in comparison panel Bobst column with purple `#a855f7` tint. Manual-override path is intact — operators who want Bobst-first behavior for shop-floor scheduling reasons can switch per-estimate without flag-flipping.

## §8. R1.5.7 Ship Plan (when calibration triggers)

When calibration data arrives, R1.5.7 ships in one bundle:

| Item | Source | Notes |
|---|---|---|
| autoRoute cost-winner code change | jsx + engine, ~10 LOC per §5 above | Bumps version R1.5.6.1 → R1.5.7 |
| Bobst rate refresh | DEV_Calibration_Framework_v2.md procedure | Update RATE_DEFAULTS bobstRate / bobstSpeed / bobstSetup / bobstMinChg / bobstDieCost from placeholders to calibrated values |
| D-121 supersession note | DEV_D121_Design_Decision.md | Auto-route preference rule changes Bobst-first → cost-winner |
| TC-032 cost-winner validation | new test cases, 3 sub-cases per §5 above | Replaces D-124 mismatch as the auto-route ground truth |
| Release history R1.5.7 entry | 02_RELEASE_HISTORY.md | Captures both code change and rate refresh in one section |
| Sign-off audit | DEV_R1_5_7_Sign_Off_Audit.md | UI render-gate sweep included this time per D-125 post-mortem |

No further design work needed before R1.5.7 ships — spec is fully resolved.

---

**End of D-124 design decision doc.** Resolved 2026-04-26. Implementation deferred to R1.5.7 ship paired with Bobst rate calibration.
