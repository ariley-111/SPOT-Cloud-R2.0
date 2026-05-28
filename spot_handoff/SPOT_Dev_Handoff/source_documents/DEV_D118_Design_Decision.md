# D-118 — Customer Auto-Populate from Network-Drive CSV

**Status:** SHIPPED (R1.5.4, 2026-04-26 — initial typeahead + late additions: ship-to memory + confirmation modal)
**Date:** 2026-04-26
**Affects:** `DEV_spot_server.js`, `spot_r1_5.jsx`, `DEV_build_spot_r1_5.js` (title), new runtime cache `cache/customers.json`

---

## 1. What This Changes

The Customer field on the Estimate Info row is now a typeahead. As the estimator types ≥ 3 characters, SPOT calls `/customers/search?q=...` and shows the top 10 matches in a dropdown. Selecting a match populates `custName` and `quoteTerms` immediately, and stashes the full 15-column customer record in state for downstream use (JSON export, future D-120 archive, future v2 oncredithold/po_required UX).

The customer database lives as a CSV on a mapped network drive. spot_server reads it on a nightly cron, on file-mtime change, and on demand via `POST /customers/refresh`. CSV is parsed into a normalized `customers.json` cache. Search hits the cache, not the CSV.

---

## 2. Source CSV Schema (15 columns, confirmed)

```
cust_code, cust_name, address_1, address_2, address_3,
city, state, zip, phone, terms_code,
sales_agent_id, sales_tax_code, po_required, oncredithold, credit_limit
```

Source path: `\\standardprinting.sharepoint.com\sites\spcoc.com\Shared Documents\General\SPOT\customerList.csv` mounted as a Windows network drive (or accessed via OneDrive sync to local disk). The path is the default; spot_server respects `CUSTOMER_CSV_PATH` env var for workstations using a mapped letter (e.g., `Z:\customerList.csv`) and tries multiple paths in order: env var → SPOT folder → `_server` folder → SharePoint UNC.

No SharePoint Graph API. No Azure AD. No MSAL. No service principal. spot_server reads the file with `fs.readFileSync` and parses CSV in-process.

---

## 3. Cache File

Location: `{spot_server_dir}/cache/customers.json`. Created on first refresh, rewritten on every refresh.

Shape:
```json
{
  "refreshedAt": "2026-04-26T08:00:00Z",
  "sourcePath": "\\\\standardprinting.sharepoint.com\\sites\\spcoc.com\\Shared Documents\\General\\SPOT\\customerList.csv",
  "sourceMtime": "2026-04-26T02:14:33Z",
  "rowCount": 4823,
  "customers": [
    {
      "code": "SKYBOX",
      "name": "Skybox Packaging",
      "address1": "123 Main St",
      "address2": "Suite 200",
      "address3": "",
      "city": "Akron",
      "state": "OH",
      "zip": "44301",
      "phone": "330-555-1212",
      "termsCode": "30",
      "salesAgentId": "MM",
      "salesTaxCode": "OH-EX",
      "poRequired": false,
      "onCreditHold": false,
      "creditLimit": 50000
    }
  ]
}
```

Field normalization rules during CSV → JSON:
- `cust_code`, `cust_name` trimmed, dropped if empty
- Empty cells → empty string for text, `null` for numerics, `false` for booleans
- `po_required` and `oncredithold` parsed as boolean (truthy: `Y`, `YES`, `TRUE`, `1`, `T`)
- `credit_limit` parsed as number (strips `$`, commas, whitespace)
- All other text fields preserved as-is, trimmed
- Rows with fewer than 15 columns or missing code/name are skipped with a console log

CSV parser handles RFC 4180 basics: quoted fields, escaped quotes (`""`), commas inside quotes.

---

## 4. Refresh Triggers

Three paths kick off a refresh:

1. **Server start** — read disk cache (fast warm start), then refresh from CSV
2. **Nightly cron** — 2:00 AM local time. Self-scheduling `setTimeout` (no external cron); next-fire computed at start and after each fire
3. **mtime watch** — `fs.watch()` on the CSV path, debounced 5 seconds. ERP daily-push → SPOT refresh within ~5 seconds
4. **On-demand** — `POST /customers/refresh` returns `{ ok, rowCount, refreshedAt, sourceMtime }`

If the CSV path is unreachable (drive not mounted, file missing, column-count mismatch), the refresh logs and **leaves the existing cache in place**. Search continues against the last successful cache. Health endpoint exposes `customersStale: true` after 36 hours without a successful refresh.

---

## 5. Server Endpoints (`DEV_spot_server.js`)

### `GET /customers/search?q={query}&limit={n}`

- `q` required; server returns `[]` for queries < 2 chars
- `limit` optional, default 10, max 50
- Match: case-insensitive substring on `name` AND `code`. Sort priority: name-prefix matches → name-substring → code-substring; alphabetical within each group
- Slim response shape (typeahead payload):
  ```json
  [{ "code": "SKYBOX", "name": "Skybox Packaging", "city": "Akron", "state": "OH", "zip": "44301", "onCreditHold": false }]
  ```
- Returns 503 with `{error: "customer database unavailable"}` if no rows loaded yet

### `GET /customers/:code`

- Returns the full normalized customer record by `cust_code` (case-insensitive)
- 404 with `{error: "not found"}` if unknown

### `POST /customers/refresh`

- Triggers an immediate refresh
- 200 + `{ok: true, rowCount, refreshedAt, sourceMtime}` on success
- 500 + `{ok: false, error}` on failure (cache untouched)

### `GET /api/health` additions

```json
{
  "customersLoaded": 4823,
  "customersRefreshedAt": "2026-04-26T08:00:00Z",
  "customersSourceMtime": "2026-04-26T02:14:33Z",
  "customersStale": false,
  "customersSourcePath": "\\\\standardprinting.sharepoint.com\\sites\\spcoc.com\\Shared Documents\\General\\SPOT\\customerList.csv"
}
```

---

## 6. JSX Changes (`spot_r1_5.jsx`)

### New state (line ~1242)

```js
const [customerRecord,setCustomerRecord]=useState(null);
const [custSearchResults,setCustSearchResults]=useState([]);
const [custSearchOpen,setCustSearchOpen]=useState(false);
const [custSearchHi,setCustSearchHi]=useState(0);
const custSearchTimer=useRef(null);
const custSearchAbort=useRef(null);
const TERMS_MAP={"30":"Net 30", ... };  // see §7
```

### New callback (line ~1252)

`selectCustomer(slim)` — fetches full record from `/customers/:code`, sets `custName`, `customerRecord`, and `quoteTerms` (via TERMS_MAP).

### Customer field (now line ~4391) becomes typeahead

The existing input is wrapped in a `position:relative` div with an absolute-positioned dropdown below. Behavior:

- Manual typing still works exactly as before (`custName` updates on every keystroke)
- Each keystroke invalidates `customerRecord` if user types past the bound name (manual override clears the stash)
- 200 ms debounce → if `value.length >= 3`, fetch `/customers/search?q={value}&limit=10`
- Abort-controller cancels in-flight fetches when a newer keystroke supersedes
- Dropdown renders below input with credit-hold dot, name, city/state, customer code (monospace, right-aligned)
- Click row OR ↑/↓ + Enter selects → `selectCustomer()` populates fields
- Esc or blur (with 150 ms delay for click-through) closes the dropdown
- Bound state shown via green border on input + red HOLD badge if `onCreditHold`
- Network failures (5xx, timeout, CORS) silently leave dropdown closed; manual entry continues to work

### State integration

- `gatherState()` snapshot includes `customer: customerRecord` and dependency array updated
- `applyState()` reads `s.customer` and sets `customerRecord` on JSON load
- `applyState()` reset block clears `customerRecord` + search state
- Start-fresh path clears `customerRecord` + search state
- JSON exports get the full record under the `customer` key alongside the existing `custName`

### What does NOT auto-populate (per Q1 of the R1.6 backlog)

The customer record does NOT contain ship-to ZIP, FOB preference, contact email, preferred carrier, or customer_type. Therefore D-118 does NOT touch:
- `quoteFOB` — Origin default per Rule 9, estimator picks per quote
- `quoteShipTo` — estimator types per quote (billing address from CSV is NOT pre-filled into ship-to)
- `destZip` — estimator types per quote
- `custIdent` — per-job customer part number, not a customer-level field

The 15-column billing address (address_1/2/3, city, state, zip) is captured into `customerRecord` but not surfaced into any visible field. It rides in JSON exports for downstream tools and the future D-120 archive.

---

## 7. Terms Code Mapping

Customer record `terms_code` values → SPOT `quoteTerms` Sel options. Lookup is case-insensitive (the CSV value is uppercased before lookup).

| terms_code (CSV) | quoteTerms (UI) |
|------------------|-----------------|
| `30`, `NET30`, `N30` | Net 30 |
| `45`, `NET45`, `N45` | Net 45 |
| `60`, `NET60`, `N60` | Net 60 |
| `DOR`, `RECEIPT`, `NETRECEIPT` | Due on Receipt |
| `COD` | COD |
| `PREPAID`, `PRE` | Prepaid |
| anything else | (leave at current value, log to console) |

If the ERP emits codes outside this table, extend `TERMS_MAP` in JSX. Unknown codes are non-fatal — they log a single console warning per selection and leave `quoteTerms` at its current value.

---

## 8. JSON Export Shape (round-trip)

JSON written by `__SPOT_LOAD_JSON` and download flows now includes the customer record alongside the existing fields:

```json
{
  "estNum": "SPC-260426-001",
  "custName": "Skybox Packaging",
  "custIdent": "MRO15486",
  "customer": {
    "code": "SKYBOX",
    "name": "Skybox Packaging",
    "address1": "...",
    "...": "..."
  },
  "...": "..."
}
```

Loading a JSON written before D-118 sets `customerRecord` to `null` (no migration needed; the absence of the `customer` key is the signal). The typeahead remains usable to bind a record after load.

---

## 9. Calibration Impact

None. D-118 is data-population only — no engine math changes. Fleet regression unaffected.

---

## 10. Migration

No migration. Existing estimates with no `customer` field load cleanly — `customerRecord: null` is the default. The typeahead can be used to bind a record after load if the estimator wants the data attached.

---

## 11. Out of Scope (deferred to v2 or later)

- `oncredithold` UX behavior (badge / warn / block beyond the dot indicator) — captured into state, surfaced as a red HOLD badge on the input only
- `po_required` UX behavior (quote-header flag, warning if missing) — captured into state, not surfaced in v1
- Sales-agent default population (`salesAgentId` stashed but does not auto-fill `estInitials` — Rule 2 holds initials at SPC for AI estimates)
- Sales-tax routing
- Customer-specific pricing overrides
- SharePoint Graph API / Azure AD path (deliberately rejected)
- Customer-specific FOB / carrier defaults (those columns don't exist in the CSV)

---

## 12. Failure Modes (verified in code)

| Failure | Behavior |
|---------|----------|
| Network drive not mounted at server start | Server starts, logs warning, refresh fails. `customers/search` returns 503. Estimator types manually. |
| CSV file missing | Same as above; cache (if any) preserved on disk and re-loaded on next start. |
| CSV column-count mismatch | Refresh aborts with logged error. Existing in-memory + on-disk cache preserved. |
| Malformed CSV row | Logged + skipped. Refresh succeeds with reduced row count. |
| Cache write failure (disk full / permissions) | Logged. In-memory cache still serves. Cron retries at 2 AM. |
| Typeahead fetch times out / network error | Dropdown stays closed silently. Manual entry continues. |
| `setCustName` called programmatically (JSON load) | Dropdown does not auto-open (only the input's onChange triggers fetch debounce; programmatic state updates bypass it). |

---

## 13. Test Plan (TC-027 + TC-028 — both filed in `01_OPEN_ISSUES.md`)

### TC-027 — Customer auto-populate (12 sub-cases)

- `.1` Search with 3-char query returns ≤10 results, sorted name-prefix > name-substring > code-substring
- `.2` Search with 2-char query returns `[]`
- `.3` Selecting a customer populates `custName`; modal opens proposing ship-to (see TC-028)
- `.4` `customer` round-trips through `gatherState` → JSON export → `applyState`
- `.5` Typing past a populated value clears `customerRecord` (manual override)
- `.6` `POST /customers/refresh` updates `customersRefreshedAt` and `customersSourceMtime` in `/api/health`
- `.7` Touching the source CSV (mtime change) triggers fs.watch refresh within ~5s
- `.8` Server restart with unreachable CSV: `customers/search` returns 503, manual entry works
- `.9` `terms_code` normalization: server-side `normalizeTermsCode()` correctly maps `Net 30 Days`, `Cash`, `On Receipt`, `2%-10 Days/Net 30`, `Net 45 Days` to TERMS_MAP keys
- `.10` Typeahead does not flash open during JSON load via `__SPOT_LOAD_JSON`
- `.11` Credit-hold dot renders in dropdown, HOLD badge renders on bound input
- `.12` Esc key closes dropdown without selection; bound state preserved

### TC-028 — Ship-to memory + confirmation modal (8 sub-cases) — see §16

Filed in `01_OPEN_ISSUES.md`. Tests cover history-priority ordering, ref-pattern preventing customer-change saves, billing-address fallback, source citation accuracy, ZIP rendering, and Skip behavior.

---

## 14. Files Changed (final, as deployed)

| File | Before D-118 | After D-118 final | Change |
|------|--------------|-------------------|--------|
| `DEV_spot_server.js` | L=237, SHA `488af22f5f1048ad` | **L=553, SHA `47a42cd0fe89445b`** | CSV parser + 4 endpoints + multi-path discovery + termsCode normalization + listen-first boot |
| `spot_r1_5.jsx` | L=7505, SHA `86b44b88e97537ae` | **L=7654, SHA `6abf9ab182035cb7`** | typeahead + customer state + ship-to memory helpers + confirm modal + ref-based auto-save + version → R1.5.4 |
| `DEV_build_spot_r1_5.js` | L=57, SHA `c30239bca081d4d0` | **L=57, SHA `5f5aed3afa23d913`** | title `R1.5.3` → `R1.5.4` |
| `SPOT_R1.5.html` | rebuilt | **875 KB, SHA `b1649e685f4d033d`** | rebuild + direct patches (sandbox build broken; surgical patches applied for ship-to memory + modal — JSX source synced post-hoc) |
| `customerList.csv` | — | **NEW, 384 customers, SHA `08e31e001f0b85ff`** | bundled in deploy zip; pulled via Claude in Chrome MCP from SharePoint 2026-04-26 |
| `cache/customers.json` | — | NEW (runtime-generated) | first refresh after deploy |
| `DEV_D118_Design_Decision.md` | — | **NEW** (this doc) | |

Engine, runner, fleet_compare unchanged.

---

## 15. Decisions Locked In This Ship

These were the three follow-up questions in the design draft. Resolved in code:

1. **Path:** UNC default `\\standardprinting.sharepoint.com\sites\spcoc.com\Shared Documents\General\SPOT\customerList.csv`, env-overridable via `CUSTOMER_CSV_PATH`. Server tries multiple paths in order: env var → SPOT folder → _server folder → UNC. CSV bundled in deploy zip (384 customers as of 2026-04-26).
2. **`terms_code` mapping:** Real ERP values are full strings like "Net 30", "2%-10 Days/Net 30", "Net 45 Days", "On Receipt", "Cash". Server-side `normalizeTermsCode()` parses regex `Net\s*(\d+)` and maps Cash→COD, On Receipt→DOR, etc. Output normalized to TERMS_MAP keys ("30","45","60","COD","DOR","PREPAID") so JSX-side mapping works without rebuild.
3. **JSON embed:** Full 15-column normalized record embedded under `customer` key in every JSON export. Survives downstream customer-record deletion in the ERP.

## 16. Late Additions (2026-04-26 evening — same ship)

After the initial D-118 ship, two follow-ups landed in the same R1.5.4 deploy:

### 16a. Per-customer ship-to memory (localStorage)

`localStorage["wf_shipto_history"]` — single object keyed by customer code. Each entry: `{shipTo, destZip, fob, savedAt}`. Per-workstation only.

- **On select** (after typeahead pick): if history exists for that code, propose those values via the confirmation modal.
- **Auto-save** (1.5s debounce): when `quoteShipTo`, `destZip`, or `quoteFOB` change while a customer is bound, save to history. Uses a ref pattern (`shipToCustRef`) so deps array does NOT include `customerRecord` — picking a new customer must not save the OLD quote's ship-to to the new customer's history.
- **Empty-protection:** save skipped if both `shipTo` and `destZip` are blank (prevents fresh-customer-pick from clobbering existing history with empties).

Helpers: `getShiptoHistory()`, `getLastShipto(code)`, `saveLastShipto(code, shipTo, destZip, fob)`. Defined near `loadPersonalTemplates`.

### 16b. Ship-to confirmation modal

After typeahead pick, instead of silently populating ship-to fields, a centered modal opens.

**Source resolution priority:**
1. **Last quote** (localStorage history) → shown first if available, cited as "From last quote (MM/DD/YYYY)"
2. **Billing address** (customer record) → fallback if no history, cited as "From billing address". Built from `address1` + `address2` + `address3` + `city, state ZIP`.
3. **Nothing on file** → no modal, console log, manual entry continues.

ZIP always rendered when present, on its own bold line. FOB defaults to "Origin" for billing-address proposals; preserved from history when available.

**Buttons:** `Use This` (populates `quoteShipTo`/`destZip`/`quoteFOB`, closes) · `Skip` (closes without populating, leaves whatever was already in those fields untouched).

**State:** `shipToConfirm = null` (closed) | `{source, shipTo, destZip, fob, custCode, custName, savedAt}` (open).

### Files updated in 16a/16b

- `spot_r1_5.jsx` — L=7587 → **L=7654**, SHA `5dde10b891ba0b45` → **`6abf9ab182035cb7`** (state additions + selectCustomer rewrite + ref-based auto-save effect + modal JSX)
- `SPOT_R1.5.html` — patched directly (sandbox build broken; surgical edits to Babel-transpiled output) → SHA **`b1649e685f4d033d`**
- Server, build script, engine, runner, fleet_compare unchanged.
