# 05 — Business Rules

## The ten hard rules

These are the rules every quote, every mode, must follow. They're not suggestions. Violations have produced specific past defects.

### Rule 1 — Never set `routeOverride` in JSON

Forced routes are an estimator tool in the UI only. The estimator clicks **Switch to CAD** or **Switch to Crest** in the Route Comparison panel. The JSON output never contains `routeOverride`. Auto-route always.

**Why:** A forced route in JSON locks in a routing decision that depends on stock-sheet availability, die-cost amortization, and operator preference — all of which change. Stored quotes loaded later need to re-route under current conditions. If `routeOverride` is stuck in the JSON, the load ignores the current auto-route and produces stale pricing.

**Enforcement:** The state-management layer strips `routeOverride` on save. The runner refuses to honor it.

### Rule 2 — Initials are always "SPC" for AI estimates

The `#cust-initials` field is blocked from manual entry. AI-generated estimates always read "SPC".

**Why:** Estimator initials are an auditing field — they identify who quoted what. AI quotes are attributed to the system, not to a human estimator. Allowing manual edit would let an AI quote masquerade as a human estimate.

### Rule 3 — `under5MsfFee` is always "0"

WF shop does not carry the corrugator under-5-MSF surcharge. The field exists for legacy compatibility but is always zero.

**Why:** The fee was a corrugator-level charge for short runs that the WF shop never had to recoup. Setting it to anything nonzero produces a phantom $500 on every short-run quote.

**Enforcement:** Rate migration on load forces "0".

### Rule 4 — ECT grades run on Mullen sheets (grade fallback)

When a customer requests ECT 32, SPC substitutes 200# Mullen stock. The substitution is procurement, not customer-facing. **Never show the substitution on quotes.**

**Special case:** ECT 44 is uncommon at SPC. Substitutes down to 200# Mullen too (not across to another ECT grade). Mill-substitute check is manual — the D-098 popup guardrail was scoped but never coded. Tracked as DEV-011, target R1.6.

### Rule 5 — Stock sheets bypass Buy Min (D-067)

Mill minimum-buy quantities apply only to custom or forced boards. Stock sheets — anything pulled from the Sheet Library — never trigger a Buy Min check.

**Why:** Stock sheets are pre-purchased in volume; the mill min has already been satisfied at procurement time. Triggering Buy Min on stock sheets produces phantom inflation on small orders.

### Rule 6 — Rate migration fires on load

When an estimate is loaded, the rate-migration block in `applyState()` snaps Advanced Controls and Board Engine rates to current `RATE_DEFAULTS`. **Sell prices are NOT changed** — historical quotes preserve their original sell.

The migration fires the amber toast to notify the estimator. The estimator decides whether to re-quote at new rates. The system does not silently reprice.

The FSC $15→$25 migration also fires under this same path (D-086).

### Rule 7 — `applyState` and `applyItemState` are reset-first

Loaded state replaces current state. It does not merge. See `02_Architecture.md` §State management for the pseudocode. Three closed defects (D-080, D-087, D-098) trace to merge-vs-reset bugs.

### Rule 8 — Default print finish is Satin

Never default to Gloss. Flipped under D-105 on 2026-04-21 as a business decision.

**Why:** Satin is the more common SPC default; Gloss is opt-in when customer asks. Auto-defaulting to Gloss produces premium pricing on jobs the customer didn't request a premium finish for, leading to lost bids.

### Rule 9 — FOB: Origin (ZIP 44704) unless customer explicitly requests Destination

The default is Origin. Destination only fires on explicit customer request.

### Rule 10 — PDF quotes come from SPOT Preview Quote ONLY

No reportlab, no fpdf, no external PDF generator. If Preview Quote is inaccessible, **STOP**, tell the estimator, do not substitute.

**Why:** The Preview Quote PDF is the audit-of-record. Customers receive PDFs that match exactly what SPOT shows in the Cost Report. An external generator can drift from the JSX rendering and produce a PDF that doesn't match the saved estimate.

---

## Routing logic

### When CAD wins
- Short runs (low MSF) where Crest die-cost amortization doesn't pencil out
- No-die jobs where CAD's $0 setup-die cost beats Crest's $1,200 default
- Sheets larger than 60×120 (Crest is out of envelope)

### When Crest wins
- Medium-to-long runs where the per-piece time savings beat CAD's hourly rate
- Jobs with an inserted (existing) die where CAD has to pay setup but Crest doesn't
- Jobs above the breakeven quantity (panel surfaces this when both routes viable)

### When Bobst wins (D-121, eligibility gated)
- E or F flute, sheet in Bobst envelope (13.78×15.75 to 41.75×29.125)
- Volume runs where the 3,000 sh/hr speed dominates
- D-123: Bobst-first sizing tries Bobst's own envelope-eligible sheets per route

### Auto-route preference

When all routes are viable, **Bobst → Crest → CAD**. Cheapest wins; preference is the tie-breaker.

### Force-route guardrails

- B/C flute + Bobst: hard-blocked, toast refuses (physical constraint)
- Out-of-envelope sheet + Bobst: hard-blocked, toast refuses
- Sheet > 60×120 + Crest: hard-blocked
- All others: warning, but proceed

---

## GM curve

| MSF tier | GM | Why |
|---|---|---|
| 0–1 | 50% | Small jobs cost more to handle per piece |
| 1–3 | 37% | |
| 3–5 | 32% | |
| 5–9 | 27% | |
| 10+ | 25% | Floor — prevents volume giveaways |

The floor at 5+ MSF is a P5 planned deviation from iQuote, where volume jobs sometimes ran at 12–18% GM. The P1 fleet sell premium of +8.30% across the 773-job baseline reflects this discipline.

The GM curve is applied as `sell = cost / (1 - gm_target)` at the per-qty level. Each qty slot has its own MSF, its own tier, its own GM.

---

## Freight rules

### Local zones (D-119)

Three SPCOC flat rates apply when:
- Total weight ≤ 10,000 lbs **AND**
- Trailer-feet ≤ 24

| Zone | Rate | Coverage |
|---|---|---|
| Canton | $45 | Local ZIP cluster |
| Akron | $70 | Near ZIPs |
| Cleveland | $95 | Regional ZIPs |

ZIP-to-zone mapping is in `spot_server.js`. The zone is determined by the destination ZIP from the customer record or the override entered in the UI.

### UTS API

For everything else (over weight OR over trailer-ft OR out-of-zone ZIP), the server hits the UTS API via `/api/freight` and returns carrier quotes. The Freight Dashboard shows per-component rows (origin, dest, weight, dim) and a carrier table. "Compare Now" runs ~28 API calls in ~15 seconds.

### Markup

15% client-side, visible and editable in the Freight Dashboard. Applied to all quotes (local zone or UTS).

### Failure mode

If UTS is down: SPCOC local zone falls through for eligible jobs. If both fail, estimator enters freight manually. Non-blocking.

---

## Save/load semantics

### What gets saved

`Save Estimate` archives the current state to `localStorage["wftabest{timestamp}"]`. The JSON includes:
- All identifying fields (customer, contact, part#, etc.)
- All board, dims, qtys, ops
- The full BOM (for Multi-Part)
- The rates the estimate was computed at
- A version stamp (`SPOT_SCHEMA_VERSION`)

### What gets migrated on load

- Rate fields → current `RATE_DEFAULTS` (Rule 6)
- FSC $15 → $25 (D-086)
- `under5MsfFee` → "0" (Rule 3)
- CAD difficulty Extreme → Complex (D-106 rename)
- Strip difficulty Extreme → Complex (D-106 rename)
- Schema version 1 → 2 transformations

### What doesn't get migrated

- Sell prices — preserved as-is, historical record
- Customer ship-to fields — preserved
- Override flags (manual sheet selection, manual sheet size) — preserved
- `routeOverride` — stripped if present (Rule 1)

---

## Multi-Part vs Simple mode

Mode is inferred from `bomItems.length`:
- `length === 1` → Simple mode UI
- `length > 1` → Multi-Part mode UI (BOM strip with item tabs)

In Multi-Part mode:
- Each item has its own dims, board, route, qtys
- `pricingMode` is typically "Matched Set" (vs "Individual" for Simple)
- `setMarginPct` controls the set-level GM target
- Freight rolls up to the whole order

**Schema gotcha:** Top-level `custIdent` must match `bomItems[0].custIdent` in Multi-Part. D-081 was a scoping bug where the top-level value clobbered the active item. The intake harness now mirrors them explicitly.

---

## Default print sides

| Customer description | `printSides` | `numColors` |
|---|---|---|
| "Full color outside" | `"1-Sided"` | 4 |
| "Full color both sides" | `"2-Sided"` | 4 |
| "White flood" | `"White"` | 0 |
| "Plain kraft" | (no print) | n/a |

---

## Pricing precedence

1. **Stock sheet beats custom** — engine prefers stock if available within tolerance
2. **Cheapest route wins** — auto-route compares all viable routes
3. **Higher N-out wins within a route** — sheet selection maximizes pieces per sheet
4. **GM curve floors at 25%** for 10+ MSF
5. **Per-job GM never exceeds the tier ceiling** even if cost is very low

---

## The Saber path

A separate cutting path for irregular blanks. When `saber: "Yes"`:
- `saberCuts` — number of saber cuts
- `saberBlanksOut` — blanks per saber cut

The engine prices this as additional CAD time at the standard rate.

---

## When rules conflict with what a customer asks

Rules 2, 3, 4, 5, 7, 10 are non-negotiable — they ship as-coded. Rules 1, 6, 8, 9 are policy that can be overridden if the customer explicitly requests something different and the estimator agrees.

Example: customer says "we need this on Gloss." Override Rule 8's Satin default; print Gloss. No code change needed, just an estimator selection.

But: a customer cannot ask for an over-quote (Rule 5 bypassed for stock sheets), and the estimator cannot bypass Rule 7 by hand-editing JSON to merge state. The rules are layered: machine-enforced (1, 2, 3, 5, 6, 7, 10) vs policy (4, 8, 9).
