# SPOT Cloud — PRD (Production Requirements Document)

**Owner:** Standard Printing Co.
**Goal:** Port the legacy SPOT desktop quoting tool to a multi-user web app on Emergent. Preserve mathematical and UX parity with legacy r1.5.

## 1. Original problem statement
Port a single-user desktop tool ("SPOT" — Standard Printing Optimization Tool, ~9k LOC in `spot_r1_5.jsx`) to a multi-user cloud application. Must retain 100% pricing math + UX parity. Multi-tab drafts. AI parser for RFQs (Anthropic). UTS freight integration. PDF generation. Phase 4: Pricing Console admin. Phase 5: SSO + SharePoint.

## 2. Users
- **Estimators** — primary users (Rich Walter, Andrew, others). Quote 50-100 RFQs/month.
- **Estimating manager** — Rich Walter, oversees estimator team, role=`estimator`.
- **Admin** — Andrew (rebuild owner), role=`admin`.

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
- Multi-Part per-item state isolation (each bomItem snapshots its own state)
- Phase 4: Pricing Admin Console (D-110 rates, GM curve, audit log)
- Phase 5: Entra SSO + SharePoint customer sync + PDF archive (blocked on IT)
- Side-by-side last-accepted quote comparison in Preview modal
- Quote analytics / win-loss reporting
- ERP/Automator API integration

## 9. Deployment
- Preview URL: `https://ai-connect-33.preview.emergentagent.com` (this dev sandbox)
- Production URL: TBD (deploy ahead of 2026-06-02 11:30 AM demo recommended)

## 10. Demo (2026-06-02 11:30 AM)
- Login: `admin@standardprinting.com` / `spot-admin-2026`
- Reference RFQs: Tavens, Lynk Packaging, AFA M85002
- Demo flow: drop .msg → progress modal → review parsed fields → save → preview PDF → export
