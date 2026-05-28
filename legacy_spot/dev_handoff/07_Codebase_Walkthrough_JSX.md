# 07 — Codebase Walkthrough: `spot_r1_5.jsx`

This is a section-by-section navigation guide to the 9,007-line JSX. Use this file to find what you're looking for. Line numbers are approximate (R1.6.5.1) and drift slightly between releases — anchor on the comment dividers (`═══`), not line numbers.

---

## Top-level structure

```
1–80     Header & version constants
82       SPC_LOGO_B64 (large base64 string)
84–155   ENGINE - pricing math (mirror of spot_engine.js)
157–168  SHEET_GROUPS - stock sheet library (216 entries)
169–240  Engine constants (RATE_DEFAULTS, GM_MSF_TIERS, route limits)
241–340  Engine functions (calcBoard, computeLayout, selectSheet)
340–877  More engine (route comparison, glue, freight markup)
878–7494 UI components - the React App() function
7494–9007 UI continued (modals, popups, harness instrumentation)
```

The dividing line at L877/878 is significant: above is engine math, below is React UI. The engine block here is a mirror of `spot_engine.js`. **When you change one, change the other.**

---

## Section 1: Header (L1–80)

Comment block with version history, change log, and the `__SPOT_UI_VERSION` constant.

Key constants at top:
```javascript
// L62  (live-emit site 1)
const __SPOT_UI_VERSION = "R1.6.5.1";
```

This single line is what `window.__SPOT_UI_VERSION` exposes. Changes here are immediately visible. The audit ritual checks this matches the release-history entry.

**Header version sites to bump when shipping:**
- L62: `__SPOT_UI_VERSION` constant
- L3314: browser tab title parts array
- L5436: Developer-mode badge fallback (the D-149 miss site)

The version-bump sweep grep pattern that catches all three: `R1\.6\.[0-9]` with the ternary-literal pattern `:"R1\.6\.[0-9]"` and `?"R1\.6\.[0-9]"`.

---

## Section 2: SPC_LOGO_B64 (L82)

A single line that's ~150 KB of base64-encoded SPC logo PNG. Used for the in-app branding and the Preview Quote PDF. **Don't touch this line.** If the logo needs updating, regenerate from the source PNG via:

```bash
base64 -w 0 spc_logo.png | head -c 200000 > logo_b64.txt
```

Then paste into the L82 string literal.

---

## Section 3: ENGINE block (L84–155)

The same `ENGINE` object that lives in `spot_engine.js`. Mirrors:
- `base_matrix` — board prices by grade × wall × MSF tier (post +10% paper uplift)
- `flute_rules` — per-flute MSF interpolation rules
- `liner_upgrades` — liner-cost adders by liner name
- `medium_upgrades` — medium-cost adders
- `allowed_board_grades` — which grades are legal for which flutes
- `dim_adders` — dimensional cost adders for big or small blanks
- `fixed_charges` — under5MsfFee, fscFee, etc

When you edit `base_matrix` or any of these here, you MUST also edit `spot_engine.js` to match. The D-104 audit closed the runner-vs-JSX parity concern; the convention is: source-of-truth lives in JSX for UI quotes, in `spot_engine.js` for headless regression. They must stay in sync.

---

## Section 4: SHEET_GROUPS (L157–168)

The 216-entry stock-sheet library, stored as a JSON array literal. Each entry:
```javascript
{ g: "200", f: "B", ol: "42# Kemi-Lite", il: "42# Kemi-Lite", md: "None", sizes: [[60,120], [63,126], ...] }
```

- `g` — grade ("200", "250", "ECT 44", etc.)
- `f` — flute ("B", "C", "E", "BC", "EB")
- `ol` — outside liner
- `il` — inside liner
- `md` — medium
- `sizes` — array of `[width, length]` tuples

Sheet selection (`selectSheet()`) iterates this list, filters by grade/flute/liner match, then picks the size with highest N-out. Estimators can add custom sheets to a localStorage layer (`wf_stock_sheets`) which extends this array at runtime.

---

## Section 5: Engine constants (L169–240)

The calibrated business numbers. All covered in `04_Control_Tables_Reference.md`:
- `FLUTE_CALIPERS`
- `PRINT_SPEEDS`
- `CAD_SETUP`, `CAD_FALLBACK`, `STRIP_DEFAULTS`, `GLUE_DEFAULTS`
- `CAD_DIFF_MIGRATION`, `STRIP_DIFF_MIGRATION` (D-106 rename)
- `SPOT_SCHEMA_VERSION` (currently 2)
- `GM_MSF_TIERS`, `GM_DEFAULTS`, `SELL_DEFAULTS`
- `GRADE_ADDER_DEFAULTS`
- `CREST_MAX_W`, `CREST_MAX_L`
- `BOBST_MIN_W/L`, `BOBST_MAX_W/L`, `BOBST_FLUTES`, `isBobstEligible()`
- `RATE_DEFAULTS` (the central per-rate object)

---

## Section 6: Engine functions (L241–877)

The pricing functions. Key ones:

### `calcBoard(bi, qty, isStock)`
Returns `{ totalCost, breakdown }` for the board portion of a quote at a given quantity. Handles liner upgrades, FSC fee, paper uplift (already baked into base_matrix).

### `computeLayout(oneUpW, oneUpL, sheetW, sheetL)`
Calculates N-out — how many blanks fit on a sheet, considering rotation. Returns `{ nOut, orientation }`.

### `selectSheet(boardSpec, oneUpW, oneUpL)`
Picks the best stock sheet from SHEET_GROUPS for the given board spec and blank dims. Returns `{ sheet, nOut, isStock }` or `null` if no stock sheet fits.

### `getGmMsfTier(msf)`, `getMsfTier(msf)`
MSF-to-tier lookup. Two functions because the GM curve and the engine's MSF interpolation have different tier definitions (the first is the GM_MSF_TIERS structure; the second is engine.msf_tiers).

### `getGradeFallback(grade)`
Returns the Mullen-equivalent grade for an ECT grade (or null if not an ECT).

### `getMediumFallback(requestedMedium, availableMediums)`
Substitutes a medium when the requested one isn't available. Bleached medium never falls back to non-bleached.

### `autoRoute(state)`, `compareRoutes(state)`
Top-level route selection. Returns the cheapest viable route given the current quote state.

### `selectBobstSheet(boardSpec, oneUpW, oneUpL)` (D-123)
Bobst-specific sheet selection. Tries Bobst envelope-eligible sheets per-route rather than running global sheet selection first.

---

## Section 7: The React `App()` function (L878 onward)

The single component that wraps the entire UI. Pattern is:

```javascript
function App() {
  // ~80 useState calls
  const [custName, setCustName] = useState("");
  const [flute, setFlute] = useState("B");
  // ...

  // Various useMemo and useCallback
  const economics = useMemo(() => calcEconomics(state), [/* deps */]);

  // Effect hooks
  useEffect(() => { /* tab persistence */ }, [/* deps */]);

  // Handlers
  const handleSave = useCallback(() => { /* ... */ }, [/* deps */]);

  // Render
  return (
    <div className="spot-app">
      <Toolbar ... />
      <TabBar ... />
      <LeftPanel ... />
      <BomStrip ... />
      <RightPanel ... />
      <Modals ... />
    </div>
  );
}
```

The component is enormous because it owns all top-level state. Refactoring into modules is on the backlog (R1.7+).

### Where to find specific UI features

| Feature | Approximate location | Anchor string to grep |
|---|---|---|
| Toolbar buttons | L~1200 | `"#btn-new"` or `"Save Estimate"` |
| Customer typeahead | L~1500 | `"cust-name"` |
| Dim/board inputs | L~2000 | `"#dim-l"` |
| Print/finish inputs | L~2400 | `"#print-finish"` |
| Ops modals | L~2800 | `"Die Configuration"` |
| BOM strip | L~3200 | `"#spot-bom"` |
| Route Comparison panel | L~3800 | `"Route Comparison"` |
| Economics panel | L~4200 | `"Economics"` |
| Quote Header modal | L~4600 | `"Quote Header"` |
| Cost Report modal | L~5000 | `"Cost Report"` |
| BOM Builder modal | L~5400 | `"BOM Builder"` |
| Sheet Library modal | L~5800 | `"Sheet Library"` |
| Freight Dashboard | L~6200 | `"Freight Dashboard"` |
| Preview Quote modal | L~6800 | `"Preview Quote"` |
| Archive drop zone | L~7100 | `"archiveFolderName"` |
| Warning popups | L~1167–7077 | `"alert("` or `"confirm("` |

These anchors are stable because they're either DOM ids, labels, or function names that aren't likely to be renamed without a corresponding ledger entry.

---

## State management patterns

### `applyState(loadedJson)` — full quote load
Located around L~3000. Hands-off rules:
1. Always reset every state variable to its default FIRST
2. Then apply loaded fields ON TOP
3. Never merge

Three closed defects (D-080, D-087, D-098) traced to merge-vs-reset bugs. When you touch this function, preserve reset-first.

### `applyItemState(bomItem)` — single BOM item load
Located around L~3200. Same rules, scoped to a single item.

### `gatherState()` — save current state
Located around L~3400. Reads every state variable into a JSON object. The output of this function is what gets written to localStorage and what's shown in Preview Quote / Cost Report.

### Rate migration block (in `applyState`)
Sub-block that runs before applying loaded fields. Snaps any rate field in the loaded JSON to the current `RATE_DEFAULTS` value. Fires the amber rate-migration toast (popup #3) if any field migrated.

---

## The 44 warning popups

The JSX has 44 cataloged warning popups across L~1167–7077. Each has:
- A trigger condition
- A color (amber = info, red = block, green = success)
- Buttons (usually OK/Cancel, some Retry/Save/Discard)

The most-frequently-hit (full list in `EST_SPOT_UI_Map.md`):

| # | Trigger | Color | Buttons |
|---|---|---|---|
| 3 | Load — rate migration fired | Amber | OK |
| 7 | ECT 44 selected/loaded | Amber | OK/Cancel |
| 11 | Crest → die auto-default first fire | Amber | OK |
| 14 | Piece exceeds Crest 60×120 | Red | OK |
| 19 | Save without customer/partNumber | Red | OK |
| 23 | Freight: no Manufactured items | Red | OK |
| 31 | Stock sheet selected — bypassing Buy Min | Amber | OK |
| 38 | FSC $15→$25 migration fired | Amber | OK |
| 41 | Forced route — Reset to Auto click | Amber | OK |
| 44 | Unsaved changes on tab close | Red | Save/Discard/Cancel |

Full catalog can be reconstructed with `grep alert\|confirm spot_r1_5.jsx`.

---

## The `useMemo` TDZ trap

Anywhere you see a `useMemo` in the App component, scan its captured variables. If any of them are declared with `const` *below* the `useMemo`, Babel's IE11 target will hoist the declaration as `var` and the memo will see `undefined` on first render.

D-107 and D-108 are both this bug. The fix is to hoist the `const` declarations above the `useMemo`.

When you write a new `useMemo`, declare all its inputs first.

---

## Build pipeline integration points

The build script `build_spot_r1_5.js`:
1. Reads `spot_r1_5.jsx` (after R1.6.5.1 — was `spot_r1.5.jsx` before)
2. Strips the React import line and `export default`
3. Runs Babel with `@babel/preset-react` and `@babel/preset-env { targets: { ie: '11' } }`
4. Wraps in HTML template with React/ReactDOM CDN
5. Writes `SPOT_R1.5.html`

The HTML wrapper has a hardcoded `<title>SPOT R1.6.5.1</title>` that shows briefly before the JSX hydrates and overrides via L3314.

The JSX entry point at the end of the file is:
```javascript
// At the bottom of the JSX
export default function App() { /* ... */ }
```

This export is stripped by the build script. The build then appends:
```javascript
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
```

---

## Common edit patterns

### Adding a new rate to RATE_DEFAULTS

1. Add the key + default value in `RATE_DEFAULTS` (~L222)
2. Add a UI tile in Advanced Controls (~L4500 area, search for similar tiles)
3. Add the rate-migration line in `applyState()` (~L3000)
4. Update `04_Control_Tables_Reference.md`

### Adding a new flute

1. Add to `FLUTE_CALIPERS`
2. Add to `flute_rules` in ENGINE
3. Add SHEET_GROUPS entries for the new flute
4. Update `03_Business_Domain.md` and `04_Control_Tables_Reference.md`
5. Add UI option in `#board-flute`

### Adding a new warning popup

1. Find a similar popup (grep `alert\|confirm`)
2. Add the trigger logic
3. Add the popup body
4. Catalog in `EST_SPOT_UI_Map.md` warnings table
5. Update test cases in `TEST_SPOT_R1_5_UI_Test_Suite.md`

### Bumping a version

1. Update L62 `__SPOT_UI_VERSION`
2. Update L3314 browser tab title array
3. Update L5436 Developer-mode badge fallback (the D-149 site)
4. Update package.json version
5. Update install.bat/OPEN_SPOT.bat banner strings (12 sites)
6. Update build_spot_r1_5.js HTML title
7. Update server's /api/health response if shipping a server change too
8. Rebuild HTML
9. Update release history

Every site verified via the bump-sweep grep pattern.

---

## When the JSX won't compile

Most common failure modes:
- **Trailing brace mismatch** — JSX is sensitive; the build prints the error line. Often a stray closing tag.
- **Missing `key` prop** — React warning, not a build failure, but ugly in console
- **TDZ** — runtime undefined, not a compile failure. See above.
- **Babel preset incompatibility** — only if you've upgraded Babel; pin versions

The build prints `Read N chars` and `Transpiled to M chars`. If N or M is far smaller than expected (~890K read, ~1.18M transpiled), the build is reading the wrong file or losing content.
