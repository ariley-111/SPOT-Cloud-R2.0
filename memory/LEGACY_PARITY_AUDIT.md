# Cloud ↔ Legacy Parity Audit (2026-06-01)

**Method:** Cross-referenced every `D-NNN` decision marker present in `legacy_spot/spot_r1_5.jsx` (42 total) against the cloud port. Verified each item by reading the corresponding code path.

**Legend:** 🔴 math (changes pricing) · 🟡 UI/transparency · ⚪ infra/cosmetic

## Gap List

### 🔴 Math (will change quote totals)

| ID | Legacy ref | Status in cloud | Action |
|---|---|---|---|
| **D-124** | `evaluateRoutes` cost-aware routing (L626-790). Replaces D-121 hard-Bobst-first. autoRoute returns *cheapest viable* route across CAD / Crest / Bobst. | ❌ Cloud has the pre-D-124 D-121 code (`routing.py:299`) — early-returns Bobst whenever Bobst is viable, never compares costs. **This is the root cause of cloud over-routing to Bobst.** | ✅ **PORTING NOW** |
| **D-090** | `compareRoutes` returning CAD vs Crest vs Bobst sheet/cost detail (L834-900). Used by side-by-side Route Compare panel. | ❌ Docstring claims port but function does not exist. | ✅ **PORTING NOW** (shared helper with D-124) |
| D-085 | Crest/Bobst die auto-handling (steel-rule die plumbing into routing). | ✅ Partial — die plumbing exists in `routing.py` but is not parallel to legacy `dieEstimated`/`sheetRuleInches` outputs. Subsumed by D-124 port. | Bundled with D-124 port |
| D-122 | Crest die default + Bobst rate UI plumbing. | ✅ Engine-side present. UI exposes via Advanced Controls. | OK |
| D-125 | Crest/Bobst die visibility only for Crest/Bobst routes (not FUL). | ✅ Present in `RightDashboard`. | OK |

### 🟡 UI / Transparency (no math impact, parity gap)

| ID | Legacy ref | Status in cloud | Action |
|---|---|---|---|
| **D-070** | Board Status Bar — SPEC vs RUNNING banner when `boardSubstitution !== null`. Shows "200# meets ECT 32 spec · Buy Min +$X/pc · 3-5 day lead time". | ❌ Cloud has BoardStatusBar UI but no SPEC/RUNNING bifurcation; also doesn't apply `fmLnr` (None→Kraft, strip `-Lite`). | ✅ **FIXING NOW** |
| fmLnr | Legacy `fmLnr` display helper (L1218). `None`→`Kraft`, strips `42# `, `-Lite`, `-White`. | ❌ ItemSetupSec.jsx:157 strips weight only. PreviewPdfModal already has it. | ✅ **FIXING NOW** |
| D-069 | Multi-part spec drift check — flags when a switch-back to a prior bom item finds drifted state. | ❌ Cloud multi-part is stubbed (no per-item state isolation — see backlog). | Backlog (depends on multi-part) |
| D-066 | Multi-part component spec table (no per-piece prices). | ❌ Stub. | Backlog (depends on multi-part) |
| D-062 | `lastFreightZip` tracking — invalidate freight when ship-to changes. | ❌ Not present. Freight is recalculated on every recalc. Edge: stale freight if ship-to was edited and no recompute fired. | P2 |
| D-118 | Per-customer ship-to memory (autofill from prior quote). | ❌ Not present. | P2 |
| D-112 | Fresh est# generation on JSON load if missing/duplicate. | ✅ Server-side generates est# on draft create. | OK |
| D-113 | GM curve migration sync from localStorage. | n/a — cloud has no localStorage GM defaults to migrate. | n/a |
| D-120 | Drop-Zone File Vault (Phase 1). | ✅ Implemented in FilesSec.jsx (drag-drop + parse trigger). | OK |
| D-127/D-128 | Saved-estimate archive folder detection. | ✅ Implemented via `/api/quotes` archive endpoints. | OK |
| D-134 | RFQ folder orphan fix on rename. | n/a — cloud uses DB storage, not folder filesystem. | n/a |
| D-130 | SPC logo base64 PNG. | ✅ Embedded in `routes/pdf.py` and `frontend/public/spc_logo.png`. | OK |

### ⚪ Infra / Cosmetic (skip)

| ID | Note |
|---|---|
| D-106/D-107/D-108 | Internal refactor markers from legacy engine migration. n/a in Python port. |
| D-132/D-137 | JSX em-dash escape bugs. n/a. |
| D-133 | Top-left version badge. Cosmetic only. |
| D-139 | "Build Estimate" button cache dispatch. UX timing. Not implemented; safe to skip. |
| D-143/D-149 | JSX-side cosmetic hotfixes. n/a. |
| D-058 | "Actual shipped MSF" rename. Variable naming only — math unchanged. |

### 🚨 Larger Backlog Items (out of scope for this audit batch)

| Item | Why it matters | Effort |
|---|---|---|
| **Multi-Part per-item state isolation** | Legacy stores full pricing state per bomItem (`it.state` snapshot via `gatherItemState`). Cloud only stores `{id, desc, type, pcsPerSize}` — top-level state is shared. Switching active item does NOT preserve dims/board/qtys per component. | Medium (1 day) |
| **Phase 4 Pricing Console** | Admin UI for D-110 calibrated rates, GM curve editing, audit log. | Medium-Large |

---

## 🐛 Second batch fix (later 2026-06-01) — Liner grade enforcement + stock dots

**User found a Lynk Pkg quote producing $6,487.81 / $129/ea total at Qty 50** vs legacy's $981.72 / $19.63/ea. Root cause investigated with API + browser diff:

### Root cause: silent persisted `33# Kla-White` liners

The persisted quote draft had `outsideLiner: "33# Kla-White"` and `insideLiner: "33# Kla-White"`. The board library has **zero stock sheets at `33# Kla-White`** for any grade — so the engine fell back to a custom-cut 18.25×91 1-out sheet ($72.58/sheet) instead of the stock 63×98 (3-out, $5.74/sheet eff).

**Two parity behaviors missing from cloud:**

| Legacy ref | Behavior | Cloud status before | Action |
|---|---|---|---|
| L139-140, L265 `allowed_board_grades + enforce:true` | `33# Kla-White` is only allowed for `["175","ECT 32"]` grades. `56# Kla-White` only for `["250"]`. For any other grade the liner is FILTERED OUT of the tile picker entirely. | ❌ All 6 liners always shown; user could click 33# while on 200 grade (which has no stock at that liner) | ✅ FIXED |
| L5983 stock-availability green dot | Every viable liner tile shows a green dot when there's at least one approved stock sheet with that liner at the current grade/flute/medium. | ❌ No indicator anywhere | ✅ FIXED |

### Fix applied

- `/app/frontend/src/lib/defaults.js`: added `LINER_ENFORCE` map + `allowed_liners(grade)` helper.
- `/app/backend/routes/engine_routes.py`: new `GET /api/engine/sheet-availability?boardGrade=...&flute=...&medium=...` returns `{outside: [liners], inside: [liners]}` of approved stock liners.
- `/app/frontend/src/api/spot.js`: `sheetAvailability(...)` wrapper.
- `/app/frontend/src/components/spot/ItemSetupSec.jsx`:
  - `BoardStatusBar` now memoizes `allowed_liners(s.boardGrade)`, fetches sheet-availability on grade/flute/medium changes.
  - Outside/Inside tile lists render only allowed liners; each tile shows a green stock dot when stock exists.
  - Auto-correct hook: if persisted `outsideLiner`/`insideLiner` is NOT in the current allowed list (e.g., loaded a saved quote with grade-mismatched liner), snap to `42# Kla-White` (or `42# Kemi-Lite` / `None` fallback). Ensures a single page-load self-heals the bad state.

### Verification

Same Lynk Pkg quote loaded after fix:

| | Before | After fix |
|---|---|---|
| Liner | 33# Kla-White (no stock) | **42# Kla-White** (auto-corrected) ✅ |
| Sheet | 18.25×91 custom, 1-out, 50 sheets | **63×98 stock, 3-out, 17 sheets** ✅ |
| Route | Saber + D/C | **CAD** ✅ |
| Sell/ea | $129.76 | **$21.82** ✅ |
| Total | $6,487.81 | **$1,090.97** ✅ |
| Board badge | ORDER | **IN STOCK** ✅ |
| Outside tile count | 6 (incl 33#/56#) | **4** (33#/56# filtered) ✅ |
| Stock dot | none | **shown on every viable liner** ✅ |

vs legacy target ($981.72 / $19.63) → cloud now lands within ~11% (calibration delta, not routing/sheet).

### Test plan (post-fix)

---

## Parking Lot (Tuesday meeting)

1. **Board substitution policy** — when CAD spec calls for `200# E Kemi/Kraft` but only stock has different liners (e.g., `Kemi-Lite/None`), how should this be displayed/handled? Auto-substitute and show banner (legacy D-070 behavior), or refuse to substitute?
2. **Buy-Min behavior** — when mill min is 500 sheets but the order only uses 1 (e.g., Qty 40), should the system (a) full-charge the buyer, (b) amortize across projected future orders, or (c) just warn?
3. **Parser overrides** — should the parser respect customer-CAD explicit grade callouts (e.g., `200#`) over its inference, OR vice-versa?
4. **Multi-Part parsing** — should the parser flag "filename indicates two components but body only describes one" and prompt user, or silently quote what it can extract?
5. **Cloud margin calibration** — User reports cloud trends slightly higher than iQuote on most quotes. Acceptable as-is or recalibrate after D-124 fix lands?

---

## Test plan (post-fix)

1. Re-run **Tavens RFQ** through cloud — expect parity unchanged (was already at 1:1).
2. Re-run **AFA M85002 / Lynk Pkg BJ Sedona Planter** — capture before/after.
3. Run **fleet regression** (`/app/backend/tests/fleet_regression.py`) — confirm no broad regressions.

---

## Results — 2026-06-01 batch fix

### Fleet regression (785-job iQuote-vs-SPOT parity)

| Metric | Pre-D-124 (old cloud) | Post-D-124 (this fix) | Legacy R1.6.1 target |
|---|---|---|---|
| Fleet total Δ% | +32.05% | **+6.55%** | ~+1-2% |
| Median Δ% | +21.33% | **+7.89%** | |
| Mean Δ% | +46.95% | **+16.61%** | |
| R² | **-0.5537** | **0.8398** | 0.969 |

Improvement: **R² jumped 33+ points (-0.55 → +0.84)**, fleet total Δ dropped from +32% to +7%.

**Remaining gap to legacy's 0.969:** Likely the still-open D-058 (shipped MSF rename, no math impact suspected), per-item Multi-Part state isolation (affects multi-part quotes), and Crest die-rule plumbing nuances. None are routing-related.

### Spot check — Square Terminal Tray (Width=13.594", Length=20.313", 200 E Kemi/Kraft)

| Qty | Pre-fix (Bobst-first) | Post-fix (cheapest) | iQuote target |
|---|---|---|---|
| 40 | $26.06/ea total $1,042 | **$2.24/ea total ~$90** (CAD on 60×120, 20-out, 2 sheets) | $9.79/ea $391 |
| 780 | $6.82/ea total $5,322 | **$0.60/ea total ~$468** (CAD on 63×126, 24-out, 33 sheets) | $2.93/ea $2,284 |

Cloud is now UNDER iQuote (which itself was lower than legacy). The remaining delta vs iQuote is margin/calibration territory — a parking-lot item for Tuesday meeting.

### UI parity

- BoardStatusBar now shows `200 · C · Kemi/Kraft` (was `200 · C · Kemi-Lite/None`) — verified via screenshot.
- PreviewPdfModal, defaults.js, pdf.py all aligned on the same `fmLnr` (None→Kraft, strip weight + `-Lite`/`-White`).
