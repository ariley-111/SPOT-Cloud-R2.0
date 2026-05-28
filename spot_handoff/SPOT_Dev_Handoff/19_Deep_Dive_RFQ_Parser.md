# 19 — Deep Dive: RFQ Parser Pipeline

SPOT's RFQ parser uses the Anthropic API to extract a complete SPOT intake object from arbitrary customer files — PDFs, images, text, Excel, Word. This file walks the full pipeline end-to-end.

---

## High-level flow

```
User uploads folder → POST /est/parse-rfq → anthropicParseRfqBatch
       ↓
   Files staged + classified (RFQ-class vs ignore)
       ↓
   Per-file content blocks built (PDF base64, image base64, text extract)
       ↓
   System prompt + canonical-terms registry + customer registry
       ↓
   User message: header + per-file blocks + extraction instructions
       ↓
   POST api.anthropic.com /v1/messages
       ↓
   Response: { parsed, sources, method, asks, confidence }
       ↓
   Budget ledger updated (token cost recorded)
       ↓
   Diff modal renders: parsed object vs. blank intake, ASK badges per field
       ↓
   User reviews → Apply → __SPOT_LOAD_JSON(payload) → state populated
```

---

## The endpoint — `POST /est/parse-rfq`

**Location:** `spot_server.js` L2207.

**Request body:**
```json
{
  "folder": "ARCHIVE_BACKEND/working/Acme/E12345",
  "filenames": ["RFQ.pdf", "drawing.pdf", "spec.xlsx"],
  "year": 2026,
  "apiKey": "<optional client-supplied key>"
}
```

**Steps inside the endpoint:**
1. Resolve folder path against `ARCHIVE_BACKEND/` root.
2. Filter to "RFQ-class" files — PDF, PNG/JPG, TXT, MD, DOC/DOCX, XLS/XLSX. CAD `.dxf` and `.dwg` files are excluded by default (image-based versions are kept if also present).
3. Pre-flight token estimate — calls a sizing routine to ensure the request stays under model context limits. Aborts early if oversized.
4. Build the message and dispatch to `anthropicParseRfqBatch`.
5. Cost tracking: parse response token usage from API response, update monthly spend in `parser_budget.json`.
6. Return: `{ parsed, sources, method, asks, confidence, tokens, costUsd, modelUsed }`.

---

## Building the user message

Three-section structure built in `anthropicParseRfqBatch` (L461):

### Section 1 — Header
```
Below are N file(s) from a single customer RFQ for Standard Printing Company. 
Extract the SPOT intake fields. Use information from across ALL files — they 
describe one job, not separate jobs.
```

Critical phrasing: "**one job, not separate jobs**". Otherwise the model treats each file as a separate quote and produces multiple parsed objects.

### Section 2 — Per-file blocks
For each file:
- A separator: `─── File: filename.ext ───`
- The file content as a content block:
  - PDFs → `{type: "document", source: {type: "base64", media_type: "application/pdf", data: "..."}}`
  - Images → `{type: "image", source: {type: "base64", media_type: "image/png", data: "..."}}`
  - Text-extractable → `{type: "text", text: "..."}` (via `extractTextFromFile`)
  - Binary unsupported → `{type: "text", text: "(binary format .xlsx — content not extractable server-side; if this file would have provided values for any field, return null + asks entry)"}`

### Section 3 — Extraction instructions
This is the most important part. It dictates output shape, source tagging, method classification, multi-part detection, canonical-terms application, and customer-code resolution. Walked through below.

---

## The output contract

The model is instructed to return **only valid JSON**, no prose, no markdown fences:

```json
{
  "parsed": { ... full SPOT intake object per EST_SPOT_Intake_Harness.md ... },
  "sources": { "<fieldPath>": "<TAG>", ... },
  "method": "M1" | "M2" | "M3" | "M4" | "M5",
  "asks": [ {"field": "<path>", "reason": "<short explanation>"} ],
  "confidence": <float 0.0 - 1.0>
}
```

### `parsed` — the intake object
Shape is defined in `EST_SPOT_Intake_Harness.md` §6 (Simple) and §7 (Multi-Part). Roughly:
- Identity: `custName`, `custCode`, `custIdent`, `custRef`, `itemDesc`, `estInitials` (always "SPC")
- Materials: `boardGrade`, `flute`, `outsideLiner`, `insideLiner`, `medium`
- Dimensions: `oneUpW`, `oneUpL`, plus depth for tray/RSC styles
- Qty grid: `qtys` — 5-element array, e.g., `[1000, 2500, 5000, 10000, 25000]`
- Print spec: `printReq`, `printMode`, `printSides`, `printFinish`, `numColors`
- Operations: `handStripping`, `handGluing`, `tape`, plus complexity ratings
- CAD/Crest: `cadDifficulty`, `crestComplexity`, `totalRuleInches`
- Freight: `fobMode`, `destZip`
- For Multi-Part: top-level mirror of active item state + `bomItems[]` array

### `sources` — provenance tagging (D-136)
Every emitted field path gets a tag explaining where the value came from:
- `RFQ` — stated explicitly in the RFQ body
- `CAD` — extracted from a CAD drawing/PDF
- `DEFAULT` — system default applied
- `CALC` — derived from other RFQ data (e.g., qty × pcsPerSet)
- `ASK` — value missing; field is null, asks[] entry added
- `REGISTRY` — resolved through canonical-terms registry (e.g., "CKB" → "42# Kemi-Lite")

Source format: flat dotted-path keys. Examples:
```json
{
  "custName": "RFQ",
  "flute": "CAD",
  "oneUpW": "CAD",
  "printMode": "ASK",
  "bomItems[0].state.flute": "CAD",
  "bomItems[2].state.qtys": "CALC"
}
```

### `method` — workflow classification (D-136)
One of five values:
- **M1** — Single Simple. One physical piece, single quote. `quoteType: "Simple"`. No bomItems.
- **M2** — Single Multi-Part stub. One piece in Multi-Part shape. `quoteType: "Multi-Part"`, `pricingMode: "Individual"`, `bomItems.length === 1`.
- **M3** — Multi-Part Matched Set. 2+ pieces forming one display/kit. `quoteType: "Multi-Part"`, `pricingMode: "Matched Set"`.
- **M4** — Multi-Part Individual. 2+ pieces, per-item pricing.
- **M5** — Purchased blend. Mix of Manufactured + Purchased + Fulfillment items.

This determines which intake template the diff modal uses for display.

### `asks` — unresolved items
Each ask is `{field: "<path>", reason: "<short string>"}`. Examples:
```json
[
  {"field": "printMode", "reason": "RFQ says 'printed' but doesn't specify digital vs. flexo"},
  {"field": "destZip", "reason": "no shipping address provided"}
]
```

The diff modal flags these in the UI. The estimator resolves them before applying.

### `confidence` — overall score
Float 0.0–1.0. Multi-Part also has per-component `bomItems[i].confidence`, which lets the diff modal flag specific components without dragging down the whole-job score.

---

## Canonical terms registry

The system prompt embeds the **canonical terms registry** from `EST_SPOT_Canonical_Terms.md` so the model can resolve SPC-specific vocabulary. Example mappings:

| RFQ says | Canonical engine value |
|---|---|
| "CKB" | "42# Kemi-Lite" |
| "MW" or "Mottled" | "Mottled White" |
| "Kraft" (liner) | `None` (engine value — see D-146) |
| "Bleached" | "Bleached Kraft" |
| "ECT" | grade `XX ECT` (rolls up to Mullen via fallback) |
| "Mullen" or no qualifier | grade `XX` (e.g., `200`) |

When the parser uses the registry, the source tag is `REGISTRY`. Estimators see in the diff modal that a value came from term resolution, not direct RFQ statement.

---

## Customer registry resolution

The system prompt embeds the SPC customer list (from `customerList.csv`). The model looks up customer names against this registry:

1. **Exact match** preferred — `parsed.custCode` filled with the matched `cust_code`, `sources.custCode = "REGISTRY"`.
2. **Single confident fuzzy match** — same handling, with a note.
3. **Multiple ambiguous matches** — `custCode = null`, ask added.
4. **Zero matches** — `custCode = null` (customer is new; estimator adds to DB).

This is critical because the customer code is what links the quote to all downstream systems (archive folder naming, addressing).

---

## Multi-Part detection (D-131)

Two-step decision in the prompt:

**Step 1: Decide one piece or multiple.** Signals for multiple:
- Display vocabulary — "counter display", "PDQ", "sidekick", "endcap", "pallet display", "header card", "topper", "base", "riser", "tray", "divider"
- Multiple part numbers / SKUs / drawings in a single RFQ
- Explicit "set of N", "kit", "display unit" with components listed

Signal for single: one physical piece, even with multiple decoration zones.

**Step 2: Output shape:**
- Single → flat output. `quoteType: "Simple"`. **Do NOT** include `bomItems`.
- Multi → multi-part output with top-level mirror of active item state + `bomItems[]` array.

### Matched Set vs. Individual default

This is a frequent point of confusion. The prompt is explicit:
- Default is **`"Matched Set"`** for any multi-component display/kit.
- Use **`"Individual"`** ONLY if the RFQ literally uses the word "individual" or "separate pricing" or "price each separately".
- Multiple ship-to destinations do NOT make a display Individual.
- Different qtys per component do NOT make it Individual — that's expected.

D-131 fixed several parser regressions where Matched Set displays were being mis-tagged Individual because the parser saw component-level qty differences.

---

## Budget tracking

The parser monitors monthly spend via `parser_budget.json`:

```json
{
  "monthlySpendUsd": 47.32,
  "cap": 100.00,
  "month": "2026-05",
  "calls": 23
}
```

Before any parse call:
```javascript
if (budget.monthlySpendUsd >= budget.cap) {
  throw new Error("monthly cap reached");
}
```

After the API response:
```javascript
const inputTok = response.usage.input_tokens;
const outputTok = response.usage.output_tokens;
const costUsd = (inputTok/1e6 * pricing.input) + (outputTok/1e6 * pricing.output);
budget.monthlySpendUsd += costUsd;
budget.calls += 1;
fs.writeFileSync(budgetPath, JSON.stringify(budget));
```

The cap defaults to $100/month — adjustable via `parser_budget.json`.

Endpoints related to budget:
- `GET /est/parser-budget` — current spend + cap
- `POST /est/reload-key` — reload `.env` or `anthropic_key.txt` (for key rotation)

---

## Pricing table

Hard-coded in `spot_server.js` L118-122:

```javascript
const PRICING_USD_PER_MTOK = {
  "claude-opus-4-7":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-opus-4-6":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cacheRead: 0.30, cacheWrite:  3.75 }
};
```

Default model: `claude-opus-4-7` (line 115). Override via `ANTHROPIC_MODEL` env var.

---

## API key resolution order

`loadAnthropicKey()` checks three sources:
1. `process.env.ANTHROPIC_API_KEY` — from `.env` file via dotenv-style load
2. Inline in server config (rare)
3. `<install>/anthropic_key.txt` — single-line file with just the key

The browser can also send a key directly in the request body via `apiKey` — useful for testing without modifying server config. See L463-466.

---

## Failure modes

| Code | Cause | Recovery |
|---|---|---|
| `NO_KEY` | No API key configured anywhere | Drop key into `.env` or `anthropic_key.txt`, hit `/est/reload-key` |
| `CAP_REACHED` | Monthly spend ≥ cap | Edit `parser_budget.json` cap or wait for month rollover |
| `NO_FILES` | Empty file list | Folder is empty or all files filtered out |
| `OVERSIZED` | Pre-flight token estimate exceeds context | Split into smaller folders, or reduce file set |
| `JSON_PARSE_FAIL` | Model returned invalid JSON | Diff modal shows raw response; user can retry or fix by hand |

---

## Files involved

| Concern | File | Function/section |
|---|---|---|
| Endpoint | `spot_server.js` | `POST /est/parse-rfq` (L2207) |
| Batch dispatch | `spot_server.js` | `anthropicParseRfqBatch` (L461) |
| Text extraction | `spot_server.js` | `extractTextFromFile` |
| Budget | `spot_server.js` | `readBudget`, `writeBudget` |
| Diff modal | `spot_r1_5.jsx` | Parse-review modal (search "parse-review") |
| Loader | `spot_r1_5.jsx` | `__SPOT_LOAD_JSON` window global |
| Intake schema | `EST_SPOT_Intake_Harness.md` | §6 (Simple), §7 (Multi-Part) |
| Canonical terms | `EST_SPOT_Canonical_Terms.md` | Whole file |
| Customer registry | `customerList.csv` | Static reference data |

---

**Next:** read file 20 for the multi-part schema and matched-set vs individual workflow.
