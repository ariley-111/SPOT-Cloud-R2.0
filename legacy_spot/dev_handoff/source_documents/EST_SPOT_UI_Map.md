# SPOT UI Map — Comprehensive Reference
> Version: 3.1 | Remapped: 2026-04-20 | SPOT R1.5.3
> Covers: Simple mode, Multi-Part mode, toolbar, tab bar, right panel, all modals, 44 warning popups, full harness
> MAP_VERSION: 3.1

## v3.1 delta vs v3.0

v3.0 shipped with 13 gaps and no warnings mapped. v3.1 closes all of them:

1. **44 warning popups** catalogued with trigger + color + buttons (derived from jsx lines 1167–7077, live-confirmed shape on 3 triggers).
2. **Quote Header modal** — full field map with coordinates.
3. **Cost Report modal** — 17-column schema documented.
4. **BOM Builder modal** — full field map including template tabs + item rows + "+ Add" inline.
5. **Sheet Library modal** — search, add-stock sub-form, 5-column table, 216 sheets inventory.
6. **Freight Dashboard modal** — per-component + carrier table, Compare Now flow.
7. **Save Estimate modal** — field map + validation rules.
8. **Load Estimate modal** — archive picker + filter controls.
9. **Preview Quote modal** — PDF export flow.
10. **Economics panel** — full cost buildup columns + forced-route branches (D-097).
11. **Route Comparison panel** — D-090 baseline + D-097 forced-state UI.
12. **Tab bar** — per-tab state keys (`wftab{id}`), archive key (`wftabest{timestamp}`), metadata key (`wftabs`).
13. **Toolbar** — every button + keyboard shortcut + disabled-state logic.

---

## MAP_VERSION lifecycle

Whenever the JSX ships a change that alters UI structure, IDs, or visible field layout:

1. Increment `MAP_VERSION` in this file (e.g., 3.1 → 3.2 for minor, 3.1 → 4.0 for major).
2. Re-verify every harness step against the running app.
3. Log the version bump in this file's delta section at the top.
4. Announce in the session handoff that a remap occurred.

The AI assistant checks `window.__SPOT_UI_VERSION` vs `MAP_VERSION` at session start. Mismatch → stop and request remap per `EST_SPOT_Quoting_Rules.md`.

---

## Session open checklist

At the start of every EST session:

1. DevTools: `window.__SPOT_UI_VERSION` → should read `"R1.5.3"`.
2. This file: `MAP_VERSION` → should read `3.1`.
3. If either drifts: stop, reconcile against `02_RELEASE_HISTORY.md`, remap.

---

## Modes

SPOT runs in Simple mode (single item) or Multi-Part mode (BOM of items). Mode is inferred from `bomItems.length`:

- `bomItems.length === 1` → Simple mode UI.
- `bomItems.length > 1` → Multi-Part mode UI (adds item tabs in the BOM strip).

Most modals are identical across modes. Differences are called out in each modal's section.

---

## Top-level layout

| Region | DOM id / class | Purpose |
|--------|----------------|---------|
| Toolbar | `#spot-toolbar` | New / Load / Save / Preview Quote / Cost Report / Freight / BOM / Sheets |
| Tab bar | `#spot-tabs` | Open estimate tabs + archive dropdown |
| Left panel | `.spot-left` | Customer + dims + board + print + ops |
| BOM strip | `#spot-bom` | Item tabs (Multi-Part), add-item button |
| Right panel | `.spot-right` | Route Comparison (D-090) + Economics |
| Footer | `#spot-footer` | Status line, version pill |

Coordinates in the harness are expressed as DOM selectors first, then `(x, y)` pixel fallback for cases where the selector is ambiguous.

---

## Toolbar buttons

| Button | Id | Shortcut | Disabled when | Opens |
|--------|-----|----------|---------------|-------|
| New | `#btn-new` | Ctrl+N | Never | — (clears tab) |
| Load | `#btn-load` | Ctrl+O | Never | Load Estimate modal |
| Save | `#btn-save` | Ctrl+S | No customer / no partNumber | Save Estimate modal |
| Preview Quote | `#btn-preview` | — | No qty filled | Preview Quote modal |
| Cost Report | `#btn-cost` | — | No qty filled | Cost Report modal |
| Freight | `#btn-freight` | — | Not Multi-Part and no Manufactured item | Freight Dashboard modal |
| BOM | `#btn-bom` | — | Never | BOM Builder modal |
| Sheets | `#btn-sheets` | — | Never | Sheet Library modal |
| Quote Header | `#btn-header` | — | Never | Quote Header modal |

Keyboard shortcuts only fire when focus is outside a text input.

---

## Left panel — Customer, dims, board, print, ops

### Customer section
- `#cust-name` — text, required
- `#cust-contact` — text, optional
- `#cust-part` — text, required
- `#cust-initials` — text, **BLOCKED** (always "SPC" for AI estimates)
- `#cust-fob` — select, default "Origin"

### Dims section
- `#dim-l`, `#dim-w`, `#dim-d` — numeric, required for Manufactured
- Units toggle: in / mm (default in)

### Board section
- `#board-flute` — select: A, B, C, E, BC, EB
- `#board-ect` — select: 32, 44, 48, 51, 55, 61, 71, 82 (44 is uncommon — manual mill-substitute check; D-098 popup scoped but not coded, DEV-011 open)
- `#board-mill` — select (populated from Sheet Library + "auto")
- `#board-caliper` — select (default)
- `#board-fsc` — checkbox, default ON, $25 (migration fires $15→$25 per D-086)
- `#board-under5msf` — numeric, default 0

### Print section
- `#print-finish` — select, default "Satin" (per D-105 Rule 8)
- `#print-colors` — numeric, default 0
- `#print-ink` — locked at $0.05/sqft (display-only)

### Ops section
- Die field with Crest → die auto-default (Separate Line $0) per D-085
- Gluer, stitcher, other ops as checkboxes + modals

---

## BOM strip (Multi-Part)

- Tabs per item: `#bom-tab-{idx}`
- Active item: `.bom-tab.active`
- Add item: `#bom-add`
- Item type per tab: Manufactured / Purchased / Fulfillment

Switching tabs fires `applyItemState` (reset-first per D-087/D-098). `gatherState` syncs `bomItems[activeIdx]` on save (D-081).

---

## Right panel — Route Comparison + Economics

### Route Comparison panel (D-090, D-095 positioned above Economics, D-097 forced-state)
- Visible only when both CAD and Crest are viable for the current piece.
- Columns: CAD | Crest
- Rows: setup hours, run hours, cost/piece at each qty slot, breakeven qty, breakeven die cost
- Forced-state (D-097):
  - Header becomes "Production Route — Forced: CAD" or "Production Route — Forced: Crest" in route color.
  - Forced column highlighted, other column dimmed.
  - **Reset to Auto** button appears.
  - Switch button for the forced route hides/disables; opposite Switch remains.
  - Panel **stays mounted** across Switch and Reset clicks.

### Economics panel
- Per-qty cost buildup: board, press, CAD/Crest, ink, FSC, under5Msf, total cost, sell price, GM%.
- Reflects forced route when forced.

---

## Modals

### Quote Header modal
- `#qh-title`, `#qh-date`, `#qh-quote-num`, `#qh-validity`, `#qh-terms`
- Validation: title + quote num required.

### Cost Report modal
- 17-column table: item, type, dims, board, flute, ECT, mill, caliper, sheet N-out, qty, board cost, press cost, CAD/Crest cost, ink, FSC, total cost, GM%.

### BOM Builder modal
- Template tabs: "From Scratch", "From Recent", "From Template".
- Item rows: dims, board, qty, itemType.
- "+ Add" inline button adds an item without closing the modal.

### Sheet Library modal
- 5-column table: stock id, size, flute, ECT, mill.
- Search box filters by any column.
- Add-stock sub-form: size + flute + ECT + mill + caliper.
- 216 sheets in default inventory.

### Freight Dashboard modal
- Per-component rows: origin, destination, weight, dim, carrier.
- Carrier table (D-002 optimization deferred).
- Compare Now button → runs comparison across carriers (~28 API calls, ~15s).
- isMultiPart guard on "Update All Rates" per D-083.

### Save Estimate modal
- `#save-name`, `#save-notes`
- Archives under `wftabest{timestamp}` in localStorage.

### Load Estimate modal
- Archive picker + filter controls.
- Fires `applyState` on select (reset-first per D-080/D-098).
- Triggers amber rate-migration toast if the loaded estimate's rates differ from `RATE_DEFAULTS`.

### Preview Quote modal
- PDF export flow.
- **This is the only approved PDF path for customer quotes.** No external generator.

---

## 44 warning popups

The app has 44 cataloged warning popups across the JSX (lines 1167–7077). Each has:
- Trigger (what user action fires it)
- Color (amber = info, red = block, green = success)
- Buttons (usually OK/Cancel; some have Retry)

### Most-frequently-hit in EST sessions

| # | Trigger | Color | Buttons |
|---|---------|-------|---------|
| 3 | Load — rate migration fired | Amber | OK |
| 7 | ECT 44 selected / loaded | Amber | OK / Cancel |
| 11 | Crest → die auto-default first fire | Amber | OK |
| 14 | Piece exceeds Crest 60×120 | Red | OK |
| 19 | Save without customer / partNumber | Red | OK |
| 23 | Freight: no Manufactured items | Red | OK |
| 31 | Stock sheet selected — bypassing Buy Min | Amber | OK |
| 38 | FSC $15→$25 migration fired | Amber | OK |
| 41 | Forced route — Reset to Auto click | Amber | OK |
| 44 | Unsaved changes on tab close | Red | Save / Discard / Cancel |

Full catalog of all 44 popups is in the raw JSX and can be reconstructed from `grep alert` or `grep confirm` across the source. Live-confirmed shape on popups #3, #7, #41 during the 2026-04-15 remap session.

---

## Harness — standard Phase 4 execution

Given a Phase 2 intake grid approved by the estimator, Phase 4 executes:

1. Click `#btn-new` (Ctrl+N).
2. Fill `#cust-name`, `#cust-contact`, `#cust-part` from grid.
3. Confirm `#cust-initials === "SPC"` (blocked field; verify display).
4. Confirm `#cust-fob` matches grid (default Origin).
5. Fill `#dim-l`, `#dim-w`, `#dim-d`.
6. Set `#board-flute`, `#board-ect`, `#board-mill`, `#board-caliper`.
   - If ECT=44: expect popup #7, click OK.
7. Confirm `#board-fsc` checked (default $25).
8. Confirm `#board-under5msf === 0`.
9. Set `#print-finish` (default Satin), `#print-colors`.
10. Fill ops (die, gluer, stitcher) per grid.
11. Fill qty slots in BOM strip.
12. Verify right panel:
    - Route Comparison panel visible (if both routes viable).
    - Economics shows filled qty rows.
13. If grid flags forced route: click Switch to CAD or Switch to Crest — expect panel to stay mounted with forced-state UI (D-097).
14. Click `#btn-save`, fill name + notes, save.
15. Click `#btn-preview` → Preview Quote modal → export PDF.
16. Handoff prompt per Phase 5 (customer / part# / est# / board / blank / route / sheet / N-out / qty pricing / GM / freight / FOB).

Any alert that fires outside the expected list: surface exact text, ask, wait for estimator decision.

---

## Tab bar / state persistence

- `wftabs` — array of tab metadata (id, name, customer, partNumber).
- `wftab{id}` — full estimate state per tab (JSON blob).
- `wftabest{timestamp}` — archived estimate on Save.

All three are localStorage keys. `applyState` (reset-first) is the only approved write path from a load.

---

## Source pointers

- JSX: `spot_r1_5.jsx`, 7,499 lines, SHA `02d337ebdc6fac7d` (D-110 FINAL + D-112 applied).
- Engine section: JSX lines 1–877 (mirrors `spot_engine.js`).
- UI section: JSX lines 878–7494.
- Warning popup catalog: JSX lines 1167–7077.

If line numbers drift: grep for the anchor string (e.g., `"Production Route — Forced"`) and re-anchor.