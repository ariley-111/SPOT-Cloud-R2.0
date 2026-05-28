# SPOT Intake Harness
> Version: 2.2.1 | April 28, 2026
> Purpose: Map every RFQ field to a SPOT input before touching Chrome.
> The estimator approves this grid. I execute without further questions.
>
> **v2.2.1 hotfix (2026-04-28, same day as v2.2):**
> First v2.2 production test failed — parser skipped BOM Scope and jumped to Simple grid on a multi-part display because the trigger was conditional. v2.2.1 makes BOM Scope **UNCONDITIONAL**: every RFQ runs §5 first, single-piece RFQs produce a 1-row inventory. Method is **derived from inventory count**, not selected up front. New first-move rule (§3.0) and self-check (§3.1). Updated §4, §5, §11, §12, §15, §16.
>
> v2.2 changes (2026-04-28):
> 1. **BOM Scope Pass (Phase 1.5)** — mandatory inventory before drilling into items. Triggered by 2026-04-28 multi-part display failure (parser drilled one component, missed the BOM).
> 2. **Display Component Vocabulary** — full mapping table for header / base / riser / tray / skirt / easel / hutch / master shipper, plus litho-lam / pre-pack / KD / lock-tab process handling. Style enum expanded: `Display Header`, `Display Base`, `D/C Joined`, `D/C Non-Joined` are now first-class.
> 3. **TEST-pattern decision rigor** — Purpose & Contract (§1), Precondition Checklist (§2), Intake Methods M1–M5 (§4), Pass Criteria per field (§8), Known Fail Modes (§11), Ship-Blocker Criteria (§12), Close Criteria (§13), When Intake Fails (§14), Cross-References (§18). Patterns ported from `TEST_SPOT_R1_5_Chowder_Specs.md` and `TEST_SPOT_R1_5_Testing_Guide.md`.
>
> v2.1 capabilities preserved: SESSION-START registry load, source tags (RFQ/CAD/DEFAULT/CALC/ASK/REGISTRY), CKB / ECT 44 / re-ask guards.

---

## §1 — Purpose & Contract

**Purpose:** Convert any RFQ into a SPOT-loadable JSON payload that produces an accurate quote on first Chrome load, with zero estimator follow-up questions during execution.

**Contract:** The estimator approves the Phase 2 intake grid. After approval, I execute through Chrome without further intake questions. Any field still in 🔴 ASK at approval time is a SHIP-BLOCKER — I do not open Chrome.

**Out of scope:**
- I do not select pricing tiers, override routes, set die costs from priors, or generate the Preview Quote PDF — the estimator owns those.
- I do not modify SPOT source code, change deployed JSX, or touch ledger files (`01_OPEN_ISSUES.md`, `02_RELEASE_HISTORY.md`).

**Failure of last resort:** If I cannot resolve a SHIP-BLOCKER by reading the RFQ + registry + canonical files, I file an ASK or escalate per §14. I do not guess.

---

## §2 — Precondition Checklist (runs BEFORE Phase 1, non-optional)

Every session, before reading the RFQ:

```
── PRECONDITIONS ──────────────────────────────────────
[ ] Loaded EST_SPOT_Canonical_Terms.md (fresh read, not recalled)
[ ] Loaded EST_SPOT_Quoting_Rules.md (Rules 1–9 in force)
[ ] Loaded EST_SPOT_Channel_Reference.md (JSON schema in scope)
[ ] Reading_Discipline_Protocol.md rules in force (registry / last-message
    re-read / no training-data inference / short-answer / no re-ask)
[ ] Verified window.__SPOT_UI_VERSION matches MAP_VERSION in EST_SPOT_UI_Map.md
[ ] Scanned full conversation for pre-answered fields and prior estimator decisions
[ ] Confirmed which RFQ files are in scope (email body + named attachments)
[ ] Mode confirmed as EST (or implicit default)

Declared SPC tokens encountered in RFQ (with registry-source resolution):
  — [token] → [SPC meaning per EST_SPOT_Canonical_Terms.md]
  — [token] → [SPC meaning per EST_SPOT_Canonical_Terms.md]

Open ambiguous tokens not in registry:
  — [token] → ASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Any unchecked precondition is a SHIP-BLOCKER (see §12).**

The three 2026-04-21 failures (CKB / ECT 44 / re-ask) and the 2026-04-28 failure (drill before scope) all surface here:
- **CKB** — registry: SPC meaning = 42# Kemi-Lite (NOT industry's Clay-Coated Bleached Kraft).
- **ECT 44** — registry: uncommon at SPC, manual mill-substitute, falls DOWN to Mullen 200# (D-098 popup scoped but never coded — DEV-011).
- **Re-ask** — "Scanned full conversation" catches it.
- **Drill before scope** — Method selection (§4) gates Phase 1.5 before drilling.

---

## §3 — How to Use

### §3.0 — FIRST-MOVE RULE (read before everything else)

**The first artifact produced for any RFQ — after the §2 Precondition checklist — is the §5 BOM Scope inventory. ALWAYS. NO EXCEPTIONS.**

This is true whether the RFQ describes one piece, six pieces, or sixty pieces. A single-piece RFQ produces a 1-row inventory. The inventory is not optional, conditional, or skippable.

**Method (M1–M5) is DERIVED from the inventory count, not selected up front:**
- Inventory has 1 row → **M1 (Simple Quote)**
- Inventory has 2+ rows, all corrugated boxes → **M2 (Multi-Part Box)**
- Inventory has 2+ rows, display vocabulary present → **M3 (Multi-Part Display)**
- Inventory has 2+ rows, master shipper present → **M4 (Master Pack)**
- Inventory unclear or hybrid → **M5 (Other) → ASK**

If you find yourself producing a §6 Simple grid OR a §7 Multi-Part grid without first producing a §5 BOM Scope, you have FAILED §3.0. Stop, discard the partial grid, and restart with the inventory.

### §3.1 — Self-check before posting any grid

Before posting §6 or §7 to the estimator, answer YES to all of these:

```
[ ] §2 Preconditions all checked
[ ] §5 BOM Scope inventory was produced and approved (or pending approval)
[ ] Method (M1–M5) was DERIVED from the inventory, not assumed
[ ] Inventory row count matches the grid I'm about to post
    (1 row → §6 Simple, 2+ rows → §7 Multi-Part with one block per row)
[ ] Every component in the inventory has a corresponding grid block (§7) or is the single subject (§6)
```

**If any answer is NO, do not post. Restart from §3.0.**

### §3.2 — Standard flow

1. RFQ arrives (email + files).
2. Run §2 Precondition Checklist. Any unchecked item → halt.
3. **Run §5 BOM Scope Pass.** Always. Output the inventory as the FIRST artifact.
4. Estimator approves the inventory (or corrects it).
5. Method is now DETERMINED by inventory count + vocabulary (per §3.0).
6. Fill the appropriate intake grid (§6 Simple if inventory has 1 row; §7 Multi-Part otherwise). Tag every field with a source.
7. Run §3.1 Self-check.
8. Apply §8 Pass Criteria — every field must match Expected and avoid Must-Not-Appear.
9. Surface FLAGS. Estimator reviews — approves or corrects.
10. Verify §12 Ship-Blockers all clear.
11. Build JSON per `EST_SPOT_Channel_Reference.md` schema. Run §13 Close Criteria.
12. Execute Chrome harness via `EST_SPOT_UI_Map.md`.

**Source tags:**
- `RFQ` — directly stated in the email or file
- `CAD` — pulled from drawing/spec sheet
- `DEFAULT` — standard assumption (noted)
- `CALC` — derived from other fields
- `ASK` — missing, needed before proceeding
- `REGISTRY` — resolved via `EST_SPOT_Canonical_Terms.md`

**If any field is tagged `ASK` — I do not open Chrome until it's resolved (§12).**

---

## §4 — Intake Methods (M1–M5) — DERIVED, not selected

**Method is determined by the §5 BOM Scope inventory output, not chosen up front.** This is the v2.2.1 fix for the v2.2 production failure where the parser pre-selected M1 and skipped scope entirely.

After §5 BOM Scope Pass produces the inventory, look at the result and apply this table:

| Inventory result | Method | Grid |
|---|---|---|
| **1 row, no display vocab** | **M1: Simple Quote** | §6 |
| **2+ rows, all corrugated boxes/trays, no display vocab** | **M2: Multi-Part Box** | §7 (one block per row) |
| **2+ rows, display vocabulary present** (header / base / riser / tray / skirt / easel / hutch / sidekick / endcap / PDQ / pallet display / power wing) | **M3: Multi-Part Display** | §7 (one block per row) |
| **2+ rows, master shipper among them** | **M4: Master Pack** (effectively M3 + outer corrugated case) | §7 (one block per row, master shipper as its own row) |
| **Inventory ambiguous, hybrid, or non-standard** | **M5: Other** | ASK before any grid |

The method goes in the FLAGS block of every grid, but it is an OUTPUT of inventory, not an input to it.

**Mismatched method-vs-inventory = SHIP-BLOCKER (§12).** Examples:
- §6 Simple grid posted but inventory has 3 rows → blocker.
- §7 Multi-Part grid posted with `quoteType: "Simple"` → blocker.
- M3 declared but no display vocabulary in inventory → blocker (re-derive method).

---

## §5 — Phase 1.5: BOM Scope Pass (UNCONDITIONAL — runs for every RFQ)

**When:** ALWAYS. Every RFQ produces a BOM Scope inventory before any grid is filled. **No exceptions, no conditional triggers, no skips.**

- Single-piece RFQ → 1-row inventory.
- Multi-piece RFQ → N-row inventory.
- Either way, the inventory is the FIRST artifact (after §2 Preconditions) that the parser produces.

**Why this is unconditional (v2.2.1 fix):** v2.2 made BOM Scope conditional on "the RFQ describes more than one physical piece." The parser failed that recognition step on its first production test (multi-part display, 2026-04-28) and jumped straight to a Simple grid. Removing the conditional removes the failure point. A 1-row inventory for Simple costs nothing; a missed inventory for Multi-Part costs the whole quote.

**What it produces:** A flat component inventory. ONE row per physical piece. NO board / dim / print details yet — just identity, type, and a guess at SPC style. Once approved, Method (M1–M5) is derived per §4 and the grid (§6 or §7) drills each row.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPOT BOM SCOPE | [Customer] | [Project] | [Date]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Job kind         : [Counter / Floor / PDQ / Sidekick / Endcap / Pallet / Master Pack / Box Set / Single-Piece / Other] | [SOURCE]
Total components : [N]                          | [SOURCE]
Set quantities   : [qty1, qty2, qty3]           | [SOURCE]
Pricing mode     : [Individual / Matched Set]   | DEFAULT: Individual (Single) / Matched Set (Multi)
Prepress scope   : [None / Per Item / Lot Charge] | DEFAULT: Per Item

── COMPONENT INVENTORY ────────────────────────────────
# | Customer Ident | Component Name        | SPC Style          | Qty/Set | Item Type    | Print? | Notes
1 | [part #]       | [name]                | [style]            | [n]     | Manufactured | [Y/N]  | [non-native flags]
2 | [part #]       | [name]                | [style]            | [n]     | Manufactured | [Y/N]  |
3 | [part #]       | [name]                | [style]            | [n]     | Manufactured | [Y/N]  |
... (one row per physical piece, no exceptions — Single-piece RFQs have exactly 1 row)

── METHOD DERIVATION (per §4) ─────────────────────────
Inventory row count        : [N]
Display vocabulary present : [Y/N]
Master shipper present     : [Y/N]
DERIVED METHOD             : [M1 / M2 / M3 / M4 / M5]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCOPE FLAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 ASK — [#N component]: [what's unclear]
🟡 ASSUMED — [#N component]: identified from context, confirm
🟢 CONFIRMED — [N components]: explicit in RFQ
⚠️ WATCH — [#N component]: [non-native process / cross-component dep]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Approve scope, or correct components and re-confirm.
```

**Hard rules:**
- Inventory is the FIRST artifact for every RFQ. Posting any grid (§6 or §7) before posting the inventory = §3.0 violation.
- Every physical piece gets a row, including non-printing pieces (risers, dividers, fillers).
- Single-piece RFQs still produce a 1-row inventory. The single piece IS the inventory.
- Master shippers / shipper cases ALWAYS get a row when mentioned, even when listed as "exterior pack" or "ships in."
- Item Type defaults to `Manufactured`. Use `Purchased` only if RFQ explicitly says SPC sources rather than makes the piece. Use `Fulfillment` only for pack-out / kitting line items.
- If a component is litho-laminated, foil-stamped, embossed, mounted-to-board, or otherwise non-native to SPOT, flag ⚠️ WATCH on that row.
- If pcsPerSet is unclear, mark `🔴 ASK` on that row's qty.
- Pallet itself is NOT an SPC item unless RFQ explicitly says SPC sources the pallet (then Item Type: `Purchased`).
- Do NOT proceed to §6 or §7 grid until scope is approved.

**On approval:** Method is derived per §4. §6 (Simple, M1) or §7 (Multi-Part, M2/M3/M4) drills each row in inventory order. The active item index (`activeItemIdx`) defaults to 0.

---

## §6 — Intake Grid: Simple Quote (Method M1)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPOT INTAKE GRID | [Customer Name] | [Date]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── ESTIMATE INFO ──────────────────────────────────────
Customer Name    : [value]                  | [SOURCE]
Project Name     : [value]                  | [SOURCE]
Customer Ident   : [part # / SKU]           | [SOURCE]
Initials         : SPC                      | ALWAYS
Description      : [item description]       | [SOURCE]

── QUANTITIES ─────────────────────────────────────────
Qty Break 1      : [value]                  | [SOURCE]
Qty Break 2      : [value or —]             | [SOURCE]
Qty Break 3      : [value or —]             | [SOURCE]

── BOARD ──────────────────────────────────────────────
Style            : [RSC / FOL / D/C Tray / D/C Joined / D/C Non-Joined / Mailer / 5PF / Display Header / Display Base] | [SOURCE]
Flute            : [B / C / E / BC / EB]    | [SOURCE]
Grade            : [200 / 250 / 275 / ECT 32 / ECT 44 / etc] | [SOURCE]
Outside Liner    : [Kraft / Kla-White / Kemi-Lite / Bleached White] | [SOURCE]
Inside Liner     : [Kraft / Kla-White / Kemi-Lite / Bleached White] | [SOURCE]
Medium           : [None / 26# / 33# / 35HPL# / 40# / 42# Bl] | [SOURCE]
FSC              : [Off / On]               | [SOURCE]

── DIMENSIONS ─────────────────────────────────────────
Width (corr dir) : [value]"                 | [SOURCE]
Length (mach dir): [value]"                 | [SOURCE]
  ↳ Note: confirm inside vs outside, flat blank vs erected

── PRODUCTION ─────────────────────────────────────────
Print            : [On / Off]              | [SOURCE]
Mode             : [Gloss / Satin / OnQ Sty / OnQ LB] | [SOURCE]
Sides            : [1-Side / 2-Side / White] | [SOURCE]
Saber            : [No / Yes]              | [SOURCE]

── ROUTING ────────────────────────────────────────────
Route            : [Auto / CAD / Crest]    | DEFAULT: Auto
Difficulty       : [Simple / Straight / Std / Complex] | DEFAULT: Std
CAD Price        : [Diff / Rule]           | DEFAULT: Diff
Rule In/Pc       : [value or —]            | [SOURCE] (only if Rule)
Perf %           : [value or —]            | [SOURCE] (only if Rule)

── OPERATIONS ─────────────────────────────────────────
MATS             : [No / Yes]              | [SOURCE]
Strip            : [No / Yes]              | [SOURCE]
  ↳ Difficulty   : [Simple/Straight/Std/Complex] | (if Strip=Yes)
  ↳ Edge         : [No / Yes]             | (if Strip=Yes)
Glue             : [No / Yes]              | [SOURCE]
  ↳ Joints       : [count]                | (if Glue=Yes)
  ↳ Difficulty   : [Simple/Std/Complex]   | (if Glue=Yes)
Tape             : [No / Yes]              | [SOURCE]
  ↳ Type         : [Clear / Reinf]        | (if Tape=Yes)

── ONE-TIME COSTS ─────────────────────────────────────
Prepress         : [Auto / None / Line / Amort] | DEFAULT: Auto ($50)
Prepress Amount  : [$50 embedded / $value] | [SOURCE]
Die Cost         : [$ value or —]          | (only if Crest route)
  ↳ Die Treatment: [None / Separate Line / Amort] | DEFAULT: Separate Line

── FREIGHT ────────────────────────────────────────────
FOB              : [Origin / Destination]  | DEFAULT: Origin
Freight Type     : [None / Line / Amort]   | DEFAULT: Line
Ship-To ZIP      : [value]                 | [SOURCE]
  ↳ Customer name: [value]                 | (for quote header)
  ↳ Address      : [value or —]            | [SOURCE]

── QUOTE HEADER ───────────────────────────────────────
Payment Terms    : [Net 30 / Net 45 / Net 60 / COD / etc] | DEFAULT: Net 30
Quote Valid      : [30 days]               | DEFAULT: 30
Quote Notes      : [value or —]            | [SOURCE]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Method           : M1
🔴 ASK — [field]: [question]
🟡 ASSUMED — [field]: defaulted to [value] — confirm or correct
🟢 CONFIRMED — [field]: explicitly stated in RFQ
🔵 REGISTRY — [field]: customer term "[X]" resolved to SPC token "[Y]"
⚠️  WATCH — [issue to be aware of at entry time]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Approve to proceed, or correct above and re-confirm.
```

---

## §7 — Intake Grid: Multi-Part Quote (Methods M2, M3, M4)

Same shape as Simple, drilled per BOM-Scope-approved item.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPOT INTAKE GRID — MULTI-PART | [Customer] | [Date]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── JOB LEVEL ──────────────────────────────────────────
Customer Name    : [value]                  | [SOURCE]
Project Name     : [value]                  | [SOURCE]
Initials         : SPC                      | ALWAYS
Method           : [M2 / M3 / M4]           | (per §4)
Job kind         : [Counter / Floor / PDQ / ...] | (per §5)
Pricing Mode     : [Individual / Matched Set] | DEFAULT: Matched Set
Prepress Scope   : [None / Per Item / Lot Charge] | DEFAULT: Per Item
Set Qtys         : [value, value, value]    | [SOURCE]
Component count  : [N]                      | (matches §5 inventory)

── ITEM [N] — [Component Name from §5 row N] ──────────
Customer Ident   : [part # / SKU]           | [SOURCE]
Description      : [value]                  | [SOURCE]
Pcs Per Set      : [value]                  | [SOURCE]
Item Type        : [Manufactured / Purchased / Fulfillment] | DEFAULT: Manufactured
Style            : [RSC / FOL / D/C Tray / D/C Joined / D/C Non-Joined / Mailer / 5PF / Display Header / Display Base] | [SOURCE]
Flute            : [value]                  | [SOURCE]
Grade            : [value]                  | [SOURCE]
Outside Liner    : [value]                  | [SOURCE]
Inside Liner     : [value]                  | [SOURCE]
Medium           : [None / value]           | [SOURCE]
FSC              : [Off / On]              | [SOURCE]
Width            : [value]"                 | [SOURCE]
Length           : [value]"                 | [SOURCE]
Print            : [On / Off]              | [SOURCE]
Mode             : [Gloss / Satin]          | [SOURCE]
Sides            : [1-Side / 2-Side]        | [SOURCE]
Route            : [Auto / CAD / Crest]    | DEFAULT: Auto
[ops as needed — Strip/Glue/Tape — same shape as §6]
Ship-To ZIP      : [value]                 | [SOURCE]

  (repeat block for each item in §5 inventory order)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Method           : [M2 / M3 / M4]
🔴 ASK — [field]: [question]
🟡 ASSUMED — [field]: defaulted to [value]
🟢 CONFIRMED — [n items confirmed]
🔵 REGISTRY — customer token → SPC token resolutions
⚠️  WATCH — [issue]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Approve to proceed, or correct above and re-confirm.
```

---

## §8 — Pass Criteria per Field

Every field must match the Expected column and must NOT match anything in the Must-Not-Appear column. This is checked before grid approval and again at JSON build time.

### Identity

| Field | Expected | Must NOT appear |
|---|---|---|
| `estInitials` | `"SPC"` | `""` / `"MM"` / `"Mike"` / customer initials |
| `custName` | bill-to customer name | shipping address used as customer; broker without flag |
| `custIdent` (top-level) | matches `bomItems[0].custIdent` in Multi-Part | mismatch (D-081 clobber) |
| `quoteType` | matches Method (M1→Simple, M2/M3/M4→Multi-Part) | Multi-Part with `bomItems.length===1`; Simple with bomItems present |
| `pricingMode` | M1→`"Individual"`; M2/M3/M4→typically `"Matched Set"` | M1 with `"Matched Set"`; empty string |

### Board (per item)

| Field | Expected | Must NOT appear |
|---|---|---|
| `flute` | from RFQ; one of `B / C / E / BC / EB` | guessed without RFQ basis |
| `boardGrade` | from RFQ; ECT grades preserved verbatim (32/44/48/51/55/61/71/82) | ECT 44 silently rewritten to ECT 32; legacy "40 ECT" unmapped |
| `outsideLiner` | from RFQ via registry | CKB → "Clay-Coated Bleached Kraft" or any folding-carton meaning |
| `insideLiner` | from RFQ; default `"None"` (= default kraft semantically per Channel Ref L57) | guessed mottled-white when RFQ silent |
| `medium` | usually `"None"` | populated without RFQ basis |
| `fscEnabled` | `false` default; `true` only if RFQ explicit | `true` inferred from "sustainable" without confirmation |
| `fscFee` | `"25.00"` | `"15"` / `"15.00"` (legacy — migration fires on load but JSON should not carry old value) |
| `under5MsfFee` | `"0"` | any non-zero value |

### Print

| Field | Expected | Must NOT appear |
|---|---|---|
| `printReq` | `"Yes"` if any print, else `"No"` | `"No"` when RFQ shows full color; `"Yes"` for kraft-only orders |
| `printMode` | `"Satin"` default | `"Gloss"` without explicit RFQ Gloss request (Rule 8) |
| `printSides` | `"1-Sided"` / `"2-Sided"` / `"White"` per RFQ | sides count stated as color count |
| Litho-lam handling | `printMode: "Satin"` + ⚠️ WATCH flag | `"Gloss"` mapping; silently treated as native digital |

### Routing

| Field | Expected | Must NOT appear |
|---|---|---|
| `routeOverride` | OMIT entirely from JSON | any value (Rule 1) |
| `cadDifficulty` | `"Simple"` / `"Straight"` / `"Standard"` / `"Complex"` | `"Extreme"` (legacy — migrates to Complex on load); `"Difficult"` |
| `crestComplexity` | same enum as `cadDifficulty`, separate field | mirroring `cadDifficulty` without independent assessment |
| `cadPricingMethod` | `"By Difficulty"` default | `"By Inches of Rule"` without `totalRuleInches` set |

### Ops

| Field | Expected | Must NOT appear |
|---|---|---|
| `handStripping` | from RFQ; default `"No"` | `"Yes"` for displays without strip language |
| `strippingComplexity` | only when stripping = Yes | populated when stripping = No |
| `handGluing` | from RFQ; default `"No"` | `"Yes"` for lock-tab / auto-bottom assemblies |
| `tape` / `tapeType` | from RFQ; default `"No"` | populated when tape = No |

### Freight + quote header

| Field | Expected | Must NOT appear |
|---|---|---|
| `quoteFOB` | `"Origin"` default; `"Destination"` only if RFQ explicit (Rule 9) | `"Destination"` inferred from "delivered" without confirmation when ambiguous |
| `destZip` | populated if Destination; ZIP confirmed | guessed ZIP from city name |
| `freightCost` etc. | auto-zeroed when FOB Origin | non-zero values present with FOB Origin |
| `quoteTerms` | from customer record or RFQ; `"Net 30"` default | terms inferred from broker without check |

### Multi-Part contracts (Methods M2/M3/M4)

| Field | Expected | Must NOT appear |
|---|---|---|
| Top-level `custIdent` | matches `bomItems[0].custIdent` (D-081 scope) | mismatch — clobbers item 1 part number |
| Top-level `qtys` (Matched Set) | matches each `bomItems[i].state.qtys` | drift between top-level and per-item |
| §5 BOM SCOPE component count | matches `bomItems.length` | scope says 6, JSON has 4 (silent drop) |
| Per-item `pcsPerSet` | `1` when JSON is hand-built (multiplied qty in `state.qtys`) per Channel Ref L191 | non-1 values without BOM Builder source |
| `activeItemIdx` | `0` (or estimator-confirmed) | random / undefined |

---

## §9 — Field Extraction Rules

When reading an RFQ, apply these rules to fill the grid. **All liner and board abbreviations pass through `EST_SPOT_Canonical_Terms.md` before being tagged.** If a customer abbreviation has an SPC-specific meaning that diverges from the industry-standard (flag: ⚠️ in the registry), the resolved SPC value goes in the grid with source tag `REGISTRY`.

### Dimensions
- "flat blank" or "blank size" = Width × Length for one-up entry.
- "inside dimensions" = add board thickness for outside dims (2× caliper per direction).
- "W × L × D" erected = convert to blank: W + 2D + manufacturer's joint for RSC style.
- Millimeters → divide by 25.4 for inches.
- If unclear: tag as `ASK`.

### Board
- "200# test" / "200 Mullen" → grade: 200.
- "32 ECT" → grade: ECT 32 (runs on 200# stock — board substitution will trigger).
- "44 ECT" → grade: ECT 44 (uncommon at SPC; **manual mill-substitute check; substitutes DOWN to Mullen 200# stock, not across to another ECT** — per `EST_SPOT_Canonical_Terms.md`. D-098 popup guardrail was scoped but never coded — DEV-011).
- "white outside" → Kla-White outside liner (not Bleached White unless specified).
- "kraft" → Kraft liner.
- "MW" / "mottled white" → 42# Kla-White.
- **"CKB"** → ⚠️ RESOLVE VIA REGISTRY — at SPC "CKB" = Corrugated Kraft Board = 42# Kemi-Lite (NOT the industry's Clay-Coated Bleached Kraft folding-carton board). Tag as `REGISTRY`.
- "Graphic White" → ASK (see EST-GRPHCWHT in `01_OPEN_ISSUES.md`).
- No liner specified → default Kraft/Kraft, tag as `🟡 ASSUMED`.

### Print
- "4CP", "CMYK", "digital", "printed" → Print: On, Mode: Satin (per Rule 8 default; override only if RFQ specifies a finish).
- "satin", "matte", "uncoated" → Print: On, Mode: Satin.
- "plain", "no print", "kraft" → Print: Off.
- No specification → default Satin, tag as `🟡 ASSUMED`.
- Never list color count on quote.

### Routing
- "flat bed die cut" = finishing description, NOT a route override — leave Route: Auto.
- "die cut" = finishing — SPOT decides CAD vs Crest.
- Only override route if estimator explicitly says to.

### FOB
- No specification → Origin (Canton OH 44704).
- "delivered", "freight included", "FOB destination" → Destination.

### Die
- "existing die" or "die on file" → Die Cost: $0, note on quote.
- "new die" or "cutting die cost" → tag as `ASK` for actual cost.
- "no die", "CAD sample" → no die field needed.

### Operations
- "hand stripped" / "internal waste" → Strip: Yes.
- "glued", "auto-lock", "glue tabs" → Glue: Yes.
- "taped edges" / "reinforced" → Tape: Yes, Type: Reinf.
- Quantities under 50 with no other ops specified → likely CAD route, no stripping.

### Display components (NEW v2.2)
1. Run §5 BOM Scope Pass first. Inventory every physical piece before drilling into any one.
2. Master shippers / shipper cases get their own component row even when described as "exterior pack" or "ship in."
3. Risers, dividers, fillers count — even if non-printing.
4. Litho-laminated graphics map to `printMode: "Satin"` with ⚠️ WATCH (per §10 + Channel Ref L81). Note in Quote Notes that the cost is digital-Satin equivalent; if customer requires actual litho lamination, estimator confirms separately.
5. If a component is described but not pictured, and dimensions are unclear, mark dims `ASK` — do not infer from "typical" display proportions.
6. Pallet excluded unless RFQ explicitly says SPC sources it — then Item Type: `Purchased`.
7. If the RFQ shows a structural drawing for one component but only descriptive text for others, flag the descriptive-only components 🟡 ASSUMED and ASK for drawings before opening Chrome.

---

## §10 — Display Component Vocabulary

Customer terminology → SPC component classification. Use during §5 BOM Scope Pass to populate Component Name and SPC Style. **If a term is not in this list and could be SPC-specific, ASK — do not expand from training-data priors. SPC-specific divergences get promoted to `EST_SPOT_Canonical_Terms.md`.**

### Display unit kinds (job-level)

| RFQ says | Job kind | Notes |
|---|---|---|
| "counter display" / "countertop display" | Counter Display | Usually 2–4 components: tray + header + (easel or riser) |
| "floor display" / "floor stand" / "free-standing" | Floor Display | Larger; often pallet-based; 4–8+ components |
| "PDQ" / "PDQ tray" | PDQ | Pre-pack tray; usually one tray + master shipper |
| "sidekick" / "side display" | Sidekick | Side-aisle; usually 2–3 components |
| "endcap" / "end-cap display" | Endcap | End-of-aisle; usually 4+ components, larger graphics |
| "pallet display" / "half-pallet" / "quarter-pallet" | Pallet Display | Skirt + base + components stacked on pallet |
| "shipper" / "shipper case" / "master case" | Master Pack | Outer corrugated container (RSC); often paired with display contents |
| "power wing" / "clip strip display" | Other | ASK — uncommon at SPC |

### Component types (item-level)

| RFQ says | Component Name | SPC Style | Print default | Notes |
|---|---|---|---|---|
| "header" / "header card" / "topper" / "marquee" | Header card | Display Header | Yes (Satin) | Often litho-laminated → ⚠️ WATCH |
| "footer" / "front panel" / "valance" | Footer panel | D/C Non-Joined | Yes (Satin) | |
| "base" / "floor" / "platform" / "tray base" | Base | Display Base | Yes (Satin) | Bottom platform; often a tray with risers attached |
| "tray" / "shelf" / "chute" / "product tray" | Tray | D/C Tray | Often Yes | Holds product |
| "riser" / "column" / "spacer" / "kicker" / "stanchion" | Riser | D/C Non-Joined | Often No | Vertical support |
| "side wing" / "wing" | Side wing | D/C Non-Joined | Often Yes | |
| "divider" / "partition" / "fence" | Divider | D/C Non-Joined | Usually No | Interior separator |
| "easel" / "back support" | Easel | D/C Non-Joined | Usually No | Back support for counter displays |
| "hutch" / "canopy" / "overhang" | Hutch | D/C Non-Joined | Yes | Overhang structure |
| "pallet skirt" / "skirt" / "pallet wrap" | Pallet skirt | D/C Non-Joined | Yes | Wraps around pallet base |
| "insert" / "PDQ insert" / "interior tray" | Insert tray | D/C Tray | Often No | Pre-formed tray inside another piece |
| "master shipper" / "shipper case" / "outer case" | Master shipper | RSC | No (kraft) | Usually plain kraft RSC |

### Display-specific processes

| RFQ says | What it means | SPOT mapping |
|---|---|---|
| "litho lam" / "litho-laminated" / "paper-on-board" / "mount" / "litho mount" | Offset-printed sheet laminated to corrugated | `printMode: "Satin"` + ⚠️ WATCH (non-native; cost shown is digital Satin equivalent — flag for estimator review) |
| "pre-pack" / "pre-packed" | Display arrives at retailer already filled with product | Affects pack-out scope — note in Quote Notes; ASK if SPC handles pack-out |
| "KD" / "knocked down" / "ships flat" / "flat-packed" | Ships flat for retailer/distributor assembly | No SPOT field; note in Quote Notes |
| "auto-bottom" / "1-2-3 bottom" | Self-locking bottom assembly | May affect Glue: No (vs Yes for glued cases) |
| "lock-tab" / "slot-and-tab" / "friction fit" | Tab-and-slot assembly, no glue | Glue: No |
| "foil stamp" / "emboss" / "deboss" / "spot UV" | Specialty finishing not native to SPOT | ⚠️ WATCH; note in Quote Notes; estimator handles separately |

### Quantity language for displays

- "set" / "kit" / "unit" — one complete display = one set. Set quantities go in `qtys[]`.
- "X displays per case, Y cases" — multiply for total set qty.
- "components per display" — feeds `pcsPerSet` per item in BOM Builder. When building JSON by hand, set `pcsPerSet: 1` and put the multiplied qty in `state.qtys` (per Channel Ref L191).

### When in doubt

ASK. Display jargon varies by customer. A header card from one customer might be a topper from another and a marquee from a third. The registry exists for divergences — promote any SPC-specific display term to `EST_SPOT_Canonical_Terms.md` when discovered.

---

## §11 — Known Fail Modes

These are documented intake failures from prior sessions. The parser must actively guard against them.

| Antipattern | First seen | Guard |
|---|---|---|
| **Drill before scope** — drilled into one component, missed the BOM | 2026-04-28 | §5 BOM Scope Pass mandatory for >1-piece RFQs; §4 Method selection enforces |
| **Conditional BOM Scope skipped** — parser jumped to Simple grid without inventory because v2.2 trigger was conditional ("when RFQ describes >1 piece") | 2026-04-28 (v2.2 first-test) | v2.2.1: §5 trigger is unconditional; §3.0 first-move rule; §3.1 self-check; §12 hard blocker on missing inventory |
| **CKB → industry meaning** — expanded as Clay-Coated Bleached Kraft | 2026-04-21 | Registry lookup mandatory; §2 Precondition surfaces |
| **ECT 44 → across-grade substitution** — claimed fallback to ECT 32 | 2026-04-21 | Registry rule: ECT falls DOWN to Mullen, not ACROSS |
| **Re-ask answered question** — asked for ship-to ZIP after estimator gave it | 2026-04-21 | §2 Precondition: scan full conversation before asking |
| **Gloss default** — defaulted to Gloss when RFQ silent | pre-D-105 | Rule 8 + registry: Satin default, Gloss opt-in only |
| **routeOverride in JSON** | early R1.5.x | Hard rule + §8 Pass Criteria |
| **Initials drift** — Initials field went blank or to "MM" | early R1.5.x | UI blocks; §8 Pass Criteria |
| **D-081 custIdent clobber** — top-level custIdent ≠ `bomItems[0].custIdent` | D-081 | §8 Pass Criteria check for Multi-Part |
| **Master shipper dropped** — display RFQ mentioned shipper case but item count was N-1 | 2026-04-28 | §10 Display Vocabulary: master shipper always gets a row |
| **Inferred display dimensions** — guessed component dims from "typical" proportions | 2026-04-28 | §9 Display extraction rule 5: dims unclear → ASK |
| **Litho-lam silently mapped to Gloss** — non-native process treated as native print | 2026-04-21 | Channel Reference L81 + §10: litho-lam → Satin + ⚠️ WATCH |
| **Multi-Part fallthrough field bleed** — item 2 inherits item 1's flute when JSON gaps | pre-D-098 | applyState reset-first; not parser-controllable but verify Pass Criteria post-load |

When a new fail mode is seen in production, append a row here AND add the corresponding entry to `EST_SPOT_Session_Lessons.md`.

---

## §12 — Ship-Blocker Criteria

If ANY of the following are true at grid-approval time, intake is BLOCKED. Do not open Chrome until cleared.

### Hard blockers (zero exceptions)

- Any field tagged 🔴 ASK
- Any §2 Precondition unchecked
- **§5 BOM Scope inventory not produced (v2.2.1 — applies to ALL RFQs, including Simple)**
- **§5 BOM Scope inventory not approved by estimator**
- **Method (M1–M5) does not match the inventory (e.g., M1 declared but inventory has 2+ rows)**
- **§3.1 Self-check has any NO answer**
- M2/M3/M4: any component missing dims AND no drawing referenced
- `quoteType` doesn't match Method (e.g., M3 Display with `quoteType: "Simple"`)
- `routeOverride` set anywhere
- `estInitials` ≠ `"SPC"`
- `under5MsfFee` ≠ `"0"`
- ECT 44 present without manual mill-substitute confirmation (DEV-011)
- Registry-flagged term (CKB, etc.) resolved to industry meaning
- Top-level `custIdent` ≠ `bomItems[0].custIdent` in Multi-Part
- Top-level `qtys` ≠ each `bomItems[i].state.qtys` in Matched Set
- §5 BOM Scope component count ≠ `bomItems.length`

### Soft blockers (estimator may override; flag prominently)

- 🟡 ASSUMED count > 5 fields → ask estimator to confirm en masse
- ⚠️ WATCH count > 0 → flag prominently in handoff
- Custom board (non-stock) with no Buy Min check
- Destination FOB without ZIP confirmed
- Pcs-per-set for any item flagged ASSUMED rather than CONFIRMED
- Method = M5 (Other) — should normally route to estimator before grid

**On any blocker, communicate per §15 → "If something unexpected happens." State the blocker, name the field, hold for resolution.**

---

## §13 — Close Criteria

Intake is CLOSED when ALL of the following are true:

| # | Step | Verifies |
|---|---|---|
| 1 | §2 Preconditions all checked | Registry, version, conversation scan |
| 2 | §5 BOM Scope inventory produced + approved (ALL methods, including M1) | Every physical piece accounted for |
| 3 | §4 Method DERIVED from inventory (not pre-selected) | RFQ shape recognized via inventory |
| 4 | §3.1 Self-check all YES | First-move rule + grid match |
| 5 | §6/§7 grid approved by estimator | "go" / "approved" / equivalent |
| 6 | All 🔴 ASK fields resolved or escalated | No open questions |
| 7 | §8 Pass Criteria met | No antipatterns from §11 |
| 8 | §12 Ship-Blockers all clear | Hard + soft acknowledged |
| 9 | JSON built per `EST_SPOT_Channel_Reference.md` schema | Schema-valid |
| 10 | JSON loaded via `__SPOT_LOAD_JSON` (or runner for M1) | Loads cleanly, no console errors |
| 11 | Handoff message sent per §15 protocol | Estimator has the artifact |

**On close**, log the intake outcome to `EST_SPOT_Session_Lessons.md` only if a new pattern was learned. Do not log routine cases.

---

## §14 — When Intake Fails

1. **Stop.** Do not improvise.
2. **Identify the failure type:**

| Type | Meaning | Handoff |
|---|---|---|
| **F-PRE** | Precondition failure (registry not loaded, version mismatch) | File DEV-### in `01_OPEN_ISSUES.md`; channel switch implied |
| **F-SCOPE** | §5 BOM Scope not converging (ambiguous components) | ASK estimator with specific component named |
| **F-FIELD** | Specific field cannot be resolved (ASK estimator can't answer) | ASK with the field, the candidate values, and what info is missing |
| **F-RULE** | Rule conflict (e.g., RFQ requests routeOverride, hard rule forbids) | ASK + cite the rule and source file |
| **F-SCHEMA** | JSON won't load (Channel Reference schema mismatch) | File DEV-### with the offending payload + console error |
| **F-CHROME** | Chrome load fails (popup, alert, route flip, missing field) | Describe what SPOT did + ASK before continuing |

3. **Capture state:**
   - Current grid (whatever fields are filled)
   - The specific field/component blocking
   - Any console errors or toasts (F-CHROME)
4. **Communicate per §15.**
5. **After estimator unblocks:** resume from the failure point. Do not restart.

---

## §15 — Communication Protocol

### While reading the RFQ
> "Reading the RFQ and CAD file now..."

### First artifact for EVERY RFQ (unconditional, v2.2.1)
> "Running BOM Scope Pass — inventorying components first."
> [§5 scope grid, even if it's a single-row inventory for a Simple quote]

### Presenting the grid (after scope is approved)
> "Here's what I have. One question before I proceed: [single most important gap]."
> [grid]

### After approval
> "Got it. Entering into SPOT now — back in a moment."

### If something unexpected happens in SPOT (alert fires, routing flips, etc.)
> "SPOT auto-routed to Crest on this piece. Die cost is needed — do you have the die cost, or should I enter $0 and let you fill it?"

### Ship-blocker hit (§12)
> "Blocked: [field/condition] — [why this is a hard stop]. Need [what's required] before opening Chrome."

### Intake failure (§14)
> "Intake failed at [F-TYPE]. Captured state: [summary]. Need [estimator action] to unblock."

### Handoff (close criteria met)
> "Ready for review — [Customer] / [Part #]
> Est# [SPC-YYMMDD-XXXXXX] | [Board] | [W × L] | [Route] | [Qty]: $X.XX/pc — XX.X% GM
> SPOT is loaded. Preview Quote is accessible."

**That's the full handoff. Estimator takes over from there.**

---

## §16 — What I Do Not Do

- Do not guess and hope. If a field is unclear, I ask once before opening Chrome.
- Do not stay involved after handoff unless asked. The estimator owns the estimate from that point.
- Do not produce PDFs outside SPOT Preview Quote.
- Do not set `routeOverride` in JSON.
- Do not show board substitution language on customer quotes.
- Do not use "Mike" — always "Michael Musgrave".
- **Do not expand SPC domain tokens from training-data priors.** CKB ≠ Clay-Coated Bleached Kraft at SPC. Always go through `EST_SPOT_Canonical_Terms.md`.
- **Do not re-ask questions the estimator has already answered.** Scan the full conversation before asking.
- **Do not skip §5 BOM Scope Pass for any reason. (v2.2.1)** Single-piece RFQs still get a 1-row inventory. Do not assume a Simple quote and bypass the inventory. The inventory is the FIRST artifact for every RFQ.
- **Do not derive Method (M1–M5) before producing the inventory.** Method is an OUTPUT of inventory, not an input.
- **Do not skip components in a multi-part display.** Every physical piece gets a §5 BOM Scope row before any item gets a full grid.
- **Do not assume display components share a board.** Each component can have its own flute / grade / liner — verify per item.
- **Do not infer display dimensions from "typical" proportions.** If dims are unclear, ASK.
- **Do not include the pallet as an SPC item** unless the RFQ explicitly says SPC sources it (then Item Type: `Purchased`).
- **Do not open Chrome with any §12 hard blocker live.** Resolve first.

---

## §17 — RFQ Language → SPOT Field Mapping

| RFQ Says | SPOT Field | Value |
|---|---|---|
| "RSC", "regular slotted" | Style | RSC |
| "FOL", "full overlap" | Style | FOL |
| "display tray", "D/C" | Style | D/C Tray |
| "mailer", "auto-bottom" | Style | Mailer |
| "B flute", "B-flute" | Flute | B |
| "E flute", "e-flute" | Flute | E |
| "C flute" | Flute | C |
| "double wall", "DW" | Flute | BC |
| "200#", "200 Mullen" | Grade | 200 |
| "32 ECT", "ECT-32" | Grade | ECT 32 |
| "44 ECT", "ECT-44" | Grade | ECT 44 (uncommon — manual mill-substitute check, DEV-011 open for popup) |
| "kraft", "brown" | Liner | Kraft |
| "white outside", "MW" | Outside Liner | Kla-White |
| "bleached", "bright white" | Outside Liner | Bleached White |
| "Kemi", "clay coat" | Liner | Kemi-Lite |
| **"CKB"** | **Liner** | **42# Kemi-Lite (REGISTRY — SPC meaning, NOT industry's Clay-Coated Bleached Kraft)** |
| "Graphic White" | Liner | ASK (EST-GRPHCWHT pending) |
| "4/0", "4CP", "full color" | Print | On + Satin (Rule 8 default) |
| "satin", "matte" | Mode | Satin |
| "no print", "plain" | Print | Off |
| "die cut" (generic) | Route | Auto (let SPOT decide) |
| "flat bed" | Route | Auto (finishing descriptor, not override) |
| "hand stripped" | Strip | Yes |
| "glued", "joint" | Glue | Yes |
| "taped" | Tape | Yes |
| "delivered", "prepaid" | FOB | Destination |
| no FOB mention | FOB | Origin (default) |
| "existing die" | Die Cost | $0 (note on quote) |
| "new die needed" | Die Cost | ASK for cost |
| "FSC certified" | FSC | On |
| **Display terms (v2.2)** | | |
| "header card", "topper", "marquee" | Style | Display Header |
| "base", "floor", "platform" | Style | Display Base |
| "riser", "column", "spacer", "kicker" | Style | D/C Non-Joined |
| "tray", "chute", "product tray" | Style | D/C Tray |
| "divider", "partition", "fence" | Style | D/C Non-Joined |
| "easel", "back support" | Style | D/C Non-Joined |
| "hutch", "canopy" | Style | D/C Non-Joined |
| "pallet skirt", "skirt" | Style | D/C Non-Joined |
| "master shipper", "outer case" | Style | RSC (kraft, Print: Off) |
| "litho lam", "paper-on-board", "mount" | Print Mode | Satin + ⚠️ WATCH |
| "pre-pack", "pre-packed" | Quote Notes | "Pre-packed at SPC — confirm pack-out scope" + ASK |
| "KD", "knocked down", "ships flat" | Quote Notes | "Ships flat" |
| "lock-tab", "slot-and-tab", "auto-bottom" | Glue | No |
| "foil stamp", "emboss", "spot UV" | Quote Notes + ⚠️ WATCH | Estimator handles separately |

---

## §18 — Cross-References (source of truth per rule)

Every rule in this harness traces back to a primary source. If the primary source disagrees, the primary source wins.

| Topic | Source of truth |
|---|---|
| SPC meaning of any domain token | `EST_SPOT_Canonical_Terms.md` |
| Reading discipline (registry load, no priors, no re-ask) | `Reading_Discipline_Protocol.md` |
| Hard rules (Initials, FOB, routeOverride, under5MsfFee, FSC, etc.) | `EST_SPOT_Quoting_Rules.md` |
| JSON schema (every field name, allowed values, type) | `EST_SPOT_Channel_Reference.md` |
| UI control mapping per field | `EST_SPOT_UI_Map.md` |
| Engine constants (rates, GM curve, paper uplift, ink) | `DEV_SPOT_R1_5_Control_Tables.md` |
| Past intake patterns + lessons | `EST_SPOT_Session_Lessons.md` |
| Open intake / dev / test items | `01_OPEN_ISSUES.md` |
| Past closures and rate history | `02_RELEASE_HISTORY.md` |
| Test-pattern decision rigor (informed §1, §2, §8, §11, §12, §13, §14) | `TEST_SPOT_R1_5_Chowder_Specs.md` + `TEST_SPOT_R1_5_Testing_Guide.md` |

**If a rule in this harness is not traceable to one of these files, the rule is suspect and must be reconciled before being applied.**
