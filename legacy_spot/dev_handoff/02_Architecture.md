# 02 — Architecture

## High-level structure

SPOT is a three-tier application that runs entirely on one workstation:

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1 — Browser (Chrome / Edge)                           │
│  ──────────────────────────────────────────────────────     │
│  SPOT_R1.5.html   built from spot_r1_5.jsx (9,007 lines)    │
│   ├─ ENGINE block (lines 1–877)   pricing math, mirror      │
│   ├─ UI block    (lines 878–7494) React components          │
│   └─ Warning popup catalog (44 alerts)                      │
│                                                             │
│  All quote state lives here, in React + localStorage.       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │  HTTP, localhost:3100 only
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 2 — Node.js server  (spot_server.js, 2,619 lines)     │
│  ──────────────────────────────────────────────────────     │
│  Built-ins only: http, https, fs, path, crypto              │
│                                                             │
│  Endpoints:                                                  │
│    GET  /              serves SPOT_R1.5.html                │
│    GET  /api/health    version sentinel                     │
│    POST /api/freight   UTS proxy                            │
│    GET  /customers/*   CSV lookup, 384 rows                 │
│    POST /archive/*     quote folder I/O                     │
│    POST /est/parse-rfq Anthropic API call                   │
└──────────────────┬──────────────────┬───────────────────────┘
                   │                  │
                   ▼                  ▼
            Anthropic API     UTS freight API
            (RFQ parser)      (truckload rates)
```

A third file, `spot_engine.js` (1,131 lines), sits beside the server but is **not** loaded by the server. It's a Node-side copy of the JSX engine block, used only by `fleet_compare.js` for headless regression testing against the 785-job iQuote dataset.

---

## Tier 1: The browser app

### Source layout

The JSX is one file by design, organized into clearly labeled sections marked with `═══` comment dividers:

| JSX lines | Section | Contents |
|---|---|---|
| 1–80 | Header | Version constant, change log comments |
| 82 | `SPC_LOGO_B64` | Base64-encoded SPC logo (large) |
| 84–155 | ENGINE | `base_matrix`, `flute_rules`, `liner_upgrades`, pricing |
| 157–168 | SHEET_GROUPS | The 216-sheet stock library |
| 169–240 | Engine constants | `RATE_DEFAULTS`, `GM_MSF_TIERS`, route limits |
| 241–340 | Engine functions | `calcBoard`, `computeLayout`, `selectSheet` |
| 340–877 | More engine | route comparison, glue, freight markup |
| 878–7494 | UI components | React functional component `App()` and its children |
| 7494–9007 | UI continued | modals, popups, harness instrumentation |

The build script (`build_spot_r1_5.js`) transforms this JSX into `SPOT_R1.5.html` via Babel + React. The output is a single HTML file with React/ReactDOM loaded from a CDN and the entire app inlined as `<script>`.

### State management

There are three categories of state in the browser:

**1. React component state** — `useState` and `useMemo`, scoped to the `App()` function. This is the live quote: customer, dimensions, board, qtys, etc. There are around 80 `useState` calls in the component.

**2. localStorage** — persistent state across browser sessions:

| Key | Purpose | Schema |
|---|---|---|
| `wftabs` | Tab metadata (id, name, customer, partNumber) | array |
| `wftab{id}` | Full estimate state for tab `{id}` | JSON |
| `wftabest{timestamp}` | Archived estimate, named for Save Estimate | JSON |
| `wf_default_pricing_targets` | User's override of `RATE_DEFAULTS` | object |
| `wf_stock_sheets` | User's additions/removals from `SHEET_GROUPS` | array |
| `wf_shipto_history` | Per-customer-code ship-to memory | object keyed by code |

localStorage is per-browser-profile, not synced anywhere. Estimators have an export/import flow in Advanced Controls for moving between machines.

**3. Window globals** — debug + automation, shipped under D-092 through D-094:

| Global | Purpose |
|---|---|
| `window.__SPOT_UI_VERSION` | Version string, e.g. `"R1.6.5.1"` |
| `window.__SPOT_SESSION_LOG` | Append-only event log for the session |
| `window.__SPOT_LOG_EVENT(name, payload)` | Programmatic event logger |
| `window.__SPOT_LOAD_JSON(obj)` | Scripted JSON load, bypassing the file picker |

The last one is the entry point for Chrome MCP automation — Claude or another agent can call `window.__SPOT_LOAD_JSON(payload)` to load a quote without going through the file dialog.

### The reset-first pattern

Two functions, `applyState` (for the whole quote) and `applyItemState` (for a single BOM item), control how loaded state replaces current state. They do not merge. They reset to defaults first, then apply the loaded fields.

```javascript
// Pseudocode of the pattern
function applyState(loadedJson) {
  // Step 1: Reset every state variable to its default
  setCustName(DEFAULT.custName);
  setFlute(DEFAULT.flute);
  setQtys(DEFAULT.qtys);
  // ... ~80 setters, all reset

  // Step 2: Apply loaded fields on top
  if (loadedJson.custName) setCustName(loadedJson.custName);
  if (loadedJson.flute)    setFlute(loadedJson.flute);
  // ... etc
}
```

This matters because merge semantics would let a stale field from the current quote contaminate the loaded one. We have three closed defects (D-080, D-087, D-098) caused by accidentally re-introducing merge semantics during refactors. When you touch state loading, preserve reset-first.

### The Babel/IE11 quirk

The build targets IE11 for shop-floor compatibility. Babel transforms `const` and `let` to `var`. `var` has no Temporal Dead Zone — meaning if a `useMemo` captures a variable declared *later* in the same component, the captured reference evaluates to `undefined` at first render, not a ReferenceError.

This bites us when:
1. A `useMemo` aggregates several variables
2. One of those variables is declared with `const x = ...` below the `useMemo`
3. The first render computes the memo with `x === undefined`
4. Subsequent renders have the real value — but the memo is now stale and won't recompute unless its dependency array includes `x`

D-107 and D-108 are both this class. The mitigation is: **hoist all variables a `useMemo` references above the `useMemo`.** When you review a PR, scan every `useMemo` for this pattern.

---

## Tier 2: The Node server

### Why Node

Server is Node.js because (a) the team already writes JavaScript for the JSX, (b) no external dependencies beyond Babel — the server itself uses only built-ins (`http`, `https`, `fs`, `path`, `crypto`), (c) starting from `node spot_server.js` is one command. The launcher script `OPEN_SPOT.bat` spawns it in a minimized cmd window.

### Endpoints, in detail

Each endpoint is covered in `10_API_Reference.md` with full request/response shapes. Here's the map:

| Endpoint | Purpose | Why server, not browser |
|---|---|---|
| `GET /` | Serves `SPOT_R1.5.html` | Same-origin requirement; localhost serves the HTML to localhost |
| `GET /api/health` | Returns version + uptime | Sentinel for automated sanity checks |
| `POST /api/freight` | Proxies UTS freight API | UTS API key shouldn't be in the client |
| `GET /customers/search?q=…` | Typeahead lookup | CSV file is on disk, not in browser |
| `POST /customers/refresh` | Re-reads `customerList.csv` | File mtime watcher; manual trigger if needed |
| `GET /customers/:code` | Full record by customer code | Single-record fetch |
| `POST /archive/upload` | Stores RFQ files per quote | Browser can't write to disk |
| `GET /archive/list?folder=…` | Lists files in a quote folder | meta.json read |
| `GET /archive/file?…` | Returns a file's bytes | For preview/download |
| `DELETE /archive/file?…` | Removes a file + updates meta | Requires user permission gate |
| `GET /archive/health` | Archive root status | Validates folder is writable |
| `POST /est/parse-rfq` | Sends RFQ files to Anthropic | API key, large prompt, structured output |
| `GET /est/parser-budget` | Token budget for current session | Cap enforcement |
| `POST /est/reload-key` | Updates API key from request body | Client-supplied key path (D-129) |

### File locations

The server reads/writes specific paths. Some are configurable, some are conventions:

| Path | Purpose | Override |
|---|---|---|
| `<install>/customerList.csv` | Customer typeahead source | `CUSTOMER_CSV_PATH` env var |
| `<install>/cache/customers.json` | Parsed CSV cache | Regenerated when CSV mtime changes |
| `<install>/.env` | API keys, env config | Read at server start |
| `C:\SPOT_QUOTES\{YYYY}\{folder}\` | Quote archive root | `SPOT_ARCHIVE_ROOT` env var |
| `C:\SPOT_QUOTES\{YYYY}\{folder}\meta.json` | Per-quote file manifest | n/a — fixed name |
| `C:\SPOT_QUOTES\{YYYY}\{folder}\<files>` | RFQ originals + assets | n/a — stored as uploaded |

The archive folder convention is `{Customer}_{EstNum}` where customer is normalized (illegal Windows characters replaced with `_`, trimmed to 30 characters, trailing space/underscore stripped). The full normalization rule is in `spot_server.js` `buildFolderName()` and mirrored in the JSX `archiveNormalizeCustomer()`.

---

## Tier 3 (sidecar): The Node engine + regression harness

`spot_engine.js` and `spot_runner.js` exist for one reason: to run pricing math without a browser. This enables `fleet_compare.js`, which takes the 785-row iQuote dataset and runs every row through SPOT's engine, producing a CSV of expected vs actual cost.

The flow is:

```
WF_Quoting_Tool_Test_Data.xlsx           785 rows
                │
                ▼
fleet_compare.js                          maps rows to SPOT JSON
                │
                ▼
spot_runner.js                            iterates each JSON
                │
                ▼
spot_engine.js                            runs calcBoard, autoRoute, etc
                │
                ▼
fleet_results.csv                         per-job SPOT vs iQuote
fleet_summary.json                        fleet-level stats, R²
fleet_unparseable.csv                     rows that didn't parse
```

This is what every calibration cycle uses. When you change a rate or curve in the engine, you re-run fleet_compare to confirm R² hasn't drifted. The most recent baseline (D-110 FINAL, 2026-04-24):

- Segment Cost R²: 0.9690
- Segment Sell R²: 0.9496
- Fleet cost delta vs iQuote: +6.55%
- Fleet sell premium vs iQuote: +8.30%
- Margin lift: +$76,488 on 773 scored jobs

The full calibration framework is in `06_Calibration_Methodology.md`.

### Engine drift

Because the engine math exists twice — once in the JSX, once in `spot_engine.js` — there's a risk they diverge. The audit ritual at session start includes a SHA comparison; D-104 closed the "runner vs JSX parity" audit and locked in a convention that any engine-math edit must update both files in the same ship. The control table in `04_Control_Tables_Reference.md` calls out which file is source-of-truth (the JSX) and which file follows.

---

## External integrations

### Anthropic API (RFQ parser)

- **Where:** `spot_server.js` `anthropicParseRfqBatch()`
- **Why:** Free-form RFQ documents (PDF, email, Word) → structured estimate fields
- **Cap:** Token budget per session, soft cap exposed at `/est/parser-budget`
- **Failure mode:** If API key is missing or request fails, the parser returns an empty result; estimator fills the fields manually. Quote still works.

### UTS freight API

- **Where:** `spot_server.js` `/api/freight`
- **Why:** Truckload freight rates for non-local destinations
- **Fallback:** Three SPCOC local zones ($45/$70/$95 for Canton/Akron/Cleveland ZIPs) cover most jobs. If UTS is down, the local zone rate fires for ≤10K lbs AND ≤24 trailer-ft jobs.
- **Failure mode:** Estimator enters freight manually if both fail. Logged but non-blocking.

### SharePoint (customer list refresh)

- **Where:** Read-only pull from `\\standardprinting.sharepoint.com\sites\spcoc.com\Shared Documents\General\SPOT\customerList.csv`
- **Why:** Customer list is maintained in SharePoint by the office; SPOT consumes it
- **Fallback:** Server tries env-var path → install-folder CSV → SharePoint UNC. The bundled CSV always works.
- **Failure mode:** If the bundled CSV is missing, the typeahead is empty. Cataloged as drift item 1b in KNOWN_DRIFT.md — easy to forget, expensive when missed.

---

## What ties it all together

The whole architecture serves one workflow: estimator drops an RFQ, SPOT produces a price. Every choice — single workstation, no database, in-memory engine, three-mode operation, ledger-based change control — supports that one workflow.

When you're tempted to add infrastructure (a queue, a worker pool, a CI pipeline), ask whether it serves the workflow. If the answer isn't a clear yes, the proposal probably isn't a fit for SPOT.
