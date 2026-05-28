# 08 — Codebase Walkthrough: `spot_server.js`

2,619 lines of Node.js, built-ins only. Serves the HTML, proxies APIs, manages files. Section-by-section guide below; line numbers approximate.

---

## Top-level structure

```
1–100      Header, requires (http, https, fs, path, crypto)
100–250    Constants (ARCHIVE_ROOT, MAX_FILE_BYTES, RFQ_CLASS_EXTS, etc.)
250–550    Customer CSV parser + normalization
550–900    Archive endpoint handlers (upload, list, get, delete)
900–1400   RFQ parser (Anthropic API integration)
1400–1900  Freight proxy + SPCOC zone logic
1900–2400  HTTP routing + request handlers
2400–2600  Server startup, listen-first boot (D-118)
2600–2619  Tail (exit handlers, version sentinel)
```

---

## Constants (L100–250)

Key constants:

```javascript
const ARCHIVE_ROOT = process.env.SPOT_ARCHIVE_ROOT || "/home/claude/SPOT_QUOTES";
const EXEC_DENYLIST = new Set([".exe",".bat",".cmd",".msi",".com",".scr",".ps1"]);
const RFQ_CLASS_EXTS = new Set([".pdf",".png",".jpg",".jpeg",".gif",".webp",".eml",".msg",".docx",".xlsx",".xls"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_DROP = 20;
const EST_NUM_RX = /^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$/;
```

Customer CSV path candidates (tried in order):
1. `process.env.CUSTOMER_CSV_PATH`
2. `<install>/customerList.csv`
3. SharePoint UNC path (`\\standardprinting.sharepoint.com\sites\spcoc.com\Shared Documents\General\SPOT\customerList.csv`)

This multi-path discovery was added in D-118 to handle the case where install location varies between workstations.

---

## Customer CSV (L250–550)

### `parseCustomerCsv(text)`

Parses the 15-column CSV. Schema:
```
cust_code, cust_name, address_1, address_2, address_3, city, state, zip, phone,
terms_code, sales_agent_id, sales_tax_code, po_required, oncredithold, credit_limit
```

Returns an array of customer objects. Handles quoted fields, embedded commas, and Windows line endings.

### `normalizeTermsCode(raw)`

ERP values are messy: "Net 30", "2%-10 Days/Net 30", "Net 45 Days", "On Receipt", "Cash". Normalizes to a fixed set: `"30"`, `"45"`, `"60"`, `"COD"`, `"DOR"` (Due On Receipt), `"PREPAID"`.

### `customerByCode(code)`, `customerSearch(q)`

Lookup helpers used by `/customers/:code` and `/customers/search`.

### `fs.watch` on the CSV file

The server watches `customerList.csv` for mtime changes and re-parses on update. The cache lives at `<install>/cache/customers.json` and is regenerated on each refresh.

---

## Archive endpoints (L550–900)

### `POST /archive/upload`

Handles multipart upload of RFQ files for a quote. Validates:
- `estNum` matches `EST_NUM_RX`
- `custName` is provided
- Each file is under `MAX_FILE_BYTES`
- Total files in drop is under `MAX_FILES_PER_DROP`
- File extension is not in `EXEC_DENYLIST`

For each file:
- Compute disk filename (normalize, collision-suffix)
- Compute SHA-256
- Determine class (`"rfq"` if ext in `RFQ_CLASS_EXTS`, else `"asset"`)
- Write to `{ARCHIVE_ROOT}/{YYYY}/{folder}/{filename}`
- Append entry to `meta.json`

### `buildFolderName(custName, estNum)`

```javascript
function buildFolderName(custName, estNum) {
  let safe = String(custName || "Customer").replace(/[\/\\:*?"<>|]/g, "_");
  safe = safe.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (safe.length > 30) safe = safe.substring(0, 30).replace(/_+$/, "");
  if (!safe) safe = "Customer";
  return safe + "_" + estNum;
}
```

Must match the JSX-side `archiveNormalizeCustomer()` exactly. Drift here would cause folder-rebinding bugs (D-150 is the open design item).

### `GET /archive/list?folder=&year=`
Returns `{folder, year, exists, files, meta}` — the meta.json contents.

### `GET /archive/file?folder=&filename=&year=`
Returns file bytes with proper Content-Type derived from extension.

### `DELETE /archive/file?folder=&filename=&year=`
Unlinks file, updates meta.json. **Requires user permission gate.**

### `GET /archive/health`
Returns `{root, exists, writable, folderCount}` — used by the JSX to detect archive issues.

### `POST /archive/rename` (D-134, R1.6.2)
Renames a TBD-prefixed folder to its real-customer-prefixed name when the parser resolves the customer. This is the "TBD folder migration" feature.

---

## RFQ Parser — Anthropic API (L900–1400)

### `POST /est/parse-rfq`

The core parser endpoint. Workflow:
1. Receive multipart with files + apiKey (optional)
2. Validate apiKey (env or request)
3. Build the parser prompt (huge — ~50KB of system instructions)
4. Run preflight: bytes:tokens heuristic check
5. POST to `https://api.anthropic.com/v1/messages`
6. Parse response: should be structured JSON matching the SPOT estimate schema
7. Return parsed result + token usage

### Preflight token heuristic (D-141 / D-144 calibration)

The bytes-to-tokens estimate for non-text files:
- Text: 1:1 (1 byte ≈ 0.25 tokens, but conservatively 1:1)
- PDF/image: bytes / 250 (calibrated mid-point of real-world ratio, post-D-144)

If estimated tokens > preflight threshold (default 360,000), the request is rejected with `413 PREFLIGHT_OVER_LIMIT`. This prevents oversized RFQs from running up the meter on a failed parse.

### `anthropicParseRfqBatch()`

The function that builds and sends the Anthropic API call. Key parameters:
- Model: `claude-opus-*` (configured at top of file)
- Max tokens: ~16,000 for the response
- System prompt: the parser instructions (loaded once at boot, rebuilt on changes)

The prompt is built from string concatenation in the source. When you edit the prompt, the server must be restarted to pick up changes (the prompt is captured at boot).

### Multi-Part parser (D-131)

Multi-part RFQs route through the same endpoint with `quoteType: "Multi-Part"`. The prompt has multi-part-specific sections that the parser follows when the RFQ contains a BOM table or multiple piece descriptions.

### `GET /est/parser-budget`

Returns current session's token usage and remaining budget. Soft cap; logged but not enforced.

### `POST /est/reload-key`

Updates the in-memory `ANTHROPIC_API_KEY` from a request body. Used by the JSX's "Paste API key" flow (D-129) so estimators can override the .env-loaded key per session.

---

## Freight (L1400–1900)

### SPCOC local zones (D-119)

ZIP-to-zone mapping inside the server:

| Zone | ZIP prefixes (illustrative) | Rate |
|---|---|---|
| Canton | 446, 447 | $45 |
| Akron | 442, 443 | $70 |
| Cleveland | 441 (most), 440 | $95 |

Gate function `isLocalZoneEligible(weightLbs, trailerFt)` returns true only if both ≤ thresholds (10,000 lbs and 24 trailer-ft).

### `POST /api/freight`

Workflow:
1. Validate destination ZIP, weight, dim
2. If local-zone eligible → return SPCOC rate
3. Else → proxy to UTS API
4. If UTS fails → return error, JSX surfaces to estimator

UTS proxy is a straightforward HTTPS pass-through with auth headers. Error responses bubble up.

---

## HTTP routing (L1900–2400)

The server is a single `http.createServer(handleRequest)` with a long `handleRequest` function that routes by URL path. No Express or router lib.

```javascript
function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/") return serveIndex(res);
  if (path === "/api/health") return serveHealth(res);
  if (path === "/api/freight") return handleFreight(req, res);
  if (path.startsWith("/customers/")) return handleCustomers(req, res, path);
  if (path.startsWith("/archive/")) return handleArchive(req, res, path, url);
  if (path.startsWith("/est/")) return handleEst(req, res, path);

  res.statusCode = 404;
  res.end("Not Found");
}
```

Each handler reads body if needed, validates, dispatches.

---

## Listen-first boot (D-118)

The server binds the port FIRST, then loads the customer CSV. If the CSV is missing or unparseable, the server still serves HTTP — the typeahead is just empty until refresh.

```javascript
const server = http.createServer(handleRequest);
server.listen(3100, "127.0.0.1", () => {
  console.log("SPOT server listening on http://localhost:3100");
  // Now load CSV asynchronously
  loadCustomers().catch(err => console.error("CSV load failed:", err));
});
```

This pattern prevents a single-CSV failure from blocking the entire launch.

---

## Server endpoints quick reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Serves SPOT_R1.5.html |
| `/api/health` | GET | Returns `{status, version, uptime}` |
| `/api/freight` | POST | UTS proxy + SPCOC zones |
| `/customers/search?q=` | GET | Typeahead lookup |
| `/customers/refresh` | POST | Re-read CSV from disk |
| `/customers/:code` | GET | Full record by code |
| `/archive/upload` | POST | Multipart upload |
| `/archive/list?folder=&year=` | GET | meta.json contents |
| `/archive/file?folder=&filename=&year=` | GET | File bytes |
| `/archive/file?folder=&filename=&year=` | DELETE | Remove file |
| `/archive/health` | GET | Archive root status |
| `/archive/folders` | GET | List all folders |
| `/archive/rename` | POST | TBD → real folder rename (D-134) |
| `/est/parse-rfq` | POST | Anthropic RFQ parser |
| `/est/parser-budget` | GET | Token usage |
| `/est/reload-key` | POST | Update API key |

---

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | RFQ parser auth | (none — parser disabled if absent) |
| `CUSTOMER_CSV_PATH` | Custom CSV location | (none — falls through) |
| `SPOT_ARCHIVE_ROOT` | Quote archive root | `/home/claude/SPOT_QUOTES` |
| `UTS_API_KEY` | UTS freight auth | (none — local zones only) |

Read at server start from `.env` file (or system environment). Server must restart to pick up changes (no hot reload).

---

## Logging

The server logs to stdout:
- Startup banner with version
- Every customer CSV load result (`rowCount=N`)
- Every API call with status
- Errors with stack traces

Logs are captured by the launcher window (`OPEN_SPOT.bat` runs the server in a minimized cmd window). No log rotation — restart the server to clear.

For production debugging, redirect: `node spot_server.js > spot.log 2>&1`.

---

## Common server-side debugging

| Symptom | Where to look |
|---|---|
| Empty typeahead | Server startup log — should show `rowCount=384` (or current count) |
| 401 from parser | `.env` ANTHROPIC_API_KEY or paste-in-UI flow |
| Archive uploads fail | `archive/health` returns `writable: false` → permissions on archive root |
| Freight returns wrong zone | ZIP-to-zone table — search for the ZIP prefix in source |
| Server won't start | Port 3100 already in use — `netstat -ano | findstr :3100` |
| Parser times out | Network or Anthropic API outage — check `/est/parser-budget` log entries |
