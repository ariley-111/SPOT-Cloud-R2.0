# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.


## 2026-06-16 — Route Comparison panel 1:1 legacy parity
- **Backend** `routing.py::compare_routes`: now returns `breakeven {qty, die}`, `perPc`,
  `cadSaberNeeded`, and `isStock` on the CAD detail (Crest already had it) — verbatim
  legacy `spot_r1_5.jsx` L835-890. Locked by `tests/test_route_comparison_parity.py` (3/3).
- **Frontend** `RightDashboard.jsx::RouteComparison`: rebuilt to match legacy exactly —
  winner badge "{route} wins" with per-route colors (CAD #22c55e / Crest #3b82f6 / Bobst
  #a855f7), all-routes verdict + "Routes are equal" case, breakeven lines ("Crest breaks
  even at N pcs" / "CAD wins below N pcs" / "Crest wins if die < $X"), "✓ Crest path uses
  stock sheets", "Bobst not viable: <reason>", and "Bobst pays mill min" notes; sheet dims
  now 1-decimal.
- **Switch buttons** now fully functional & legacy-parity: Switch to Crest/CAD/Bobst force
  the route, auto-fill a die ($1,200 Crest / $1,800 Bobst) when none is set, collapse the
  panel, and toast; forced state shows "✓ Route forced to X" + "Reset to Auto".
- Verified by testing agent (iteration_24.json): 10/10 acceptance criteria, frontend 100%.
- Note (unrelated): Entra SSO `/api/auth/entra/login` 500s in PREVIEW because
  ENTRA_TENANT_ID is set to "spot-multi-user" (invalid tenant). Use email/password login in
  preview. Prod env should set a valid tenant id.

## 2026-02-10 — MP-Individual UX polish (auto-scroll, qty selection, freight treatment, Job Totals)

User feedback after the per-component layout shipped: (a) auto-scroll on every
engine recompute was disruptive, (b) nav chips next to Expand/Collapse All
didn't actually select the component, (c) no way to know what the section
header total reflected when a component had multiple qtys, (d) Freight
Treatment tiles (Line / Amort) only existed in Single-Part — missing in MP,
(e) Job Totals didn't label the Local Delivery zone, (f) multi-qty per
component didn't surface a per-tier breakdown.

### Frontend
- `QuoteTableSec.jsx`: auto-scroll now uses a `prevActiveRef` so it fires
  ONLY when `activeItemIdx` actually changes (clicks), not on engine recompute.
- Nav chips now call `setField("activeItemIdx", …)` so clicking syncs to the
  BOM section and the matching section gets the BOM badge + auto-scroll.
- Per-component sub-table: rows are now clickable to SELECT a qty tier. The
  selected row gets `data-row-selected="true"`, a SEL badge, and an accent
  outline. The section header shows `@<qty>: $<total>` for the selected row
  with a breakdown line (`base $X + frt $Y + die $Z + prep $W`).
- Job Totals footer: when `quoteFOB === "Local Delivery"`, the label becomes
  `"Per-Job Freight: Local Delivery · <zone>"`. When any component has 2+ qty
  rows, the layout switches to a per-tier breakdown table
  (`qt-job-totals-by-qty`) with rows `qt-job-totals-tier-N` showing Items /
  Per-Item Freight / Die / Prepress / Per-Job Freight / Total at each tier.
- `Placeholders.jsx::JobLevelAllocPanel`: adds Freight Treatment tiles
  (`tile-itemfreight-line/amort`, `tile-jobfreight-line/amort`) and Prepress
  Treatment tiles (`tile-itemprepress-line/amort`, `tile-jobprepress-line/amort`),
  scope-gated. Targets `freightTreatment` vs `jobFreightTreatment` based on
  `freightScope`.
- `RightDashboard.jsx::updateFreight`: rewrote to handle MP+Per Item
  (iterates `bomItems`, calls `freightQuote` per component using per-component
  weight, writes each `state.freightCost`) vs MP+Per Job (single combined
  quote → `jobFreightCost`) vs Single-Part (existing behavior). Carrier + FOB
  metadata applied across all updated items.

### Tested
- Backend: 16/16 regression tests still pass (no backend code touched).
- Frontend: testing_agent_v3_fork iteration_10 verified all 8 freight/prepress
  treatment testids render + correctly scope-gated; iteration_9 verified
  nav-chip activeItemIdx, qty-row selection, Local-Delivery label, per-tier
  breakdown, and the `btn-freight-update` Update All code path. Both ran on
  live MP-Individual quotes.

## 2026-02-10 — MP-Individual per-component layout (Quote Table + PDF)

User feedback: in MP-Individual mode (each component has its own qty tier(s)),
the Quote Table was showing a single aggregate row missing Sheet/#Out/CAD-hrs/
Freight detail, and the PDF only rendered the active component. Legacy showed
all components but applied every component's qty to every component (wrong).
The new design follows the user-specified structure: each BOM component
becomes its own section with its own qty rows, and Per-Job costs (freight,
prepress) move to a Job Totals footer.

### Backend
- `POST /api/engine/calculate-multi-part` now returns `componentPricing[]` and
  `jobTotals`. Each `componentPricing` entry: `{itemId, itemIndex, desc, type,
  pcsPerSet, boardSpec, rows[]}`. Each row carries qty, sellPc, costPc, perM,
  sellMSF, costMSF, sheetW, sheetL, pcsPerSheet, route, cadHrs, freightLine,
  dieLineCost, prepressLineCost, sellTotal. In Individual mode rows come from
  the component's own `state.qtys[]` (blanks skipped); in Matched Set mode rows
  come from top-level set qtys with `qty = set_qty × pcsPerSet`.
- `POST /api/pdf/preview-quote` now accepts `componentPricing` + `jobTotals`
  and renders per-component sections (`pricing_table = sections + footer`) when
  the quote is MP-Individual. Matched Set + Single-Part PDFs unchanged.

### Frontend
- `QuoteTableSec` rewritten with two layouts:
  - **FlatLayout** (SP + MP-MatchedSet): unchanged behavior plus added Die +
    Prepress columns to every row.
  - **ComponentLayout** (MP-Individual): collapsible per-component sections
    with sub-tables. Expand-All / Collapse-All buttons + component nav chips
    scale cleanly to 25+ components. Job Totals footer with grand total.
- `PreviewPdfModal` adds `PerComponentSections` for the on-screen PDF preview
  (matches the backend PDF layout). Items / Per-Item / Per-Job rows in footer.
- `useEngine` returns `componentPricing` + `jobTotals` in addition to existing
  fields.

### Tested
- Backend: 22/22 tests pass (10 new + 12 regression) — verified Individual
  picks each component's own qtys, Matched Set multiplies by pcsPerSet.
- Frontend: Quote Table testids (`qt-comp-section-*`, `qt-comp-table-*`,
  `qt-expand-all`, `qt-collapse-all`, `qt-job-totals`, `qt-grand-total`) all
  render. Preview testids (`preview-comp-section-*`, `preview-grand-total`)
  render. PDF preview math matches engine ($8,483.08 grand total on the
  loaded MP sample).

## 2026-06-03 — Multi-Part Parity Sprint ✅ (MP-1 → MP-6)

Full Multi-Part feature parity with the legacy desktop tool. Most production quotes
are multi-part (displays, kits, sets) — this was the blocking gap for cloud adoption.

### MP-1 — State foundation
- `/app/frontend/src/lib/mpSchema.js` — JOB_LEVEL_KEYS / ITEM_LEVEL_KEYS segregation,
  `gatherItemState`, `freshItemState`, `applyItemStateTo`, `makeBomItem`
- `QuoteContext` actions: `switchBomItem`, `addBomItem`, `duplicateBomItem`,
  `removeBomItem`, `reorderBomItem`, `updateBomItem`, `convertToMultiPart`,
  `convertToSimple`
- `BomSec` upgraded: per-item desc/type/pcsPerSet editors, drag-reorder, +Component,
  ⎘ Duplicate, ↗ Spin-off, × Remove
- Toolbar `→ Multi-Part` / `Multi-Part · N` toggle

### MP-2 — Backend orchestration + Quote Table
- `POST /api/engine/calculate-multi-part` — per-component pricing for MFG (full
  pipeline), Purchased (cost × markup), Fulfillment (per-set fee × markup);
  Matched Set + Individual aggregation; GM Override mode (forces uniform GM%)
- `useEngine` hook routes to MP endpoint when `state.quoteType === "Multi-Part"`;
  returns `{results, perComponent, meta, isMultiPart}`
- Quote Table `mp-banner` + `mp-per-component` per-component breakdown table

### MP-3 — Parser → MP auto-apply
- ReviewParseModal detects `parsed.bomItems[]`, renders Job + per-component tabs
  with low-confidence ⚠ badges, applies full MP state via `replaceState`
- Multi-CAD upload already supported by parser route — UI now bridges to MP

### MP-4 — Dashboard + job-level allocation
- Right Dashboard cost buildup now reads `perComponent[activeItemIdx]` in MP mode
  (Material / Print / Cutting / Finishing show per-component, not aggregate)
- Pricing Strategy section adds `JobLevelAllocPanel`: scope toggles + amount
  inputs for freight and prepress, with `By MSF` / `Equal` allocation method
- Backend `calculate_multi_part` calls `allocate_job_cost` for `freightScope=Per Job`
  and `prepressScope=Per Job` to inject `allocatedFreight` / `allocatedPrepress`
  on each component

### MP-5 — PDF parity
- Backend `_customer_pdf_html` MP branch emits the BOM listing
  (Component / Type / Pcs/Set / Specs) and replaces `Qty/Each/Per/M`
  with `Sets/Per Set/Per/M Sets`
- Preview modal renders the same MP layout in the in-app HTML preview

### MP-6 — Polish
- Low-confidence component ⚠ badge on parse-review tabs
- Spin-off action (`spinOffBomItem`): extract one component to a new Simple
  tab with carry-over identity (customer, estimator, est num)
- `spinOffOrigin` shown in Estimate Info as "FROM: <estNum> · <desc>"

### Regression status
- 12/12 backend pytest pass on `calculate_multi_part`
- 4 iteration testing sweeps; 3 issues found and fixed in MP-1..MP-5 verification:
  spin-off render crash (object → string), `BomSec` hook-order violation
  (useState moved before early return), Preview modal MP routing + JSX labels
- Simple-mode quotes verified unchanged

## 2026-06-03 — Sheet Library override fix ✅

Bug: picking a sheet in the Sheet Library modal did nothing — the `onPick`
callback was a no-op stub and the backend never read `overrideSheetId`. Each
multi-part component appeared to "ignore" the chosen sheet.

### Backend
- `engine/routing.py` — new `select_override_sheet()` mirrors legacy
  `spot_r1_5.jsx` L3544-3570 (pricable as-is → use; below mill min → scale
  via stock min-buy; not pricable → return for Buy-Min flag surfacing)
- `engine/runner.py` — Step 1 parses `overrideSheetId` (`"OVR-{w}x{l}"`) and
  short-circuits auto-select. Step 2 skips auto-flip when override active.
  Step 3 pins route to CAD (legacy L3578-3580). `overrideActive` exposed at
  result top-level + in `_pipeline`.

### Frontend
- `pages/SpotApp.jsx` — `onPick` now writes `setField("overrideSheetId", …)`
  via the Sheet Library modal (was a `/* future */` stub)
- `components/spot/SheetLibraryModal.jsx` — owns its own setField/clear flow,
  highlights the active override in purple, exposes "Clear Override" button
- `components/spot/RightDashboard.jsx` Board panel — adds "OVERRIDE" mode
  label + purple banner ("User Override · Route pinned to CAD") with inline
  Clear button when active
- `hooks/useEngine.js` `buildPayload` — propagates `overrideSheetId` for
  single-part mode (already mirrored into bomItems[active].state for MP)

### Verified
- Curl: single-part `OVR-48x96` → engine returns `48×96` sheet, `route=CAD`,
  `overrideActive=true`
- Curl: 2-item MP with override on item B only → A auto-picks, B respects
  override, each component independent

### Follow-up fix (same day)
Right Dashboard panels (Board, Cost Buildup, Economics) showed "no sheet
selected" / "no breakdown" in Multi-Part mode even when the engine clearly
picked a sheet for the active component. `RightDashboard` was calling
`useEngine` and using `results[selSlot]` directly — which in MP mode is the
aggregated job row (no `sheetW`/`boardTotal`/`matTotal`). `SpotApp.jsx`
already branched to `perComponent[selSlot].items[activeItemIdx]` for the
main column; RightDashboard now mirrors that exact branching.

## 2026-06-03 — Pass 1: Quote Table interactivity + Economics gaps ✅

### Quote Table (`QuoteTableSec.jsx`, `defaults.js`)
- Click a Qty row → `selSlot` updates, drives Per-Component, Order Total,
  Economics, Cost Buildup, Board, Route panels (legacy parity)
- Selected row gets accent-soft background + "SEL" badge + bold qty
- Row tint by mode: Stock (green) / Custom (blue) / Below Min (orange)
- ACT checkbox toggles per-row exclusion; excluded rows dim to 45%
- When the user excludes the currently-selected row, selection auto-jumps
  to the first remaining active row (no stale Order Total display)
- "All Active" button resets all exclusions
- "Excluded from PDF" badge appears in Order Total breakdown when user
  manually clicks an already-excluded row
- New state field: `state.exportExclude: number[]` (JSON-serializable)
- Per-Component Breakdown header now reads `selSlot` + shows "Click a Qty
  row above to switch" hint

### Economics panel (`RightDashboard.jsx`)
- Matched Set top block when MP + pricingMode=Matched Set: setQty sets,
  Sell Total, Sell/Set, Margin %, Margin $, Total Cost, Cost/Set + optional
  Line Charges / Quote Total summary line
- Type badge MFG/PUR/FUL with color (green/blue/amber)
- "Active Component" / "Item" section label + child number (-1, -2…)
- Sell row line-item breakdown row: Freight + Die + Prepress + Order when
  line-items active (was: only freight + order)
- Fulfillment "Cost Only" mode — 50% dim + amber label

### Cost Buildup → Order Total reconciliation
- In MP mode the One-Time Line Items section now reads JOB-LEVEL totals
  from the aggregate row (Items all components + Freight + Die + Prepress
  + Order Total). The label changed from "Quote Total" to "Order Total"
  in MP, matching the Quote Table footer. Eliminates the $1,414.16 vs
  $2,170.93 mismatch users saw before.
- Backend `engine_routes.calculate_multi_part` now exposes line items
  separately on the aggregate (`freightLine`, `dieLineCost`,
  `prepressLineCost`, `miscLineCost`, `itemsSell`). Math is identity-
  equivalent to the previous lumped `line_charges`.

### PDF/Preview (`PreviewPdfModal.jsx`)
- Excluded rows are filtered out of `previewRows` before being passed to
  the backend PDF generator

### Engine math
- Untouched. Zero changes to `engine/core.py`, `engine/pricing.py`,
  `engine/runner.py`, `engine/routing.py` in this pass.

## 2026-06-03 — Pass 2: BOM Builder feature parity ✅

Keeps cloud's compact layout but adds legacy functionality.

### New backend collection + routes
- `db.COL_BOM_TEMPLATES = "bom_templates"`
- `routes/bom_templates.py` — full CRUD + promote (personal → team)
- Two scopes: `personal` (visible only to owner) and `team` (visible to
  every authenticated user — org-shared). Persisted server-side, not
  localStorage — different from legacy's single-user design.
- Owner-or-admin permission on update / delete / promote

### Frontend BOM Builder (`BomBuilderModal.jsx`)
- **Project Name** field at the top — bound to `state.custRef` (matches
  existing Estimate Info field, so they stay in sync)
- Three template sections rendered side-by-side:
  - **Display Styles** — built-in 10 (`displayTemplates.js`)
  - **My Templates** — personal, fetched from backend
  - **Team Templates** — org-shared, fetched from backend
- Each personal/team template card has hover actions: edit (✎), promote
  (↗, personal only), delete (×)
- Per-row **Lock** icon (🔒/🔓) — disables editing for that row
- "Lock All / Unlock All" toggle button at footer
- **Save Template** inline panel — Save (Personal) / Save (Team) /
  Update for existing, with name input
- **Drag-and-drop** reorder via the ⠿ handle (existing ▲▼ buttons kept)
- **Dim info** badge under each component when source BOM has dims set
  (e.g., "● 47.25×38 · 2 pcs/set")

### Verified
- Curl: full CRUD smoke-tested (create → promote → update → list → delete)
- Backend lint clean, frontend lint clean



