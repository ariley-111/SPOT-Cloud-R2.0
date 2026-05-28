# D-110 — Fleet Calibration Design Decision

**Status:** FINAL — supersedes the initial D-110 spec dated 2026-04-23
**Date:** 2026-04-24
**Affects:** `spot_engine.js`, `spot_r1_5.jsx`, `DEV_fleet_compare.js`, `DEV_SPOT_R1_5_Control_Tables.md`, `EST_SPOT_Quoting_Rules.md`, `TEST_SPOT_R1_5_Testing_Guide.md`, `01_OPEN_ISSUES.md`, `02_RELEASE_HISTORY.md`

> This document is the **authoritative record** of the D-110 calibration philosophy, planned-changes framework, tolerance bands, and final parameter values. Changes to pricing should reference this document for the design rationale. Future recalibrations should follow the methodology defined in `DEV_Calibration_Framework_v2.md`.

---

## 1. Philosophy: Planned vs Unplanned Deviations

Every deviation between SPOT and the iQuote production baseline is classified as one of two types:

- **PLANNED** — an intentional design choice made with explicit business rationale. Planned deviations are acceptable and expected.
- **UNPLANNED** — residual variance after backing out planned deviations. Unplanned deviations must land within an explicit tolerance band or be flagged for action.

**A calibration is valid when:** (a) all planned changes hit their targets, AND (b) all unplanned deviations land within tolerance.

Statistical correlation (R²) is a **side effect**, not the goal. A perfectly correlated system would mirror iQuote's flaws; a calibration's job is to match iQuote where iQuote is correct and deviate where iQuote is wrong.

---

## 2. Planned Changes (P1 – P5)

### P1 — Fleet sell premium +8.2%

**Target:** Fleet sell Δ = +8.2% above iQuote invoice total.
**Achieved:** +8.30% (within 0.10pt of target).
**Rationale:** Original R1.5 baseline target. Represents intentional margin capture against iQuote's historical pricing.
**Dollar impact:** +$168,136 on 773-job fleet vs iQuote.

### P2 — E flute sheet-efficiency pass-through

**Target:** Customer captures the cost savings from SPOT's tighter E flute sheet optimization.
**Achieved:** 104 jobs (E Kemi 1-3 and 3-5 MSF) show SPOT cost below iQuote by ~$17K and SPOT sell below iQuote by ~$32K — flowed through to customers as pricing advantage.
**Rationale:** SPOT's optimizer finds tighter layouts on the 48×96 E flute sheet size than iQuote recognized. Rather than absorbing the savings as margin, we pass them to customers as a real competitive advantage on mid-MSF E flute work.
**Implementation:** `flute_upcharge_per_msf` for E flute set to $0 (was $3).

### P3 — Material corrugated hike pass-through

**Target:** +10.0% material uplift to reflect 2025 corrugated price increase.
**Achieved:** +11.4% (1.4pt over target, within ±2pt tolerance).
**Rationale:** The iQuote xlsx export predates the 2025 corrugated price increase in much of the dataset. SPOT reflects current (post-increase) board base rates.
**Implementation:** `ENGINE.base_matrix` rates (baked in at D-102 on 2026-04-14).

### P4 — Ink area-basis correction

**Target:** Ink costed on physical sheet area (what passes through the press) rather than finished-piece area.
**Achieved:** +54.8% ink cost vs iQuote. This is **iQuote's historical undercount**, not SPOT over-pricing.
**Rationale:** Per-square-foot ink rates are identical ($0.0507 SPOT vs $0.0500 iQuote). The ~1.54× area ratio between sheet area and piece area produces the +54.8% difference. SPOT is physically correct; iQuote was understating ink cost.
**Implementation:** `regInkRate: 0.05` × sheet area (unchanged — this is the original design).

### P5 — GM floors at volume tiers (prevents giveaways)

**Target:** Enforce GM floor of 27% at 5-9 MSF and 25% at 10+ MSF.
**Achieved:** 83 iQuote jobs were historically priced below 20% GM across 5+ MSF tiers (44% of the 185 volume jobs). SPOT's GM floor rejects this pattern.
**Rationale:** iQuote showed a clear pattern of margin erosion at volume tiers — average GM of 24.6% at 5-9 MSF, 20.1% at 10-24 MSF, 12.7% at 25+ MSF. Many of these were below-cost-plus-5% pricing (loss-leader or rushed deals). SPOT's floor prevents future margin leakage while maintaining competitiveness.
**Implementation:** `GM_DEFAULTS` curve 50/37/32/27/25 across MSF tiers.

---

## 3. Tolerance Framework

Every deviation outside the five planned changes is evaluated against an explicit tolerance band:

| Metric | Target Center | Tolerance Band | Width |
|---|---|---|---|
| Material lift | +10% | +8% to +12% | ±2pt |
| Press cost | 0% | −5% to +5% | ±5% |
| Cutting cost | 0% | −5% to +5% | ±5% |
| Glue cost | 0% | −10% to +10% | ±10% |
| Total fleet cost | +10% | 0% to +20% | ±10% |
| Fleet sell premium | +8% | +6% to +10% | ±2pt |
| Per-tier sell (B flute) | +8% | +5% to +11% | ±3pt |

**Rationale:**
- Tighter bands would force over-fitting to iQuote's historical pricing (defeating the purpose of the calibration).
- Looser bands would let real miscalibrations hide.
- Per-tier B flute sell gets a wider ±3pt band because small-sample tiers (5-9 MSF with 37 jobs, 10-24 MSF with 13 jobs) have higher natural variance from individual job characteristics.
- E flute is excluded from per-tier sell tolerance because of planned deviation P2.

---

## 4. Final Parameter Values

### Engine constants (spot_engine.js, mirrored in spot_r1_5.jsx)

| Parameter | Value | Location |
|---|---|---|
| `incaRate` | $485/hr | `RATE_DEFAULTS` |
| `cadRate` | $138/hr | `RATE_DEFAULTS` |
| `GM_DEFAULTS` | `{"0-1":0.50, "1-3":0.37, "3-5":0.32, "5-9":0.27, "10-24":0.25, "25-49":0.25, "50-74":0.25, "75-99":0.25, "100+":0.25}` | Engine top section |
| `PRINT_SPEEDS` | `{Gloss:75, Satin:75, OnQ Styrene:50, OnQ Lightbox:40}` | Engine |
| `CAD_SETUP` | `{Simple:8, Straight:20, Standard:25, Complex:22}` | Engine |
| `CAD_FALLBACK` | `{Simple:2, Straight:6, Standard:2, Complex:4}` | Engine |
| `flute_rules.E.flute_upcharge_per_msf` | $0 (was $3) | Engine `ENGINE.flute_rules` |

### Comparison script (fleet_compare.js — not deployed to SPOT)

| Parameter | Value |
|---|---|
| `CREST_DIE_ADJUSTMENT` | $1,200/job |
| Hand glue comparison | Enabled when iQuote `ActualHandglueCost > 0` |

---

## 5. Validation Results

### Fleet statistics (773 of 785 jobs scored)

| Metric | Value |
|---|---|
| Fleet cost | iQuote $1,399,878 vs SPOT $1,491,526 (+6.55%) |
| Fleet sell | iQuote $2,025,727 vs SPOT $2,193,863 (+8.30%) |
| Fleet GM | iQuote 30.9% vs SPOT 32.0% |
| Margin lift | +$76,488 |
| Cost R² (per-job) | 0.8550 |
| Sell R² (per-job) | 0.8360 |
| **Cost R² (segment)** | **0.9690** |
| **Sell R² (segment)** | **0.9496** |
| Cost R² (grade × flute × MSF, 31 segments) | 0.9740 |
| Sell R² (grade × flute × MSF, 31 segments) | 0.9653 |

**Per-job R² includes within-segment production noise** (per-job setup time, sheet count variance, makeready, complexity). Segment-level R² is the correct calibration metric.

### Component tolerance checks

| Component | Deviation | Tolerance | Status |
|---|---|---|---|
| Material | +11.44% | +8% to +12% | ✓ IN |
| Press | −0.48% | −5% to +5% | ✓ IN |
| Cutting | −2.75% | −5% to +5% | ✓ IN |
| Glue | +7.02% | −10% to +10% | ✓ IN |
| Total fleet cost | +6.55% | 0% to +20% | ✓ IN |
| Fleet sell | +8.30% | +6% to +10% | ✓ IN |

### Per-tier B Kemi sell checks

| Tier | Jobs | Sell Δ | Tolerance | Status |
|---|---|---|---|---|
| B 0-1 MSF | 82 | +8.7% | +5% to +11% | ✓ IN |
| B 1-3 MSF | 69 | +11.6% | +5% to +11% | ✗ OUT by 0.6pt |
| B 3-5 MSF | 37 | +9.2% | +5% to +11% | ✓ IN |
| B 5-9 MSF | 37 | +14.5% | +5% to +11% | ✗ OUT by 3.5pt |
| B 10-24 MSF | 13 | +18.2% | +5% to +11% | ✗ OUT by 7.2pt |

**Three out-of-tolerance B Kemi tiers** on sell side — root-caused to volume-job cost overshoot (corrugated hike lands hardest on volume jobs) amplified by fixed-tier GM. Sample sizes are thin on 5-9 and 10-24 tiers. Acceptable for deployment with monitoring per the Board Report recommendation.

---

## 6. Supersession Notes

This document supersedes:
- Initial D-110 design (2026-04-23: PRINT_SPEEDS, CAD_SETUP, CAD_FALLBACK, GM curve 52/46/42/32/28 — the earlier GM curve was too hot). Initial design doc was deleted post-supersession; details captured in this document and in the 2026-04-23 entry of `02_RELEASE_HISTORY.md`.
- The D-110 entry in `02_RELEASE_HISTORY.md` dated 2026-04-23 — that entry is preserved verbatim as historical record; this document is the final-state reference.

**Changes from initial D-110:**
- GM curve: 52/46/42/32/28 → **50/37/32/27/25** (recalibrated for +8% fleet sell target)
- incaRate: $460 → **$485** (press gap closure)
- cadRate: $160 → **$138** (CAD overshoot correction)
- E flute upcharge: $3/MSF → **$0/MSF** (sheet-efficiency pass-through)
- Crest die adjustment: $1,000 → **$1,200** (iQuote die bundling)
- Hand glue: enabled per-job in comparison script (was disabled uniformly)

---

## 7. Related Documents

- `DEV_Calibration_Framework_v2.md` — how to calibrate SPOT against fleet data going forward
- `DEV_Session_Learnings_2026-04-24.md` — audit of the D-110 calibration session
- `DEV_SPOT_R1_5_Control_Tables.md` — current rates (reflects D-110 final values)
- `TEST_SPOT_R1_5_Testing_Guide.md` — regression tests including D-110 expectations
- `02_RELEASE_HISTORY.md` — append-only ship log
- `01_OPEN_ISSUES.md` — open status (D-110 moves to RELEASE_HISTORY when applied)
