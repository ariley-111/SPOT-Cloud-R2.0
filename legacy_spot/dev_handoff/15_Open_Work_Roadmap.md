# 15 — Open Work Roadmap

A snapshot of what's still on the table as of R1.6.5.1 ship. The authoritative list is `01_OPEN_ISSUES.md` — this file groups items thematically and explains the scope.

---

## Near-term defects and features (R1.6.x)

### D-148 — HOW_TO_UPLOAD §5.4 quote-total target

Documentation drift. The HOW_TO_UPLOAD runbook in the test cycle had a quote-total target value that became stale after the cost-winner route shift introduced by D-123. Pure docs fix, no code change.

Status: open, documentation-only fix.

### D-150 — Folder-binding fragility

**Symptom:** SPOT resolves archive folders by exact-match `{custName}_{estNum}`. Test runbooks rename folders with prefixes (e.g., "TC1_") for organization. The resolver doesn't find them.

**Options on the table:**
- A. Discipline — test runbooks must not rename folders
- B. Estimator-side fallback — try exact match first, then estNum-only
- C. Mapping file — read `<archive>/folder_map.json` for aliases

Decision pending. Severity is Low because it only affects the test workflow, not production estimating. But it's affecting Cowork's verification cycle.

### D-138 — Inline asks[] resolution UI

When the parser returns ASK items, the diff modal currently shows them as a flat list. The improvement is inline resolution — clicking an ASK opens a dropdown or input, the estimator answers, the diff updates.

Spec is rough. Deferred to R1.7.

### D-142 — Spin Off feature fixes

The "Spin Off" flow (duplicate current quote into new tab) has two known issues:
- Data doesn't carry into the spun-off tab cleanly (some fields default rather than copy)
- Origin badge (clickable link back to source) isn't wired

Deferred to R1.6.x or R1.7.

---

## Design items (DEV-###)

### DEV-011 — ECT 44 popup guardrail

The D-098 leftover. ECT 44 grade selection should fire a popup warning the estimator that mill-substitute is manual. The popup code was scoped but never written.

Status: target R1.6 (overdue).

Implementation: amber popup #7 in the catalog. Triggers on `flute change → ECT 44` or `load with ECT 44`. Body explains the manual substitution; OK/Cancel buttons.

### DEV-012 — Visual layout/imposition viewer

A diagram showing how blanks are laid out on the chosen stock sheet. Useful for sanity-checking N-out at a glance. Currently estimators do this mentally or sketch on paper.

Status: R1.7+ DESIGN.

Implementation: SVG-based layout renderer; modal accessible from the Right Panel. No engine math change; pure visualization.

---

## Calibration items (EST-###)

### EST-GRPHCWHT — Graphic White liner

Customers occasionally request "Graphic White" outside liner. SPOT doesn't have a canonical mapping for this term. Likely a variant of Kla-White or Bleached White depending on customer expectation.

Decision needed from estimator: which liner does Graphic White map to? Add to canonical terms registry once decided.

Status: pending estimator decision.

### EST-RECALIB items

Ongoing observation of fleet drift. None currently open — last close was EST-RECALIB-02 via D-110 FINAL.

---

## Test cases pending closure

| TC | Tied to | Status |
|---|---|---|
| TC-D129 | D-129 RFQ parser | Verify against current PK |
| TC-D131 | D-131 Multi-Part parser | Verify against current PK |
| TC-D132 | D-132 Multi-Part editor refresh | Verify against current PK |
| TC-029.14 | Chowder sub-case | Verify against current PK |
| TC-030.6 | Cost report column ordering | Verify against current PK |
| TC-031.3 | PDF generation row overflow | Verify against current PK |

These need a verification pass against the R1.6.5.1 source to confirm they still pass. Open per `01_OPEN_ISSUES.md`.

---

## Larger architectural items (R1.7+ horizon)

### Refactor the JSX into modules

9,007 lines in one file works but limits new-developer onboarding. The refactor would split into:
- `engine.js` (the L84–877 block, imported by both browser and Node)
- `app/components/Toolbar.jsx`
- `app/components/LeftPanel.jsx`
- `app/components/RightPanel.jsx`
- `app/components/BomStrip.jsx`
- `app/components/modals/*.jsx`
- `app/state.js` (the reset-first state machinery)

Cost: ~2 weeks of work, with significant risk of re-introducing TDZ and merge-vs-reset bugs that have been shaken out of the monolith.
Benefit: easier code review, easier onboarding, possible move off Babel/IE11 target.

Decision: probably worth it eventually, but not this year.

### Phase 2 SharePoint sync

The D-120 archive system writes to local disk. Phase 2 would sync `/SPOT_QUOTES/` to a SharePoint URL nightly. This enables:
- Cross-workstation quote sharing
- Off-machine backup
- Browse UI for past quotes from any estimator

Cost: 1–2 weeks. Server-side sync agent, conflict resolution, browse UI.
Risk: SharePoint API quirks; partial-sync states.

### Bobst calibration

Currently uncalibrated placeholders. Trigger: 90 days of shop-floor data OR ≥30 Bobst jobs, whichever comes first. When triggered, run a mini-fleet calibration on Bobst-eligible jobs and replace the placeholders with real rates.

### Phase 1B parser cap monitoring

Anthropic API token budget is currently a soft cap. When it's exceeded, we log but don't block. As volume grows, we may need hard caps or per-day budgets.

### UI test automation (Chrome MCP)

Chrome MCP is already used ad-hoc for end-to-end verification. Wrapping the common harness flows in scripted form would let CI-style runs catch UI regressions automatically.

---

## What's NOT planned

These have come up but been declined:

- **A SQL pricing table.** The engine math in JavaScript is fast enough and easier to recalibrate than a migration cycle.
- **Server-side auth.** Localhost-only architecture makes this unnecessary; adding it would create session-expiry bugs without benefit.
- **A worker pool for parallel parsing.** Single-estimator workflow; one parse at a time is fine.
- **A web socket for live freight updates.** Polling is fine; estimators don't need sub-second freshness.
- **A mobile UI.** Estimators work at desktops. No demand.

The "no" list is as important as the "yes" list. The system is small because it stays out of these tarpits.

---

## How to prioritize

If you're picking up work, the order roughly is:

1. **Defects affecting production quoting** — anything in the Open Defects section of `01_OPEN_ISSUES.md`
2. **Open D-###'s tied to current release cycle** — what Michael is currently working on
3. **DEV-011 (ECT 44 popup)** — overdue from D-098
4. **D-138 inline ASK resolution** — UX improvement, parser-adjacent
5. **D-142 Spin Off fixes** — UX improvement
6. **DEV-012 layout viewer** — nice-to-have
7. **Phase 2 SharePoint** — when the cross-workstation pressure builds

Defer the refactor unless onboarding cost becomes a blocker.

---

## When in doubt

Read the source documents in this package's `source_documents/` folder. The current PK files are the authoritative state, and the design docs for major D-###'s give the full reasoning behind decisions that look unusual.

Then ask Michael, with the specific question and the work you've already done.
