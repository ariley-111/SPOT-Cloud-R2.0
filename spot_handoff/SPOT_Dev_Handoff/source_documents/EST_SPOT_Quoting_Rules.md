# SPOT Quoting Rules — R1.5.3

> Engine: `spot_engine.js` / `spot_runner.js` (Node.js)
> App: `spot_r1_5.jsx` → `SPOT_R1.5.html`
> Updated: 2026-04-25 (D-110 FINAL + D-111 reporting fix + D-112 estNum fallback). Calibration locked 2026-04-24 (D-110 FINAL). Validated against 773-job iQuote fleet: segment Cost R² 0.9690, segment Sell R² 0.9496, fleet cost Δ +6.55%, fleet sell Δ +8.30%. See `DEV_D110_Design_Decision.md`.

---

## Session-Start Discipline (read first, every session)

Before any quote work, every session:

1. **Load `EST_SPOT_Canonical_Terms.md`** — fresh read. Do not rely on recalled content from earlier in the conversation. SPC domain tokens (CKB, ECT 44, Kemi-Lite, Crest, CAD, Gloss, Satin, FSC/SFI, Buy Min, paper uplift, etc.) diverge from industry-standard meaning. Training-data priors are UNSAFE at SPC.
2. **Reading-protocol check** — confirm the five rules in `Reading_Discipline_Protocol.md` are in force: registry loaded, last user message re-read, no training-data inference, short-answer discipline, no re-asking answered questions.
3. **Version check** — compare live SPOT `window.__SPOT_UI_VERSION` to `MAP_VERSION` in `EST_SPOT_UI_Map.md`. If the version has changed since the last map, request a remap before quoting.
4. Only after 1–3 above: proceed to Phase 1 (read the RFQ).

Enforcement: `EST_SPOT_Intake_Harness.md` v2.1 SESSION-START block and `EST_SPOT_Batch_Kickoff.md` audit header both carry a REGISTRY line and a LAST MESSAGE RE-READ line.

---

## Remap Protocol

Before starting any quote session, check the current SPOT version string in the app against `MAP_VERSION` in `EST_SPOT_UI_Map.md`. If the version has changed since the last map:

1. Do not begin data entry.
2. Say to the estimator: "SPOT has been updated to [version]. I need a remap session before I can continue quoting. The old UI map may no longer match."
3. Wait for a remap session before quoting.

---

## Calibration (locked, R1.5.3 — D-110 FINAL applied 2026-04-24)

- Inca press rate: $485/hr (D-110 FINAL — was $460)
- CAD cutting rate: $138/hr (D-110 FINAL — was $160)
- under5MsfFee: $0 (corrugator charge, does not apply to WF)
- FSC/SFI fee: $25 (amortized into board; $15→$25 migration fires on load of older estimates)
- **Paper uplift: +10% baked into `ENGINE.base_matrix` at the 2026-04-14 calibration pass.** Not exposed as a user field. Part of the locked R1.5.3 baseline (D-110 FINAL). D-102 closed — uplift data in engine source.
- Ink: $0.05/sqft (business decision, not a calibration target)
- Fleet segment Cost R² vs iQuote: 0.9690 on 773 scored jobs (D-110 FINAL, 2026-04-24)
- Fleet segment Sell R² vs iQuote: 0.9496
- Fleet total cost delta: +6.55% (within 0% to +20% tolerance)
- Fleet sell premium: +8.30% (target +8.2%, within ±2pt tolerance — P1 planned deviation)
- GM curve: 50% → 37% → 32% → 27% → 25% across MSF tiers 0-1 / 1-3 / 3-5 / 5-9 / 10+ (D-110 FINAL, 2026-04-24). P5 planned deviation — GM floors at 5+ MSF prevent iQuote-style volume giveaways. See `DEV_D110_Design_Decision.md`.
- SPOT pricing above iQuote: +8.30% fleet sell premium is intentional (P1) — see `DEV_D110_Design_Decision.md` for the full planned-changes framework.

---

## Hard rules (every quote, every mode)

1. **Never set `routeOverride` in JSON files.** Let SPOT auto-route based on CAD hours and sheet imposition. Forced routes are an estimator tool in the UI only.
2. **Initials are always "SPC"** for AI-generated estimates. The field is blocked from manual entry.
3. **Always set `under5MsfFee: "0"`** — corrugator charge doesn't apply to WF.
4. **ECT grades run on Mullen sheets** (grade fallback). Never show substitution on customer-facing quotes. **ECT 44 specifically**: uncommon at SPC, substitutes DOWN to Mullen 200# stock; mill-substitute check is manual (the D-098 popup guardrail was scoped but never coded — tracked as DEV-011, target R1.6). See `EST_SPOT_Canonical_Terms.md`.
5. **Stock sheets bypass Buy Min (D-067).** Only custom/forced boards trigger mill minimums.
6. **Rate migration fires on load** — old estimates auto-update to current `RATE_DEFAULTS`. Sell prices are NOT changed. FSC $15→$25 migration also fires.
7. **`applyState` and `applyItemState` are reset-first** (D-080/D-087/D-098) — full state replace, not merge.
8. **Default print finish is Satin.** Never default to Gloss.
9. **FOB: Origin (ZIP 44704)** unless customer explicitly requests Destination.
10. **PDF quotes come from SPOT Preview Quote ONLY.** No reportlab, fpdf, or any external PDF generator. If Preview Quote is inaccessible: STOP, tell the estimator, do not substitute.

---

## EST-Mode Workflow — End to End

Target: under 5 minutes from RFQ drop to "SPOT is loaded."

### Phase 0 — Session start
Registry load + reading-protocol check (see Session-Start Discipline above). Not optional.

### Phase 1 — Read
Signal: "Reading the RFQ and files now..."
Extract: customer, contact, part#, dims, board, qty, print, ops, ship-to, die.

### Phase 2 — Intake grid
Use `EST_SPOT_Intake_Harness.md`. Fill every field. Tag RFQ / DEFAULT / ASK. If any field = ASK: ask it before Chrome. One question at a time.

### Phase 3 — Approval
Post the grid. Estimator approves or corrects.

### Phase 4 — Execute harness
Signal: "Got it. Entering into SPOT now — back in a moment."
Execute `EST_SPOT_UI_Map.md` harness. If an alert fires: surface it, ask, wait, continue.

### Phase 5 — Handoff
Deliver review prompt with: customer / part# / est# / board / blank / route / sheet / N-out / qty pricing / GM / freight / FOB. Stop. Estimator owns it.

---

## JSON load — what SPOT will and will not accept

### Required top-level fields
- `customer` — string
- `contact` — string (can be empty)
- `partNumber` — string
- `bomItems[]` — array of items (single-part estimates still use a 1-item array)

### Per-item required fields
- `itemType` — "Manufactured" | "Purchased" | "Fulfillment"
- `dims` — `{ l, w, d }` for Manufactured
- `board` — `{ flute, ect, mill, caliper, fscFee }`
- `qty[]` — array of 1–10 quantity slots

### Fields SPOT will auto-fill if omitted
- `initials` → always "SPC" (blocked from override)
- `fscFee` → "25" (migrated from "15" if older)
- `under5MsfFee` → "0"
- `printFinish` → "Satin"
- `fob` → "Origin"

### Fields that MUST be omitted (SPOT will reject or mis-route if set)
- `routeOverride` — never. Auto-route only.
- Any rate override that duplicates `RATE_DEFAULTS` — rate migration will snap it back on load.

---

## Price change policy

When rates change (e.g., D-089 Inca 470 → 460):

- SPOT's rate migration block in `applyState()` snaps Advanced Controls and Board Engine rates to current `RATE_DEFAULTS` on load.
- **Sell prices on the loaded estimate are NOT changed.** Historical quotes preserve their sell price.
- The amber toast fires to notify the estimator that underlying rates migrated.

The estimator is responsible for deciding whether to re-quote at the new rates. The AI does not silently reprice.

---

## Communication style during a quote session

- Terse. No preamble. No "great question."
- Lead with the answer, then show the work.
- One question per turn during Phase 2 if fields are missing.
- During Phase 4 (Chrome execution), do not ask questions unless an alert forces a branch. If an alert fires: surface the exact text, ask, wait.
- Deliverables: text-based quote block (chat) + Preview Quote PDF (SPOT) + saved JSON. Nothing else.

---

## Blocked patterns (from session lessons)

See `EST_SPOT_Session_Lessons.md` for the full log. Summary of permanent rules:

- **PDF = SPOT Preview Quote ONLY.** No external generators, ever.
- **Do not skip Phase 2 intake grid** even when the RFQ looks complete. Default tags catch silent assumptions.
- **Do not assume flute, pcs/set, or glue** from part-number conventions. If the RFQ doesn't state it, ASK.
- **Do not invoke `routeOverride` from a JSON**, even for testing. If a forced route is needed for comparison, the estimator clicks Switch in the UI.
- **Do not expand SPC domain tokens from training-data priors** (added 2026-04-21). CKB at SPC means Corrugated Kraft Board = Kemi-Lite, NOT industry's Clay-Coated Bleached Kraft. Always load `EST_SPOT_Canonical_Terms.md` first; if a term is not in it and could be SPC-specific, ASK.
- **Short-answer discipline** (added 2026-04-21). Match the question's scope. One-word questions get one-word answers. Do not tack on unasked context or caveats — that is a failure mode, not helpfulness.
- **Never re-ask a question the estimator has already answered** (added 2026-04-21). Scan the full conversation before asking. Re-asking wastes the estimator's time.

---

## References

- Live app: `http://localhost:3100` → `SPOT_R1.5.html`
- Current JSX: 7,887 lines, SHA `33aae04603bf` (R1.5.6.1 — D-125 die-row UI gate hotfix on R1.5.6 base: D-122 + D-123)
- Current server: 550 lines, SHA `1cb6426bbd22` (R1.5.6 — D-118 late additions reapply: multi-path CSV / listen-first / term normalization)
- Current engine: 1,131 lines, SHA `5ff7594d031a` (R1.5.6 — D-121 parity restored on autoRoute/compareRoutes + D-123 selectBobstSheet + Gloss leftover flipped to Satin)
- Current runner: 358 lines, SHA `8001c3a2d87d` (R1.5.6 — D-123 ASMP_DEFAULTS bobstFirstSizing)
- Current build: 57 lines, SHA `6f3fa92414a4` (R1.5.6.1 HTML title)
- Current fleet_compare: 366 lines, SHA `db6b89e4e55c81bd` (D-110 FINAL + D-111 patched — unchanged in R1.5.6)
- **Reading Discipline Protocol**: `Reading_Discipline_Protocol.md`
- **SPC Canonical Terms registry**: `EST_SPOT_Canonical_Terms.md`
- **Paper uplift (D-102)**: closed — uplift data in `spot_engine.js` base_matrix
- **Runner vs JSX parity (D-104)**: closed — runner confirmed safe for fleet regression
- Control tables: `DEV_SPOT_R1_5_Control_Tables.md`
- UI map: `EST_SPOT_UI_Map.md` (MAP_VERSION 3.1)
- Intake harness: `EST_SPOT_Intake_Harness.md` (v2.1)
- Intake template: `EST_SPOT_Intake_Template.md`
- Batch kickoff: `EST_SPOT_Batch_Kickoff.md`
- Channel reference (engine+runner outside the app): `EST_SPOT_Channel_Reference.md`
- Session lessons (append-only): `EST_SPOT_Session_Lessons.md`
- Open items: `01_OPEN_ISSUES.md`
- Release history: `02_RELEASE_HISTORY.md`
```


