# SPOT Cloud — Changelog

Append-only log of shipped features and fixes.

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



