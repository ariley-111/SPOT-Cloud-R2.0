# 20 — Deep Dive: Multi-Part Schema

When an RFQ describes a corrugated **display, kit, or set** of pieces — header card + base + shelves + shipper — SPOT treats it as a **Multi-Part quote**. This file walks the schema, the pricing modes, and the operational quirks.

---

## When Multi-Part fires

Per the parser prompt (file 19) and per `EST_SPOT_Intake_Harness.md`:
- Any RFQ with display vocabulary (PDQ, sidekick, endcap, header card, topper, base, riser, tray, divider, master shipper)
- Multiple part numbers / SKUs in one RFQ
- Explicit "set of N" or "kit" with components listed
- Estimator clicks **"Convert to Multi-Part"** in the UI

It does **not** fire just because there are multiple colors, multiple dies, or multiple ship-tos. One physical piece stays Simple.

---

## The shape

A Multi-Part quote is a top-level intake with a `bomItems` array attached:

```javascript
{
  // ─── IDENTITY (job-level) ───
  custName: "Acme Display Co.",
  custCode: "ACME001",
  custIdent: "DISPLAY-2026-Q3",
  custRef: "PO 47291",
  itemDesc: "Q3 Retail Display Set",
  estInitials: "SPC",
  
  // ─── MODE FLAGS ───
  quoteType: "Multi-Part",
  pricingMode: "Matched Set",        // "Matched Set" | "Individual"
  setMarginPct: "0.40",              // Matched Set only
  
  // ─── ACTIVE-ITEM MIRROR ───
  // These mirror bomItems[activeIndex].state so the UI shows
  // the current item's values in the main panels.
  boxStyle: "Display Header",
  flute: "B",
  boardGrade: "32 ECT",
  outsideLiner: "Mottled White",
  insideLiner: "None",
  medium: "None",
  oneUpW: 18,
  oneUpL: 24,
  qtys: [500, 1000, 2500, 5000, 10000],
  printReq: "yes",
  printMode: "Digital",
  printSides: "1",
  // ... all other intake fields
  
  // ─── JOB-LEVEL FREIGHT / FOB ───
  fobMode: "Origin",
  destZip: "44101",
  under5MsfFee: "0",
  
  // ─── COMPONENTS ───
  bomItems: [
    {
      id: "item-1",
      desc: "Header Card",
      custIdent: "HC-001",
      type: "Manufactured",
      pcsPerSet: 1,
      state: { /* full intake state for this component */ },
      confidence: 0.92
    },
    {
      id: "item-2",
      desc: "Base Tray",
      custIdent: "BT-001",
      type: "Manufactured",
      pcsPerSet: 1,
      state: { ... },
      confidence: 0.88
    },
    {
      id: "item-3",
      desc: "Shelf",
      custIdent: "SH-001",
      type: "Manufactured",
      pcsPerSet: 3,                  // 3 shelves per display
      state: { ... },
      confidence: 0.85
    },
    {
      id: "item-4",
      desc: "Master Shipper",
      custIdent: "MS-001",
      type: "Manufactured",
      pcsPerSet: 1,
      state: { ... },
      confidence: 0.95
    }
  ]
}
```

---

## The two pricing modes

### Matched Set (default for displays/kits)

The customer wants **one price per set**. Each set contains all the components in their `pcsPerSet` ratios. The customer orders N sets; we produce N×ratios of each component.

**Math:**
```
For order qty = N sets:
  componentQty[i]   = N * bomItems[i].pcsPerSet
  componentCost[i]  = full pricing pipeline at componentQty[i]
  jobCost           = Σ componentCost[i]
  setCost           = jobCost / N
  setSell           = setCost / (1 - setMarginPct)
```

**`setMarginPct`** is the **only** margin lever in Matched Set mode. It defaults to 0.40 (40%). Component-level GM tiers are ignored — the job is priced as a unit.

**Why a flat margin:** displays are sold as a unit, with a customer-facing per-set price. The internal cost variance between a 5,000-piece header and a 1,500-piece base is invisible to the customer.

### Individual (per-component pricing)

The customer wants **separate prices per component**. Each piece gets its own qty grid, its own cost+sell calculation, its own GM target. The job total is the sum.

**Math:**
```
For each component i:
  componentQty[i]   = bomItems[i].state.qtys[active qty index]
  componentCost[i]  = full pricing pipeline
  gmTier            = getGmMsfTier(componentMsf)
  gmTarget          = pricingTargets.gmPerMsfTier[gmTier]
  componentSell[i]  = componentCost[i] / (1 - gmTarget)
  jobSell           = Σ componentSell[i]
```

Each component independently flows through Steps 7-12 of file 17 (Pricing Walkthrough). No `setMarginPct`.

**When to use Individual:**
- Different customers buying the same family (rare but happens)
- Explicit RFQ language: "individual", "separate pricing", "price each separately"
- Spec runs (different qtys, different ship dates per component)

---

## Job-level vs item-level state

This is the most important schema concept: **which fields are job-level (top-level) and which are item-level (in `bomItems[i].state`)?**

**Job-level (top-level only):**
- Identity: `custName`, `custCode`, `custIdent`, `custRef`, `itemDesc`
- Estimator: `estInitials`
- Mode: `quoteType`, `pricingMode`, `setMarginPct`
- FOB/freight: `fobMode`, `destZip`, `under5MsfFee`

**Item-level (in `bomItems[i].state`):**
- Materials: `boardGrade`, `flute`, `outsideLiner`, `insideLiner`, `medium`
- Dimensions: `oneUpW`, `oneUpL`, plus depth
- Qty: `qtys` (5-element array, mirrors top-level structure)
- Print: `printReq`, `printMode`, `printSides`, `printFinish`, `numColors`
- Operations: `handStripping`, `handGluing`, `tape`, complexity ratings
- CAD/Crest: `cadDifficulty`, `crestComplexity`, `totalRuleInches`
- Misc: per-component `miscCharges`

**The active-item mirror:** top-level fields like `boxStyle`, `flute`, `oneUpW` mirror `bomItems[activeIndex].state.*`. When the user switches active items in the UI, the top-level mirror updates so the main intake panels reflect the now-active component. This is purely for UI consistency — it doesn't change pricing.

---

## Save / Load semantics for Multi-Part

The reset-first pattern (D-080 / D-087) is critical here.

**`applyState` and `applyItemState`** are **full state replace, not merge** (Rule 7). When you load a Multi-Part quote:
1. The entire React state is reset to a blank slate.
2. The top-level fields are populated from the saved object.
3. `bomItems` array is populated.
4. `activeItemIndex` is set (usually to 0).
5. The top-level mirror is synchronized to `bomItems[0].state`.

Why the reset: leftover state from a previous quote (e.g., misc charges, stripping flags) would otherwise carry over. With reset-first, you get a clean slate every time. The bug history before D-080 was full of "ghost charges from last quote" complaints.

---

## The `confidence` field — overall vs. per-component

Multi-Part has **two confidence scores**:

```javascript
{
  parsed: {
    quoteType: "Multi-Part",
    bomItems: [
      { ..., confidence: 0.92 },   // per-component
      { ..., confidence: 0.85 },
      { ..., confidence: 0.95 }
    ]
  },
  confidence: 0.85,                // overall (top-level)
  asks: [...]
}
```

Why both: the overall score reflects the whole job. The per-component score lets the diff modal flag individual components for review without making the whole job look low-confidence.

The diff modal renders a **warning badge** on any component with `confidence < 0.7`.

---

## Adding / removing components in the UI

The Multi-Part toolbar has:
- **Add Item** — appends a blank `bomItems` entry, makes it active.
- **Duplicate Item** — copies the active entry, makes the copy active.
- **Delete Item** — removes the active entry. The next entry (or previous, if last) becomes active.
- **Reorder** — drag handles to reorder. `id` values are preserved (item-1, item-2, etc.) but display order changes.

When deleting the last remaining item, the UI rejects (or auto-converts back to Simple if `pricingMode === "Individual"` and only one item remains — see D-142 for the spin-off feature still pending).

---

## Job-level cost allocation

Some costs are **job-level** — they don't belong to any single component but need to be split across them. The classic case: a shared CAD die used by two components.

`allocateJobCost(items, totalCost, method)` (engine L639) distributes:

- **"By MSF"** — proportional to each item's order MSF:
  ```
  allocation[i] = totalCost * (oMsf[i] / Σ oMsf)
  ```
- **"Equal"** — split evenly across MFG items (FUL items get 0):
  ```
  allocation[i] = totalCost / count(MFG items)
  ```

**FUL items always get 0** — they're purchased finished goods, no manufacturing cost to share.

---

## The `type` field — Manufactured vs. Purchased vs. Fulfillment

Each `bomItems[i].type` is one of:

- **`"Manufactured"`** (MFG) — SPC produces this component. Full pricing pipeline runs.
- **`"Purchased"`** — outside vendor produces this; SPC marks up. Only `purchasedCost`, `purchasedMarkup`, qtys, and `pcsPerSet` matter for pricing.
- **`"Fulfillment"`** (FUL) — SPC assembles/distributes only; no piece cost. Per-set fulfillment fee.

The pricing pipeline branches:
```javascript
switch (item.type) {
  case "Manufactured":
    return fullPricingPipeline(item);
  case "Purchased":
    return item.purchasedCost * (1 + item.purchasedMarkup);
  case "Fulfillment":
    return item.fulfillmentFee * setCount;
}
```

This is how **M5 (Purchased blend)** works — a single Multi-Part quote can mix all three types. Example: an MFG header card, a Purchased blow-molded base from a vendor, and a Fulfillment kitting fee.

---

## The diff modal

When a parsed Multi-Part lands, the diff modal renders:

1. **Job-level fields** at the top — customer, est num, mode.
2. **Per-component tabs** below — one tab per `bomItems[i]`.
3. **Each tab** shows the full intake form with the parsed values populated and source tags (RFQ/CAD/REGISTRY/ASK badges) on each field.
4. **ASK badges** flag fields that need estimator input before apply.
5. **Apply** button at the bottom — runs `__SPOT_LOAD_JSON(payload)` with the full object.

The user can edit any field before applying. The edit log is preserved in the audit trail (see D-130).

---

## Multi-Part regression test cases

Per `TEST_SPOT_R1_5_Chowder_Specs.md` and TC-D131:
- **TC-031.x** — Multi-Part parser detection (single → flat, multi → multi-part shape).
- **TC-D131-x** — Multi-Part parser end-to-end (display vocabulary, component naming, pricing-mode default).
- **TC-D132** — Matched Set margin (40% default, override).
- **REG-MP-01..05** — multi-part save/load round-trips.

---

## Common questions

**Q: I added a component but the qty grid is wrong.**  
A: Each `bomItems[i].state.qtys` is independent. When you add an item, the qty grid initializes to a copy of the active item's qtys — but it's a copy. Edit the new item's grid as needed.

**Q: Why does my Matched Set show different costs per qty row?**  
A: Each qty row in the grid is "N sets". As N increases, every component scales by `N * pcsPerSet`. Per-set cost can change because of GM tier transitions, mill-min effects, or sheet selection changes at different qtys.

**Q: I changed `setMarginPct` and nothing happened.**  
A: Verify `pricingMode === "Matched Set"`. In Individual mode, `setMarginPct` is ignored entirely.

**Q: My parsed multi-part has only one item — should it be Simple?**  
A: That's M2 (Single Multi-Part stub). Sometimes the parser correctly identifies one piece but in Multi-Part shape, because the RFQ uses display vocabulary. The estimator can convert to Simple via the UI if it makes more sense.

---

## Files involved

| Concern | File | Section |
|---|---|---|
| Schema | `EST_SPOT_Intake_Harness.md` | §7 Multi-Part |
| Pricing math | `spot_engine.js` | `calcWF`, `allocateJobCost` |
| Cost allocation | `spot_engine.js` | `allocateJobCost` (L639) |
| UI tabs | `spot_r1_5.jsx` | Search "bomItems" + "activeItemIndex" |
| Save/load | `spot_r1_5.jsx` | `applyState`, `applyItemState` |
| Parser detection | `spot_server.js` | Prompt §"MULTI-PART DETECTION" (L568+) |
| Diff modal | `spot_r1_5.jsx` | Parse-review modal |
| Test cases | `TEST_SPOT_R1_5_Chowder_Specs.md` | TC-031.x, TC-D131-x |

---

**Next:** read file 21 for SPOT-specific code patterns and gotchas.
