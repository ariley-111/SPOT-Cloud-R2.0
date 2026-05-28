# 11 — State Management

How SPOT stores, persists, and restores state. This file covers the three layers of state — React, localStorage, window globals — and the patterns that hold them together.

---

## Three layers

### Layer 1: React component state (volatile, current quote)

Around 80 `useState` calls inside the `App()` function in `spot_r1_5.jsx`. Each owns one piece of the live quote. Examples:

```javascript
const [custName, setCustName]   = useState("");
const [flute, setFlute]         = useState("B");
const [qtys, setQtys]           = useState(["", "", "", "", ""]);
const [bomItems, setBomItems]   = useState([defaultBomItem()]);
const [activeIdx, setActiveIdx] = useState(0);
// ... ~75 more
```

React state is lost when the tab is closed unless it's been persisted to localStorage.

### Layer 2: localStorage (persistent, per-browser)

Survives tab close, browser restart, machine reboot. Stored as JSON strings.

| Key | Purpose | Schema |
|---|---|---|
| `wftabs` | Tab metadata array | `[{ id, name, customer, partNumber }, ...]` |
| `wftab{id}` | Full estimate state per tab | JSON blob |
| `wftabest{timestamp}` | Archived estimate (Save Estimate) | JSON blob |
| `wf_default_pricing_targets` | User override of `RATE_DEFAULTS` | object |
| `wf_stock_sheets` | User additions/removals from `SHEET_GROUPS` | array |
| `wf_shipto_history` | Per-customer-code ship-to memory | `{ [code]: [{...}, ...] }` |

### Layer 3: Window globals (debug + automation)

```javascript
window.__SPOT_UI_VERSION       // "R1.6.5.1"
window.__SPOT_SESSION_LOG      // event log array
window.__SPOT_LOG_EVENT(name, payload)
window.__SPOT_LOAD_JSON(obj)
```

These exist so Chrome MCP or other automation can drive SPOT without going through file pickers or the UI.

---

## The reset-first pattern

Two functions own state loading: `applyState` (whole quote) and `applyItemState` (single BOM item).

### `applyState(loadedJson)`

**Step 1: Reset everything to default.** Every state variable is set to its default value. This happens even if the loaded JSON has a field for it.

**Step 2: Apply loaded fields on top.** Each field in the loaded JSON triggers its setter. Missing fields stay at default.

```javascript
function applyState(loadedJson) {
  // Step 1: reset
  setCustName(DEFAULT.custName);
  setFlute(DEFAULT.flute);
  setQtys([...DEFAULT.qtys]);
  // ... ~80 setters reset

  // Step 2: apply
  if (loadedJson.custName !== undefined) setCustName(loadedJson.custName);
  if (loadedJson.flute    !== undefined) setFlute(loadedJson.flute);
  // ... ~80 conditional setters

  // Step 2.5: rate migration block
  migrateRatesIfNeeded(loadedJson);

  // Step 2.6: schema migration
  if (loadedJson.schema_version === 1) migrateV1ToV2(loadedJson);

  // Step 3: post-apply effects
  recalcEconomics();
  setActiveIdx(loadedJson.activeItemIdx || 0);
}
```

### Why reset-first matters

If you merge instead of reset:
- A field that's set in the current quote but missing in the loaded JSON will **stay set** when it should have been cleared
- The loaded estimate doesn't match what was saved
- The Cost Report includes phantom data from the previous quote
- The customer gets a quote that doesn't match what the estimator thinks they sent

D-080 was exactly this — loading a quote with no FSC fee left the previous estimate's FSC fee in place. D-087 was the same pattern in `applyItemState` for BOM items. D-098 was a regression where reset-first was accidentally undone during a refactor.

### Enforcement

There's no test that catches merge regression directly. The mitigation is review discipline — every PR that touches `applyState` or `applyItemState` gets reviewed for the pattern. When you ship a change here, run at least one end-to-end load test (save → close tab → re-open → verify all fields).

---

## The rate-migration block

Inside `applyState`, after the field-level apply, a sub-block snaps any rate field in the loaded JSON to current `RATE_DEFAULTS`. Example:

```javascript
function migrateRatesIfNeeded(loadedJson) {
  let migrated = false;

  // Iterate the loaded rate fields
  for (const key in RATE_DEFAULTS) {
    const loadedVal = loadedJson[key];
    const currentVal = RATE_DEFAULTS[key];
    if (loadedVal !== undefined && loadedVal !== currentVal) {
      // Snap to current
      setRateField(key, currentVal);
      migrated = true;
    }
  }

  // FSC migration
  if (loadedJson.fscFee === "15" || loadedJson.fscFee === "15.00") {
    setFscFee("25");
    migrated = true;
  }

  // Sell prices are NOT changed — they preserve as loaded
  // (Rule 6)

  if (migrated) showRateMigrationToast();
}
```

The amber toast (popup #3) fires whenever any rate migrated. Estimator decides whether to re-quote.

---

## Schema migration

`SPOT_SCHEMA_VERSION` is currently `2`. Estimates saved under schema 1 need migration on load.

Migrations are append-only — each schema bump adds a migration function that transforms the older shape into the newer one. The migration is called once per load, before the field-level apply.

Examples of schema-1-to-2 changes:
- `cadDifficulty` label rename (Extreme → Complex, D-106)
- Multi-Part top-level `custIdent` mirror to `bomItems[0].custIdent`
- New default values for fields that didn't exist in v1

If you bump the schema:
1. Increment `SPOT_SCHEMA_VERSION` in `spot_engine.js` and the JSX ENGINE block
2. Write `migrateV2ToV3` (or whatever)
3. Call it from `applyState` if `loadedJson.schema_version === 2`
4. Update test fixtures
5. Document in `01_OPEN_ISSUES.md` what changed

---

## Tab management

A "tab" in SPOT is a saved working draft of a quote. Multiple tabs can be open. Each has:
- An id (timestamp-based)
- A name (typically customer + part#)
- A customer code
- A part number
- Full state under `wftab{id}` key

The tab strip (`#spot-tabs`) lists open tabs. Clicking switches active state from the current tab's wftab key to the clicked one.

**Switching tabs:**
1. Save current state to `wftab{currentId}`
2. Read `wftab{targetId}` from localStorage
3. Call `applyState(targetJson)` (full reset + apply)
4. Update `activeIdx`

**Closing a tab:**
1. Confirm with user if unsaved (popup #44)
2. Save current state to wftab key (if user chose Save)
3. Remove the wftab entry
4. Remove from `wftabs` array
5. Switch to adjacent tab or open a new blank tab

---

## The Save Estimate flow

Save Estimate is different from tab persistence. Tabs are working drafts; Save Estimate is the formal "this is the final quote" archive.

**Save flow:**
1. Estimator clicks Save Estimate
2. Modal asks for name + notes
3. Current state is captured via `gatherState()`
4. JSON is written to `wftabest{timestamp}` localStorage key
5. (Optional) JSON is written to disk via the archive endpoint
6. (Optional) PDF is generated via Preview Quote

**Load flow:**
1. Estimator clicks Load Estimate
2. Modal shows list of archived estimates with filters
3. Estimator picks one
4. JSON is read from `wftabest{timestamp}` key
5. `applyState(loadedJson)` runs (reset-first)
6. Rate migration may fire
7. The estimate is loaded into the current tab

---

## `gatherState()` — the inverse of `applyState`

Reads every state variable into a JSON object. Output schema is canonical SPOT JSON (covered in `source_documents/EST_SPOT_Channel_Reference.md`).

Important: `gatherState()` outputs the *current* state, including any changes the estimator has made since loading. It's not necessarily what was loaded.

The output is what gets:
- Stored to localStorage on tab switch
- Stored to `wftabest{timestamp}` on Save Estimate
- Shown in Cost Report and Preview Quote
- Exported as JSON for fleet regression

---

## Per-customer ship-to memory (`wf_shipto_history`)

Schema:
```javascript
{
  "SKYBOX": [
    { name: "Skybox Warehouse 1", address_1: "...", city: "...", state: "...", zip: "...", lastUsed: "2026-05-22" },
    { name: "Skybox Warehouse 2", ... }
  ],
  "ACMECO": [ ... ]
}
```

When an estimator picks a customer, the UI checks for prior ship-to entries under that customer code and offers to populate. Estimator selects or skips.

Limit: 5 ship-to entries per customer (LRU eviction).

---

## `wf_default_pricing_targets`

User-level override of `RATE_DEFAULTS`. If set, applies on top of the source-of-truth defaults. Loaded at app start, applied to the working `RATE_DEFAULTS` object.

Allows estimators to tune rates locally without code changes. Visible in Advanced Controls; reset-to-defaults button restores from source.

---

## `wf_stock_sheets`

User additions/removals to the `SHEET_GROUPS` library. Schema:
```javascript
{
  added: [ /* SHEET_GROUPS-shaped entries */ ],
  removed: [ /* {g, f, ol, il, md, size: [w, l]} keys */ ]
}
```

On app start, the runtime `SHEET_GROUPS` is computed as base + added − removed.

---

## Common state-management debugging

| Symptom | Suspect |
|---|---|
| Loaded estimate has wrong customer | `applyState` reset-first violation; check git for recent changes |
| Rate migration toast fires unexpectedly | `RATE_DEFAULTS` was changed without bumping `SPOT_SCHEMA_VERSION` |
| Tab switch loses fields | The `gatherState`/applyState round-trip is missing a setter |
| Save fails silently | localStorage quota exceeded; check `localStorage.length` and entry sizes |
| Multi-Part quote loses item state | `custIdent` mirroring (D-081); check both top-level and bomItems[0] |
| `useMemo` returns wrong values | Babel/IE11 TDZ; hoist all `const` declarations above the memo |

---

## What's NOT in state

These live elsewhere:
- Customer list — server-side (`customerList.csv`)
- Sheet library (base) — in source (`SHEET_GROUPS` in engine)
- Rates (base) — in source (`RATE_DEFAULTS`)
- Anthropic API key — server `.env` or in-memory per session
- UTS API key — server `.env`

The principle: data that's the same across estimators lives in source or server. Data that's per-estimator lives in localStorage. Data that's per-quote lives in React state and persists via the tab+archive flow.
