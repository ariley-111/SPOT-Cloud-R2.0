# SPOT R1.5 — Comprehensive UI Test Suite

> **Purpose:** Full functional test of every UI element, computation path, and user interaction in SPOT
> **Execution:** Chrome on localhost:3100 via Claude in Chrome MCP tools
> **Prerequisites:** SPOT running via `node spot_server.js`, Chrome maximized
> **Last Updated:** April 25, 2026 (D-110 FINAL calibration values: GM curve, press/CAD rates updated; SUITE 13 TCs renumbered SP-001–SP-009 to resolve collision with chowder TCs 018–022)

---

## Test Protocol

For each test:
1. Set up the required state (load JSON, click buttons, enter values)
2. Verify the expected UI output (text, colors, pills, values)
3. Log PASS/FAIL with actual values
4. Reset or undo before next test

### Helper Functions (JavaScript)
```javascript
// Set input by label
function sv(label, value) {
  for (const lb of document.querySelectorAll('label')) {
    if (lb.textContent.trim().startsWith(label)) {
      const inp = lb.parentElement?.querySelector('input');
      if (inp) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, value);
        inp.dispatchEvent(new Event('input', {bubbles: true}));
        inp.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
      }
    }
  }
  return false;
}

// Click button by label context
function cb(label, text) {
  for (const lb of document.querySelectorAll('label')) {
    if (lb.textContent.trim() === label) {
      for (const b of lb.parentElement.querySelectorAll('button')) {
        if (b.textContent.trim() === text) { b.click(); return true; }
      }
    }
  }
  return false;
}

// Read quote table row
function readRow(idx) {
  const t = document.querySelector('table');
  const rows = Array.from(t?.querySelectorAll('tr') || []);
  if (rows.length <= idx) return null;
  return Array.from(rows[idx].querySelectorAll('td')).map(c => c.textContent.trim());
}
```

---

## SUITE 1: Simple Estimate — New Item Setup

### T1.01: Create New Estimate
- **Action:** Click `+` button
- **Verify:** New tab appears, title shows new estimate number `MM-YYMMDD-HHMMSS`
- **Verify:** Quote type defaults to "Simple"
- **Verify:** Print defaults to "Satin" (per D-105 flip, 2026-04-21; was Gloss pre-D-105)
- **Verify:** All qty slots empty (placeholder "—")
- **Verify:** Board defaults: Flute=B, Grade=200, OL=Kraft, IL=Kraft, Medium=None

### T1.02: Enter Dimensions
- **Action:** Set Width=24, Length=36
- **Verify:** Board status bar appears with sheet/layout/route info
- **Verify:** "auto → CAD" or "auto → Crest" shows in route display
- **Verify:** Waste % displayed

### T1.03: Enter Quantities
- **Action:** Set Qty slot 1=100, slot 2=500, slot 3=1000
- **Verify:** Quote table populates with 3 active rows
- **Verify:** "3 of 3 active" indicator
- **Verify:** Each row shows: Sell/Ea, GM%, GM$, Total, $/MSF, Cost/MSF, Sheet, #Out, Route

### T1.04: Auto-Fill Quantities
- **Action:** Set slot 1=100, click "Auto-Fill"
- **Verify:** Remaining slots fill with 250, 500, 1000 (or similar progression)

### T1.05: Add 6th Qty Slot
- **Action:** Click "+Qty"
- **Verify:** 6th qty input appears
- **Verify:** Can enter value and it computes

### T1.06: Change Board Specs
- **Action:** Click Flute=E, Grade=ECT 44, OL=Kemi-Lite
- **Verify:** Board status updates to "ECT 44 · E · Kemi/Kraft"
- **Verify:** Sheet selection changes (E flute has different sizes — no 63×98)
- **Verify:** Pricing recalculates

### T1.07: Dimension Mode Toggle
- **Action:** Click "Sheet Size" mode
- **Verify:** Inputs change to sheet dimensions
- **Action:** Click "One-Up" mode
- **Verify:** Returns to blank dimensions

### T1.08: Swap Width/Length
- **Action:** Enter W=24, L=36, then click Swap button
- **Verify:** W=36, L=24
- **Verify:** Layout may change (corrugation direction flipped)

---

## SUITE 2: Board Selection & Status Bar

### T2.01: Stock Sheet — Direct Match
- **Setup:** 24×36, 200# B, Kemi-Lite/Kraft
- **Verify:** Board line shows "BOARD" with single line
- **Verify:** No fallback message, no pills

### T2.02: Grade Fallback — ECT 32 → 200#
- **Setup:** 24×36, ECT 32 B, Kemi-Lite/Kraft
- **Verify:** SPEC line: "ECT 32 · B · Kemi/Kraft"
- **Verify:** RUNNING line: "200 · B · Kemi/Kraft"
- **Verify:** Green pill: "✓ 200# stock"
- **Verify:** "200# meets ECT 32 spec" message

### T2.03: Mullen Upgrade — 150# → 200#
- **Setup:** 12×18, 150# B, Kraft/Kraft
- **Verify:** Green pill: "Priced on 200# sheets — meets 150 spec" (REG-02)

### T2.04: No Stock — Bleached White
- **Setup:** 24×36, 200# B, Bleached White/Kraft
- **Verify:** Custom order indicator
- **Verify:** Buy Min triggered (Bleached never in stock)

### T2.05: No Stock — 275# Grade
- **Setup:** 24×36, 275# B, Kraft/Kraft
- **Verify:** No stock sheets available for 275#
- **Verify:** Custom order path

### T2.06: E Flute Sheet Availability
- **Setup:** 24×36, 200# E, Kraft/Kraft
- **Verify:** Available sheets are 48×96, 60×120, 63×63, 63×126
- **Verify:** 63×98 is NOT available

### T2.07: Oversize — Custom Order
- **Setup:** 62×62, 200# B, Kraft/Kraft
- **Verify:** No stock sheet fits (trim pushes past 63)
- **Verify:** Custom order indicator

### T2.08: Board Substitution — Accept
- **Setup:** ECT 32 item with fallback showing
- **Action:** Verify "✓ Substitution approved" displayed
- **Action:** Click "Force original spec"
- **Verify:** Changes to "CUSTOM ORDER" with Buy Min

### T2.09: Board Substitution — Force Back
- **Action:** After forcing, click to revert
- **Verify:** Returns to stock substitution approved state

### T2.10: Sheet Library
- **Action:** Click "Sheet Library" button
- **Verify:** Modal opens with stock sheet browser
- **Verify:** Shows available sheets for current board spec

---

## SUITE 3: Routing

### T3.01: CAD Route (Under 8 Hours)
- **Setup:** 12×18, rule=100", qty=100
- **Verify:** Route shows "auto → CAD"
- **Verify:** CAD hours displayed (< 8h)

### T3.02: Crest Route (Over 8 Hours)
- **Setup:** 12×18, rule=100", qty=5000
- **Verify:** Route changes to "Crest"
- **Verify:** Crest sheet size shown (≤60×120)

### T3.03: Saber + D/C Fallback
- **Setup:** 61×124, rule=500", qty=500
- **Verify:** Route shows "Saber + D/C" (piece too big for Crest)

### T3.04: No Sheet (Pair Rule Exceeded)
- **Setup:** 65×70
- **Verify:** No sheet available
- **Verify:** Graceful error or "No sheet" message

---

## SUITE 4: Pricing & Margins

### T4.01: GM Curve Verification
- **Setup:** For each MSF tier, create an item with appropriate qty/size
- **Verify:** GM% in quote table matches the tier:
  - 0-1 MSF: 50%
  - 1-3 MSF: 37%
  - 3-5 MSF: 32%
  - 5-9 MSF: 27%
  - 10-24 MSF: 25%

### T4.02: Grade Adder Delta
- **Setup:** Quote same piece at 200# then at 250#
- **Verify:** Material cost difference = $31/MSF (250# adder $46 - 200# adder $15)

### T4.03: Die Charge — Separate Line
- **Action:** Set Die Treatment = "Line", Die Cost = $500
- **Verify:** $500 × 1.15 = $575 appears as line item
- **Verify:** Sell/Ea does NOT include die (separate)

### T4.04: Die Charge — Amortize
- **Action:** Set Die Treatment = "Amort", Die Cost = $500
- **Verify:** $575 embedded in sell price
- **Verify:** No separate line item

### T4.05: Freight Charge — Line vs Amort
- **Action:** Set Freight Treatment = "Line", cost = $200
- **Verify:** $200 × 1.15 = $230 as line item
- **Action:** Switch to "Amort"
- **Verify:** $230 embedded, no line item

### T4.06: Prepress — Auto Embedded
- **Verify:** Prepress defaults to "Auto"
- **Verify:** "$50 embedded" displayed
- **Verify:** No line item, no markup

### T4.07: Misc Charge
- **Action:** Click "+ Charge", add "Sampling" $100
- **Verify:** $100 × 1.15 = $115 appears

---

## SUITE 5: Print & Finishing

### T5.01: No Print
- **Setup:** Print = No
- **Verify:** $0 press cost, $0 ink in cost buildup

### T5.02: Gloss Print
- **Setup:** Print = Yes, Mode = Gloss, 1-Sided
- **Verify:** Press speed = 75 sh/hr in cost calculation (D-110: Gloss/Satin equalized)
- **Verify:** Ink = $0.05/sqft × sheet area

### T5.03: Satin Print
- **Setup:** Print = Yes, Mode = Satin, 1-Sided
- **Verify:** Press speed = 75 sh/hr (D-110: Gloss/Satin equalized)

### T5.04: 2-Sided Print
- **Setup:** Print = Yes, Gloss, 2-Sided
- **Verify:** Side 2 cost = Side 1 × 0.60

### T5.05: White Ink
- **Setup:** Print = Yes, White Ink = Yes
- **Verify:** White cost = 0.50 × (material + ink + press)

### T5.06: Hand Gluing
- **Action:** Enable Hand Gluing, 1 joint, Standard
- **Verify:** Glue cost appears in cost buildup
- **Verify:** "Gluing" pill on BOM row (multi-part)

### T5.07: Hand Stripping
- **Action:** Enable Hand Stripping, Standard
- **Verify:** Strip cost in cost buildup

### T5.08: Tape
- **Action:** Enable Tape, Clear, 2 ft/pc
- **Verify:** Tape cost = qty × 2 × $0.03

---

## SUITE 6: Multi-Part (Matched Set)

### T6.01: Create Multi-Part Estimate
- **Action:** Click "Multi-Part" toggle
- **Verify:** BOM Builder section appears
- **Verify:** "Edit in BOM Builder" button visible

### T6.02: Add Components
- **Action:** Click "+ Item" to add 3 components
- **Verify:** BOM table shows 3 rows
- **Verify:** Each row clickable to select as active

### T6.03: Set Qty Slots
- **Action:** Enter set qtys: 10, 25, 50, 100
- **Verify:** All components compute at these set quantities

### T6.04: Matched Set Economics
- **Verify:** Right panel shows "Matched Set" label
- **Verify:** Sell Total, Sell/Set, Margin %, Total Cost, Cost/Set displayed
- **Verify:** All components share the same GM% per tier

### T6.05: Active Component Economics
- **Action:** Click different BOM rows
- **Verify:** Right panel "Active Component" updates with that item's economics
- **Verify:** Cost Buildup shows material/press/cutting breakdown for selected item

### T6.06: BOM Pills
- **Verify:** Each BOM row shows status pills:
  - Routing: "Auto→CAD" or "Crest"
  - Print: "Gloss 1S" or "No Print"
  - Die: "No Die" or die cost
  - Freight: "Frt ✓" if verified
  - Prepress: "PP Auto"
  - Gluing: "Gluing" if enabled

### T6.07: Lock/Unlock Items
- **Action:** Click lock icon on an item
- **Verify:** Item shows locked indicator
- **Action:** Click "🔒 Lock All"
- **Verify:** All items locked

### T6.08: Copy Active to Standalone
- **Action:** Click "Copy active item into a new standalone estimate tab"
- **Verify:** New tab opens with that item as a Simple estimate
- **Verify:** All specs, dimensions, qtys carried over

---

## SUITE 7: Freight Integration

### T7.01: FOB Origin (Default)
- **Verify:** FOB = "Will-Call" or freight panel minimal
- **Verify:** No freight costs in quote

### T7.02: FOB Destination — Get Rate
- **Action:** Click "Ship", enter ZIP = 19134, click "Update All"
- **Verify:** UTS API calls fire (check network tab)
- **Verify:** Freight amounts populate per qty tier
- **Verify:** "Freight verified — OK to quote" message

### T7.03: ZIP Change Warning (REG-05)
- **Action:** Change ZIP from 19134 to 90210
- **Verify:** Red warning: "⚠ ZIP: 19134→90210"
- **Verify:** "Update" and "Dismiss" buttons appear
- **Verify:** Freight verified status clears

### T7.04: Update All Freight (REG-04)
- **Action:** Click "Update All" after ZIP change
- **Verify:** API calls fire for all items × qty tiers
- **Verify:** New rates populate
- **Verify:** Freight verified restores

### T7.05: Stale Freight on Preview (REG-06)
- **Action:** Change ZIP without updating, click "Preview Quote"
- **Verify:** Action toast: "ZIP changed — update before quoting"
- **Verify:** "Update All Freight" / "Later" buttons
- **Verify:** Preview NOT blocked (opens behind toast)

### T7.06: Freight Math (REG-03)
- **Verify:** Cost buildup shows raw carrier cost + 15% markup = displayed amount
- **Verify:** No double markup (server sends raw, client applies 15%)

### T7.07: Combined Weight (REG-07)
- **Setup:** Multi-part with freight
- **Verify:** Set total freight uses combined weight, not 6× individual minimums

### T7.08: Freight Dashboard
- **Action:** Click "📦 Dashboard"
- **Verify:** Dashboard opens showing per-item and combined freight comparison

---

## SUITE 8: Preview Quote

### T8.01: Simple Item Preview
- **Setup:** Simple estimate with dims, qtys, no charges
- **Action:** Click "Preview Quote"
- **Verify:** Quote preview modal opens
- **Verify:** Shows: Quote#, Date, Customer, Valid Until
- **Verify:** Qty/Each/Per M/Total pricing table

### T8.02: Simple with Charges
- **Setup:** Add die + freight as line items
- **Verify:** Die and Freight columns appear in preview table

### T8.03: Matched Set Preview (REG-09, PQ-03)
- **Setup:** Multi-part Matched Set
- **Action:** Click "Preview Quote"
- **Verify:** Component spec table (Board, Blank, Pcs/Set)
- **Verify:** Per-component pricing grid (all items × all qty columns)
- **Verify:** Price/Set row totals
- **Verify:** Freight row
- **Verify:** QUOTE TOTAL row

### T8.04: Charge Display Modes
- **Verify:** "Lump Sum" / "By Type" / "By Part" toggle buttons
- **Action:** Click each and verify charge presentation changes

### T8.05: Spec Drift Warning (REG-11)
- **Action:** Change active item's grade after loading
- **Action:** Click "Preview Quote"
- **Verify:** Toast: "⚠ [item]: Board grade is 'X' but was loaded as 'Y'"
- **Verify:** "Fix It" and "Print Anyway" buttons
- **Action:** Click "Fix It"
- **Verify:** Grade reverts, spec drift clears

### T8.06: Export/Print
- **Action:** Click "Export" in preview
- **Verify:** Export function triggers
- **Action:** Click "⎙ Print"
- **Verify:** Print dialog opens

---

## SUITE 9: Save/Load

### T9.01: Save to Archive
- **Action:** Click "Save"
- **Verify:** Estimate saved to localStorage
- **Verify:** Toast confirmation

### T9.02: Save with JSON Export
- **Action:** Enable JSON checkbox, click "Save"
- **Verify:** .json file download triggered

### T9.03: Load from Archive
- **Action:** Click "Load"
- **Verify:** Modal opens with archive table
- **Verify:** Search bar functional
- **Action:** Click an archived estimate
- **Verify:** Estimate loads into active tab

### T9.04: Load from File
- **Action:** In Load modal, use "Load from File"
- **Verify:** File picker accepts .json
- **Verify:** JSON loads and populates all fields

### T9.05: Rate Migration on Load
- **Setup:** Load an estimate saved with old rates (e.g., Inca $650)
- **Verify:** Amber toast: "Attention: costs updated to current rates"
- **Verify:** All Advanced Controls overridden to RATE_DEFAULTS
- **Verify:** Sell prices, markups, item costs NOT changed

### T9.06: Delete from Archive
- **Action:** Click "Del" on an archived estimate
- **Verify:** Estimate removed from archive

---

## SUITE 10: Advanced Controls

### T10.01: Rate Visibility in Estimator Mode
- **Action:** Click mode toggle (estimator mode)
- **Verify:** Advanced Controls section hidden
- **Verify:** All other sections still visible

### T10.02: Reset All to Default
- **Action:** Change several rates (Inca, CAD, etc.)
- **Action:** Click "Reset All Values to App Default"
- **Verify:** All 30 RATE_DEFAULTS restored
- **Verify:** Pricing recalculates

### T10.03: Ink Rate Locked
- **Verify:** Ink rate input shows 🔒 indicator
- **Verify:** Field is non-editable (or shows locked state)

### T10.04: GM Tier Editing
- **Action:** Change 0-1 MSF tier from 50% to 55%
- **Verify:** Pricing updates for items in that tier
- **Action:** Click "Reset Margins to App Default"
- **Verify:** Returns to 50%

---

## SUITE 11: Edge Cases & Error Handling

### T11.01: Zero Dimensions
- **Action:** Enter W=0, L=0
- **Verify:** No crash, graceful "Enter dimensions" message

### T11.02: Negative Quantity
- **Action:** Enter qty = -5
- **Verify:** Ignored or error, no crash

### T11.03: Very Large Quantity
- **Action:** Enter qty = 100000
- **Verify:** Computes without crash, route likely Crest

### T11.04: Empty Fields
- **Action:** Clear all fields and try to Preview
- **Verify:** No crash, appropriate empty state

### T11.05: Rapid Tab Switching
- **Action:** Click between estimate tabs quickly
- **Verify:** No data corruption, correct estimate loads each time

### T11.06: Undo (5 Levels)
- **Action:** Make 5 changes, click Undo 5 times
- **Verify:** Each undo restores previous state
- **Verify:** Undo button disables after 5 levels

---

## SUITE 12: Theme & Display

### T12.01: Dark Mode Toggle
- **Action:** Click ☀/🌙 button
- **Verify:** All colors invert appropriately
- **Verify:** All text remains readable
- **Verify:** Charts/pills maintain contrast

### T12.02: Section Expand/Collapse
- **Action:** Click "Collapse" to close all sections
- **Verify:** All sections collapsed
- **Action:** Click "Expand" to open all
- **Verify:** All sections expanded

### T12.03: Copy Row
- **Action:** Select a qty row, click "Copy Row"
- **Verify:** Row data copied to clipboard

### T12.04: Export CSV
- **Action:** Click "Export CSV"
- **Verify:** CSV file downloads with quote table data

### T12.05: Cost Report
- **Action:** Click "Cost Report"
- **Verify:** Detailed cost breakdown report generates

---

## Execution Checklist

| Suite | Tests | Priority | Dependencies |
|-------|-------|----------|-------------|
| 1: Simple Setup | 8 | P0 | None |
| 2: Board Selection | 10 | P0 | Suite 1 |
| 3: Routing | 4 | P0 | Suite 2 |
| 4: Pricing | 7 | P0 | Suite 1 |
| 5: Print/Finishing | 8 | P1 | Suite 1 |
| 6: Multi-Part | 8 | P0 | Suite 1 |
| 7: Freight | 8 | P1 | Suite 1, UTS running |
| 8: Preview Quote | 6 | P1 | Suite 1 or 6 |
| 9: Save/Load | 6 | P1 | Suite 1 |
| 10: Advanced Controls | 4 | P2 | Suite 1 |
| 11: Edge Cases | 6 | P2 | Suite 1 |
| 12: Theme/Display | 5 | P2 | Suite 1 |
| **TOTAL** | **80** | | |

### Regression Quick-Run (after any code change)
Run these 11 tests in order: T2.03, T7.06, T7.03, T7.04, T7.05, T7.07, T6.04, T8.03, T2.04, T8.05, T2.02

---

## Math Verification Formulas

For any item, verify these computations against the cost buildup:

```
Material   = calcBoard(boardSpec, qty, isStock).total
Ink        = sheetArea × $0.05/sqft × printSheets
Press      = pressHours × $485/hr (75 sh/hr, Gloss/Satin equalized per D-110 FINAL)
Side 2     = pressCost × 0.60 (if 2-Sided)
White Ink  = 0.50 × (material + ink + press)
Makeready  = (5 or 15 sheets) × sheetCost
Spoilage   = 2% × printSheets × sheetCost
CAD Cut    = (ruleIn × pcsPerSheet × 1.15 ÷ 650 in/min + 15 min setup) ÷ 60 × $138/hr
Crest Cut  = (45 min setup + sheets ÷ 150 sh/hr) × $45/hr
Gluing     = qty × joints × minPerJoint × $23/hr ÷ 60
Stripping  = sheets × minPerSheet × $17/hr ÷ 60
Tape       = qty × ft/pc × $/ft

Total Cost = material + press + ink + white + side2 + cutting + gluing + stripping + tape + overhead
Sell       = totalCost / (1 - GM%)
Die        = dieCost × 1.15 (line or amortized)
Freight    = carrierCost × 1.15 (line or amortized)
Prepress   = $50 embedded (no markup)
```

---

## SUITE 13: Session Protocol Verification (April 14, 2026)

> **Note (2026-04-25):** TCs in this suite were renumbered from TC-014..TC-022 to SP-001..SP-009 to resolve a numbering collision with chowder TCs 018–025 (which cover D-080..D-098 code-path validation and are the canonical owners of those TC numbers). See `TEST_SPOT_R1_5_Chowder_Specs.md` for TC-018–025.

### SP-001: Post-Load Item Type — Manufactured on Fresh Inject

- **Setup:** Load a valid SPOT JSON via Chrome DataTransfer injection into a fresh (clean) page at localhost:3100
- **Spec:** Single-item JSON, type field = "Manufactured"
- **Expected:** BOM displays item as Manufactured
- **Verify:** `document.body.innerText` does not contain "Purchased" in BOM context; route and sell prices are present
- **Pass criteria:** Item type = Manufactured, no manual correction needed
- **Fail action:** Log to D-channel, investigate applyItemState type handling on load

### SP-002: Runner/SPOT Routing Parity — E-Flute ECT 32

- **Setup:** Run `spot_runner.js` with ECT 32 E-flute, oneUpW=15.3125, oneUpL=20.625, qty 250 and 500, Gloss 1-sided, hand strip, hand glue. Then load identical JSON into live SPOT R1.5.3.
- **Expected:** Both route to the same cutter (CAD or Crest)
- **Pass criteria:** Route matches AND sell price delta ≤ 5% across both qty breaks
- **Fail action:** Log as D-091, do not quote until resolved

### SP-003: PDF Source Gate — Preview Quote Only

- **Setup:** Run a complete single-item quote session through Chrome Phase 2
- **Expected:** The only PDF produced is from SPOT Preview Quote popup
- **Pass criteria:** No reportlab, fpdf, or externally-generated PDF file appears in /mnt/user-data/outputs/ or /home/claude/
- **Fail action:** Session failure — flag, document, add to repeat-offense log

### SP-004: Remap Prompt Fires on New Build

- **Setup:** Simulate a SPOT version increment (change the version string in spot_r1_5.jsx)
- **Expected:** On next quote session start, Claude identifies the version has changed and issues the remap prompt before proceeding
- **Pass criteria:** Remap prompt issued before any Chrome data entry
- **Fail action:** Log — harness executed on stale map, coordinates may be invalid

### SP-005: Harness 6-Call Completion — Single-Item Quote

- **Setup:** Run a standard single-item quote using the new harness sequence
- **Expected:** Quote complete in ≤ 6 Chrome tool calls
- **Pass criteria:** Navigate + 5 JS calls = quote PDF delivered
- **Fail action:** Log call count, identify which step required extra calls

### SP-006: Board Tile Entry — Liner Disambiguation

- **Setup:** Request a quote with Kla-White outside liner, Kraft inside liner
- **Expected:** Harness clicks correct liner buttons (outside Kla-White, inside Kraft) without cross-contamination
- **Pass criteria:** SPOT board spec shows "Kla-White / Kraft" after entry
- **Fail action:** Liner disambiguation by y-range is broken — remap board section

### SP-007: Crest Approval Modal — Harness Recovery

- **Setup:** Load an estimate where auto-route selects Crest, then force a route override to CAD via the harness
- **Expected:** "Crest Approval Required" modal fires. Harness detects modal and clicks the appropriate button ("Force CAD Instead" or "Acknowledge") without stalling
- **Pass criteria:** Modal is dismissed within 1 second, route updates to the forced selection, post-modal verification shows correct route in SPOT
- **Fail action:** Log which button was attempted, whether modal was detected, and whether the session stalled. If modal is not detected by harness, add modal polling to the pre-entry alert handler sequence

### SP-008: waitFreight() Resolves Under 15 Seconds

- **Setup:** Enter a valid destination ZIP, click Update in the freight panel, then call `waitFreight()`
- **Expected:** Freight calculation completes and `waitFreight()` resolves (returns true) within 15 seconds
- **Pass criteria:** `waitFreight()` returns true, "Calculating..." text is no longer visible, freight dollar amount is displayed
- **Fail action:** Log elapsed time. If >15s, investigate whether the freight API (spot_server.js) is responding slowly or whether the polling interval (500ms) is missing the completion signal. Never proceed to Preview Quote with "Calculating..." still showing

### SP-009: Harness Manual Entry — 8 Calls Max

- **Setup:** Run a full manual-entry quote (no JSON load) using the harness 8-call sequence: tabs_context → navigate → JS gate/initials → JS item setup fields → JS board tiles → JS production ops → JS quote header + freight → JS Preview Quote
- **Expected:** Complete quote delivered in ≤ 8 Chrome tool calls
- **Pass criteria:** PDF generated from Preview Quote, no extra exploratory DOM calls
- **Fail action:** Log call count and identify which step required splitting. If >8, determine whether field count exceeded single-call capacity or whether an unexpected alert added a call
