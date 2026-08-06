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

### 2026-06-05 — Freight Dashboard + Per-Slot Allocation ✅
- **New: `/app/frontend/src/components/spot/FreightDashModal.jsx`** (full rewrite).
  Slot-based tiers, NO synthetic comparison. Per Item mode shows N solo
  shipments; Per Job mode shows scenarios with combined-shipment allocation.
  Includes comparison banner, savings recommendation, carrier-options table
  with FedEx/UPS placeholders, FOB/Type/Markup bar, QTY+ITEMS filter chips.
- **Rewrote `FreightPanel.updateFreight`** to compute BOTH Per Item AND Per
  Job in a single click — fires N+M UTS quotes (parallel from the FE) and
  caches results in `state.freightDashCache`. Toggling the Per Item/Per Job
  tiles becomes instant (no re-fetch) via new `applyScopeFromCache` helper.
- **Backend: process-wide `asyncio.Lock` on UTS `_uts_rate_estimate`** —
  UTS rejects concurrent same-session calls with HTTP 500; serializing them
  server-side lets the frontend fire calls in parallel safely.
- **Bugfix: `parseInt("null") === NaN` filter bypass** — cloud's draft
  serializer writes the literal string `"null"` into empty qty slots, which
  slipped past `q <= 0` checks. New `_parseQty` helper coerces NaN→0.
- **Verified live on Jamestown 3-component quote** (D/C Tray 1X @ 42 + Tray
  2X @ 168 + Carton @ 2,352 to ZIP 14227):
  - Per Item: $527.08 (3 solo UTS quotes)
  - Per Job: $199.28 (1 combined LTL allocated by weight share — Tray 1X 7.9%,
    Tray 2X 13.2%, Carton 78.9%)
  - Savings: $327.80 (62.2% cheaper together) — recommendation banner fires
- **Two new bomItem state fields**: `freightByQty[slot]` (solo, Per Item) and
  `perJobFreightByQty[slot]` (allocated share, Per Job). Engine reads
  `freightByQty[selSlot]` as before — applyScopeFromCache swaps which cache
  populates it on mode toggle.


### 2026-06-05 — Entra SSO live in preview ✅

### 2026-06-05 — Freight Dashboard P0 follow-up fixes ✅
- **Bug: missing freight on multi-qty scenarios** — root cause was K8s ingress
  60s timeout. With 9-12 UTS quotes serialized server-side (~10s each), the
  total batch exceeded the ingress limit. Fix: new `POST /api/freight/quote-batch`
  endpoint + frontend chunks batches to 4 quotes (~40s each) and runs chunks
  sequentially. Verified live with 12-quote multi-qty case (Per Item $1,660.24,
  Per Job $656.80, savings 60.4%).
- **Bug: transit times showing "—"** — field-name mismatch. Backend's
  `allCarriers[].transit` was read as `c.transitDays` in the modal.
  Fixed via fallback (`c.transit ?? c.transitDays`).

### 2026-06-05 (cont.) — Quote Table "Job Totals" rewritten to scenarios ✅
- Removed the nonsensical sum-of-all-rows "Quote Grand Total" for multi-qty
  MP-Individual quotes (it was adding 9 different prices that represented
  9 different shipment scenarios — meaningless number).
- New Job Totals footer shows ONE row per scenario:
  - "Scenario N · A@qty + B@qty + C@qty"  (uses each component's actual
    qty in that scenario; single-qty components repeat, multi-qty advance)
  - Columns: Total Pcs · Items · Die · Prepress · Per-Job Freight · Job Total · Price/PC
  - Each "Job Total" cell is the real shippable number for that scenario
- Verified live against Jamestown 3×3 quote — Scenario 1 ($9,076) /
  Scenario 2 ($12,349) / Scenario 3 ($15,559).
- Single-qty quotes keep the existing single-row footer + Grand Total
  (no UX regression for the simple case).
- PDF rewrite (Monday item A) will reuse the same scenario grouping logic.


- User confirmed first successful Microsoft round-trip on
  `ariley@standardprinting.com`. SSO end-to-end working: Microsoft login →
  callback → user upsert with admin role (bootstrap allowlist) → JWT issued
  → SPA lands signed in.
- Preview Entra creds wired in `/app/backend/.env` (tenant
  `019353eb-…`, client `2ac83fa8-…`). Prod will need its own client
  secret + APP_BASE_URL.
- MSAL gotcha resolved: removed `openid/profile/email` from explicit scopes
  list — MSAL auto-adds them and raises "reserved scope" ValueError if you
  pass them yourself. `auth_entra.py` now passes `scopes=[]`.

- **Auto-Route resolver parity** verified already correct (`engine/routing.py`
  L490-513). Crest route stays `viable=True` even when sheet rule inches >1000
  — only a warning is attached; the cheapest viable route still wins, matching
  legacy spot_r1_5.jsx L743-749 verbatim.
- **Combined-shipment freight weight (P0)** — ported legacy `calcShipment`,
  `calcBoardWeight`, `autoSelectSkid`, `calcPiecesPerSkidLayer` verbatim into
  `/app/frontend/src/lib/shipment.js`. `RightDashboard.FreightPanel` now
  computes each component's own weight (grade-derived board lbs/MSF × MSF ×
  1.05 + per-component skids using flute caliper + auto-skid sizing), sums to
  combined LTL weight, fires ONE UTS quote, then allocates per-component by
  weight share. Matches legacy `updateAllFreight` L4314-4395 exactly.
  Verified live: 90210 destination → 4 skids · 954 lbs combined · $616.92 LTL,
  allocated correctly across 3 BOM items by weight ratio.
- **Microsoft Entra ID SSO scaffolding** (Phase 5a):
  - New `/app/backend/routes/auth_entra.py` — full OIDC Authorization Code
    flow via `msal.ConfidentialClientApplication`. Endpoints:
    - `GET /api/auth/entra/login` → 302 to login.microsoftonline.com
    - `GET /api/auth/entra/callback` → exchange code, validate domain,
      upsert user, issue internal JWT, 302 to `/auth/callback?token=…`
  - Domain restriction: `@standardprinting.com` only (configurable via
    `ALLOWED_EMAIL_DOMAIN` env var)
  - First-login admin allowlist: ariley, jlittle, rwalter, gkistler, mmusgrave
    (`SSO_ADMIN_EMAILS` env var)
  - State cookie signed via `itsdangerous.URLSafeTimedSerializer` (10-min TTL)
  - New `/api/auth/config` endpoint exposes `{sso_enabled, sso_required,
    allowed_domain}` for the SPA login screen
  - `/api/auth/login` now respects `SSO_REQUIRED=true` (returns 403)
  - `User` schema extended: `auth_provider` ("local"|"entra"), `entra_oid`,
    `password_hash` defaults to "" for SSO-only users
  - Frontend: `AuthContext` captures `?token=…` on `/auth/callback`, stores
    in localStorage like the password flow does. `LoginPage` conditionally
    renders a Microsoft button (testid `entra-sso-btn`) and hides the
    password form when `sso_required` flips to true.
  - Env stubs added to `/app/backend/.env` — Entra creds blank for now;
    endpoint returns 503 + UI hides the button gracefully until credentials
    are provided.
  - Tested 100% (8/8 backend pytest + 3/3 frontend flows) — iteration_13.json

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

### 2026-06-03 — MP-7 Freight tile swap by quote type ✅
- **RightDashboard Freight panel** TYPE tiles now swap based on quote type:
  - **Simple**: `None | Line | Amort` (`freightTreatment` field, legacy parity)
  - **Multi-Part**: `None | Per Item | Per Job` (`freightScope` field, legacy parity)
- Per Job mode replaces per-item inputs with a pointer card to
  Pricing Strategy → Job-Level Cost Allocation (where the $/method live)
- None mode in MP shows a clean "No freight" indicator
- Per Item mode (MP default) keeps the existing per-item Ship-To/ZIP/markup UI

### 2026-06-10 — Storage Bin v3 Parity Audit (Iter 17) ✅
- **Backend**: `runner.py` now surfaces `routing.warning` as top-level
  `routeWarning` field in the engine response (legacy spot_r1_5.jsx L811-814).
  When `auto_route` falls back to Saber+D/C because no Crest/Bobst route is
  viable AND CAD hours exceed the gate, the warning string
  "Too many CAD hours and no Crest/Bobst route viable — falling back to
  Saber + die cut" reaches the frontend instead of being silently dropped.
- **Frontend `QuoteTableSec.jsx`**: New orange banner above the qty rows
  renders any unique `routeWarning` strings from the row results
  (`data-testid='qt-route-warning-{i}'`). Dedupes across multi-tier rows
  and across component pricing in matched-set mode.
- **Frontend `RightDashboard.jsx` Cost Buildup detail**: SubRow now uses
  `r.cutterBasis` prefixed with `r.route` (e.g. "Saber + D/C 569 in/pc x 1
  out x 1.15 = 655 in/sh"), falling back to the difficulty label when
  cutterBasis is empty.
- **Frontend `ItemSetupSec.jsx` auto-flip useEffect**: When the engine
  reports `_pipeline.corrFlipped=true`, the frontend now mirrors that into
  UI state — swaps `oneUpW`/`oneUpL` and sets `state.corrFlipped=true` so
  the "⇄ Flip Corr" button turns red as "⇄ CORR FLIPPED". A ref-based
  guard prevents a re-flip loop when the user manually un-flips.
- **Tests**: New `/app/backend/tests/test_route_warning.py` (3/3 PASS) +
  6/6 below_min regression PASS. Testing agent iter17 verified CORR
  FLIPPED end-to-end in the live UI.

### 2026-06-10 — Production-Reported Bugs (User Round 2) ✅
- **Bug 1 fixed**: Customer IDENT now persists per-component when switching
  between BOM tabs in Multi-Part Individual mode.
  - `custIdent` moved from `JOB_LEVEL_KEYS` to ITEM-LEVEL in
    `/app/frontend/src/lib/mpSchema.js` (legacy parity, spot_r1_5.jsx L2675-76).
  - Added explicit defensive safety net in `gatherItemState` +
    `applyItemStateTo` that handles `custIdent` regardless of the
    schema-driven ITEM_LEVEL_KEYS list.
- **Bug 2 fixed**: BOM component name in the BOM strip is now display-only
  (`<span>`, not `<input>`). Name editing only happens in the BOM Builder
  modal or via the Item Description field. `/app/frontend/src/components/spot/Placeholders.jsx`.
- **Bug 3a fixed**: Selecting Multi-Part on a fresh quote auto-opens the BOM
  Builder modal (legacy parity, spot_r1_5.jsx L5142). Only fires on the
  Simple→Multi-Part transition. `/app/frontend/src/components/spot/EstimateInfoSec.jsx`.
- **Bug 3b fixed**: BOM Builder header restructured:
  - Row 1: `BOM Builder · {n} items · Templates/Manual · ×`.
  - Row 2 (separate section): `PROJECT NAME` label + full-width centered
    input with placeholder "Overall project name...".
- **Pricing parity audit**: Reverted the 2026-06-01 "PARITY FIX" in Crest
  stock-candidate ranking (`evaluate_routes` lines 458-463). Cloud now uses
  `boardSpec` (original spec grade) for stock-candidate cost — matches
  legacy spot_r1_5.jsx L701. Same root cause as the Buy Min bug fixed
  earlier today.
- All 6 pytests pass; testing agent iter 16 reports 100% pass on all 4 items.

### 2026-06-10 — D-070 Inline Board Card Warnings & Buy Min Logic ✅
- **Legacy parity**: 1:1 port of `spot_r1_5.jsx` L5894-5995 (Board status bar)
  and L6992-6995 (Economics substitution banner).
- **Backend `runner.py`**:
  - Added `_pipeline.belowMin` flag on all engine results.
  - When `buyMinBoard==="No"` and below mill min, runner now returns a
    partial-row result (no error) carrying `belowMin: true`, zeroed money
    fields, plus layout/sheet/grade so the Quote Table can render red
    "Below Min" cells (legacy spot_r1_5.jsx L1111, L8366 parity).
- **Frontend `ItemSetupSec.jsx`** Board tile editor footer:
  - Added `Buy Min — amortize` button (`board-buy-min-amortize-btn`) when
    below min and Buy Min not yet on.
  - Added `× Turn off Buy Min` button (`board-turn-off-buy-min-btn`) when
    Buy Min is active.
- **Frontend `QuoteTableSec.jsx`**:
  - New tbody branch for `r._pipeline.belowMin === true`: orange row tint
    with red "Below Min" text in Sell/Pc and Job Total cells; other money
    cells show `—`.
- **Frontend `RightDashboard.jsx` EconomicsPanel**:
  - Added board-substitution banner at top (`econ-board-sub-banner`):
    orange `⚠ Board substitution — decision needed`, green
    `✓ Stock substitution approved`, or blue
    `ℹ Spec'd board — custom order` based on `boardSubstitution` state
    (per user explicit ask "Spec'd board - custom order in blue").
- **Tests**: 5/5 pytest pass in `/app/backend/tests/test_below_min.py`.
- **No external/separate warning panel** — strict legacy parity preserved.

### 2026-02-11 — BUG-2026-02 fix: Job Freight allocation 3-way mismatch
- **Symptom (user)**: $70 LocalDelivery Per-Job freight in MP-Individual showed
  inconsistent amounts across Quote Table component rows, Quote Table footer,
  and the Cost Buildup One-Time line item.
- **Root cause**: `buildMpPayload` in `useEngine.js` did NOT include the
  top-level `freightMarkup` key. Backend `engine_routes.py` therefore defaulted
  to 0.15 and applied 15% markup to the per-component allocation even on
  LocalDelivery (where markup should be 0). Aggregate `slots[0].freightLine`
  added the RAW `jobFreightCost` ($70) — not markup-adjusted — creating a
  three-way mismatch between component rows ($80.50 total), footer ($70) and
  Cost Buildup ($70).
- **Files changed**:
  - `/app/frontend/src/hooks/useEngine.js` — added `freightMarkup` to MP payload.
  - `/app/backend/routes/engine_routes.py` (L416) — aggregate now uses
    `jobFreightCost * (1 + freightMarkup)` to match componentPricing rows.
    Legacy parity: spot_r1_5.jsx L3442 `allocateJobCost(items, slotFreight*(1+freightMarkup), ...)`.
  - `/app/frontend/src/components/spot/QuoteTableSec.jsx` (L771) — footer
    `perJobFreight` display now applies markup (0 for LocalDelivery, else freightMarkup).
- **Tests added**: 8 new pytest cases in `test_per_job_allocation.py`:
  `TestLocalDeliveryByWeight` (3 tests) and `TestShipPerJobAggregateConsistency` (3 tests).
  Total 11/11 passing.
- **Verified**:
  - LocalDelivery $70 + 0% markup → components sum $70.00, aggregate $70.00, raw $70.00 ✅
  - Ship $70 + 15% markup → components sum $80.50, aggregate $80.50, raw $70.00 (label shows "$70 + 15% markup") ✅


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
- **Board Cost editor for `base_matrix`** (P1 — sister feature to above): ✅ **DONE 2026-06-17 (Phase 1+2)**
   * Versioned board-pricing snapshots (`pricing_versions`) + per-quote FREEZE (pin at save; re-price only via Duplicate). v1 baseline = 4.14.25 in-code rates; all existing quotes backfilled.
   * Admin "Board Pricing" tab: xlsx import (base_matrix only — adders carried forward) → diff review (per-cell old→new→Δ%, uniform-% detection) → deliberate Activate. Board Engine panel + engine calc both read the active version.
   * Verified on the real 6/15/26 list (uniform +6.5%, 172 cells). Engine parametrized via ContextVar overlay (`engine/core.py`); golden-$ parity test pinned to baseline.
   * ✅ **Phase 3 DONE 2026-06-17 (frozen-quote guardrails):** Save no longer duplicates/re-pins (update-in-place); material-edit warning fires once per open on frozen quotes with "Keep frozen pricing" / "Duplicate at current pricing (as last saved)" choices; amber tab coloring (❄ + data-frozen) + "❄ Frozen — {date}" chip in Estimate Info; Estimate # locked on any saved quote. Tested iter33 (8/8).
   * Bulk-% increase tool ("apply +5% to all 200# rates") and manual per-cell edit in the diff screen — deferred P2 (importer covers the supplier-list use case).
- "Request New Sheet" estimator workflow (queue → admin approves → enters library) — **P2**
- Separate `bom_items` MongoDB collection (currently in `quote_drafts.state` JSON blob) — **P3**
- Phase 5a: Entra SSO — **P2** (user owns this, 2026-06-03 afternoon)
- Phase 5b: SharePoint customer sync — **P2** (user owns this)
- Phase 5c: SharePoint PDF archive — **P2** (user owns this)
- Side-by-side last-accepted quote comparison in Preview modal — **P3**
- Quote analytics / win-loss reporting — **P3**
- ERP/Automator API integration — **P3**
- Multi-Part-aware "BOM Template" library (re-use display skeletons) — **P3**
- Auto-persist email attachments as their own rows in "Saved RFQ files" — **P2**
  (so CAD PDF inside an .eml shows in the saved-files panel without drilling into the email)
- "📎 N files" pill on each Load Quote modal row — **P3**
  (estimators see at a glance which quotes have attached RFQs before opening)
- Saved-quote categorization & filters in Load Quote modal — **P2**
  (filter/group by: Multi-Part vs Individual quote type, Customer, Project Name,
  status, owner — faster lookup as the quote library grows. Builds on the
  existing scope/owner filters; add quoteType + custName + custRef filter chips
  plus an optional groupBy selector.)

### 2026-06-12 — Die UX + Route Comparison legacy parity (Iter 22)
- **Die row in Item Setup → always visible** on EVERY route (no more `anyDieRoute` gate). Estimator can set None/Line/Amort + cost + markup per component regardless of routing.
- **Default die for net-new BOM components**: `Separate Line` / `$1,200` / 15% markup, auto-applied in `mpSchema.freshItemState()`. Net-new MP components ship a die by default — user clicks "None" to remove. Did NOT change global `DEFAULT_STATE` so single (non-MP) quotes remain die-free at start.
- **Tile click smart-fill**: clicking "Line" or "Amort" on a fresh row auto-fills `$1,200`/15% if cost was zero. Clicking "None" clears cost back to `0`.
- **Indirect-section "Die: None" row hidden** when `dieEmbedded = 0` (legacy parity — no zero-value Indirect die row).
- **Backend dieTreatment default** now mirrors legacy `spot_r1_5.jsx L3782`: `"Separate Line"` when `cuttingDieCost > 0`, `"None"` otherwise. Closes the regression where MP-Matched-Set components with persisted die costs silently produced $0 line charges in cloud.
- **Route Comparison panel** now matches legacy `spot_r1_5.jsx L3686 + L6909`:
  - Hidden entirely when `compareRoutes` returns no viable CAD+Crest pair (returns null) — e.g. 275 DW B/C is unstocked AND not Crest-eligible → no panel at all.
  - Default collapsed (`showRouteComp = false`); estimator clicks header to expand.


- **Per-component Die chip on BOM tabs** (legacy spot_r1_5.jsx BOM-row parity): Each BOM tab in MP now has a clickable "+ Die" / "Die $X" chip. Click opens a small popover with None/Line/Amort + cost input + "$1200" quick-set. Persists to per-item state — works for active AND inactive items. New `updateBomItemState(idx, patch)` helper in QuoteContext writes to top-level (active) or `bomItems[idx].state` (inactive). This unblocks ALL non-Crest/Bobst die scenarios (Saber+D/C, CAD routes) that previously had no UI affordance and resolves the "Line Charges $0 vs legacy $6,900" gap as soon as the estimator clicks the dies in.
- **`Too many CAD hours…` warning component-scoped**: matched-set slot's `routeWarning` now surfaces only the ACTIVE component's warning (was aggregated across all components, which incorrectly persisted when switching to a non-CAD component). engine_routes.py L527.
- Die row in OneTimeCosts panel REMAINS HIDDEN on non-Crest/Bobst routes (legacy parity, per user request).
- Removed `corrFlippedManual` saved-state guard from auto-flip (was a stale-persistence trap from prior session).
- Documented: for unstocked corrugation (e.g. 275 DW B/C), `flipWouldHelp` correctly returns false in both legacy and cloud because neither orientation is pricable (below mill min) AND there's no stock to fall onto. Flipping is mathematically inert for unstocked grades — same dim adders apply both ways. Legacy "CORR FLIPPED" badges on Mid Disks were manual toggles, not auto-engages.


- **Bug A (P0, ~$6,900 of L'Oreal gap)**: Auto-applied die charges on Crest/Bobst/**Saber + D/C** routes for multi-part components. Moved legacy spot_r1_5.jsx L3866-3883 `useEffect` logic from frontend (active-tab-only) into backend engine (`runner.build_prod_inputs`) so EVERY component that resolves to a die-using route gets the default die ($1200 Crest / $1800 Bobst / $1200 Saber+D/C) — not just the active BOM tab. Saber+D/C is the legacy fallback "Saber + die cut" route, also requires a steel die.
- **Bug B (P0)**: Cost Buildup "Finishing" row now sums `stripCost + assemblyCost`. Detail view splits into Stripping + Glue/Tape subrows.
- **Bug C (P0)**: Matched Set top rollup shows **SELL TOTAL** (merchandise), with "Line Charges + Quote Total" breakdown line below — exactly matching legacy.
- **Bug G**: `Cost/Pc` → 2 decimals. `Sell/MSF` and `Cost/MSF` show **dollars and cents** ($773.57, not $774).
- **Bug H**: "Print" row hidden in Cost Buildup when `printDirect === 0`.
- **Bug I (CORRECTED)**: Big metric labels are **"Sell Total"** (matched set + active component). Cost Buildup PRICING section ends with "Sell Total $X" then "Sell/Pc". Then "ONE-TIME LINE ITEMS" SubHead → Die row → final **"Quote Total"** RowTotal at the bottom (always shows, equals Sell Total when no line items).
- **Material `$/MSF`**: now uses `matPerMsf` (= matTotal/oMSF) matching legacy spot_r1_5.jsx L7119, not `effRate` (excluded pallet prep).
- **MR/Spoil Board**: shows extra-sheet count ("6 extra sheets") sourced from new `extraSheets` engine field.
- **"Cutting CAD" → "Cutting"** label only; subrow continues to show "CAD Standard".
- **Active Component "Sell/Pc"** uses `r.sellPc` (= sellTotal/qty, matches legacy $1.27 when die present).
- Reverted previous misguided ItemSetupSec.jsx "always-show Die row" — Die row gated to Crest/Bobst routes only (legacy parity).
- New regression test: `/app/backend/tests/test_auto_die.py` (7 cases — Crest/Bobst/Saber+D/C defaults, CAD no-op, user-set preserved, Amortize-opt-out, 5-component aggregate). All PASS.
- Surfaced `dieAutoApplied`, `dieBase`, `dieTreatmentEffective`, `matPerMsf`, `extraSheets`, `mkSheets`, `spoilSheets` on engine result; `dieBase`, `dieEmbedded`, `stripCost` on `rows_out` for accurate per-component buildup display.
- Multi-part aggregator now reads `dieBase` from engine result (not payload state) so auto-applied dies contribute to `dieBaseTotal`.

## 9. Deployment
- Preview URL: `https://spot-estimator.preview.emergentagent.com` (this dev sandbox)
- Production URL: TBD (deploy ahead of 2026-06-02 11:30 AM demo recommended)

## 10. Demo (2026-06-02 11:30 AM)
- Login: `admin@standardprinting.com` / `spot-admin-2026`
- Reference RFQs: Tavens, Lynk Packaging, AFA M85002
- Demo flow: drop .msg → progress modal → review parsed fields → save → preview PDF → export

## 11. L'Oreal Grippy Chipper open items (next session)
- **Bug D (P1, ~$2,400)**: Board cost may use rounded dimensions. Audit `engine/core.py::calc_board` vs legacy `spot_engine.js::calcBoard` for sheet sqft computation.
- After D fixed: re-run the full L'Oreal 12-component quote — target ≤$50 delta vs legacy $593,389.67.
- Comprehensive automated parity test suite for L'Oreal quote — blocked on D fixed.

### 2026-06-12 — Economics panel P0 regression cleanup ✅ (Iter 19)
- **Line Charges $0.00 → $6,900 (P0)**: Die row was hidden when route ≠ Crest/Bobst (commit b5ee596). Saber+D/C and CAD components couldn't carry a die → `line_die` summed to 0 → Matched Set "Line Charges" displayed $0. Reverted: Die row now visible on ALL routes with a "(non-Crest/Bobst route — die optional override)" hint when route is resolved and not Crest/Bobst. Backend `runner.build_prod_inputs` still auto-injects defaults only on Crest/Bobst per legacy spot_r1_5.jsx L3870.
- **Corr Flipped not triggering on Mid Disks 1/2/3 (P0, $361.60 delta)**: Cloud's auto-flip useEffect evaluated `hasIssue` against POST-buy-min `boardHasPrice/boardMeetMin`, but legacy evaluates against PRE-buy-min `sel.bc` (separate useEffect ordering — flip fires before buy-min auto-enable). Fix: `runner.py` STEP 6 captures `bc.hasPrice/meetMin/pricable` snapshot BEFORE buy-min auto-enables, exposes as `_pipeline.preBuyMinHasPrice/preBuyMinMeetMin/preBuyMinPricable`. `ItemSetupSec.jsx` auto-flip useEffect now reads those instead. Removed the erroneous `!buyMinActive` runtime gate that was the original suppression source.
- New regression test: `/app/backend/tests/test_pre_buy_min_snapshot.py` (3 cases — single-component pre-buy-min snapshot exposure + flipWouldHelp + multi-part per-component _pipeline propagation). All PASS.
- Backend pytest 99/100 (1 pre-existing `test_estimator_cannot_access_admin_rates` unrelated to this work). Testing agent iteration 19 verified all fixes at source + runtime.
- Bug E/F (Corr Flipped condition mismatch) now considered **RESOLVED** by the pre-buy-min snapshot fix; collapse the two into a single closed item.


### 2026-06-12 — Session 3: math parity closed + PDF parity + 4 P1/P2 features ✅
**$361.60 delta — RESOLVED as a legacy UI quirk (no code bug).**
- Legacy's "Preview Quote" total reads from the mixed-state `setTotals` aggregate (spot_r1_5.jsx L4602, L7633), which uses `calcResults` (live) for the active item and `runItem` (simplified) for the other 11 items. The two paths differ on `routeOverride`, `overrideSheetId`, live `prepressTreatment`, top-level `quoteFOB` — producing slightly different per-item sells. Legacy Preview total is therefore **non-deterministic** (changes based on which BOM item was active when Preview was clicked).
- Cloud always uses the full engine for every item → deterministic $593,751.27 (the math-correct total). Confirmed via my Node legacy_replay.js using legacy's own `spot_runner.runEstimate` — agrees with cloud to the cent.
- User verification: clicked Item 2 in legacy → Sell/Pc jumped from $0.69 (runItem) to $0.72 (calcResults), matching cloud's stable $0.7164. User accepted "I want the real numbers". Issue closed.
- Locked with `/app/backend/tests/test_matched_set_parity.py` (per-component + slot aggregation). 4/4 PASS.

**Per-piece display fixes**
- BOM Per-Component table Sell/Pc: was using `pc.sellPc` (backend = `sellTotal/qty`, all-in) → switched to `itemSell/qty` (legacy `spot_r1_5.jsx` L4655). Item 2 now shows $0.72 not $1.27.
- New BOM components default to **Die: None** (was auto-defaulting `Separate Line / $1,200` which produced phantom dies on items legacy showed none).
- Removed auto-add-die-on-Crest/Bobst route logic (legacy never auto-added dies — always user-specified).
- Individual mode component qtys now multiply by `pcsPerSet` (legacy `spot_r1_5.jsx` L2071-2075 parity — pre-multiplied in legacy state.qtys at BOM commit; cloud multiplies at runtime).
- Estimate Info Qty input flips label to `Qty × N` and displays component-level pcs in Individual mode.

**PDF parity — Matched Set per-component pricing grid**
- Replaced cloud's aggregate pricing table with legacy's per-component grid (spot_r1_5.jsx L4639-4702): each component × set-qty tier showing clean `itemSell/qty` Sell/Pc, Price/Set row, Die/Freight/Prepress/Misc line-charge rows (only when > 0), QUOTE TOTAL row, SETS row.
- Removed the orange "Item 1" / "Multi-Part" item bar from both MP-Matched Set and MP-Individual modes.
- Individual mode per-component sections dropped Freight/Die/Prepress columns (4-col `Qty | Each | Per/M | Total`); footer "Job Totals" → "Quote Summary".
- Same changes applied to in-app `PreviewPdfModal.jsx` (new `MatchedSetPricingGrid` component).
- Locked with `/app/backend/tests/test_matched_set_pdf.py` (2 tests).

**Item 1 — Save parser files (quote-lifetime)** ✅
- New `services/parser_files.py` + Mongo collection `parser_files`. Each `/api/parser/parse-rfq` call persists raw uploads to `/app/backend/uploads/<draft_id>/<file_id>.<ext>` with sha256, mime, uploaded_by, source, parent_filename metadata.
- New endpoints: `GET /api/parser/files?quote_id=…`, `GET /api/parser/files/{id}/download`, `DELETE /api/parser/files/{id}`.
- `FilesSec.jsx` shows a "Saved RFQ files" panel listing all persisted files for the draft, with per-file download (↓) and delete (×) buttons.
- Quote lifetime: `delete_draft` handler now calls `purge_quote_files(draft_id)` to sweep disk + metadata.

**Item 2 — Inline spinners (no more full-screen overlays)** ✅
- UTS spinner: removed `ProgressModal`, added a small pill inside `FreightDashModal` header (orange, with destZip).
- Parser spinner: removed `ProgressModal`, added an amber inline pill inside `FilesSec` section header ("PARSING RFQ" with spinning dot).
- Added shared `@keyframes spot-spin` to `theme.css`.

**Item 3 — Parser accepts .zip uploads** ✅
- Backend: on `/api/parser/parse-rfq`, any `.zip` upload is opened in-memory (`zipfile` stdlib), each member validated by extension + size, flattened, and threaded into the existing email-expansion + non-email loops via a `_ZipMemberShim`.
- Caps: 50 MB compressed zip, 100 members, 30 MB per member. Skips `__MACOSX/`, dotfiles, directories, unsafe extensions.
- `file_summary` reports per-zip `members_added` / `members_skipped`.
- Frontend: added `.zip` to the RFQ extension regex in `FilesSec.jsx`.
- New test: `/app/backend/tests/test_parser_zip.py` — 1/1 PASS (validates 2 safe members extracted, junk skipped).

**Item 4 — Sheet Library legacy parity** ✅
- Backend: new `POST /api/engine/sheet-library` returns ALL approved + stock sheets enriched per-row with `pcsPerSheet, sheetsReq, wastePct, costMsf, costPc, total, pricable, hasPrice, specMatch, isStock`. Internally iterates `APPROVED_SHEETS` (216 sheets) + payload `stockSheets`, runs `compute_layout` and `calc_board` per row, falls back to flipped orientation when natural fit fails. Sorted: spec-match first, then by total PO asc.
- Frontend: rewrote `SheetLibraryModal.jsx` from 122-line card grid to legacy-parity 280-line table:
  - Header w/ "Current spec / All specs" toggle and best-match subtitle.
  - Search box (filter on dims/grade/flute/liner text).
  - Add Stock W × L → persists in `s.stockSheets` (per-quote, like legacy). Stock rows tagged STOCK and deletable per-row.
  - Sortable columns: Sheet | Flute | Grade | Outside | Inside | Type | Pcs/Sh | Sheets | Waste | $/MSF | Cost/Pc | Total PO.
  - Best-priced spec-matching row highlighted GREEN with `BEST` badge; user override row highlighted ACCENT with `ACTIVE` badge.
  - Actions per row: `Use This` (sets `overrideSheetId`, closes modal), `Remove` (clears override), `Del` (deletes stock).
  - Footer: Clear Override / Clear All Stock / row counts.

**Test summary (this session): 11/11 PASS** — test_matched_set_parity (2), test_matched_set_pdf (2), test_preview_pdf (5), test_parser_zip (1), plus existing test_pre_buy_min_snapshot from prior session. No regressions.



### 2026-02-15 (cont.) — Saved RFQ files persist across Save/Reload ✅ (Iter 23)
- **User report (prod)**: After saving a quote and re-opening it later, the
  attached RFQ files were not visible/loadable. Critical regression — files
  must be accessible throughout the quote lifecycle.
- **Root cause**: `parser_files.quote_id` was stamped with `active.id`
  (the local React tab id like `local-abc123`). On first autosave the tab id
  flipped to a server-generated draft uuid → files orphaned. On Save Quote
  a fresh quote uuid was generated and written to `state.quoteId` → orphaned
  again.
- **Fix**:
  - Backend: `services/parser_files.py::reassign_quote_files(from, to)` +
    `POST /api/parser/files/reassign` endpoint (re-keys docs via update_many,
    disk paths are absolute so preview/download still resolve).
  - Frontend autosave (`QuoteContext.jsx`): on `local-xxx → draft-uuid`
    promotion, calls `reassignParserFiles(oldId, created.id)`.
  - Toolbar `onSave` (`Toolbar.jsx`): after `createQuote`, calls
    `reassignParserFiles(active.id, saved.id)` so the saved quote owns the
    files going forward.
  - `FilesSec.jsx`: `filesQuoteId = state.quoteId || active.id` used for
    both listing and upload, so a reloaded saved quote queries the right id.
  - `FilesSec.runParseDirect`: refresh the saved-files panel in a `finally`
    block — files are persisted BEFORE the Anthropic call, so even on parse
    failure (budget/timeout) the file appears immediately.
- **Tests**: `tests/test_parser_files_reassign.py` (2/2) +
  `tests/test_parser_files_reassign_http.py` (created by testing agent, 5/5)
  — full local→draft→quote lifecycle covered.

### 2026-02-15 (cont.) — BOM Builder qty-edit dimension-wipe fix ✅ (Iter 21+22)
- **User report (prod)**: re-opening BOM Builder on an MP quote and changing
  default qtys silently wiped every component's `oneUpW/L/totalRuleInches/
  qtys/boxStyle`. Round-trip lost all per-item state.
- **Root cause**: `convertToMultiPart` unconditionally rebuilt every item via
  `freshItemState({...seed})` where seed only carried shared fields
  (flute, grade, liners, print). The per-item dim/rule/qty fields were never
  passed through the BOM Builder draft rows.
- **Fix 1** (`BomBuilderModal.jsx`): on prefill, capture each existing item's
  `state` into a new `_existingState` field on the draft row.
- **Fix 2** (`QuoteContext.jsx::convertToMultiPart`): branch on
  `row.existingState`: when present, preserve it verbatim and override only
  `qtys` and `itemDesc`.
- **Fix 3** (`QuoteContext.jsx` new `snapshotActiveItemState()` + wired into
  Edit-in-BOM-Builder button): mirror unsaved top-level edits into
  `bomItems[activeIdx].state` before the builder reads them.
- **Verified live (iter22)**: persisted Items 1+2 dims (10x20, 15x25) survive
  default-qty + pcs/set changes; in-flight Item 3 dims (7x14) preserved.


- **User report (prod)**: re-opening BOM Builder on an MP quote and changing
  default qtys silently wiped every component's `oneUpW/L/totalRuleInches/
  qtys/boxStyle`. Round-trip lost all per-item state.
- **Root cause**: `convertToMultiPart` unconditionally rebuilt every item via
  `freshItemState({...seed})` where seed only carried shared fields
  (flute, grade, liners, print). The per-item dim/rule/qty fields were never
  passed through the BOM Builder draft rows.
- **Fix 1** (`BomBuilderModal.jsx` L54-67 + L165-180): on prefill, capture each
  existing item's `state` into a new `_existingState` field on the draft row.
  On `Save BOM`, pass it through as `existingState`.
- **Fix 2** (`QuoteContext.jsx::convertToMultiPart` L524-545): branch on
  `row.existingState`: when present, preserve it verbatim and override only
  `qtys` (from `opts.defaultQtys`) and `itemDesc`. New-build path
  (`row.existingState === null`) still calls `freshItemState({...seed})`.
- **Fix 3** (`QuoteContext.jsx` new `snapshotActiveItemState()` + wired into
  `Placeholders.jsx` bom-edit-builder-btn): edge case caught by iter21 —
  if user typed top-level dims and clicked Edit-in-BOM-Builder without
  switching BOM tabs first, the in-flight edits weren't mirrored into
  `bomItems[activeIdx].state` so the builder's prefill saw stale state.
  New method runs `gatherItemState(top-level) → bomItems[activeIdx].state`
  before dispatching `spot:open-bom-builder` so the builder reads fresh data.
- **Verified live (iter22)**: persisted Items 1+2 dims (10x20, 15x25) survive
  default-qty changes AND pcs/set changes; Item 3's unsaved 7x14 (typed
  immediately before opening builder) is preserved through Save BOM.


- Refactored `/app/backend/routes/parser.py::preview_file` into a shared
  `_build_preview_payload(filename, mime, raw)` helper so any byte blob can
  be rendered with the same kind-switch (pdf/image/text/email/sheet/zip/docx/rtf).
- New endpoint `GET /api/parser/files/{file_id}/attachment/{idx}/preview`
  re-opens a saved .eml/.msg, extracts attachment N, and returns the same
  preview payload — lets estimators view email attachments (CAD pdf,
  customer-supplied spec sheets, etc.) inline without first downloading the .eml.
- `FilePreviewModal.jsx` now keeps a navigation stack — clicking an attachment
  in an email preview pushes a new entry, footer gains a "← Back to {parent}"
  button. Single Close still dismisses the entire modal stack.
- Attachment list in the email preview restyled from `<ul>` to clickable
  rows (↗ icon, hover state) and tagged with `data-testid="file-preview-email-att-{i}"`.
- Tests: `/app/backend/tests/test_email_attachment_preview.py` (4/4 PASS) —
  validates extract→PDF payload, CSV payload, unknown-kind fallback.


**Quote Table Sell/Ea + Sell/M toggles (P0)** — Fix `/app/frontend/src/components/spot/QuoteTableSec.jsx::FlatLayout.computeSellDisp`.
- In Matched Set mode, aggregated rows have `r.qty == setQty` and `r.itemSell == job_sell`, so the previous `perEa = r.itemSell / r.qty` gave the *set aggregate price* for all three cycle modes (Sell/Set, Sell/Ea, Sell/M became indistinguishable to the user).
- Legacy reference (spot_r1_5.jsx L6223): Sell/Ea and Sell/M pull the ACTIVE component's per-piece values (`w.itemSell / r.totalQty`), Sell/Set pulls `setTotals.sellPerSet`. After fix, cloud reads `r.perComponent[activeItemIdx].itemSell / .totalQty` for Ea/M in Matched Set — switching the active BOM item now correctly changes Sell/Ea while Sell/Set remains the set aggregate.
- L'Oreal fixture verification: with Bot Disk 1 active, Sell/Ea = $7.5016/pc (vs. the old buggy $234.74 which equalled Sell/Set); cycling through 12 components yields 12 distinct per-piece values matching legacy.
- Header tooltip updated to reflect the actual cycle path (Ea → M → Set in Matched mode, Ea ↔ M otherwise).
- Single-Part path unchanged (verified live by testing agent iter 20: Ea↔M cycle only).

**Bug D — Board cost dimensions (P1)** — Audited `engine/core.py::calc_board` vs legacy `spot_engine.js::calcBoard`: both use `(lengthIn * widthIn) / 144` on full-precision floats. No rounding regression existed. Tightened `engine/routing.py::select_override_sheet` to format the `OVR-{w}x{l}` id with `{:g}` so fractional sheet dims (e.g., 63.5×126.25) round-trip through MongoDB without precision loss — previously `int()` truncation was display-only but could trip a future caller that parses the id back to dims.

**Test status**: 110/113 backend pass (3 pre-existing failures: 2 Entra config tests expecting 503 in unconfigured env + 1 admin RBAC test). Engine parity suite (matched_set_parity, multi_part, route_parity, pre_buy_min_snapshot, below_min) — 33/33 PASS. Browser verification: Matched Set tile-pricing toggle confirmed working; Quote Table cycle confirmed (Set $0.93 → Ea $0.93 → M $926.20 on a single-component-priced quote, identical because only the active component had a non-zero sell).


### 2026-06-18 — P0: Async parse + Internal Cost Report ✅
- **Async RFQ parsing** (fixes 502/520 on large CADs): `POST /api/parser/parse-rfq-async`
  returns a `job_id` (202) immediately; background `asyncio` task runs the slow Anthropic
  call; `GET /api/parser/jobs/{id}` polled every 3s by the frontend. `parser_jobs`
  collection with a 24h TTL index. Sync endpoint kept for compat. Tests + iter49 PASS.
- **Internal Cost Report modal** (legacy spot_r1_5.jsx L8021-8252 parity): per-component
  17-column cost-buildup cards + Kit Rollup for Multi-Part. Backend componentPricing rows
  enriched with Material/Print/Cutter/Finish/OH/Sheets breakdown. Tests + iter50 PASS.


### 2026-06-23 — Inline parser-correction workflow ✅
- Review Parsed Fields modal: flagged "Needs Estimator Input" fields are now EDITABLE inline
  with plain UI labels + correct controls (select/number/text/customer picker), grouped by
  component for Multi-Part. Estimators fix parser ambiguities in the modal without going to the
  main screens. Simple + Matched Set + Individual all covered. New `lib/parserFieldRegistry.js`;
  edits merge into the apply() patch/state. Tested iter52 (10/11 PASS; custCode picker code-in-
  place but not live-exercised — no custCode ask raised by sample RFQs).
- NEXT (user's remaining big items, this fork): (2) Email Quote feature — build the full UX as a
  MOCK first (compose dialog, editable To/CC + subject/body, auto-attached PDF, mocked send),
  swap in M365 Graph later with IT. (3) Auto-update parser model — add "Auto (latest)" option in
  Admin → Integrations (default latest Opus, with manual pin override), resolving via Anthropic
  `GET /v1/models`.

### 2026-06-23 (cont.) — Saber Cost Buildup + parser scope + qty verify ✅
- Saber cost now appears in the right-rail Cost Buildup "Cutting" line (+ Saber detail sub-line);
  backend exposes `saberRate`. Verified iter53.
- Parser: CADs authoritative for component count; litho/offset excluded+flagged; product mats /
  lightboards (styrene) flagged as in-family-but-not-yet-priced. Verified (3 components, litho in asks).
- Review modal: ALWAYS-ON "Verify Quantities" panel (Simple = 1 input; MP = per-component),
  because the parser frequently mis-assigns qtys. Verified edits land per-component.
- STILL OPEN (out-of-scope decision UX): currently litho/styrene items are flagged in asks for an
  include/exclude decision but there is no one-click "add this excluded component back" control —
  estimator adds it manually via the BOM. Consider a future "include flagged component" button.

### Next P0/P1 backlog (post this session)
- **P0: DB backup strategy** (see MONDAY_LAUNCH_QUESTIONS.md §G — needs frequency/
  retention/destination decision before go-live; sane default = nightly on-disk gz JSON
  dumps + admin "Download Backup" button until SharePoint lands).
- **P1: Per-component validation badges** (Multi-Part — amber on missing dims/qty/etc.).
- **P2: Saved-quote categorization & filters** in Load Quote modal (quote type / customer /
  project name / status).
- **P2/P3: Phase 5 — Ignition customer sync (mocked today), SharePoint PDF archive,
  Cover Letter note field, Admin approval-workflow governance.**
- **P3 (onboarding): "ℹ️ How cutting is priced" explainer tooltip** on the CAD difficulty /
  By-Inches-of-Rule controls (and possibly route selector). Plain-language popover explaining:
  cutting cost = (setup minutes + run minutes) ÷ 60 × $138/hr, with a min-charge floor; setup
  minutes ALWAYS apply and are set by difficulty (Simple 8 / Standard 25 / Complex 22); CAD
  per-sheet min/sheet (Simple 2 / Standard 2 / Complex 4) is used ONLY in Difficulty mode, while
  By-Inches-of-Rule computes run time from rule inches × pieces × 1.15 × sheets ÷ 650 in/min
  (perf runs at 40% speed). Footnotes: difficulty still sets setup in rule mode; Product Mats
  forces setup ≥ Standard; manual sheets/hr override replaces run-time calc but setup still added.
  Goal: help NEW estimators understand the cutting math without asking. (Requested 2026-06-24.)


### 2026-06-30 — Crest toggle removal, search, PDF print mode, LOQ, sent-edit guard ✅ (Iter 64)
- **P0 Crest Std/Adv removed** — toggle gone from UI; engine uses base crest speed + single
  `crestSetup["Standard"]` value (no `crestComplexity`/`crestAdvSpeedFactor`). No rate changes.
- **P0 Load Quote search expanded** — `?q=` matches est#, customer (code/name), project (custRef),
  item desc, estimating initials, owner name.
- **PDF print mode + 1S/2S** added to component summary spec lines (`_print_short` in pdf.py).
- **Letter-of-Quote re-submission** — parser returns `spotQuoteNumber` + `matchedQuote`; FilesSec
  `LoqMatchModal` offers Open Original / Duplicate-as-new (fresh est#).
- **Sent-quote re-open warning** — `SentWarnConfirm` in Load modal; duplicate w/ fresh est#.
- Verified: 13/13 backend, 9/9 frontend (iteration_64), 100%.

### DEFERRED (per user, "address later today")
- **P0 Issue 1: Email Quote fails in PRODUCTION** — ✅ ADDRESSED 2026-06-30. Send is now async
  (job + polling) so it no longer hits the Cloudflare 520 gateway timeout, and the exact MSAL/Graph
  error string is surfaced in the email modal. Awaiting user's prod redeploy + retest to read the
  real Azure error (likely tenant/secret, Mail.Send consent, or ApplicationAccessPolicy).

### 2026-02-XX (fork) — iQuote # search prod fix ✅
- **P0 Load Quote iQuote # search failed in production** (worked in preview). Root cause: MongoDB
  `$regex` silently skips non-string fields. Preview stored `state.iquoteNum` as strings, but many
  legacy prod docs store it as a **number** (Int32/Double) since users typed digits into a numeric
  input in older builds. Fix in `backend/routes/quotes.py::list_quotes`: augmented the `$or`
  clauses so search works regardless of stored type —
    1. keep the existing regex clause (strings),
    2. add `{state.iquoteNum: int(term)}` when term is digits-only,
    3. add `{state.iquoteNum: float(term)}` when term parses as a float,
    4. add an `$expr` + `$toString` fallback for partial numeric matches on numeric-stored values.
  Verified preview: string iQuote `12345` still matches; no regression on other q= fields.
  Awaiting user's prod redeploy + retest (user example: `223864`).

### 2026-02-XX (fork) — Load Quote list: iQuote # column ✅
- Added a dedicated **iQuote #** column between Est # and Customer in the Saved Quotes tab of
  the Load Quote modal (`frontend/src/components/spot/LoadQuoteModal.jsx`). Grid template updated
  from 8→9 columns (added `0.7fr` slot). Cell reads `it.state.iquoteNum`, shows `—` when empty/null,
  tabular-nums font for alignment, ellipsis on overflow. `data-testid="load-iquote-{id}"` on each
  cell for QA. Draft tab unchanged.

### 2026-02-XX (fork) — iQuote # search client-side filter fix ✅
- Follow-up to the backend numeric-iquote fix. User reported production still returned "No quotes
  found" when typing the full iQuote # even though the number was visible in the list. Root cause:
  `LoadQuoteModal.jsx` runs a **second client-side memo filter** on the fetched items, and its
  match fields did not include `state.iquoteNum`. Backend returned the row, client hid it.
- Fix: added `iqStr.includes(t)` to the `filtered` memo with `String(state.iquoteNum)` coercion so
  it matches whether the field is stored as string or number. Type-agnostic.

### 2026-02-XX (fork) — Test checkbox: promote to job-level ✅
- User reported: Test checkbox on a Multi-Part quote appears checked on one component
  and unchecked when they click a different component. Screenshots confirmed on prod.
- Root cause in `frontend/src/lib/mpSchema.js`: `goodForTesting`, `iquoteNum`, `iquoteWon`
  were not in `JOB_LEVEL_KEYS`, so schema treated them as **item-level**. `switchBomItem`
  runs `gatherItemState` (snapshot outgoing) then `applyItemStateTo` (load incoming, reset-
  first) — the reset-first step blanked those flags on every MP tab switch.
- Fix: added the three keys to `JOB_LEVEL_KEYS`. They now stay at quote-level, are never
  copied into any component's state, and are never touched when switching components.
  Toolbar reads top-level state, so the checkbox is now stable across all component tabs
  in a Multi-Part quote. Simple quotes were never affected (no switching).

### 2026-02-XX (fork) — Test flag: heal legacy quotes on load ✅
- Follow-up: user reported the fix worked for NEW test-flagged quotes but LEGACY quotes
  (already saved under the buggy schema) still lost the checkbox on component switch.
  Reason: those quotes have `goodForTesting: true` stored INSIDE the specific `bomItems[i].state`
  where it was first checked, not at the top level. My earlier fix stops writing it to component
  states going forward, but doesn't retroactively fix already-saved data.
- Fix in `healLoadedState`:
    1. **Hoist** — if top-level `goodForTesting`/`iquoteWon` is falsy, OR across every
       `bomItems[i].state`; if top-level `iquoteNum` is empty, take the first non-empty
       component value. Result: box is checked at load-time whichever component the value
       was originally saved under.
    2. **Purge** — strip `goodForTesting`/`iquoteNum`/`iquoteWon` from every `bomItems[i].state`
       after hoisting, so the next save has one source of truth at the top level and unchecking
       actually sticks.
  Applies on both initial fetch and `loadIntoTab` (Load Quote modal).

### 2026-02-XX (fork) — Testing report row shape: align to iQuote per-tier ✅
- User asked to reshape the Testing Comparison export so rows line up with iQuote's structure
  (per-product cost columns + `TotalEstimatePrice` repeated per row within a qty tier). Backing
  fix in `backend/routes/quotes.py`:
    1. `Qty` column now always shows the RAW stored set qty (no pcs-per-set multiplication).
       Matched Set → `state.qtys[slot]`. Individual → each component's own `state.qtys[slot]`,
       falling back to the top-level slot qty. Simple mode unchanged (already raw).
    2. `Die` column in Multi-Part now shows the TIER AGGREGATE
       (`slot.dieLineCost + Σ pc.dieEmbedded`), i.e. every component row within a qty tier shows
       the same die = the right-rail Die shown in the UI. Auto-applied Crest dies (1380/comp)
       aggregate correctly (9 comps → 12,420). Simple mode unchanged.
    3. `Quote Total` column in Multi-Part now ALWAYS = `slot.sellTotal` (the whole-quote sell for
       that qty tier), regardless of freight scope. Direct analog of iQuote `TotalEstimatePrice`.
       Simple mode unchanged (already the whole quote).
- Verified via preview export: MP quotes produce one row per (component × qty tier) with
  per-component Material/Print/Cutting/Handwork/Sell Total and tier-level Qty/Die/Quote Total.
- Snapshots refresh on next fresh export (endpoint always recomputes).

### 2026-02-XX (fork) — Report Qty column: use per-component pcs count (revert) ✅
- Previous change tried to force `Qty` to raw set qty; that broke Multi-Part reads because
  a Matched Set at set qty=1 with pcsPerSet [1,1,2] showed 1,1,1 (uniform) instead of
  1,1,2 (per-component pcs), while iQuote's `Quantity` column stores per-product production
  pcs. Reverted `_compute_report_rows` MP loop to pass `pc.qty` (engine's pcs-multiplied
  per-component count) as the `Qty` column, matching iQuote semantics for direct row-level
  comparison. Individual mode was always correct (its rows already carried per-component
  raw pcs). Die tier-aggregate and Quote Total tier-total changes retained.
