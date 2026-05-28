# 10 — API Reference

All endpoints served by `spot_server.js` on `localhost:3100`. Localhost-only; no external binding.

---

## `GET /`

Serves the built HTML.

**Request:** none
**Response:** `200 text/html` — contents of `SPOT_R1.5.html`

---

## `GET /api/health`

Version sentinel. Used for liveness checks.

**Request:** none
**Response:** `200 application/json`
```json
{
  "status": "ok",
  "version": "R1.6.5",
  "uptime": 3600,
  "started": "2026-05-22T14:00:00Z"
}
```

Note: server version is independent of JSX version (JSX/server skew is acceptable per D-149 history).

---

## `POST /api/freight`

Freight quote — proxies to UTS API or returns SPCOC local zone.

**Request:** `application/json`
```json
{
  "destZip": "44308",
  "weight": 5000,
  "trailerFt": 12,
  "originZip": "44704"
}
```

**Response:** `200 application/json`
```json
{
  "source": "SPCOC_LOCAL_ZONE",
  "zone": "Akron",
  "rate": 70.00,
  "markupPct": 15,
  "totalQuote": 80.50
}
```

Or, if UTS fallback fires:
```json
{
  "source": "UTS_API",
  "carriers": [
    { "carrier": "ABC Trucking", "rate": 245.00, "transit": "2 days" },
    ...
  ],
  "markupPct": 15
}
```

**Errors:** `400` invalid ZIP/weight; `502` UTS API down.

---

## `GET /customers/search?q={query}`

Customer typeahead.

**Request:** `q` is min 2 chars; matches against cust_name (case-insensitive prefix + contains)

**Response:** `200 application/json`
```json
{
  "matches": [
    { "code": "SKYBOX", "name": "Skybox Packaging, LLC", "city": "Cleveland", "state": "OH" },
    ...
  ],
  "count": 12
}
```

Returns up to 25 matches.

---

## `POST /customers/refresh`

Force re-read of `customerList.csv`. Normally triggered automatically by `fs.watch`.

**Request:** none
**Response:** `200 application/json`
```json
{
  "rowCount": 384,
  "path": "/install/customerList.csv",
  "lastModified": "2026-05-22T13:45:00Z"
}
```

---

## `GET /customers/:code`

Full customer record by code.

**Request:** `:code` is the customer code (e.g. `SKYBOX`)

**Response:** `200 application/json`
```json
{
  "cust_code": "SKYBOX",
  "cust_name": "Skybox Packaging, LLC",
  "address_1": "...",
  "address_2": "",
  "address_3": "",
  "city": "Cleveland",
  "state": "OH",
  "zip": "44115",
  "phone": "...",
  "terms_code": "30",
  "sales_agent_id": "...",
  "sales_tax_code": "...",
  "po_required": 1,
  "oncredithold": 0,
  "credit_limit": 25000
}
```

`404` if customer code not found.

---

## `POST /archive/upload`

Multipart upload of RFQ files for a quote folder.

**Request:** `multipart/form-data`

Required fields:
- `estNum` (string, matches `^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$`)
- `custName` (string)

Optional fields:
- `custCode` (string)
- File parts (one or more)

**Response:** `200 application/json`
```json
{
  "folder": "Skybox Packaging_SPC-260522-001",
  "year": "2026",
  "files": [
    {
      "filename": "rfq_original.pdf",
      "originalName": "PO 47309.pdf",
      "size": 12041,
      "mime": "application/pdf",
      "class": "rfq",
      "sha256": "abc123...",
      "uploadedAt": "2026-05-22T14:32:18Z"
    }
  ]
}
```

**Errors:**
- `400` malformed estNum, missing custName
- `413` file too large or too many files
- `415` extension in EXEC_DENYLIST

---

## `GET /archive/list?folder={folderName}&year={year}`

List files in a quote folder.

**Response:** `200 application/json`
```json
{
  "folder": "Skybox Packaging_SPC-260522-001",
  "year": "2026",
  "exists": true,
  "files": [ /* same shape as upload response files[] */ ],
  "meta": {
    "estNum": "SPC-260522-001",
    "custName": "Skybox Packaging, LLC",
    "custCode": "SKYBOX",
    "createdAt": "...",
    "updatedAt": "...",
    "phase1": true,
    "parserStatus": "deferred",
    "syncStatus": "local-only"
  }
}
```

---

## `GET /archive/file?folder={folder}&filename={filename}&year={year}`

Returns file bytes.

**Response:** `200 <content-type from ext>` — file body

---

## `DELETE /archive/file?folder={folder}&filename={filename}&year={year}`

Removes file from disk and updates meta.json.

**Response:** `200 application/json`
```json
{ "ok": true, "deleted": "rfq_original.pdf" }
```

**Caveat:** Requires user permission gate at the UI level. Server validates the request shape but does not enforce auth.

---

## `GET /archive/health`

Archive root status.

**Response:** `200 application/json`
```json
{
  "root": "/home/claude/SPOT_QUOTES",
  "exists": true,
  "writable": true,
  "folderCount": 42
}
```

---

## `GET /archive/folders`

Enumerate all folders in the archive.

**Response:** `200 application/json`
```json
{
  "root": "/home/claude/SPOT_QUOTES",
  "years": ["2025", "2026"],
  "folders": [
    { "year": "2026", "folder": "Skybox_SPC-260522-001", "files": 3 },
    ...
  ]
}
```

---

## `POST /archive/rename` (D-134)

Renames a TBD-prefixed folder to the resolved customer name.

**Request:** `application/json`
```json
{
  "oldFolder": "TBD_SPC-260522-001",
  "newFolder": "Skybox Packaging_SPC-260522-001",
  "year": "2026"
}
```

**Response:** `200 application/json`
```json
{ "ok": true, "renamed": "TBD_SPC-260522-001 → Skybox Packaging_SPC-260522-001" }
```

Fires when the RFQ parser auto-resolves the customer after files have been dropped under a TBD placeholder. The JSX detects the customer-name transition and POSTs this endpoint to migrate.

---

## `POST /est/parse-rfq`

The Anthropic-powered RFQ parser.

**Request:** `multipart/form-data` with one or more file parts and an optional `apiKey` field. The files are RFQ documents (PDF, image, email, Word, Excel).

**Response:** `200 application/json`
```json
{
  "estimate": {
    "custName": "Skybox Packaging, LLC",
    "custIdent": "MTD-645-90620",
    "boxStyle": "D/C",
    "quoteType": "Simple",
    "flute": "B",
    "boardGrade": "200",
    "oneUpW": "27.5625",
    "oneUpL": "12.875",
    "qtys": ["400", "1000", "2500", "", ""],
    "printReq": "Yes",
    "printMode": "Satin",
    "printSides": "1-Sided",
    "numColors": 4,
    "asks": [
      { "field": "oneUpD", "reason": "Not stated in RFQ" }
    ]
  },
  "usage": {
    "input_tokens": 12000,
    "output_tokens": 4500
  },
  "model": "claude-opus-4-7"
}
```

**Errors:**
- `400` no files supplied
- `401` invalid API key
- `413` `PREFLIGHT_OVER_LIMIT` — estimated tokens exceed preflight threshold (default 360,000)
- `500` Anthropic API error
- `504` Anthropic API timeout

The `asks` array surfaces fields the parser couldn't fill from the RFQ. These become Phase 2 ASKs in the workflow.

---

## `GET /est/parser-budget`

Token usage for the current server session.

**Response:** `200 application/json`
```json
{
  "session_tokens": {
    "input": 24000,
    "output": 8900
  },
  "session_cost_estimate_usd": 0.42,
  "started": "2026-05-22T14:00:00Z"
}
```

---

## `POST /est/reload-key`

Updates the in-memory `ANTHROPIC_API_KEY` from request body.

**Request:** `application/json`
```json
{ "apiKey": "sk-ant-..." }
```

**Response:** `200 application/json`
```json
{ "ok": true }
```

Used by the JSX "Paste API key" flow (D-129) so estimators can override the env-loaded key per session.

---

## Error format

All endpoints return JSON errors:

```json
{
  "error": "PREFLIGHT_OVER_LIMIT",
  "message": "Estimated tokens 1,500,000 exceeds pre-flight threshold 360,000",
  "details": { /* optional */ }
}
```

HTTP status codes follow standard conventions (`400`, `401`, `404`, `413`, `415`, `500`, `502`, `504`).

---

## Auth model

There is none. The server binds only to `127.0.0.1` — it's not reachable from the network. Anyone on the workstation has full access. Session keys (Anthropic, UTS) are loaded from `.env` or passed in-band per request.

This is by design: SPOT is a single-user desktop app served via localhost. Adding auth would introduce a class of bugs (session expiry, token rotation) that doesn't fit the workflow.

---

## Versioning

The `/api/health` version is the canonical server version. The JSX has its own version. JSX/server skew is acceptable when the change is JSX-only (cosmetic hotfix, UI tweak). Server version bumps only when the server actually changes.

Current ledger position: JSX R1.6.5.1, server R1.6.5.
