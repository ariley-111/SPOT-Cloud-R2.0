# SPOT Developer Handoff Package — INDEX

**Version:** R1.6.5.1  
**Date:** 2026-05-22  
**Authoritative source SHAs (session-audit verified):**
- spot_r1_5.jsx: L=9007, SHA=0c66da0efdd2acbf
- spot_server.js: L=2619, SHA=cfd2ded86ea3994f
- spot_engine.js: L=1131, SHA=5ff7594d031a62e1
- spot_runner.js: L=358, SHA=8001c3a2d87dea88
- build_spot_r1_5.js: L=60, SHA=9d37f6b08d284641
- fleet_compare.js: L=366, SHA=db6b89e4e55c81bd

---

## Reading order

### Tier 1 — Read first (orientation)
- **00_START_HERE.md** — orientation, mental model, the 5 critical things
- **01_System_Overview.md** — what SPOT does, modes, workflow
- **02_Architecture.md** — three-tier: browser → server → engine
- **03_Business_Domain.md** — corrugated packaging primer

### Tier 2 — Reference (lookup as needed)
- **04_Control_Tables_Reference.md** — every calibrated number
- **05_Business_Rules.md** — the 10 hard rules
- **06_Calibration_Methodology.md** — fleet recalibration playbook
- **16_Glossary.md** — SPC vocabulary registry (⚠️ for non-standard usage)

### Tier 3 — Codebase walkthroughs
- **07_Codebase_Walkthrough_JSX.md** — section guide to 9007-line JSX
- **08_Codebase_Walkthrough_Server.md** — section guide to 2619-line server
- **09_Codebase_Walkthrough_Engine.md** — section guide to 1131-line engine
- **10_API_Reference.md** — all server endpoints with request/response

### Tier 4 — State and Build
- **11_State_Management.md** — React state, localStorage keys, persistence
- **12_Build_Deploy_Test.md** — dev loop, build, regression
- **13_Issue_Tracking_Conventions.md** — D-### / TC-D### / DEV-### system
- **14_Release_History_Summary.md** — curated tour of SPOT's evolution
- **15_Open_Work_Roadmap.md** — what's still open

### Tier 5 — Deep Dives (the "how it actually works")
- **17_Deep_Dive_Pricing_Walkthrough.md** — single quote, step by step
- **18_Deep_Dive_Routing_Logic.md** — CAD vs Crest vs Bobst decision tree
- **19_Deep_Dive_RFQ_Parser.md** — Anthropic API pipeline end-to-end
- **20_Deep_Dive_Multi_Part.md** — Multi-Part schema and pricing modes

### Tier 6 — Living with SPOT
- **21_Code_Patterns_And_Gotchas.md** — TDZ, reset-first, sentinel sweep, etc.
- **22_Troubleshooting_Guide.md** — symptoms → causes → fixes
- **23_Onboarding_Plan.md** — Day 1 / Week 1 / Month 1 / Month 2 progression

### Tier 7 — Source Material
- **source_documents/** — full copies of all PK reference docs (DEV/EST/TEST)
- **src/** — current source files (jsx, server, engine, runner, build, fleet_compare, customerList, install scripts, logo)

---

## Total contents

- 24 markdown files (00-23 + INDEX)
- ~4,600 lines of dev documentation
- 30 source reference documents in `source_documents/`
- 12 source/runtime files in `src/`

---

## How to use this package

**If you're a new developer:** read in tier order. 00→01→02→03 first, then jump to the deep dives for whatever subsystem you're working on.

**If you're an experienced developer returning to SPOT:** Tier 1 + Tier 5 deep dives.

**If you're auditing or reviewing:** Tier 2 + Tier 4 + Tier 6.

**If you're picking up a specific issue:** look up the issue in `01_OPEN_ISSUES.md` (in source_documents/), find the affected subsystem, jump to that deep dive, then jump to the codebase walkthrough.

---

## Companion deliverables

This package is one of three:

1. **`SPOT_R1.6.5.1_Deploy.zip`** — IT deploy bundle (install kit for new machines)
2. **`SPOT_R1.6.5.1_Dev_Handoff.zip`** ← this — developer documentation
3. **`SPOT_Training_Manual.docx`** — estimator-facing training manual (operators)

Each is independently sufficient for its audience.
