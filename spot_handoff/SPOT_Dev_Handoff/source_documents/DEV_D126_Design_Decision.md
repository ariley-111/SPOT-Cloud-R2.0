# D-126 — estNum Regex Hotfix for Personalized Initials

**Status:** SHIPPED in R1.5.7.1 · 2026-04-27
**Affects:** `spot_server.js` (server-side validation regex)
**Triggered by:** R1.5.7 Phase 1 drop-zone smoke test failure on first attempted upload

---

## What Broke

R1.5.7 shipped `/archive/upload` with an estNum validation regex that rejected real-world estNums:

```js
// Bug R1.5.7
const EST_NUM_RX = /^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$/;
```

This pattern assumed initials of 2–4 uppercase letters and a 3-digit time segment. Both assumptions were wrong in source:

1. `generateEstNum()` in `spot_r1_5.jsx` produces estNums of the form `${initials}-${YYMMDD}-${HHMMSS}` — a **6-digit** time segment, not 3.
2. Initials may include digits and underscores when an estimator personalizes them (e.g., `POP_TST` for "Pop Test").

Result: every upload attempt during the first user smoke test returned `400 valid estNum required`.

## What Shipped

```js
// D-126 hotfix (R1.5.7.1)
const EST_NUM_RX = /^[A-Za-z0-9_]{1,16}-\d{6}-\d{6}(-\d+)?$/;
```

Aligns to the actual `generateEstNum()` output format. Allows letters, digits, and underscores in initials (1–16 chars), and the 6-digit `HHMMSS` segment. The optional `-N` suffix from `uniqueEstNum()` collision dedupe is preserved.

## Verification

Smoke-tested with three real estNums after fix:
- `SPC-260427-014530` ✓
- `MEM-260426-213901` ✓
- `POP_TST-260416-113823` ✓

Server source: `spot_server.js` line ~57.

## Closed Notes

- No JSX change required — UI-side estNum format was always correct; only server-side validation was wrong.
- No migration concern — old uploads from R1.5.7 (zero, since it was broken) don't exist.
