# SPOT Cloud — PRD (Product Requirements Document)

**Living document. Updated at every phase boundary.**

---

## 1. The original problem statement

User (Standard Printing Company, Canton OH) has an internal corrugated packaging quoting tool called **SPOT (Standard Printing Optimization Tool)**, currently running as a local Node.js + React JSX desktop app on individual estimator workstations.

The user wants to port SPOT to the Emergent cloud platform (React + FastAPI + MongoDB) so that:
- Multiple estimators can use it concurrently
- Quote data lives in a proper database (not local files / browser localStorage)
- Future analytics, ERP integration, mobile, and customer-facing portal become possible
- The shop can eventually expand quoting to LithoLabel and TopSheet sales classes

**Strategic decisions locked in:**
1. Path B refactor: React + FastAPI + MongoDB (NOT keep Node.js as-is)
2. Authentication in-scope: small test-user group → scalable to N
3. Anthropic key: Option C — Universal/dev key now, swap to company key for production
4. PDF persistence: SharePoint (treated as cloud archive — parallel to Shift Change App)
5. Customer list sync: SharePoint via Graph API (same pattern as Shift Change App)
6. Regression harness: ported, mandatory parity validation at R² ≥ 0.969
7. Pricing Console: carries over as-is (admin-only initially)

**Source code review completed:**
- SPOT R1.6.5.1 deploy package (9,007 JSX + 2,619 server + 1,131 engine + 358 runner + 366 fleet compare lines)
- Dev handoff package: 24 markdown docs + 28 design decision docs + canonical terms + test suites
- 785-job iQuote calibration dataset
- 384-customer SharePoint export
- Training Manual (docx)

---

## 2. User personas

| Persona | Use of SPOT |
|---|---|
| **Estimator** (~3 test users → expandable: Jaime, Michael Musgrave, Rich Walter, +1) | Daily quoting — RFQ in, priced quote out |
| **Admin** (initially Michael) | Manage rates, GM curve, sheet library, user provisioning, view audit logs |
| **CEO** (Michael) | Strategic oversight; will use as an estimator too |
| **Test users (pilot)** | Validate parity with local SPOT before full rollout |

---

## 3. Core requirements (static)

### What SPOT does
- Ingests RFQ documents (PDF/image/Word/Excel/text) via Anthropic Opus 4.7 parser
- Auto-fills quote fields (customer, dims, board, qty, print, ops)
- Estimator reviews and corrects "ASK" items
- Engine computes board cost, press cost, cutting cost, ink, freight, margin, sell price
- Routes between 4 production paths (CAD / Crest / Bobst / Saber+DC) automatically
- Supports Multi-Part quotes (displays, kits, matched sets)
- Outputs customer-facing PDF quote + internal cost report

### Non-negotiable rules (the 10 hard rules from `05_Business_Rules.md`)
1. Never set `routeOverride` in JSON
2. Initials always "SPC" for AI estimates
3. `under5MsfFee` always "0"
4. ECT grades fall back to Mullen stock (transparent to customer)
5. Stock sheets bypass Buy Min (D-067)
6. Rate migration on load — costs update, sell prices preserved
7. `applyState` / `applyItemState` are reset-first (NEVER merge)
8. Default print finish is Satin (not Gloss)
9. FOB Origin unless customer requests Destination
10. PDF quotes come from SPOT's own renderer only

### Calibration baseline (D-110 FINAL, 2026-04-24)
- Segment Cost R² ≥ 0.9690
- Segment Sell R² ≥ 0.9496
- Per-job Cost R² ≥ 0.8550
- Per-job Sell R² ≥ 0.8360
- Fleet cost delta +6.55%
- Fleet sell premium +8.30%
- **LOCKED.** Future recalibration is a separate decision.

---

## 4. Phased implementation plan

| Phase | Status | Output |
|---|---|---|
| **0 — Foundation** | 🟢 IN PROGRESS | Skeleton + PRD |
| **1 — Engine port + regression** | ⬜ | R² parity proven (the gate) |
| **2 — Backend APIs** | ⬜ | All endpoints live |
| **3 — Frontend rebuild** | ⬜ | Full UI working (44 popups, multi-part, all modals) |
| **4 — Pricing Console** | ⬜ | Admin tooling |
| **5 — Integrations** | ⬜ | SharePoint + Entra SSO live |
| **6 — Test pilot** | ⬜ | Production-ready |

Detailed acceptance criteria for each phase live in `/app/memory/phase_plan.md` (to be created at Phase 1 start).

---

## 5. What's been implemented (grows over time)

### 2026-05-28 — Phase 1 engine port (in progress, awaiting config decision)
- **Engine ported to Python** — verbatim port of spot_engine.js (1,131 lines), spot_runner.js (358 lines), fleet_compare.js (366 lines)
- **Parity proven** — Python engine output is byte-identical to legacy JavaScript engine on all 785-job regression metrics (fleet total, R², per-tier medians)
- **Bobst-first surprise discovered** — D-121/D-123 introduced bobstFirstSizing default "true" that breaks the D-110 baseline. With Bobst-first OFF, fleet Δ matches baseline exactly (+6.55%); with Bobst-first ON, fleet Δ is +32% (R² -0.55)
- **Phase 1 awaiting your decision** — see /app/memory/PHASE_1_STATUS.md for full report

### 2026-05-28 — Phase 0 kickoff
- **Foundation skeleton created**
  - Backend module structure (`engine/`, `routes/`, `models/`, `integrations/`, `utils/`)
  - Frontend folder structure (`components/spot/`, `context/`, `api/`)
  - MongoDB connection singleton (`db.py`) with all 11 collection names defined
  - `/api/health`, `/api/version`, `/api/calibration/baseline` endpoints live
  - Legacy SPOT source moved to `/app/legacy_spot/` (read-only reference)
  - 785-job regression dataset staged at `/app/backend/tests/fixtures/`
  - 384-customer CSV staged at `/app/backend/tests/fixtures/`
  - Dependencies added: `anthropic`, `weasyprint`, `openpyxl`, `httpx`, `msal`
  - Secrets in `.env` (Anthropic key, UTS credentials), `.gitignore` updated
  - Frontend landing page replaced with SPOT Cloud branding
  - **PRD.md created (this file)**

### Configuration
- Anthropic API key: stored in `.env` (received from user 2026-05-28)
- Anthropic model: `claude-opus-4-7` (matches legacy SPOT)
- Anthropic monthly cap: $500 USD (matches legacy SPOT default)
- UTS credentials: `estimates@standardprinting.com / Quotes330-453-8247` (moved from hardcoded source to `.env`)
- Origin ZIP: 44704 (Canton, OH)

---

## 6. Prioritized backlog (P0/P1/P2)

### P0 — MVP (must-have before pilot go-live)
- Engine port + R² ≥ 0.969 parity validation (Phase 1)
- All backend APIs (Phase 2)
- Frontend rebuild with all 44 warning popups (Phase 3)
- Reset-first state pattern preserved (Phase 3)
- Multi-Part editor working end-to-end (Phase 3)
- RFQ parser with verbatim system prompt (Phase 2)
- Customer-facing PDF that visually matches current SPOT output (Phase 2 — weasyprint)
- Pricing Console admin UI (Phase 4)
- SharePoint customer sync (Phase 5)
- SharePoint PDF archive on save (Phase 5)
- Entra SSO authentication (Phase 5)
- 6-minute KPI timer in UI (Phase 3, small)

### P1 — Probable next-quarter additions (deferred but designed-for)
- Quote analytics / wins-losses reporting (DB schema supports it from day 1)
- Mobile UI for estimators / sales / customer service

### P2 — Mid-term
- ERP / Automator API integration (Eps/Monarch/iQuote/iPlan) — quote-to-plan on PO receipt
- Customer-facing portal on company website (price-hidden customer view)

### P3 — Future expansion
- LithoLabel quoting (separate rules/pricing/configurations)
- TopSheet quoting (separate rules/pricing/configurations)
- More robust customer list ingestion (beyond nightly SharePoint sync)
- Bobst calibration once 30+ jobs / 90 days of shop data accumulate
- Visual layout/imposition viewer (DEV-012 from current backlog)
- Inline ASK resolution UI (D-138 from current backlog)
- Spin Off feature polish (D-142 from current backlog)
- ECT 44 popup guardrail (DEV-011 from current backlog)
- Graphic White liner canonical mapping (EST-GRPHCWHT)

---

## 7. Open items / waiting on

| Item | When needed | Status | Owner |
|---|---|---|---|
| **🚩 BOBST CALIBRATION DISCUSSION** | **Before broader rollout** | **🟡 FLAGGED for Monday Jan 6 with Michael** | **User to raise** |
| Sample RFQ PDFs (Skybox PO 47309, L'Oreal C4-26) | Phase 2/6 | 🟡 Pending | User to grab from file server |
| 2-3 complex test estimates for parity validation | Phase 6 | 🟡 Pending | User |
| SharePoint Azure AD app creds | Phase 5 | 🟡 Pending | IT |
| Entra SSO Azure AD app creds | Phase 5 | 🟡 Pending | IT |
| Confirm `prompts/` folder exists vs embedded canonical terms | Phase 2 | 🟡 Pending | Michael (next week's meeting) |
| Anthropic key rotation | Phase 5 | 🟡 Pending | User (after pilot) |
| UTS credentials rotation | Post-pilot | 🟡 Pending | User |

---

## 8. Architectural decisions

### 🚩 FLAGGED FOR REVIEW WITH MICHAEL (Monday Jan 6)

**Bobst calibration / `bobstFirstSizing` default:**
- The cloud SPOT currently uses `bobstFirstSizing = "true"` as default (matches Michael's shipped engine R1.6.5.1).
- Source code at `spot_engine.js` line 161-162 explicitly notes Bobst rates are "uncalibrated — recalibrate after ~90 days shop-floor data."
- On the 785-job iQuote regression dataset, this default produces fleet Δ +32% over iQuote and R² -0.55 (vs documented R² 0.969 baseline).
- With `bobstFirstSizing = "false"`, fleet Δ matches D-110 baseline exactly (+6.55%) but R² is only 0.84.
- **Both behaviors are mathematically correct** — the question is which routing default the business wants, AND when to recalibrate Bobst rates with real shop-floor data.
- **Decision: keep current behavior (matches what Michael ships and what Rich has been comparing alongside iQuote)**, raise with Michael when he's back on Jan 6. Pricing Console (Phase 4) will allow live adjustment when decision is made.

### What's IN the cloud port
- Multi-user with role-based auth
- MongoDB-backed state (no localStorage for quote data; localStorage only for UI prefs like tab order)
- Cloud-hosted, accessible from anywhere on company network
- Audit log captures every field edit
- Test mode for sandbox quotes (tagged, excluded from analytics)
- 6-min KPI timer

### What's STRIPPED from the cloud port
- IE11 / Babel TDZ concerns (modern React only)
- Local SMB file writes to H: drive
- `routeOverride` JSON field (Rule 1 enforcement)
- `wf_anthropic_key_{user}` per-user keys (one company key)
- DEV mode (was for AI assistants editing source code locally)

### What's PRESERVED EXACTLY
- All engine math (verbatim Python port of `spot_engine.js`)
- All 10 business rules
- Reset-first state pattern (D-080/D-087/D-098)
- Rate migration on load (Rule 6)
- Schema migration v2 → v3 path
- All 44 warning popups
- The Anthropic system prompt for the parser
- Customer-facing PDF visual layout (weasyprint port)

---

## 9. Next tasks (immediate)

After Phase 0 sign-off:
1. **Phase 1 kickoff**: begin porting `spot_engine.js` → `backend/engine/*.py`
2. Start with constants (base_matrix, flute_rules, liner_upgrades, SHEET_GROUPS)
3. Then pricing functions (calcBoard, computeLayout, selectSheet)
4. Then routing (autoRoute, compareRoutes)
5. Then run regression — first against a handful of jobs, then the full 785
6. Achieve R² parity → gate passes → advance to Phase 2

---

## 10. Reference

- Legacy SPOT source: `/app/legacy_spot/`
- Dev handoff docs: `/app/legacy_spot/dev_handoff/`
- Regression dataset: `/app/backend/tests/fixtures/WF_Quoting_Tool_Test_Data.xlsx`
- Customer list: `/app/backend/tests/fixtures/customerList.csv`
- Test credentials (when auth is set up): `/app/memory/test_credentials.md`
