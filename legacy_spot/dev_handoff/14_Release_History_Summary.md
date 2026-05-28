# 14 — Release History Summary

A curated tour of how SPOT got to where it is. The full unabridged history lives in `02_RELEASE_HISTORY.md`. This file picks out the milestone ships and explains what changed and why.

The numbering reflects the chronological order of D-### closures, not strictly the ship sequence. Some releases bundled multiple D-###'s; some single D-###'s rippled across multiple ships.

---

## R1.5.0 — The first calibrated baseline

The initial production release. Engine math was hand-tuned. R² against the iQuote fleet was ~0.92. Estimators began using it for daily quotes, surfacing the long tail of UI and pricing issues that defined the next 50 D-###s.

Key decisions baked in here:
- One JSX file (no module split)
- Localhost-only architecture
- Reset-first state pattern (D-080 codified the discipline later)
- 5-quantity-slot UI (later expanded to 10, then back to 5)

---

## R1.5.1 — UI Tab Persistence (D-080, D-081, D-087)

The first major batch of state-management cleanup.

- **D-080:** First codification of the reset-first pattern in `applyState`
- **D-081:** Multi-Part scoping bug — top-level `custIdent` was clobbering `bomItems[0].custIdent`. Fix mirrored them explicitly.
- **D-087:** Same reset-first pattern in `applyItemState` (single BOM item load)

These three together are why state loading in SPOT is rock-solid today. The patterns established here are still in force.

---

## R1.5.2 — Stock Sheet Bypass (D-067)

Stock sheets stopped triggering Buy Min. Before this, small quote sizes on stock sheets fired phantom mill-minimum inflation. Customer complained, the bug was found, the rule (Rule 5) was added.

D-067's lesson: business rules that work for one path (custom boards) don't necessarily work for another (stock sheets). Always trace the rule's application.

---

## R1.5.3 — D-085, D-086, D-090, D-097 ship bundle

Three medium UX wins shipped together.

- **D-085:** First Crest routing triggers auto-default of Separate Line die at $0
- **D-086:** FSC $15 → $25 migration fires on load of older estimates
- **D-090:** Route Comparison panel visible only when both routes viable
- **D-097:** Forced-route panel stays mounted after Switch; Reset to Auto available

The D-090/D-097 pair codifies the route-comparison UX. Before D-090, the panel was always visible, even when only CAD was viable (Crest-eligible flute but oversized sheet); estimators were confused. After D-090, the panel hides unless there's a real comparison to make.

---

## R1.5.4 — D-098 Multi-Part fallthrough (and the ECT 44 leftover)

D-098 closed half a feature. The Multi-Part fallthrough (estimate-level reset when switching from Multi-Part to Simple) shipped correctly. The ECT 44 popup guardrail (also scoped under D-098) was claimed in release notes but **never actually coded**.

This is the origin of DEV-011 — the ECT 44 popup is still open work as of R1.6.5.1. The lesson: "shipped in release notes" is not the same as "verified in source." The session SHA audit ritual was tightened after this.

---

## R1.5.5 — D-110 FINAL: The Big Calibration

The defining event of the SPOT calibration story.

Pre-D-110 baseline was R² 0.974 on 785 jobs, fleet cost delta +2.8%. The team set out to:
1. Implement P1: deliberate +8% fleet sell premium
2. Implement P5: GM floor at 25% for 10+ MSF
3. Recalibrate every rate against fleet data
4. Equalize Gloss/Satin press speeds (resolving a long-standing concern)

After multiple rate sweeps:
- Inca: $460 → $485
- CAD: $160 → $138
- CAD setup: 10/15/25/25 → 8/20/25/22
- CAD fallback: 2/3/4/5 → 2/6/2/4
- GM curve: 52/46/42/32/28 → 50/37/32/27/25
- PRINT_SPEEDS Gloss: 70 → 75; Satin: 100 → 75 (equalized)

Final metrics (D-110 FINAL, 2026-04-24):
- Segment Cost R²: 0.9690
- Segment Sell R²: 0.9496
- Fleet cost delta: +6.55%
- Fleet sell premium: +8.30% (target +8.2%)
- Margin lift: +$76,488 on 773 scored jobs

The calibration framework (`06_Calibration_Methodology.md`) was authored during this work and is now the standard playbook.

Three B Kemi MSF tiers landed out-of-tolerance on sell. Accepted for deployment with monitoring (volume-job cost overshoot amplified by fixed GM). This is the only outstanding OOT item.

---

## R1.5.6 — D-122 + D-123 Bobst route ship

The Bobst flat-bed die-cutter joined as a third route option.

- **D-121:** Bobst route added with UNCALIBRATED placeholders (90-day or 30-job calibration trigger)
- **D-122:** Advanced Rates UI inputs for all Bobst parameters
- **D-123:** Bobst-first sheet sizing — per-route sheet selection for E/F flute

Eligibility constraints:
- E or F flute only (caliper limit)
- Sheet within 13.78×15.75 to 41.75×29.125 envelope
- Force-route hard-blocks B/C flute (physical constraint)

Auto-route preference: **Bobst → Crest → CAD** when all viable.

The fleet has zero Bobst-eligible E-flute pieces in the 785-job iQuote dataset, so D-123 calibration impact was N/A. Recalibrate after 90 days of shop floor data.

---

## R1.6.0 — D-120 Phase 1 Archive Scaffolding

The quote archive system shipped. RFQ drop zone, file upload endpoint, `meta.json` per folder, file class system (rfq vs asset).

Phase 1 = drop UI + archive write + manifest + Tier 1 previews.
Phase 1B (deferred) = Anthropic API parser, awaiting key + $500/mo cap.
Phase 2 (R1.7+) = SharePoint sync `/SPOT_QUOTES/` → SharePoint URL + retrieval/browse UI.

This was the largest infrastructure ship since R1.5.0. New server endpoints, new client UI, new file system layout.

---

## R1.6.1 — D-129 RFQ Parser

Phase 1B closed: Anthropic API integration for the RFQ parser. Estimator drags a PDF, server sends to Claude, structured estimate fields come back. The 5-minute target became realistic.

Key technical details:
- Model: `claude-opus`
- Prompt: ~50KB of system instructions covering SPC vocabulary, board specs, multi-part schema, ECT fallbacks
- Token budget: soft cap exposed at `/est/parser-budget`
- Preflight check: byte:token heuristic rejects oversized RFQs before billing

The parser handles all RFQ formats: PDF, image, email (.eml), Word, Excel. About 80% field-fill rate on first parse; the other 20% surface as Phase 2 ASKs.

---

## R1.6.2 — D-131, D-132, D-134 Multi-Part Parser

Multi-Part support extended end-to-end:
- **D-131:** Multi-Part schema in parser response
- **D-132:** Multi-Part editor refresh in UI
- **D-134:** TBD-folder rename when parser resolves customer

D-134 is a subtle bit of plumbing. When a PDF is dropped before the customer is known, files go to `TBD_SPC-260522-001/`. When the parser identifies the customer (e.g., "Skybox Packaging"), the folder migrates to `Skybox Packaging_SPC-260522-001/`. The `/archive/rename` endpoint handles this server-side, atomic.

---

## R1.6.3 — D-138 (deferred), D-141, D-144 Parser Calibration

Parser accuracy work and token preflight calibration.

- **D-138:** Inline asks[] resolution UI in the diff modal — **deferred to R1.7**
- **D-141:** Bytes:tokens preflight ratio audit
- **D-144:** Preflight calibration to 1:250 byte:token midpoint

The byte:token preflight prevents oversized RFQs from running up the meter. Calibration was tuned against ~40 real-world parses.

---

## R1.6.4 — D-142 Spin Off (deferred), D-117 ship

- **D-117:** R1.5.4 point fixes (printMode default Satin, GM localStorage migration, noSheet crash guard)
- **D-142:** Spin Off feature — data not carrying into spun-off tabs, origin badge not clickable — **deferred to R1.6.x or R1.7**

D-142 is open. Spin Off is the UI flow where an estimator duplicates a current quote into a new tab. The duplication is buggy — some fields don't carry over, the origin reference (clickable badge linking back to source) isn't wired.

---

## R1.6.5 — D-146, D-147 ship

The most recent functional release.

- **D-146:** Kraft → None canonical engine value mapping — ship-blocking parser bug, fixed
- **D-147:** Parse-review modal layout — action buttons reachable on large Multi-Part responses
- **D-143:** PK source-of-truth catch-up (the silent-drift reconciliation)

D-146 was a particularly painful one. The engine treats `"None"` as default kraft, but the parser was sometimes emitting `"Kraft"` for the same thing. The mismatch caused incorrect over-quoting on default-kraft jobs (because `"Kraft"` looked like a custom-board liner, triggering Buy Min in some paths). The fix is a canonical mapping at the parser-output layer.

---

## R1.6.5.1 — D-149 (cosmetic hotfix)

Latest. JSX-only cosmetic hotfix:
- **D-149:** Developer-mode badge emitted stale R1.6.5 string (a ternary-fallback miss in the version-bump sweep)

No server changes. No engine changes. Pure version bump on one line plus the badge ternary plus the HTML title plus install scripts.

---

## What's been deferred

These shipped in earlier releases as scope items that didn't land:

| D-### | Description | Status |
|---|---|---|
| D-138 | Inline asks[] resolution UI in RFQ parser diff modal | Deferred to R1.7 |
| D-142 | Spin Off feature (data carry-over, origin badge) | Deferred to R1.6.x or R1.7 |
| DEV-011 | ECT 44 popup guardrail (the D-098 leftover) | Target R1.6 (currently DEV) |
| DEV-012 | Visual layout/imposition viewer | R1.7+ DESIGN |
| EST-GRPHCWHT | Graphic White liner mapping | Pending estimator decision |
| D-150 | Folder-binding fragility on test renames | Design pending |

These are tracked in `01_OPEN_ISSUES.md` and covered in `15_Open_Work_Roadmap.md`.

---

## The arc

In one paragraph: SPOT started as a single-file React app in 2024, built to one estimator's daily workflow at one shop. Over ~150 D-###s and 18 months, it evolved into a calibrated production system covering board, print, three routes, multi-part BOMs, RFQ parsing, freight, archive, all on a localhost-only architecture with R² 0.97 against the legacy iQuote fleet. The pace has slowed as the system has matured — early releases bundled 8–10 issues; recent releases are 1–3. Most current work is parser refinement, calibration drift detection, and the long tail of estimator-feedback items.

The system is mature enough that breaking changes are rare and routine ships take half a day end-to-end. The infrastructure for catching regressions (SHA audit, fleet_compare, ledger discipline) was built during the harder middle years and is paying back now.
