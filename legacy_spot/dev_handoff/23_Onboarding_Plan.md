# 23 — Onboarding: First Week, First Month

A structured progression for a new dev landing on SPOT cold. Designed for someone with React + Node experience but no exposure to corrugated packaging or SPC's internal conventions.

---

## Day 0 — Pre-work

Before your first session:
- Read this handoff package start to finish. Files 00 → 23. Skim the deep dives (17–22), fully read the rest.
- Skim `02_RELEASE_HISTORY.md` — at minimum the last 10 releases. You'll see SPOT's evolution and current state.
- Look at `01_OPEN_ISSUES.md` — these are the active items. Don't try to fix anything yet; just absorb.
- Glance at `WF_Quoting_Tool_Test_Data.xlsx` — that's the fleet calibration baseline. 785 jobs of real data.

---

## Day 1 — Get it running

### Goal: SPOT is running on your machine and you've made a working quote.

1. **Install Node.js 18+** if you don't have it.
2. **Clone or unzip the source** into `C:\SPOT_R1.6.5.1` (or your equivalent path).
3. **Drop the API key**:
   - Create `anthropic_key.txt` in the install root.
   - Paste a working Anthropic API key (single line, no quotes).
   - Alternatively: create `.env` with `ANTHROPIC_API_KEY=sk-ant-...`.
4. **Run install:**
   ```
   install.bat
   ```
5. **Open SPOT:**
   ```
   OPEN_SPOT.bat
   ```
   Or just navigate to `http://localhost:3100` in Chrome after starting `node spot_server.js`.

### First quote

In the UI, manually enter:
- Customer: any name from customerList.csv
- One-up: 12 × 9
- Order qty: 10000
- Board grade: 32 ECT
- Flute: B
- Print: 4 colors, 1 side

Click through the panels. Note the route, cost, sell, GM. Save the estimate.

### Verify your install

- Tab dropdown shows your saved quote.
- Reloading the page restores the quote.
- Console has no red errors.

If anything fails, see file 22 (Troubleshooting) sections S1–S4 and U1.

---

## Day 2 — Trace the calculation

### Goal: predict the number SPOT produced and verify on paper.

Pick your Day 1 quote. Open it. Then:

1. Open file 17 (Pricing Walkthrough).
2. Step through each of the 16 steps using the actual values from your quote.
3. Compare your computed cost-per-piece against SPOT's displayed cost-per-piece.

If they match: you understand the engine.  
If they don't: identify which step diverged. That's your bug — likely in your calculation, not SPOT's.

### Side exercise

Change ONE input — flute B → flute E. Predict what changes:
- Routing decision (Bobst eligible now)
- Sheet selection (different APPROVED_SHEETS match)
- Press cost (board changes)

Verify in SPOT.

---

## Day 3 — Read the engine

### Goal: navigate `spot_engine.js` without a map.

Open `spot_engine.js` and read it top to bottom. Use file 09 as a guide if you get lost.

Pay particular attention to:
- L7 `ENGINE` constant — the calibration data
- L148 `RATE_DEFAULTS` — runtime rate values
- L227 `calcBoard` — board cost
- L336 `autoSelectSheet` — sheet picking
- L559 `autoRoute` — route decision
- L662 `calcWF` — press cost
- L887 `calcBoardWeight` — for freight

Don't memorize. Just know where each piece lives.

### Side exercise

Find every place `ENGINE.base_matrix` is used. List them in a comment somewhere — you'll need this knowledge later.

---

## Day 4 — Read the JSX (sections)

### Goal: navigate `spot_r1_5.jsx` (9,007 lines) without scrolling aimlessly.

Open file 07 (JSX Codebase Walkthrough) alongside the actual JSX. The file divides the JSX into sections via `═══` comment dividers. Search for `═══` in the JSX to find them.

Sections to internalize:
- **ENGINE block** — mirror of `spot_engine.js`
- **State setup** — useState hooks for tab, item, prod
- **useMemo for derived computations** — these run on every render
- **Top-level component** — `function App()`
- **Tabs management** — addTab, switchTab, removeTab
- **Save/Load** — `saveEstimate`, `applyState`, `applyItemState`
- **Panels** — Customer, Spec, Print, CAD, Crest, Freight, etc.
- **Qty pricing grid** — bottom of the file

Don't try to understand every line. Map the territory.

---

## Day 5 — Run a regression

### Goal: validate that SPOT produces correct numbers across the fleet.

1. Open `fleet_compare.js`.
2. Run it: `node fleet_compare.js`.
3. The output is a CSV comparing SPOT-computed totals against the iQuote baseline from `WF_Quoting_Tool_Test_Data.xlsx`.
4. Verify the fleet deltas match calibration targets (currently +6.55% cost, +8.30% sell).

If they don't match: something has drifted. Compare your JSX ENGINE block against your `spot_engine.js`. Investigate.

### Side exercise

Find 3 jobs in the CSV with the largest deltas. Open each in SPOT (load by JSON). Identify why SPOT differs from iQuote. Usually one of:
- Different board (ECT fallback handling)
- Different route (CAD vs Crest threshold)
- Different freight (SPCOC zone vs UTS)
- Different GM (curve transition)

This builds intuition.

---

## Week 2 — Make a change

### Goal: ship a small, low-risk change end-to-end.

Pick something **trivial** from `01_OPEN_ISSUES.md`:
- A typo in a UI label
- A documentation update
- A small log message addition

DO NOT touch calibration or business rules yet.

### The full loop

1. Read the relevant control table entry in `DEV_SPOT_R1_5_Control_Tables.md`.
2. Read the relevant test cases in `TEST_SPOT_R1_5_Testing_Guide.md`.
3. Make the change in `spot_r1_5.jsx` (or wherever).
4. Rebuild: `node build_spot_r1_5.js`.
5. Run regressions: REG-01 through REG-11.
6. Update `02_RELEASE_HISTORY.md` — append a new entry, never edit past entries.
7. Move the item from `01_OPEN_ISSUES.md` to release history.
8. Commit (if you're using git; SPOT historically hasn't).

### Lessons you'll learn the hard way

- Forgetting to update the version sentinel (Pattern 9 in file 21).
- Forgetting the JSX/engine mirror (Pattern 8).
- Doing a state merge instead of reset-first (Pattern 2).
- The thing that worked yesterday breaks today because PK drifted.

These are normal. Read file 22 when stuck.

---

## Weeks 3-4 — Take ownership of a subsystem

### Goal: become the person who knows one subsystem deeply.

Pick one of:
- **RFQ Parser** — read file 19, study `spot_server.js` parser endpoints, watch parse flows in the wild
- **Routing engine** — read file 18, study `autoRoute` and `compareRoutes`, predict route flips for many test inputs
- **Multi-Part** — read file 20, work through several Matched Set vs Individual scenarios
- **Calibration** — read file 06 and `DEV_Calibration_Framework_v2.md`, understand the fleet methodology
- **Save/Load + State** — read file 11, master the localStorage schema, debug a real corruption case

Spend 2 weeks understanding the subsystem inside and out. Read every related D-### in release history. Write a one-pager on it for the team (or add to this handoff).

---

## Month 2 — Land a real fix

### Goal: take a real open issue from `01_OPEN_ISSUES.md` and close it.

By now you should be able to:
- Read the issue description and identify the affected subsystem.
- Pull up the relevant deep-dive doc and source files.
- Form a hypothesis about the cause.
- Reproduce the bug locally.
- Write the fix.
- Verify with regression tests.
- Ship.

If you can do this on your own, you're past onboarding.

---

## Calibration training (when ready)

**Do not attempt calibration changes until you've shipped at least 5 issues.**

Calibration changes are high-stakes. A wrong number ships across hundreds of quotes before anyone notices. The process:

1. Document the proposed change in `DEV_D<num>_Design_Decision.md`.
2. Identify the fleet-level impact — run `fleet_compare.js` with the change against the 785-job baseline.
3. Project the impact on margin and sell deltas.
4. Discuss with Michael BEFORE shipping.
5. Update Control Tables alongside the source change.
6. Append to release history with the fleet delta data.

See file 06 (Calibration Methodology) for the full playbook.

---

## What "ready" looks like

You're ready to operate independently when:

1. You can predict SPOT's number on paper for any input.
2. You can read a release history entry and visualize what changed.
3. You know which file to look at for any reported bug.
4. You've shipped at least 5 issues end-to-end.
5. You can train the next person on a subsystem.

This usually takes 6-8 weeks of focused work. Faster if you're already deep in React + Node; slower if the packaging domain is brand new.

---

## What Michael expects

From session protocol observation:
- **Terseness.** No "I'll go ahead and..." preamble. Just do it.
- **Files over inline.** Don't paste 200 lines of code in chat. Create the file and present it.
- **Audit before coding.** SHA audit, ledger status check, drift identification BEFORE making changes.
- **Decisions are decisions.** Once a design call is made, execute it. Don't re-litigate.
- **No half-fixes.** Complete files, not patches with "you'll need to also change X" caveats.
- **Honesty about drift.** If PK has diverged from your local state, say so. Don't paper over it.

When in doubt, default to making the simplest change that works, document it, and ship.

---

## Resources you'll keep coming back to

- `01_OPEN_ISSUES.md` — the always-current TODO list
- `02_RELEASE_HISTORY.md` — what was done, when, why
- `DEV_SPOT_R1_5_Control_Tables.md` — every calibrated number with rationale
- `EST_SPOT_Quoting_Rules.md` — the 10 hard rules
- `EST_SPOT_Intake_Harness.md` — the data shape contract
- `EST_SPOT_Canonical_Terms.md` — SPC vocabulary registry
- Files 17-22 in this handoff — the deep dives

Bookmark these. You'll be in them daily.

---

**End of handoff package.** Welcome aboard.
