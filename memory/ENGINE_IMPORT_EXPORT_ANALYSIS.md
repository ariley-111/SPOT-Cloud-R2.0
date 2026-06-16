# Board Engine Import/Export — Legacy vs Cloud Analysis (June 2026)

## 1. What the legacy feature actually does (spot_r1_5.jsx)

Location: Board Engine panel → "Engine Admin" collapsible (L6716-6755).
Four buttons + a clear:

| Button | Code | What it does |
|---|---|---|
| **Export Engine JSON** | L6727-6731 | Downloads `wf_engine_data.json` = the entire pricing matrix: `base_matrix` (board $/MSF by wall/grade/MSF-tier), `liner_upgrades`, `medium_upgrades`, `flute_rules`, `msf_tiers`, `dimensional_adders`, `fixed_charges`, `org_limits`. |
| **Export Sheets CSV** | L6732-6737 | Downloads `wf_approved_sheets.csv` (flute,grade,outsideLiner,insideLiner,medium,width,length). |
| **Import Engine JSON** | `importEngineJSON` L2514-2533 | **Deep-merges** rate changes into the live `ENGINE` object. Only changed fields needed. Persisted to `localStorage[ENGINE_OVR_KEY]`. Re-applied on every mount (L2484-2513). Toast: "Engine updated: N rates applied." |
| **Import Sheets CSV** | `importSheetsCSV` L2534-2560 | Parses CSV, appends sheets to `APPROVED_SHEETS`, persists to `localStorage[IMPORTED_SHEETS_KEY]`. |
| **Clear All Overrides** | `clearEngineOverrides` L2561-2564 | Removes both localStorage keys → next reload restores the compiled defaults. |

Override badge shows "N rates + M sheets". **Persistence = browser localStorage only** (per-machine, per-browser, single user, no history, no audit).

### Why this matters for a board price increase
Board stock $/MSF lives in **`ENGINE.base_matrix[wall][grade][tier]`** (core.py L95-129; used at core.py L399). The legacy **Import Engine JSON** is the intended workflow for a vendor price change: *export → edit base_matrix → re-import.*

## 2. Cloud gap analysis

| Capability | Legacy | Cloud today | Status |
|---|---|---|---|
| Sheets CSV export | localStorage | `GET /api/admin/sheets/csv` | ✅ Covered (DB-backed, audited) |
| Sheets CSV import | localStorage | `POST /api/admin/sheets/csv` | ✅ Covered (DB-backed, audited) |
| Edit press/finishing **rates** | Import JSON | `PUT /api/admin/rates/{cat}/{key}` (RATE/GM/SELL/GRADE) per-key | ✅ Covered (better — audited + reset) |
| **Edit board stock prices (`base_matrix`)** | Import JSON | **NONE** — base_matrix is NOT an editable category | ❌ **GAP (P0 for price increase)** |
| Edit liner_upgrades / medium_upgrades / dimensional_adders / fixed_charges | Import JSON | **NONE** | ❌ **GAP** |
| Bulk **Engine JSON** export | ✅ | **NONE** | ❌ Gap |
| Bulk **Engine JSON** import | ✅ | **NONE** | ❌ Gap |

**Root cause:** cloud's `rate_overrides._LIVE` only wires up `RATE_DEFAULTS`, `GM_DEFAULTS`,
`SELL_DEFAULTS`, `GRADE_ADDER_DEFAULTS`. The `ENGINE` dict (which holds the actual board
$/MSF matrix and the liner/medium/dim/fixed adders) is read by the engine but **cannot be
overridden through the admin console at all.** So right now there is no way in the cloud
app to apply the vendor's board price increase.

## 3. Preserving old pricing (rollback / safety)

### What already protects us
- **Saved quotes are frozen.** Each quote persists its computed `state`/results in Mongo;
  a price change does NOT retroactively alter a saved quote unless it is reopened and
  recalculated. (Confirm Rule-6 migration-on-load behavior before shipping.)
- **Existing rate overrides are reversible.** `_BASELINE` snapshots the compiled defaults at
  import; `reset`/`reset-all` restore them; every change is written to an append-only
  `audit_log` retained forever.

### What we should add (cloud-grade, better than legacy's localStorage)
1. **Engine JSON Export** — one-click download of the *current effective* matrix → an instant
   file backup BEFORE any edit (mirrors legacy "export first").
2. **Engine JSON Import** — deep-merge bulk update for `base_matrix` (+ liner/medium/dim/
   fixed), with a **diff preview + confirm** so the admin sees exactly what changes.
3. **Versioned price-book snapshots** — before applying an import, auto-save a named snapshot
   (e.g. `pre-2026-06-vendor-increase`) in a `price_book_snapshots` collection. One-click
   **Restore** reverts the entire matrix to any prior snapshot. This is the real
   "in case something goes wrong" safety net.
4. **Effective-date label** (optional) on each snapshot for record-keeping.

All mutations route through the existing override + baseline-snapshot + audit pattern so the
engine stays a faithful read-by-reference consumer and "1:1 legacy math" is untouched —
we are only changing the *values*, never the formulas.

## 4. FINALIZED design decisions (user-confirmed 2026-06-16)

**Pricing-version model:**
- **Drafts use CURRENT pricing always.** Only **SAVED quotes** pin a price-book version.
- The price-book version is **stamped at SAVE time** (the active snapshot id).
- **Reopen a saved quote → re-price against its PINNED snapshot.** Original prices are
  preserved for ALL edits (route change, add die, different liner combo, etc.). There is
  **NO "re-price to current" button** on a saved quote.
- If the estimator wants current pricing, they **Duplicate** the quote. The duplicate is a
  new draft → current pricing.
- **No validity cutoff / no auto re-price prompt.** Pricing is preserved indefinitely on
  reopen.
- **Messaging:** when reopening a saved quote whose pinned version ≠ current, show an inline
  note: *"Original pricing preserved in this quote. To use current pricing, duplicate it."*
  When the user clicks **Duplicate** on such a quote, show a confirm:
  *"Prices have been updated since this quote was last saved. Creating a copy will use the
  updated pricing."* → [Cancel] / [OK].

**Dropped:** the global one-time post-update login banner (#4) — redundant now that the
warning is contextual at reopen/duplicate.

**Snapshots:** auto-save a full labeled snapshot before any price change; one-click Restore.

**Importer:** spreadsheet (XLSX/CSV) upload mapped to `base_matrix`, with a diff preview
(old → new, %Δ) and auto-snapshot before apply. No JSON editing. PDF = reference only.

**Implementation note:** engine must accept a per-request price book (thread the pinned
snapshot through `run_estimate`) — concurrency-safe, no global mutation.

## 5. Sequencing (recommended)
Bugs from today's testing FIRST (fast, stabilizing), THEN board-engine pricing as a
dedicated phase:
- **Phase 1:** price-book snapshot model + spreadsheet importer + diff preview + Restore
  (lets the vendor increase be applied safely).
- **Phase 2:** pin-at-save + reopen-preserves-pinned + duplicate-uses-current + contextual
  warnings (engine price-book threading).
