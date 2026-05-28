# D-129 — Phase 1B RFQ Parser via Anthropic API

**Status:** PARTIAL · Backend SHIPPED in R1.5.7.3 · UI integration deferred to R1.5.8
**Affects:** `spot_server.js` (parser + budget endpoints, doc bundle), `spot_r1_5.jsx` (TBD R1.5.8), `prompts/` directory (NEW), `.env.template` (NEW)
**Depends on:** D-120 Phase 1 (drop-zone archive)
**Predecessor design:** `DEV_D120_Design_Decision.md` Phase 1B section, `DEV_R1_6_Design_Backlog.md` 2026-04-25 entries

---

## What This Ships (R1.5.7.3 — backend only)

A server-side endpoint that reads dropped RFQ-class files from a quote's archive folder and uses the Anthropic API to extract SPOT intake fields. The estimator triggers parsing manually (UI ships R1.5.8); the server side is in place and ready.

**Locked decisions** (from this session 2026-04-27):
- **Model:** `claude-opus-4-7` (vision-capable, best for PDF/image RFQs, same price as 4.6).
- **Trigger:** Manual button (NOT auto-fire on upload). Estimator clicks "Parse RFQ" once all files for the customer's RFQ are dropped.
- **Batch mode:** All RFQ-class files in the folder go in one API call, sharing context. Avoids paying per-file when the customer's RFQ spans 4 attachments.
- **Auto-run after Apply:** If `confidence >= 0.85` and Apply All is clicked, SPOT auto-triggers its calculate pipeline. Below 0.85, fields fill but estimator reviews/runs manually.
- **Strict guardrails:** System prompt explicitly forbids creativity. Use only canonical SPOT values, return null+ask for anything ambiguous, never generate quote prices.
- **Cap:** $500/mo with auto-rollover monthly. Hard-stop at 100%, soft-warn at 80%.

---

## Server Contract — `POST /est/parse-rfq`

**Request body:**
```json
{
  "folder": "PCA - Ashland_MEM-260427-141523",
  "filenames": ["rfq.pdf", "spec_sheet.pdf"],   // OPTIONAL — omit to parse all RFQ-class files in folder
  "year": "2026"                                 // OPTIONAL — defaults to current year
}
```

**Response (200):**
```json
{
  "parsed": { /* SPOT intake fields per EST_SPOT_Intake_Harness.md */ },
  "asks": [
    {"field": "qtys[3]", "reason": "RFQ specified only 3 quantity tiers"},
    {"field": "freightClass", "reason": "no class specified"}
  ],
  "confidence": 0.87,
  "parsedAt": "2026-04-27T18:35:00.000Z",
  "costUsd": 0.34,
  "model": "claude-opus-4-7",
  "elapsedMs": 18420,
  "tokensIn": 2130,
  "tokensOut": 1820,
  "cacheReadTokens": 64210,
  "cacheWriteTokens": 0,
  "sourceFiles": ["rfq.pdf", "spec_sheet.pdf"],
  "sourceFileCount": 2,
  "sourceFolder": "PCA - Ashland_MEM-260427-141523",
  "cached": false
}
```

**Response (503 NO_KEY):** `{"error": "ANTHROPIC_API_KEY not configured", "code": "NO_KEY"}`
**Response (429 CAP_REACHED):** `{"error": "monthly cap reached ($X of $Y)", "code": "CAP_REACHED"}`
**Response (502 API_ERROR):** `{"error": "Anthropic API <status>: <body>", "code": "API_ERROR"}`
**Response (400 NO_FILES):** `{"error": "no RFQ-class files in folder to parse"}`

Cache: identical filenames → returns cached `parser_output.json` from previous parse unless `?force=true`.

## Server Contract — `GET /est/parser-budget`

```json
{
  "monthlySpendUsd": 12.4500,
  "monthStart": "2026-04-01",
  "cap": 500,
  "callCount": 7,
  "lastCall": "2026-04-27T18:35:00.000Z",
  "configured": true,
  "keySource": ".env file",   // or "ANTHROPIC_API_KEY env var" or "anthropic_key.txt"
  "model": "claude-opus-4-7",
  "remainingUsd": 487.55,
  "pctUsed": 2
}
```

## Server Contract — `POST /est/reload-key`

Reloads the API key from disk after the user creates/edits `.env`. Returns:
```json
{"configured": true, "source": ".env file"}
```

## API Key Resolution Order

1. `process.env.ANTHROPIC_API_KEY` (Windows env var, set before launching)
2. `<install_folder>/.env` file with line `ANTHROPIC_API_KEY=sk-ant-...`
3. `<install_folder>/anthropic_key.txt` (single-line file containing just the key)

`.env.template` ships as a placeholder; user renames to `.env` and pastes key.

## System Prompt Bundle

Loaded once at server startup from `<install_folder>/prompts/`. Sent as a cached system block (`cache_control: ephemeral`) so subsequent parses pay cache-read rate (~$1.50/M) instead of fresh-input rate ($15/M).

Bundled docs (~65k tokens total):
- `EST_SPOT_Quoting_Rules.md`
- `EST_SPOT_Canonical_Terms.md`
- `EST_SPOT_Channel_Reference.md`
- `EST_SPOT_Intake_Harness.md`
- `EST_SPOT_Intake_Template.md`
- `EST_SPOT_UI_Map.md`
- `EST_SPOT_Session_Lessons.md`
- `DEV_SPOT_R1_5_Control_Tables.md`
- `DEV_Calibration_Framework_v2.md`
- `TEST_SPOT_R1_5_Testing_Guide.md`
- `TEST_SPOT_R1_5_Chowder_Specs.md`
- `Reading_Discipline_Protocol.md`
- `02_RELEASE_HISTORY.md`

Hard guardrails in the trailing user instruction:
1. Use ONLY canonical SPOT values from `EST_SPOT_Canonical_Terms.md`. No outside terms.
2. Do NOT infer. RFQ silent → null + ask.
3. Do NOT generate prices, freight, GM, or economic output. Intake fields only.
4. Initials always "SPC" (Rule 2).
5. routeOverride NEVER set (Rule 1).
6. under5MsfFee always "0" (Rule 3).
7. Print finish never defaulted — null + ask if RFQ silent (Rule 8 / D-114).
8. FOB "Origin" unless RFQ explicitly says otherwise.
9. ECT grades written as customer wrote them; no Mullen-substitution annotation (internal).
10. Confidence < 0.85 means estimator review required.

## Cost Model

Pricing per million tokens (Opus 4.7):
- Input: $15.00
- Output: $75.00
- Cache read: $1.50
- Cache write: $18.75

Typical parse:
- First parse of day: cache write 65k @ $18.75/M = $1.22 + call ~$0.40 = **~$1.60**
- Subsequent same-day: cache read 65k @ $1.50/M = $0.10 + call ~$0.40 = **~$0.50**

At 30 parses/day: ~$15-20/day, well under $500/mo cap.

## R1.5.8 — UI Integration (NOT YET SHIPPED)

Still to do in JSX:

1. **"Parse RFQ" button** in Files Sec, visible only when:
   - `parserStatus.configured === true` AND
   - `archiveFiles.some(f => f.class === "rfq")` AND
   - At least one RFQ-class file is unparsed (no `parsedAt`)

2. **In-flight indicator**: button state changes to "Parsing... (~30s)" with spinner; per-file rows show `⟳ parsing` badge.

3. **Confirmation modal** on response:
   - Side-by-side diff: current SPOT field values vs Claude's parsed values
   - Checkbox per field
   - "Apply All" / "Apply Selected" / "Discard" buttons
   - Asks list rendered as yellow warnings
   - Cost/timing/model footer

4. **Apply path**:
   - For every `parsed[fieldKey]` with corresponding SPOT setter, write the value
   - Handles all ~40 fields per `EST_SPOT_Intake_Harness.md`, NOT just 12
   - After apply: if confidence >= 0.85 AND Apply All → trigger SPOT calculate (find the existing recalc-all hook)
   - If confidence < 0.85 → leave estimator at fields-filled state for review

5. **Parser status badge** in Files Sec: shows configured/not, model, $X.XX of $YYY this month.

## What's NOT in Phase 1B

- No model fallback (if Opus 4.7 fails, surface error — don't retry on a cheaper model)
- No streaming (single round-trip, ~20-60s)
- No multi-customer batching
- No RFQ re-parse on re-upload (idempotent — `?force=true` to override)
- No fine-tuning/training data collection (pure prompting)
- No SharePoint sync of parser outputs (Phase 2)

## Operational Notes

- The `prompts/` doc bundle is loaded ONCE at server startup. After Cowork applies updates to source docs, **server must restart** for the new doc bundle to be picked up.
- Budget tracking persists in `<ARCHIVE_ROOT>/parser_budget.json` and survives server restarts. Auto-rolls over on month boundary.
- Each parsed folder also gets a `parser_output.json` file alongside `meta.json`. Can be deleted to force a fresh parse.
