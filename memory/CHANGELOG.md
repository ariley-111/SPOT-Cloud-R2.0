# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

## 2026-06-30 (cont.) — Parser review modal: liner labels + scope-first restructure

### Liner display labels (Iter 65 ✅)
- `defaults.js` `linerLabel()`: liner dropdowns/summary now DISPLAY the friendly name
  ('42# Kla-White' → 'Kla-White', 'None' → 'Kraft') while the stored VALUE stays canonical
  ('42# Kla-White') so the pricing engine still matches. 33#/56# keep their prefix. Parser prompt
  also told to phrase liner asks with plain shorthand (no board grade).

### Review-modal scope-first restructure (Iter 66 ✅)
- Reordered `ReviewParseModal`: (1) Job/component SELECTOR tab strip moved to the TOP;
  (2) Matched-Set vs Individual toggle (`parse-pricing-mode`) shown ONLY on the Job tab and ONLY
  when the parser is unsure (pricingMode null or confidence < 0.7), estimator choice wins on apply;
  (3) quantity box now FOLLOWS the selected component (hidden on Job tab); (4) asks list filtered
  strictly to the selected scope (`visibleAsks`) — Job tab = job-level fixes only, component tab =
  that component's fixes only. Tabs show ask-count badges. Single (non-MP) quotes keep the simple
  qty→asks flow with no selector. Verified: 100%, all 5 acceptance criteria pass.



**Root cause of the prod failure:** the send ran synchronously; the slow MSAL token + Graph
network calls exceeded the Cloudflare/proxy gateway window → a **520 "origin returned an invalid
response"** killed the request before the backend could return the real error. The user only ever
saw a generic Cloudflare message.

**Fix — async job + polling (mirrors the RFQ parser):**
- `POST /api/email/send-quote` now creates an `email_jobs` record, fires the PDF render + Graph send
  as a background task, and returns `{job_id}` immediately (HTTP 202). No more gateway timeout.
- Background worker records the EXACT failure string (MSAL error / Graph response text) per stage
  ("rendering PDF" vs "acquiring token / sending mail").
- `GET /api/email/job/{job_id}` polls status (pending/done/error). Frontend `sendQuoteEmail` submits
  then polls every 2.5s (3-min ceiling) and shows `job.error` in a scrollable red box in the modal.
- Added a 35s hard timeout on MSAL token acquisition (`graph.py`) so a hang fails fast with a clear
  "can't reach login.microsoftonline.com / check tenant" message instead of stalling.
- Added `COL_EMAIL_JOBS` + TTL index (24h) in `db.py` / `server.py`.
- Verified in preview: submit returns job_id instantly; poll surfaces the precise MSAL authority
  error for the dummy tenant. Real Graph errors will surface identically in production.

## 2026-06-30 (cont.) — Email signature (dynamic, option c)
- Email body now closes with "Thank you," + bold **The Estimating Team** + the logged-in user's
  **first name**, followed by an inline-embedded Standard Printing logo (Graph CID attachment) and
  the company contact block (Office 330.453.8247 / website / address). Built in `routes/email.py`
  `_signature_html()`; logo reused from `static_assets/spc_logo.png`. NOTE: if CodeTwo also stamps
  the estimates@ mailbox, signatures may double up — pending user's prod test / toggle decision.

## 2026-06-30 (cont.) — Parser review labels in plain English
- `parserFieldRegistry.js`: registered Stripping/Gluing Complexity + Joints per Piece; added
  `labelForKey()` + `humanizeFieldPath()` so the review modal shows "Customer Name", "Stripping
  Complexity", "Component 1 · …" instead of raw `bomItems[0].state.x` code paths (asks + picked-up
  fields list).



### Crest Std/Adv removed (P0)
- Removed the Crest Standard/Advanced complexity toggle from the UI (`ProductionSpecsSec.jsx`)
  and stripped its math from the engine: `evaluate_routes` now uses base `crest_speed`
  (no `crestAdvSpeedFactor`) and always the single `crestSetup["Standard"]` value. Removed
  `crestComplexity` plumbing from `routing.py`, `runner.py`, `engine_routes.py`, `useEngine.js`,
  `defaults.js`. Admin Rates UI no longer shows `crestSetupAdv`/`crestAdvSpeedFactor`.
- No rate changes — Crest setup/rate are admin-set in prod (`crestSetupStd` still feeds the
  single setup value; existing prod overrides preserved).

### Load Quote search expanded (P0)
- `GET /api/quotes?q=` now searches est#, customer name/code, project (`state.custRef`),
  item description (`state.itemDesc`), estimating initials (`state.estInitials`), and owner
  name/email (via user lookup). `LoadQuoteModal` debounces the search box and filters client-side too.

### PDF: print mode + sides on component summary
- New `_print_short()` in `pdf.py` appends e.g. `Satin 1S` / `CMYK 2S` / `No Print` to the
  single-piece spec line, the MP BOM bar, and MP-Individual per-component spec lines.

### Letter-of-Quote re-submission detection
- Parser now returns `spotQuoteNumber` (Claude-extracted, regex-fallback `AAA-YYMMDD-HHMMSS`)
  and attaches `matchedQuote` (id/est#/status/owner/customer/pricing_is_current) when an RFQ
  references one of our existing quotes. `FilesSec` shows `LoqMatchModal`: Open Original /
  Duplicate as New Quote (fresh est#) / Dismiss.

### Sent-quote re-open warning
- Re-opening one's own `sent` quote from `LoadQuoteModal` shows `SentWarnConfirm`: warns it was
  already sent (date + owner) and editing overwrites it; offers Make a Duplicate (fresh est#) or
  Edit Original.

### Follow-up fixes (same day)
- **Print mode on the ON-SCREEN Quote Preview** — the backend export PDF already showed it, but the
  on-screen `PreviewPdfModal` is client-rendered separately. Added `printShort()` there too, so the
  single-piece spec line, MP BOM bar, and MP-Individual component lines now show e.g. `Satin 1S` /
  `CMYK 2S` / `No Print`. (Verified on screen.)
- **LOQ "owned by" blank name** — `FilesSec.loqOpenOriginal` opened the matched quote with a wrong
  view-only comparison and no owner name. Now compares against the logged-in user's id (via useAuth)
  and passes `ownerName` (falls back to "another user"), so the view-only banner shows the real owner.
  When you own the quote, it opens editable with no banner.


- Verified: testing agent iteration_64 — 13/13 backend, 9/9 frontend assertions, 100%.


## 2026-06-29 (cont.) — Email Quote (Graph 365) + Draft/Saved/Sent workflow

### Email Quote via Microsoft Graph 365 (from Preview Quote header)
- New `POST /api/email/send-quote` + `GET /api/email/status`; app-only Graph send from
  GRAPH_MAIL_SENDER (estimates@standardprinting.com), reusing existing Entra app (needs
  admin-consented Mail.Send — IT). PDF via shared build_quote_pdf helper, attached.
- `EMAIL_TEST_RECIPIENT` safe-test override: redirects ALL mail to one inbox, tags subject [TEST],
  notes intended To/CC in body. (Set to ariley@ in preview .env for testing.)
- EmailQuoteModal: To prefers RFQ-parsed external email (captured into state.rfqContactEmail at
  parse time) over customer-master email; CC = customer CSR + Salesperson emails. Clickable 📎
  attachment link opens the quote PDF in a new tab (reuses preview-quote).
- Gracefully gated: status banner + disabled Send when not configured (503).
- BUGFIX (prod gateway error on Send): offloaded blocking weasyprint render + msal token to
  asyncio.to_thread so the single async worker isn't frozen (was causing Cloudflare 'invalid/
  incomplete response'). Verified worker stays responsive (iteration_62). NOTE: live send only
  works in PRODUCTION (preview has placeholder ENTRA creds) — user must redeploy to test send.

### Quote status workflow → Draft / Saved / Sent only
- Removed Won/Lost/Hold. PATCH /status validates {draft,saved,sent}. Quote.sent_at added; stamped
  the first time status becomes 'sent' (create/update/patch), preserved on re-save.
- Emailing a quote auto-saves it as status='sent' (EmailQuoteModal create/update on send success).
- Status colors: Draft grey, Saved yellow (#F59E0B), Sent green (#10B981).

### Load Quote/Draft modal redesign
- Columns: Est# (smaller font, full number, keeps 📎 badge), full Customer, Owner, Created
  (date+time), Updated (date+time), Pricing version badge, Status. Widened to 1080px.
- StatusPill with icons: Draft=pencil/grey, Saved=save/yellow, Sent=check/green. Sent rows show
  'Xd Yh to send' (created→sent elapsed). Verified iteration_63 (6 backend + 7 frontend pass).


## 2026-06-29 — Ignition customer sync, customer browser, board-pricing baseline diff fix

### Customer master sync via Ignition nightly push (replaces SharePoint plan)
- New `POST /api/customers/sync` — machine-to-machine, secured by long-lived bearer key
  `IGNITION_SYNC_KEY` (env). Accepts a JSON array of customer objects; full-refresh replace.
  Rejects empty/keyless payloads so a failed nightly job never wipes the live list.
  Reads the key via integrations layer (UI-rotatable) with env fallback. Tested: 401/400/ok.
- Field mapping locked to real Ignition schema: cust_code, cust_name, address_1/2/3, city,
  state, zip, country, phone, e_mail_address→email, oncredithold, credit_limit, terms_code,
  sales_tax_code, active, csr_id/csr_name→csr, csr_email_address→csr_email,
  sales_agent_id/name→salesperson, sales_agent_email_address→salesperson_email.
- Customer model (schemas.py) extended with csr/csr_email/salesperson/salesperson_email/email/
  terms_code/sales_tax_code/active/country/phone/ids.
- `GET /api/customers/sync/status` — total + last_sync {rows, source, ts}.
- Admin → new **Customers** tab: sync-status cards (count, last push, staleness warn) +
  searchable **customer browser** table (code/name/location/CSR/salesperson).
- Ignition registered as a proper integration; push endpoint + rotatable key shown under
  Admin → **Integrations** tab (provider 'ignition'). Verified by testing agent (iteration_59).
- NOTE: bundled seed CSV (384 customers, source='bundled', no CSR/salesperson) remains until the
  first real Ignition push replaces it with live data incl. CSR/salesperson for email CC.

### Bug fix — Board Pricing baseline version showed bogus Old price / delta
- `GET /api/admin/pricing/versions/{id}`: the original/baseline version (is_baseline=true,
  '2025-04-14') was wrongly diffed against the CURRENT ACTIVE version (new pricing shown as "Old").
  Fixed: baseline → diff=null/compared_to=null (Old + Δ blank); archived/active versions diff
  against the version they REPLACED (next-older non-draft), not the active version.
  Frontend already renders the baseline message when diff is null. Verified (iteration_60, 3/3 + UI).
- Tidied a pre-existing React whitespace-in-`<colgroup>` console warning (AdminPage.jsx CategoryPanel).

### Calibration analysis (Crest/Strip/Glue) — decisions captured, NO code changes yet (user holding)
- Crest (clean 2-yr data, 187 runs): real run speed ~150 sh/hr median (keep crestSpeed=150;
  iQuote's 225 is optimistic p75). Setup median 112 min / p75 171 / new-die 128 / repeat 90
  (current placeholder 45 too low). crestRate $191/hr = ERP booked rate (confirmed from cost data).
  iQuote builds setup per-operation (cut+score+perf, 1hr each = 3hr) + 225sph + ~$200/hr.
  Decisions APPROVED by user: REMOVE Crest Std/Advanced complexity toggle; retire crestAdvSpeedFactor
  (0.80, no data support); replace with New/Repeat die driver. RATE CHANGES ON HOLD pending estimator
  regroup. crestSpeed stays 150.
- Stripping (per-sheet) & Gluing (per-joint): validated against real booked costs — SPOT's tier
  VALUES are fine (bracket reality); the lever is complexity SELECTION, not the rates. No changes.


### BACKLOG (lowest priority) — Calibration / back-test harness as admin tool
- Rebuild legacy `fleet_compare.js` as an in-app admin tool: upload a production-actuals export
  (ERP transaction-table hours + costs), map rows to engine inputs, and report SPOT-vs-actual deltas
  per cost bucket (material/ink/press/cut/strip/glue) and per complexity tier, with r²/median-delta
  so rates can be re-fit against actuals (the method the original dev used on the 785-job dataset).
- Calibration source of truth = ERP production actuals (NOT iQuote costing, NOT ERP work_center_rate
  standard rates). Route $/hr rates (incaRate 485, cadRate 138, crestRate 45…) are FIT PARAMETERS
  coupled with assumed speeds to reproduce actual cost — do NOT replace them 1:1 with ERP work-center rates.
- User to provide refreshed exports: Crest (cutting-cost rows re-pointed to Crest WC), Hand Stripping
  and Hand Gluing separated by work-center id.
- Status: DEFERRED — lowest priority per user (2026-06-25).


### 2026-06-25 — Difficulty Calibration page (consolidated) + Strip/Glue calibratable ✅
- **Strip & Glue complexity now calibratable:** added override categories `strip_complexity` (min/sheet)
  and `glue_complexity` (min/joint) to `rate_overrides.py` (CATEGORIES/_LIVE/coercers), `active_strip_defaults()`
  + `active_glue_defaults()` in `core.py`, and `pricing.py` now reads them via the active getters (so admin
  edits + per-quote freeze both apply, same as CAD tiers). Legacy finding: CAD setup/per-sheet were D-110
  fleet-calibrated; Strip/Glue were NEVER calibrated (only relabeled in D-106) — flagged as ⚠ Placeholder.
- **Consolidated "Difficulty Calibration" admin tab:** replaced the old "Cutting (CAD)" tab with one page
  sectioned by type — CAD Setup, CAD Per-Sheet (✓ Calibrated), Hand Stripping, Hand Gluing (⚠ Placeholder).
  Every box editable; **Save section** persists all changed tiers at once via new `POST /api/admin/rates/bulk`
  (`adminSetRatesBulk`); per-section Reset. Verified: bulk save/reset (curl), 4 sections render w/ badges.
- **Removed "Straight" from the Strip selector** in the main UI (`STRIP_COMP` in defaults.js) and hid it from
  the Strip calibration section (HIDDEN_TIER_KEYS). Engine keeps Straight=1.0 as a harmless fallback for any
  legacy quote still carrying it.

### 2026-06-25 — Crest CAD-control gating + "Placeholder" rate badges ✅
- **Gate CAD controls on Crest route:** in `ProductionSpecsSec.jsx`, the CAD "Difficulty" (Simple/Std/Complex)
  + "CAD Price" + "Rule In/Pc" inputs are now hidden when the route is Crest (they only drive CAD, never
  Crest). Crest shows its own Std/Adv complexity control. Verified: route→Crest hides difficulty tiles (3→0)
  + cadPrice, shows crest control.
- **"⚠ Placeholder" badges in Admin → Rates:** `AdminPage.jsx` RateRow flags every `crest*`/`bobst*` rate key
  (excludes the `bobstFirstSizing` behavior toggle) with an amber "Placeholder — not yet calibrated to
  actual/iQuote costs" badge. Verified 12 rate keys badged (crestRate, bobstRate, crestSpeedVal, bobstSpeed,
  crestAdvSpeedFactor, crestSetupStd/Adv, bobstSetup, crestMinChg, bobstMinChg, crestDieCost, bobstDieCost).
  Context: Crest/Bobst defaults are legacy spot_r1_5.jsx placeholders, not derived from iQuote — all
  admin-editable, and rate-freeze keeps historical quotes unaffected when recalibrated.


### 2026-06-25 — Admin delete Saved Quotes + Crest/Difficulty investigation ✅
- **Admin delete saved quotes (NEW):** `DELETE /api/quotes/{id}` — ADMIN ONLY (`role=="admin"`), hard-deletes
  the quote, purges attached RFQ files via `purge_quote_files`, and writes an audit entry. Frontend: red
  trash button (`load-action-delete-{id}`, lucide Trash2) on each Saved row in the Load modal, admin-only,
  with a confirm dialog. Verified backend 200→404 + 404 on missing; UI button renders for admin (28 rows).
- **Crest vs Difficulty (investigation, no bug):** Per legacy `spot_r1_5.jsx`, the "Difficulty"
  (Simple/Std/Complex) toggle is `cadDifficulty` and feeds ONLY the CAD route (cut min/sheet + setup).
  Crest has its OWN control `crestComplexity` (Std/Adv) — Advanced doubles setup (45→90 min) and slows the
  press (×0.80). Both already exist in cloud (engine routing.py 382/502, UI tiles `tile-crest-std/-adv` shown
  when route=Crest). Proof: Crest cut $83.85 (Std) → $96.38 (Adv). So Difficulty correctly does nothing on
  Crest; the Crest Std/Adv tiles are the right control. NOTE: the CAD Difficulty tiles stay visible on the
  Crest route (legacy-faithful but can confuse) — offered to gate them by route as an optional enhancement.


### 2026-06-25 — Duplicate est# across tabs FIXED + Cost Buildup parity ✅
- **Duplicate estimate numbers (URGENT):** `generateEstNum` is second-precision (`INI-YYMMDD-HHMMSS`),
  so tabs/drafts created in the same second collided (legacy had a `uniqueEstNum` dedup that the
  cloud port dropped). Added `uniqueEstNum(initials, taken)` in `lib/format.js` (appends `-2`,`-3`…
  like legacy) and applied it with running `taken` sets at every stamping site in `QuoteContext.jsx`:
  newTab, duplicateTab, spin-off, duplicateFrozenAtCurrent, commitInitials, the est# backfill effect,
  the initials re-stamp map, and the draft-load map. Verified in live preview: 4 same-second new tabs →
  4 distinct est#s, 7/7 unique across open tabs.
- **Cost Buildup — Side 2 Print / White Ink lines (legacy parity, spot_r1_5.jsx L7124-25):** added the
  missing Side-2 (60% of side-1) and White-Ink sub-rows in `RightDashboard.jsx` so Press+Ink reconcile
  to the Print header on 2-sided/white jobs.
- **Cost Buildup — Material rollup (user request):** Material header now sums base board + MR/Spoil
  (matches Cost Report modal `matTotal + matMakeready`), with both shown as sub-lines. No engine math changed.


### 2026-06-25 — Nested-email parser fix + teammate-quote hard read-only ✅ (iter58, 5/5 BE + 5/5 FE PASS)
- **RFQ Parser — nested emails (P0 bug 3):** `utils/email_extract.py` rewritten so `extract_eml()`
  uses a manual `_iter()` that treats `message/rfc822` as a LEAF (Message.walk() was bleeding the
  inner tree into the outer body and dropping nested attachments). New
  `extract_email_file(filename, raw, recursive=, _depth=)`: parser path (`recursive=True`, wired in
  `routes/parser.py _prepare_content`) flattens a forwarded `.eml/.msg` — inner PDFs/attachments are
  promoted and the inner subject/from/body are merged into the parent body under a
  `──── FORWARDED EMAIL ────` marker; preview path (`recursive=False`) keeps the nested email as a
  single clickable attachment. Whitelist now keeps `.eml/.msg` + `message/rfc822`. Depth-capped
  (MAX_EMAIL_DEPTH=6). `.msg`-in-`.msg` handled via extract-msg attachment bytes.
- **Parser stale data (bug 1):** deleting a SAVED RFQ file in `FilesSec.jsx` now also clears the
  cached parse result + closes the Review modal (was already cleared on staged add/remove).
- **File view/download confirmed:** `/api/parser/files`, `/files/{id}/preview`, `/files/{id}/download`
  all return 200 for existing saved quotes; UI FilePreviewModal renders email/pdf/etc inline. The
  user's "can't open older quote files" was pre-feature quotes that simply have no attached files
  (blobs for current quotes are present and serve fine).
- **Teammate quote = hard read-only (option a, NEW):** opening another user's SAVED quote sets
  `state.viewOnly`+`ownerName` (LoadQuoteModal). SpotApp shows a sticky `view-only-banner` and wraps
  all sections in a `quote-sections` div with `pointer-events:none/opacity .55`; Toolbar Save + status
  dropdown disabled; autosave skipped (no silent draft fork). Banner offers **Take Over**
  (`takeOverActive`) and **Copy to my drafts** (`copyActive`), both clear viewOnly to unlock.
- Known minor: cosmetic React console warning (style shorthand/non-shorthand) in Toolbar/SpotApp — non-blocking.


### 2026-06-24 — Section-header pill refinements ✅ (iter53–56, all PASS)
Reorganized + enriched the collapsed-section summary pills (verified live):
- **Item Setup pill:** now shows the RUNNING (substituted) board grade instead of the spec'd
  grade (bug fix); added One-Time Cost treatments — Prep (Auto/Line/Amort), Die (Line/Amort),
  Misc (Line/Amort); and a green **✓ FSC** chip when FSC is enabled (nothing when off).
- **Pricing Strategy pill:** Freight **by type** — `<basis> × Freight - Amort` (basis = GM% or
  $/MSF, shown ONCE — fixed the duplicate "GM% · GM%"), `Freight - Line`, or
  `Freight - Local Delivery`. Prep moved out of this pill to Item Setup.
- **Production Specs pill:** added Cut difficulty, Strip difficulty, Glue (#joints + difficulty),
  Saber layout detail, Perf % (≠0), Tape type; **Crest** difficulty (Std/Adv) replaces the CAD
  difficulty when the route is Crest. Badge max-width raised 460→860px so Strip/Glue no longer
  truncate. Route **override** now shows a yellow ⚠ caution pill (data-testid route-override-badge).
- **Quote Table header:** shows the **Order Total** for the selected qty when collapsed; count
  badge when open.
- Frontend + theme.css only; needs redeploy for prod.
- KNOWN GAP: the "Freight - Local Delivery" pill branch is wired, but there is no UI control to
  set FOB = Local Delivery yet (only Will-Call / Ship are exposed) — add if Local Delivery FOB is wanted.


### 2026-06-23 — Saber in Cost Buildup, parser scope rules, always-on qty verify ✅
Three changes, all verified live (test iter53, 11/11 PASS):
- **Saber charge now shows in Cost Buildup** — the right-rail "Cutting" line silently dropped
  `saberCost` (total was right, breakdown wasn't). Now `Cutting = cutterDirect + saberCost`
  (matches legacy L7129-7132), and Detail view adds a "Saber @ $X/hr" sub-line above the
  cutter sub-line. Backend `runner.py` now exposes `saberRate`. (RightDashboard.jsx ~L1615)
- **Parser scope rules (parser_knowledge.py)**:
  - *CADs are authoritative for the component list* — one component per CAD part; the email
    body only fills in detail, it does NOT spawn extra components. (Fixed: an RFQ with 3 CADs
    was producing 4 components.)
  - *Out-of-scope litho/offset/paper-on-board* → NOT created as a component; flagged with an
    include/exclude ask. *Product mats & lightboards (styrene / OnQ)* are in-family but flagged
    as "pricing not yet in SPOT" (not treated as litho). Verified: the litho counter tray now
    drops out of the BOM (3 components) and is surfaced in asks.
- **Always-on "Verify Quantities" panel** in the Review modal — parser qtys are often wrong, so
  this panel is ALWAYS shown (independent of asks): one input for Simple (`parse-qty-input-job`),
  one per component for Multi-Part (`parse-qty-input-item-{i}`), prefilled + editable, flowing
  through the same edits/apply path. Verified: editing item-0 qtys landed only on that component.
- Item-scoped ask testids now include the component index (`parse-ask-item-{idx}-{key}`).
  Frontend + one backend field; needs redeploy for prod.


### 2026-06-23 — Inline parser-correction workflow (editable "Needs Estimator Input") ✅
The Review Parsed Fields modal's "NEEDS ESTIMATOR INPUT" block used to list internal code
variables (`bomItems[0].state.printMode`, `qtys (top-level)`, `fscEnabled`) as read-only text.
Estimators can now FIX each flagged field inline — no jumping to the main screens. Works for
Simple AND both Multi-Part types (Matched Set + Individual).
- **New `/app/frontend/src/lib/parserFieldRegistry.js`** — `FIELD_META` maps every parser field
  to a plain UI label + section breadcrumb + the right control (select / number / text / textarea /
  customer / qtys); `ALIAS` handles parser name variants; `parseAskField()` normalizes
  `bomItems[N].state.key` / `bomItems[N].key` / `key (top-level)` → `{scope,itemIdx,key}`.
- **`FilesSec.jsx` ReviewParseModal** — each ask renders as a labeled card with the reason, a
  component badge for item-scoped asks (e.g. "Print Mode — *D/C Tray 1X*"), and an inline editor
  (`AskEditor`) prefilled with the parsed value. A "✓ set" indicator + green border mark edited
  rows. custCode uses `AskCustomerPicker` (debounced `/api/customers` typeahead) to pick the
  correct branch. `apply()` merges the `edits` map into the Simple patch and the Multi-Part
  job/bomItems state (job edits win last; item edits overlay per-component before normalization).
  Item-scoped testids carry the component index (`parse-ask-item-{idx}-{key}`).
- **Tested (iter52, live Multi-Part RFQ)**: 10/11 PASS — friendly labels with zero raw code vars,
  correct control types, edit indicator, item-component badges, Apply lands the value (Print Mode →
  Gloss confirmed in the quote). custCode picker NOT live-exercised (sample RFQs auto-detected the
  customer so no custCode ask was raised) — code path reuses the proven EstimateInfoSec customer
  typeahead. Frontend-only; needs redeploy for prod.


### 2026-06-23 — Smart dimension formatting (trailing-zero trim) ✅
Added `fmtDim()` in `lib/format.js` — shows up to 4 decimals but strips trailing zeros
(60.0000→"60", 28.625→"28.625", 12.125×11.4375 kept full). Replaced all forced-decimal sheet/
piece dim displays (`fmtNum(...,4)`, `Math.round`, `fmtInt`) with `fmtDim` across: ItemSetupSec
(board summary + layout preview), RightDashboard (Route Comparison sheet row + Cost Buildup board
line), QuoteTableSec (3 sheet columns, CSV, one-up dims), CostReportModal, PreviewPdfModal
(customer PDF one-up dims). Money/MSF/cost untouched. Verified live: no `.0000` labels remain;
60×120, 28.625×25.5, 12.125×11.4375 all render correctly. Frontend-only; redeploy for prod.


### 2026-06-23 — Design polish: typography + calmer section headers (option B core) ✅
Per `/app/design_guidelines.json` (P0 + safe P1), fully reversible (CSS + 2 small component tweaks):
- **Typography:** loaded Inter (400–900) + JetBrains Mono (400–700) in `index.html`; switched
  `body.spot-app-body` font from unloaded 'DM Sans' → **Inter**; added global
  `font-variant-numeric: tabular-nums` so prices align and don't jitter on recalc.
- **Section headers (`Sec.jsx`):** removed the saturated gradient fills ("rainbow"); now a neutral
  bar (`--spot-bg2` open / transparent closed) with the **colored 3px left-border + label** kept for
  identity, plus a 1px bottom rule when open. Calmer, intentional, density preserved.
- Held back (offered to user for opt-in): KPI-grid "control-room" cell borders, in-stock→dot pattern,
  base token palette swap, sticky headers, focus rings. Skipped the black/white active-tile swap (user kept semantic tile colors).
Verified Inter applied + headers render in both themes. Frontend-only; needs redeploy for prod.


### 2026-06-23 — Header/toolbar redesign (design_agent blueprint) ✅
Rebuilt `Toolbar.jsx` per `/app/design_guidelines.json` (Swiss/high-contrast, 56px 5-zone row):
- **Zone 1 Brand:** cube · SPOT · R2.0 Cloud pill · API status.
- **Zone 2 Quote context** (was the squished part): initials badge · `#EST` (mono) · Customer
  (truncate+tooltip) on line 1; `↳ Project` (truncate+tooltip) on line 2. No more collisions.
- **Zone 3 Output:** Load / Header / Preview / Cost Report — neutralized to monochrome **ghost**
  buttons w/ lucide icons (killed the rainbow-button noise).
- **Zone 4:** Multi-Part toggle (amber when active) · Status dropdown as a **colored-dot outline**
  (not full-bg) · **Save** = the only solid green primary.
- **Zone 5 Account menu:** self-contained themed dropdown (email · theme toggle · Admin · Sign out).
- **Removed** the File-export checkbox (cloud-native now) and the non-functional Undo button,
  per user. Hover states + menu animation via `.sp-tb-*` classes in theme.css.
Verified both themes (dark toolbar computes #0b0d11 / light text) + account menu + all testids.
Frontend-only; needs redeploy for prod.


### 2026-06-23 — Minor UI batch (pre-fork) ✅
1. **Medium label → "Medium Upgrade"** (`ItemSetupSec.jsx`). Board-spec row labels widened
   to `fw=108` so Flute/Grade/Outside/Inside/Medium Upgrade stay aligned.
2. **Green stock dot on Medium** — only on **"None"** (the sole carried/stocked medium; all
   others are custom-order upgrades), matching the flute/grade/liner dot convention.
3. **Smaller-screen layout** — right rail default narrows to 300px when viewport <1440px.
4. **Resizable left/right panels** (`SpotApp.jsx` + `RightDashboard` width prop) — draggable
   `.sp-resizer` splitter, clamp 280–760px, persisted to `localStorage` (`spot:rightW`),
   double-click resets to 360. Verified: drag 360→516.
5. **Resizable file-view windows** — `Modal` gained a `resizable` prop; `FilePreviewModal`
   uses it; `.sp-modal-resizable { resize: both }` CSS (min 480×340, max 96vw×92vh).
Frontend-only; needs redeploy for prod. (User will fork for the larger changes next.)


### 2026-06-23 — Legacy parity audit: sheet library / sheet selection / routing ✅
**User directive:** match legacy sheet-selection logic, sheet library, AND routing EXACTLY.
**Verification (vs `legacy_spot/spot_r1_5.jsx`):**
- **Sheet library:** byte-for-byte identical — 216 sheets, 0 diffs (set-compared on g/f/ol/il/md/w/l).
- **`compute_layout` + `auto_select_sheet`:** verbatim match — Priority-1 pricable custom (sorted by `_allIn = total + sheets×(incaRate/100 + cadRate/240)`) → below-min approved stock (w/ medium fallback) → Mullen upgrade chain → oversize 1-up fallback. Confirmed line-by-line.
- **Routing (`auto_route`):** RESTORED to legacy D-124 cost-aware "cheapest viable route wins" (delegates to `evaluate_routes`→`cheapest`). Removed the prior-session Bobst-first early-return + CAD≤8h gate, which had diverged from the legacy source and was forcing Bobst over a cheaper CAD.
**Liner parity fix (root cause of the "1-out at exact dims" report):** legacy NEVER stores the
literal liner string `"Kraft"` — it stores `"None"` and only DISPLAYS "Kraft"
(`outsideLiner==='None'?'Kraft':...`). A literal `"Kraft"` (from parser/imported data) matched
NO stock sheet (library has only None/Kemi-Lite/Kla-White) → forced custom/Bobst 1-up.
- `engine/runner.py`: new `_canon_liner()` maps `kraft/none/n-a/blank → None` for
  outsideLiner+insideLiner in `build_board_spec` (single chokepoint; mirrors `_canon_medium`).
- `routes/engine_routes.py` compare-routes board_spec now uses `_canon_liner`/`_canon_medium`.
- `FilesSec.jsx` parse-import: `_canonLiner` mirrors backend so the UI tile + display agree.
**Verified:** piece 28.625×25.5, E/200, qty 515 — with `Kraft/Kraft` OR `None/None` input,
engine now returns **CAD · 60×120 · 2×4 · 8-out** (matches legacy). Tests: 82 pass
(route_parity, auto_die, below_min, route_comparison_parity, route_warning, medium_normalization,
pre_buy_min_snapshot, pricing_versions, matched_set_parity, multi_part, per_job_allocation,
local_delivery_markup). Frontend + backend; needs redeploy for prod.


### 2026-06-23 — CAD pricing: Rule-Inches vs Difficulty parity (Option A) ✅
**User issue:** Cloud auto-overwrote CAD Difficulty from parsed rule-inches, which then
shifted the auto-route (route gate reads difficulty). Legacy never does this — it has an
explicit `CAD Price: [Diff]/[Rule]` toggle, prices the cut from whichever the user picks,
and the auto-route decision is ALWAYS difficulty-based (spot_r1_5.jsx L419/L3511) — rule-
inches NEVER move the route.
**Fix (Option A — strict legacy parity + non-destructive recommendation):**
- `ProductionSpecsSec.jsx`: added the legacy `CAD Price [Diff]/[Rule]` toggle
  (`tile-cadprice-diff` / `tile-cadprice-rule`). REMOVED the auto-difficulty overwrite —
  rule-inches now only drive a NON-destructive recommendation: the suggested Difficulty
  tile glows + a hint badge shows `{rule}″ · {ratio}× → Std/Complex?` (or ✓ when matched).
  The estimator clicks the difficulty themselves. Rule In/Pc input + `×N ×1.15 = X in/sheet`
  breakdown shown only in Rule mode (legacy L6140).
- `useEngine.buildPayload`: now sends `cadPricingMethod` on single-part (MP already did);
  engine math in `pricing.py` L79 was already present but never reached before.
**Verified (curl, identical 24×36 / qty1000 / rule 300):** By Difficulty → route CAD,
cadHrs 5.98, cutting $825.70 (bucket "Standard"); By Inches of Rule → route STILL CAD
(unchanged ✓), cadHrs 9.28, cutting $1,280.71 (basis "300 in/pc × 6 out × 1.15 = 2070
in/sh"). Route does not move when pricing by rule-inches — exact legacy behavior. UI
elements render (smoke). Frontend-only + payload; needs redeploy for prod.


### 2026-06-19 — Individual-mode scenario freight missing 15% markup 🐛✅
**Symptom:** Same multi-part quote priced Individual vs Matched-Set returned different
JOB totals per qty. Items were IDENTICAL ($3,789.92 @100); only freight differed.
**Proof:** Individual scenario freight $156.58 (raw) vs Matched-Set $180.07 — gap
$23.49 = exactly 15% × $156.58. Both qty scenarios off by precisely the markup.
**Root cause:** `QuoteTableSec.jsx` ComponentLayout scenario rows (`perJobBySlot`) pulled
the per-slot freight straight from `jobFreightBySlot` (RAW carrier cost) WITHOUT applying
the freight markup, while the footer / per-component rows / Matched-Set all use
`raw × (1+markup)`. Diverged from legacy (spot_r1_5.jsx L3442 allocateJobCost uses
raw*(1+freightMarkup)).
**Fix:** scenario per-slot freight now `Number(v) × (1 + _perJobFreightMk)` (Local
Delivery markup=0). Individual scenario job totals now equal Matched-Set totals (correct —
same physical shipment), restoring legacy parity. Frontend-only; needs redeploy for prod.


### 2026-06-19 — Tab UX: load-in-new-tab, close-prompt, re-parse swap ✨
**1. Load opens in a new tab (keeps current work open):** `QuoteContext.loadIntoTab()`
— SMART placement: focuses an already-open draft (no duplicate); reuses the current
tab only if it's a blank/untouched LOCAL tab; otherwise opens a fresh tab.
`LoadQuoteModal` (openInPlace/onCopy/onTakeOver) now calls `loadIntoTab` instead of
`replaceState`. Draft loads pass `{draftId}` so auto-save updates the real draft (no dup).
**2. Close-tab Save/Discard/Cancel prompt:** TabBar × → `requestCloseTab`. Empty tabs
close silently; tabs with content (custName/dims/BOM via `isTabDirty`) open
`CloseTabPrompt` (Save&Close = persist as quote + migrate RFQ files; Discard = delete
draft; Cancel = keep). NOTE: previously closing a tab silently DELETED the draft.
**3. Re-parse after wrong file:** `FilesSec` ingestFiles/removeFile now invalidate the
cached parse (`setParseResult(null)`) so adding/removing a staged file reverts the button
from "Review Build" → "Build Estimate" and re-parses the corrected set.
**Auto-save clarification (for the record):** drafts auto-save every ~1.5s while open and
restore on reload; the new close-prompt protects against accidental discard on close.
**Verified:** iteration_51 (6/7) + live screenshots — new-tab on dirty (6→7), reuse-blank,
no-dup draft focus, all 3 close actions, silent empty close. Re-parse = code-verified.


### 2026-06-18 — Blank `medium` → spurious Buy-Min warning 🐛✅
**Symptom:** Parsed CADs with no medium spec left `medium` empty (not "None"). A
board e.g. "200 B Kemi/Kla" then showed a **Buy-Min warning in preview** but
**In-Stock in prod**. Manually re-selecting medium="None" fixed it.
**Root cause:** stock-sheet matching compares the stocked sheet's `md=="None"`; an
empty/null medium never matches → board forced to a custom mill order → Buy-Min.
`build_board_spec` used `dict.get("medium","None")`, which only defaults on an
ABSENT key — a parsed `""`/`null` slipped through.
**Fixes (3 layers):**
- `engine/runner.py`: `_canon_medium()` coerces ""/null/"none"/"kraft"/"n/a" → "None";
  `_canon_field()` does the same for flute/grade/liners. Covers simple + multi-part +
  manual + legacy-data paths (single chokepoint in build_board_spec).
- `parser_knowledge.py`: medium MUST default to "None", never blank, unless an explicit
  doublewall medium is called out.
- `FilesSec.jsx` parse-import: coerce blank board fields on MP component apply so the UI
  dropdowns + pricing are correct (not just calc).
**Verified:** all medium variants now resolve `stockMode=True / buyMinActive=False`;
explicit `33#` medium preserved. Tests: `test_medium_normalization.py` (8) + multi-part
+ matched-set parity = 25/25 pass.


### 2026-06-18 — Parser CAD dimension accuracy (metric/grain/resolution) 🐛✅
**Symptom:** On a dense 32-component CAD ("C140631 Amon Ra Lobby Unit"), Top Header
A/B parsed as 64.1×38.58 (one run) or raw mm `1830.1` with `oneUpW=null` (another),
vs truth 36.855×75.998 in (936×1930 mm). Non-deterministic, all wrong.
**Root causes (3):**
1. mm not converted — model left raw mm or eyeballed inches despite instructions.
2. Only ONE dimension captured per component (oneUpW=null).
3. "Short Flute" grain callout ignored ("no grain visible").
4. **Underlying:** the CAD is a single 38.9×16.9in large-format sheet; Anthropic's
   native PDF support downsamples it to ~1568px (~40 DPI) → dimension arrows ~3px →
   illegible → misreads/guesses.
**Fixes:**
- `parser_knowledge.py` prompt hardening: HARD rule "any value >120 = mm, divide by
  25.4, never emit raw >120 or null"; "READ BOTH dimension arrows (W and L)"; Short
  Flute/Long Flute → which dim is oneUpW; explicit "Corrugation Direction"/"Corr Dir"/
  "Flute Direction" field recognition (Vertical/Horizontal → oneUpW axis).
- New `services/pdf_tiles.py` (PyMuPDF): renders large-format pages (>17in long edge)
  at 150 DPI and slices into ≤16 overlapping ≤1456px tiles. `parser.py` attaches these
  zoom tiles alongside the native PDF with guidance ("read numbers from tiles, count
  components from the PDF"). PyMuPDF==1.27.2.3 added to requirements.
**Verified:** re-parse of the same CAD → Top Header A/B now W=36.8504 L=75.9843 (✓,
both dims, converted, Short-Flute orientation correct); all 32 components read both
dims in inches. Tests: `tests/test_pdf_tiles.py` (4/4).


### 2026-06-18 — Async RFQ parsing (502 timeout fix) + Internal Cost Report port ✅
**Async parse (P0 — fixes 502/520 on large CADs)**
- Anthropic Opus parses of large CAD files run ~120s, exceeding the 60s K8s ingress
  idle-timeout → spurious 502/520 even though the upstream call eventually succeeds.
- Refactored `routes/parser.py`: extracted `_prepare_content()` (reads+persists uploads,
  builds the Anthropic content payload — fast, runs inside the request) and
  `_run_parse_and_log()` (the slow Anthropic call + usage logging) as shared helpers.
- New `POST /api/parser/parse-rfq-async` → reads/persists files, inserts a `parser_jobs`
  doc, spawns `asyncio.create_task(_run_parse_job)`, returns `{job_id, status:'pending'}`
  with HTTP 202 immediately. New `GET /api/parser/jobs/{job_id}` → `{status: pending|done
  |error, result, error, status_code}`. Legacy sync `POST /parse-rfq` kept for compat.
- `parser_jobs` collection (`db.py` COL_PARSER_JOBS) + TTL index on `created_at`
  (expireAfterSeconds=86400) created at server startup → jobs auto-purge after 24h.
- Frontend `api/spot.js`: `parseRfqAsync`, `getParseJob`, `parseRfqPolling` (submit +
  3s poll loop, 10-min ceiling). `FilesSec.runParseDirect` now calls `parseRfqPolling`;
  the existing inline "PARSING RFQ" pill shows during polling; Review modal opens on done.
- Tests: `tests/test_parser_async.py` (6/6). Iter49 frontend+backend 100% PASS.

**Internal Cost Report modal (P0 — legacy parity port of spot_r1_5.jsx L8021-8252)**
- Rebuilt `CostReportModal.jsx` from a flat-table stub to full legacy parity: summary bar
  (FOB / Freight / Prepress / Pricing), one detail card per component with the 17-column
  table (Qty·Sheets·MSF·Sheet·Route·Material·Print·Cutter·Finish·Frt·OH·Tot Mfg·$/MSF·
  Sell·S/MSF·GM%·GM$), and a Kit Rollup table for Multi-Part 2+ components (Set Qty·
  Components·Total Cost·Charges·Total Sell·GM$·GM%·Price/Set when Matched Set). Print button.
- Backend `engine_routes.py`: componentPricing `rows_out` now surfaces
  matTotal/matMakeready/printDirect/cutterDirect/saberCost/assemblyCost/overhead/sheetsReq
  (needed for the per-component column breakdown); `board_spec_view` now carries
  printReq/printMode/printSides for the card header.
- Tests: `tests/test_cost_report_fields.py` (4/4). Iter50 frontend Simple + Multi-Part
  (with Kit Rollup) 100% PASS.


### 2026-06-18 — Parser refinements: orientation, strip, liners, metric, .xls ✅
- **Corrugate/grain orientation**: `oneUpW` is now defined as the corrugate-direction
  dimension. Determination priority: explicit "C" mark → grain/corr text (vert/horiz/
  long/short) → flute picture on CAD → DEFAULT (blank-size only) = Width is corrugate.
- **Center holes → stripping**: interior cut-outs auto-set `handStripping="Yes"` +
  `strippingComplexity="Standard"` (placeholder) with a confirm ask. (Fixed field
  names to match the engine — were wrongly `stripReq`/`stripDifficulty`.)
- **Liner detection** broadened: many more synonyms/abbreviations (WT/MW/BW/CCK/etc.),
  weight-prefix overrides, single-vs-both-side rules, never emit literal "Kraft".
- **Metric → imperial**: detect mm/cm and CONVERT to inches (÷25.4 / ÷2.54), populate
  oneUpW/L/D; ask only confirms units. Forbidden to defer with "divide by 25.4" when
  the number is legible. Verified on the Amon Ra CAD: metric correctly detected
  (dims left null only because that 32-part overview sheet was illegible per-part).
- **.xls support**: legacy binary Excel now read via `xlrd` (openpyxl can't); both the
  RFQ parse path and the file-preview path handle .xls. `.xlsx`/`.xlsm` unchanged.
- NOTE: large PDFs still 502 at the 60s proxy limit (separate P1 async-parse backlog);
  parse completed in ~120s when called direct.


### 2026-06-18 — Fix: frozen/legacy-pricing guard inverted after mid-session activation ✅
- **Symptom (prod)**: after activating a new board-pricing version, the frozen
  guard fired on NEW active-priced quotes and NOT on old/inactive ones — backwards.
- **Root cause**: `activePricingVersionId` (`av`, what the frozen check compares
  against) was resolved ONCE at login and never refreshed. Activating a new
  version mid-session left `av` stale at the OLD baseline id, so quotes pinned to
  the NEW active version looked `!== av` (→ frozen) and old ones `=== av` (→ not).
- **Fix** (`QuoteContext.jsx`): extracted `refreshActiveVersion()`; now re-resolves
  on login, on `window` focus, and is exposed via context. `AdminPage.jsx` calls it
  right after a successful Activate, so the guard compares against the new active
  version immediately — no reload needed.
- NOTE: pricing versions are per-environment DB data; production needed its own
  import+activate (done by user). Code fix must be redeployed to prod.


### 2026-06-18 — MP-Individual fixes: per-qty misc per-tier + qty-row → economics ✅
- **Bug 1**: Per-qty custom misc (e.g. Clips) only applied to qty 100. Root cause:
  the MP-Individual per-component pricing path always priced each row at slot 0
  (`use_slot=0`), so `_resolve_misc_per_slot` (and freightByQty) only ever read
  slot 0. Fix (`engine_routes.py` ~L839): price each row at its REAL top-level
  slot index. Now Clips = $57.50@qty100 / $345@qty200 (50/300 ×1.15).
- **Bug 2**: Clicking a qty row inside a component's quote-table section didn't
  update the right-rail Economics/Cost Buildup (it only set local state). Fix
  (`QuoteTableSec.jsx` ComponentLayout `onSelectRow`): also `switchBomItem()` to
  that component and `setField('selSlot', row.slotIdx)` so the panels reflect the
  clicked component at the selected qty. Cross-component switching works too.
- Verified iter48 — both PASS end-to-end on SA-260618-085911; regressions intact.


### 2026-06-18 — MP-Individual PDF per-qty Quote Summary (legacy parity) ✅
- The MP-Individual Quote Preview/PDF summary previously lumped ALL component
  rows across ALL qtys into one "Items (base sell) / Quote Total" (~$7,490),
  which looked wildly off vs legacy's per-qty totals.
- Now renders a per-qty table: QTY | COMPONENTS | PRICE/SET | QUOTE TOTAL — one
  row per qty tier combining EVERY component at that qty (e.g. qty100 = Shoe
  Box@100 + Boot Box@100). Components sum = Σ component `sellTotal` at that qty
  (includes per-item freight/die/prepress/misc, matching the per-component TOTAL
  cells); Price/Set = total ÷ qty. Mirrored in `routes/pdf.py` for Export.
- Verified iter47 (table structure + grouping) + follow-up fix to include misc
  (Clips) in the summed total so it reconciles with the per-component totals.
- PRICING SANITY CHECK (user concern): cloud vs legacy on SA-260618-085911 —
  per-qty combined totals were ~+1.6% (qty100) / ~+2.5% (qty200), fully within
  the expected ~6.5% material-price delta (material ≈ 20% of total) plus differing
  liner specs entered (cloud "Kla/Kraft" vs legacy "Kla-White/Kraft"). Engine is
  NOT diverged; the big perceived gap was purely the broken all-qty lump summary.


### 2026-06-18 — Per-qty custom misc charges ✅
- Custom misc charges (e.g. "Clips") can now carry a DIFFERENT flat $ per quantity
  tier. Each misc charge has an optional `costByQty` map keyed by slot index; a
  per-slot value overrides the flat `cost`, blank inherits it. Markup still applies.
- **Backend** `engine/runner.py`: new `_resolve_misc_per_slot()` resolves the
  per-slot cost inside `build_prod_inputs` (uses the existing `_slotIndex`); works
  for both Simple and Multi-Part (per-component, item-level miscCharges).
- **Frontend** `ItemSetupSec.jsx` One-Time Costs: each misc charge shows a
  "Per-qty $" override row (one input per active qty tier, blank = flat default).
  `costByQty` flows through `buildPayload`/`buildMpPayload`.
- Verified iter46 — qty 500/1000/2000 → Clips $57.50/$115/$345 (50/flat-100/300 ×1.15)
  across Quote Table, PDF By Part "Clips" column, and Lump Sum lines. Flat-cost
  charge (no overrides) still applies equally to all tiers. Tests: `test_misc_per_qty.py` 6/6.


### 2026-06-18 — PDF / Quote-Preview charge-mode overhaul ✅
- **#1 Removed "View Kit Matrix"** (MP Individual + Matched Set) — deleted the
  `KitMatrixModal` + trigger button from `QuoteTableSec.jsx` (redundant).
- **#2 Per-quantity line charges** — every charge mode now shows only the charges
  that apply to each qty tier (e.g. 500-tier = freight only; 1000/2000 = die+freight).
- **#3 "By Part" → separate columns** — `PreviewPdfModal.jsx` `PricingTable` now
  renders one column per charge TYPE present (Die | Freight | Prepress | each custom
  misc name e.g. "Clips") summing into Quote Total, instead of comma-joined text.
- **#4 "Lump Sum" → per-qty list** — fixed bug where only the first tier's charge
  showed. Now one descriptive line per tier: "Freight + Die + Clips @ Qty 1,000:
  $2,168.77" (label built from the charge types > 0 at that tier).
- "By Type" unchanged (single combined Charges column). Backend `routes/pdf.py`
  mirrors all three modes for Export. Verified iter45 — 4/4 PASS + By-Type regression.
- NOTE: custom misc charges per-qty/per-component (#5) deferred to next session
  (flat $ + markup input; today they replicate one charge across all qtys/components,
  same class of bug freight had).


### 2026-06-18 — Per-Job freight per-tier + cross-display consistency ✅
- **Bug 1 (user)**: In MP Matched Set Per-Job mode, the Quote Table tiers, the
  PDF Per-Component Pricing grid, and the right-rail Per-Job card all showed the
  FIRST tier's freight for EVERY set-qty tier.
  - Root cause: only the flat `jobFreightCost` reached the engine; per-slot
    `jobFreightBySlot` was never sent.
  - Fix: `useEngine.buildMpPayload` now sends `jobFreightBySlot`; backend
    `engine_routes.py` applies `jobFreightBySlot[slot]×(1+markup)` per tier for
    `slots[].freightLine`; right-rail Per-Job card reads `jobFreightBySlot[selSlot]`
    (new `freight-per-job-qty` label). Verified iter42 — 185.79/230.64/299.89.
- **Bug 2 (user)**: Per-Job freight DISAGREED between the Quote Table
  "Per-Component Breakdown" chip (Header $19.32) and the right-rail Cost Buildup /
  active-component card (Header $33.88).
  - Root cause: two backend allocation paths used different bases — aggregate
    `allocatedFreight` = RAW × board-consumed `oMSF`; componentPricing
    `freightLine` = MARKED-UP × finished `finMSF`.
  - Fix: aggregate path now allocates the markup-inclusive per-slot job freight on
    the finished `finMSF`/`finShipWeight` basis — identical to componentPricing.
    Now breakdown chip == cost buildup == active card, and the 3 components sum to
    the tier's job freight. Verified iter43 (all tiers reconcile).
- **Tests**: `tests/test_per_job_allocation.py` 14/14 PASS incl. new
  `TestMatchedSetPerSlotJobFreight` (distinct-per-tier + breakdown==componentPricing).
- Simple (single-part) freight path untouched (separate `freightByQty` pipeline).
- **Bug 3 (user)**: The right-rail Cost Buildup "ONE-TIME LINE ITEMS > Freight"
  showed only the active component's allocated share (~$33.88) instead of the
  full per-job freight ($299.89). Fix: in MP Per-Job mode the One-Time Line Items
  section is now JOB-scoped (`src = aggregate`): Items (job) = job sell, Freight
  (per-job) = full per-job freight for the selected tier, Quote Total (job) =
  order total — mirroring the Quote Table footer. Per-Item mode stays
  component-scoped. Verified iter44 (all tiers match across cost buildup,
  Per-Job card, and Quote Table footer/order total).


### 2026-06-18 — Matched-Set freight "Qty 300" bug RESOLVED (P0, was recurring) ✅
- **Symptom (user)**: In a Multi-Part Matched Set quote, adding a new qty tier
  (e.g. 300) made the Freight Dashboard quote ONLY the active component at that
  tier (others dropped), and the Per-Job scenario read "Scenario 3" instead of
  "Qty 300". Failed twice previously (iter 39, 40).
- **Root cause**: `RightDashboard.jsx` `buildItems` broadcast the unified set
  qtys from `s.qtys` — which mirrors ONLY the active BOM tab. A tier added on
  one component while another tab was active never reached the others.
- **Fix**:
  - New `getSetQtys()` in `RightDashboard.jsx` derives a **tab-independent**
    unified set-qty array = longest qty array across the active mirror (`s.qtys`)
    AND every component's stored `state.qtys`. `buildItems` broadcasts that
    (× pcsPerSet) to all components in Matched Set mode.
  - `buildScenarioMatrix` attaches `setQty` to each per-item row and per-job
    scenario; `FreightDashModal.jsx` labels tiers by `setQty` ("Qty 300")
    instead of requiring all per-component qtys to be equal.
  - MP batch loop made resilient: retries each chunk once and only surfaces an
    error when ZERO rates return — suppresses the transient "Batch freight
    quote failed: 502" red banner when other chunks succeed.
- **Verified**: testing agent iter41 — 6/6 PASS. Qty 300 tier now lists all 3
  components (combined 1,143 lbs vs buggy 747 lbs); Per-Job scenario reads
  "Qty 300"; no 502 banner.


# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

## 2026-06-18 — Freight: per-quantity quoting for Simple quotes + dashboard polish ✅
- **Per-qty freight (Scenario 1 fix):** a Simple quote with multiple quantities now fetches freight for EVERY populated qty tier (each tier has its own shipped weight + skid count) instead of quoting once at the first qty and applying it flat. `RightDashboard.updateFreight` Single-Part branch now loops each qty slot, fires `freightQuoteBatch` (chunked by 4), and stores `freightByQty={slot:cost}` + a per-slot `freightDashCache`.
- **Backend root-cause fix:** `engine/runner.py::build_prod_inputs` resolved `freightByQty` by INT slot key, but the frontend sends a JSON object with STRING keys ('0','1','2') — so every slot fell back to the flat `freightCost`. Now looks up both int and string keys (and treats a legit per-slot '0' correctly). **This also fixes MP-Individual multi-qty freight**, which shared the same root cause. Verified by curl (100/500/900 across slots); 30/30 freight pytests pass.
- **Quote Table** now shows distinct freight per qty row (verified live: 500→$514.14, 1,000→$650.77, 2,000→$1,035.28).
- **Right-side Freight panel** 'Item Freight' card now displays the freight for the CURRENTLY SELECTED qty tier (tracks the Quote Table row selection) and labels it 'Item Freight · Qty N'.
- **Freight Dashboard** Per-Item/Per-Job section headers now read 'Qty 500' / 'Qty 1,000' (instead of 'Slot N'/'Scenario N') for single-qty-per-section (Simple) quotes; the Component column now shows the quote's Item Description (was hardcoded fallback 'Single Item' via a wrong field name `itemDescription` → fixed to `itemDesc`).
- **Tested:** iteration_35 (per-qty Quote Table + dashboard weights/skids, single-qty + regression) and iteration_36 (3 display tweaks) — both 100%, 0 console errors.


- **Save no longer duplicates / re-pins (P0 BUG FIX):** `Toolbar.jsx::onSave` now branches — if `state.quoteId` exists it calls `updateQuote` (PUT, which preserves the pinned `pricing_version_id` on the backend, keeping a frozen quote frozen); only a brand-new tab calls `createQuote`. Toast reads "Updated" vs "Saved". Parser-file reassign now runs ONLY on first create. Curl-verified: repeat-save keeps a single row; frozen update keeps baseline pin (2025-04-14); copy re-pins to active (2026-06-15).
- **Material-edit warning (once per quote-open):** new `FrozenEditWarnModal.jsx` driven by `QuoteContext`. A frozen quote = a SAVED quote whose pinned version ≠ the active version (active id resolved once via `engineManifest()`). `setField`/`setManyFields` detect MATERIAL edits (qty tiers, dims, board/production specs, one-time costs, quote type) via an exclude-list (`FROZEN_EXCLUDE` + `_`-prefixed/internal keys excluded; metadata like customer/project/notes/est#/ship-to never warn). A 2500ms post-load settle guard (`replaceState`) prevents programmatic recompute from false-firing. Warning shows once; choices: **Keep frozen pricing** (proceed, no more warnings) or **Duplicate at current pricing** (`copyQuote` → clones AS LAST SAVED, discarding the in-progress dirty edit, re-pinned to active, assigned a FRESH generated est# via `generateEstNum(initials)` — no "-COPY" suffix — persisted with `updateQuote`, then loaded into the tab).
- **Frozen UI indicators (user spec):** (a) the TAB ONLY is colored amber with a ❄ + `data-frozen='1'` (toolbar est# intentionally left alone); (b) amber `data-testid='frozen-chip'` "❄ Frozen — {date}" in the Estimate Info header (label carried into state from the Load modal's `pricing_version_label`).
- **Estimate # locked on ANY saved quote (user spec):** `EstimateInfoSec` est# input is `disabled`+`readOnly` whenever `state.quoteId` is set (fresh save or loaded saved quote).
- **Tested:** testing_agent iteration_33 — 8/8 frontend scenarios PASS, 0 functional console errors. Backend create/update/copy + freeze verified by curl.
- **Known follow-up (pre-existing, not this task):** preview `/api/auth/entra/login` returns 500 (placeholder Entra creds) instead of a clean 503 — flagged for a future `_build_msal_app` try/except hardening. "Save Draft vs Save as Quote" UI split still deferred per user.


- **Freeze wasn't applied in the UI (bug):** the frontend never sent `pricingVersionId` on recalc, so opening a saved quote silently re-priced at the ACTIVE version. Fixed: `LoadQuoteModal` injects the quote's `pricing_version_id` into state on load/take-over/copy; `useEngine` buildPayload + buildMpPayload include `pricingVersionId`. Verified on `/calculate-all`: same quote = $34,129.33 (active) vs $33,950.13 (frozen v1).
- **Board Engine panel showed the wrong version (confusing bug):** it always showed the global ACTIVE version even when a frozen quote was open. Fixed: `/manifest` accepts `version_id` and returns THAT version's meta + rates + an `is_active` flag (+ `active_label`). `engineManifest(versionId)` + `BoardEngineSec` now pass the loaded quote's pinned version and refetch on change. Badge shows amber **"FROZEN PRICING {label} · this quote is preserved on {label} (current list is {active}). Duplicate to re-price."** when pinned≠active; green "PRICING {label}" otherwise. Verified in UI on a frozen quote (shows 2025-04-14, 275=139.58).
- **Test data:** created `FROZEN-TEST-V1` (status sent, pinned v1) in preview so the freeze can be validated against a current-priced quote.
- **Known follow-up (not yet done):** Save always calls `createQuote` (never `updateQuote`) → re-saving spawns DUPLICATE saved quotes (observed dup est#s); and Save defaults to `draft` status. User wants a "Save Draft" vs "Save as Quote" choice. Pending decision on UI (two buttons vs dropdown); will also fix create-vs-update.


## 2026-06-17 — Board Pricing · saved-quote pricing-version tag (Phase 2 follow-up)
- **Load Quote → Saved Quotes** list now has a dedicated **"Pricing Version"** column (own grid column, aligned rows) — pill shows the version date only (no "priced" word); amber + ⚠ icon when on an older list, neutral when current. Backend `routes/quotes.py` list attaches `pricing_version_label` + `pricing_is_current` via one versions lookup.
- **Admin → Audit Log → Quote Activity** now has a **"Pricing Version"** column (each row shows the quote's pinned version label; backend joins quote→version label in `list_quote_audit`).
- Clarified prod rollout: pricing versions are per-environment (separate DBs). Deploy auto-seeds prod's v1 baseline + backfills prod quotes (zero movement); admin then Imports + Activates the new list in prod's Board Pricing tab (deliberate go-live).


## 2026-06-17 — Board Pricing Update + Freeze · PHASE 2 (importer + diff UI + activate)
- **Importer (`services/pricing_import.py`):** defensive xlsx parser — anchors on SINGLEWALL/DOUBLEWALL labels + grade label in col A (not fixed cells), maps tier columns positionally to engine tiers. Imports **base_matrix ONLY** (adders carried forward, per business confirmation). Missing/zero cells keep old value + warn; new/unknown grades flagged. Auto-picks the latest-dated sheet tab. `diff_base_matrix()` → per-cell old/new/% + summary (detects uniform %).
- **Admin routes (`routes/admin_pricing.py`, admin-gated):** POST /import (xlsx → DRAFT version + diff + warnings, no activation), GET /versions, GET /versions/{id} (diff: draft→vs active, active→vs the version it replaced), POST /versions/{id}/activate (deliberate, archives prior active), DELETE /versions/{id} (draft only). `create_version` now supports status=draft.
- **Admin UI (`AdminPage.jsx` → BoardPricingPanel):** new "Board Pricing" tab. Version list w/ status pills (ACTIVE/DRAFT/ARCHIVED), Import modal (file + optional label), diff-review detail (summary "+6.5% vs 2025-04-14", warnings, per-cell SW/DW grade×tier old→new→Δ% table), Activate + Discard. API in `api/spot.js`.
- **Verified end-to-end (real 6/15/26 spreadsheet):** parsed 172 cells = uniform +6.5%, NT-DW blank cells kept old + warned; landed as draft; Activate flipped it live → Board Engine `/manifest` now 2026-06-15 (275=148.6527). FREEZE confirmed: new unpinned quote $34,129.33 (new) vs same pinned to v1 $33,950.13 (frozen old).
- **Test stability:** golden-$ legacy-parity test (`test_below_min::test_storage_bin_v3_legacy_parity`) now pins `pricingVersionId`→baseline so it stays deterministic regardless of active version. Suite green (3 pre-existing SSO/role-gate failures unrelated). 2026-06-15 left ACTIVE in PREVIEW for the user's preview-vs-prod Board Engine spot-check; PROD untouched until deploy+activate there.


## 2026-06-17 — Board Pricing Update + Freeze · PHASE 1 (versioning foundation, zero behavior change)
- **Goal:** version board-supplier pricing, freeze saved quotes to the version they were priced on, and let the Board Engine panel reflect the active version. Re-pricing is ONLY via Duplicate (new est #).
- **Engine parametrization (`engine/core.py`):** added `PRICING_KEYS` (base_matrix, liner_upgrades, medium_upgrades, dimensional_adders, fixed_charges, flute_rules), a per-request `ContextVar` overlay, `active_engine()`, `snapshot_pricing_config()`, and a `use_pricing(cfg)` context manager. `calc_board`/`get_liner_rate` now read `active_engine()[...]`. With no override → reads code ENGINE verbatim = exact legacy parity. Machine/labor rates stay managed by `rate_overrides` (orthogonal, unchanged).
- **Versions service (`services/pricing_versions.py`) + `PricingVersion` model:** `pricing_versions` collection. Startup `ensure_initialized()` seeds v1 baseline ("2025-04-14" == in-code rates, marked active) and backfills all existing quotes/drafts to it. Idempotent.
- **Pinning (`routes/quotes.py`):** `create_quote` pins to active version at save; `update_quote` preserves the pin (freeze); `copy_quote` (Duplicate) pins to the ACTIVE version (the re-price path).
- **Engine endpoints (`engine_routes.py`):** `@with_pricing` decorator resolves `pricingVersionId` from the body (pinned) or active version and applies it via `use_pricing`. Applied to /calculate, /calculate-all, /calculate-multi-part, /compare-routes. `/manifest` now returns the ACTIVE version's pricing keys + version meta (so the Board Engine panel shows live rates).
- **Verified:** startup seeded v1 + backfilled 37 quotes; `/manifest` reports baseline 2025-04-14 (275=139.58); `/calculate` sellTotal identical (3403.99). New `tests/test_pricing_versions.py` (3 pass: snapshot completeness, v1==default parity, +6.5% bump moves cost + no context leak). Full suite 124 pass (3 pre-existing SSO/auth-env failures unrelated).
- **KEY IMPORT-SCOPE FINDING (for Phase 2):** engine `base_matrix` == supplier raw board rates 1:1, but liner/medium ADDERS diverge from the supplier sheet (e.g. engine 26#Med $3.00 vs sheet $2.50; 33#Med $7.00 vs $6.40; 40#Med $12.50 vs $10.00) — they carry SPC business values. The 6/15/26 change is a uniform **+6.5%** on base_matrix (header cell `0.065`) + 56# Kla-White $10.50→$15.00 (engine already at $15.00). ⇒ Importer must target **base_matrix only**; adders shown as informational diff, opt-in.


## 2026-06-16 — Corr auto-flip parity (option A): restore legacy auto-flip on typed dims
- **Gap found (via legacy source diff, not docs):** cloud auto-flip effect was a faithful
  port of legacy `spot_r1_5.jsx` L3941-3957 EXCEPT it added `if (s.corrManual) return;`
  AND set `corrManual:true` on EVERY width/length keystroke (`ItemSetupSec.jsx` L222-223).
  Net effect: once a user hand-typed any dim, auto-flip was permanently disabled — so
  "CORR FLIPPED" never auto-lit red the way legacy does. This was the sole behavioral
  divergence the user identified on the ECT 44 · B · Kla-White/Kraft · 76.625×49.25 case.
- **Fix (option A — auto-flip ON, debounced):** stopped setting `corrManual` on plain typing;
  it is now set ONLY by the manual Flip Corr button (L54). Auto-flip therefore fires on
  freshly-typed dims again (legacy parity), and the existing 400ms engine debounce
  (`useEngine.js` L23) means it fires on SETTLED dims — avoiding legacy's per-keystroke
  dim-bouncing jank. Manual Flip Corr still sets `corrManual` so it never gets fought.
- **Verified:** engine confirms unflipped 76.625×49.25 → exceedsSheetLibrary+flipWouldHelp+
  Buy Min; flipped 49.25×76.625 → stock 60×120, no Buy Min. Live UI smoke test: typing the
  dims auto-swaps W/L, lights "⇄ CORR FLIPPED" red, board flips to IN STOCK, toast fires.
- **Confirmed NOT a bug (1:1 with legacy source):** `computeLayout` does not rotate in either
  app (legacy L261-272 ≡ cloud); ECT 44 → 275 Mullen fallback (legacy L197); inside "Kraft"
  stored as `"None"` and only DISPLAYED as Kraft (legacy L1218/L2104 ≡ cloud); custom-order
  Buy Min on oversized pieces; Route Comparison hidden when Crest not viable. No board/grade
  substitution fires for this scenario (correct). Registry doc's "ECT 44 → 200#" is loose
  wording; code authority is 275#.



## 2026-06-16 — Delete drafts (individual + all)
- **Backend:** new `DELETE /api/drafts` (delete all of the user's drafts + purge their parser
  files); existing `DELETE /api/drafts/{id}` for one. Both curl-verified.
- **Context:** `QuoteContext` `deleteDraftById(id)` (deletes backend draft + drops the tab if
  open) and `clearAllDrafts()` (deletes all + resets to one blank tab); exposed in value.
- **Frontend:** `LoadQuoteModal` Drafts tab — per-row `×` delete (data-testid
  `load-draft-delete-<id>`, stopPropagation so it doesn't open the draft) + a drafts-only
  "Delete all" button (`load-delete-all-drafts`). Both guarded by window.confirm.
- Verified by testing agent (iteration_32.json) 100%, 6/6 scenarios, 0 console errors:
  individual delete (accept + cancel), delete-all (correct count, empty state, tab-bar reset
  to blank), button hidden on Saved tab + when empty, Saved tab unaffected.


## 2026-06-16 — Saved-quote attached-files badge (📎 N)
- **Backend:** `quotes.py` list_quotes now returns `file_count` per quote via new
  `parser_files.count_files_by_quote()` (single aggregation).
- **Frontend:** `LoadQuoteModal.jsx` saved-quote rows show a cyan lucide-Paperclip badge with
  the attached-file count next to the Est# (data-testid `load-files-badge-<id>`); hidden when 0.
- **Also fixed (pre-existing):** a fetch race in the modal's load `useEffect` — a stale
  `listDrafts()` could resolve after `listQuotes()` and overwrite the list with drafts (which
  lack file_count), hiding the badge. Added an ignore-flag cleanup so only the latest fetch
  updates state.
- Verified by testing agent (iteration_31.json) 100%: badge renders with correct count,
  absent on zero-file quotes, survives rapid tab toggles, 0 console errors.


## 2026-06-16 — Bug 3: attach RFQ files without parsing
- **Gap:** files only persisted to the backend when the user ran the Anthropic parser
  ("Build Estimate"). Files uploaded for a manually-built quote stayed client-side and were
  lost on save/reload.
- **Backend:** new `POST /api/parser/files/upload` (parser.py) — persists uploaded files via
  `parser_files.save_parser_file(source="upload")` with NO Anthropic call. Curl-verified.
- **Frontend:** `api/spot.js` `uploadParserFiles()`; `FilesSec.jsx` `attachFiles()` + an
  "⤓ Attach to quote" button (data-testid `btn-attach-files`, shown when files are staged).
  Uploads to the same `filesQuoteId` stream the parser uses, so the draft→quote reassign
  migration carries them through Save Quote.
- Verified by testing agent (iteration_29.json) 100%: attach (0 parse-rfq calls), persists
  across save + reload, inline preview, delete, and Build Estimate regression all pass.
- Note (hygiene, backlog): FilesSec.jsx is now ~734 lines; `ReviewParseModal` could be split
  into its own file.


## 2026-06-16 — Bug 2: corr-flip "going rogue" (overrode manual input) + amber dots
- **Amber dots removed** (green kept): grade/flute tiles now show ONLY a green dot for
  directly-stocked grades; the cloud-only amber "via Mullen fallback" dot is gone
  (`ItemSetupSec.jsx` grade tile render). Legacy parity — green dots only.
- **Corr-flip root cause:** the auto-flip `useEffect` (ItemSetupSec L148+) had no memory of
  manual intent. ~1s after the user typed a dimension OR clicked "Flip Corr", the debounced
  engine recompute returned and the effect re-fired, swapping W/L back and re-setting
  `corrFlipped` (toast "Corr direction auto-flipped"). This fought BOTH manual typing and the
  flip button — confirmed via timed repro (iteration_27.json).
- **Fix:** added a persistent `corrManual` flag to item state (`defaults.js`). It is set true
  by `onFlipCorr` and by the Width/Length `onChange` handlers (per keystroke). The auto-flip
  effect now early-returns when `corrFlipped || s.corrManual`. The engine still gets ONE
  auto-suggest pass on FRESH (parser-entered/untouched) dims — so the helpful behavior is
  preserved, but it never overrides explicit user intent. Persists with the saved quote.
- Verified by testing agent (iteration_28.json) 100%: typed spec dims persist (+1s/+2.5s/+5s),
  Flip Corr persists across clicks, no auto-revert, no toast, one-time fresh-dim auto-flip
  still fires, 0 console errors. (MP uses the same shared component/state.)
- The parser entering dims backwards (the upstream cause) is logged separately under
  `PARSER_IMPROVEMENTS_BACKLOG.md` (P1) per user.


## 2026-06-16 — Bug: board-substitution warning "flashed then disappeared"
- **Root cause:** cloud `acceptSub`/`forceSub` in `ItemSetupSec.jsx` overwrote `boardGrade`
  (and `medium`) with the fallback value (e.g. ECT 32 → 200). The next engine calc then saw
  the stock grade and returned NO `gradeFallback` → `hasFb=false` → the green/blue
  confirmation pills (guarded by `isAccepted && hasFb` / `isForced && hasFb`) never rendered.
  User perceived this as the warning flashing then vanishing. Also: "Force spec'd board" was
  wrongly forcing the *substituted* board (200) instead of the *spec* board (ECT 32).
- **Fix (1:1 legacy spot_r1_5.jsx L5918-5919):** acceptSub/forceSub now set ONLY state flags
  (`boardSubstitution` + `fallbackAccepted`, plus `buyMinBoard:'Yes'` for Force); no
  `boardGrade`/`medium` overwrite. SPEC keeps ECT 32, RUNNING shows 200, pills persist.
  Verified by testing agent (iteration_26.json) 100%, 11/11 polls, both flows, 0 errors.
- **Confirmed:** engine substitution RULES already match legacy — `/api/engine/calculate`
  for ECT 32·B·Kemi-Lite returns `gradeFallback="200"`, `stockMode=true` (ECT 32→200, Rule 4).
- **Note:** the green/amber dots on grade/flute tiles are a CLOUD-ONLY availability hint
  (green = stocked for that flute, amber = stocked via Mullen fallback) from the
  `gradeAvailability` API; legacy has none. Left in place pending user decision.


## 2026-06-16 — Route Comparison panel 1:1 legacy parity
- **Backend** `routing.py::compare_routes`: now returns `breakeven {qty, die}`, `perPc`,
  `cadSaberNeeded`, and `isStock` on the CAD detail (Crest already had it) — verbatim
  legacy `spot_r1_5.jsx` L835-890. Locked by `tests/test_route_comparison_parity.py` (3/3).
- **Frontend** `RightDashboard.jsx::RouteComparison`: rebuilt to match legacy exactly —
  winner badge "{route} wins" with per-route colors (CAD #22c55e / Crest #3b82f6 / Bobst
  #a855f7), all-routes verdict + "Routes are equal" case, breakeven lines ("Crest breaks
  even at N pcs" / "CAD wins below N pcs" / "Crest wins if die < $X"), "✓ Crest path uses
  stock sheets", "Bobst not viable: <reason>", and "Bobst pays mill min" notes; sheet dims
  now 1-decimal.
- **Switch buttons** now fully functional & legacy-parity: Switch to Crest/CAD/Bobst force
  the route, auto-fill a die ($1,200 Crest / $1,800 Bobst) when none is set, collapse the
  panel, and toast; forced state shows "✓ Route forced to X" + "Reset to Auto".
- Verified by testing agent (iteration_24.json): 10/10 acceptance criteria, frontend 100%.
- Note (unrelated): Entra SSO `/api/auth/entra/login` 500s in PREVIEW because
  ENTRA_TENANT_ID is set to "spot-multi-user" (invalid tenant). Use email/password login in
  preview. Prod env should set a valid tenant id.


## 2026-06-16 — A1: restored legacy "Separate Line" die default (user decision)
- `runner.build_prod_inputs`: missing/empty `dieTreatment` now defaults to "Separate Line"
  (was "None"), matching legacy `spot_r1_5.jsx` L3782 exactly. A non-zero saved
  `cuttingDieCost` with no explicit treatment again shows as a separate die line.
- Verified: full engine/MP/route test suite green (63 passed) — no parity regressions.
- B1 (color substitution), B6 (F-flute), B3/B2 (CAD labels / matched-set toggle): left
  unchanged — confirmed these are NOT in legacy, so cloud already matches legacy.

## 2026-02-10 — MP-Individual UX polish (auto-scroll, qty selection, freight treatment, Job Totals)

User feedback after the per-component layout shipped: (a) auto-scroll on every
engine recompute was disruptive, (b) nav chips next to Expand/Collapse All
didn't actually select the component, (c) no way to know what the section
header total reflected when a component had multiple qtys, (d) Freight
Treatment tiles (Line / Amort) only existed in Single-Part — missing in MP,
(e) Job Totals didn't label the Local Delivery zone, (f) multi-qty per
component didn't surface a per-tier breakdown.

### Frontend
- `QuoteTableSec.jsx`: auto-scroll now uses a `prevActiveRef` so it fires
  ONLY when `activeItemIdx` actually changes (clicks), not on engine recompute.
- Nav chips now call `setField("activeItemIdx", …)` so clicking syncs to the
  BOM section and the matching section gets the BOM badge + auto-scroll.
- Per-component sub-table: rows are now clickable to SELECT a qty tier. The
  selected row gets `data-row-selected="true"`, a SEL badge, and an accent
  outline. The section header shows `@<qty>: $<total>` for the selected row
  with a breakdown line (`base $X + frt $Y + die $Z + prep $W`).
- Job Totals footer: when `quoteFOB === "Local Delivery"`, the label becomes
  `"Per-Job Freight: Local Delivery · <zone>"`. When any component has 2+ qty
  rows, the layout switches to a per-tier breakdown table
  (`qt-job-totals-by-qty`) with rows `qt-job-totals-tier-N` showing Items /
  Per-Item Freight / Die / Prepress / Per-Job Freight / Total at each tier.
- `Placeholders.jsx::JobLevelAllocPanel`: adds Freight Treatment tiles
  (`tile-itemfreight-line/amort`, `tile-jobfreight-line/amort`) and Prepress
  Treatment tiles (`tile-itemprepress-line/amort`, `tile-jobprepress-line/amort`),
  scope-gated. Targets `freightTreatment` vs `jobFreightTreatment` based on
  `freightScope`.
- `RightDashboard.jsx::updateFreight`: rewrote to handle MP+Per Item
  (iterates `bomItems`, calls `freightQuote` per component using per-component
  weight, writes each `state.freightCost`) vs MP+Per Job (single combined
  quote → `jobFreightCost`) vs Single-Part (existing behavior). Carrier + FOB
  metadata applied across all updated items.

### Tested
- Backend: 16/16 regression tests still pass (no backend code touched).
- Frontend: testing_agent_v3_fork iteration_10 verified all 8 freight/prepress
  treatment testids render + correctly scope-gated; iteration_9 verified
  nav-chip activeItemIdx, qty-row selection, Local-Delivery label, per-tier
  breakdown, and the `btn-freight-update` Update All code path. Both ran on
  live MP-Individual quotes.

## 2026-02-10 — MP-Individual per-component layout (Quote Table + PDF)

User feedback: in MP-Individual mode (each component has its own qty tier(s)),
the Quote Table was showing a single aggregate row missing Sheet/#Out/CAD-hrs/
Freight detail, and the PDF only rendered the active component. Legacy showed
all components but applied every component's qty to every component (wrong).
The new design follows the user-specified structure: each BOM component
becomes its own section with its own qty rows, and Per-Job costs (freight,
prepress) move to a Job Totals footer.

### Backend
- `POST /api/engine/calculate-multi-part` now returns `componentPricing[]` and
  `jobTotals`. Each `componentPricing` entry: `{itemId, itemIndex, desc, type,
  pcsPerSet, boardSpec, rows[]}`. Each row carries qty, sellPc, costPc, perM,
  sellMSF, costMSF, sheetW, sheetL, pcsPerSheet, route, cadHrs, freightLine,
  dieLineCost, prepressLineCost, sellTotal. In Individual mode rows come from
  the component's own `state.qtys[]` (blanks skipped); in Matched Set mode rows
  come from top-level set qtys with `qty = set_qty × pcsPerSet`.
- `POST /api/pdf/preview-quote` now accepts `componentPricing` + `jobTotals`
  and renders per-component sections (`pricing_table = sections + footer`) when
  the quote is MP-Individual. Matched Set + Single-Part PDFs unchanged.

### Frontend
- `QuoteTableSec` rewritten with two layouts:
  - **FlatLayout** (SP + MP-MatchedSet): unchanged behavior plus added Die +
    Prepress columns to every row.
  - **ComponentLayout** (MP-Individual): collapsible per-component sections
    with sub-tables. Expand-All / Collapse-All buttons + component nav chips
    scale cleanly to 25+ components. Job Totals footer with grand total.
- `PreviewPdfModal` adds `PerComponentSections` for the on-screen PDF preview
  (matches the backend PDF layout). Items / Per-Item / Per-Job rows in footer.
- `useEngine` returns `componentPricing` + `jobTotals` in addition to existing
  fields.

### Tested
- Backend: 22/22 tests pass (10 new + 12 regression) — verified Individual
  picks each component's own qtys, Matched Set multiplies by pcsPerSet.
- Frontend: Quote Table testids (`qt-comp-section-*`, `qt-comp-table-*`,
  `qt-expand-all`, `qt-collapse-all`, `qt-job-totals`, `qt-grand-total`) all
  render. Preview testids (`preview-comp-section-*`, `preview-grand-total`)
  render. PDF preview math matches engine ($8,483.08 grand total on the
  loaded MP sample).

## 2026-06-03 — Multi-Part Parity Sprint ✅ (MP-1 → MP-6)

Full Multi-Part feature parity with the legacy desktop tool. Most production quotes
are multi-part (displays, kits, sets) — this was the blocking gap for cloud adoption.

### MP-1 — State foundation
- `/app/frontend/src/lib/mpSchema.js` — JOB_LEVEL_KEYS / ITEM_LEVEL_KEYS segregation,
  `gatherItemState`, `freshItemState`, `applyItemStateTo`, `makeBomItem`
- `QuoteContext` actions: `switchBomItem`, `addBomItem`, `duplicateBomItem`,
  `removeBomItem`, `reorderBomItem`, `updateBomItem`, `convertToMultiPart`,
  `convertToSimple`
- `BomSec` upgraded: per-item desc/type/pcsPerSet editors, drag-reorder, +Component,
  ⎘ Duplicate, ↗ Spin-off, × Remove
- Toolbar `→ Multi-Part` / `Multi-Part · N` toggle

### MP-2 — Backend orchestration + Quote Table
- `POST /api/engine/calculate-multi-part` — per-component pricing for MFG (full
  pipeline), Purchased (cost × markup), Fulfillment (per-set fee × markup);
  Matched Set + Individual aggregation; GM Override mode (forces uniform GM%)
- `useEngine` hook routes to MP endpoint when `state.quoteType === "Multi-Part"`;
  returns `{results, perComponent, meta, isMultiPart}`
- Quote Table `mp-banner` + `mp-per-component` per-component breakdown table

### MP-3 — Parser → MP auto-apply
- ReviewParseModal detects `parsed.bomItems[]`, renders Job + per-component tabs
  with low-confidence ⚠ badges, applies full MP state via `replaceState`
- Multi-CAD upload already supported by parser route — UI now bridges to MP

### MP-4 — Dashboard + job-level allocation
- Right Dashboard cost buildup now reads `perComponent[activeItemIdx]` in MP mode
  (Material / Print / Cutting / Finishing show per-component, not aggregate)
- Pricing Strategy section adds `JobLevelAllocPanel`: scope toggles + amount
  inputs for freight and prepress, with `By MSF` / `Equal` allocation method
- Backend `calculate_multi_part` calls `allocate_job_cost` for `freightScope=Per Job`
  and `prepressScope=Per Job` to inject `allocatedFreight` / `allocatedPrepress`
  on each component

### MP-5 — PDF parity
- Backend `_customer_pdf_html` MP branch emits the BOM listing
  (Component / Type / Pcs/Set / Specs) and replaces `Qty/Each/Per/M`
  with `Sets/Per Set/Per/M Sets`
- Preview modal renders the same MP layout in the in-app HTML preview

### MP-6 — Polish
- Low-confidence component ⚠ badge on parse-review tabs
- Spin-off action (`spinOffBomItem`): extract one component to a new Simple
  tab with carry-over identity (customer, estimator, est num)
- `spinOffOrigin` shown in Estimate Info as "FROM: <estNum> · <desc>"

### Regression status
- 12/12 backend pytest pass on `calculate_multi_part`
- 4 iteration testing sweeps; 3 issues found and fixed in MP-1..MP-5 verification:
  spin-off render crash (object → string), `BomSec` hook-order violation
  (useState moved before early return), Preview modal MP routing + JSX labels
- Simple-mode quotes verified unchanged

## 2026-06-03 — Sheet Library override fix ✅

Bug: picking a sheet in the Sheet Library modal did nothing — the `onPick`
callback was a no-op stub and the backend never read `overrideSheetId`. Each
multi-part component appeared to "ignore" the chosen sheet.

### Backend
- `engine/routing.py` — new `select_override_sheet()` mirrors legacy
  `spot_r1_5.jsx` L3544-3570 (pricable as-is → use; below mill min → scale
  via stock min-buy; not pricable → return for Buy-Min flag surfacing)
- `engine/runner.py` — Step 1 parses `overrideSheetId` (`"OVR-{w}x{l}"`) and
  short-circuits auto-select. Step 2 skips auto-flip when override active.
  Step 3 pins route to CAD (legacy L3578-3580). `overrideActive` exposed at
  result top-level + in `_pipeline`.

### Frontend
- `pages/SpotApp.jsx` — `onPick` now writes `setField("overrideSheetId", …)`
  via the Sheet Library modal (was a `/* future */` stub)
- `components/spot/SheetLibraryModal.jsx` — owns its own setField/clear flow,
  highlights the active override in purple, exposes "Clear Override" button
- `components/spot/RightDashboard.jsx` Board panel — adds "OVERRIDE" mode
  label + purple banner ("User Override · Route pinned to CAD") with inline
  Clear button when active
- `hooks/useEngine.js` `buildPayload` — propagates `overrideSheetId` for
  single-part mode (already mirrored into bomItems[active].state for MP)

### Verified
- Curl: single-part `OVR-48x96` → engine returns `48×96` sheet, `route=CAD`,
  `overrideActive=true`
- Curl: 2-item MP with override on item B only → A auto-picks, B respects
  override, each component independent

### Follow-up fix (same day)
Right Dashboard panels (Board, Cost Buildup, Economics) showed "no sheet
selected" / "no breakdown" in Multi-Part mode even when the engine clearly
picked a sheet for the active component. `RightDashboard` was calling
`useEngine` and using `results[selSlot]` directly — which in MP mode is the
aggregated job row (no `sheetW`/`boardTotal`/`matTotal`). `SpotApp.jsx`
already branched to `perComponent[selSlot].items[activeItemIdx]` for the
main column; RightDashboard now mirrors that exact branching.

## 2026-06-03 — Pass 1: Quote Table interactivity + Economics gaps ✅

### Quote Table (`QuoteTableSec.jsx`, `defaults.js`)
- Click a Qty row → `selSlot` updates, drives Per-Component, Order Total,
  Economics, Cost Buildup, Board, Route panels (legacy parity)
- Selected row gets accent-soft background + "SEL" badge + bold qty
- Row tint by mode: Stock (green) / Custom (blue) / Below Min (orange)
- ACT checkbox toggles per-row exclusion; excluded rows dim to 45%
- When the user excludes the currently-selected row, selection auto-jumps
  to the first remaining active row (no stale Order Total display)
- "All Active" button resets all exclusions
- "Excluded from PDF" badge appears in Order Total breakdown when user
  manually clicks an already-excluded row
- New state field: `state.exportExclude: number[]` (JSON-serializable)
- Per-Component Breakdown header now reads `selSlot` + shows "Click a Qty
  row above to switch" hint

### Economics panel (`RightDashboard.jsx`)
- Matched Set top block when MP + pricingMode=Matched Set: setQty sets,
  Sell Total, Sell/Set, Margin %, Margin $, Total Cost, Cost/Set + optional
  Line Charges / Quote Total summary line
- Type badge MFG/PUR/FUL with color (green/blue/amber)
- "Active Component" / "Item" section label + child number (-1, -2…)
- Sell row line-item breakdown row: Freight + Die + Prepress + Order when
  line-items active (was: only freight + order)
- Fulfillment "Cost Only" mode — 50% dim + amber label

### Cost Buildup → Order Total reconciliation
- In MP mode the One-Time Line Items section now reads JOB-LEVEL totals
  from the aggregate row (Items all components + Freight + Die + Prepress
  + Order Total). The label changed from "Quote Total" to "Order Total"
  in MP, matching the Quote Table footer. Eliminates the $1,414.16 vs
  $2,170.93 mismatch users saw before.
- Backend `engine_routes.calculate_multi_part` now exposes line items
  separately on the aggregate (`freightLine`, `dieLineCost`,
  `prepressLineCost`, `miscLineCost`, `itemsSell`). Math is identity-
  equivalent to the previous lumped `line_charges`.

### PDF/Preview (`PreviewPdfModal.jsx`)
- Excluded rows are filtered out of `previewRows` before being passed to
  the backend PDF generator

### Engine math
- Untouched. Zero changes to `engine/core.py`, `engine/pricing.py`,
  `engine/runner.py`, `engine/routing.py` in this pass.

## 2026-06-03 — Pass 2: BOM Builder feature parity ✅

Keeps cloud's compact layout but adds legacy functionality.

### New backend collection + routes
- `db.COL_BOM_TEMPLATES = "bom_templates"`
- `routes/bom_templates.py` — full CRUD + promote (personal → team)
- Two scopes: `personal` (visible only to owner) and `team` (visible to
  every authenticated user — org-shared). Persisted server-side, not
  localStorage — different from legacy's single-user design.
- Owner-or-admin permission on update / delete / promote

### Frontend BOM Builder (`BomBuilderModal.jsx`)
- **Project Name** field at the top — bound to `state.custRef` (matches
  existing Estimate Info field, so they stay in sync)
- Three template sections rendered side-by-side:
  - **Display Styles** — built-in 10 (`displayTemplates.js`)
  - **My Templates** — personal, fetched from backend
  - **Team Templates** — org-shared, fetched from backend
- Each personal/team template card has hover actions: edit (✎), promote
  (↗, personal only), delete (×)
- Per-row **Lock** icon (🔒/🔓) — disables editing for that row
- "Lock All / Unlock All" toggle button at footer
- **Save Template** inline panel — Save (Personal) / Save (Team) /
  Update for existing, with name input
- **Drag-and-drop** reorder via the ⠿ handle (existing ▲▼ buttons kept)
- **Dim info** badge under each component when source BOM has dims set
  (e.g., "● 47.25×38 · 2 pcs/set")

### Verified
- Curl: full CRUD smoke-tested (create → promote → update → list → delete)
- Backend lint clean, frontend lint clean




### 2026-06-22 — Freight (Local Delivery) markup fix + PDF charge-line parity ✅
- **P0 ROOT CAUSE — Local Delivery wrongly marked up 15%**: markup-zeroing keyed
  off the removed `quoteFOB === "LocalDelivery"` FOB option. Local delivery is
  now zip-resolved → carrier "SPC Local Delivery"; with FOB=Ship the 15% markup
  wrongly applied ($70 → $80.50; matched-set $150.50). Business rule: markup ONLY
  applies to common carriers (not our own truck).
  - **Engine (authoritative, single source of truth)**: `runner.build_prod_inputs`
    forces `freightMarkup=0` whenever the resolved `freightCarrier` is
    "SPC Local Delivery"/"Local Delivery" — covers single-part AND every MP
    component. `engine_routes.calculate_multi_part` does the same for Per-Job
    allocation + aggregate.
  - `useEngine.js` now passes `freightCarrier` on single-part, MP per-item, and
    MP top-level payloads. `freight.js` adds shared `isLocalCarrier()`.
  - `RightDashboard.jsx` freight cards + Cost Buildup now detect local by carrier
    (verified live: Per-Job card shows "$70.00 + 0% markup = $70.00").
- **PDF/Preview "Charges" → "Freight"** in By Type mode when Freight is the SOLE
  line charge (stays "Charges" if Die/Prepress/Misc also present). pdf.py +
  PreviewPdfModal.jsx.
- **Amortized charges never render as a line**: matched-set Per-Job aggregate now
  respects `jobFreightTreatment` — Amortize bakes freight into set sell (no Freight
  row). (Per-item / single-part already 0 via engine.)
- **Individual-mode PDF/Preview shows per-component line-charge columns**
  (Freight/Die/Prepress/Misc) ONLY when treatment=Line (verified live: FREIGHT
  column now visible per component). pdf.py + PreviewPdfModal.jsx.
- **Tests**: new `tests/test_local_delivery_markup.py` (4) + 3 new HTTP cases in
  `test_per_job_allocation.py` (local-delivery flat, matched-set Amortize hides
  line + bakes in). 50/50 pass across freight/PDF/engine suites.

### 2026-06-22 (cont.) — Amortize hides all cost data + fixed Individual summary double-count ✅
- **User rule**: Amortize = bake charge into price, NEVER show the customer the
  cost; Line = show the cost. Removed all customer-facing cost leaks on Amortize.
- **Bug found + fixed (P0 double-count)**: Individual-mode Quote Summary added
  the flat `jobFreightCost` ON TOP of component sellTotals that ALREADY include
  the allocated per-slot freight — overstating the total (e.g. $3,883.35 vs the
  correct $3,813.35) AND leaking the freight $ via an "Includes job-level
  freight $X" note even on Amortize. Fixed in BOTH `pdf.py` and
  `PreviewPdfModal.jsx`: summary total = Σ component sellTotal (no re-add); note
  removed. Quote Summary now matches the per-component section sums exactly.
- Verified live: Amortize → freight baked into "Each", no Freight column/line/
  note; Line → Freight column shown. Summary no longer double-counts.
- **Local-delivery 3-zone costing confirmed legacy-faithful** (`freight.py`
  `_spcoc_local_rate`, verbatim port of `spcLocalRate()`): Zone 1 Canton $45 /
  Zone 2 Akron-Alliance $70 / Zone 3 Cleveland-Youngstown-Mansfield $95; ZIP
  44647→446→Zone 2→flat $70 (now un-marked-up). 50/50 freight/PDF tests pass.

### Backlog addition — 2026-06-22
- **P2: Email Quote from SPOT (Microsoft Graph)** — Send the generated customer
  PDF directly from SPOT via Microsoft Graph `sendMail` (leverages existing M365 +
  Entra SSO; no third-party vendor / DNS verification needed).
  - Send "From" either a shared `estimating@spcoc.com` mailbox (needs
    `Mail.Send.Shared`) OR the logged-in estimator's own mailbox (`Mail.Send`).
  - Send dialog: editable To / CC (buyer = To; CS rep + salesperson = CC, all
    editable), auto-attach quote PDF, editable subject + body template
    (quote #, customer, project, total, validity).
  - Pre-fill recipients from the customer record — requires adding CS rep /
    salesperson / buyer email fields to the customer schema (editable per-send).
  - IT action: grant the existing Entra app registration `Mail.Send`
    (+`Mail.Send.Shared` for shared mailbox). Status: brainstorming — not started.

### 2026-06-22 — TEMPORARY cutting-complexity test (Issue 3 / D-110 anomaly)
- **Removed "Straight"** from cutting DIFFICULTY UI option (`defaults.js` DIFFICULTY
  → Simple/Standard/Complex). Stripping complexity (STRIP_COMP) still has Straight.
- **TEMP test values** in `engine/core.py` (per user, to run on a live quote):
  - `CAD_SETUP = {Simple:15, Standard:15, Complex:15}` (was 8/Straight20/25/22)
  - `CAD_FALLBACK = {Simple:2, Standard:4, Complex:6}` (was 2/Straight6/2/4)
- ⚠️ These TEMP values intentionally shift cutting cost + cost-aware routing.
  4 golden-$/parity tests fail BY DESIGN while active (test_auto_die::cad_route_no_auto_die
  flips CAD→Crest, test_below_min storage_bin parity, 2× test_matched_set_parity
  L'Oreal totals). They will pass again once values are reverted to baseline.
  REVERT before any production deploy unless the new calibration is approved.

### 2026-06-22 (cont.) — Rolled back CAD test values + added editable CAD rates in Admin
- **Reverted** CAD_SETUP/CAD_FALLBACK to baseline (Simple 8/Standard 25/Complex 22
  setup; Simple 2/Standard 2/Complex 4 per-sheet). "Straight" stays removed.
- **NEW: Admin → "Cutting (CAD)" tab** to edit cutting-time rates without code:
  - `CAD Setup (minutes)` and `CAD Per-Sheet (min/sheet)` by complexity
    (Simple/Standard/Complex), via the existing DB-backed, audited, resettable
    rate-override service (2 new categories `cad_setup` / `cad_fallback`).
  - Files: `services/rate_overrides.py` (+2 categories, live-dict refs to
    engine.core CAD_SETUP/CAD_FALLBACK), `routes/admin_rates.py` (CATEGORY_META),
    `pages/AdminPage.jsx` (combined "Cutting (CAD)" tab w/ formula explainer).
  - Verified end-to-end: set cad_setup/Standard=85 → CAD-routed quote cadHrs
    0.58→1.58, cutterDirect $80.50→$218.50; reset → baseline restored. Audited.
- **Press Rates vs CAD rates (user Q)**: different things. "Press Rates" (Rates
  tab) = $/hr equipment rates (cadRate, crestRate…). CAD Setup/Per-Sheet = the
  TIME (minutes) a cut takes by complexity. Cutting cost = (Setup + Per-Sheet×
  sheets) ÷ 60 × cadRate. Both now admin-editable.

### 2026-06-23 — Crest approval warnings + Saber blanks messaging (legacy parity)
- **Crest Approval popup ported** (`CrestApprovalModal.jsx`, wired in RightDashboard):
  fires when the active component routes to Crest AND die > 1,000 rule-inches/sheet.
  Buttons: **Acknowledge** (keep Crest, flag for mgmt approval) / **Force CAD Instead**
  (sets routeOverride=CAD). Shows **once per component per quote-open** (per user;
  legacy re-popped every selection). Verified live + Acknowledge no-re-pop.
- **Per-component quote-table banner fixed**: `runner.py` was overwriting the Crest
  approval warning with "Forced to Crest" when the route was forced — now the
  approval warning persists (route forced to Crest + rule>1000 → real warning;
  else "Forced to Crest"). Quote-table renders it per-row, so only the applicable
  component(s) show the banner. Verified live (Litho Counter Tray warned, RSC not).
- **Saber blanks messaging ported** (`ProductionSpecsSec.jsx` + runner result fields
  saberOut/saberBlankW/saberBlankL/saberBlanksOutN): "→ N blanks at W×L — M out/blank"
  (legacy spot_r1_5.jsx L6091). Verified live: "→ 4 blanks at 60×30.0 — 2 out/blank".
- **Answered (no code change):** (a) Bobst only appears when flute is E/F (manual
  §3.5) — both compared quotes were E flute so both correctly showed Bobst.
  (b) Route Comparison winner differed because DIE COST differed ($1,200 vs $500);
  Crest 2h vs 1.3h = Advanced vs Standard complexity — Crest rates are identical
  to legacy (Adv 90/Std 45 min, 150 sh/hr, 0.8 factor, $45/hr).
- **Could NOT reproduce** "Economics hidden when Saber on" — Economics panel renders
  fully with Saber=Yes in preview. Need exact repro (route/mode) from user.

### 2026-06-23 (cont.) — Crest die auto-estimate parity ($1,200, not $500)
- **Root cause**: cloud's route comparison fed `totalRuleInches` into a Crest die
  estimate `min(3000,max(500, ruleIn*pps*1.15*0.02))` → floored to **$500**. Legacy's
  `compareRoutes` caller (spot_r1_5.jsx L3689) NEVER passes rule-inches, so `ruleIn=0`
  → the die always defaults to `crestDieCost` (**$1,200**). Rule-inches in legacy drive
  ONLY the approval warning, not the die-cost estimate.
- **Fix** (`routing.py` L505-509): Crest die (when user hasn't entered one) =
  `crestDieCost` default ($1,200), matching legacy. Approval warning unchanged.
  Verified: /compare-routes returns crest.die=1200, dieEstimated=true, warning intact.
  Switching to Crest now auto-populates the die field to $1,200 like legacy.

### 2026-06-23 (cont.) — Cost Buildup detail grouping fix + Route msg parity confirmed
- **Cost Buildup DETAIL — sub-lines were under the wrong headers** (bug present in
  legacy too; user wanted it fixed, not mirrored). Sub-rows rendered BEFORE their
  section header (off-by-one). Reordered (RightDashboard CostBuildup) so each header
  precedes its own lines: Material→MR/Spoil; Print→Press+Ink; Cutting→Crest blanks;
  Finishing→Stripping+Glue/Tape. Totals were always correct. Verified live.
- **Route Comparison messaging confirmed 1:1**: diffed cloud vs legacy spot_r1_5.jsx
  L6930-6964 — rows (Sheet/Layout/Sheets/Board/Press/Cutting/Die/Total/Per piece) and
  verdict lines (cheaper-than/breaks-even/die-hurdle/Saber-needed/stock/Bobst-not-viable/
  mill-min) are identical. The apparent "different messaging" was caused by the Crest
  die ($500 vs $1,200) — fixed earlier — which flips the winner & dollar deltas.

### 2026-06-23 (cont.) — "Saber On" Economics pill
- Added the missing **"Saber On"** routing pill in the Economics panel (next to
  Cut/Strip pills), shown when saber==="Yes" — legacy parity (spot_r1_5.jsx L7078,
  teal #14b8a6). Verified live: PRINT SATIN · CUT CREST COMPLEX · SABER ON · STRIP COMPLEX.

### 2026-06-23 (cont.) — Collapsed-section summary pills
- Added summary pills to collapsed section headers (shown ONLY when collapsed via
  `badge={!sec.X ? summary : null}`):
  - Pricing Strategy → pricingMode (MP) · basis (GM%/$/MSF) · freight scope · prepress scope
  - Board Engine → pricing version label (❄ prefix + warn style when frozen)
  - Files → total staged + saved file count ("N file(s)", green accent)
- Item Setup (READY/ATTENTION) and Production Specs (route) badges left always-visible per user.
- `.sp-badge` given max-width:320px + nowrap ellipsis so long summaries truncate cleanly.
- Files: components/spot/Placeholders.jsx, FilesSec.jsx, theme.css. Verified via screenshot (dark mode).

### 2026-06-23 (cont.) — Collapsed pills refined per spec
- Production Specs collapsed → print mode+sides · saber(if Yes) · route · strip(if Yes) · glue(if Yes) · tape(if Yes). Route-only badge kept when expanded.
- Pricing Strategy collapsed → pricingMode(MP) · basis; freight shown ONLY when scope=Per Job, prepress shown ONLY when print on & scope≠None.
- Board Engine collapsed → pricing version · order MSF (r.oMSF) · MSF tier (r.msfTier). BoardEngineSec now takes result prop (SpotApp passes primary).
- Item Setup collapsed → board specs (grade · flute · outLiner/inLiner · medium); READY/ATTENTION kept when expanded.
- Verified live: 200 E · KRAFT/KRAFT | SATIN 1S · AUTO→CAD · STRIP | INDIVIDUAL · GM% · PREP ITEM | 2026-06-15 · 3.25 MSF · 0-9 TIER | 1 FILE.

## 2026-06-25 — Per-Quote Rate Freeze (Phase 2)
- Admin RATE changes (CAD setup/per-sheet, machine rates, grade adders, markups/fees) now apply ONLY to drafts + new quotes. Saved quotes stamp a `rate_snapshot` at save and always recalc on those frozen rates; Duplicate re-prices at live rates. Mirrors the existing board/stock freeze. No user warning (warnings stay board/stock-only).
- Engine: `_rate_freeze` ContextVar + `use_rate_freeze()` + `active_cad_setup/active_cad_fallback/active_grade_adders/active_rate_defaults` accessors (engine/core.py). pricing.py/routing.py/runner.py read rates via accessors.
- `with_pricing` (engine_routes.py) resolves the snapshot by `quoteId` (drafts→live, legacy→baseline) and injects ASMP rateOverrides. quotes.py stamps snapshot on create/copy; startup backfills legacy quotes to in-code baseline (53 in preview, idempotent).
- Frontend useEngine.js sends `quoteId` in both calc payloads.
- Verified: 7/7 backend tests (iteration_57.json) — saved quote byte-identical after a live CAD rate change; draft reflects new rate; duplicate re-prices; no 500s.
- NOTE: backfill assumes pre-existing saved quotes were priced at in-code baseline rates (true since prod rate edits were made recently). No save-time rate history exists for legacy quotes, so baseline is the best approximation.

## 2026-07-08 — P0 Large-RFQ Parser Fix (output truncation)
- RFQ parser threw a "network error" on large multi-item RFQs (~50 components). Root cause: hard
  `max_tokens: 16384` output ceiling → 50+ item JSON responses hit `stop_reason: max_tokens` and
  truncated (surfaced as a generic failure).
- Fix (routes/parser.py): raised output ceiling to env-configurable `ANTHROPIC_MAX_OUTPUT_TOKENS`
  (default 64000). Opus 4.8 supports up to 128K output on the standard Messages API (no beta header).
  Also raised the httpx streaming timeout 300s→600s to match the 10-min frontend polling ceiling
  (64K-token streams can take several minutes).
- Verified end-to-end (curl, real Anthropic key, preview): synthetic 50-item RFQ → job done,
  stop_reason=end_turn, 50 bomItems returned, output_tokens=14,388 (would have truncated at the old
  16K cap). No network error, no truncation.

## 2026-07-08 (cont.) — P0 Parser Cloudflare 520 on large CAD RFQs (PROD)
- Symptom (production): clicking "Build Estimate" on a large RFQ returned Cloudflare Error 520
  ("origin returned an empty response / malformed HTTP headers").
- Root cause: the submit endpoint `/api/parser/parse-rfq-async` did all heavy work INSIDE the
  request — disk persist, high-DPI PDF tiling (up to 20 tiles @ 220 DPI, PNG optimize=True), base64
  — which for large CAD PDFs exceeded Cloudflare's ~100s origin timeout → 520 on the submit call
  (not wrapped in the poll-retry loop, so it surfaced directly).
- Fix (routes/parser.py): submit now reads ONLY the raw upload bytes inside the request (streams
  must close there) and wraps them in a module-level `_BufferedUpload`; ALL expensive processing
  (`_prepare_content` + Anthropic call) is deferred to the background task `_run_full_parse_job`.
  New intermediate job status "parsing" (frontend poll loop already treats non-done/error as
  keep-polling — no FE change needed). Removed the now-unused `_run_parse_job`.
- Verified end-to-end (preview, real key): submit returns instantly (pending, files=[]); job
  transitions pending→parsing→done; 50 bomItems returned, stop_reason=end_turn, files=1.
- REQUIRES REDEPLOY to reach production.

## 2026-07-08 (cont.) — Parser quantity-matrix fix + Crayola RFQ diagnosis
- User report (Crayola Meijer 28ft POG RFQ): spreadsheet + CAD; parser missed per-item quantity
  totals and (in prod) prompted "try a smaller RFQ".
- Root cause A (quantity): the spreadsheet spreads qty across POG store-size columns
  (28ft/32ft/36ft/40ft/44ft/48ft) with a "Totals" column per row. Parser wrongly treated the size
  columns as qty price-break tiers (qtys=[18,22,22,31,25]) instead of using the Totals value.
- Fix A (parser_knowledge.py, QUANTITY EXTRACTION): added QUANTITY MATRIX rule (use the
  Total/Totals/Grand Total column as the item qty; size/region/wave columns are NOT tiers; sum +
  CALC-tag if no totals col) and GROUPED DISPLAY ROWS rule (one bomItem per spreadsheet row, do NOT
  merge rows sharing a design #; estimator groups afterward — user chose option c).
- Verified (preview): spreadsheet-only → 49 items, each qtys=[row Totals] (125/18/107/22/63/32/7).
- Root cause B ("smaller RFQ" in PROD): combined spreadsheet+BOM.pdf parse emits 19,056 output
  tokens — exceeded the OLD 16K max_tokens cap in production → truncation → the 413 "too many
  components, split it" message. Already fixed by the 64K ceiling change (this session), not yet
  deployed to prod. Verified in preview: combined parse → 49 items, stop_reason=end_turn, no error.
- REQUIRES REDEPLOY to reach production (covers both this qty fix AND the 64K/520 fixes).

## 2026-07-08 (cont.) — Parser .msg "not an OLE2 structured storage file" fix
- User report (new user, PROD): parse failed with "error: not an OLE2 structured storage file".
- Root cause: new Outlook / OWA / web "Save as .msg" exports files with a .msg extension that are
  actually MIME (RFC822), not OLE2 compound files. extract-msg (em.openMsg) rejects those, so the
  email body + attachments were lost and the parse returned empty ("attach RFQ/CAD" asks).
- Fix (utils/email_extract.py, _extract_one): check the OLE2 magic header (D0 CF 11 E0 A1 B1 1A E1);
  if a .msg isn't OLE2, parse it with the MIME/.eml parser instead. Genuine OLE2 that extract-msg
  still can't read also falls back to MIME as a last resort.
- Verified: a MIME email named .msg → subject/body/PDF attachment all recovered (previously raised);
  plain-text .msg no longer raises; end-to-end parse endpoint extracts email body + attachment
  correctly (test only errored on a deliberately-fake PDF payload, not the .msg handling).
- REQUIRES REDEPLOY to reach production.

## 2026-07-13 — Perf % input: whole-percent entry (UX), decimal storage (parity kept)
- Problem: Perf % field expected a decimal FRACTION (0–1) but was labeled "%", so typing a whole
  number (e.g. 50) fed the engine perf=50 → cutting-runtime multiplier (1-perf)+(perf/0.4) = 76×,
  exploding the cut cost. Confirmed NO legacy/cloud math mismatch — formulas (pricing.py 85/95 ==
  SPOT_R1.5.html 2344/2356), rate default (cadPerfSpeedFactor=0.40), and the old 0–1 input were
  all identical. Root cause was the fraction-vs-percent input-scale trap (native input max=1 does
  not clamp typed values).
- Change (frontend ProductionSpecsSec.jsx only): Perf % input now accepts a WHOLE percent (25 = 25%),
  clamps 0–100, and stores the decimal fraction (0.25) the engine expects. Engine math, stored data,
  PDF, and pricing parity are UNCHANGED — only the input display layer converts (×100 in, ÷100 out).
  Added title hint "Enter whole percent, e.g. 25 for 25%".
- NOTE: deliberate UX deviation from legacy R1.5 (which took 0–1). Existing saved quotes store perf
  as a fraction and display correctly (0.5 → 50). Verified via UI: entered 25 → field shows 25 →
  stored 0.25 (round-trip confirmed).
- REQUIRES REDEPLOY to reach production.

## 2026-07-13 (cont.) — File storage → GridFS (fix "File blob missing on disk")
- Problem (PROD): files attached to saved quotes showed "File blob missing on disk". Root cause:
  blobs were written to the container's local disk (/app/backend/uploads), which is EPHEMERAL —
  every redeploy/restart wiped the disk while the parser_files Mongo metadata survived.
- Fix (persistent storage): file BYTES now live in MongoDB GridFS (db.py gridfs_bucket).
  * services/parser_files.py: save→upload_from_stream; added read_parser_file_bytes; get/list hide
    internal handles; soft_delete + purge delete from GridFS; reassign unchanged.
  * routes/parser.py: download/preview/email-attachment-preview read bytes from GridFS
    (download returns Response(bytes) with Content-Disposition; no more disk paths).
  * Legacy disk-stored records (no gridfs_id) return a clean 410 — those old blobs are gone.
- Workflow change (per user): removed the manual "Attach to quote" button (btn-attach-files) +
  attachFiles/attaching. Files auto-save on parse (existing persist_for path); runParseDirect also
  persists any non-RFQ staged files so nothing attached is lost. Delete kept with a stronger
  "permanent, cannot be undone" confirm.
- Verified end-to-end (preview): upload→GridFS, list (no leaked handles), preview PDF+CSV,
  download byte-identical to original, delete removes blob (subsequent access 404). Frontend
  compiles; attach button gone.
- REQUIRES REDEPLOY to reach production. Old (pre-fix) attachments are unrecoverable.

## 2026-07-13 (cont.) — Parser: artwork VERSIONS split + prepress-per-item
- User RFQ (Elvive floorstand, prod quote RW-260709-132147): "SHELVES CAD 379-8675-05, 3 VERSIONS,
  each 525 qty" (3 artworks sharing ONE common die). Parser collapsed the 3 versions into a single
  shelf line, so only 1 prep charge instead of 3 and shelf volume under-represented.
- Q&A findings: (Q1) "N-out" is auto-computed by compute_layout (core.py:556) from one-up dims vs
  sheet size — 2-out/3-out adjusts automatically by size; caveat = single orientation, no rotation
  (the P2 Bobst/Saber grain item). (Q2) prepress is applied PER line item (pricing.py:160), so 3
  separate version items = 3 prep charges.
- Parser tuning (parser_knowledge.py): ARTWORK VERSIONS rule — when an RFQ says a component has
  N artwork versions sharing one CAD/die, emit ONE bomItem PER version (overrides "same Design # =
  one component"), each at the stated per-version qty, IDENTICAL dims/board/die, desc labeled
  "<name> — Version k of N", shared die charged once (V1 default, V2..N dieTreatment="None") + an ask.
  Also rule 7d: printed components must not carry prepressTreatment="None"; rule 7c reinforced to set
  colorsFront per component in Multi-Part.
- Deterministic backstop (routes/parser.py normalization): the model kept emitting
  prepressTreatment="None" on printed items (zeroes the prep charge). Now flip printed items
  None→"Auto" post-parse so the standard per-item/per-artwork prep applies (~$50 each; estimator can
  still turn prep off in the UI). NOTE: this makes prep appear by default on ALL printed items.
- Verified (preview, real key): Elvive RFQ → 9 bomItems = Shelves V1/V2/V3 (525 each) + 6 components
  (525 each); all colorsFront correct (4; Product Box 1); all prepress=Auto (9 prep charges);
  shared-die ask present.
- REQUIRES REDEPLOY to reach production.

## 2026-07-13 (cont.) — Load Quote: search by Customer Ident
- Added state.custIdent to the quote search $or clauses (routes/quotes.py list_quotes) so the Load
  Quote search box matches on customer ident (full or partial). Updated LoadQuoteModal placeholder
  to "Search est#, customer, ident, project, item, team, owner…". Verified: q=2603658 / 2603692.ARD
  / 4444 return the matching quotes. REQUIRES REDEPLOY for production.

## 2026-07-20 — PARKED: CAD cutting cost calibration (revisit later)
- User wants to keep legacy cutting FORMULA but calibrate its params against real data. Analysis of
  668 real jobs (CuttingInchesPerSheet × ActualSheets vs ActualCuttingCost, data is RUN cost only,
  no makeready): through-origin fit = $0.00470/cut-inch. Legacy assumes 650 in/min @ $138/hr =
  $0.00354/inch → legacy UNDER-costs cutting RUN by ~25-33%. Implied real regular speed ≈ 490 in/min
  @ $138. ERP ComplexityOfCut carries run-speed signal (Standard ~525 vs Complex ~368 in/min) even
  though the estimator's manual difficulty pick historically did not.
- Work-center rates (ERP): Kongsburg $72/hr, LG Zund $69, Sm Zund $69 (SPOT currently uses $138).
- OPEN OPTIONS (not yet done, user parked): (a) nudge cadRegularSpeed 650→~490 to match actuals;
  (b) reconcile $138 vs ~$70 work-center rates; (c) get makeready-hours sample to calibrate CAD_SETUP.
- NO CODE CHANGED. Straight tier already removed (2026-06-22); DIFFICULTY = [Simple,Standard,Complex].

## 2026-07-21 — FIX: Tape cost + Proofs not showing (cost buildup + PDF); batch wiring completed
- ROOT CAUSE (tape/proofs missing on PREVIEW): frontend engine payload builders (useEngine.js
  buildPayload + buildMpPayload) omitted tapeStrips/tapeStripLength AND all proof fields
  (proofTreatment/proofCost/proofMarkup) → engine got 0-length strips (tape=$0) and proofs
  defaulted to "None". Also backend run_estimate() result dict omitted proof keys
  (proofLineCost/proofEmbedded/proofBase/proofTreatment), so even when proofs computed they
  never reached the frontend/PDF. Both fixed. MP path (engine_routes.py componentPricing rows_out
  + slot aggregation) also now carries proof (line_proof).
- FIX: Tape LABOR formula corrected per user. Was qty×strips×stripLen×$0.00245/inch (gave $0.86 on
  100pc×2strips). Now LABOR by strip count like gluing/stripping:
  (ord_qty × #strips) / tapeStripsPerHour × tapeLaborRate. Defaults 60 strips/hr @ $30/hr
  (= $0.50/strip). 100pc×2strips → 200/60×30 = $100.00 (verified curl + UI). Strip length is
  descriptive only (PDF spec line + cost-buildup label), NOT a labor driver.
- Admin rates: Tape group now exposes tapeLaborRate ($/hr) + tapeStripsPerHour (both in
  RATE_DEFAULTS/ASMP_DEFAULTS + _RATE_TO_ASMP map). Old tapeCostPerInch key kept in defaults
  (unused) to avoid breaking any stored override. defaultProofCost/proofMarkup already present.
- PDF (routes/pdf.py): charge rows reordered so Die is LAST (Freight, Prepress, Proofs, Misc, Die);
  Proofs row + tape spec descriptor (_tape_short) already present.
- PreviewPdfModal.jsx: proofs added to hasLineItems, a Proofs column (after Prepress) in By-Part,
  chargeLabel/chargesTotal/lump-sum sums.
- Documents feature COMPLETED: DocumentsSec.jsx wired into SpotApp (below Files); fixed its Sec
  props (label/open/onToggle + sec.documents/toggleSec) and useQuote destructuring (active.state).
  Uploads use source="document" (GridFS), FilesSec excludes them, LoadQuote shows Paperclip count
  via quotes.py file_count.
- Estimator Notes: verified persists via state save/load; QuoteHeaderModal labels "Quote Notes
  (appears on the Letter of Quote)" + "Estimator Notes (internal — NOT on the Letter of Quote)";
  pdf.py renders ONLY quoteNotes (estimatorNotes never printed).
- Parser rules present in parser_knowledge.py: IOR/I.O.R.→totalRuleInches; email body overrides CAD
  materials/finish; CAD Blank/Flat size used ONLY when customer orders "sheets", else W×L.
- Testing agent iteration_67: 100% (backend 5/5, frontend 6/6). Formula correction verified via
  curl ($100) + UI screenshot (Finishing $100.00). REQUIRES REDEPLOY for production.

## 2026-07-21 (cont.) — Tape = MATERIAL + LABOR (correction)
- Clarified by user: tape (like every non-one-time cost) has BOTH a material and a labor component.
  Prior code had material-only (qty×strips×stripLen×$0.00245/in ≈ legacy $0.03/ft clear tape); the
  first fix wrongly REPLACED it with labor-only. Now assembly_cost = material + labor:
    material = ord_qty × strips × stripLen(in) × tapeCostPerInch
    labor    = (ord_qty × strips) / tapeStripsPerHour × tapeLaborRate
  Verified: 100pc×2strips×1.753" → $0.86 material + $100.00 labor = $100.86.
- Admin Tape group exposes tapeCostPerInch, tapeLaborRate, tapeStripsPerHour (all editable).
- NOTE: Film & Foam currently share one material rate; user may later want distinct rates. REDEPLOY needed for prod.

## 2026-07-21 (cont.) — TEMPORARY: "Good for testing" flag + legacy-comparison xlsx report
- Toolbar (Toolbar.jsx), before the Load button: a "Test" checkbox that flags the OPEN quote
  (state.goodForTesting); when checked, an "iQuote #" input appears (state.iquoteNum); plus a
  "Report" button. All marked TEMPORARY (to be removed later).
- Backend: PATCH /api/quotes/{id}/test-flag {good_for_testing, iquote_num} sets state.goodForTesting
  + state.iquoteNum on the saved quote (also persists via normal Save through state).
- Backend: GET /api/quotes/_report/testing.xlsx — finds all quotes with state.goodForTesting=true,
  re-runs the pricing engine in-process (calculate_all / calculate_multi_part) per quote so numbers
  match the app, and exports openpyxl .xlsx. One row PER COMPONENT with columns: SPOT Estimate #,
  iQuote #, Project Name, Quote Type, Component, Qty, Material Cost, Print Mode, Print Cost, Route,
  Route Hours, Difficulty, Inches of Rule, Perf %, Cutting Cost, Strip Difficulty, Strip Cost,
  Glue Joints, Glue Difficulty, Glue Cost, Tape Type, Tape Strip Count, Tape Inches, Tape Cost,
  Freight, Die, Prepress, Proofs, Misc, Total Cost, Margin %, Sell Total, Quote Total.
- defaults.js: added goodForTesting:false, iquoteNum:"".
- Verified: curl PATCH + xlsx download (5.7KB, correct columns/values incl tape $50.24, proofs $200,
  margin 31.4%); UI screenshot shows checkbox→iQuote field→Report button before Load. REDEPLOY for prod.
- STILL PENDING (backlog): split shipments, combining components onto one skid.

## 2026-07-21 (cont.) — Testing flag: added "Became a Job?" checkbox + report column
- Toolbar: when "Test" is checked, a "Job?" checkbox appears (state.iquoteWon) alongside iQuote #.
- PATCH /api/quotes/{id}/test-flag now accepts became_job → sets state.iquoteWon.
- Report: new "Became a Job" (Yes/No) column, placed right after "iQuote #".
- defaults.js: iquoteWon:false. Verified via curl (column = "Yes") + UI screenshot (Job? checkbox). REDEPLOY for prod.

## 2026-07-23 — Parser fixes: concurrency, total-rule, email-artwork; corrugation pending
- BUG (blocking): RFQ parse blocked ALL open quotes / one-at-a-time. Cause: FilesSec held busy+polling
  in a single shared component (SpotApp renders one FilesSec for the active quote). FIX: lifted parse
  jobs into QuoteContext keyed by quoteId (parseJobs + startParse + ackParseJob). Parses now run in the
  background per-quote (fire-and-forget), never block other tabs, and switching tabs no longer cancels
  them. Per user choice, a finished parse is held SILENTLY on its quote and the review modal auto-opens
  when the estimator returns to that quote (FilesSec completion effect + shownRef guard, one-shot ack).
  Backend already supported concurrent parses (asyncio.create_task + Mongo jobs). Smoke-tested: app
  loads clean, no console errors. NOT yet E2E-tested with real concurrent Anthropic parses.
- BUG (IOR): parser reported the "Knife Rule" line instead of TOTAL rule. FIX (parser_knowledge.py):
  must use Total Rule (sum of knife/cut + score + perf + etc.); if only a per-category breakdown exists,
  sum them; never report a single-category figure as totalRuleInches.
- BUG (email artwork fails parse, ~390KB): Anthropic accepts ONLY jpeg/png/gif/webp; any other inline
  image (tiff/bmp/heic/eps/ai/svg/emf/wmf) 400'd the WHOLE request. FIX (parser.py):
  _sanitize_image_for_anthropic() passes supported+sane images through, re-encodes unsupported/oversized
  to downscaled PNG via Pillow, and SKIPS unreadable vector art (logging it) instead of failing the parse.
  Unit-verified: BMP->PNG, 3000px->1567px PNG, JPEG passthrough, EMF/garbage->skipped.
- OPEN (corrugation reversing): user confirmed prod already has the earlier detection improvements.
  Phrase on drawing: "corrugate across the vertical dimension" — ambiguous (along vs perpendicular).
  Awaiting a NUMERIC example to lock the vertical/horizontal -> oneUpW mapping direction before editing.

## 2026-07-27 — Corrugation detection FIXED + validated on real CADs
- User supplied 3 real CADs. Confirmed mapping was CORRECT (vertical corr -> vertical/up-down dim = oneUpW);
  the bug was DETECTION: parser missed glyph/text corr marks and fell back to "first number = Width" (=horizontal)
  -> reversed. FIX (parser_knowledge.py corrugation section): added rule 1b for ARROW/CARAT/LETTER glyphs
  ("^ corr", "<<< C >>>", lone V/H, repeated edge triangles/blue carats -> up/down=Vertical, left/right=Horizontal),
  a hard note that WRITTEN ORDER of the two numbers never decides Width (corr direction does), and 3 worked examples.
- LIVE-PARSE VALIDATED (real CADs, Anthropic):
  * SPC-26-111 "Grain/corr: Vertical" -> oneUpW=13.5938, oneUpL=20.3125, totalRuleInches=246.8998 (source CAD).
  * Digital RFQ (3-part MP): "^ corr."/"<<< C >>>" -> (16.9375,20.875,196.472)/(19,25.125,245.975)/(11.5625,25.125,181.399).
  All correct, not reversed; asks document the reasoning. Total-rule fix also validated (TAV Cut 188 vs Total 342).
- STILL: concurrency refactor smoke-tested only (no live multi-parse E2E); email-artwork sanitizer unit-tested only.
  All changes are PREVIEW — REDEPLOY for production.

## 2026-07-27 (cont.) — Review modal: highlight low-confidence orientation asks
- In ReviewParseModal (FilesSec.jsx), corrugate/grain orientation asks (oneUpW/oneUpL, or reasons
  mentioning corr/grain/flute/vertical/horizontal) are now visually flagged: amber left-border +
  tinted background + a bold "⚠ VERIFY ORIENTATION" chip, and they float to the TOP of the asks list.
  These are the parser's low-confidence, high-impact calls (a flipped W/L badly mis-prices the job).
  Applies to both editable asks and bare-note asks. testid: parse-ask-orient-<scope>-<key>.
- Verified: frontend compiles clean; parser confirmed to emit oneUpW orientation asks on live CADs.
  UI highlight not screenshot-captured (parse E2E in-browser is slow). PREVIEW — redeploy for prod.

### 2026-07-31 — Accuracy-testing workflow: iQuote $ delta comparison
- Toolbar (Test flag active) gains "iQuote $" input next to iQuote # — records the
  iQuote sell price for the flagged quote (`state.iquoteTotal`, PATCH /test-flag).
- Testing xlsx report gains 3 columns after Quote Total: iQuote $, Δ $, Δ %
  (SPOT minus iQuote; positive = SPOT priced higher). Rows with |Δ%| > 10 get an
  amber highlight for outlier triage.
- Methodology agreed with user: flag 20-30 real quotes across product mix, sort by
  |Δ%|, drill into per-category columns (board/print/cut/strip/glue/tape/freight)
  only on outliers — mirrors legacy parity audit approach. "Became a Job" quotes
  are market-validated and carry the most weight.

### 2026-07-31 — SPOT vs iQuote accuracy analysis delivered
- Matched 38 flagged SPOT estimates to 34 iQuote quotes = 49 scenarios (structural
  fixes: kits, 2-out sets, option-variants per-component, riser exclusion).
- Results (excl 3 outliers): sell Δ median +13.2% (SPOT higher), cost Δ +10.2%,
  14/46 PASS ±10%. Print cost +37% is the systematic driver; material/cutting/
  freight aligned. Material like-for-like (net of +6.5% board increase) ≈ -11%,
  consistent with SPOT using fewer waste sheets (unproven — needs sheet counts).
- Outliers: eggcrate component RW-260723-084853 ($9,570 vs $523, ~18x, inverted
  qty pricing — suspected bug, NOT yet traced) and RW-260720-082503 kit modeling
  mismatch (became job at ~2x SPOT price).
- Deliverable: /app/frontend/public/SPOT_vs_iQuote_Analysis.xlsx (5 tabs + 4 charts,
  legacy-style PASS/REVIEW/FAIL verdicts). Analysis scripts in /tmp/iq_analysis2.py,
  /tmp/build_workbook.py (tmp — regenerate if needed; source data /tmp/iq_compare.xlsx).
- User asked about production actuals: agreed 3-way comparison (iQuote vs SPOT vs
  actuals) is next if user exports actual job costs joined on iQuote#/MISJobID.
