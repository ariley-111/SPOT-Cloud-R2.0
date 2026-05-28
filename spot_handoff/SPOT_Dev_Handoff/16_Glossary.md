# 16 — Glossary

Every SPC-specific term, every acronym, every gotcha. Sorted alphabetically. ⚠️ marks terms where SPC meaning diverges from industry-standard usage — these are the priors that will burn you if you trust them.

---

### Advanced Rates
The UI panel (under Advanced Controls) that exposes editable rates. Estimators can override `RATE_DEFAULTS` for the current quote; persistent overrides go to `wf_default_pricing_targets` in localStorage.

### Anthropic API
The RFQ parser's LLM provider. Called by `spot_server.js` `/est/parse-rfq`. Soft token budget at `/est/parser-budget`.

### Apply state (`applyState` / `applyItemState`)
The functions that load a saved JSON into current React state. **Reset-first** — they replace, never merge. Three closed defects tied to this pattern (D-080, D-087, D-098).

### Asks
Fields the RFQ parser couldn't fill from the source documents. Returned in the parser response as `asks[]`. The estimator resolves them in Phase 2 of the EST workflow.

### Auto-route
The default SPOT routing decision: pick the cheapest viable route. Tie-breaker preference: Bobst → Crest → CAD.

### Babel
The transpiler that converts JSX to IE11-compatible JavaScript. Specifically, the build uses `@babel/preset-react` and `@babel/preset-env { targets: { ie: 11 } }`. Key behavior: `const` becomes `var`, eliminating Temporal Dead Zone. This causes the D-107/D-108 useMemo bug class.

### `base_matrix`
The board-cost lookup table in `spot_engine.js` and the JSX ENGINE block. Keyed by wall_type → grade → MSF tier. Post +10% paper uplift (D-102).

### Blank
The flat layout of one box, before folding. Specified by `oneUpW × oneUpL` in inches.

### Bleached White
A fully bleached liner. 42# Bleached White is +$17.50/MSF upgrade. SPC uses this when customer asks for "bleached" or "bright white." Different from Mottled White / MW.

### Bobst
Brand of flat-bed die-cutter. At SPC, a route name. Uncalibrated as of R1.6.5.1 (D-121). Eligibility: E or F flute only, sheet 13.78×15.75 to 41.75×29.125.

### BOM (Bill of Materials)
A multi-part quote's list of pieces. In SPOT, `bomItems[]`. Each item has its own dims, board, route, qtys.

### Buy Min
Mill minimum board order (15,000 sqft default). Triggers on custom/forced boards only. Stock sheets bypass per D-067 / Rule 5.

### CAD
**⚠️ SPC-specific.** At SPC, "CAD" is a *route* — a rotary cutting machine using CAD files instead of physical dies. NOT Computer-Aided Design software in this context.

### Caliper
The thickness of corrugated board in inches. `FLUTE_CALIPERS`: E=0.0625, B=0.125, C=0.1875, B/C=0.236.

### Calibration
The process of tuning engine rates against fleet data. Methodology in `06_Calibration_Methodology.md`. Last major: D-110 FINAL, 2026-04-24.

### Channel
The mechanism by which AI assistant delivers SPOT work — JSON file, Chrome MCP load, or runner check. Detailed in `EST_SPOT_Channel_Reference.md`.

### Chowder
The named regression test suite. Six representative job specs with expected costs. Lives in `TEST_SPOT_R1_5_Chowder_Specs.md`.

### Chrome MCP
The Chrome browser automation tool used for live UI verification and scripted load. Entry point: `window.__SPOT_LOAD_JSON(payload)`.

### ⚠️ CKB
**At SPC: Corrugated Kraft Board = 42# Kemi-Lite.** A specific clay-coated kraft liner. **Industry standard CKB = Clay-Coated Bleached Kraft**, a folding-carton paperboard — completely different product. **Never expand from training-data priors.** Source of truth: `EST_SPOT_Canonical_Terms.md`.

### Complex (CAD difficulty)
One of four CAD difficulty tiers: Simple / Straight / Standard / Complex. Setup 22 min, fallback 4 min/sheet. Was "Extreme" pre-D-106; migration table handles old labels.

### Compute layout
The function that calculates N-out for a given blank size on a given sheet size, considering rotation. Returns `{ nOut, orientation }`.

### Control tables
The calibrated business numbers that drive engine math. Documented in `04_Control_Tables_Reference.md`.

### Corrugated
The packaging material SPC produces. Three layers: outside liner, medium (fluting), inside liner. Single-wall = one medium; double-wall = two mediums separated by a center liner.

### Cost Report
The 17-column UI modal that shows the full cost breakdown for each BOM item at each quantity slot. Source-of-truth display for what the estimator quoted.

### Cowork
External AI tool / process that applies file bundles to project knowledge and runs live UI tests via Chrome against localhost:3100. Used for autonomous verification cycles.

### Crest
**⚠️ SPC-specific.** At SPC, "Crest" is a route — a flat-bed die-cutter. Industry meaning: a trademarked brand name from several equipment makers; not a route per se. Eligibility: any flute, sheet ≤ 60 × 120.

### Customer code
The unique short ID for a customer in `customerList.csv`. E.g., "SKYBOX" for Skybox Packaging.

### D-### / D number
A defect or small feature ID. Numbered sequentially. The unit of change tracking in SPOT.

### Default kraft
The unbleached kraft liner. No upgrade charge. Represented as `"None"` or `"Kraft"` in the JSON (note: D-146 made the canonical engine value `"None"`).

### DEV mode
One of three SPOT operational modes (alongside EST and TEST). Used for code changes, debugging, and builds.

### Die
The physical cutting tool for Crest/Bobst routes. Default die cost: Crest $1,200, Bobst $1,800.

### Die treatment
How the die cost is amortized in the quote. "Separate Line" = called out separately; "Included" = rolled into per-piece cost. D-085 auto-defaults to "Separate Line" $0 on first Crest routing.

### Dimensions (dims)
The L × W × D of the assembled box, in inches. For flat blanks: `oneUpW` × `oneUpL` (the unfolded layout).

### Double-wall
Corrugated with two mediums separated by an extra liner. Heavier products and displays.

### ECT (Edge Crush Test)
Stack-strength rating of corrugated, measured in pounds per linear inch on the edge. "ECT 32" = 32 lb/in. Different test from Mullen.

### ECT 44
**Uncommon at SPC.** Substitutes DOWN to 200# Mullen stock via grade fallback. Mill substitute check is manual. The D-098 popup guardrail was scoped but never coded — see DEV-011.

### Economics panel
The right-side UI panel showing per-qty cost buildup, sell price, GM%. Reflects forced route when forced (D-097).

### Engine
The pricing math layer. Lives in `spot_engine.js` (Node) and the L84–877 block of `spot_r1_5.jsx` (mirror). Must stay in sync.

### EST mode
The default SPOT operational mode. Live quoting workflow. Cannot modify source code in this mode.

### EST-### 
An estimating workflow item — a domain decision the estimating team owns. E.g., EST-GRPHCWHT (Graphic White mapping).

### Estimate number (estNum)
The unique ID for a quote. Format: `^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$`. Example: `SPC-260522-001`.

### Estimator
The human at SPC who builds quotes. Primary user of SPOT.

### Fleet (fleet calibration)
The 785-job (773 scoreable) iQuote dataset used as the validation baseline for engine rate tuning. `WF_Quoting_Tool_Test_Data.xlsx`.

### `fleet_compare.js`
The regression harness. Maps each iQuote row to SPOT JSON, runs through the engine via the runner, outputs per-job CSV + fleet stats.

### Flute
The wavy middle layer of corrugated. Letter-named: A (heavy), B (workhorse), C (heavier B), E (thin, printable), F (very thin), BC (doublewall B+C), EB (doublewall E+B).

### FOB
Freight On Board. Two values: Origin (default, customer pays freight from SPC ZIP 44704) or Destination (SPC pays freight to customer dock).

### Forced route
An estimator override of auto-route. Click Switch in the UI; the panel stays mounted with forced-state UI (D-097). Reset to Auto button restores. `routeOverride` never set in JSON (Rule 1).

### FSC / SFI
Chain-of-custody certification fee. $25/order at SPC, amortized into board cost. Was $15 pre-D-086; migration fires on load.

### `gatherState`
The inverse of `applyState`. Reads every state variable into a JSON object. Output is canonical SPOT JSON.

### GM (Gross Margin)
Target margin percentage for the quote. Calculated as `sell = cost / (1 - gm_target)`. GM curve keyed on MSF tier.

### GM curve
The target GM per MSF tier (D-110 FINAL): 0–1 MSF 50%, 1–3 MSF 37%, 3–5 MSF 32%, 5–9 MSF 27%, 10+ MSF 25%. Floor at 25% prevents iQuote-style volume giveaways.

### Gloss
Print finish. **NOT the default** — Satin is default per D-105. Opt-in only.

### Grade
Board strength rating. Mullen-based (200, 250, 275, etc.) or ECT-based (ECT 32, ECT 44, etc.). ECT grades fall back to Mullen via substitution.

### Grade fallback
Procurement rule: ECT grades at SPC run on Mullen-equivalent stock sheets. Substitution is invisible to customer-facing quotes. Rule 4.

### Graphic White
**⚠️ Open canonical mapping (EST-GRPHCWHT).** Customer-facing term that needs to map to Kla-White or Bleached White at SPC. Pending estimator decision.

### Harness
The step-by-step UI test/execution sequence. Defined in `EST_SPOT_UI_Map.md`. Phase 4 of the EST workflow executes the harness.

### Inca
The press machine. Rate: $485/hr (D-110 FINAL). Print speed: 75 sh/hr both Gloss and Satin.

### Ink
Print ink. $0.05/sqft, LOCKED business decision (not a calibration target).

### Intake grid
Phase 2 deliverable in the EST workflow — a structured table of every field with RFQ / DEFAULT / ASK tags. Estimator approves before harness executes.

### iQuote
The legacy quoting system SPOT replaced. The 785-job iQuote dataset is the fleet calibration baseline.

### IT (Information Technology)
SPC's IT department — the team that installs SPOT on estimator workstations. The README in the deploy package addresses them.

### JSX
JavaScript with embedded XML-like syntax. The main SPOT source file is `spot_r1_5.jsx` (9,007 lines).

### Kemi-Lite
SPC's clay-coated kraft liner family. 42# Kemi-Lite is the main variant; +$18.50/MSF upgrade over kraft. Brand name from BillerudKorsnäs.

### Kla-White
SPC's mottled-white kraft liner. 42# is standard; 33# is an upgrade on 175/ECT 32; 56# is on 250 only. Generic mill term — used widely.

### Kraft
The default brown liner. No upgrade charge.

### Layout
The arrangement of blanks on a stock sheet. Computed by `computeLayout(oneUpW, oneUpL, sheetW, sheetL)`. Returns N-out and orientation.

### Liner
The outer paper layers of corrugated board. Outside liner is the printable face; inside liner touches the product. Various weights and finishes.

### `liner_upgrades`
The lookup table in `spot_engine.js` (~L57–61) mapping liner names to upgrade rates in $/MSF.

### localStorage
Browser-persistent state. SPOT uses six keys: `wftabs`, `wftab{id}`, `wftabest{timestamp}`, `wf_default_pricing_targets`, `wf_stock_sheets`, `wf_shipto_history`.

### `__SPOT_LOAD_JSON`
The browser global that loads a SPOT JSON without going through the file picker. Entry point for Chrome MCP automation.

### MAP_VERSION
The version of `EST_SPOT_UI_Map.md`. Increments when UI structure changes. Mismatch with `__SPOT_UI_VERSION` triggers remap before quoting.

### Matched Set
A Multi-Part pricing mode. All items priced together at a set-level GM (`setMarginPct`). Alternative: Individual.

### Medium
The wavy middle layer of corrugated. Weights: 26#, 33#, 35HPL#, 40#, 42# Bleached.

### Mode (operational)
EST / DEV / TEST. The system prompt flag that controls which files the AI reads first and what operations are allowed.

### Mottled White (MW)
**⚠️ At SPC: maps to 42# Kla-White, NOT Bleached White.** A generic industry term that varies by mill; SPC's mapping is canonical.

### MSF
Thousand Square Feet. Fundamental volume unit for corrugated. A 1,000-piece order of 3-sqft blanks = 3 MSF.

### MSF tier
The volume bracket used by the GM curve. Tiers: 0–1, 1–3, 3–5, 5–9, 10–24, 25–49, 50–74, 75–99, 100+.

### Mullen
Paper burst test (pounds per square inch). "200 Mullen" = 200# board. ASTM standard.

### Multi-Part
Quote with multiple pieces (BOM). `quoteType: "Multi-Part"`. Mode inferred from `bomItems.length > 1`.

### N-out
Number of blanks that fit on one sheet. Higher N-out = lower per-piece cost. Computed by `computeLayout`.

### `__SPOT_UI_VERSION`
Browser global with the current JSX version. Compared to `MAP_VERSION` at session start.

### One-up
The single-blank flat dimensions: `oneUpW × oneUpL`. Inches.

### Open issues
The `01_OPEN_ISSUES.md` ledger. Current state of all unfinished work.

### Paper uplift
The +10% adjustment baked into `base_matrix` at the 2026-04-14 calibration. D-102.

### Phase 1, Phase 1B, Phase 2 (Archive)
The D-120 archive system's roadmap. Phase 1 = drop UI + write + manifest (shipped). Phase 1B = Anthropic parser (shipped). Phase 2 = SharePoint sync (R1.7+).

### PK (Project Knowledge)
The cloud document store containing SPOT's source files and reference documentation. Source of truth between sessions. Can silently drift from deployed code — hence the SHA audit ritual.

### Preview Quote
The customer-facing PDF generated by SPOT. **The only approved PDF path** (Rule 10). No reportlab, fpdf, or external generator.

### Print finish
Satin (default) / Gloss / Matte / OnQ Styrene / OnQ Lightbox. Per Rule 8, default is Satin.

### Print sides
1-Sided / 2-Sided / White (white flood). Separate field from print finish.

### RATE_DEFAULTS
The central rate object in `spot_engine.js`. Every editable rate has a key here with its default value.

### Rate migration
The block in `applyState` that snaps loaded rates to current `RATE_DEFAULTS`. Fires amber toast (popup #3). Rule 6.

### Reset-first
The state-loading discipline: replace all state with defaults FIRST, then apply loaded fields ON TOP. Rules 7 and `02_Architecture.md` §State management.

### RFQ (Request For Quote)
The customer document that initiates an estimate. Can be a PDF, email, image, Word doc, Excel sheet, or any combination. Parsed by the Anthropic API parser.

### Route
The production path for cutting the blank. CAD / Crest / Bobst. Auto-selected unless forced.

### `routeOverride`
**⚠️ JSON field that MUST NEVER be set.** Forced routes are UI-only. Rule 1.

### Runner
`spot_runner.js`. Thin wrapper around the engine for headless test/regression runs. Used by `fleet_compare.js`.

### Saber
A separate cutting path for irregular shapes. `saber: "Yes"` + `saberCuts` + `saberBlanksOut`.

### Satin
Print finish. Default per Rule 8 / D-105. 75 sh/hr (equalized with Gloss under D-110).

### Schema version
`SPOT_SCHEMA_VERSION`. Currently 2. Bumped on incompatible JSON structure changes; migration runs on load.

### Segment R²
R² computed at the segment level (flute × MSF, or grade × flute × MSF) rather than per-job. More stable metric for fleet validation. Target: 0.95+.

### Session SHA audit
The mandatory ritual at session start: compute SHAs of source files, compare to ledger entries, reconcile any drift.

### Sheet Library
The stock-sheet catalog. `SHEET_GROUPS` in engine, ~216 entries.

### SHEET_GROUPS
The JS array literal in `spot_engine.js` and JSX containing all stock sheets, keyed by grade × flute × liner × medium.

### Sheet selection
The engine function that picks the best stock sheet for a given board spec + blank dims. Maximizes N-out.

### Simple mode (UI)
`bomItems.length === 1`. The single-piece quote UI.

### Single-wall
Corrugated with one medium between two liners. Most SPC work.

### SPC
Standard Printing Company, Canton OH. The shop where SPOT runs.

### SPCOC
Standard Printing Canton, OH local freight zones (D-119). Three flat rates: Canton $45, Akron $70, Cleveland $95.

### SPOT
Standard Printing Optimization Tool. The application this entire handoff covers.

### `SPOT_R1.5.html`
The built single-file HTML output. ~1.18 MB. What estimators actually open in the browser.

### Stock sheet
A sheet from the Sheet Library. Pre-procured, bypasses Buy Min (Rule 5).

### Straight (CAD difficulty)
Second of four CAD difficulty tiers. Was the old "Standard"; renamed under D-106.

### Switch (UI button)
The button in the Route Comparison panel that forces a route. Panel stays mounted after click (D-097). Reset to Auto restores.

### Tab
A working draft of a quote in SPOT. Multiple tabs can be open. Persisted to `wftab{id}` localStorage keys.

### TBD folder
Placeholder archive folder used when files are dropped before the customer is known. Pattern: `TBD_{estNum}`. Renamed to real customer when parser resolves (D-134).

### TC-D### / TC-###
A test case ID. TC-D### is tied to a specific D-###; TC-### is standalone.

### Terms code
Payment terms field from customer record. Normalized to: "30", "45", "60", "COD", "DOR" (Due On Receipt), "PREPAID".

### TEST mode
One of three SPOT operational modes. For regression and validation. Cannot modify source.

### Toast
A non-modal UI notification, usually amber (info) or red (error). Used by rate migration, ECT 44 selection, etc.

### Tolerance band
The ±range each calibration metric is allowed to deviate. Set BEFORE tuning to prevent overfit. Defaults documented in `06_Calibration_Methodology.md`.

### Under5MsfFee
**Always "0"** at SPC (Rule 3). Was $500 pre-D-089. Field exists for legacy compat.

### UTS
The freight API provider. Truckload rates for non-local destinations. Proxied through `/api/freight`.

### Wall type
Single-wall or double-wall. Derived from flute (B, C, E → single; BC, EB → double).

### Warning popup
One of 44 cataloged UI popups in the JSX. Amber = info, red = block, green = success. Full catalog reconstructable via `grep alert\|confirm`.

### WF
"Wide-Format" shop. The SPC shop that SPOT prices. Differentiated from corrugator (different fee structure — see Rule 3).

### `window.__SPOT_*`
The browser globals for debug/automation. `__SPOT_UI_VERSION`, `__SPOT_SESSION_LOG`, `__SPOT_LOG_EVENT`, `__SPOT_LOAD_JSON`.

---

## The five ⚠️ priors that will burn you

Repeating from above with extra emphasis:

1. **CKB** at SPC = 42# Kemi-Lite, NOT Clay-Coated Bleached Kraft
2. **CAD** at SPC = a route name, NOT Computer-Aided Design
3. **Crest** at SPC = a route name, NOT just a brand
4. **MW** at SPC = 42# Kla-White, NOT Bleached White
5. **Gloss** is NOT default — Satin is (per D-105)

These are the five that have produced past defects from training-data priors. Load the canonical terms registry at session start; never expand SPC domain tokens from general knowledge.
