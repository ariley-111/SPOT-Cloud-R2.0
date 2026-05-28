# D-143 — Discard Button Cache-Clear Hotfix

**Status:** CODED (R1.6.4.1, 2026-05-02 PM)
**Affects:** `spot_r1_5.jsx` (2 sites, identical pattern), `build_spot_r1_5.js` (title bump)
**Source baseline:** R1.6.4 (D-139/D-140/D-141 ship, 2026-05-02 AM)
**Engine, runner, server, fleet_compare:** UNCHANGED

---

## 1. Defect (TC-D139.4 FAIL — caught 2026-05-02 PM)

Cowork closure-suite run logged TC-D139.4 FAIL on R1.6.4 install. Both Discard buttons in the parser diff modal bind onClick to:

```jsx
<button onClick={()=>setParseModalOpen(false)} ...>Discard</button>
```

This closes the modal but leaves `parseResult` populated. D-139's `hasCachedParse = !!(parseResult && parseResult.parsed && !parserBusy)` continues to evaluate `true` after Discard, so the next Build Estimate click reopens the same stale modal instead of dispatching a fresh `/est/parse-rfq`. The "Force-re-parse path remains available via the diff modal's Discard button" promised in `DEV_R1_6_4_Design_Decision.md` §2.3 / §2.4 / §2.2 did not ship.

Cowork sentinel grep on the deployed bundle: `setParseResult(null)` static count = 0. Confirmed missing.

## 2. Fix

Replace both Discard onClick handlers with a cache-clearing variant:

```jsx
<button onClick={()=>{setParseResult(null);setParseFieldChecks({});setParseModalOpen(false);}} ...>Discard</button>
```

**Why each setter:**
- `setParseResult(null)` — clears the cache slot that `hasCachedParse` keys on. Drops button label back to "Build Estimate"; subsequent click fires `doParseRFQ` (TC-D139.4 step 3 expectation).
- `setParseFieldChecks({})` — clears modal checkbox state so a fresh re-parse with different field deltas doesn't carry stale checks into the next diff render.
- `setParseModalOpen(false)` — preserved (existing close behavior).

**Why NOT also clear:** `setParserError("")`, `setParserStage(null)`, `setParserElapsedSec(0)`. Each clears itself on the next parse cycle. Clearing them on Discard would suppress legitimate prior-error display (e.g., a cap-reached warning the estimator should still see). Only the two state slots that gate `hasCachedParse` + modal hydration get cleared.

## 3. Two sites — historical context

Same pattern appears at **two sites** in `spot_r1_5.jsx`, both inside the parser diff modal render branch:

- **Site 1** — paired with `Apply Selected` / `Apply All` buttons (original D-129 R1.5.8 ship)
- **Site 2** — paired with `Build Selected` / `Build All` buttons (D-136 R1.6.3 UI rename leftover)

The D-136 rename cascade was documented as "15 sites" but evidently left both modal-footer variants in source. Whether one is dead code or both render under different conditional branches isn't worth investigating in this hotfix — both get the fix, both are reachable per current production behavior.

Each site's surrounding context (next-button label) makes the str_replace match unique without ambiguity.

## 4. Risk

Pure JSX state-setter addition. No new branches, no engine math, no server contract change, no schema change, no calibration touch. Cleanup of state on close — strictly less stale state than before.

**Audit for downstream readers of `parseResult`:**
- Modal render branch: gated on `parseModalOpen=true`, so post-Discard nullification is safe.
- `doApplyParsed`: only fires from inside the modal (Apply All / Apply Selected / Build All / Build Selected) — already gated.
- Auto-recalc threshold display: reads `parseResult.confidence` only inside the modal render — gated.
- No "show last parse cost" badge or persistent-display surface reads `parseResult` outside the modal. Confirmed by grep on deployed source.

No regression surface.

## 5. Tests

**Closure gate:** TC-D139.4 PASS on R1.6.4.1 install. Spec unchanged from `TEST_SPOT_TC_D139_D140_D141_Suite.md`:

- Step 2: Discard click → `parseResult` cleared (verifiable via DevTools `window.__SPOT_SESSION_LOG` event OR direct state inspection).
- Step 3: button label reverts to "Build Estimate" (cache cleared); click dispatches `doParseRFQ`.
- Step 3: Network panel shows new `POST /est/parse-rfq`, status 200.
- Step 4: total Network panel `parse-rfq` count = 2 across the test (initial parse + post-Discard parse).

**Regression smoke:** TC-D139.1 + TC-D139.2 re-run on R1.6.4.1 to confirm cache-hit + label flip still work post-patch.

**Companion gate:** D-139 itself stays CODED until full TC-D139 sub-case set passes (.1 + .2 + .3 + .4 all green). D-143 ship makes .4 reachable; the .1/.2/.3 PASSes from the 2026-05-02 PM Cowork run remain valid because R1.6.4.1 doesn't touch the cache-hit dispatch logic.

## 6. JSX surgical edits (Cowork applies)

Two `str_replace` operations against `spot_r1_5.jsx`:

### Site 1 (Apply Selected / Apply All variant)

**Find (exact, single occurrence):**

```
<button onClick={()=>setParseModalOpen(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text2,border:`1px solid ${t.border}`}}>Discard</button>
                  <button onClick={()=>doApplyParsed(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text,border:`1px solid ${t.border}`}}>Apply Selected</button>
```

**Replace with:**

```
<button onClick={()=>{setParseResult(null);setParseFieldChecks({});setParseModalOpen(false);}} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text2,border:`1px solid ${t.border}`}}>Discard</button>
                  <button onClick={()=>doApplyParsed(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text,border:`1px solid ${t.border}`}}>Apply Selected</button>
```

(Only the Discard button's onClick changes; "Apply Selected" line included for unique-match disambiguation against Site 2.)

### Site 2 (Build Selected / Build All variant)

**Find (exact, single occurrence):**

```
<button onClick={()=>setParseModalOpen(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text2,border:`1px solid ${t.border}`}}>Discard</button>
                  <button onClick={()=>doApplyParsed(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text,border:`1px solid ${t.border}`}}>Build Selected</button>
```

**Replace with:**

```
<button onClick={()=>{setParseResult(null);setParseFieldChecks({});setParseModalOpen(false);}} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text2,border:`1px solid ${t.border}`}}>Discard</button>
                  <button onClick={()=>doApplyParsed(false)} style={{all:"unset",cursor:"pointer",fontSize:12,fontWeight:600,padding:"6px 14px",borderRadius:4,background:t.bg3,color:t.text,border:`1px solid ${t.border}`}}>Build Selected</button>
```

## 7. Version sites bumped R1.6.4 → R1.6.4.1 (per D-133 guardrail)

Sweep `grep -nE "R1\.6\.4" spot_r1_5.jsx spot_server.js build_spot_r1_5.js` and update every live-emit site. Expected sites:

- `spot_r1_5.jsx` L4 — header comment block (add D-143 callout line)
- `spot_r1_5.jsx` L44 — `window.__SPOT_UI_VERSION = "R1.6.4"` → `"R1.6.4.1"`
- `spot_r1_5.jsx` L3296 — browser tab title parts array `"SPOT R1.6.4"` → `"SPOT R1.6.4.1"`
- `spot_r1_5.jsx` L5418 — EST/version badge `R1.6.4` → `R1.6.4.1`
- `build_spot_r1_5.js` L43 — HTML `<title>SPOT R1.6.4</title>` → `<title>SPOT R1.6.4.1</title>`

**Server stays at R1.6.4** (this hotfix is JSX-only; `spot_server.js` L1 header / L2443 `/api/health` version / L2472 startup banner all remain at R1.6.4). Comment in server header stays accurate; `/api/health` version mismatch with JSX is acceptable for a JSX-only hotfix and matches the D-125 / D-132 / D-133 hotfix precedents.

After patch: confirm `grep -nE "R1\.6\.4[^.]" spot_r1_5.jsx` returns only historical-attribution comment lines (none in live-emit string-literal positions).

## 8. Files changed

| File | L (R1.6.4 → R1.6.4.1) | SHA-16 (R1.6.4 → R1.6.4.1) |
|------|------------------------|------------------------------|
| `spot_r1_5.jsx` | 8977 → 8977 (zero net line delta — onClick body grew, no new lines) | `55ea8db543c708a5` → (rebuilt on apply) |
| `build_spot_r1_5.js` | 60 → 60 | `f7963defdfa766e3` → (rebuilt on apply) |
| `SPOT_R1.5.html` | rebuilt | `61b6a05a97cd55ad` → (rebuilt) |

`spot_engine.js`, `spot_runner.js`, `spot_server.js`, `DEV_fleet_compare.js`: **UNCHANGED.**

## 9. Build verification (post-patch checklist)

1. `node --check` equivalent on JSX via Babel parser: PASS, 86 top-level statements expected.
2. `node build_spot_r1_5.js` rebuilds `SPOT_R1.5.html` cleanly. Title tag in output reads `<title>SPOT R1.6.4.1</title>`.
3. `grep -c "setParseResult(null)" spot_r1_5.jsx` returns ≥ 2 (sentinel — was 0 pre-patch).
4. `grep -c "setParseFieldChecks({})" spot_r1_5.jsx` returns ≥ 2 (sentinel — sites added; pre-existing toggle-all paths may also count).
5. Browser hard-reload after server restart. Confirm `window.__SPOT_UI_VERSION === "R1.6.4.1"`. Confirm tab title reads `SPOT R1.6.4.1`.

## 10. Closure gate

TC-D139.4 PASS on R1.6.4.1 install. On PASS:
- D-143 moves from CODED → CLOSED in `01_OPEN_ISSUES.md`.
- R1.6.4.1 entry filed at top of `02_RELEASE_HISTORY.md`.
- D-139 closure dependency: TC-D139.4 unblocks; combined with already-PASSED TC-D139.1 + TC-D139.2 from the 2026-05-02 PM Cowork run, three of four sub-cases are green. D-139 still requires TC-D139.3 (env-bound) to close fully.

## 11. TC-D140.2 wording footnote (separate finding, no code change)

Same Cowork run logged TC-D140.2 PASS-with-note. The implementation rejection-reason wording for in-batch dups reads:

```
"duplicate (sha256 matches existing file <existing-fn> in folder)"
```

instead of the spec'd:

```
"duplicate within this drop (sha256 already accepted earlier in batch)"
```

Functional dedup is **correct** (1 accepted + 1 rejected + meta.files length 1 — confirmed by Cowork). The implementation merges `existingSha` and `batchSha` checks into a single path that uses the prior-folder reason template for both cases. Per the standing rule "**Docs align to source, never the reverse**" — the spec is softened, not the code:

**TC-D140.2 sub-case (2)** — revised expected: "second copy returns in `rejected[]` with reason citing `'duplicate'` and the matching sha256. Wording variants `'duplicate (sha256 matches existing file X in folder)'` AND `'duplicate within this drop (sha256 already accepted earlier in batch)'` are both acceptable — implementation merges the in-batch path into the prior-folder reason template; functional dedup is correct in either case."

This footnote applies to the existing TC-D140 row in `01_OPEN_ISSUES.md` (sub-case 2 expected wording) and the TC-D140.2 sub-case spec in `TEST_SPOT_TC_D139_D140_D141_Suite.md` (when authored to PK; currently downloads-only).

## 12. Hand-off

Standard apply order:
1. Cowork applies §6 JSX edits (2 sites) + §7 version bumps to install-folder `spot_r1_5.jsx`.
2. Cowork bumps `build_spot_r1_5.js` L43 title.
3. Michael runs `node build_spot_r1_5.js` to regenerate `SPOT_R1.5.html`.
4. Hard-reload browser; confirm version sentinels per §9.
5. Re-run TC-D139.4 sub-case from `TEST_SPOT_TC_D139_D140_D141_Suite.md`.
6. On PASS: I deliver D-143 CODED → CLOSED snippets + R1.6.4.1 release entry (parallel to R1.6.4 ledger close pattern).

Server unchanged → no `node spot_server.js` restart required for this ship.

## 13. PK sync verification

Sentinel: `search project knowledge for "setParseResult(null);setParseFieldChecks({})"` should return ≥ 2 hits in `spot_r1_5.jsx` once Cowork sync completes. Zero hits = silent PK upload failure, re-apply.

## 14. Related references

- `DEV_R1_6_4_Design_Decision.md` §2 — D-139 design and closure-gate language; promises the Discard re-parse path that this hotfix delivers.
- `TEST_SPOT_TC_D139_D140_D141_Suite.md` (downloads only, pending PK upload) — TC-D139.4 sub-case spec.
- `02_RELEASE_HISTORY.md` — R1.5.6.1 / R1.5.7.1 / R1.5.11.1 / R1.5.11.2 hotfix precedents (single-site or multi-site JSX hotfixes shipped as `.X` version bumps).
- `01_OPEN_ISSUES.md` — D-143 row (Currently Open, CODED) lands via `01_OPEN_ISSUES_R1.6.4.1_patch.md`.
- D-133 sweep guardrail (R1.5.11.2 ship) — process improvement that mandates pre-ship version-string grep across all 7 expected sites.

---

## §15 — Apply-time reconciliation (appended 2026-05-02 PM after R1.6.4.1 ship)

Source-side apply on 2026-05-02 PM caught four inaccuracies in §3, §6, §7,
§8, and §13 of this design doc. Functionally the fix landed correctly; these
are documentation corrections retained as an audit trail per the append-only
ledger rule.

| Section | Claimed at design time | Actual at apply time |
|---|---|---|
| §3 "Two sites — historical context" | Two Discard sites: Apply Selected variant + Build Selected variant, both reachable | One Discard site only, at jsx L8966. D-136 R1.6.3 rename eliminated `Apply Selected` / `Apply All` cleanly. The PK search that fed §3 returned stale snippets from `SPOT_R1.5.html` (last rebuilt R1.5.11 era, pre-D-136 button labels) and conflated them with live `spot_r1_5.jsx` content. |
| §6 Site 2 str_replace block | Apply Selected variant str_replace operation | No-op — pattern does not exist in source. Site 1 str_replace at L8966 is the complete fix. |
| §7 build script L43 pre-state | `<title>SPOT R1.6.4</title>` | `<title>SPOT R1.5.11</title>`. R1.6.0 / .1 / .2 / .3 / .4 ships never bumped this static title (jsx L3300 dynamically replaces it post-mount). Bumped to R1.6.4.1 in this ship — six-cycle catch-up. |
| §8 jsx line count post-patch | 8977 → 8977 (zero net delta) | 8977 → 8981 (+4 lines for the D-143 callout block at jsx L5–8 per §1 attribution discipline). |
| §13 sentinel grep target | `grep -c "setParseResult(null);setParseFieldChecks({})" spot_r1_5.jsx` returns ≥ 2 | Returns 1 — matches one-site reality. |

**Final post-patch SHAs (R1.6.4.1):**

| File | Lines | SHA-16 |
|---|---|---|
| spot_r1_5.jsx | 8981 | 727364fcc7b211bb |
| build_spot_r1_5.js | 60 | 3ef77a4523af8bbe |
| SPOT_R1.5.html | 28030 | f5dc3e70f02b725b |

**Process improvement:** PK search results that include legacy built HTML
(`SPOT_R1.5.html`) alongside live source (`spot_r1_5.jsx`) can produce
phantom-site false positives when scoping JSX edits. Future design docs
that rely on PK search to enumerate edit sites should explicitly grep the
live source file in isolation (e.g., `grep -c PATTERN spot_r1_5.jsx`)
before publishing site counts. Build artifacts are not source.
