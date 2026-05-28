# D-122 Design Decision — Advanced Rates UI Inputs for Crest Die + Bobst Rates

**Status:** DESIGN — bundled with D-123 patch ship (R1.5.6)
**Filed:** 2026-04-26
**Spec source:** `DEV_D121_Design_Decision.md` audit §6.1 (operator-flagged 2026-04-26)
**Predecessor:** D-121 (state + JSON wiring shipped, UI inputs deferred)
**Target version:** R1.5.6 (with D-123)
**Calibration:** No math change.

---

## 1. Problem Statement

D-121 added six new rate parameters to `RATE_DEFAULTS`, `useState`, `gatherState`, and `applyState`:

```
crestDieCost, bobstRate, bobstSpeed, bobstSetup, bobstMinChg, bobstDieCost
```

State, JSON, and migration plumbing all shipped. The Advanced Rates UI panel was not extended — these six values are reachable only by editing JSON or letting `RATE_DEFAULTS` apply. Operators cannot tune them without leaving the app.

The D-121 sign-off audit §6.1 estimated 30 minutes to add the inputs using the existing `<F l="Crest $/Hr">` pattern.

---

## 2. Decision

Add six `<F l="..."><Num value={...} onChange={...} ... /></F>` blocks in the existing **Cutting** section of Advanced Rates (jsx L5608-5625). Pattern matches `crestRate`, `crestSetupStd`, `crestSetupAdv`, etc. — same `Num` component, same styling, same grid placement.

If D-123 ships in the same release (recommended), append a seventh field for `bobstFirstSizing` as a tile pair (On/Off) — mirrors the existing `Default Print` Gloss/Satin tile pair at jsx L5597.

---

## 3. UI Layout (Cutting Section)

After existing `crestAdvSpeedFactor` row (jsx L5619), append:

```jsx
<F l="Crest Die Default $" t={t}><Num value={crestDieCost} onChange={setCrestDieCost} step="50" min="0" style={{padding:"5px 8px",fontSize:12}} /></F>
<F l="Bobst $/Hr" t={t}><Num value={bobstRate} onChange={setBobstRate} style={{padding:"5px 8px",fontSize:12}} /></F>
<F l="Bobst Min $" t={t}><Num value={bobstMinChg} onChange={setBobstMinChg} style={{padding:"5px 8px",fontSize:12}} /></F>
<F l="Bobst Speed sh/hr" t={t}><Num value={bobstSpeed} onChange={setBobstSpeed} style={{padding:"5px 8px",fontSize:12}} /></F>
<F l="Bobst Setup min" t={t}><Num value={bobstSetup} onChange={setBobstSetup} step="1" min="0" style={{padding:"5px 8px",fontSize:12}} /></F>
<F l="Bobst Die Default $" t={t}><Num value={bobstDieCost} onChange={setBobstDieCost} step="50" min="0" style={{padding:"5px 8px",fontSize:12}} /></F>
```

If D-123 bundled (recommended):

```jsx
<F l="Bobst-First Sizing" t={t} inline>
  <div style={{display:"flex",gap:2}}>
    <Tile label="On" active={bobstFirstSizing==="true"} onClick={()=>setBobstFirstSizing("true")} t={t} small tint="#a855f7" />
    <Tile label="Off" active={bobstFirstSizing==="false"} onClick={()=>setBobstFirstSizing("false")} t={t} small tint="#a855f7" />
  </div>
</F>
```

Field ordering rationale: groups by route ($/Hr → Min $ → Speed → Setup → Die Default) for visual scan-ability, mirrors how Crest is laid out at L5614-5619. `bobstMinChg` follows `bobstRate` to mirror the existing `crestRate / crestMinChg` pairing.

Grid stays `1fr 1fr 1fr` (3-column), so the new fields naturally flow into rows 5-7 of the Cutting section.

---

## 4. Behavior

- All six Bobst/Crest-die inputs are plain `Num` components — editable, type=number, immediate state update via setter.
- Values flow through to `asmp` `useMemo` (already wired from D-121, jsx L2410-2411 included in the dep array).
- Edits persist via the existing `localStorage` rate-preserve pattern when the operator saves the estimate or via JSON export.
- Reset-to-defaults button (existing `_D = RATE_DEFAULTS` apply path at jsx L2475 / L2596) already restores all six fields per D-121.
- `bobstFirstSizing` toggle (D-123) follows same plumbing pattern; default `"true"`.

---

## 5. Validation

After deploy:
1. Open Advanced Rates panel. Confirm 6 new fields appear in Cutting section.
2. Edit `bobstRate` from 350 → 400. Confirm new estimate run produces `bCut = (45/60 + bReq/3000) × $400` instead of × $350.
3. Edit `bobstSpeed` from 3000 → 2500. Confirm run-time component scales accordingly.
4. Reset to defaults. Confirm all six fields return to RATE_DEFAULTS values.
5. Export JSON. Confirm all six keys present in payload.
6. Re-import JSON. Confirm fields restore.
7. (D-123 bundled) Toggle Bobst-First Sizing Off → re-run E-flute 8×10 / 5K. Confirm Bobst column reverts to "not viable" per legacy D-121 behavior.

---

## 6. Files Changed

| File | L (before → after) | Notes |
|---|---|---|
| `spot_r1_5.jsx` | (delta merged with D-123) | +6 to +7 lines in Cutting section of Advanced Rates panel |

No other files affected. State/JSON/migration plumbing already shipped in D-121.

---

## 7. Tests Filed

### TC-031 — D-122 Advanced Rates UI inputs validation (3 sub-cases, R1.5.6 target)

| Sub-case | Test |
|---|---|
| .1 | All 6 inputs (`crestDieCost`, `bobstRate`, `bobstSpeed`, `bobstSetup`, `bobstMinChg`, `bobstDieCost`) present in Cutting section. Default values match RATE_DEFAULTS (1200/350/3000/45/250/1800). |
| .2 | Edit each input, run estimate. Confirm `asmp` reflects edit and engine math uses new value (sample one: edit `bobstRate` 350→500, confirm Bobst column total in compareRoutes increases by `bCutHrs × $150`). |
| .3 | Reset-to-defaults restores all 6 fields to RATE_DEFAULTS values. JSON export+import round-trips all 6. |

### TC-030.6 (D-123 bundled) — Bobst-First Sizing toggle UI

| Sub-case | Test |
|---|---|
| .6 | Toggle visible in Advanced Rates / Cutting section. Default "On". Switching to "Off" + re-run TC-030.1 produces TC-030.2 output (3 columns, Bobst not viable). |

---

**Hand-off:** bundle with D-123 ship. Single atomic R1.5.6 release containing both design decisions and one JSX patch.
