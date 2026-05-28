# D-127 — Paperclip Badge on Load Estimate Modal

**Status:** SHIPPED in R1.5.7.2 · 2026-04-27
**Affects:** `spot_server.js` (new endpoint), `spot_r1_5.jsx` (Load modal table)
**Depends on:** D-120 Phase 1 (drop-zone archive must exist)

---

## What This Ships

When the estimator opens the Load Estimate modal, each saved estimate's row shows a **📎 paperclip icon** in a new "Files" column if that estimate has files in the drop-zone archive. Hovering the icon shows a tooltip "Files attached — open estimate to view."

## Why

D-120 Phase 1 stages files server-side per quote folder. The Load modal reads from `localStorage` (`wftabest{timestamp}` keys). The two systems didn't talk — so an estimator scrolling the load list had no signal that an estimate had RFQs/specs attached. They had to load each estimate individually to find out.

## How

### Server: `GET /archive/folders`

New bulk endpoint. Walks current year + previous year archive subdirectories and returns every folder that:
1. Has a `meta.json` on disk
2. Has at least one entry in `meta.files[]` (filters out empty/aborted-upload folders)

Response:
```json
{
  "folders": [
    {"folder": "PCA - Ashland_MEM-260426-211143", "year": "2026", "fileCount": 3},
    ...
  ],
  "count": 1
}
```

Single endpoint avoids the modal firing 50+ individual `/archive/list` calls when the user has many saved estimates.

### JSX: `archiveFolderSet` state + table column

- New state `archiveFolderSet` (Set<string> of folder names with files).
- `useEffect` fires on `showLoadModal === true`, calls `/archive/folders`, builds the Set.
- Load modal table header gets a "📎" column between "Est #" and "Customer".
- For each row, compute `archiveNormalizeCustomer(custName) + "_" + estNum` and check membership in `archiveFolderSet`. If hit → render 📎 in the cell.

## Smoke Test

End-to-end verified during R1.5.7.2 ship:
- Folder with files → row shows 📎 ✓
- Folder seeded with `meta.json` but `files: []` → no badge (empty-folder filter works) ✓
- Folder with no `meta.json` → no badge ✓

## Notes

- The endpoint scopes to current + previous year by default. `?year=YYYY` overrides for older archives. Phase 2 will add a year picker UI; for now this covers ~99% of working estimates.
- The match is exact: `{normalizedCustName}_{estNum}`. If a customer is renamed after files were uploaded, the badge won't link to the orphaned folder. Acceptable for Phase 1 — Phase 2 will add a folder-rename helper.
