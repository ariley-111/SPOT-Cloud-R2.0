# SPOT Cloud — Core Functionality Parity Audit (June 2026)

Scope: Board engine, Board substitution, Route logic, Multi-Part (Individual + Matched Set).
Method: Cloud Python engine (`core.py`, `routing.py`, `pricing.py`, `runner.py`,
`engine_routes.py`) cross-checked against **(a)** the legacy `SPOT_Training_Manual.pdf`
and **(b)** the actual legacy source `/app/legacy_spot/spot_r1_5.jsx`.

**Headline:** The cloud engine is a faithful, line-for-line port of legacy
`spot_r1_5.jsx`. All four core areas match legacy math/control-flow. Most
"mismatches" are **manual-vs-reality** (the training manual simplifies or
mis-describes behavior that legacy ALSO does the cloud way) — i.e. not cloud
regressions. Two items are genuine, already-documented **cloud-vs-legacy**
divergences that were intentional. Listed below by category + priority.

---

## A. GENUINE cloud-vs-legacy divergences (intentional — confirm acceptable)

### A1. Multi-Part `dieTreatment` default — DIVERGES
- Legacy `spot_r1_5.jsx` L3782: `dieTreatment: s.dieTreatment || "Separate Line"`.
- Cloud `runner.build_prod_inputs` L99: defaults missing `dieTreatment` to `"None"`.
- Rationale (documented in code): cloud drafts carry stale `cuttingDieCost:"1200"`
  from prior Crest auto-die sessions; defaulting to "None" gives explicit control.
- **Impact:** an MP component whose saved state has a die cost but no explicit
  `dieTreatment` shows $0 line die in cloud vs a charged line die in legacy.
  Auto-apply still fires on Crest/Bobst routes, so most real quotes are unaffected.
- **Priority: P1 — confirm with user.** (Closed-loop with the per-component Die
  chip work already shipped 2026-06-12.)

### A2. Multi-Part non-active component pricing path — DIVERGES (cloud is "more correct")
- Legacy: active BOM tab uses full `calcResults`; the OTHER components use the
  simplified `runItem` (ignores `overrideSheetId`, `routeOverride`, live
  `prepressTreatment`, top-level `quoteFOB`). Legacy Preview total is therefore
  non-deterministic (depends on which tab was active).
- Cloud: runs the FULL engine for EVERY component → deterministic total.
- Already accepted by user 2026-06-12 ("I want the real numbers"). Locked by
  `test_matched_set_parity.py`.
- **Priority: P3 — no action (documented, user-approved).**

---

## B. Manual-vs-implementation gaps (legacy ALSO behaves the cloud way)
These are NOT cloud regressions. They are places where the training manual
describes behavior that neither legacy nor cloud implements. They are candidate
ENHANCEMENTS or DOC corrections.

### B1. Board substitution priority — manual ≠ engine (legacy + cloud)
- Manual §6.5 says: Exact → ECT-upgrade → **Color substitute (Kraft→MW/White,
  yellow advisory)** → Custom.
- Engine (legacy L480-600 == cloud `auto_select_sheet`): Priority 1 custom board
  at CAD max → Priority 2 below-min approved stock → D-059 Mullen grade upgrade
  chain → oversize fallback. Grade fallback is ECT→Mullen (`ECT_GRADE_FALLBACK`),
  plus a medium-fallback chain.
- **There is NO liner-COLOR escalation** (Kraft→MW→White) in legacy or cloud.
  `grep` for colorSubstitute/escalate/MW/advisory in legacy = 0 hits.
- **Priority: P1 decision.** If color substitution + yellow advisory is genuinely
  wanted, it's a NEW FEATURE (build for cloud; legacy never had it).

### B2. Matched-Set margin — manual describes the OVERRIDE, not the DEFAULT
- Manual §5.2.7 / §5.5.3: "ONE margin on the rolled-up cost; MSF tier from total
  sqft × kit count."
- Reality — DEFAULT path (both legacy L3849-3854 & cloud `engine_routes` L646-648):
  **aggregate individual item sells** — each component keeps its OWN MSF-tier
  margin, then summed. The "one uniform margin on rolled-up cost" only happens
  when the optional **Set Margin Override** checkbox is ON (legacy L3840-3848 ==
  cloud `set_margin_ovride` branch L642-645).
- Cloud == legacy exactly. **Manual is incomplete.**
- **Priority: P2 — doc/UX clarity** (label the toggle clearly; no code bug).

### B3. CAD complexity LABELS — three different naming schemes
- Manual §7.2: Basic / Standard / Complex / Advanced  (setups 8/20/25/22).
- Engine (legacy L179 == cloud `CAD_SETUP`): Simple / Straight / Standard / Complex
  (setups 8/20/25/22).
- **Setup VALUES are identical; only the labels differ.** Math parity intact.
- **Priority: P2 — UI label alignment** so estimators match the manual's vocabulary.

### B4. Board cost formula wording — manual §6.6 simplifies
- Manual: `board = footprint_sqft × qty/1000 × $/MSF × 1.05 waste`.
- Engine: costs by **sheets required × sheet area** (`calc_board`), with waste
  captured via imposition (`compute_layout`) + makeready/spoilage sheets in
  `calc_wf` (not a flat ×1.05). Cloud == legacy.
- **Priority: P3 — doc only.**

### B5. Ink — manual §8.1 "coverage × footprint × $0.05"
- Engine (legacy L941 == cloud): `inkCost = grossSqFt × 0.05`. **No coverage
  factor.** Cloud == legacy.
- **Priority: P3 — doc only.**

### B6. F-flute — heavily documented (§6.2) but not stocked/priced
- Legacy `flute_rules` (L90-93) & `FLUTE_CALIPERS` (L172): only B, C, E, B/C.
  No F. Same in cloud. F appears only in `BOBST_FLUTES=["E","F"]` (eligibility list).
- **Priority: P2 decision** — if F-flute quoting is needed it's a NEW grade/sheet
  data + caliper addition (legacy never supported it either).

### B7. Inca "30-min setup" §7.1
- Engine models Inca press time via makeready sheets (5 regular / 15 white) +
  spoilage, not a flat 30-min setup. Cloud == legacy.
- **Priority: P3 — doc only.**

---

## C. Verified IDENTICAL (cloud == legacy == manual intent) — no action
- Imposition: `numUp=floor((W-2)/uw)`, `numOut=floor((L-2)/uw)` (1" trim/side). ✓
- Mill minimums: 15,000 sqft kraft / 25,000 sqft else; Buy-Min mill-min-buy scale. ✓
- Route rates: Inca $485/75sh·hr; CAD $138/650in·min; Crest $45/150sh·hr (45/90
  setup); Bobst $350/3000sh·hr, $250 min, $1,800 die. ✓
- Crest envelope 60×120; Bobst E/F only; cheapest-viable wins; CAD ≤8h gate. ✓
- Margin curve: 50/37/32/27/25%… (manual 5-tier == cloud's 9-tier where overlap). ✓
- Default Crest die $1,200 / Bobst die $1,800 (manual §7.6.2). ✓
- MP Individual: each part priced independently then summed; qty × pcsPerSet. ✓
- Freight/skid/weight (`calc_shipment`) ported verbatim. ✓
