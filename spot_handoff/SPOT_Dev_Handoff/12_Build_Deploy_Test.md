# 12 — Build, Deploy, and Test

How to make a change to SPOT and ship it. This file covers the dev loop, the build process, the regression suite, and the release procedure.

---

## Dev environment setup

You need:
- **Node.js** (any modern LTS, 18+)
- A text editor that handles long JSX files (VS Code, Sublime, vim)
- Git for source control
- Chrome or Edge for the live app

You DO NOT need:
- Docker
- A bundler (Webpack, Vite, etc.) — the build is one Babel call
- A test runner (Jest, Mocha) — regression is `fleet_compare.js`
- A package manager beyond `npm install xlsx`

The repo layout (install folder):
```
SPOT-R1.6.5.1/
├── spot_r1_5.jsx                 (source, JSX)
├── spot_server.js                (source, server)
├── spot_engine.js                (source, headless engine)
├── spot_runner.js                (source, runner)
├── build_spot_r1_5.js            (build script)
├── fleet_compare.js              (regression)
├── customerList.csv              (customer data)
├── customerList.xlsx             (Excel mirror)
├── package.json
├── .env.template
├── install.bat
├── OPEN_SPOT.bat
├── make_shortcut.vbs
├── spc_logo.png
├── spot.ico
├── README.md
├── SPOT_R1.5.html                (built output)
└── cache/                        (auto-created)
    └── customers.json
```

---

## The build cycle

### Build the HTML

```bash
node build_spot_r1_5.js
```

This:
1. Reads `spot_r1_5.jsx`
2. Strips `import React from "react"` and `export default`
3. Runs Babel with `@babel/preset-react` and `@babel/preset-env { targets: { ie: 11 } }`
4. Inlines React and ReactDOM from a CDN
5. Wraps in an HTML template with `<title>SPOT R1.6.5.1</title>`
6. Writes `SPOT_R1.5.html`

Typical timing: 5–8 seconds. Output is ~1.18 MB single HTML file.

### Run the server

```bash
node spot_server.js
```

Server listens on `127.0.0.1:3100`. Logs to stdout. Open `http://localhost:3100` in Chrome/Edge to use the app.

### Test the change

1. Make the change in the JSX or server
2. Rebuild HTML if JSX changed: `node build_spot_r1_5.js`
3. Restart the server if it changed: `Ctrl+C` then `node spot_server.js`
4. Refresh the browser

The dev loop is ~10 seconds end-to-end for a JSX change.

---

## Version bump sweep

Every release touches a known set of version strings. Use this checklist:

**JSX (`spot_r1_5.jsx`):**
1. L62: `const __SPOT_UI_VERSION = "R1.6.5.1";`
2. L3314: Browser tab title parts (the `["SPOT R", "1.6.5.1"]` array)
3. L5436: Developer-mode badge fallback (the D-149 ternary site — `... :"R1.6.5.1"`)

**Server (`spot_server.js`):**
- The `/api/health` response version string (search for `"version"`)

**Build script (`build_spot_r1_5.js`):**
- The HTML title: `<title>SPOT R1.6.5.1</title>`

**Install kit:**
- `install.bat` banner strings (3 sites)
- `OPEN_SPOT.bat` banner strings (12 sites)
- `package.json` version

**Sweep grep pattern:**
```bash
grep -nE 'R1\.6\.[0-9](\.[0-9])?' spot_r1_5.jsx spot_server.js build_spot_r1_5.js install.bat OPEN_SPOT.bat package.json
```

Anything that doesn't match the new version is a missed site.

---

## Regression: `fleet_compare.js`

The 785-job fleet regression. Run after any engine math change.

```bash
node fleet_compare.js
```

Outputs three files:
- `fleet_results.csv` — per-job SPOT vs iQuote cost/sell
- `fleet_summary.json` — fleet stats, segment R², outlier list
- `fleet_unparseable.csv` — rows that didn't parse

### Reading the summary

```json
{
  "segment_R2_cost": 0.9690,
  "segment_R2_sell": 0.9496,
  "per_job_R2_cost": 0.8550,
  "per_job_R2_sell": 0.8360,
  "fleet_cost_delta_pct": 6.55,
  "fleet_sell_premium_pct": 8.30,
  "margin_lift_usd": 76488,
  "outliers": [
    { "row": 145, "delta_pct": 18.2, "reason": "..." },
    ...
  ]
}
```

If `segment_R2_cost` drops more than 0.005 from the baseline (0.969), the change is OOT. Investigate.

### When to run regression

- Any change to `spot_engine.js`
- Any change to the ENGINE block of `spot_r1_5.jsx`
- Any change to `RATE_DEFAULTS`, `GM_DEFAULTS`, `PRINT_SPEEDS`, etc.
- Before tagging a release

Skip regression for:
- Server-only changes
- UI-only changes (modals, layouts)
- Customer list updates
- Documentation

---

## Test cases

Test cases live in `TEST_SPOT_R1_5_Testing_Guide.md` and `TEST_SPOT_R1_5_Chowder_Specs.md`. The Chowder suite is the formal regression — six representative job specs with expected costs.

When you ship a change:
1. Run Chowder against the live UI (or runner)
2. Compare actual vs expected
3. Log PASS/FAIL for each
4. Append the test run to release history if it's a release ship

Test cases are numbered TC-D### or TC-### for general test cases tied to design decisions.

---

## Release procedure

A SPOT release goes through these steps in order:

### 1. Pre-flight audit (SHA ritual)

At session start (before any code change):
- Compute SHA-16 prefix for every source file
- Compare to `02_RELEASE_HISTORY.md` recorded SHAs
- If anything has drifted, stop and reconcile

### 2. Code the change

Edit the relevant source files. Follow the conventions in earlier files of this handoff.

### 3. Update ledgers

- Add to `01_OPEN_ISSUES.md` if it's a new defect or feature being closed in this ship
- Don't close it until ship is complete

### 4. Build

```bash
node build_spot_r1_5.js
```

### 5. Run regression (if engine changed)

```bash
node fleet_compare.js
```

Verify R² hasn't drifted.

### 6. Manual verification

Open the live UI, run through the standard happy path:
- Create a new estimate
- Fill customer, dims, board, qtys
- Verify Economics panel shows reasonable values
- Save the estimate
- Reload and verify the estimate restores correctly
- Generate Preview Quote PDF

If you changed something specific, verify that specifically.

### 7. Compute final SHAs

```bash
for f in spot_r1_5.jsx spot_server.js spot_engine.js spot_runner.js build_spot_r1_5.js; do
  echo "$f: $(sha256sum $f | cut -c1-16) ($(wc -l < $f) lines)"
done
```

### 8. Update version strings

Run the version-bump sweep (above).

### 9. Append to `02_RELEASE_HISTORY.md`

Entry format (model on last entry):
```
## R1.6.5.1 (2026-05-22) — Cosmetic hotfix on R1.6.5

**Closed:**
- D-149 Developer mode badge emitted stale R1.6.5 string

**Files changed:**
- spot_r1_5.jsx (L5436): ternary fallback, R1.6.5 → R1.6.5.1
- build_spot_r1_5.js: HTML title
- package.json: 1.6.5 → 1.6.5.1

**SHAs (post-deploy):**
- spot_r1_5.jsx: 0c66da0efdd2acbf, 9007 lines
- spot_server.js: cfd2ded86ea3994f, 2619 lines (UNCHANGED from R1.6.5)
- spot_engine.js: 5ff7594d031a62e1, 1131 lines (UNCHANGED)
- spot_runner.js: 8001c3a2d87dea88, 358 lines (UNCHANGED)
- build_spot_r1_5.js: 9d37f6b08d284641, 60 lines
- SPOT_R1.5.html: 22473ac8fe159608, 25034 lines

**Regression:** N/A (no math changes)
```

### 10. Close issues

In `01_OPEN_ISSUES.md`, move the closed D-### from Open to Closed section. Don't delete the open entry — strike it through and add a Closed: line with the release tag.

### 11. Build install kit

If shipping to Michael's workstation, build the deploy zip:

```
SPOT_R1.6.5.1_Deploy.zip
├── install.bat
├── OPEN_SPOT.bat
├── make_shortcut.vbs
├── .env.template
├── spot_r1_5.jsx
├── spot_server.js
├── spot_engine.js
├── spot_runner.js
├── build_spot_r1_5.js
├── fleet_compare.js
├── package.json
├── customerList.csv
├── customerList.xlsx
├── spc_logo.png
├── spot.ico
├── README.md
├── SPOT_R1.5.html  (pre-built)
└── VERSION_MANIFEST.txt
```

### 12. Hand off

Send the zip + the release-history entry. Michael's IT installs.

---

## Common build failures

| Symptom | Cause | Fix |
|---|---|---|
| Babel parse error at line N | Syntax error in JSX | Check the line; usually mismatched braces |
| Build outputs < 1 MB | Reading wrong file or truncating | Verify input path; check for early `return` in build script |
| Browser shows blank page | React mount failed; check console | Usually means a transpile error escaped or import is missing |
| Server fails to start | Port 3100 in use | `netstat -ano | findstr :3100`; kill the holder |
| Regression R² drops > 0.005 | Calibration drift | Investigate; don't ship until OOT items are diagnosed |
| Customer typeahead empty | CSV missing or unparseable | Check `cache/customers.json` rowCount |

---

## Hot tips

- **Don't edit `SPOT_R1.5.html` directly.** It's a generated file. Always rebuild.
- **Don't hand-edit version strings in only one site.** Use the sweep.
- **Don't ship without a regression run** when engine math changed. The 30 seconds saves a customer-facing pricing bug.
- **Don't merge to main without updating ledgers.** Future you needs to trace the change.
- **Don't deploy without verifying the install kit contents.** Missing `customerList.csv` is a known recurring miss.

---

## Where to look next

- For specific D-### history: `14_Release_History_Summary.md`
- For open work: `15_Open_Work_Roadmap.md`
- For issue conventions: `13_Issue_Tracking_Conventions.md`
