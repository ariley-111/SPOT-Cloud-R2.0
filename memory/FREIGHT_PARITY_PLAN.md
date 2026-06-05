# Freight Dashboard + Allocation — Legacy Parity Build Plan

> User mandate: match legacy EXACTLY. No interpretation, no "improvement", no
> options. Whatever legacy does, cloud does identically.

## Source of truth
- `/app/legacy_spot/spot_r1_5.jsx`
  - `updateAllFreight` (~L4313): combined shipment quote + per-qty-tier allocation
  - `fetchFreightRate` (~L4276): per-slot UTS rate per qty
  - `allocateJobCost` (L897): MSF / Equal / By Weight allocation
  - Freight Dashboard render block — search for "SHIP INDIVIDUALLY" / "SHIP TOGETHER"

## Step 1 — Port legacy `updateAllFreight` 1:1
- Cloud `/app/frontend/src/components/spot/RightDashboard.jsx::updateFreight`
  currently sends ONE consolidated UTS quote and allocates by board-lbs.
- LEGACY behavior: for each qty tier (from `state.qtys`):
  1. Compute combined-shipment weight at THAT qty (all components at that qty)
  2. Fetch UTS rate for that qty's combined weight → store in
     `jobFreightBySlot[slot]` (per legacy state)
  3. Within that qty tier, allocate to each component by weight share
  4. Write each component's per-qty share into `bomItem.state.freightByQty[slot]`
- In MP-Individual where each component has only ONE qty, the result is:
  each component gets its share at ITS qty-tier load (Tray1X@42 in a "all 3
  components at qty 42" simulated shipment, etc.). This is what produces
  legacy's $61 / $55.50 / $161.23 pattern in the user's record.

## Step 2 — Engine reads `freightByQty` per slot
- `/app/backend/engine/runner.py` already supports `freightByQty` (see L62-71).
- Verify per-component pricing route picks the correct slot's freight when
  rendering Quote Table rows. Should already work — the bug was upstream in
  what value got written to state.

## Step 3 — Build FreightDashModal (cloud port of legacy modal)
- New file `/app/frontend/src/components/spot/FreightDashModal.jsx`.
- Layout EXACTLY matches the screenshot the user provided:
  1. Top header: title + Ship-To ZIP + components + qty count + close
  2. FOB / Type / Markup tile row
  3. "SHIP INDIVIDUALLY vs. SHIP TOGETHER" comparison card with savings bar
     + recommendation banner (with `Per Item` / `Per Job` switch buttons)
  4. QTY filter chips (one per tier + "All")
  5. ITEMS filter chips (one per component + "All")
  6. Per-qty-tier breakdown panels (one per qty tier):
     - Header: `Qty N · X lbs total · Y skids · Z ft  ·  Raw: $A  w/ Markup: $B`
     - Table: Component / Qty / Product / Skid / Total Wt / Wt % / Skids / Ft / Freight / w/ Markup
     - Footer: Total row
  7. CARRIER OPTIONS table at bottom (PITT OHIO ACTIVE + FEDEX / WARD / R&L
     etc with `Use` button to switch carrier)
- Wire `btn-freight-dash` button (already exists in RightDashboard) to open
  this modal.

## Step 4 — Wire Quote Table Freight column to per-qty allocation
- After Step 1 writes per-slot freight to each `bomItem.state.freightByQty`,
  the engine's `run_estimate` already picks `freightByQty[slot]` correctly.
- Quote Table component layout renders `r.freightLine` which will then reflect
  the per-qty-tier-share value matching legacy.

## Acceptance criteria
On record SA-260604-155037 (Jamestown / Luva Bella Winery) after clicking
Update All:
- Component 1 (Tray 1X qty 42) Freight column = **$63.68** (±$0.50)
- Component 2 (Tray 2X qty 168) Freight column = **$68.84** (±$0.50)
- Component 3 (Display 3pack qty 2,352) Freight column = **$161.23** (±$1.00)
- Per-Item Freight (sum) row in Job Totals = **$293.75** (±$2)
- Freight Dashboard modal opens via `btn-freight-dash`, shows the layout in
  the user's screenshot exactly, including all 4 carrier rows with Use buttons.

## Out of scope for this build
- Substrate flute parity (separate P0).
- BOM table-view redesign (separate P0 UI).
- Matched Set + PDF audit (separate P0).
