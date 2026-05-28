# D-121 Design Decision — Bobst Route Addition

**Status:** SHIPPED 2026-04-26
**Version bump:** R1.5.4 → R1.5.5
**Spec source:** `DEV_D121_Kickoff_Brief.md` (locked 2026-04-26 evening, no follow-up questions)
**Calibration:** Uncalibrated placeholder. Recalibrate after ~90 days of shop-floor data.

---

## 1. Problem Statement

Standard Printing's R1.5.4 estimating engine supported two die-cutting routes: **CAD** (large-format, hourly-driven, high difficulty buckets) and **Crest** (mid-format, 60×120 max, Standard/Advanced complexity). A third die-cutter — **Bobst** — handles small-format, thin-flute work at high speed but had no path through SPOT. Operators forced to either (a) over-quote on CAD/Crest hourly math or (b) skip SPOT and quote by hand.

D-121 adds Bobst as a first-class route alongside CAD and Crest, with auto-routing, force-route override, route-comparison panel integration, and a route-specific die-cost default.

---

## 2. Bobst Pricing Parameters (uncalibrated, ship as placeholder)

| Parameter | Bobst | Crest (contrast) |
|---|---|---|
| Hourly rate | **$350/hr** | $45/hr |
| Setup time | **45 min flat** (no Std/Adv) | 45 min Std / 90 min Adv |
| Run speed | **3,000 sh/hr** | 150 sh/hr |
| Default die cost | **$1,800** | **$1,200** (was $0 estimator placeholder; D-121 makes both routes parameterized) |
| Minimum charge | **$250** | $0 |
| Difficulty buckets | **None — flat pricing** | Std/Adv |

**Calibration note:** Cannot be derived from the 785-job iQuote fleet — zero historical SPC E-flute jobs would fit Bobst's 41.75×29.125 envelope (every E-flute job in fleet ran on 48×96, 60×120, 63×126, 50×117, or 63×98 sheets, all too large for Bobst). $350/hr is a defensible mid-range placeholder between cost-accounting math ($135–270/hr) and premium positioning ($750/hr considered, rejected as too aggressive). Per user direction: ship and recalibrate against actual production data after ~90 days. **No fleet regression is run for D-121.**

---

## 3. Eligibility Rules

### Flute (hard physical constraint)
- **E or F flute only.** B/C flute exceeds Bobst's 0.060″ caliper limit (B is ~0.125″).
- _History note: backlog originally said E only; corrected during scoping to E or F._

### Sheet envelope
- **Minimum:** ≥ 13.78″ × 15.75″
- **Maximum:** ≤ 41.75″ × 29.125″ (max die-cut with gripper allowance)
- First dimension (W) is corrugation direction — same orientation rule as Crest.

### NexPress
- **Not enforced in code.** Per user: "i didnt ask for a nexpress field." Estimator concern only.

---

## 4. Auto-Route Preference Order

When all three routes are viable for a job: **Bobst → Crest → CAD**

`autoRoute()` checks Bobst eligibility (flute + envelope) FIRST, before the existing CAD `cadHrs<=8` shortcut. If Bobst-eligible:

1. Try custom-imposition Bobst sheet at the optimal layout.
2. If board not pricable at that custom size, scan stock sheets within Bobst envelope.
3. Otherwise fall through to existing CAD/Crest/Saber logic unchanged.

Bobst-ineligible jobs (B/C flute or oversize) skip the entire Bobst block — CAD/Crest behavior is unchanged for the rest of the fleet.

---

## 5. Force-Route Behavior (hard-block validation)

The `Bobst` tile in the route selector calls `tryForceBobst()`:

| Condition | Behavior |
|---|---|
| Flute is B or C | **Hard block.** Toast: `Bobst cannot handle ${flute} flute — physical constraint, force ignored`. `routeOverride` unchanged. |
| Sheet outside envelope | **Hard block.** Toast: `Sheet outside Bobst envelope (max 41.75×29.125)`. `routeOverride` unchanged. |
| E/F flute + valid sheet | Apply override normally. `setRouteOverride("Bobst")`. |

These are hard blocks (not warnings) — the constraint is physical, not preferential.

---

## 6. D-085 Die Auto-Default Extension

D-085 (Crest auto-default die cost) extended to handle three routes AND parameterize Crest's default:

- New variable `anyDieRoute = anyCrest || anyBobst` keys the existing useEffect.
- Both die-required routes now use parameterized RATE_DEFAULTS values (was: Crest hardcoded "0"):
  - **Bobst:** `bobstDieCost` ($1,800)
  - **Crest:** `crestDieCost` ($1,200) — **new default; was $0 estimator placeholder pre-D-121**
- Route-specific toast (unified format): `Die added — ${route} routing requires a steel die ($${default} default)`
- Transition Crest↔Bobst leaves die cost alone (no auto-overwrite).
- Reverting to CAD still clears the die.

`dieMissing` flag now keys off `anyDieRoute` instead of `anyCrest`.

**Why parameterize Crest's default now:** Pre-D-121 the trigger hardcoded `setDieCost("0")` to force estimator entry. Operations confirmed $1,200 is the realistic default for Crest dies on typical SPC work. Adding `crestDieCost` to RATE_DEFAULTS mirrors the `bobstDieCost` pattern introduced in this same change — both routes now follow the same parameterized auto-default flow, and operators can adjust either default in Advanced Rates.

**`compareRoutes` Crest die fallback:** When the user hasn't entered a die cost AND there are no rule inches to compute an estimate, the comparison panel previously fell back to a hardcoded $800. D-121 changes this to `asmp.crestDieCost` ($1,200), keeping the comparison panel and the die auto-default consistent.

---

## 7. Route Comparison Panel (D-090 extension)

`compareRoutes()` extended to compute a third **Bobst** column when eligible:

- New return fields: `bobst:{w,l,pps,req,board,press,cut,hrs,die,dieEstimated,total,isStock}` or `null` when ineligible.
- New return field: `bobstReason` — human-readable string when `bobst===null` (e.g., "B flute exceeds Bobst's 0.060″ caliper limit").
- Winner logic: smallest of `cad.total`, `crest.total`, `bobst.total` (when eligible).
- Grid switches from `1fr 1fr 1fr` (1 label + CAD + Crest) to `1fr 1fr 1fr 1fr` (1 label + CAD + Crest + Bobst) when eligible.
- Below the data rows, `Bobst not viable: <reason>` rendered when `bobst===null`.
- `Switch to Bobst` button appears when Bobst is eligible and route not yet forced. Same UX pattern as `Switch to Crest`/`Switch to CAD`. On click: forces Bobst, sets die default to $1,800 (or rounded estimate from comparison if higher), closes panel, toasts confirmation.

Crest break-even / die-cost summary lines unchanged (CAD↔Crest analysis remains the primary economic driver for jobs where Bobst isn't eligible).

---

## 8. JSON Schema

`gatherState()` now includes:

```json
{
  "crestDieCost":"1200",
  "bobstRate":"350",
  "bobstSpeed":"3000",
  "bobstSetup":"45",
  "bobstMinChg":"250",
  "bobstDieCost":"1800",
  "routeOverride":"Bobst",
  "...":"..."
}
```

`routeOverride` accepts: `null` | `"CAD"` | `"Crest"` | `"Bobst"`.

`applyState()` restores `crestDieCost` and all five `bobst*` fields with the same `if(s.X)setX(s.X)` pattern as Crest rates.

**Rate migration block (D-080 reset-first):** `_ck` array extended to include `crestDieCost`, `bobstRate`, `bobstSpeed`, `bobstSetup`, `bobstMinChg`, `bobstDieCost`. When migration fires, all six new rate parameters reset to `RATE_DEFAULTS`.

**newEstimate seed:** `crestDieCost` and Bobst rates carry over to new tabs alongside Crest rates.

Pre-D-121 JSONs load cleanly — absent `crestDieCost` and `bobst*` keys leave the `useState` defaults from `RATE_DEFAULTS` in place.

---

## 9. Engine Math (calcWF)

New `route==="Bobst"` branch in both `spot_r1_5.jsx` and `spot_engine.js`:

```js
} else if (route==="Bobst") {
  const setupMin = pn(asmp.bobstSetup)||45;
  const effSpeed = pn(asmp.bobstSpeed)||3000;
  const runtimeHr = convSheets>0&&effSpeed>0 ? convSheets/effSpeed : 0;
  cadHrs = setupMin/60 + runtimeHr;
  cutterDirect = Math.max(cadHrs*(pn(asmp.bobstRate)||350), pn(asmp.bobstMinCharge)||0);
  cutterBasis = `Bobst flat, ${fn(convSheets,0,0)} ${saberOn?"blanks":"sheets"} @ ${fn(effSpeed,0,0)} sh/hr`;
}
```

Mirrors Crest pattern minus the Std/Adv branching. No `bobstAdvSpeedFactor`, no complexity dropdown, no per-piece rule-inches calculation.

**asmp object (JSX):** Five new `bobst*` fields included in `asmp` `useMemo` body and dependency array.

---

## 10. Force-Route UI Extension

Route tile group (Auto / CAD / Crest) gains a fourth tile: **Bobst**. Tint color `#a855f7` (purple) when forced, `#22d3ee` (auto cyan) when auto-picked. Click handler routes through `tryForceBobst()` for hard-block validation.

`autoPickedBobst = autoOn && autoPickedRt === "Bobst"` mirrors `autoPickedCrest`/`autoPickedCAD`.

The Crest Std/Adv complexity selector renders only when active row's route is Crest — does NOT extend to Bobst (no Std/Adv on Bobst).

---

## 11. Cost Report Label

Cut row label extended to render `Bobst` when `effRt === "Bobst"`:

```js
effRt==="Saber + D/C" ? "Saber→D/C"
  : effRt==="Crest" ? "Crest"
  : effRt==="Bobst" ? "Bobst"
  : `CAD ${cadDifficulty}`
```

Route-color tint extended: `effRt==="Bobst" ? "#a855f7" : ...`

`warn` flag fires when route is Crest OR Bobst with `routeOverride` active (i.e., user forced).

---

## 12. Smoke Test Result

5,000-sheet × 4-up E-flute job, `dieTreatment="Separate Line"`:

| Route | cadHrs | cutterDirect |
|---|---|---|
| Bobst | 2.42 | $845.83 |
| Crest | 34.08 | $1,533.75 |

Math: Bobst = (45/60 + 5000/3000) × $350 = 2.417 × $350 = $846 (matches to the cent). Crest = (45/60 + 5000/150) × $45 = $1,534 (matches). **Bobst is $688 cheaper than Crest at this scale** for the cut step alone — production-economics-correct given Bobst's 20× speed advantage.

---

## 13. Calibration Status (uncalibrated, recalibrate at 90 days)

D-121 ships Bobst pricing as a **planned deviation** under the D-110 calibration framework:

- Cost class: **P (Planned)** — known parameter selected without fleet validation.
- Sell-side impact: unknown until shop-floor utilization data accumulates.
- Fleet regression: **not run** — zero historical jobs route to Bobst's envelope.
- Recalibration trigger: 90 days post-deploy OR ≥30 Bobst jobs on the floor, whichever comes first.

**Hard constraint preserved:** Standard tier still held at 1.00× difficulty multiplier per D-099 (785-job R² 0.974). Bobst doesn't touch the calibrated CAD/Crest math.

`DEV_Calibration_Framework_v2.md` updated with Bobst-uncalibrated entry.

---

## 14. Out of Scope (deferred)

- NexPress sheet-size enforcement / `printedOn` field (estimator-managed, not engineered into code per user spec)
- Difficulty-bucket plumbing for Bobst (deliberately omitted — flat pricing model)
- Fleet regression on Bobst routes (no historical baseline to regress against)
- Bobst-specific QC/print-quality flags (covered by general printMode logic)

---

## 15. Files Changed

| File | L (before → after) | SHA before → after |
|---|---|---|
| `spot_r1_5.jsx` | 7654 → 7844 | `6abf9ab182035cb7` → `1eeaf544b8d3d499` |
| `spot_engine.js` | 1001 → 1021 | `51992bba2682de1f` → `83b4f47609240791` |
| `spot_runner.js` | 352 → 356 | `e5af029ca5bf979c` → `cbfd913390e6d7a2` |
| `build_spot_r1_5.js` | 57 → 57 | `5f5aed3afa23d913` → `d7a0895e5345c5e7` (HTML title R1.5.4 → R1.5.5) |
| `SPOT_R1.5.html` | — | `a7f985db9598d475` → `71fd99ecc125ee73` |

`spot_server.js` unchanged.

**Version strings bumped R1.5.4 → R1.5.5 in 5 sites:**
- `spot_r1_5.jsx` line 4 (header comment)
- `spot_r1_5.jsx` line 6 (`window.__SPOT_UI_VERSION`)
- `spot_r1_5.jsx` line 2863 (browser tab title)
- `spot_r1_5.jsx` line 4552 (UI badge)
- `build_spot_r1_5.js` line 43 (HTML `<title>`)

---

## 16. Tests Filed

- **TC-029** — D-121 Bobst route addition validation. 14 sub-cases covering eligibility detection, auto-route preference, force-route hard-blocks, comparison panel rendering, die auto-default route-specific behavior, JSON round-trip, and rate migration.
