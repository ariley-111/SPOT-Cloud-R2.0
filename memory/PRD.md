# SPOT Cloud — PRD (Production Requirements Document)

**Owner:** Standard Printing Co.
**Goal:** Port the legacy SPOT desktop quoting tool to a multi-user web app on Emergent. Preserve mathematical and UX parity with legacy r1.5.

## 1. Original problem statement
Port a single-user desktop tool ("SPOT" — Standard Printing Optimization Tool, ~9k LOC in `spot_r1_5.jsx`) to a multi-user cloud application. Must retain 100% pricing math + UX parity. Multi-tab drafts. AI parser for RFQs (Anthropic). UTS freight integration. PDF generation. Phase 4: Pricing Console admin. Phase 5: SSO + SharePoint.

## 2. Users
- **Estimators** — primary users (Rich Walter, Ashley, others). Quote 50-100 RFQs/month.
- **Estimating manager** — Rich Walter, oversees estimator team, role=`estimator`.
- **Admin** — Ashley (rebuild owner), role=`admin`.

## 3. Core requirements
- Cloud-native React + FastAPI + MongoDB
- 1:1 UI/UX with legacy (component layout, badge states, board status bar, route comparison, cost buildup, PDF output)
- 1:1 pricing math (every D-NNN decision marker from legacy ported and tracked in `/app/memory/LEGACY_PARITY_AUDIT.md`)
- AI parser (Anthropic Opus 4.7) for RFQ extraction
- UTS freight API integration
- PDF generation (WeasyPrint) — customer-facing Quote w/ SPC logo, terms, footer
- `.eml` and `.msg` email file ingestion (auto-extract body + attachments, auto-trigger parser)
- Multi-tab draft management (autosave, persistence, blank-tab spawn)
- JWT auth (Phase 5 → SSO via Entra)

## 4. Architecture
```
/app/
├── backend/
│   ├── engine/         core.py, pricing.py, routing.py, runner.py (math engine)
│   ├── models/         schemas.py
│   ├── routes/         auth, customers, engine_routes, freight, parser, pdf, quotes
│   ├── parser_knowledge.py (legacy parser rule transplant)
│   ├── utils/email_extract.py (.eml/.msg → body + attachments)
│   ├── tests/          fleet_regression.py (785-job iQuote comparison)
│   └── static_assets/  spc_logo.png
└── frontend/src/
    ├── components/spot/ ItemSetupSec, RightDashboard, FilesSec, PreviewPdfModal,
    │                    QuoteHeaderModal, ProgressModal, EstimateInfoSec, ...
    ├── context/         QuoteContext (multi-tab state)
    └── lib/             defaults.js, format.js
```

## 5. Implementation status

### Phase 1 — Foundation ✅
- React + FastAPI + MongoDB scaffolding · JWT auth · multi-tab drafts · autosave

### Phase 2 — Engine port + UI parity ✅
- Engine port verbatim from legacy spot_r1_5.jsx
- All 42 D-NNN decisions audited (see `/app/memory/LEGACY_PARITY_AUDIT.md`)

### Phase 3 — Integrations ✅
- Anthropic Opus parser (with prompt caching)
- UTS Freight quote API
- `.eml` and `.msg` email file ingestion w/ auto-parse + body context

### 2026-06-01 batch — Legacy parity sprint ✅
- D-124 cost-aware routing (cheapest viable, not Bobst-first) — `routing.py`
- D-090 `compare_routes` endpoint for side-by-side panel
- D-070 Board Status Bar (SPEC/RUNNING/Buy Min banner + Accept/Force/Edit UX)
- fmLnr parity (None→Kraft, strip weight + -Lite/-White)
- Liner grade enforcement (33# Kla-White → only 175/ECT 32 grades) + green stock dots
- New `/api/engine/sheet-availability` endpoint
- Quote Header modal (legacy L7600-7628 ports — Payment / FOB / Valid / Ship-to / Notes)
- PDF generation rewritten 1:1 with legacy `exportQuoteHTML` (terms block, bullets, sincerely)
- Email file extraction (.eml + .msg) with Outlook quirk handling (\\x00 trailing, sig image filter)
- Progress Modal during long-running calls (parser + UTS)
- File ingestion summary in Review modal (shows email body chars + attachments extracted)
- Route Comparison panel rewrite (Sheet/Layout/Sheets/Board/Press/Cutting/Die/Total/Per piece + warnings + switch buttons + collapsible)
- Cost Buildup Summary/Detail toggle (working) + Detail breakdown rows
- Board Panel (collapsible, Sq Ft / MSF / Tier / Base / Eff Rate / FSC / Setup / Pallet / Waste)
- Economics pills extended (Print / Cut / Gluing / Tape / Strip)
- Grade-fallback base-rate lookup fix (Lynk: $97.65 board now matches legacy)
- Stale Route Comparison data cleared on new tab spawn
- Customer auto-populate ship-to address (address_1 + address_2 + city + state)
- Rich Walter estimator account created (rwalter@standardprinting.com / spot-rich-2026)

### 2026-06-03 — Multi-Part parity sprint ✅ (MP-1 → MP-6)
- **MP-1** Active-item mirror state model (`gatherItemState`/`applyItemStateTo`),
  job-level vs item-level field segregation (`/app/frontend/src/lib/mpSchema.js`),
  BOM toolbar (Add/Duplicate/Delete/Reorder/Convert to ↔ from Multi-Part)
- **MP-2** Backend `/api/engine/calculate-multi-part` endpoint — per-component pricing
  (MFG/Purchased/Fulfillment), Matched Set + Individual aggregation, GM override
- **MP-3** Parser → MP auto-apply: detects `bomItems[]` in parsed output,
  renders per-component tabs + low-confidence badge in Review modal, applies
  full Multi-Part state via `replaceState`
- **MP-4** Job-level freight/prepress allocation (UI + backend wire-through),
  per-component Right Dashboard (Item Setup / Production / Cost Buildup show
  the active item, not the aggregate)
- **MP-5** Multi-Part PDF — BOM listing in item bar + "Per Set" pricing labels
- **MP-6** Per-component confidence ⚠ badges in parse-review modal, Spin-off
  action (↗ button → new Simple tab with carry-over identity)

### 2026-06-03 — P1 Sprint: DB Split + Pricing Admin Console ✅
- **DB Split**: Preview backend renamed to `DB_NAME=spot_preview` so testing
  doesn't corrupt production data. Production still uses `spot_db` (user locks
  this in Emergent deploy env-vars). Re-seeded `admin@` and `rwalter@` users.
- **Pricing Admin Console** (P4 phase 1):
  - 93 calibrated values editable across 4 categories: rates, GM tier curve,
    sell tier curve, grade adders
  - Per-row override + Reset-to-baseline + Reset-all (per-category + master)
  - Append-only audit log retained forever (timestamp · action · category · key ·
    before · after · baseline · user); filterable + paginated
  - Calibration baseline tab — read-only D-110 FINAL metadata
  - Defaults live in code (`engine/core.py`), overrides in MongoDB
    (`rate_overrides`), engine sees mutations live via `_RATE_TO_ASMP` map
    into `runner.py:ASMP_DEFAULTS`
  - Verified end-to-end: override(incaRate=$1000) raises a 12×18 Inca quote at
    1000pcs from $1,122.01 → $1,557.99 (+$435.98); reset restores to exact penny
  - Admin-only route gating (testid `toolbar-admin`); estimator users see no
    Admin button
  - 20/20 backend pytest pass + Playwright UI walkthrough verified
- Added `services/__init__.py` package
- Routes: `/api/admin/rates` (GET/PUT/DELETE), `/api/admin/rates/reset-all`,
  `/api/admin/rates/audit`, `/api/admin/rates/categories`,
  `/api/admin/rates/calibration`

### 2026-06-03 — Pricing Strategy parity + Advanced Controls cleanup ✅
- **Pricing Strategy section** rewrite for full legacy parity:
  - 9 tier rows (was 5) — 0-1, 1-3, 3-5, 5-9, 10-24, 25-49, 50-74, 75-99, 100+
  - Both GM% AND Sell$/MSF columns side-by-side
  - 3-column horizontal layout: Tier Targets | Force Sell/Pc | Freight $/Qty
  - "Reset Margins to My Defaults" button restores D-110 baseline curves
  - Freight $/Qty panel — per-qty override of base freight cost
- **Advanced Controls section deleted** from main UI — everything moved to Admin Console.
  Read-only documentation cards were redundant once the editor was available.
- **Admin Console — Integrations tab** added (admin-only):
  - Anthropic API Key (masked secret edit + audit log)
  - Anthropic Model selector
  - UTS Username / API Key / Bill-To ID (masked secrets)
  - Origin ZIP (Standard Printing — 44704)
  - Provider status pills: Anthropic configured ✓ / UTS configured ✓ / Shipping
  - Falls back to `.env` if no DB override set
- **Admin Console — Usage tab** added (admin-only):
  - 4 KPI cards: Total parses · Anthropic cost · Tokens in · Tokens out
  - By Month / By Customer / By Estimator breakdowns
  - Recent calls log (newest 50): timestamp · estimator · customer · model · tokens · $cost · ✓/✗
  - Window selector (1mo / 3mo / 6mo / 12mo / 24mo) + customer-code filter
  - Sets up for future per-customer cost-allocation / billing
- `parse_rfq` endpoint extended with `customer_code` / `customer_name` /
  `est_initials` form fields; frontend passes them automatically from active quote
- New collections: `integrations` (key storage) + `parser_usage` (per-parse log)

### 2026-06-03 — Sheet Library admin tab ✅
- **Admin Console → Sheet Library tab** added (admin-only):
  - All 216 baseline sheets visible with status pills (active / added / edited / disabled)
  - Filters: active · user-added · disabled · all + search bar
  - + Add Sheet form (flute, grade, liners, medium, w, l, reason)
  - Disable / Enable (soft-delete — historical quotes still see disabled sheets)
  - CSV Import (header: flute,grade,outsideLiner,insideLiner,medium,width,length;
    legacy short names accepted)
  - CSV Export — full library snapshot with status + audit metadata
  - Every change audit-logged with timestamp · user · before/after · reason
- Backend service `services/sheet_library.py` mutates `engine.core.APPROVED_SHEETS`
  in place from DB on startup (idempotent); engine sees merged effective set
- Soft-delete pattern: `disabled: True` flag instead of physical delete so
  load of historical quotes still resolves the original sheet
- IDs: baseline = `SH-001…SH-216`, user-added = `USR-0001+`
- Main-UI Board Engine section unchanged (still read-only documentation cards
  per user — "keep how legacy has it")

### 2026-06-03 — MP-7 BOM Builder modal ✅
- **10 built-in DISPLAY_TEMPLATES** ported verbatim from legacy
  (Counter / Dump Bin / Endcap / Floor / FSDU / Pallet / PDQ / Power Wing /
  Shipper / Weekender) — each with default qtys + per-component on/off + opt badge
- **BOM Builder modal auto-opens** when user clicks "→ Multi-Part" toolbar button
  (replaces the previous "just add blank Item 1" behavior — per legacy workflow)
- **Templates tab + Manual tab** in modal: visual template cards or empty manual list
- Each row inline-editable: MFG/PUR/FUL badge, on/off checkbox, desc, Cust ID,
  type dropdown, pcs-per-set, up/down reorder, remove
- **Default qtys footer** — auto-filled from template, editable per quote
- **Save BOM** commits the active rows via `convertToMultiPart(draft, {defaultQtys})`,
  which seeds each item's state with the current intake's common fields
- **Edit in BOM Builder button** in BomSec strip — reopens the modal with current
  items preloaded, lets user add/remove components from templates
- Workflow now mirrors legacy: parser auto-detect path (MP-3) AND template/manual
  path (MP-7) both arrive at the same per-component tabs (MP-1) + math (MP-2)
- Note: cloud has no auto-apply on parser (always manual confirm in diff modal)
  so the legacy 0.75/0.85 confidence threshold tuning is a no-op in cloud

## 6. Open items (parking lot for Tuesday meeting)
1. Board substitution policy display — already aligned with legacy ✅
2. Buy-Min behavior (full charge + warning) — already aligned with legacy ✅
3. ~~Parser CAD override priority~~ — no legacy precedent, dropped
4. ~~Multi-Part parsing heuristics~~ — no legacy precedent, dropped
5. Margin calibration vs iQuote — legacy/cloud both diverge from iQuote on specific projects (Lynk +87% over iQuote). **R² claim of 0.98 needs investigation — that's a correlation metric, not a match metric.**
6. Valid Until vs 90-day footer mismatch — legacy hard-codes 90-day footer regardless of `quoteExpDays`
7. Sell/Pc convention in Cost Buildup — legacy mixes item-only Sell Total with all-in Sell/Pc (cloud now matches)

## 7. Tomorrow's agenda
- Test Rich Walter's login
- Compare legacy parser quality vs cloud parser (Rich + Andrew sending screenshots)
- Re-test Tavens RFQ on both legacy and cloud — confirm parity holds after today's engine fixes
- Investigate R² 0.98 claim discrepancy — drill into per-project residuals in fleet_regression.py output to identify whether Lynk/Tavens are statistical outliers or whether the engine has a systemic high bias

## 8. Backlog (P1-P3)
- ~~Multi-Part per-item state isolation~~ ✅ shipped 2026-06-03 (MP-1)
- ~~Split Preview/Production database~~ ✅ shipped 2026-06-03 (DB rename)
- ~~Phase 4: Pricing Admin Console~~ ✅ shipped 2026-06-03 (full 9-tab UI)
- ~~Sheet Library admin editor~~ ✅ shipped 2026-06-03 (add / edit / disable / CSV)
- **Approval-workflow governance layer** (P1 — high-value, deferred per user 2026-06-03):
   * Multi-step approval for sheet additions AND rate/price changes
   * Approver UI shows DIFF — old vs new in dollars AND % change
   * "Pending changes" queue for added stocks needing approval
   * Reason field required on every change (rate, sheet, integration)
   * Approver-identity captured (who approved, when, what they saw)
   * Executive read-only view: estimating manager, VP, CEO can browse:
       - when pricing was updated · by whom · reason · who approved
       - all sheet additions/removals with same trail
       - all `base_matrix` cost-rate changes with $-delta and %-delta
   * `price_history` ledger as a separate "executive ledger" view layered
     on top of the existing audit_log
- **Board Cost editor for `base_matrix`** (P1 — sister feature to above):
   * Edit per-grade × per-tier $/MSF rates
   * Bulk-% increase tool ("apply +5% to all 200# rates")
   * CSV import/export of the cost matrix
   * Used 3-4x/year for supplier-driven price-list updates
- "Request New Sheet" estimator workflow (queue → admin approves → enters library) — **P2**
- Separate `bom_items` MongoDB collection (currently in `quote_drafts.state` JSON blob) — **P3**
- Phase 5a: Entra SSO — **P2** (user owns this, 2026-06-03 afternoon)
- Phase 5b: SharePoint customer sync — **P2** (user owns this)
- Phase 5c: SharePoint PDF archive — **P2** (user owns this)
- Side-by-side last-accepted quote comparison in Preview modal — **P3**
- Quote analytics / win-loss reporting — **P3**
- ERP/Automator API integration — **P3**
- Multi-Part-aware "BOM Template" library (re-use display skeletons) — **P3**

## 9. Deployment
- Preview URL: `https://ai-connect-33.preview.emergentagent.com` (this dev sandbox)
- Production URL: TBD (deploy ahead of 2026-06-02 11:30 AM demo recommended)

## 10. Demo (2026-06-02 11:30 AM)
- Login: `admin@standardprinting.com` / `spot-admin-2026`
- Reference RFQs: Tavens, Lynk Packaging, AFA M85002
- Demo flow: drop .msg → progress modal → review parsed fields → save → preview PDF → export
