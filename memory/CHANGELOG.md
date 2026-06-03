# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

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


