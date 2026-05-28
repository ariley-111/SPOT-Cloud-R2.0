# 21 — Code Patterns and Gotchas

The patterns SPOT uses repeatedly, and the bugs that recur if you forget them.

---

## Pattern 1 — Babel IE11 Temporal Dead Zone (TDZ) hoisting

**The trap:** Babel transpiles JSX to ES5 for IE11 support. `const` and `let` become `var`, which means **TDZ disappears**. Variables declared after a `useMemo` that references them will hoist as `undefined` rather than throw.

**Example bug (D-107 class):**
```jsx
const computed = React.useMemo(() => {
  return doStuff(myVar);   // myVar is undefined here under Babel — does NOT throw
}, [myVar]);
const myVar = computeMyVar();   // declared LATER in component
```

**Why it matters:** the code runs without an error, but `computed` is silently wrong. The bug shows up as miscalculated values, not stack traces.

**The fix:** verify every variable referenced inside a `useMemo` is declared **before** the `useMemo`. When reviewing a `useMemo`, scan upward for every identifier; if any is declared below, that's a bug.

This class of bug has bitten SPOT multiple times — D-107, D-108, and at least two unlogged occurrences during R1.5.x calibration work. The fix is mechanical, the detection is the hard part.

**Tooling:** there is no lint rule for this in the current build. Add it to the review checklist for any PR that touches a `useMemo`.

---

## Pattern 2 — Reset-first state updates (D-080 / D-087)

**The principle:** `applyState` and `applyItemState` are **full state replace, not merge**. Loading a saved quote starts from a blank slate, not the current state.

**Why:** previous-state bleedthrough is the #1 source of "ghost field" bugs — misc charges, stripping flags, fobMode values that persisted from the previous tab.

**Pattern:**
```javascript
function applyState(newState) {
  setItem(BLANK_ITEM);      // reset everything
  setProd(BLANK_PROD);
  setTab(BLANK_TAB);
  // ... reset all top-level state slices
  
  // NOW apply the new values
  setItem({...BLANK_ITEM, ...newState.item});
  setProd({...BLANK_PROD, ...newState.prod});
  setTab({...BLANK_TAB, ...newState.tab});
}
```

The key is the BLANK_* prefix is applied as the base of the spread. Any field not in `newState` falls back to BLANK.

**Gotcha:** React batches state updates. The reset and re-apply happen in the same render cycle, so users never see the blank state visually. But the *intermediate object* matters for downstream effects.

---

## Pattern 3 — `useMemo` for derived values, not side effects

**Wrong:**
```jsx
React.useMemo(() => {
  console.log("recalculating");      // side effect
  localStorage.setItem("foo", bar);  // side effect
  return computeStuff();
}, [bar]);
```

**Right:**
```jsx
const computed = React.useMemo(() => computeStuff(bar), [bar]);

React.useEffect(() => {
  console.log("recalculating");
  localStorage.setItem("foo", bar);
}, [bar]);
```

`useMemo` is for **expensive computations**. `useEffect` is for **side effects**. They look similar in their dep arrays but they're not interchangeable.

**SPOT-specific gotcha:** `useMemo` runs **during render**. If you trigger a state update inside one, you'll get a render loop. The qty pricing grid recalc is a big `useMemo` — never put `setX` calls inside it.

---

## Pattern 4 — Window globals for testing

SPOT exposes test hooks on `window`:

```javascript
// In spot_r1_5.jsx (search "window.__SPOT")
window.__SPOT_LOAD_JSON = (payload) => {
  // Apply a quote JSON to the active tab
};

window.__SPOT_GET_STATE = () => {
  // Return current state for inspection
};

window.__SPOT_SET_MODE = (mode) => {
  // EST / DEV / TEST mode switch
};
```

These are used by:
- Chrome MCP for live UI testing (per `EST_SPOT_UI_Map.md` harness)
- Cowork verification flows
- Manual debugging via the browser console

**Convention:** all SPOT window globals start with `__SPOT_`. Anything else is unintentional.

**Critical for testing:** when Chrome MCP loads a JSON, it uses base64-encoded payload:
```javascript
window.__SPOT_LOAD_JSON(JSON.parse(atob(payload)));
```

Always include `estInitials: 'SPC'`, `estNumAuto: false`, and a generated `estNum`. Otherwise the JSON loader ignores the file.

---

## Pattern 5 — localStorage keys and migration

SPOT uses these localStorage keys (current as of R1.6.5.1):

| Key | Contents | When written |
|---|---|---|
| `wftabs` | Array of tab IDs in order | Tab list changes |
| `wftab{id}` | Full state for a tab | Any state change in that tab (debounced) |
| `wftabest{timestamp}` | Saved estimate snapshots | "Save Estimate" action |
| `wf_default_pricing_targets` | Default GM curve | User edits defaults |
| `wf_stock_sheets` | Local override of APPROVED_SHEETS | User edits sheet library |
| `wf_shipto_history` | Per-customer ship-to history | "Ship To" panel save |
| `wf_anthropic_key_{user}` | Per-user API key (rare) | User sets browser-side key |

**Migration pattern (RATE_DEFAULTS):** when SPOT calibration values change, old saved estimates need to update. The pattern at load time:

```javascript
function applyState(savedState) {
  // ... reset-first ...
  
  // Rate migration: replace stale rate fields with current RATE_DEFAULTS
  const migrated = {
    ...savedState,
    item: {
      ...savedState.item,
      incaRate: RATE_DEFAULTS.incaRate,           // always use current
      cadRate: RATE_DEFAULTS.cadRate,
      // ... etc for all rate fields
    }
  };
  
  // But: SELL PRICES from the saved state are PRESERVED unchanged.
  // Margins shift to absorb the new costs. This is intentional —
  // historical quote totals remain stable.
  
  applyMigrated(migrated);
}
```

**Critical:** sell prices never auto-update on rate migration. Only costs do. The user sees a margin shift, not a sell shift. See `02_RELEASE_HISTORY.md` D-080 and D-098 for the original design and follow-ups.

---

## Pattern 6 — Inputs as strings, math as numbers

The intake state stores many numeric fields as **strings** (`"0.40"`, `"10"`, `"25"`). This is because:
- HTML number inputs return strings
- Some fields allow blank/null distinct from zero
- JSON round-trip preserves exact decimal representation

The pattern: convert to number **at the point of math**, not in state.

```javascript
const setMarginPct = pn(item.setMarginPct);    // pn = "parse number"
const margin = cost * (1 + setMarginPct);
```

`pn()` is a defensive number-parse defined in `spot_engine.js`:
```javascript
function pn(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
```

Use `pn()` everywhere you need a number from intake state. The pattern is consistent across the engine and the JSX.

**Gotcha:** comparing string fields. `item.fobMode === "Origin"` is fine. `item.numColors === 4` is NOT fine because `numColors` may be `"4"`. Always use `pn(item.numColors) === 4` or compare strings.

---

## Pattern 7 — Three-state booleans (string `"true"` / `"false"` / undefined)

Some flags use **string booleans** instead of real booleans. Example:
```javascript
assumptions.bobstFirstSizing = "true"  // ON
assumptions.bobstFirstSizing = "false" // OFF
assumptions.bobstFirstSizing = undefined  // unset → defaults to ON
```

The engine checks for the explicit string:
```javascript
if (assumptions.bobstFirstSizing !== "false") { /* on */ }
```

**Why:** JSON round-trip + form serialization preserves strings cleanly. Real booleans sometimes get coerced to strings anyway, and the explicit check is unambiguous.

**Gotcha:** `if (assumptions.bobstFirstSizing)` evaluates `"false"` as **truthy**. Don't write that. Always compare against the explicit string.

This pattern is used for: `bobstFirstSizing`, `fscEnabled`, `printOn`, `whiteInk`, plus several misc flags. Search the engine for `=== "false"` to find all of them.

---

## Pattern 8 — The ENGINE/ENGINE mirror

`spot_engine.js` (1,131 lines) is a **mirror** of the ENGINE block inside `spot_r1_5.jsx`. They must stay in sync. The reasons:
- Engine is called by `fleet_compare.js` for regression
- JSX needs the engine inline for browser execution
- Babel can't import ESM from inside the JSX runtime

**The drift detector:** during the SHA audit ritual at session start, both files are compared for the ENGINE block. Any drift is flagged. See `09_Codebase_Walkthrough_Engine.md` for the diff method.

**Rule:** when you change one, change the other. The build script does NOT auto-sync — it's a manual discipline.

---

## Pattern 9 — Version sentinel sweep

Every release must update version strings in multiple files. Forgetting one causes "stale version badge" bugs (D-149 was exactly this — a JSX ternary fallback emitted the wrong version in Developer mode).

**Sentinels to sweep:**
| File | Pattern |
|---|---|
| `spot_r1_5.jsx` | `R1.6.5.1`, version badge ternary |
| `build_spot_r1_5.js` | Title string in HTML wrapper |
| `package.json` | `"version"` |
| `install.bat` | Banner lines (3 sites) |
| `OPEN_SPOT.bat` | Banner lines (9 sites typical) |
| `02_RELEASE_HISTORY.md` | New section header |
| `01_OPEN_ISSUES.md` | "Current release" footer |
| HTML title | Built via `build_spot_r1_5.js` |

**Sweep command:**
```bash
grep -rn "R1\.6\.5" /path/to/SPOT/
```

Verify every hit is the new version. Any old-version hit is a sentinel that wasn't updated.

---

## Pattern 10 — Audit trail / edit logging (D-130)

User edits to a parsed RFQ are logged for audit. The pattern:

```javascript
function logEdit(field, oldValue, newValue, source) {
  editLog.push({
    timestamp: Date.now(),
    field,
    oldValue,
    newValue,
    source: source || "user-edit",
    sessionId
  });
}
```

The log is persisted with the saved estimate and shown in the audit panel. Source values:
- `"user-edit"` — direct user modification
- `"rfq-apply"` — initial parser load
- `"rate-migration"` — auto-update on rate change
- `"reset"` — full state reset

**Convention:** any user-facing input field calls `logEdit` on change. Search for `logEdit(` to find every call site.

---

## Pattern 11 — Defensive null checks on intake fields

Parser output can contain `null` for any field that was ASK or unresolved. The engine and UI must handle nulls gracefully.

**Pattern:**
```javascript
const oneUpW = pn(item.oneUpW);          // null → 0
const cust   = tab.cust || "(no customer)";   // null → placeholder string
const bg     = item.boardGrade || "200";      // null → default grade
```

**Anti-pattern:**
```javascript
const oneUpW = item.oneUpW;                  // could be null!
const result = oneUpW * 2;                   // null * 2 = 0, but later code may fail
```

Pre-fill defaults at the boundary (engine entry, panel render). Never let `null` propagate into math.

---

## Gotcha catalog

### G1 — Print finish defaults to Gloss instead of Satin
**Symptom:** finished quote shows Gloss when RFQ didn't specify.  
**Root cause:** Rule 8 / D-114 says **never default Gloss**, always Satin. Some code paths may still default Gloss.  
**Fix:** search for `"Gloss"` default values in JSX; replace with `"Satin"`.

### G2 — Quote loads but qty grid is empty
**Symptom:** saved estimate loads, but the qty pricing grid is blank.  
**Root cause:** `qtys` array is null or missing.  
**Fix:** default `qtys` to `[1000, 2500, 5000, 10000, 25000]` in `applyState` if not present.

### G3 — Multi-part shows wrong active item after add
**Symptom:** added a new item, but the main panels still show the previous item's data.  
**Root cause:** `activeItemIndex` not updated after `bomItems.push`.  
**Fix:** always `setActiveItemIndex(bomItems.length - 1)` after adding.

### G4 — Freight zone $45 not applying for Canton ZIP
**Symptom:** Canton ZIP destination shows UTS quote instead of $45 SPCOC.  
**Root cause:** SPCOC gate failed — totalWeight > 10000 or trailerFt > 24.  
**Fix:** check weight/trailer math; SPCOC only fires when **both** gates pass.

### G5 — Save Estimate fires but doesn't appear in tab list
**Symptom:** "Saved" toast appears but the tab dropdown is empty.  
**Root cause:** `wftabs` localStorage key not updated alongside `wftab{id}` key.  
**Fix:** save both atomically in the same code path.

### G6 — Initials field accepts non-SPC values
**Symptom:** estimator initials field shows "JD" instead of "SPC".  
**Root cause:** initials lock not applied. Rule 2: initials always "SPC" for AI estimates, field is blocked.  
**Fix:** verify the field has `disabled` or `readonly` when source is AI parse.

### G7 — `routeOverride` snuck into JSON
**Symptom:** quote shows a specific route regardless of inputs.  
**Root cause:** Rule 1 violated — `routeOverride` is in the JSON.  
**Fix:** the JSON loader must strip `routeOverride` on apply. Auto-route only.

### G8 — Misc charges from previous quote bleeding in
**Symptom:** loaded a saved quote, sees stripping/gluing charges that weren't in the saved data.  
**Root cause:** state merge instead of reset-first.  
**Fix:** verify `applyState` resets before applying. See Pattern 2.

### G9 — Engine drift from JSX inline ENGINE
**Symptom:** `fleet_compare.js` produces different totals than the running app.  
**Root cause:** ENGINE block in JSX and ENGINE module in `spot_engine.js` diverged.  
**Fix:** diff the two ENGINE blocks; pick the correct version and apply to both.

### G10 — Builds succeed but HTML serves stale JSX
**Symptom:** code changes don't appear in the browser after build.  
**Root cause:** browser caching the old HTML. The build wrote a new file but the browser is showing the old one.  
**Fix:** hard-refresh (Ctrl+F5). Better: add a cache-busting version param. Best: confirm the build output's SHA changed.

---

## How to add a new pattern

When you encounter a new SPOT-specific pattern worth recording:
1. Add a section here with a clear pattern name, the trap, the fix.
2. If it caused a bug, log a D-### issue with a link back to this file.
3. Update `EST_SPOT_Session_Lessons.md` if it's worth a session-level retro.

This file gets stale fast — review on every minor release.

---

**Next:** read file 22 for troubleshooting symptoms and fixes.
