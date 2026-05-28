# SPOT Developer Handoff Package — START HERE

**Version:** R1.6.5.1
**Audience:** A developer inheriting SPOT cold, with no prior context
**Authored by:** Michael Musgrave (CEO/owner) and the SPOT working notes
**Date:** 2026-05-22

---

## Read this first

You are inheriting an internal estimating application called **SPOT** (Standard Printing Optimization Tool). It runs the corrugated packaging quoting workflow at Standard Printing Company (SPC) in Canton, OH. Estimators use it every day to convert customer RFQs into priced quotes. The math is calibrated against 773 historical jobs from the legacy iQuote system, with R² 0.97 on segment cost — meaning SPOT's pricing has been proven, in numbers, to match the shop's actual production economics.

**This isn't a research project. It's a production system.** When an estimator opens it Monday morning, broken pricing means broken quotes means lost dollars or lost customers. The first rule of working on SPOT is: don't break what works.

---

## What's in this package

Read these in order. Each builds on the last.

| # | File | What you'll learn |
|---|---|---|
| 00 | **START_HERE.md** (this file) | Orientation, mental model, where to look for what |
| 01 | **System_Overview.md** | What SPOT does in plain English; the estimator workflow |
| 02 | **Architecture.md** | The three-tier code structure; data flow end to end |
| 03 | **Business_Domain.md** | Corrugated packaging vocabulary; what a "flute" is; why "Crest" is a route, not a brand |
| 04 | **Control_Tables_Reference.md** | Every calibrated number with explanation |
| 05 | **Business_Rules.md** | The ten hard rules; routing logic; GM curve; freight |
| 06 | **Calibration_Methodology.md** | How the engine was tuned; how to recalibrate without breaking things |
| 07 | **Codebase_Walkthrough_JSX.md** | Section-by-section guide to `spot_r1_5.jsx` (9,007 lines) |
| 08 | **Codebase_Walkthrough_Server.md** | Section-by-section guide to `spot_server.js` (2,619 lines) |
| 09 | **Codebase_Walkthrough_Engine.md** | Section-by-section guide to `spot_engine.js` (1,131 lines) |
| 10 | **API_Reference.md** | Every endpoint, every request/response shape |
| 11 | **State_Management.md** | React state, localStorage keys, the reset-first pattern |
| 12 | **Build_Deploy_Test.md** | How to build, ship, and validate a change |
| 13 | **Issue_Tracking_Conventions.md** | The D-### / TC-D### / DEV-### system |
| 14 | **Release_History_Summary.md** | Curated tour of how SPOT got to where it is |
| 15 | **Open_Work_Roadmap.md** | What's still on the table for R1.7+ |
| 16 | **Glossary.md** | Every term, every acronym, every gotcha |

The `source_documents/` folder ships the original project knowledge — control tables, design decisions, etc. — for cases where this handoff abridges and you want the unabridged form.

---

## The 60-second mental model

```
                 [Estimator workstation, Windows]
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  Chrome / Edge browser                 │
        │  ─────────────────────────────────────│
        │  SPOT_R1.5.html  (built React app)    │   ← UI, all state, all
        │   ├── 9,007 lines from spot_r1_5.jsx  │     localStorage, all
        │   ├── ENGINE math (mirrored locally)  │     calculations
        │   └── Calls localhost:3100 for I/O    │
        └────────────────┬──────────────────────┘
                         │ HTTP (localhost only)
                         ▼
        ┌───────────────────────────────────────┐
        │  spot_server.js  (Node.js)            │   ← File I/O, RFQ
        │   ├── /customers/*  (CSV lookup)      │     parser, freight
        │   ├── /archive/*    (quote folders)   │     proxy, archive
        │   ├── /api/freight  (UTS proxy)       │
        │   └── /est/parse-rfq (Anthropic API)  │
        └────────────────┬──────────────────────┘
                         │
                ┌────────┴────────┐
                ▼                 ▼
       Anthropic API     UTS freight API
       (RFQ parser)      (truckload rates)
```

`spot_engine.js` is a **Node-side copy** of the engine math that lives inside the JSX. It exists so `fleet_compare.js` can run regression against the 785-job iQuote dataset without booting the browser. The engine in the JSX is the source of truth for live quoting; the engine in `spot_engine.js` is kept in sync for headless testing.

**Why this architecture, not a normal web app?**

- One workstation, one estimator, one quote at a time. No multi-user concurrency to worry about.
- All state lives in browser localStorage. No SQL database to back up, migrate, or break.
- The server is just an I/O proxy — customer list lookup, freight API, file archive, RFQ parser. The pricing math runs in the browser.
- This means: the app survives any network outage. Estimators can keep quoting even if Anthropic and UTS are both down.

---

## The five things to know before you touch a line of code

### 1. Accuracy is non-negotiable, speed is second, cost is irrelevant

SPC's priority order — communicated by Michael directly — is:

1. **ACCURACY.** Wrong quotes are catastrophic. A 10% over-quote loses the job. A 10% under-quote loses dollars on every unit.
2. **SPEED.** Faster is better, all else equal. Target: under 6 minutes from RFQ drop to "SPOT is loaded."
3. **COST.** API tokens, latency, prompt size — none of these are blockers. If extra tokens buy accuracy, spend them.

When you optimize, optimize in that order. Don't shave accuracy for speed. Don't shave anything for cost.

### 2. SPC vocabulary is NOT industry-standard

Half a dozen domain terms at SPC mean something different from what the general corrugated packaging industry uses them for. The most dangerous is **CKB**:

- **Industry standard:** Clay-Coated Bleached Kraft — a folding-carton paperboard grade
- **SPC meaning:** Corrugated Kraft Board = 42# Kemi-Lite — a clay-coated kraft liner

If you write a model, a parser, or a prompt that "knows" CKB means clay-coated bleached kraft, it will over-quote every CKB job at SPC by treating it as a different (more expensive) material. The canonical registry is in `16_Glossary.md` and the source-of-truth file `EST_SPOT_Canonical_Terms.md`. **Read the glossary before you read the code.**

### 3. The ledgers are the single source of truth for what's shipped

Two files track every change ever made to SPOT:

- `01_OPEN_ISSUES.md` — current defects, features, design items
- `02_RELEASE_HISTORY.md` — append-only log of every ship, ever

Both are markdown. Both are read in every session. **They are not optional documentation.** They are how the system stays auditable. When you ship a change, you log it. When you fix a bug, you close its D-### in `01_OPEN_ISSUES.md` and append the closure to `02_RELEASE_HISTORY.md`. Never edit a past entry — only append new ones. If a release entry needs correction, write a new entry that corrects it.

### 4. The "reset-first" pattern is load-bearing

When SPOT loads a saved estimate (from localStorage or a JSON file), it does **not** merge the loaded state into the current state. It **replaces** the current state entirely with a fresh default, then applies the loaded fields on top. This is in `applyState()` (for the whole quote) and `applyItemState()` (for a single BOM item).

This pattern has caused (and prevented) so many bugs that there are three closed defects directly tied to it: D-080, D-087, D-098. Every time you touch state loading, you must preserve reset-first. Merge semantics produce subtle pricing errors that show up six weeks later in a customer complaint.

### 5. Babel transpiles to IE11. `const` becomes `var`.

The build pipeline targets IE11 (for shop-floor compatibility). Babel rewrites `const` and `let` to `var`. This eliminates the Temporal Dead Zone — meaning a `useMemo` that references a variable declared *below* it will see `undefined` instead of throwing a ReferenceError. We have shipped two bugs (D-107, D-108) where this exact thing produced wrong pricing in production with no visible error in DevTools.

When you write or review a `useMemo`, scan the variables it captures. If any of them are declared later in the same component, hoist the declaration upward. This is unique to SPOT's build pipeline; if you've worked with modern React under Vite or webpack you've never had to think about it.

---

## The session protocol (you'll see this referenced everywhere)

Every working session on SPOT — whether human or AI assistant — opens with a mandatory **SHA audit ritual**:

1. Read each source file from project knowledge.
2. Emit line count + 16-char SHA prefix for each.
3. Compare against the recorded SHAs in `02_RELEASE_HISTORY.md`.
4. If anything has drifted, stop and reconcile before doing other work.

This is enforced because the project knowledge has, on several occasions, silently failed to sync — meaning the "current" file in the cloud diverged from the file actually deployed on Michael's localhost. Catching that drift at session start prevents a class of "fixing the wrong code" failure that has cost half-days. There's a write-up at `13_Issue_Tracking_Conventions.md` and a deeper one in the source-document folder.

---

## Where to look when something goes wrong

| Symptom | First place to look |
|---|---|
| Wrong price for a known job | `04_Control_Tables_Reference.md` — verify rates haven't drifted |
| RFQ parser returning garbage | `08_Codebase_Walkthrough_Server.md` §`/est/parse-rfq`; check Anthropic API key |
| Customer typeahead empty | `08_Codebase_Walkthrough_Server.md` §`/customers/refresh`; check `customerList.csv` |
| Freight quote way off | UTS API may be down; SPCOC local zones should kick in — see `05_Business_Rules.md` §Freight |
| Tab title shows wrong version | `12_Build_Deploy_Test.md` §Version sentinel sweep |
| Estimate loaded but values look wrong | Suspect a `useMemo` TDZ; see `02_Architecture.md` §Babel quirks |
| Cost report doesn't open | Check browser console; modal stack may be in inconsistent state |
| Test job runs in Node but not UI | Engine drift between `spot_engine.js` and the JSX engine block; see `09_Codebase_Walkthrough_Engine.md` |

---

## When you're stuck

The owner is **Michael Musgrave** — terse, direct, expects decisions to be executed without re-confirmation once made. He will not appreciate exploratory questions when the answer is in the docs. Read this package, read the ledgers, read the source. Then ask, with a specific question and the work you've already done.

When you do ship a change:
1. SHA audit first.
2. Make the change against the live source baseline (not against PK if it's drifted).
3. Run the regression that covers the change.
4. Update the ledgers (open → release history).
5. Deliver as a complete file, not a patch.

The README in `SPOT_R1.6.5.1_Deploy/` (the IT install kit, separate package) is a good model of how a SPOT deliverable reads — focused on what someone needs to do, in the order they need to do it, with no preamble.

---

Welcome to SPOT. The system is small in line count but dense in domain knowledge. Take the time to read; you'll move faster afterward.
