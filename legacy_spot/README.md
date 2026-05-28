# SPOT R1.6.5.1 — Deployment Package for IT

**Standard Printing Company** · 1115 Cherry Ave NE, Canton OH 44704
**App version:** R1.6.5.1 (JSX) / R1.6.5 (server) · **Package built:** 2026-05-22
**Owner:** Michael Musgrave, CEO

---

## What this is

SPOT (Standard Printing Optimization Tool) is a corrugated packaging quoting/estimation web app. It runs **entirely on the user's workstation** — a small Node.js server on `localhost:3100` plus a browser UI served from that server. No external database, no inbound network ports, no cloud dependency for normal operation.

External calls (outbound only, optional):
- Anthropic API (RFQ parser) — needs an API key
- UTS freight API (truckload quotes for non-local destinations) — optional, falls back to SPCOC local zones if unconfigured
- SharePoint (customer-list refresh) — read-only pull from `\\standardprinting.sharepoint.com\sites\spcoc.com\Shared Documents\General\SPOT\customerList.csv` if available; otherwise uses the bundled CSV

---

## System requirements

| | Minimum | Notes |
|---|---|---|
| OS | Windows 10/11 | macOS/Linux work but install scripts are Windows-only |
| Node.js | 18 LTS or newer | https://nodejs.org/ — install the LTS .msi |
| Disk | ~200 MB | Including node_modules after `npm install` |
| RAM | 4 GB free | Server is small (~80 MB resident); browser uses most of it |
| Network | Outbound HTTPS | For Anthropic + optional UTS + SharePoint |
| Browser | Chrome / Edge (current) | Firefox works; IE/legacy Edge NOT supported |

---

## Installation

### One-time per workstation

1. Install **Node.js 18 LTS** from https://nodejs.org/ (use defaults).
2. Copy this entire folder to a permanent location — recommended `C:\SPOT\` or `%USERPROFILE%\SPOT\`. **Do not run from a network share.**
3. Right-click `install.bat` → **Run as administrator** is NOT required, but won't hurt.
4. The installer will:
   - Verify Node.js is on PATH
   - Run `npm install` (downloads babel + xlsx, ~50 MB)
   - Copy `.env.template` to `.env` (you can leave it blank — see "API keys" below)
   - Create a desktop shortcut named **SPOT** with the CMYK cube icon
5. Done. Double-click the desktop **SPOT** icon to launch.

Re-running `install.bat` is safe — it's idempotent. Use it after pulling a new release.

### To launch

- Double-click the desktop **SPOT** icon, OR
- Double-click `OPEN_SPOT.bat` in the install folder

The launcher:
1. Checks if the server is already running on port 3100. If yes, just opens the browser.
2. Otherwise starts the Node server in a minimized window titled "SPOT R1.6.5.1 Server".
3. Polls for the server to bind port 3100 (up to 15s), then opens the browser to `http://localhost:3100`.

Verify: browser tab title should read **"SPOT R1.6.5.1"**.

### To stop

Find the **"SPOT R1.6.5.1 Server"** window in the taskbar, click it, press `Ctrl+C` (or close with `X`).

---

## API keys

The RFQ parser (drag-and-drop a PDF quote request to auto-fill the form) needs an **Anthropic API key**. Two ways to provide it:

**Option A — `.env` file** (per-workstation, persistent):
1. Open `.env` in Notepad
2. Set `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart the SPOT server (taskbar window → Ctrl+C, then re-launch)

**Option B — paste in UI** (per-session, no file edit):
1. Launch SPOT
2. Open **Advanced Controls** → **RFQ Parser**
3. Paste key into the input field
4. Key is held in memory only — lost on browser refresh

If no key is provided, the rest of SPOT works fine; only the RFQ auto-parser is disabled.

---

## File inventory

| File | Purpose |
|---|---|
| **Install scripts** | |
| `install.bat` | One-time installer — runs `npm install`, creates desktop shortcut |
| `OPEN_SPOT.bat` | Launcher (target of the desktop shortcut) |
| `make_shortcut.vbs` | Helper VBScript that creates the desktop shortcut (handles OneDrive-redirected Desktop) |
| `spot.ico` | Desktop icon (CMYK cube) |
| `.env.template` | Template copied to `.env` on first install |
| **Runtime — server** | |
| `spot_server.js` | Node HTTP server (port 3100). Endpoints: `/` (serves the app), `/api/health`, `/api/freight`, `/customers/*`, `/archive/*`, `/est/parse-rfq`, `/est/parser-budget`, `/est/reload-key` |
| `package.json` | npm manifest |
| **Runtime — UI** | |
| `SPOT_R1.5.html` | Built app (prebuilt — IT does not need to build) |
| `spot_r1_5.jsx` | React source for the UI (for future rebuilds: `npm run build`) |
| `build_spot_r1_5.js` | Babel-based JSX→HTML build script |
| **Data** | |
| `customerList.csv` | 384-customer export from SharePoint (server reads on startup, watches for changes) |
| `customerList.xlsx` | Excel source-of-truth (kept for refresh workflow) |
| `spc_logo.png` | SPC logo (used in print-out / quote PDF rendering) |
| **Regression harness** (optional, not used at runtime) | |
| `spot_engine.js` | Headless estimating engine (used by `fleet_compare.js`) |
| `spot_runner.js` | Engine driver (used by `fleet_compare.js`) |
| `fleet_compare.js` | Compares SPOT output vs the 785-job iQuote baseline |
| `WF_Quoting_Tool_Test_Data.xlsx` | The 785-job iQuote dataset (regression input) |

---

## Server endpoints (firewall reference)

SPOT binds **only `127.0.0.1:3100`** (localhost). It does **not** accept connections from other machines on the LAN. No inbound firewall rule needed.

Outbound, optional:
- `https://api.anthropic.com` — RFQ parser
- `https://api.uts.com` (or configured UTS endpoint) — freight quotes
- SharePoint UNC paths — customer list refresh

---

## Data locations

- **Quote archive (RFQ files, structures, artwork):** `C:\SPOT_QUOTES\{year}\{Customer}_{EstNum}\` by default. Override with `SPOT_ARCHIVE_ROOT` env var.
- **Customer list cache:** `<install>\cache\customers.json` (regenerated whenever `customerList.csv` mtime changes)
- **Browser localStorage:** estimate tabs, default pricing targets, stock sheet library, ship-to history. Per-browser-profile, not synced.
- **No SQL database. No external data store.**

---

## Backup / migration

To back up or move a SPOT install:

1. Copy the **install folder** (everything in this directory)
2. Copy `C:\SPOT_QUOTES\` (the archived quotes — separate folder by default)
3. Browser localStorage: export from one machine, import on the other (in-UI controls under Advanced)

That's it. No SQL dump, no service registration.

---

## Troubleshooting

**"Node.js is not installed or not on PATH"** during install
→ Install Node.js 18 LTS from https://nodejs.org/, then close all cmd windows and re-run `install.bat`.

**Desktop shortcut has a generic .bat icon instead of the CMYK cube**
→ `spot.ico` is missing from the install folder. Confirm it's present. Re-run `install.bat`.

**Browser tab title reads "SPOT R1.5.11" or shows the old version**
→ Hard-refresh the browser (`Ctrl+Shift+R`). The browser is serving cached HTML.

**Port 3100 already in use**
→ Another service is using the port. Find it: `netstat -ano | findstr :3100` then end that PID in Task Manager. Or change the port: edit `spot_server.js` (search `3100`), update `OPEN_SPOT.bat` accordingly.

**"Customer typeahead is empty"**
→ Check `customerList.csv` is in the install folder. Server logs (taskbar window) should show `[customers] loaded N rows from <path>` on startup. If rowCount=0, the CSV is missing or malformed.

**RFQ parser returns 401 / "missing API key"**
→ Either paste the key in Advanced Controls > RFQ Parser, or set `ANTHROPIC_API_KEY` in `.env` and restart the server.

---

## Update procedure

When a new SPOT release is shipped:

1. Stop the running SPOT server (taskbar window → Ctrl+C)
2. Back up the install folder if you want a rollback
3. Copy the new files over the existing install folder (overwrite all)
4. Re-run `install.bat` (idempotent — picks up any new deps)
5. Launch SPOT, verify tab title shows the new version

Customer list and archive folder are preserved across updates (they're separate from the install folder, except `customerList.csv` which is overwritten with the bundled copy — if your live customer list has been refreshed, save it first).

---

## Contact

- App owner: **Michael Musgrave** (CEO)
- Issues during install: contact Michael directly; the app is internal-built and not under external support contract
- Source-of-truth for issue tracking lives in the dev project knowledge (not bundled in this kit)

---

## Version history (this kit)

See `VERSION_MANIFEST.txt` for the exact file SHAs and line counts shipped in this package.

**R1.6.5.1** (2026-05-03) — JSX cosmetic hotfix on top of R1.6.5: Developer-mode version badge string corrected from stale "R1.6.4" to "R1.6.5.1".

**R1.6.5** (2026-05-03) — D-146 Kraft→None canonical engine value mapping (ship-blocking parser bug fix), D-147 parse-review modal layout restructure, D-143 PK source-of-truth catch-up.

**R1.6.4.2** (2026-05-03) — D-144 preflight token heuristic calibration hotfix.

Earlier release history is maintained in the dev project knowledge.
