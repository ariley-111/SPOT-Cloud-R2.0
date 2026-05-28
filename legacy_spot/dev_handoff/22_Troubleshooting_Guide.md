# 22 — Troubleshooting Guide

Symptom → cause → fix, for the most common SPOT failure modes. Organized by where the user notices the problem.

---

## Server-side problems

### S1 — Server won't start

**Symptom:**
```
$ node spot_server.js
Error: listen EADDRINUSE :::3100
```

**Cause:** another process on port 3100.

**Fix:**
```bash
# Find it
lsof -i :3100        # Mac/Linux
netstat -ano | findstr :3100   # Windows

# Kill it
kill -9 <pid>        # Mac/Linux
taskkill /F /PID <pid>   # Windows

# Restart
node spot_server.js
```

If you can't find the process, reboot. Sometimes Node hangs in zombie state.

---

### S2 — `/est/parse-rfq` returns NO_KEY

**Symptom:**
```json
{"error": "ANTHROPIC_API_KEY not configured", "code": "NO_KEY"}
```

**Cause:** no API key in any of the three lookup locations.

**Fix:** drop a key into one of:
1. `.env` file: `ANTHROPIC_API_KEY=sk-ant-...`
2. `anthropic_key.txt` (single-line, just the key)
3. Pass `apiKey` in the request body (testing only — not for production)

Then call `POST /est/reload-key` to refresh without restarting.

---

### S3 — `/est/parse-rfq` returns CAP_REACHED

**Symptom:**
```json
{"error": "monthly cap reached ($100.00 of $100.00)", "code": "CAP_REACHED"}
```

**Cause:** monthly spend hit the cap.

**Fix:** edit `parser_budget.json` either by raising the cap or by manually resetting the counter at month rollover. Per `spot_server.js`, the cap check is hard:
```javascript
if (budget.monthlySpendUsd >= budget.cap) throw new Error("monthly cap reached");
```

There is no override flag. To bypass for one call, raise the cap, parse, then restore.

---

### S4 — Server hangs on parser call

**Symptom:** `POST /est/parse-rfq` hangs indefinitely, no response.

**Cause:** usually network — DNS, proxy, or Anthropic API outage.

**Fix:**
1. Check Anthropic status page.
2. Try a direct curl to `api.anthropic.com`.
3. Check firewall — corporate networks sometimes block outbound 443 to specific endpoints.
4. Inspect server stdout — successful calls log per-file token counts; failed calls usually log an error before hanging.

---

### S5 — UTS freight API returns garbage / 5xx

**Symptom:** freight panel shows "API error" or an obviously wrong rate.

**Cause:** UTS API is third-party, occasionally flaky.

**Fix:**
1. SPCOC local zones don't depend on UTS — for Canton/Akron/Cleveland under-10K lb shipments, the gate at D-119 bypasses UTS entirely.
2. For out-of-zone shipments, manual freight is the fallback — the 15% markup is editable.
3. Retry — UTS errors are often transient.

---

## Build / deploy problems

### B1 — `node build_spot_r1_5.js` fails

**Symptom:**
```
SyntaxError: Unexpected token (1234:5)
```

**Cause:** invalid JSX in `spot_r1_5.jsx`.

**Fix:** the error line/col is approximate (Babel reports post-transform). Look for the closest balanced-braces / balanced-parens issue near the reported line. Common culprits:
- Missing closing `</Tag>`.
- JSX expression without braces: `<div>{value}</div>` not `<div>value</div>`.
- Trailing commas in function args (allowed in modern JS, but Babel IE11 mode may choke).

---

### B2 — Build succeeds but HTML is missing chunks

**Symptom:** browser shows partial UI; console has React errors.

**Cause:** `build_spot_r1_5.js` wrote a partial file. Usually a disk-full or permission issue.

**Fix:**
1. Check disk space.
2. Check write permission on the output directory.
3. Confirm build script ran to completion — it should print "Build OK" or similar at the end.
4. Diff the built HTML against a known-good version — look for truncation.

---

### B3 — `install.bat` fails on a clean machine

**Symptom:** install script exits with an error code.

**Cause:** usually missing dependency or wrong Node version.

**Fix:**
1. Node 18+ required (per `package.json` engines).
2. `npm install` must complete cleanly — check for `node_modules` after install.
3. Required runtime files: `customerList.csv`, `customerList.xlsx`, `spc_logo.png`. Without these, the install doesn't function (per project memory note).
4. Check `make_shortcut.vbs` — needs `WScript.Shell` ActiveX, available on all Windows by default.

---

### B4 — Desktop shortcut has wrong icon

**Symptom:** SPOT shortcut appears with the generic .bat icon, not the CMYK cube icon.

**Cause:** `spot.ico` missing or path mismatch in `make_shortcut.vbs`.

**Fix:** drop `spot.ico` into the install directory (3192-byte CMYK cube). The path in `make_shortcut.vbs` resolves to `%~dp0spot.ico` — adjust if your install layout differs.

---

## UI problems

### U1 — App loads but panels are blank

**Symptom:** SPOT title bar shows, but the main panels are empty.

**Cause:** React error during initial render. Check console.

**Fix:** open browser devtools → Console. The first red error is your starting point. Common causes:
- Bad localStorage state (try clearing `wftabs` and reloading)
- Bad RATE_DEFAULTS migration (older saved data references removed keys)
- Babel runtime error during JSX execution

---

### U2 — Qty pricing grid is empty after load

**Symptom:** quote loaded, but the qty grid below shows no rows.

**Cause:** `qtys` array missing from the loaded state, or all qtys are 0.

**Fix:**
- Verify the saved JSON has `prod.qtys` or `item.qtys` (depending on shape).
- Default in `applyState`: `qtys = qtys || [1000, 2500, 5000, 10000, 25000]`.
- Check the Multi-Part qty grid is per-item, not top-level.

---

### U3 — Save Estimate succeeds but doesn't appear in load dropdown

**Symptom:** "Saved!" toast shows, but the saved estimates list doesn't include the new entry.

**Cause:** `wftabest{timestamp}` key written but tab/quote index not updated.

**Fix:**
- Check localStorage in devtools — does `wftabest{timestamp}` exist?
- If yes: index update failed. Reload the page; the index should rebuild from existing keys.
- If no: the save action failed silently. Check console for storage quota errors.

---

### U4 — Parse modal shows raw JSON instead of fields

**Symptom:** parsed RFQ opens the modal, but the content is JSON text, not styled fields.

**Cause:** parser returned malformed JSON (or extra text around it).

**Fix:**
- Inspect the modal's "raw response" panel for the actual API output.
- Common cause: model returned markdown fences (```json ... ```) — the parser-side JSON.parse fails.
- The server has a fence-stripping pass; if it's failing, check `spot_server.js` around the response handling.
- Retry the parse — token sampling can cause this occasionally.

---

### U5 — Multi-Part components don't sum correctly

**Symptom:** Matched Set total ≠ sum of component costs.

**Cause:** `pcsPerSet` ratio mismatch, or job-level allocation applied incorrectly.

**Fix:**
- Verify each component's `pcsPerSet` is correct.
- For `Matched Set`, total = sum of all (cost at qty * pcsPerSet) divided by N sets, then × (1 + setMarginPct).
- For `Individual`, total = sum of each component's independent cost × (1 + gmTier margin).
- Job-level allocated costs (CAD die for shared use) should split across MFG items only — FUL items get 0.

---

### U6 — Wrong customer code on quote

**Symptom:** parsed customer doesn't match customerList.csv entry.

**Cause:** parser fuzzy match picked the wrong one, or the cust name is genuinely ambiguous.

**Fix:**
- Check `sources.custCode` — if `REGISTRY`, the parser made an automated choice.
- Edit `parsed.custName` to the canonical name from customerList.csv (`cust_name` column) and re-apply; the parser will resolve cleanly.
- For ambiguous matches, the parser should leave `custCode = null` and add an ask. If it doesn't, that's a parser regression.

---

## Calculation problems

### C1 — Quote is dramatically higher than expected

**Symptom:** quote total is ~2× what historical data suggests.

**Cause:** likely a canonical-engine-value mismatch (D-146 class).

**Fix:**
- Check liner/medium values in the JSON. The engine expects `"None"` for unspecified Kraft liners. If a JSON has `"Kraft"`, the engine treats it as an upgrade and adds cost.
- Check `outsideLiner` and `insideLiner` defaults — they should be `"None"` unless explicitly upgraded.
- Re-parse the RFQ with the canonical-terms registry properly resolving "Kraft" → "None".

---

### C2 — Route flipped unexpectedly

**Symptom:** identical RFQ now routes Crest instead of CAD (or vice versa).

**Cause:** `cadHrs` calculation changed because:
- `totalRuleInches` updated (real CAD file landed)
- `cadSetupMinutes` changed (complexity rating shifted)
- `cadSpeedInPerMin` changed (recalibration)

**Fix:** trace `cadHrs` calculation in the deep dive (file 17 Step 5). Identify which input changed. If unintended, revert; if intended, document in release history.

---

### C3 — Mill min fired unexpectedly

**Symptom:** quote shows mill-min scaling on what should be a stock sheet job.

**Cause:** stock-bypass (D-067) not applied. The board lookup ran in custom mode.

**Fix:**
- Verify `autoSelectSheet` is returning a stock sheet (not building a custom one).
- Custom sheets carry full mill min — that's expected. Only stock sheets bypass.
- Check `APPROVED_SHEETS` — is there a stock sheet that matches the spec? If not, the engine had no choice but to go custom.

---

### C4 — Freight is way off

**Symptom:** freight shows $1200 for a Canton-to-Akron job that should be $70.

**Cause:** SPCOC gate failed — either weight > 10K lbs, trailer ft > 24, or destination ZIP didn't match.

**Fix:**
- Print `totalWeight`, `trailerFt`, and `destZip` to debug.
- ZIP zone definitions are in `spot_server.js` near the SPCOC handling.
- If gates fail, the UTS API fires for outside freight quote — verify the UTS response is reasonable.

---

### C5 — GM target wrong for the qty

**Symptom:** quote at 10 MSF showing 32% margin (should be 25%).

**Cause:** `pricingTargets.gmPerMsfTier` not updated, or `getGmMsfTier` returning wrong tier.

**Fix:**
- Print the computed MSF and the tier name from `getGmMsfTier`.
- Verify `pricingTargets.gmPerMsfTier["10+"]` equals 0.25 (current calibration).
- If user overrode the default targets, those override applies for that quote only.

---

## Session / state problems

### X1 — Tab list is gone

**Symptom:** opened SPOT, tab dropdown is empty even though I had quotes saved.

**Cause:** localStorage cleared, or `wftabs` key corrupted.

**Fix:**
- Open devtools → Application → Local Storage. Look for `wftab*` keys.
- If `wftabs` is missing or invalid JSON, rebuild it by scanning all `wftab{id}` keys.
- Manual recovery: `localStorage.setItem("wftabs", JSON.stringify(["tab-1", "tab-2"]))`.

---

### X2 — Estimator initials reverted to "SPC" after editing

**Symptom:** typed "MM" in the initials field, it snapped back to "SPC".

**Cause:** AI-parse mode locks initials to "SPC" (Rule 2). The field has a readonly guard.

**Fix:** this is correct behavior. To change initials, the quote must be in manual mode, not AI-parsed mode. Some workflows allow override after the fact — check the audit panel for the source.

---

### X3 — Audit log missing for a field I edited

**Symptom:** changed a field, but the audit log doesn't show the edit.

**Cause:** the input field's onChange didn't call `logEdit`.

**Fix:** this is a bug. Search for the input's onChange handler and add the logEdit call. Pattern in file 21 (Pattern 10).

---

### X4 — Estimate appears in tab but won't load

**Symptom:** tab dropdown lists the quote, but clicking it does nothing.

**Cause:** the `wftab{id}` key has corrupted JSON.

**Fix:**
- Devtools → Application → Local Storage → find the key.
- Try to JSON.parse the value manually. If it throws, the data is unrecoverable from that key.
- If a `wftabest{timestamp}` snapshot exists for that quote, load from snapshot instead.

---

## "Going in circles" — when you're losing time

If you've been on the same bug for >30 minutes, you've likely missed one of these:

1. **PK drift** — the project knowledge mount doesn't reflect current PK state. Use `project_knowledge_search`, not `/mnt/project/`.
2. **ENGINE drift** — JSX and `spot_engine.js` have diverged. The drift detector should have caught this; if it didn't, run it manually.
3. **TDZ hoisting (Pattern 1)** — a `useMemo` is silently using `undefined` for a variable declared later.
4. **Reset-first violation (Pattern 2)** — state is merging instead of replacing.
5. **String/number type confusion (Pattern 6)** — `"4" === 4` is false; check your comparison.
6. **Three-state boolean (Pattern 7)** — `"false"` is truthy.

When stuck: stop coding. Read the deep-dive doc for the subsystem. Diagnose. Then code.

---

## When to escalate

Some problems aren't dev-fixable from inside the codebase. Stop and ask Michael:

- **Calibration changes** — any rate, GM curve, or routing threshold change needs Michael's sign-off. Document the proposed change in a design decision file (`DEV_D<num>_Design_Decision.md`).
- **Domain rule changes** — anything that affects how SPC prices jobs. Domain rules live in `EST_SPOT_Quoting_Rules.md` and require business approval.
- **Anthropic API key issues** — key rotation, billing, model selection. These are operational, not dev.
- **Customer data corrections** — `customerList.csv` updates come from SPC's CRM source. Don't edit directly.

---

**Next:** read file 23 for the first-week onboarding plan.
