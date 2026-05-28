# SPOT Session Lessons — Append-Only Log

> Captured from live quoting sessions. Each section is dated. Rules in this file are permanent unless explicitly superseded by a later entry. Do not delete past sessions — they are the receipts for why the rules exist.

---

## 2026-04-22 — Skybox PO 47309 / MRO15486 (Speed Failures)

### Sources
- First EST turn of EST-BATCH-01 against R1.5.2 (post-D-108 close).
- RFQ: Skybox PO 47309 for MTD 645-90620 DIGITAL, 400 qty, re-quote vs. prior SPC Quote 221973.
- Delivered JSON cleanly but took ~6 turns where 3 was the ceiling.

---

### Failure 1 — Introspected the live app to learn the JSON schema

**What happened:** To build the payload I called `tool_search` twice to load Chrome MCP, then `tabs_context_mcp`, then `javascript_tool` to read `window.__SPOT_UI_VERSION`, then another `javascript_tool` to enumerate localStorage `wftab` keys and inspect top-level fields. The second call timed out at 4 minutes. Only after the rebuke did I go to `DEV_spot_runner.js` / `EST_SPOT_Channel_Reference.md`, which document every field name I needed.

**Why it's wrong:** The runner IS the schema. Channel Reference (EST_-prefixed, small, in project knowledge from session start) points straight at it. Chrome introspection to learn field names the project already documents is pure waste.

**Rule (permanent):** The JSON schema for SPOT payloads lives in `DEV_spot_runner.js` (field-by-field defaults in `buildBoardSpec` + `buildProdInputs`) and is summarized in `EST_SPOT_Channel_Reference.md`. Never call Chrome to learn schema. Never grep the JSX `applyState` to learn schema. Read the runner.

---

### Failure 2 — Opened Chrome when the delivery channel was JSON-to-upload

**What happened:** Phase 4 of the Quoting Rules reads "Execute `EST_SPOT_UI_Map.md` harness." I interpreted that as "drive the live UI," loaded Chrome tools, tried to run the harness. Michael's rebuke ("jut upload the json!") made explicit what the channel pattern actually is: JSON is the deliverable, Michael uploads it himself, Chrome is a fallback or a test path.

**Why it's wrong:** I conflated the harness (one execution path) with the delivery (JSON). The harness is useful when the estimator wants the assistant to drive the UI end-to-end and deliver a Preview Quote PDF. For everyday estimating, JSON-to-upload is faster and gives the estimator direct control.

**Rule (permanent):** Default EST delivery = JSON file presented via `present_files`. Chrome harness only when Michael explicitly says "enter it for me" or "drive it." If in doubt, deliver the JSON and offer the harness as a follow-up — do not volunteer Chrome work.

---

### Failure 3 — Duplicated intake content between the file and the in-chat grid

**What happened:** Wrote a 14-section intake file (14 tables, ~170 lines) AND posted an equally verbose grid in chat. The Intake Template says the in-chat grid is "a view of this file" — meaning a compact projection, not a carbon copy.

**Why it's wrong:** Doubles the response time and doubles Michael's reading load. The estimator reviews the grid in chat; the intake file is the durable record on disk. They are not the same artifact.

**Rule (permanent):** Intake file = full 14-section record on disk. In-chat grid = compact view keyed on the SIMPLE-QUOTE or MULTI-PART template from `EST_SPOT_Intake_Harness.md`, FLAGS block with ASK/ASSUMED/CONFIRMED/REGISTRY/WATCH rows, nothing more. Do not restate the file's prose in the chat.

---

### Failure 4 — Spun up a full audit response on an empty readiness-ack turn

**What happened:** Michael opened with "im ready to estimate" and attached the fleet XLSX. I ran the full audit block, loaded the Canonical Terms registry, emitted the SESSION-START block, and flagged the XLSX. The actual content Michael needed was one line: "drop the RFQ when ready."

**Why it's wrong:** A readiness-ack turn has no RFQ. The SESSION-START block is for the turn that opens the actual intake. Running it early on an empty turn burns tokens and time for nothing.

**Rule (permanent):** "Ready?" turns get a one-line ack: "MODE: EST. Ready — drop the RFQ." The audit header still fires (system-prompt mandate), but registry load + SESSION-START block are deferred to the turn that actually receives RFQ content.

---

### Cumulative effect — sequencing

The four failures above compound. The target shape for a single-item EST estimate is:

- **Turn N (RFQ drops):** audit + read RFQ + write intake file + post compact grid + ASKs. One response.
- **Turn N+1 (ASKs resolved):** audit + JSON payload + `present_files` delivery. One response.
- **Turn N+2 (post-upload handoff):** audit + Phase 5 handoff summary from the economics panel Michael reads back. One response.

Three turns, max. Today was five-plus. Next batch item resets that clock.

---

### Failure 5 (observed mid-Schieks turn, confirmed on GOL turn) — Didn't pre-flag the Chrome-to-PDF round-trip limit

**What happened:** Michael asked "load the json into chrome and give me the spot pdf in here" on the Schieks (L&M Container) estimate. I loaded the JSON cleanly, then discovered — mid-turn — that SPOT's Preview Quote Export uses `window.open("","_blank")` to render the printable HTML in a new browser window. That new window is NOT addressable by Chrome MCP tools (the tab group context only exposes the original tab). The PDF can only be generated by the estimator pressing Ctrl+P inside that pop-up on their own machine. I should have flagged the constraint at the top of the turn rather than loading first and stopping mid-delivery.

**Why it's wrong:** Silent constraint-discovery mid-execution breaks the promise of "I'm driving this to completion." Better to surface the channel limit up-front and let the estimator decide: (a) JSON + instructions to Ctrl+P locally, (b) screenshot of the Preview Quote modal (visual, not a true PDF), or (c) skip the JSON-into-Chrome step entirely and just hand over the JSON.

**Rule (permanent):** When the estimator asks for a PDF-in-chat from SPOT, flag this at the start of the reply: "SPOT's Export button opens the quote in a pop-up window that Chrome MCP can't capture. I'll load the JSON, you'll Ctrl+P inside the pop-up on your machine — that's the SPOT-native path (Rule 1)." Do NOT start loading first and discover the limit mid-turn.

---

### Cementing receipts — turn-count progression this session

The four (now five) rules above compound. Three estimates ran this session; the turn count fell each time as rules went into force:

| Estimate | RFQ shape | Turns used | Rules applied vs. missed |
|----------|-----------|-----------:|---------------------------|
| Skybox / MRO15486 (400 qty, 1 item) | Simple quote | **5** | Baseline — all four failures occurred. |
| L&M / Schieks Counter Display (250/500 qty, 2 items) | Multi-Part matched set | **2** | Rules 1–4 applied cleanly (JSON built from runner, delivered as file, compact grid, one-line readiness ack). Rule 5 not yet known — discovered mid-turn when Chrome-PDF round-trip failed. |
| PCA / Garden of Life J57667 (75 qty, 4 items) | Multi-Part matched set, 4 components, non-trivial board substitutions (40 ECT B → ECT 32 B, Litho Laminate → Satin digital) | **1** | Rules 1–5 applied. JSON built in one pass using the Multi-Part schema learned on Schieks; Chrome load succeeded; PDF handoff delivered as inline instructions + JSON attachment (no mid-turn discovery). |

**Interpretation:** Rules 1–4 removed the biggest time sinks (schema re-learning, Chrome introspection, verbose intake, empty-turn ritual). Rule 5 removes the last predictable mid-turn stall. Target cadence now holds across Simple, 2-item Multi-Part, and 4-item Multi-Part shapes.

---

### New artifacts added this session

- Updated `EST_SPOT_Session_Lessons.md` (this entry, incl. Failure 5 + cementing receipts).
- Five new rows appended to the Permanent rules summary table at the bottom of this file.
- **Extended `EST_SPOT_Channel_Reference.md`** from 31 lines to the full schema (Simple + Multi-Part bomItems[] shape) + delivery-channel rules + Chrome-to-PDF limit note. This closes the "had to re-grep JSX for the schema" gap that produced Failure 1.
- Intake records (kept as per-estimate durable records under `/home/claude/estimates/`):
  - `skybox_47309_mro15486/` — Simple quote template
  - `lm_schieks_126292/` — Multi-Part 2-item template
  - `pca_gol_j57667/` — Multi-Part 4-item template with board-substitution + non-native-print handling

---

## 2026-04-21 — EST-BATCH-01 First Payload (Reading-Discipline Failures)

### Sources
- First live session against the consolidated project under EST-BATCH-01.
- Rolled up into EST-RECALIB-01 and D-100 / D-103.

---

### Failure 1 — Got ECT 44 substitution direction wrong

**What happened:** Customer RFQ specified ECT 44. I described the SPC substitution as going ACROSS to another ECT grade (e.g., "ECT 44 falls back to ECT 32 stock"). Actual SPC behavior: ECT grades fall back DOWN to the corresponding Mullen stock sheet via grade fallback — ECT 44 runs on the Mullen 200# sheet library, not on ECT 32 stock. ECT 44 is uncommon at SPC and requires a manual mill-substitute check. (A popup guardrail was scoped in D-098 release notes but code audit 2026-04-21 confirmed it was never implemented; tracked as DEV-011.)

**Why it's wrong:** Gave the estimator a substitution story that does not match how `base_matrix` + sheet library + grade fallback actually work. If that had gone onto a quote it would have misrepresented how the board is sourced.

**Rule (permanent):** Load `EST_SPOT_Canonical_Terms.md` before answering any question that involves a board grade, ECT value, or liner. Do not describe SPC substitution behavior from general priors. ECT grades substitute DOWN to Mullen stock sheets, not ACROSS to other ECT grades. ECT 44 is uncommon at SPC (manual mill-substitute check; popup guardrail scoped in D-098 but never coded — DEV-011 open).

---

### Failure 2 — CKB misidentified as Clay-Coated Bleached Kraft

**What happened:** Customer used the token "CKB" in the RFQ. I expanded it as "Clay-Coated Bleached Kraft" (industry-standard folding-carton paperboard grade) and answered against that meaning. At SPC, "CKB" is shop shorthand for **Corrugated Kraft Board = 42# Kemi-Lite**, which is a corrugated liner — not a folding-carton board at all. Completely different product.

**Why it's wrong:** Training-data prior overrode SPC's actual vocabulary. Had I proceeded, the quote would have been built against the wrong substrate category entirely.

**Rule (permanent):** No training-data inference for SPC domain tokens. Every token that could be SPC-specific must be checked against `EST_SPOT_Canonical_Terms.md` before use. If the token is not in the registry, ASK the estimator. Do not expand abbreviations from general knowledge of the packaging industry.

---

### Failure 3 — Re-asked a question the estimator had already answered

**What happened:** Earlier in the conversation the estimator stated the ship-to location explicitly. Several turns later, while preparing the Phase 2 grid, I asked the estimator for the ship-to. They had to point out that they had already given it.

**Why it's wrong:** Skim-and-gist reading. I summarized the estimator's earlier message into a mental paraphrase that dropped the ship-to detail, then re-asked for it. Wastes the estimator's time and undermines trust that I'm reading the material.

**Rule (permanent):** Before asking any question, scan the full conversation end-to-end — the raw text, not a recalled summary — for the answer. If the answer is present anywhere, use it. Re-asking is a failure mode.

---

### New artifacts added this session

- `Reading_Discipline_Protocol.md` (D-100 DESIGN) — five rules that codify the above.
- `EST_SPOT_Canonical_Terms.md` (D-103 CODED) — SPC-specific token registry with industry-divergence flags.
- Session-Start Discipline section added at the top of `EST_SPOT_Quoting_Rules.md`.
- Updated `EST_SPOT_Intake_Harness.md` to v2.1 with a SESSION-START block.

---

## 2026-04-14 — Full UI Remap + BCI Packaging Failures

### Sources
- BCI Packaging morning session (failures).
- Full UI remap afternoon session (new protocols).

---

### Failure 1 — Reportlab PDF (Third Consecutive Session)
PDF was built with Python instead of SPOT Preview Quote. Three sessions running.

**Rule — permanent, no exceptions:** PDF = SPOT Preview Quote ONLY. No reportlab, fpdf, or any external generator. If Preview Quote is inaccessible in Chrome: STOP, tell the estimator, do not substitute.

**Hard gate — state this aloud before every Chrome Phase 2:**
> "PDF will come from SPOT Preview Quote. I will not use any external generator."

---

### Failure 2 — Skipped the intake grid because "the RFQ looked complete"

**What happened:** RFQ looked full, I started entering into SPOT without posting the Phase 2 grid. Two silent assumptions (flute and glue) turned out to be wrong. Quote had to be rebuilt.

**Rule:** The Phase 2 intake grid is non-optional. Even when every field is present in the RFQ, the grid gets posted so the estimator can correct silent assumptions before Chrome starts.

---

### Failure 3 — Assumed flute from part-number pattern

**What happened:** BCI part number suggested B-flute based on prior jobs; RFQ didn't state flute. I used B. Customer wanted E.

**Rule:** Never infer flute, pcs/set, or glue from part-number conventions. If the RFQ doesn't state it, the field goes in the grid as **ASK**. One question per turn until resolved.

---

### Failure 4 — Asked multiple questions in one turn

**What happened:** During Phase 2 I stacked three ASK items into one message. Estimator answered the first one and moved on; the other two got lost.

**Rule:** One question per turn. Post the grid with all ASKs visible, then ask them serially.

---

### Afternoon — UI remap protocol established

New protocol going forward:

1. At session start, read `window.__SPOT_UI_VERSION` in DevTools.
2. Compare against `MAP_VERSION` in `EST_SPOT_UI_Map.md`.
3. If the version has changed since the last map, stop and request a remap session. Do not quote off a stale map.

---

## 2026-04-13 — BCI Packaging 91-9013 SCIENCE DRT. PRT.

### Sources
- BCI Packaging quoting session.

---

### Mistake 1 — Built a reportlab PDF instead of using SPOT Preview Quote

**What happened:** When asked for a PDF quote, I generated one with Python/reportlab instead of loading the JSON into SPOT and clicking Preview Quote.

**Why it's wrong:** SPOT's Preview Quote is the official customer-facing format. Reportlab PDFs don't match the company's quote template, and building them wastes time.

**Rule:** PDF quotes come from SPOT Preview Quote — ALWAYS. Never use reportlab, fpdf, or any external PDF generator for customer quotes. The only deliverables from the engine are:
1. The text-based quote block (for chat confirmation).
2. The saved JSON (for re-loading into SPOT).
3. The Preview Quote PDF exported from SPOT itself.

*This rule was repeated on 2026-04-14 after a third failure. Hard-gated now.*

---

### Mistake 2 — Edited the JSON with `routeOverride` set for a test

**What happened:** To force a Crest route for a comparison check, I added `routeOverride: "Crest"` to the JSON and loaded it. The app accepted it, but it produced a quote with a non-viable route that had to be manually reset.

**Rule:** JSONs never carry `routeOverride`. If a forced route is needed for comparison, the estimator clicks Switch in the UI. This became a hard rule across all modes and is now rule #1 in `EST_SPOT_Quoting_Rules.md`.

---

### Mistake 3 — Did not confirm FOB before handoff

**What happened:** Assumed Origin (ZIP 44704) without asking. Correct in this case, but the estimator flagged that assuming-without-confirming is fragile when a customer has historically shipped Destination.

**Rule:** FOB defaults to Origin unless the customer explicitly requests Destination. If the customer record shows prior Destination history, the field goes to ASK in Phase 2.

---

### Mistake 4 — Handoff prompt missing key fields

**What happened:** Delivered a review prompt that had customer / part# / qty pricing, but missed board spec and FOB line.

**Rule:** Phase 5 handoff prompt must include, every time: customer / part# / est# / board / blank / route / sheet / N-out / qty pricing / GM / freight / FOB. If any field is missing, I didn't finish Phase 5.

---

## Permanent rules summary (promoted from the sessions above)

These rules are now enforced at the top of `EST_SPOT_Quoting_Rules.md`. They appear here as the receipts — the specific session that forced each rule into existence.

| Rule | First session |
|------|---------------|
| PDF = SPOT Preview Quote ONLY | 2026-04-13 (reinforced 2026-04-14) |
| Phase 2 intake grid is non-optional | 2026-04-14 |
| Never infer flute / pcs-set / glue from part-number patterns | 2026-04-14 |
| One question per turn during Phase 2 | 2026-04-14 |
| Version-check SPOT at session start; trigger remap if changed | 2026-04-14 afternoon |
| No `routeOverride` in JSONs | 2026-04-13 |
| FOB defaults to Origin; ASK if customer has Destination history | 2026-04-13 |
| Phase 5 handoff prompt must carry all 11 fields | 2026-04-13 |
| Load `EST_SPOT_Canonical_Terms.md` before any RFQ read; no training-data inference for SPC tokens | 2026-04-21 |
| ECT grades substitute DOWN to Mullen stock — not ACROSS to another ECT; ECT 44 manual mill-substitute (popup scoped D-098 but not coded — DEV-011) | 2026-04-21 |
| Re-read the last user message before answering; never re-ask a question the estimator has answered | 2026-04-21 |
| Short-answer discipline — one-word question gets a one-word answer | 2026-04-21 |
| JSON schema source = `DEV_spot_runner.js` + `EST_SPOT_Channel_Reference.md`. Never introspect the live app or grep JSX `applyState` to learn field names. | 2026-04-22 |
| Default EST delivery = JSON file via `present_files`. Chrome harness only on explicit "drive it" from the estimator. | 2026-04-22 |
| Intake file on disk is the durable record; in-chat grid is a compact view. No content duplication between the two. | 2026-04-22 |
| "Ready?" / empty-turn acks get a one-line response. SESSION-START block + registry load are deferred to the turn that actually receives RFQ content. | 2026-04-22 |
| When the estimator asks for PDF-in-chat from SPOT, flag the Export-pop-up / Chrome-MCP round-trip limit up-front; don't load-then-discover mid-turn. | 2026-04-22 |

---

## How to add a new session entry

1. Insert the new session at the TOP of this file, below this paragraph.
2. Use `## YYYY-MM-DD — <session name>` as the header.
3. List sources, then each mistake/failure as its own subsection with What happened / Rule.
4. If a mistake produces a new permanent rule, add a row to the Permanent rules summary table.
5. Do not edit or delete past session entries.
