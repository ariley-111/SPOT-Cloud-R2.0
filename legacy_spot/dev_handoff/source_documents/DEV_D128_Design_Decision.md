# D-128 — `preserveEstNum` Flag on Load to Survive Archive Folder Linkage

**Status:** SHIPPED in R1.5.7.2 · 2026-04-27
**Affects:** `spot_r1_5.jsx` (`loadEstimateFromData` + Load modal click handler)
**Triggered by:** Smoke-test discovery during R1.5.7.2 build that loading an archived estimate disconnected its files

---

## What Was Wrong

The D-120 archive folder is keyed by `{normalizedCustName}_{estNum}`. The paperclip badge in the Load Estimate modal (D-127) showed which estimates had files. But clicking a paperclip-badged row to load the estimate caused the Files panel to render empty — even though the folder existed on disk with real files.

Root cause: `loadEstimateFromData()` calls D-112's duplicate-est# guard, which uses `isEstNumInUse()` against the active tab. Because the user is loading the estimate INTO the same tab where it's currently being viewed (or another tab where it had been opened), the est# tested as "in use" and a fresh est# was generated. The new est# changed `archiveFolderName`, which pointed at a folder that doesn't exist on disk, so the file list came back empty.

So even when files existed, loading the estimate orphaned them.

## What Shipped

`loadEstimateFromData` accepts an `opts` parameter with a `preserveEstNum: boolean` flag. The Load modal row click handler passes `{preserveEstNum: true}`:

```js
// L~3733 in spot_r1_5.jsx
const loadEstimateFromData = useCallback((data, opts) => {
  if (!data) return;
  const preserveEstNum = opts && opts.preserveEstNum === true;
  // ... savedInitials handling unchanged ...

  // D-128 (R1.5.7.2): When loading from the saved-estimate archive (Load modal), preserve
  // the original est# so the archive folder linkage (D-120) survives the load. Without this,
  // a duplicate-est# trigger would regenerate the number and orphan the file vault folder.
  const initialsForGen = data.estInitials || savedInitials;
  const needsFreshNum = !preserveEstNum && (!data.estNum || isEstNumInUse(data.estNum, activeTabId));
  if (needsFreshNum && initialsForGen && initialsForGen !== "SPC") {
    const fresh = uniqueEstNum(generateEstNum(initialsForGen), activeTabId);
    data = { ...data, estNum: fresh, estNumAuto: true };
  }
  applyState(data);
}, [applyState, isEstNumInUse, uniqueEstNum, generateEstNum, estInitials, activeTabId]);
```

Load modal row click:
```js
onClick={() => { loadEstimateFromData(a.data, {preserveEstNum: true}); setShowLoadModal(false); }}
```

`__SPOT_LOAD_JSON` (the global automation entry point used by the parser, `runner`, and ad-hoc paste) does NOT pass the flag — its callers are typically loading **fresh** payloads where the est# is missing or generated AI-side, and the D-112 regen behavior is correct there.

## Failure Mode That's Now Fixed

Before D-128:
1. Estimator drops 3 files into a quote → folder `Skybox_SPC-260427-141523` created on disk
2. Estimator saves the quote → archive index updated
3. Next day, estimator opens Load modal → 📎 badge shows on that row
4. Clicks the row → estimate loads with new estNum `SPC-260428-093011`
5. Files panel: empty (looking at empty folder for the new estNum)
6. Estimator confused, thinks files were lost

After D-128:
1–3 same
4. Click row → estimate loads keeping `SPC-260427-141523`
5. Files panel: shows the 3 files

## Notes

- The estimator can still manually edit the est# field after loading if they actually want a fresh number (rare).
- The fix preserves the ability of `loadEstimateFromData` to regenerate when called from contexts where regen is correct (AI-generated payloads via `__SPOT_LOAD_JSON`, recovery loads, etc).
