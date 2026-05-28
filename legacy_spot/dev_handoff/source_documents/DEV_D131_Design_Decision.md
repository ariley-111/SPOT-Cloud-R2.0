# D-131 — Multi-Part / Display BOM Support in RFQ Parser

**Status:** DESIGN · Approved 2026-04-28 · Code in flight (round 2)
**Affects:** `spot_server.js` (parser endpoint), `spot_r1_5.jsx` (apply path + diff modal), `prompts/` doc bundle (dependent)
**Depends on:** D-129 Phase 1B (parser baseline)
**Predecessor design:** `DEV_D129_Design_Decision.md`

---

## What This Ships (R1.5.11)

The RFQ parser shipped in R1.5.7.3 (server) + R1.5.8 (UI) handles single-component RFQs. On a multi-part display (header + base + tray + risers + master shipper), it returns a Simple-shape response with one component filled and the rest silently dropped. D-131 extends the parser end-to-end to recognize multi-part RFQs, return a `bomItems[]` array, and populate SPOT's BOM Builder via the existing `commitBom` / `applyItemState` infrastructure.

---

## Problem (2026-04-28 production discovery)

Live test: dropped a multi-part display RFQ. Parser returned one component, ignored the rest. Three rounds of harness edits in `EST_SPOT_Intake_Harness.md` (v2.1 → v2.2 → v2.2.1 → SPOT Project Instructions Phase 2 rewrite) had no observable effect on parser behavior. Root cause was misdiagnosed three times in succession — captured as a permanent lesson in `EST_SPOT_Session_Lessons.md` (2026-04-28 entry).

Actual root cause: **the parser is server-side code, and its output contract is hardcoded in `spot_server.js`** — not in any project knowledge file Claude.ai sessions can edit.

---

## Root Cause — Two-Part Code Bug

Even with a perfect bundled doc, the contract forbids multi-part output:

### 1. Server output schema is single-flat

`spot_server.js` `anthropicParseRfqBatch` L304–309 specifies:
```
{ "parsed": { single flat intake object }, "asks": [...], "confidence": ... }
```

Field list at L324–333 is single-item:
```
custName, custCode, custIdent, custRef, itemDesc, boxStyle,
oneUpW, oneUpL, oneUpD,
flute, boardGrade, outsideLiner, insideLiner, medium,
qtys (array of breaks),
printReq, printMode, printSides, printColors,
matsReq, stripReq, stripDifficulty, glueReq, glueJoints, glueDifficulty, tapeReq,
palletPrep, fscEnabled, kemiTariff,
destZip, fobMode, freightClass, trailerFeet,
estInitials, under5MsfFee
```

No `bomItems[]`. No per-component shape. No multi-part awareness anywhere in the contract.

Even when the API call returns `parsed.quoteType: "Multi-Part"` (which the model can legitimately do), there's nowhere to put 6 components — there's one `oneUpW`, one `flute`, one `boxStyle`. The most prominent piece wins, the rest are dropped.

### 2. Client apply path is single-flat

`spot_r1_5.jsx` `applyParsedFields` (L4885+) walks a flat `parsed` object and calls flat setters: `setCustName`, `setFlute`, `setBoardGrade`, etc. No `bomItems[]` handling exists in the apply path, even though:

- `bomItems` state already exists (L1689 `const [bomItems,setBomItems]=useState([]);`)
- `commitBom` already exists (L1870)
- `applyItemState` already exists (L2514)

L4919 does set `quoteType` if parsed says "Multi-Part" — but with no `bomItems[]` data, that just leaves the app in a half-state: Multi-Part flag on, BOM empty, one item filled at top-level.

---

## Design

### Part A — Server-side (`spot_server.js` `anthropicParseRfqBatch` L234–400)

**A.1 — Extraction instructions update (L298–337)**

Add multi-part detection guidance to the trailing user-message instructions:

```
MULTI-PART DETECTION (NEW v1.5.11):
- If the RFQ describes ONE physical piece, output flat:
    {parsed: {...flat fields...}, asks: [...], confidence: ...}
- If the RFQ describes MULTIPLE physical pieces (any of: counter display, floor display,
  PDQ, sidekick, endcap, pallet display, master pack, header card, base, riser, tray
  beyond a single boxed item, divider, easel, hutch, skirt, master shipper / outer case),
  output multi-part:
    {parsed: {...top-level fields..., quoteType: "Multi-Part",
              pricingMode: "Matched Set", bomItems: [...one entry per piece...]}, ...}
- Single-piece RFQs: omit bomItems entirely. Do NOT return a 1-row bomItems array.
- Master shippers ALWAYS get their own bomItems entry when mentioned.
- Risers, dividers, fillers, and other non-printing pieces ALSO get bomItems entries.
- Pallet itself is NOT an SPC item unless RFQ explicitly says SPC sources it.
- Top-level fields mirror bomItems[0].state when Multi-Part (per Channel Reference L177).
- Each bomItems[i].state contains the full per-item shape (see field list below).
```

**A.2 — Output schema update (L304–309)**

```
{
  "parsed": {
    "custName": "...",
    "custCode": "...",
    "custIdent": "...",          // top-level = bomItems[0].custIdent (D-081 contract)
    "custRef": "...",
    "itemDesc": "...",
    "quoteType": "Simple" | "Multi-Part",
    "pricingMode": "Individual" | "Matched Set",
    "setMarginPct": "0.40",       // Multi-Part only
    
    // top-level intake fields mirror bomItems[0].state (Multi-Part) or hold the only item (Simple)
    "boxStyle": "...",
    "flute": "...",
    "boardGrade": "...",
    "outsideLiner": "...",
    "insideLiner": "...",
    "medium": "...",
    "oneUpW": "...",
    "oneUpL": "...",
    "qtys": ["...", "...", "", "", ""],
    "printReq": "...",
    "printMode": "...",
    ...
    
    // shared fields
    "estInitials": "SPC",
    "under5MsfFee": "0",
    "fobMode": "Origin",
    "destZip": "...",
    
    // Multi-Part only — omit when Simple
    "bomItems": [
      {
        "id": "item-1",
        "desc": "Header card",
        "custIdent": "PART-001",
        "type": "Manufactured",
        "pcsPerSet": 1,
        "state": {
          "itemDesc": "...",
          "boxStyle": "Display Header",
          "flute": "E",
          "boardGrade": "ECT 32",
          "outsideLiner": "42# Kemi-Lite",
          "insideLiner": "None",
          "medium": "None",
          "fscEnabled": false,
          "fscFee": "25.00",
          "under5MsfFee": "0",
          "quoteMode": "One-Up",
          "oneUpW": "12.5",
          "oneUpL": "18.0",
          "qtys": ["250", "500", "", "", ""],
          "selSlot": 0,
          "printReq": "Yes",
          "printMode": "Satin",
          "printSides": "1-Sided",
          "whiteInk": "No",
          "saber": "No",
          "saberCuts": "1",
          "saberBlanksOut": "1",
          "cadPricingMethod": "By Difficulty",
          "cadDifficulty": "Standard",
          "crestComplexity": "Standard",
          "totalRuleInches": "0",
          "perfPct": "0",
          "productMats": "No",
          "handStripping": "No",
          "perimeterStripping": "No",
          "strippingComplexity": "Standard",
          "handGluing": "No",
          "jointsPerPiece": "1",
          "gluingComplexity": "Standard",
          "tape": "No",
          "tapeType": "Clear",
          "cuttingDieCost": "0",
          "dieTreatment": "None",
          "dieAmortMethod": "Markup",
          "prepressTreatment": "Auto"
        }
      }
      // ...one entry per physical piece...
    ]
  },
  "asks": [...],
  "confidence": <float 0.0 - 1.0>
}
```

**A.3 — Field list update (L324–333)**

Add per-component shape documentation. The model needs to know it can fill bomItems[i].state.* using the same field set as the top-level.

**A.4 — Hardcoded vs bundled-doc strategy**

Multi-part guidance lives in the **hardcoded extraction instructions**, not in the doc bundle. Rationale: the deployed install may not have `prompts/` populated (per 2026-04-28 user confirmation: "server uses something else"), so doc-bundle-only fixes are unreliable. Hardcoding the multi-part contract guarantees the parser knows the schema regardless of what's in `prompts/`.

If `prompts/` IS populated, the v2.2.1 harness's display vocabulary, BOM Scope Pass, and Pass Criteria are all reinforcing context — but they're not load-bearing.

### Part B — Client-side (`spot_r1_5.jsx` `applyParsedFields` L4885+)

**B.1 — New Multi-Part branch**

Detect `Array.isArray(parsed.bomItems) && parsed.bomItems.length >= 1`:

```javascript
// Multi-Part response — populate bomItems[] via commitBom-equivalent flow
const items = parsed.bomItems.map((item, i) => ({
  id: item.id || `item-${i+1}`,
  desc: String(item.desc || item.state?.itemDesc || `Item ${i+1}`),
  custIdent: String(item.custIdent || ""),
  type: ["Manufactured","Purchased","Fulfillment"].includes(item.type) ? item.type : "Manufactured",
  pcsPerSet: Number.isFinite(+item.pcsPerSet) ? +item.pcsPerSet : 1,
  state: { ...freshItemState(), ...(item.state || {}) }
}));
setBomItems(items);
setActiveItemIdx(0);
applyItemState(items[0].state);
setQuoteType("Multi-Part");
setPricingMode(parsed.pricingMode === "Individual" ? "Individual" : "Matched Set");
if (parsed.setMarginPct != null) setSetMarginPct(String(parsed.setMarginPct));
```

Top-level fields (custName, custIdent, etc.) still apply via the existing flat-setter path — those are the shared/identity fields that mirror bomItems[0].state per Channel Reference L177.

**B.2 — Simple branch unchanged**

Existing flat-setter path continues to handle Simple responses without modification.

**B.3 — Diff modal (L8618+)**

When `parseResult.parsed.bomItems` is present:
- Render per-item tabs in the diff display
- Header shows "N items · M fields total"
- Apply All applies all items at once via the B.1 path
- Apply Selected (per-item or per-field) deferred to a later iteration; v1 ships with Apply All only for Multi-Part

**B.4 — Auto-apply confidence threshold**

Per design call: lower the auto-recalc threshold for Multi-Part responses from 0.85 → 0.75. Multi-Part has more failure surface; lower threshold forces estimator review on borderline confidence.

```javascript
const conf = Number(parseResult.confidence) || 0;
const isMultiPartResponse = Array.isArray(parsed.bomItems) && parsed.bomItems.length >= 1;
const autoApplyThreshold = isMultiPartResponse ? 0.75 : 0.85;
if (conf >= autoApplyThreshold) {
  // existing auto-recalc + auto-Preview path
}
```

### Part C — Doc bundle (`prompts/EST_SPOT_Intake_Harness.md` — dependent)

Sync v2.2.1 harness (5b2998e4) to `prompts/EST_SPOT_Intake_Harness.md` in the deployed install if/when the bundle directory is wired. Server restart required. **Not a hard dependency** — multi-part guidance is in the hardcoded extraction instructions per A.4.

---

## Tests (TC-D131)

| # | What it verifies |
|---|---|
| 1 | Multi-part display RFQ (4–6 components: header + base + tray + risers + master shipper) → `parsed.bomItems.length` matches component count; every component has correct boxStyle from §10 Display Vocabulary; dims populated; ⚠️ WATCH on litho-lam if applicable |
| 2 | Simple-quote RFQ (single piece) → `parsed.bomItems` omitted; flat fields populated; `quoteType === "Simple"` (regression on D-129 baseline) |
| 3 | JSX apply: Multi-Part response → `bomItems[]` populated via commitBom-equivalent flow; quoteType set; activeItemIdx=0; applyItemState fires for item 0; Simple response uses existing flat-apply path |
| 4 | All TC-D129 sub-cases (a)–(g) still pass — no regression on baseline parser flow |
| 5 | Auto-apply gate: Multi-Part conf ≥ 0.75 triggers auto-recalc + Preview; conf < 0.75 leaves at fields-filled state; Simple gate unchanged at 0.85 |

Test fixtures:
- Real multi-part display RFQ (operator-supplied)
- Real Simple-quote RFQ (operator-supplied — TC-D129 baseline)

---

## Cost Model

Multi-part responses are larger output payloads. Per-parse cost estimate:

| Scenario | Tokens out | Cost (Opus 4.7 @ $75/M out) |
|---|---|---|
| Simple (current) | ~1,800 | ~$0.14 + input ~$0.10 = ~$0.24 |
| 6-component display | ~6,000–9,000 | ~$0.45–0.68 + input ~$0.10 = ~$0.55–0.78 |

At ~$0.80 per multi-part parse and ~5 multi-part RFQs per day (estimated mix), additional cost is ~$120/mo on top of D-129 baseline. Total parser cost stays well under the $500/mo cap.

Cap-reached behavior unchanged (existing D-129 logic).

---

## Rollout

R1.5.11. Source changes:
- `spot_server.js` (extraction instructions + schema documentation in code comments + actual schema enforcement in API call)
- `spot_r1_5.jsx` (applyParsedFields multi-part branch + diff modal multi-part rendering + auto-apply threshold)
- Rebuild `SPOT_R1.5.html` via `node build_spot_r1_5.js`
- **Server restart required** (system prompt is loaded at startup; even though the schema is hardcoded, restart picks up any deployed-doc changes alongside)

---

## Risks

1. **Bundled doc gap.** Deployed install may not have `prompts/` populated — see A.4. Mitigation: hardcode multi-part guidance in extraction instructions. v2.2.1 harness is reinforcing only.

2. **Simple-quote regression.** Adding the Multi-Part branch must not break the existing Simple flow. Mitigation: TC-D131.2 + TC-D131.4 are mandatory before close.

3. **Cost rise.** Multi-part output is larger. ~$0.55–0.78 vs ~$0.24 per Simple parse. Within budget cap. Estimator can use `?force=true` to re-parse if unhappy with first result.

4. **Over-eager Multi-Part detection.** Model may fire Multi-Part branch on RFQs that are technically a single piece with multiple decoration zones. Mitigation: lowered confidence threshold (0.75) forces estimator review; estimator can override via diff modal Discard.

5. **Apply-Selected per-item complexity.** Per-item granular Apply deferred. v1 ships with Apply All only for Multi-Part. Future iteration if estimator demand surfaces.

6. **D-081 custIdent contract.** Top-level `custIdent` must match `bomItems[0].custIdent`. Server must enforce this in the response shape (or JSX must enforce on apply). Mitigation: JSX apply path normalizes top-level custIdent from bomItems[0] regardless of what server returned.

---

## What's NOT in D-131

- Per-item Apply Selected in diff modal (deferred)
- Streaming responses (D-129 baseline behavior — single round-trip)
- Multi-customer batching
- Re-parse on-edit
- Doc bundle install verification (separate operational task — see TC-D131 fixture work)

---

## Operational Notes

- Confidence threshold change (0.85 → 0.75 for Multi-Part) should be visible in the diff modal footer alongside the cost/timing/model line. Estimator should know which threshold applied.
- `parser_output.json` cache continues to work; multi-part responses cache the full payload including `bomItems[]`.
- Budget tracking unchanged.
- TC-D129 closure gate is NOT advanced by D-131 ship — TC-D129 still requires its own sub-cases (a)–(g) to pass independently.
