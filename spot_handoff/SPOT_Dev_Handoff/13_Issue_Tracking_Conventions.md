# 13 — Issue Tracking Conventions

SPOT uses a hand-maintained issue and release tracking system. No JIRA, no GitHub Issues, no external tracker. Two files own everything: `01_OPEN_ISSUES.md` and `02_RELEASE_HISTORY.md`.

This file documents the conventions so a new developer can read, write, and trust these ledgers.

---

## The two ledgers

### `01_OPEN_ISSUES.md`

The current state of every known defect, feature request, and design decision that hasn't been closed yet. Sections:
- **Open Defects** — bugs that need fixing
- **Open Features** — features that need building
- **Open Design Items (DEV-###)** — architectural questions
- **Open Estimating Items (EST-###)** — domain decisions
- **Closed Items** — recently closed, retained for one or two release cycles, then archived

### `02_RELEASE_HISTORY.md`

Append-only log of every release ever shipped. Each entry covers:
- Version, date
- What was closed
- Files changed
- SHAs (post-deploy)
- Regression result (if applicable)

Never edit a past release entry. If an entry needs correction, write a new entry that corrects it (or append a corrigendum to the next release).

---

## ID schemes

Four namespaces for tracking different concerns:

### `D-###` — Defects and small features

Numbered sequentially. Covers bugs, UI tweaks, calibration changes, and minor features. Examples:
- D-067: Stock sheets bypass Buy Min
- D-085: Crest die auto-default trigger
- D-110: FINAL fleet calibration
- D-118: Customer CSV multi-path discovery
- D-149: Developer-mode badge stale version

Most issues are D-###. Keep them small — if it's getting complex, split into multiple D-###'s or promote to a DEV-###.

### `TC-D###` — Test cases

Test cases tied to a specific D-###. Format: `TC-D-XXX` where `XXX` is the D-### being tested. Examples:
- TC-D129: Multi-Part parser integration test
- TC-D131: Multi-Part schema validation
- TC-D132: Multi-Part editor refresh

Standalone test cases (not tied to a D-###) use `TC-###` — a different sequence:
- TC-029.14: Specific Chowder sub-case
- TC-030.6: Cost report column ordering
- TC-031.3: PDF generation row-overflow

### `DEV-###` — Design items

Larger architectural questions or refactors. Format: `DEV-###`. Examples:
- DEV-011: ECT 44 popup guardrail (the D-098 leftover)
- DEV-012: Visual layout/imposition viewer (R1.7+)

DEV items typically take multiple ship cycles to close. They carry "DESIGN" status until specced, then move to a D-### for implementation.

### `EST-###` — Estimating workflow items

Domain decisions that the estimating team owns. Examples:
- EST-GRPHCWHT: Graphic White liner mapping (pending estimator decision)
- EST-RECALIB-02: Calibration concern about Gloss vs Satin pricing gap (CLOSED via D-110)

EST items are not coding work directly — they're decisions that produce coding work once made.

---

## Anatomy of an open-issue entry

A well-formed D-### entry looks like:

```
### D-150 Folder-binding fragility on test runbook renames

**Status:** Open
**Opened:** 2026-05-15 (post-R1.6.5 verification)
**Severity:** Low (test workflow only; not production-facing)
**Sponsor:** Cowork test cycle

**Symptom:**
SPOT resolves archive folders by exact-match `{custName}_{estNum}`. Test
runbooks rename folders with prefixes (e.g., "TC1_") for organization,
which breaks the resolver — no quote loads from a renamed folder.

**Reproduction:**
1. Save quote to `Skybox_SPC-260522-001`
2. Rename folder to `TC1_Skybox_SPC-260522-001`
3. Try to load — fails silently

**Options:**
A. Discipline: test runbooks must not rename folders
B. Estimator-side fallback: when exact-match fails, try estNum-only
C. Mapping file: read `<archive>/folder_map.json` for aliases

**Decision pending:** Discuss with Michael in next session.

**Related:** D-120 (archive scaffolding), TC-D???
```

The key fields are: ID, title, status, opened, severity, symptom, reproduction (if it's a bug) or rationale (if it's a feature), and references.

---

## Anatomy of a release-history entry

```
## R1.6.5 (2026-05-12)

**Theme:** Parser robustness + late-additions reapply.

**Closed:**
- D-146 Kraft → None canonical engine value mapping (ship-blocking parser bug)
- D-147 Parse-review modal layout — action buttons reachable on large MP responses
- D-143 PK source-of-truth catch-up

**Files changed:**
- spot_r1_5.jsx (parse-review modal restructure, D-146 mapping logic)
- spot_server.js (D-118 multi-path CSV reload)

**SHAs (post-deploy verification target):**
- spot_r1_5.jsx: a96bda696e8439f7, 9007 lines
- spot_server.js: cfd2ded86ea3994f, 2619 lines
- spot_engine.js: 5ff7594d031a62e1, 1131 lines (UNCHANGED)
- spot_runner.js: 8001c3a2d87dea88, 358 lines (UNCHANGED)

**Regression:** PASS — R² 0.969 unchanged from D-110 FINAL baseline.

**Cowork verification:** PASSED for D-146, D-147. Two follow-up items:
- D-148 (docs only; quote-total target in upload runbook)
- D-150 (folder-binding design decision)
```

The SHAs are the contract: the new dev should be able to verify their working copy matches by computing the same SHA.

---

## The session SHA audit ritual

Every working session opens with this:

1. Read each source file from project knowledge:
   - `spot_r1_5.jsx`
   - `spot_server.js`
   - `spot_engine.js`
   - `spot_runner.js`
   - `build_spot_r1_5.js`
   - `fleet_compare.js`
   - `customerList.csv`

2. Compute SHA-256 prefix (first 16 hex chars) and line count for each.

3. Compare against the most recent ship entry in `02_RELEASE_HISTORY.md`.

4. If anything drifted, stop and reconcile:
   - If SHA is newer than ledger: PK was updated mid-cycle; figure out what shipped
   - If SHA is older than ledger: PK is stale; ask for re-upload
   - If files agree but line count differs: encoding issue (BOM, line endings)

The ritual catches a class of "fixing the wrong code" bugs. It runs in 30 seconds and has prevented several mis-ships.

---

## Append vs replace

Both ledgers are **append-only**.

For `01_OPEN_ISSUES.md`:
- Open new issues by appending at the bottom of the Open section
- Close issues by moving them to the Closed section (don't delete)
- Edit existing issues only to add new information; never rewrite history

For `02_RELEASE_HISTORY.md`:
- Append new release entries at the bottom
- Never edit past entries
- If a past entry was wrong, write a corrigendum in the next entry

This is enforced socially, not technically. The convention exists because the ledgers are an audit trail.

---

## Status values

Open issues carry one of:
- **Open** — needs action
- **Open — design pending** — needs a decision before coding starts
- **Open — pending verification** — coded, awaiting test
- **Open — third-party blocked** — waiting on external (UTS, Anthropic, customer)

Closed issues:
- **Closed — shipped in R1.X.X**
- **Closed — won't fix (rationale)**
- **Closed — superseded by D-### (link)**
- **Closed — environment issue (not a code defect)**

---

## Severity (for defects)

- **Critical** — production blocker; ship-stop
- **High** — wrong pricing or wrong data
- **Medium** — UI/UX issue, non-pricing
- **Low** — cosmetic, edge-case

Severity drives whether a defect ships urgently or rolls into the next release.

---

## Test case lifecycle

A test case:
1. Authored when a defect is identified (TC-D-XXX where XXX = D-XXX)
2. Lives in `TEST_SPOT_R1_5_UI_Test_Suite.md` or the Chowder file
3. Runs as part of regression on the next ship
4. Closes when it passes a full release cycle

Closure of a TC-D### follows the D-### closure. If D-### is closed, its TCs need to be closed too (or explicitly noted as "test deferred to R1.X").

---

## What to do if the ledger is wrong

If you find a release-history entry that doesn't match the actual ship (wrong SHA, missing file, etc.):

1. **Don't edit the entry.** It's history.
2. Write a corrigendum at the top of the next release entry (or in a fresh "Corrigenda" section at the bottom of the file).
3. Note the original entry, what's wrong, what's correct.
4. Reference the corrigendum from any future audit that lands on the bad entry.

---

## Cross-references

Issues should reference related items. Example:

```
**Related:** D-120 (archive scaffolding), TC-D-150 (test case), DEV-012 (design parent)
```

The cross-references make the ledger navigable. A new dev can land on D-150 and follow the trail to its scaffolding, test, and design parent.

---

## "Going in circles" — the failure mode this prevents

Before the SHA audit + append-only ledger system, SPOT sessions sometimes spent hours debugging the wrong version of a file because PK had silently drifted from deployed. The audit ritual + canonical ledger entry caught the drift in the first minute.

The system isn't perfect — D-143 was a "PK catch-up" exercise to reconcile after a silent drift. But the ledger entry recording that catch-up is now permanent, so the next time someone sees a D-143 reference they know exactly what happened.

Keep the discipline. It pays back the first time you save a session by catching a SHA mismatch up front.
