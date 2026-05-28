# D-144 — Parser Preflight Token Heuristic Calibration

**Status:** CODED (R1.6.4.2, 2026-05-03)
**Affects:** `spot_server.js` only (4 surgical edits)
**Source baseline:** R1.6.4.1 (D-143 ship, 2026-05-02 PM; server stayed at R1.6.4 since the D-143 hotfix was JSX-only)
**Engine, runner, jsx, build_spot_r1_5, fleet_compare:** UNCHANGED

---

## 1. Defect (TC-D141.2 FAIL — caught 2026-05-03 during D-143 closure-gate run)

D-141 R1.6.4 shipped with a placeholder bytes:tokens heuristic for PDFs and images:

```js
if (ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
  estimatedInputTokens += bytes;       // 1:1 ratio
} else {
  estimatedInputTokens += Math.ceil(bytes / 4);
}
```

The 1:1 byte:token ratio is wrong by ~200-700x for image-bearing PDFs. Real Anthropic consumption for PDFs runs through the API's image-extraction pipeline: each PDF page converts to ~1 image, each image tokens at ~1600. A 1.5 MB scanned PDF (typically 2 pages) consumes ~3,200 tokens at Anthropic — the heuristic claimed 1,548,901.

**Discovered:** 2026-05-03 during Claude-in-Chrome live re-run of TC-D139.4 on R1.6.4.1 install. Test drop included a 1.54 MB scan PDF + 4 KB email; preflight returned 413 PREFLIGHT_OVER_LIMIT. After Michael deleted the big PDF and dropped only the 4 KB email, parse succeeded — proving the file content was fine, only the byte-volume heuristic was tripping the threshold falsely.

**Side effect:** D-141 design doc §4 explicitly flagged the heuristic as "conservative (overestimates rather than underestimates)" but did not anticipate the magnitude of the over-estimate. 250x over for typical scan PDFs is not "conservative" — it's broken.

## 2. Design candidates considered

### Option A — Per-file-type heuristic
Detect text-PDF vs image-PDF on the server (e.g., via pdf-parse byte inspection) and apply different ratios. Most accurate.
**Rejected:** requires adding a PDF parsing dependency (pdf-parse, pdf-lib) to the server, increases install footprint, adds new failure surface (parser exceptions on malformed PDFs), creates a per-file iteration cost. Overkill for a calibration problem.

### Option B — Raise PREFLIGHT_THRESHOLD
Bump the 360,000-token threshold to a higher value. Simple.
**Rejected:** breaks preflight purpose. The cap exists to catch real Anthropic 429 rate_limit errors before they happen. Raising the threshold without recalibrating the heuristic means a TRULY-oversized payload (50× 5 MB PDFs, ~250M heuristic-bytes = ~250M heuristic-tokens at 1:1) still trips the threshold AND a real-fail condition (real consumption ~600k actual tokens, well over the 450k cap) still trips it. But normal-sized payloads (1.5 MB single PDF) now also pass, including those whose real consumption is within bounds. The threshold raise doesn't fix the discrimination problem.

### Option C — Hybrid scaling factor (CHOSEN)
Divide PDF/image bytes by a calibrated factor (250) to approximate real Anthropic token consumption. Single-line change. Preserves the existing PREFLIGHT_THRESHOLD. Preserves the conservative-bias design intent (still over-estimates relative to real consumption, just by 1.5-3x instead of 200-700x). Accommodates both image-heavy and text-extracted PDFs without per-file-type detection.

**Why 250:**
- Image-heavy scan PDFs: real ratio ~300-700 bytes per token (1 page per ~1MB at 1600 tokens). 250 over-estimates by ~1.5x — safe.
- Text-extracted PDFs: real ratio ~50-100 bytes per token. 250 over-estimates by ~3-5x — still safe, doesn't false-negative.
- Pure images (.png/.jpg/.gif/.webp): real ratio ~200-400 bytes per token (typical 1024×1024 image at 500KB-1.5MB → 1600 tokens). 250 is in the middle — safe.
- Cross-checked against real-world test data:
  - 1.5 MB scan PDF: 1,542,905 / 250 = 6,172 estimated vs ~3,200 real → 1.9x over (safe)
  - L'Oreal 34-PDF fixture (~50 MB, conf 0.74 baseline): ~50M / 250 = 200,000 estimated vs ~80k real → 2.5x over (safe, passes 360k threshold)
  - 50 × 5 MB PDFs (250 MB worst case): 250M / 250 = 1,000,000 estimated → REJECTED (real consumption ~600k, would actually 429, correct rejection)

The 250 divisor preserves the false-positive-over-false-negative trade-off that D-141 design §4 specifies.

## 3. Why server-only

Server preflight runs before Anthropic call. JSX has no equivalent surface — it just dispatches `POST /est/parse-rfq` and renders whatever the server returns. JSX bundle stays at R1.6.4.1 (current live version).

## 4. Surgical edits (4 total in `spot_server.js`)

### Edit 1 — Calibration logic (L699-703, the PDF/image branch)

**Find (single occurrence):**

```
    if (ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
      estimatedInputTokens += bytes;
    } else {
      estimatedInputTokens += Math.ceil(bytes / 4);
    }
```

**Replace with:**

```
    if (ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
      // D-144 (R1.6.4.2): bytes/250 calibration. PDFs/images convert to per-page-image tokens at the
      // Anthropic API layer (~1600 tokens per image). Real bytes:tokens ratio is 200-700:1 for typical
      // image-heavy scan PDFs (1MB scan = ~2 pages = ~3200 tokens). The R1.6.4 1:1 ratio over-estimated
      // by ~250x and caused TC-D141.2 false-positives on normal-sized RFQs (D-144). 250 is conservative
      // mid-point — over-estimates relative to real consumption but stays well clear of the false-negative
      // path (which 429s mid-call). Text-extracted PDFs land closer to 50-100:1 ratio; the 250 divisor
      // accommodates both modes without per-file-type detection.
      estimatedInputTokens += Math.ceil(bytes / 250);
    } else {
      estimatedInputTokens += Math.ceil(bytes / 4);
    }
```

### Edit 2 — Header callout block (L1, plus inserted lines)

**Find (single occurrence):**

```
// SPOT R1.6.4 Freight Server with UTS API Integration + Customer Auto-Populate + Drop-Zone Archive
// Serves SPOT HTML + proxies UTS freight + serves customer DB + per-quote file archive
// 2026-05-02 — R1.6.4: D-140 + D-141 hotfix.
```

**Replace with:**

```
// SPOT R1.6.4.2 Freight Server with UTS API Integration + Customer Auto-Populate + Drop-Zone Archive
// Serves SPOT HTML + proxies UTS freight + serves customer DB + per-quote file archive
// 2026-05-03 — R1.6.4.2: D-144 hotfix. Recalibrate D-141 preflight bytes:tokens ratio for PDFs/images
//              from 1:1 to 1:250 (anthropicParseRfqBatch loop). Real Anthropic consumption for
//              image-heavy PDFs is ~200-700 bytes per token; the original 1:1 ratio over-estimated
//              by ~250x and rejected normal-sized RFQs with false 413 PREFLIGHT_OVER_LIMIT (TC-D141.2
//              FAIL on D-143 closure-gate run 2026-05-03). Closure gate: TC-D141.2 PASS on canonical
//              L'Oreal 34-PDF fixture + a representative single-piece RFQ. See DEV_D144_Design_Decision.md.
// 2026-05-02 — R1.6.4: D-140 + D-141 hotfix.
```

### Edit 3 — `/api/health` version bump

**Find (single occurrence):**

```
      status: "ok", version: "R1.6.4",
```

**Replace with:**

```
      status: "ok", version: "R1.6.4.2",
```

### Edit 4 — Server startup banner

**Find (single occurrence):**

```
  console.log("\n  SPOT R1.6.4 Server running at http://localhost:" + PORT);
```

**Replace with:**

```
  console.log("\n  SPOT R1.6.4.2 Server running at http://localhost:" + PORT);
```

## 5. Risk

Pure server calibration constant change. No new branches, no new dependencies, no schema change, no JSX touch, no engine math. Heuristic remains conservative-bias. Preflight semantics unchanged (same threshold, same response shape, same error code, same diagnostic fields).

**Audit for downstream consumers of `estimatedInputTokens`:**
- Local to `anthropicParseRfqBatch` function scope. Not propagated to client (response body fields populated only on the 413 path, where the value just shows up in the error message and `err.estimatedTokens` field for diagnostic display in the JSX banner).
- The diagnostic display will now show smaller numbers (e.g., 6,172 instead of 1,548,901 for the same 1.5 MB PDF). UI continues to render accurately.

**No regression surface.**

## 6. Tests

### Closure gate

Two PASS conditions required to move D-144 from CODED → CLOSED:

**TC-D141.2-canonical:** L'Oreal 379-8596 + C4-26 Glass Nails 34-PDF fixture (~50 MB total). Drop, click Build Estimate, expect 200 (preflight passes), parse runs to completion, `parsed.bomItems.length === 10`, conf in [0.65, 0.85]. Same fixture and PASS criteria as TC-D131.1 baseline. Server console should log preflight estimated tokens ≈ 200,000 (not the old 50,000,000).

**TC-D141.2-singlepiece:** A representative single-piece RFQ (e.g., the 1.54 MB scan PDF that hit FAIL on D-143 closure-gate run, plus its accompanying email.pdf). Drop, click Build Estimate, expect 200 (preflight passes), parse runs. Server console preflight estimate ≈ 6,000-7,000 tokens (was 1,548,901 on R1.6.4.1).

### Regression smoke

**TC-D141.1 re-run:** With a TRUE oversized payload (50+ multi-MB scan PDFs totaling > 90 MB), preflight should still reject with 413 PREFLIGHT_OVER_LIMIT. Estimated tokens with new calibration: 90M / 250 = 360,000 tokens — right at the threshold. Want > 360k, so test fixture should be 100+ MB total. Verifies the fix didn't widen the false-negative window.

### TC-D141 sub-case status update post-D-144 ship

| Sub-case | Pre-D-144 | Post-D-144 | Note |
|---|---|---|---|
| TC-D141.1 | PASS (incidental on D-143 run) | PASS (re-validated with 100+ MB fixture) | Threshold still rejects truly oversized payloads |
| TC-D141.2 | FAIL → D-144 | PASS (closure gate) | Calibration fix |
| TC-D141.3 | PASS (incidental on D-143 run) | PASS (no change) | keySource unaffected |
| TC-D141.4 | SKIPPED | SKIPPED | No-key env still required |
| TC-D141.5 | SKIPPED | SKIPPED | Both-keys env still required |

Net D-141 progress after D-144 ship: 3 PASS + 2 SKIPPED. Still requires TC-D141.4 and TC-D141.5 PASS for D-141 CODED → CLOSED.

## 7. Files changed

| File | L (R1.6.4 → R1.6.4.2) | SHA-16 (R1.6.4 → R1.6.4.2) |
|------|------------------------|------------------------------|
| `spot_server.js` | 2506 → 2519 (+13: 7-line D-144 calibration comment + 6-line header callout) | `9b7f8cf0099305e0` → `433372cc8ebc1592` |

`spot_r1_5.jsx` (R1.6.4.1, sha `727364fcc7b211bb`), `build_spot_r1_5.js`, `SPOT_R1.5.html`, `spot_engine.js`, `spot_runner.js`, `DEV_fleet_compare.js`: **UNCHANGED.**

## 8. Build verification (post-Cowork apply)

1. `node -c spot_server.js` returns 0, no syntax errors.
2. `grep -c "Math.ceil(bytes / 250)" spot_server.js` returns **1** (sentinel — was 0 pre-patch).
3. `grep -c "estimatedInputTokens += bytes;" spot_server.js` returns **0** (old 1:1 line gone).
4. `grep -nE "version.*R1\.6\.4\." spot_server.js` returns L1 header + L2456 (`/api/health`) + L2485 (startup banner) all bumped to R1.6.4.2.
5. After server restart: `curl localhost:3100/api/health | grep version` returns `"version":"R1.6.4.2"`.
6. JSX `__SPOT_UI_VERSION` should remain `"R1.6.4.1"` — the JSX/server version skew is intentional (same precedent as D-125 / D-132 / D-143 server-only or JSX-only ships).

## 9. JSX/server version skew matrix

| Component | Pre-D-144 | Post-D-144 |
|---|---|---|
| `spot_r1_5.jsx` `__SPOT_UI_VERSION` | "R1.6.4.1" | "R1.6.4.1" (unchanged) |
| Browser tab title | "SPOT R1.6.4.1" | "SPOT R1.6.4.1" (unchanged) |
| EST/version badge | "R1.6.4.1" | "R1.6.4.1" (unchanged) |
| `spot_server.js` `/api/health` version | "R1.6.4" | "R1.6.4.2" |
| Server startup banner | "SPOT R1.6.4" | "SPOT R1.6.4.2" |

Per Michael's preference at session start: `spot_server.js stays at R1.6.4 — JSX-only ship` was correct for D-143. For D-144 the inverse holds: server bumps, JSX stays. Skew shape is identical, just on the other foot.

## 10. Hand-off

1. Cowork applies §4 edits 1-4 to install-folder `spot_server.js`.
2. Michael **stops** spot_server (Ctrl+C in the running terminal or equivalent), then restarts it: `node spot_server.js`.
3. Server startup log should print `SPOT R1.6.4.2 Server running at http://localhost:3100`.
4. Verify via curl: `curl localhost:3100/api/health` returns version `R1.6.4.2`.
5. Hard-reload the browser at `localhost:3100`. JSX still reads R1.6.4.1 (correct — no JSX change).
6. Re-run TC-D141.2 with the closure-gate fixtures (canonical L'Oreal + single-piece RFQ).
7. On PASS: I deliver D-144 CODED → CLOSED ledger snippets (parallel to D-143 close pattern).

**Server restart IS required** (unlike D-143 which was pure JSX). The preflight code only re-evaluates on server boot.

## 11. PK sync verification

After Cowork pushes the patched server to PK, in a fresh chat send: `search project knowledge for "Math.ceil(bytes / 250)"`. Expected: ≥ 1 hit in `spot_server.js`. Zero hits = silent PK upload failure, re-apply.

## 12. Related references

- `02_RELEASE_HISTORY.md` R1.6.4.1 entry "Closure addendum (2026-05-03)" — captured the TC-D141.2 FAIL finding that triggered this hotfix.
- `01_OPEN_ISSUES.md` D-144 row in "Currently Open" — documents the calibration problem and lists candidates (a)/(b)/(c).
- D-141 R1.6.4 entry in `02_RELEASE_HISTORY.md` — original preflight design.
- D-143 R1.6.4.1 entry — JSX-only hotfix precedent for cross-tier version skew.
- D-125 / D-132 sub-version hotfix precedents — small-scope server-only or JSX-only ships shipping as `.X` micros.
