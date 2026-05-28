# SPOT Intake Record — {{CUSTOMER}} / {{PART_NO}}

> **File convention:** one file per estimate.
> Path: `/home/claude/estimates/<folder_name>/intake_<folder_name>.md`
> Created by: `EST_SPOT_Batch_Kickoff.md` at Phase 1.
> Schema anchor: `EST_SPOT_Intake_Harness.md` (v2.1).
> This file is the durable record. The in-chat intake grid is a view of this file.

---

## 0. Reading discipline check (runs FIRST, every estimate)

**Non-optional. No RFQ content is read or extracted until this section is complete.**

This check exists because SPC uses non-standard vocabulary for packaging terms. Training-data priors diverge from SPC meaning on multiple tokens (CKB, ECT 44 substitution direction, Kemi-Lite liner family, Crest/CAD route names, and others). See `EST_SPOT_Canonical_Terms.md` for the full registry and divergence flags.

| Check | Status |
|-------|--------|
| `EST_SPOT_Canonical_Terms.md` loaded fresh this session (not recalled) | [ ] |
| `Reading_Discipline_Protocol.md` five rules acknowledged in force | [ ] |
| Full conversation scanned for already-answered fields (Rule 5) | [ ] |
| SPC version check (`window.__SPOT_UI_VERSION` vs `MAP_VERSION`) passes | [ ] |

### Non-standard vocabulary note

SPC is not a corrugated-centered shop in the industry-standard sense. The following token classes require registry resolution before entering the grid:

- **Liner abbreviations** (CKB, MW, Kemi, bleached, white) — at SPC, "CKB" means Corrugated Kraft Board = 42# Kemi-Lite, NOT the industry's Clay-Coated Bleached Kraft folding-carton grade. Always resolve through the registry.
- **ECT grade handling** — ECT grades substitute DOWN to Mullen stock sheets (not across to another ECT). ECT 44 is uncommon at SPC; manual mill-substitute check (popup guardrail scoped in D-098 but never coded — DEV-011 open).
- **Route names** — "CAD" is a route, not Computer-Aided Design. "Crest" is SPC's flat-bed die-cutter line.
- **Print finish defaults** — Satin is the default, never Gloss (Rule 8; flipped 2026-04-21 via D-105).
- **Fee names** — FSC/SFI is amortized into board at $25/order (was $15 pre-D-086). under5MsfFee is $0 at SPC (rule 3).
- **Paper uplift** — +10% is baked into `ENGINE.base_matrix`. Not a user field. D-102 closed — uplift data in engine source.

If any token in the RFQ is ambiguous or not covered by the registry, it becomes an **ASK** in section 12 before any grid is posted.

### Tokens encountered in this RFQ (fill as read)

| Customer token | SPC meaning | Source |
|----------------|-------------|--------|
| | | REGISTRY / ASK |
| | | REGISTRY / ASK |
| | | REGISTRY / ASK |

---

## 0.1 Record Header

| Field | Value |
|-------|-------|
| Folder name | `<folder_name>` |
| Created | YYYY-MM-DD HH:MM |
| Estimator | Michael Musgrave |
| RFQ source | email / phone / file drop |
| Source files | list of attachments referenced |
| Status | INTAKE / GRID-APPROVED / IN-SPOT / HANDED-OFF |

---

## 1. Customer & Contact

| Field | Value | Source tag |
|-------|-------|-----------|
| Customer name | | RFQ / ASK |
| Contact name | | RFQ / ASK |
| Contact email | | RFQ / ASK |
| Contact phone | | RFQ / DEFAULT / ASK |
| Payment terms | Net 30 | DEFAULT |

---

## 2. Part Identity

| Field | Value | Source tag |
|-------|-------|-----------|
| Customer Ident (part # / SKU) | | RFQ / ASK |
| Project / custRef | | RFQ / ASK |
| Description | | RFQ / ASK |
| Initials | **SPC** | ALWAYS (locked — blocked from manual entry) |

---

## 3. Dimensions

| Field | Value | Units | Source tag |
|-------|-------|-------|-----------|
| Width (corr dir) | | in | RFQ / CAD / ASK |
| Length (mach dir) | | in | RFQ / CAD / ASK |
| Depth (if tray / box) | | in | RFQ / CAD / N/A |
| Gusset (if mailer) | | in | RFQ / CAD / N/A |
| Blank W × L (flat) | | in | CALC |
| Inside vs outside dims | inside / outside | — | RFQ / DEFAULT |

---

## 4. Board Spec

| Field | Value | Source tag |
|-------|-------|-----------|
| Style | RSC / FOL / D-C Tray / Mailer / 5PF | RFQ / ASK |
| Flute | B / C / E / B-C | RFQ / ASK |
| Grade | 200 / 250 / 275 / ECT 32 / ECT 44 / other | RFQ / ASK |
| Outside Liner | Kraft / Kla-White / Kemi-Lite / Bleached White | RFQ / REGISTRY / DEFAULT |
| Inside Liner | Kraft / Kla-White / Kemi-Lite / Bleached White | RFQ / REGISTRY / DEFAULT |
| Medium | None / 26# / 33# / 35HPL# / 40# / 42# Bl | RFQ / DEFAULT |
| FSC / SFI | Off / On ($25 when On — D-086) | RFQ / DEFAULT |
| Board notes | ECT grades run on Mullen via fallback (do not surface to customer). ECT 44 uncommon — manual mill-substitute check (popup scoped D-098 but not coded — DEV-011). | — |

---

## 5. Quantities (multi-break)

| Break | Qty | Source tag |
|-------|-----|-----------|
| Break 1 | | RFQ / ASK |
| Break 2 | | RFQ / ASK / — |
| Break 3 | | RFQ / ASK / — |
| Break 4 | | RFQ / ASK / — |
| Break 5 | | RFQ / ASK / — |

---

## 6. Print

| Field | Value | Source tag |
|-------|-------|-----------|
| Print | On / Off | RFQ / DEFAULT |
| Mode | Gloss / Satin / OnQ Sty / OnQ LB | DEFAULT: **Satin** (rule 8 — never default Gloss) |
| Sides | 1-Side / 2-Side / White | RFQ / DEFAULT |
| Colors | e.g. 2C + flood | RFQ / ASK |
| Saber | Yes / No | RFQ / DEFAULT: No |

---

## 7. Finishing & Operations

| Op | Yes/No | Sub-field | Value | Source tag |
|----|--------|-----------|-------|-----------|
| MATS | | — | — | RFQ / DEFAULT |
| Strip | | Difficulty | Simple / Straight / Std / Complex | RFQ / DEFAULT |
| Strip | | Edge strip | Yes / No | RFQ / DEFAULT |
| Glue | | Joints | count | RFQ / ASK |
| Glue | | Difficulty | Simple / Std / Complex | RFQ / DEFAULT |
| Tape | | Type | Clear / Reinforced | RFQ / DEFAULT |
| Other | | — | — | — |

---

## 8. Routing

| Field | Value | Source tag |
|-------|-------|-----------|
| Route | **Auto** (never set routeOverride in JSON — rule 1) | DEFAULT |
| Difficulty | Simple / Std / Complex / Extreme | DEFAULT: Std |
| CAD price mode | Diff / Rule | DEFAULT: Diff |
| Rule in/pc | — | (only if Rule) |
| Perf % | — | (only if Rule) |

---

## 9. Die

| Field | Value | Source tag |
|-------|-------|-----------|
| Die type | Existing / New / N/A | RFQ / ASK |
| Die cost | $ | RFQ / ASK |
| Die treatment | None / Separate Line / Amortized | DEFAULT: Separate Line (D-085 auto-default on first Crest route) |

---

## 10. Ship-To & Freight

| Field | Value | Source tag |
|-------|-------|-----------|
| FOB | **Origin** (ZIP 44704) unless customer requests Destination | DEFAULT (rule 9) |
| Freight type | None / Line / Amortized | DEFAULT: Line |
| Ship-to customer | | RFQ / ASK |
| Ship-to address | | RFQ / ASK |
| Ship-to ZIP | | RFQ / ASK |

---

## 11. Quote Header

| Field | Value | Source tag |
|-------|-------|-----------|
| Payment terms | Net 30 | DEFAULT |
| Quote valid (days) | 30 | DEFAULT |
| Quote notes | | RFQ / — |

---

## 12. Notes / ASKs / Flags

🔴 **ASK** — list open questions (one per line)
🟡 **ASSUMED** — list defaults applied (one per line)
🟢 **CONFIRMED** — list fields explicitly stated in RFQ
🔵 **REGISTRY** — list customer-token → SPC-token resolutions (one per line; reference `EST_SPOT_Canonical_Terms.md`)
⚠️ **WATCH** — list entry-time gotchas (ECT-on-Mullen substitution, ECT 44 popup, stock-sheet Buy Min bypass, fresh vs dirty JSON load, etc.)

---

## 13. Handoff Summary (filled at end of Phase 4)

| Field | Value |
|-------|-------|
| Estimate # | |
| Customer / Part # | |
| Board | |
| Blank size | |
| Route (auto-selected) | |
| Sheet size / N-out | |
| Qty 1 price / each / MSF | |
| Qty 2 price / each / MSF | |
| Qty 3 price / each / MSF | |
| GM at each qty | |
| Freight | |
| FOB | |
| Notes for estimator review | |

---

## 14. Revision log (append-only)

| Date/time | Phase | Change |
|-----------|-------|--------|
| | Phase 0 | Reading discipline check completed |
| | Phase 1 | Intake instantiated from RFQ |
| | Phase 2 | Grid approved / corrected |
| | Phase 4 | Entered into SPOT |
| | Phase 5 | Handoff delivered |
```

