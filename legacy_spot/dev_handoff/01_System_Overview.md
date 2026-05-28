# 01 — System Overview

## What SPOT is

SPOT (Standard Printing Optimization Tool) is a single-workstation web app that takes a customer's RFQ (request for quote) and produces a priced, deliverable corrugated packaging quote. It's used daily by the estimating team at Standard Printing Company (SPC) in Canton, OH.

The estimator's day, with and without SPOT, looks like this:

**Without SPOT (the way it used to be, on iQuote):**
- Read the RFQ email or PDF
- Open Excel
- Look up customer in a separate system
- Look up sheet sizes in a printed library
- Manually figure out which press, which die-cutter, how many pieces per sheet
- Punch numbers into iQuote
- Get a price
- Format a quote in Word
- Send the quote

**With SPOT:**
- Drag the RFQ PDF into the app
- The Anthropic-API-powered parser fills in 80% of the fields
- Estimator reviews and corrects
- Click Build Estimate
- Quote and cost report come out in seconds

A complete quote that took 20–45 minutes on iQuote now takes 5–6 minutes on SPOT. The 6-minute target is enforced as a workflow KPI.

---

## What SPOT prices

The shop produces corrugated packaging — boxes, displays, point-of-sale, protective inserts, all in single-wall or double-wall corrugated board. The product domain has roughly four dimensions:

1. **Board** — what material the box is made of (flute, grade, liners, medium)
2. **Print** — what's printed on the outside (Satin, Gloss, no print)
3. **Cutting** — how the blank is cut from the sheet (CAD rotary, Crest flat-bed, Bobst flat-bed)
4. **Ops** — additional processing (die-cutting, gluing, stitching, perforating, sabering)

For each combination, SPOT decides:
- Which **stock sheet** to cut from (from a library of ~216 approved sizes)
- How many **pieces per sheet** ("N-out")
- Which **route** to send the job through (CAD vs Crest vs Bobst)
- What it **costs** to make (board + press + cutting + ink + FSC + freight)
- What to **sell it for** (cost ÷ (1 – GM target))

The whole point of SPOT is that estimators don't have to do those four decisions in their head and on paper. SPOT does it from calibrated tables, the estimator reviews, and the price comes out.

---

## What SPOT does NOT do

- **No accounting.** SPOT does not post jobs to the ERP. The estimator copies the quote details into the ERP separately.
- **No production scheduling.** SPOT prices the job; the floor schedules it.
- **No customer-facing portal.** Customers never see SPOT directly. They get a PDF or email.
- **No inventory tracking.** SPOT assumes the stock sheets in the library are available. Whether the shop actually has them on the floor is a separate question.

These are intentional scope boundaries. SPOT does one thing — turn an RFQ into a price — and stays out of everything else.

---

## The three modes

SPOT runs in one of three modes at any given time. The mode is a system-prompt-level flag that controls which files the AI assistant reads first and what kinds of operations are permitted.

| Mode | Purpose | Allowed operations |
|---|---|---|
| **EST** (Estimating) | Live quoting. Default. | Read RFQs, fill the UI, deliver quotes. Cannot modify source code. |
| **DEV** (Development) | Code changes, debugging, builds. | Read/modify source files. Append to release history. Close issues. |
| **TEST** (Testing) | Regression and validation. | Load test JSONs, compare to expected. Log PASS/FAIL. Cannot modify source. |

The default mode is EST. Switch is via a `MODE: DEV` or `MODE: TEST` tag in the first line of a session message.

This separation exists because the cognitive load of "I'm estimating live for a customer" is incompatible with "I'm refactoring the engine." Mistakes cluster at the boundary. Keeping the modes explicit keeps the mistakes contained.

---

## The end-to-end EST workflow

Every quote, every day, runs through five phases:

```
Phase 0  Session-start discipline      registry load + reading-protocol check
Phase 1  Read the RFQ                  extract customer, part#, dims, board, qty
Phase 2  BOM Scope Pass                inventory every part; tag RFQ/DEFAULT/ASK
         Intake grid                   fill every field, surface ASKs
Phase 3  Approval                      estimator approves grid, corrects ASKs
Phase 4  Execute UI harness            type into SPOT via Chrome MCP or estimator
Phase 5  Handoff                       deliver review prompt; estimator owns it
```

Each phase has a defined output. The grid in Phase 2 is the contract between AI and estimator — once approved, Phase 4 is mechanical execution.

The full harness for Phase 4 is in `source_documents/EST_SPOT_UI_Map.md`. Every field on every screen is mapped to a selector and a default. If the JSX ships a UI change, the harness re-anchors via grep (we anchor to label strings, not line numbers).

---

## Why the system is shaped this way

A few decisions look unusual at first but are deliberate:

**Why localhost-only?** SPC's IT does not have a hardened internal web environment. Every estimator's machine runs its own copy of the server. No central app server, no shared database, no concurrent edits, no auth headaches. The blast radius of a bug is one workstation.

**Why a single 9,007-line JSX file?** It started smaller. Each defect-fix and feature added lines. Refactoring into modules is on the backlog (`15_Open_Work_Roadmap.md`), but the cost-benefit doesn't pencil out yet: SPOT works, the build pipeline is simple, and a refactor would re-introduce TDZ and merge-vs-reset bugs we've already shaken out of the monolith.

**Why an in-memory engine rather than a SQL pricing table?** Pricing rules at SPC change quarterly. Re-deploying a binary is faster than running a migration. The engine table (`base_matrix`, `liner_upgrades`, etc.) is just a JavaScript object; recalibration is a code change that ships through the normal release process.

**Why Anthropic API for the RFQ parser?** The parser handles PDFs, emails, and Word docs that look very different from one another. Customers send hand-written notes, table-of-parts PDFs, multi-part displays. A rules-based parser would need constant maintenance. An LLM call costs $0.10–0.40 per RFQ and handles all variants from one prompt. That trade was made under D-129.

---

## What you'll work on day-to-day

If you inherit SPOT, you'll spend your time roughly:

- **30%** — Fixing parser quality issues. The RFQ parser is the most exposed surface; new RFQ shapes break it. Most fixes are prompt edits in `spot_server.js` + an integration test.
- **20%** — Pricing calibration drift. Once a quarter someone notices a job class that's off. You re-run `fleet_compare.js`, identify the parameter, adjust, re-validate.
- **15%** — UI bugs from estimator feedback. Almost all in `spot_r1_5.jsx`.
- **15%** — Build and ship the next release. Process is in `12_Build_Deploy_Test.md`.
- **10%** — Customer list refresh. The CSV from SharePoint sometimes changes schema; the parser in `spot_server.js` needs to keep up.
- **10%** — Reviewing past D-### design decisions when a question comes up.

You will not spend time on: testing infrastructure (it's a script + the fleet dataset), CI/CD (there isn't any — you ship by replacing files), monitoring (the server logs to stdout and that's enough for one workstation).

---

## What "done" looks like

A quote is done when:
- Customer is bound (typeahead matched against the live customer list)
- Part number is filled
- Board is specified (flute, grade, mill, caliper, liners)
- Dimensions are entered (L × W × D)
- Quantities are filled (1–5 slots)
- Route is selected (Auto, CAD, Crest, or Bobst)
- The Economics panel on the right shows per-qty cost and sell price
- The Preview Quote PDF generates without error
- The estimator clicks Save

When all eight are green, the quote is shipped to the customer.

A SPOT release is done when:
- Every changed source file has a recorded SHA in `02_RELEASE_HISTORY.md`
- Every fixed defect is closed in `01_OPEN_ISSUES.md`
- The regression suite passes
- The fleet R² hasn't drifted more than 0.005
- The install kit is rebuilt
- The release entry is appended to `02_RELEASE_HISTORY.md`

When all six are green, the release is shipped to Michael's workstation.
