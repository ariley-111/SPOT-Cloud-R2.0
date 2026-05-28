# SPC Canonical Terms Registry

> **WARNING — READ BEFORE USING ANY DOMAIN TOKEN**
>
> Standard Printing Company is NOT a corrugated-centered environment, and not all terms here match industry-standard usage. Training-data priors about packaging vocabulary are frequently UNSAFE at SPC. If a token is in this registry, the SPC meaning wins. If a token is not in this registry and it could plausibly be SPC-specific, ASK the estimator. Do not expand from general knowledge.
>
> Load this file fresh at the start of every EST session, and re-load whenever a domain token appears in a message.

> Created: 2026-04-21 (D-103). Triggered by the 2026-04-21 CKB / ECT 44 / re-ask failure cluster.
> Referenced by: `Reading_Discipline_Protocol.md`, `EST_SPOT_Quoting_Rules.md`, `EST_SPOT_Intake_Harness.md`, `EST_SPOT_Intake_Template.md`, `EST_SPOT_Batch_Kickoff.md`, `DEV_SPOT_R1_5_Control_Tables.md`.

---

## How to read this registry

Every row is: **term | SPC meaning | industry-standard meaning | source of truth**.

- **term** — the token as it appears in RFQs, customer emails, internal notes.
- **SPC meaning** — what it means at Standard Printing Company. This is authoritative.
- **industry-standard meaning** — what the general packaging / printing industry uses the term for. Included specifically so the assistant can see when SPC and industry diverge.
- **source of truth** — the file or code location that pins the SPC meaning.

When SPC meaning ≠ industry meaning, there is a ⚠️ row flag.

---

## Liner & board tokens

| Term | SPC meaning | Industry-standard meaning | Source of truth |
|------|-------------|---------------------------|-----------------|
| ⚠️ **CKB** | Corrugated Kraft Board = 42# Kemi-Lite (SPC's default clay-coated kraft liner). When a customer says "CKB" at SPC, they mean the Kemi-Lite liner family. | Clay-Coated Bleached Kraft — a folding carton (non-corrugated) paperboard grade. Completely different product. | `spot_engine.js` `liner_upgrades["42# Kemi-Lite"]`; `DEV_SPOT_R1_5_Control_Tables.md` Liners table. |
| **Kemi-Lite** | SPC's clay-coated kraft liner family. `42# Kemi-Lite` is the main variant, priced at $18.50/MSF upgrade over kraft. | Kemi-Lite is a brand name from BillerudKorsnäs (Swedish mill) — clay-coated kraft used industry-wide. | `spot_engine.js` line ~60 `liner_upgrades`. |
| **Kla-White** | SPC's mottled-white kraft liner. `42# Kla-White` is the standard white outside liner; `33# Kla-White` is an allowed upgrade on 175 / ECT 32 only; `56# Kla-White` is allowed on 250 only. | "Kla-White" is a generic mottled-white kraft liner term used by several mills. | `spot_engine.js` `liner_upgrades` + `allowed_board_grades` enforce. |
| **Bleached White** | SPC's fully bleached liner. `42# Bleached White` is available as an upgrade at $17.50/MSF. Used when customer explicitly says "bleached" or "bright white". | Standard term across the industry — bleached kraft liner. | `spot_engine.js` `liner_upgrades["42# Bleached White"]`. |
| **Kraft / Brown** | Default liner. No upgrade charge. | Same — standard brown kraft. | `spot_engine.js`. |
| ⚠️ **MW / Mottled White** | Maps to `42# Kla-White` at SPC — NOT `42# Bleached White`. | Generically could mean either mottled-white kraft or bleached-white kraft depending on mill. | `EST_SPOT_Intake_Harness.md` mapping table. |
| **Graphic White** | OPEN — see `EST-GRPHCWHT` in `01_OPEN_ISSUES.md`. Pending estimator decision on how this customer-facing term maps to SPC liner codes (likely a variant of Kla-White or Bleached White). | Generic term for a printable-white liner; varies by mill. | TBD. |

---

## Grade / ECT tokens

| Term | SPC meaning | Industry-standard meaning | Source of truth |
|------|-------------|---------------------------|-----------------|
| **200 / 200#** | 200# Mullen test singlewall board. SPC stock grade. | Same — 200 lb/sq-in Mullen burst test rating. | `spot_engine.js` `base_matrix.singlewall["200"]`. |
| **ECT 32** | 32 ECT singlewall board. At SPC, runs on Mullen 200# sheet stock via grade fallback. Do NOT show this substitution on customer-facing quotes. | Standard 32 ECT rating — should run on ECT-specified stock at most mills. | `spot_engine.js` `base_matrix.singlewall["ECT 32"]` + Intake Harness "ECT grades run on Mullen" rule. |
| ⚠️ **ECT 44** | Uncommon at SPC. Substitutes DOWN to Mullen 200# sheet stock via grade fallback (same direction as other ECT grades — substitutes DOWN to Mullen, not across to another ECT). Mill substitute check is MANUAL — the D-098 release notes claimed a popup guardrail was shipped but code audit 2026-04-21 confirmed it was never implemented. Tracked as DEV-011 (target R1.6). | ECT 44 is a common heavy-duty ECT rating used industry-wide with no special handling. | `spot_engine.js` `base_matrix.singlewall["ECT 44"]`; `DEV_SPOT_R1_5_Control_Tables.md` Board/ECT table; `01_OPEN_ISSUES.md` DEV-011. |
| **ECT 42 / 48 / 51 / 61 / 71 / 82** | Doublewall ECT grades. Standard availability. | Standard industry doublewall ECT ratings. | `spot_engine.js` `base_matrix.doublewall`. |
| **Mullen** | Paper burst test (pounds per square inch). "200 Mullen" = 200# board. At SPC, all ECT grades fall back to Mullen stock sheets via grade substitution. | Mullen is a specific ASTM paper test standard. | `spot_engine.js` base_matrix. |

---

## Routing tokens

| Term | SPC meaning | Industry-standard meaning | Source of truth |
|------|-------------|---------------------------|-----------------|
| ⚠️ **Crest** | SPC's flat-bed die-cutter line. Route chosen when CAD hours or sheet imposition favor it. Max piece 60×120 after rotation check. Setup Std 45 min / Adv 90 min at $45/hr. | "Crest" is a trademarked brand name used by several equipment makers; not a route type per se. | `spot_engine.js` routing section; `DEV_SPOT_R1_5_Control_Tables.md` Routing table. |
| ⚠️ **CAD** | SPC's corrugated rotary cutter route. At $138/hr with 650 in/min speed (D-110 FINAL — was $160). "CAD" here is a route name, NOT Computer-Aided Design. | CAD industry-wide means Computer-Aided Design. | `spot_engine.js` `ASMP_DEFAULTS.cadRate`. |
| **Route: Auto** | SPOT auto-selects CAD vs Crest based on CAD hours + sheet imposition. The default. | n/a — SPOT-specific. | `spot_engine.js` `autoRoute()`. |
| **routeOverride** | A JSON field that MUST NEVER be set. Forced routes are UI-only (estimator clicks Switch). Rule 1 in `EST_SPOT_Quoting_Rules.md`. | n/a — SPOT-specific. | `EST_SPOT_Quoting_Rules.md` Hard Rules. |

---

## Print & finish tokens

| Term | SPC meaning | Industry-standard meaning | Source of truth |
|------|-------------|---------------------------|-----------------|
| ⚠️ **Gloss (print finish)** | Opt-in only as of 2026-04-21. NEVER the default. 75 sheet/hr (equalized with Satin per D-110). Must be explicitly requested by the customer. | Generic printing term with no strong default-vs-opt-in prior. | `spot_engine.js` `PRINT_SPEEDS.Gloss`; Rule 8 in quoting rules (flipped 2026-04-21). |
| **Satin (print finish)** | SPC default digital print finish (as of 2026-04-21). 75 sheet/hr (equalized with Gloss per D-110). Used unless customer explicitly asks for Gloss or another finish. | Generic printing term. | `spot_engine.js` `PRINT_SPEEDS.Satin`; Rule 8 in quoting rules. |
| **OnQ Styrene / OnQ Lightbox** | SPC-specific substrate + finish combos. 50 and 40 sh/hr respectively. | OnQ is a specific workflow name; not industry-standard terminology. | `spot_engine.js` `PRINT_SPEEDS`. |

---

## Fee & business-rule tokens

| Term | SPC meaning | Industry-standard meaning | Source of truth |
|------|-------------|---------------------------|-----------------|
| **FSC / SFI** | Chain-of-custody fee, amortized into board cost. $25/order at SPC. Was $15 pre-D-086; migration $15→$25 fires on load of old estimates. | Forest Stewardship Council / Sustainable Forestry Initiative — real certification programs. The fee at SPC covers both. | D-086 ship entry in `02_RELEASE_HISTORY.md`; `DEV_SPOT_R1_5_Control_Tables.md` Fees. |
| **under5MsfFee** | $0 at SPC. Historically a corrugator charge that DOES NOT apply to WF shop orders. Always set to "0" in JSON. Rule 3. | Not an industry-standard term. | Rule 3; `spot_engine.js` `fixed_charges.under_5_msf_setup_fee.amount`. |
| **Buy Min** | Mill minimum board order (15,000 sqft default). Triggers only on custom/forced boards. Stock sheets bypass Buy Min per D-067. Auto-fires in the UI when bc is below min and no stock resolution. | "Buy minimum" is a generic procurement term industry-wide. | D-067 in release history; `DEV_SPOT_R1_5_Control_Tables.md`. |
| **Paper uplift** | +10% uplift baked into ENGINE.base_matrix values at 2026-04-14 calibration. Not exposed as a user field. | Not an industry-standard term. | D-102 (closed). Uplift data in `spot_engine.js` base_matrix. |
| **Ink rate** | $0.05/sqft at SPC. Business-decision LOCKED — not a calibration target. | Generic term — varies by shop. | `spot_engine.js` `ASMP_DEFAULTS.regularInkRate`. |
| **Initials** | Always "SPC" for AI-generated estimates. Field is blocked from manual entry in the UI. | Not applicable — estimator-system-specific. | Rule 2 + control tables Metadata. |
| **FOB: Origin** | ZIP 44704 (Canton OH, SPC's plant). Default unless customer explicitly requests Destination. | FOB Origin is a standard shipping term; the SPC specificity is the ZIP default and the ASK-on-history rule. | Rule 9. |

---

## How this registry is maintained

- Append-only. Once a term is in, its row is not deleted — it can only be corrected with a dated note.
- New terms enter here when a session surfaces a divergence between SPC meaning and training-data prior, or when a customer uses a term SPOT does not know.
- Divergence rows carry ⚠️ in the leftmost cell so they are obvious on quick scan.
- Every row points to a source of truth. If the source file changes, the row is re-verified.

---

## Reading discipline check

Before answering ANY message that contains a term from this registry, the assistant must:

1. Confirm the registry has been loaded in this response (Rule 1 of `Reading_Discipline_Protocol.md`).
2. Use the SPC meaning, not the industry-standard meaning.
3. If a term is not in the registry and could be SPC-specific, ASK before proceeding.
```

