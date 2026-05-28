# D-120 — Drop Zone + Per-Quote File Vault (Phase 1 Scaffolding)

**Status:** DESIGNED · Phase 1 scaffolding (drop UI + archive write); parser deferred to Phase 1B once API key in hand
**Date:** 2026-04-26
**Affects:** `spot_r1_5.jsx`, `spot_server.js`, NEW `DEV_drop_archive.js`
**Depends on:** D-118 (customer record, for {Customer} folder name)
**Predecessor design notes:** `DEV_R1_6_Design_Backlog.md` SESSION 2026-04-25 "Drop-zone parser + archive — answers + SCOPE EXPANSION"

---

## 1. What This Ships

A **per-quote file vault** in SPOT. The estimator drops files into a panel; SPOT writes them to a per-quote folder under a configurable archive root, indexes them in a `meta.json` manifest, and renders inline previews for common file types. RFQ parsing via Anthropic API is **deferred** until the API key is provisioned (Phase 1B).

### Phase 1 (this ship — no Anthropic API dependency)
- Drop UI in left panel, anchored beneath the lowest visible control
- Multi-file drop with executable denylist
- Per-quote folder auto-create on first drop: `{ARCHIVE_ROOT}/{YYYY}/{Customer}_{EstNum}/`
- Inline preview pane with Tier 1 viewers (PDF, image, plain text, CSV/XLSX, DOCX)
- Manifest tracking in `meta.json`
- Server endpoints: upload, list, fetch, delete

### Phase 1B (next — adds parser, no UI changes)
- `POST /est/parse-rfq` calls Anthropic API with bundled EST_* docs as system prompt
- Confidence modal for missing fields, graceful failure → manual entry
- Toggle in Advanced Controls to disable parser per-session if Anthropic API budget hit

### Phase 2 (deferred)
- SharePoint sync of `\home\claude\SPOT_QUOTES\` → `https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/`
- Retrieval/browse UI ("Find past quotes for {customer}")
- Load past `intake.json` back into SPOT for re-quoting
- Side-by-side compare current vs prior

---

## 2. Locked-In Decisions (from 2026-04-25 design pass + 2026-04-26 placement)

| ID | Decision | Source |
|----|----------|--------|
| Q10 | New Anthropic API account, $500/mo cap | `DEV_R1_6_Design_Backlog.md` |
| Q11 | Default API confidentiality posture acceptable; revisit if NDA requires ZDR | `DEV_R1_6_Design_Backlog.md` |
| Q12 | Final SharePoint root: `https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/` (deferred to Phase 2) | `DEV_R1_6_Design_Backlog.md` |
| Q12-P1 | **Phase 1 staging root: `/home/claude/SPOT_QUOTES/`** (local; Phase 2 syncs to SharePoint) | This session |
| Q13 | Folder naming: `{Customer}_{EstNumber}`, illegal chars → `_`, customer trimmed ~30 chars | `DEV_R1_6_Design_Backlog.md` |
| Q14 | Retention: keep forever, no auto-delete/archive | `DEV_R1_6_Design_Backlog.md` |
| Q15 | Accept all except executable denylist; multi-file drop | `DEV_R1_6_Design_Backlog.md` |
| Q16 | Failure modes: confidence modal + graceful API-down fallback | `DEV_R1_6_Design_Backlog.md` |
| UI | Drop zone is a `<Sec>` panel beneath the last left-panel control | This session |
| UI | Includes inline preview pane | This session |
| Trigger | Folder created on first file drop (atomic with file write) | This session |

---

## 3. UI Placement (locked)

The drop zone is a new `<Sec label="Files" ...>` collapsible section in the left panel. Placement order in the left panel:

```
... existing sections ...
<Sec label="Pricing Strategy">                     // existing, L5422
{!estimatorMode && <React.Fragment>
  <Sec label="Advanced Controls">                  // existing, L5547
  </Sec>
</React.Fragment>}
<Sec label="Files">                                // NEW — D-120
</Sec>
```

**Why this satisfies the anchor rule:** The Files section sits after the Advanced Controls fragment. When `estimatorMode` is true, Advanced Controls is hidden (the fragment renders nothing), so Files visually anchors directly beneath Pricing Strategy. When `estimatorMode` is false, Advanced Controls renders and Files anchors beneath it. No conditional logic in the Files section itself — the order in the JSX naturally produces the correct anchor.

### Files section layout (collapsed by default)

```
┌─ Files ─────────────────────────────────── ▾ ─┐
│  [⤓ Drop files here, or click to browse]      │
│                                                │
│  Files in this quote:                          │
│  ─ rfq.pdf            12 KB    [view] [×]    │
│  ─ structure.dxf      45 KB    [view] [×]    │
│  ─ artwork.ai         3.2 MB   [view] [×]    │
│                                                │
│  Folder: Skybox_SPC-260426-001 (3 files)       │
│  [📂 Open folder]                              │
└────────────────────────────────────────────────┘
```

When the user clicks `[view]` on any row, the **preview pane** opens as a **modal overlay** (right-side drawer, ~60% screen width). Modal is preferable to inline within Files section because Files lives in the constrained left panel; previews need real estate.

### Preview tier coverage (Phase 1)

| Type | Renderer | Source |
|------|----------|--------|
| `.pdf` | PDF.js (CDN) | Already loadable in Babel runtime |
| `.png .jpg .jpeg .gif .webp` | Native `<img>` | Browser native |
| `.txt .json .csv .md .log` | `<pre>` with monospace, syntax-light | Native |
| `.xlsx .xls` | SheetJS → HTML table | Already in artifact env stack |
| `.docx` | mammoth.js → HTML | Lib loadable |
| `.eml .msg` | Header table + body extracted | Phase 1B add |
| `.dxf .psd .eps .ard .cf2` | "Download to view" placeholder | Tier 2 (Phase 1B) |
| `.ai` (modern, CS2+) | PDF.js (.ai is internally PDF) | Phase 1B add |

Phase 1 ships PDF + image + text + spreadsheet + Word. That covers every RFQ type and the vast majority of estimator preview needs. DXF/PSD/EPS/AI defer to Phase 1B.

---

## 4. Folder Structure

### Phase 1 staging root

```
/home/claude/SPOT_QUOTES/
  2026/
    Skybox_SPC-260426-001/
      rfq_original.pdf
      meta.json
      structure.dxf
      artwork.ai
    PCA_SPC-260426-002/
      ...
  2027/
    ...
```

### `meta.json` schema (per-quote)

```json
{
  "estNum": "SPC-260426-001",
  "custName": "Skybox Packaging",
  "custCode": "SKYBOX",
  "folderName": "Skybox_SPC-260426-001",
  "createdAt": "2026-04-26T14:32:18.412Z",
  "updatedAt": "2026-04-26T14:51:09.882Z",
  "files": [
    {
      "filename": "rfq_original.pdf",
      "originalName": "PO 47309.pdf",
      "size": 12041,
      "mime": "application/pdf",
      "class": "rfq",
      "uploadedAt": "2026-04-26T14:32:18.412Z",
      "sha256": "abc123..."
    },
    {
      "filename": "structure.dxf",
      "originalName": "MTD-645-90620.dxf",
      "size": 45120,
      "mime": "application/dxf",
      "class": "asset",
      "uploadedAt": "2026-04-26T14:33:42.001Z",
      "sha256": "def456..."
    }
  ],
  "phase1": true,
  "parserStatus": "deferred",
  "syncStatus": "local-only"
}
```

`phase1: true` and `syncStatus: "local-only"` flag this folder for the future Phase 2 SharePoint sync sweep — the sync job will pick up any folder where `syncStatus !== "synced"`.

### Folder name normalization

```javascript
function folderName(custName, estNum) {
  // 1. Replace illegal Windows chars with _
  let safe = String(custName || "Customer").replace(/[\/\\:*?"<>|]/g, "_");
  // 2. Collapse multiple _ to single _
  safe = safe.replace(/_+/g, "_").replace(/^_|_$/g, "");
  // 3. Trim to 30 chars
  if (safe.length > 30) safe = safe.substring(0, 30).replace(/_+$/, "");
  // 4. Empty fallback
  if (!safe) safe = "Customer";
  return safe + "_" + estNum;
}
```

Examples:
- `"Skybox Packaging"` + `SPC-260426-001` → `Skybox Packaging_SPC-260426-001`
- `"PCA / New Oxford"` + `SPC-260426-002` → `PCA _ New Oxford_SPC-260426-002`
- `"International Paper Container Division"` + `SPC-260426-003` → `International Paper Container D_SPC-260426-003`

### Filename normalization

Original filename preserved in `meta.files[].originalName`. Disk filename normalized to:
- Lowercase extension
- Spaces → `_`
- Strip path components if browser sends them
- Collision: append `_2`, `_3`, etc. before extension

The `rfq_original.pdf` convention only applies to the FIRST RFQ-class file dropped per folder (Phase 1B convenience for the parser). All subsequent files keep their normalized originals.

---

## 5. Server Changes (`spot_server.js`)

### New constants

```javascript
const ARCHIVE_ROOT = process.env.SPOT_ARCHIVE_ROOT || "/home/claude/SPOT_QUOTES";
const EXEC_DENYLIST = new Set([".exe",".bat",".cmd",".msi",".com",".scr",".ps1"]);
const RFQ_CLASS_EXTS = new Set([".pdf",".png",".jpg",".jpeg",".gif",".webp",".eml",".msg",".docx",".xlsx",".xls"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;  // 50 MB per file
const MAX_FILES_PER_DROP = 20;
```

### New endpoints

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/archive/upload` | multipart: `estNum`, `custName`, `custCode?`, files | `{folder, files:[{filename,size,sha256,...}]}` |
| `GET` | `/archive/list?folder={folderName}` | — | `meta.json` contents |
| `GET` | `/archive/file?folder={folderName}&filename={filename}` | — | file bytes (Content-Type from extension) |
| `DELETE` | `/archive/file?folder={folderName}&filename={filename}` | — | `{ok:true}` |
| `GET` | `/archive/health` | — | `{root, exists, writable, folderCount}` |

### Upload handler logic

1. Parse multipart body (use built-in `Buffer` chunking — no `formidable` dep; small server, manual parser like CSV)
2. Validate `estNum` matches `/^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$/`
3. Compute `folderName` from `custName` + `estNum`
4. `mkdirSync({ARCHIVE_ROOT}/{YYYY}/{folderName}, {recursive:true})`
5. Read `meta.json` if exists, else seed new
6. For each uploaded file:
   - Reject if extension in `EXEC_DENYLIST` or size > `MAX_FILE_BYTES`
   - Compute disk filename (normalize + collision-suffix)
   - Compute SHA-256
   - Write to disk
   - Append entry to `meta.files[]`
7. Update `meta.updatedAt`, write `meta.json`
8. Return summary

### Delete handler logic

1. Verify folder + filename exist
2. Unlink file
3. Remove entry from `meta.files[]`, write `meta.json`
4. Folder is NOT removed even if last file deleted (folder is the per-quote anchor; meta stays)

### Filesystem layout for Phase 2 sync

When SharePoint sync arrives in Phase 2, it walks `/home/claude/SPOT_QUOTES/`, copies any folder where `meta.syncStatus !== "synced"` to the SharePoint root, and updates `meta.syncStatus = "synced"`. No folder structure changes between Phase 1 and Phase 2 — Phase 1's local layout IS the Phase 2 SharePoint layout.

---

## 6. JSX Changes (`spot_r1_5.jsx`)

### New state

```javascript
const [archiveFiles, setArchiveFiles] = useState([]);   // meta.files[] from server
const [archiveLoading, setArchiveLoading] = useState(false);
const [archiveDragOver, setArchiveDragOver] = useState(false);
const [previewFile, setPreviewFile] = useState(null);   // {filename, mime} or null
const [archiveError, setArchiveError] = useState("");
```

### New refs

```javascript
const archiveFileInputRef = React.useRef(null);
```

### New section in left panel (after Advanced Controls fragment, before any closing tags)

```jsx
<Sec label="Files" open={sec.files} onToggle={()=>tog("files")} t={t} hue="#06b6d4" secKey="files">
  {/* drop zone */}
  <div
    onDragOver={e=>{e.preventDefault();setArchiveDragOver(true);}}
    onDragLeave={()=>setArchiveDragOver(false)}
    onDrop={handleArchiveDrop}
    onClick={()=>archiveFileInputRef.current?.click()}
    style={{
      border:`2px dashed ${archiveDragOver?t.accent:t.border}`,
      borderRadius:6, padding:"16px 12px", textAlign:"center",
      cursor:"pointer", background:archiveDragOver?t.accentSoft:"transparent",
      fontSize:12, color:t.text2,
      transition:"all 120ms ease"
    }}
  >
    {archiveLoading
      ? "Uploading…"
      : (custName && estNum)
        ? "⤓ Drop files here, or click to browse"
        : "Customer + Est# required before upload"}
  </div>
  <input ref={archiveFileInputRef} type="file" multiple style={{display:"none"}} onChange={handleArchiveBrowse} />

  {/* file list */}
  {archiveFiles.length > 0 && (
    <div style={{marginTop:8}}>
      {/* ... mapped rows with filename, size, view button, delete button ... */}
    </div>
  )}

  {/* status line */}
  {archiveFiles.length > 0 && (
    <div style={{fontSize:11,color:t.text3,marginTop:6}}>
      Folder: {archiveFolderName} ({archiveFiles.length} files)
    </div>
  )}

  {archiveError && <div style={{fontSize:11,color:t.err,marginTop:4}}>{archiveError}</div>}
</Sec>
```

### Key handlers

```javascript
const archiveFolderName = useMemo(() => {
  if (!custName || !estNum) return "";
  return folderNameNormalize(custName) + "_" + estNum;
}, [custName, estNum]);

const handleArchiveDrop = useCallback(async (e) => {
  e.preventDefault();
  setArchiveDragOver(false);
  const files = [...e.dataTransfer.files];
  await uploadArchiveFiles(files);
}, [...]);

const handleArchiveBrowse = useCallback(async (e) => {
  const files = [...e.target.files];
  e.target.value = "";  // reset for re-selection
  await uploadArchiveFiles(files);
}, [...]);

async function uploadArchiveFiles(files) {
  if (!custName || !estNum) {
    setArchiveError("Customer + Est# required");
    return;
  }
  if (files.length === 0) return;
  if (files.length > 20) {
    setArchiveError("Max 20 files per drop");
    return;
  }
  setArchiveLoading(true); setArchiveError("");
  try {
    const fd = new FormData();
    fd.append("estNum", estNum);
    fd.append("custName", custName);
    if (customerRecord?.code) fd.append("custCode", customerRecord.code);
    files.forEach(f => fd.append("files", f, f.name));
    const r = await fetch("http://localhost:3100/archive/upload", {method:"POST", body:fd});
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    setArchiveFiles(data.files);
    setToast(`${files.length} file(s) saved`);
  } catch (err) {
    setArchiveError("Upload failed: " + err.message);
  } finally {
    setArchiveLoading(false);
  }
}
```

### Re-fetch trigger

When `archiveFolderName` changes (customer or estNum changes), re-fetch from server:

```javascript
useEffect(() => {
  if (!archiveFolderName) { setArchiveFiles([]); return; }
  fetch(`http://localhost:3100/archive/list?folder=${encodeURIComponent(archiveFolderName)}`)
    .then(r => r.ok ? r.json() : {files:[]})
    .then(data => setArchiveFiles(data.files || []))
    .catch(() => setArchiveFiles([]));
}, [archiveFolderName]);
```

### Preview modal

Standard modal overlay pattern matching existing modals (Quote Header / Cost Report). Renders the appropriate viewer for the `previewFile.mime`. Outside D-120 design scope; standard pattern.

### `sec` state addition

```javascript
const [sec,setSec]=useState({...existing, files:false});  // collapsed default
```

---

## 7. Calibration Impact

None. D-120 is data-handling only. Engine math unchanged. Fleet regression unaffected.

---

## 8. Migration

No migration. Existing estimates ignore the new section until files are dropped. Phase 1 staging folder doesn't exist until first upload.

---

## 9. Out of Scope (deferred)

- Anthropic API parser (Phase 1B)
- SharePoint sync (Phase 2)
- Browse/retrieval UI for past quotes (Phase 2)
- DXF/PSD/EPS/AI inline previews (Phase 1B/2)
- Image annotation/markup
- Drag-reorder file list
- Bulk download as ZIP

---

## 10. Failure Modes

| Failure | Behavior |
|---------|----------|
| `ARCHIVE_ROOT` not writable at server start | Log warning. `/archive/upload` returns 503. Drop UI shows "Archive unavailable". |
| Disk full mid-write | File partially written → unlink + return 507. Meta.json untouched. |
| Customer or estNum empty | Drop UI greys out and shows "Customer + Est# required". Browse click does nothing. |
| File > 50 MB | Server rejects with 413, UI shows error per-file. Other files in same drop continue. |
| Executable extension | Server rejects with 415, UI shows "blocked: filename.exe". Other files continue. |
| Network failure | Toast "Upload failed", file list unchanged. User can retry. |
| Concurrent upload to same folder (multi-tab) | Last write to `meta.json` wins — stale list possible until refresh. Acceptable for Phase 1. |

---

## 11. Test Cases (TC-D120-*)

To be filed in `01_OPEN_ISSUES.md` after this ships:

- **TC-D120.1** — Drop single PDF, verify folder creation + meta.json + file write
- **TC-D120.2** — Drop multiple files (PDF + DXF + image), all archived in one folder
- **TC-D120.3** — Drop `.exe` file, verify rejected with 415, other files in batch succeed
- **TC-D120.4** — Drop 21 files, verify rejected at MAX_FILES_PER_DROP gate
- **TC-D120.5** — Customer name with `/`, verify folder name normalized
- **TC-D120.6** — Change customer mid-quote, verify Files section re-fetches and shows new (empty) folder list
- **TC-D120.7** — Delete file from list, verify disk + meta.json both updated
- **TC-D120.8** — Estimator mode toggle: verify Files panel anchors correctly under Pricing Strategy when Advanced hidden
- **TC-D120.9** — Estimator mode off: verify Files panel anchors correctly under Advanced Controls
- **TC-D120.10** — Preview modal: PDF, image, XLSX, DOCX render correctly
- **TC-D120.11** — Server start with non-existent ARCHIVE_ROOT, verify graceful 503 + UI message

---

## 12. Files Changed (forecast)

| File | Before | After (estimated) | Change |
|------|--------|-------------------|--------|
| `spot_r1_5.jsx` | L=7887 | L≈7980 | +Files Sec + handlers + preview modal stub + state |
| `spot_server.js` | L=550 | L≈760 | +archive endpoints + multipart parser + manifest IO |
| `build_spot_r1_5.js` | L=57 | unchanged | Title bumps with R1.5.7 |
| `DEV_SPOT_R1_5_Control_Tables.md` | — | +new "Archive" section | Constants table |
| `DEV_D120_Design_Decision.md` | — | NEW | This doc |
| `01_OPEN_ISSUES.md` | — | +TC-D120.* rows | 11 test cases |
| `02_RELEASE_HISTORY.md` | — | +R1.5.7 entry | Ship log |

Engine, runner, fleet_compare unchanged.

---

## 13. Pre-Phase-1B Checklist (when API key arrives)

1. Provision Anthropic API account at console.anthropic.com (SPC company email + card, $500/mo cap)
2. Drop key into `.env` on SPOT host as `ANTHROPIC_API_KEY`
3. Phase 1B adds `POST /est/parse-rfq` — calls Anthropic Messages API with bundled `EST_*.md` as system prompt
4. JSX adds Parser button on RFQ-class file rows: "Parse with Claude"
5. Confidence-modal pattern: returns `{json, asks:[...], confidence}`; if asks present, modal asks; on confirm, `__SPOT_LOAD_JSON(json)`
6. Settings toggle in Advanced Controls: "Enable Claude RFQ parser" (per-host setting, defaults on)

---

## 14. Phase 2 Sync Plan (preview)

A scheduled cron job on the SPOT host runs nightly:

```
1. Walk /home/claude/SPOT_QUOTES/
2. For each folder where meta.syncStatus !== "synced":
   - rclone copy to https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/
   - On success: write meta.syncStatus = "synced", meta.syncedAt = ISO timestamp
   - On failure: write meta.syncStatus = "error", meta.syncError = message
3. Log summary
```

Auth path: rclone with SharePoint OAuth (interactive setup once on the SPOT host).
Phase 2 design doc will be a separate D-### when scheduled.

---

## END OF D-120 DESIGN
