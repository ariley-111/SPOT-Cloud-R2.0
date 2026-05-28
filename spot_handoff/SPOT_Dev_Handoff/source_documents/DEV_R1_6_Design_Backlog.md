# SPOT R1.6 — Design Backlog (DRAFT — Discussion in progress)

> Captures Michael's 2026-04-25 design conversation: customer auto-populate, drop-zone Claude RFQ parser, freight map routing, diecutter info / Bobst addition. Plus three bug findings from the TC chowder run that should be filed as their own D-### tickets before R1.6 work starts.
>
> **Status: PRE-SPEC.** No coding until each item has a confirmed scope and answers to the open questions in this file.

---

## Part 1 — Bug findings from the chowder (file as D-### before R1.6 work)

### Candidate D-113 — `wf_default_pricing_targets` localStorage holds pre-D-110 GM curve

> **STATUS: SHIPPED in D-117 (R1.5.4 point fixes, 2026-04-25).** GM localStorage migration useEffect now auto-migrates 48/42/36/30/25 → 50/37/32/27/25 on app load with toast. See `02_RELEASE_HISTORY.md` D-117 entry. Notes below preserved as historical context.

**Surfaced in:** TC-018 / TC-020 chowder run, 2026-04-25.

**Evidence:**
```js
localStorage["wf_default_pricing_targets"]
// → {"gm":{"0-1":0.48,"1-3":0.42,"3-5":0.36,"5-9":0.30,"10-24":0.25, ...}, "sell": {...}}
```
That's the pre-D-110 curve (48/42/36/30/25). D-110 FINAL set engine `GM_DEFAULTS` to **50/37/32/27/25** on 2026-04-24. The localStorage entry is older than D-110 and was never migrated.

**Impact:** Live quotes on this machine were potentially using the stale curve until I overwrote it via `__TC_RESET_DEFAULTS()`. Any quote loaded from a saved archive that doesn't override `gmByTier` reads from this stale localStorage default.

**Severity:** Real money risk. Pre-D-110 0-1 MSF tier was 48% GM; D-110 FINAL is 50%. A 2pt margin underbidding on every fresh estimate where the estimator didn't manually set GM.

**Fix proposal:** On app load, compare `wf_default_pricing_targets.gm` to engine `GM_DEFAULTS`. If different, prompt OR auto-migrate (probably auto-migrate with a toast: "Pricing targets updated to D-110 FINAL values"). Same pattern as the existing FSC $15→$25 migration (D-086).

**Tracking:** Open as D-113 next session. Target R1.5.4 (point fix, not R1.6 feature).

---

### Candidate D-114 — `printMode` defaults to "Gloss" when JSON omits it

> **STATUS: SHIPPED in D-117 (R1.5.4 point fixes, 2026-04-25).** `RATE_DEFAULTS.defaultPrintMode` flipped Gloss → Satin across `useState`, 6 fallback paths, 2 reset paths, runner L53. Zero Gloss defaults remain. See `02_RELEASE_HISTORY.md` D-117 entry. Notes below preserved as historical context.

**Surfaced in:** TC-018 (Simple) and TC-021 (Multi-Part), 2026-04-25.

**Behavior:** When a JSON payload is loaded with `printReq: "No"` and no explicit `printMode`, applyState writes `printMode: "Gloss"` — the engine's `ASMP_DEFAULTS.printMode`. But Rule 8 says SPC default is **Satin**.

**Impact:** Cosmetic in pricing (printReq=No skips print cost calculation entirely), but it's a doc/behavior mismatch and the field can leak into edge cases (toggle printReq → Yes, suddenly Gloss is selected).

**Severity:** Low. Doc-vs-code drift, no money at stake.

**Fix proposal:** Update `ASMP_DEFAULTS.printMode` in `spot_engine.js` from `"Gloss"` to `"Satin"`. One-line change. Verify no test regressions (D-110 FINAL fleet results were measured with Gloss/Satin equalized speeds, so cost is unaffected).

**Tracking:** Open as D-114 next session. Target R1.5.4.

---

### Candidate D-115 — TC-024 doc says "Forced: CAD"; actual UI says "✓ Route forced to CAD"

> **STATUS: SHIPPED in D-117 (R1.5.4 point fixes, 2026-04-25).** Chowder TC-024 spec wording updated to match deployed UI ("✓ Route forced to CAD" + "(auto was CAD)" annotation + "Route forced to Crest — verify die cost" warning). See `02_RELEASE_HISTORY.md` D-117 entry. Notes below preserved as historical context.

**Surfaced in:** TC-024.1, 2026-04-25.

**Behavior:** Spec in `TEST_SPOT_TC024_D097_Forced_Route_UI.md` says the panel header should read `"Production Route — Forced: CAD"`. Actual deployed UI shows `"✓ Route forced to CAD"` plus annotation `"(auto was CAD)"` and warning `"Route forced to Crest — verify die cost"` in the Crest case.

**Impact:** Doc-only. Code is correct (panel stays mounted, forced state communicated, Reset to Auto button appears). Just the test spec wording is stale.

**Fix proposal:** Update TC-024 spec to describe actual UI text. Code unchanged.

**Tracking:** D-115, doc-only. Target R1.5.4.

---

## Part 2 — R1.6 Feature: Customer auto-populate from SharePoint

### Architecture sketch

```
SharePoint:                 spot_server.js:               JSX:
customerList.csv      ─────► /customers/refresh    ─────► <input> with autocomplete
(Microsoft Graph)            /customers/search?q=          On select → populate form
                             /customers/:code              fields (custName, address,
                                                           ZIP, terms, etc.)
```

**Storage:** spot_server caches the customer list to `{network_root}/cache/customers.json` after each refresh. Refreshed nightly via cron (or on-demand via `POST /customers/refresh`). The CSV-to-JSON conversion happens server-side.

**Authentication:** spot_server reads SharePoint via Microsoft Graph using a service principal (app registration in Azure AD). Token refresh handled by the standard MSAL Node library.

### Schema confirmed (from M365 read)

The CSV columns I can see from the SharePoint preview:
`cust_code, cust_name, address_1, address_2, address_3, city, state, zip, phone, terms_code, sales_agent_id, sales_tax_code, po_required, oncredithold, credit_limit, ...`

Plus more columns truncated by the preview.

### Open questions for Michael

1. **Full column list past `credit_limit`** — please confirm the rest. Especially anything related to: ship-to default, contact email, customer_type (broker / direct), preferred FOB (Origin / Destination), preferred carrier, custIdent format conventions per customer.
2. **Source of truth for customerList.csv** — what writes it? Manual export from your ERP/accounting system, or pushed by an automation? How often does it change?
3. **Authentication for the Node server** — Azure AD app registration available, or do we provision a new one?
4. **`oncredithold` behavior** — should SPOT block / warn when a held customer is selected? Just visual badge? No effect?
5. **`po_required` behavior** — auto-set a JSON field that flags the quote as PO-required, surfaces in the quote header?

### What goes in the JSX

A new typeahead / autocomplete component on the customer-name field. As the estimator types ≥3 characters, hits `GET /customers/search?q=...` returning top 10 matches. Selecting a match populates: `custName`, `custRef` (optional), `address` block in the quote header, `quoteFOB` if customer has a default, `terms`, optional ship-to ZIP if there's a default-ship-to.

---

## Part 3 — R1.6 Feature: Freight zones routing engine

### Local zones (confirmed from Freight_Rates_Local.xlsx)

| Zone | Rate | Coverage (visual approximation) |
|---|---|---|
| Zone 1 | **$35.00** | Canton + Massillon + immediate area (inner small circle from North Canton) |
| Zone 2 | **$60.00** | Akron, Cuyahoga Falls, Alliance, Minerva, Orrville, Wadsworth-ish (mid ring) |
| Zone 3 | **$85.00** | Cleveland → Mansfield → Youngstown/Niles → Walnut Creek/New Philadelphia (outer polygon) |
| Out of zone | UTS LTL/TL | Existing UTS API integration in spot_server |

Rates last updated 2022-06-06 (raised from $25/$50/$75). Source: Freight_Rates_Local.xlsx Sheet 1, footer note.

### Architecture sketch

```
JSX freight panel:           spot_server.js:                Data:
destZip entered     ─────────► GET /freight/route?    ─────► freight_zones.geojson
                              fromZip=44704&toZip=...        (polygon-in-polygon test)
                              &weight=&pieces=
                              ◄───────────────────────       If in Zone 1/2/3: flat rate
{zone, rate}                                                 If outside: forward to
                                                             UTS API (existing)
```

### Open questions for Michael

1. **Polygon source** — the Freight_Rates_Local.xlsx contains a **Google My Maps screenshot**, not the underlying polygon data. Can you share the My Maps URL (the "42 views" map appears to be already shared)? I need the KML/KMZ export to get exact polygon boundaries. Without it I'd have to approximate with distance-from-Canton, which would misclassify some borderline ZIPs.
2. **Zone 3 → out-of-zone boundary** — anything specific (do you sometimes deliver Zone 3 with the local truck and sometimes go LTL even in Zone 3 for high-weight loads)? Or is it strictly polygon-based?
3. **LTL vs TL crossover threshold** — typical cutoff is around 10,000 lb / 24 pallets. What does SPC use? Weight or pallet count?
4. **Local truck capacity** — does the routing engine ever say "Zone 1 zip but freight too big, push to LTL"? If yes, what's the threshold?
5. **Will-Call** — does Will-Call show as a Zone option (free? $0?) or stay as the existing FOB Origin path?
6. **Stop charges** — Zone rates look like flat-per-stop. Do they scale with stops (1 stop $35, 2 stops $35×2)? Or is it flat per delivery?

### Implementation phases I'd suggest

- **Phase 1** (small): hardcode the 3 zone rates + a simple ZIP-prefix lookup table you provide. Ship the routing endpoint, JSX freight panel auto-populate. Approximate, but immediately useful.
- **Phase 2** (medium): convert My Maps polygons to GeoJSON, do proper point-in-polygon tests using ZIP centroid lookup. Higher accuracy for borderline ZIPs.

---

## Part 4 — R1.6 Feature: Drop-zone Claude RFQ parser

### Architecture sketch

```
JSX drop zone (BL corner):       spot_server.js:                External:
File dropped (PDF/img/email)─────► POST /est/parse-rfq      ────► Anthropic API
                                  (multipart upload)               (model: claude-sonnet)
                                                                   System prompt =
                                                                   bundled EST_* docs
                                  ◄──── parsed JSON returned
                                  + asks list
                                  ◄────────────────────────  
JSX shows asks → estimator                
confirms → __SPOT_LOAD_JSON
                                  Save to network archive:
                                  {root}/quotes/YYYY/
                                  {estNum}_{custname}/
                                    rfq_original.{ext}
                                    intake.json
                                    quote.pdf  (later)
```

### Storage requirement (per Michael's add)

Network folder structure for retrieval — every quote keeps three artifacts together:

```
\\spcoc\SPOT\quotes\
  2026\
    SPC-260425-001_Skybox\
      rfq_original.pdf       ← what came in the door
      intake.json            ← parsed JSON (what SPOT loaded)
      quote.pdf              ← final delivered PDF (added at quote send)
      meta.json              ← {dropzone_ts, parser_model, parse_confidence,
                                 estimator_signoff_ts, sent_to_customer_ts}
    SPC-260425-002_PCA\
      ...
  2027\
    ...
```

This gives full quote traceability: pull any past quote and see the original RFQ, the parsed intake, and the final quote in one folder.

### Open questions for Michael

1. **Anthropic API** — does SPC have an Anthropic API account (separate from your Claude.ai personal account), or do we provision one? Estimated cost per RFQ at current Sonnet rates is **~$0.05–0.20** depending on RFQ size.
2. **Confidentiality** — RFQs may contain customer-confidential pricing. Anthropic's API does not train on API data (this is policy, not tier-dependent). Does SPC need a specific written commitment from Anthropic before this ships? (Some customers do.)
3. **Network root path** — `\\spcoc\SPOT\quotes\` or somewhere specific? Is this a fileshare on the same server as SPOT, or a SharePoint Document Library?
4. **Folder naming** — `{estNum}_{custname}` is my proposal. Alternatives: by date only, by customer only, hybrid. Pick one before I write it.
5. **Retention** — keep forever? Auto-archive after N years? Compliance / legal hold considerations?
6. **Confidence threshold** — if Claude returns parse confidence < threshold, what's the user flow? Show partial parse + asks; let estimator fill in manually; offer "try again with different model"?
7. **Failure mode** — Anthropic API down or returns nonsense — graceful fallback? Show file dropped, save to network folder, mark as "needs manual entry"?
8. **Allowed file types** — PDF, image (PNG/JPG of a printed RFQ), email body (.msg / .eml), Word doc, Excel? My default proposal: PDF + image + .eml. Word/Excel are rare for RFQs in this industry.
9. **Multiple files per RFQ** — sometimes an RFQ comes with multiple attachments (PO + spec sheet + image). Does the dropzone accept multi-file drop? My proposal: yes, all saved to the same archive folder, all sent to Claude in one prompt.

### What CHANGES vs my prior scoping

The key add from your message: **the drop-zone is also a long-term archive.** That means the dropzone path now serves two purposes: (a) RFQ → JSON for current quote, (b) retrieval of past quotes. The retrieval side wants:
- A search/browse UI in SPOT ("Find past quotes for {customer}")
- A way to pull a past intake.json back into SPOT for re-quoting
- A way to compare current quote vs prior quote for the same customer/part (continuity)

This adds complexity. Consider phasing: **Phase 1** = drop zone + parse + save (forward-only). **Phase 2** = retrieval UI.

---

## Part 5 — Diecutter info (HOLD per Michael's instruction)

### What's in die_cutters.xlsx (analyzed only — no design proposed)

Three machines documented in Sheet 1 ("Diecuter Specs"):

| Machine | Min sheet | Max sheet | Min/max thickness | Speed | Notes |
|---|---|---|---|---|---|
| **Heidelberg** (small format) | 4.5 × 6.375" | 21 × 28" | 0.004 / 0.020 | Avg 1M/hr, max 4M/hr | 5/16" gripper. Cut depth .937, score .918. |
| **Bobst Speria 106-E** (large format, **being added**) | 13.78 × 15.75" | 41.75 × 29.125" | 0.004 / 0.060 | Avg 3M/hr, max 7.7M/hr | 23/64-11/16" gripper margin (normal 1/2"). Max diecut 41.75 × 28.5" w/ gripper. Operational rules: scrap-out for ≤5K sheets, stripping set for longer runs, counterplates when skip-feeding, die pushing ≥1,200 needs production approval, pre-tape before diecut, OK for E/F-flute, 2/26/26 restriction note from Matt Keller. Bobst die PDFs at `H:\Bobst die pdfs`. |
| **Zund** (digital, no die) | (no min) | 70 × 98" (Zund 2500), 126 × 125" (Zund 3200) | n/a | n/a | Modules: UCT, EOT, POT, CTT1, CTT2, KCT. Up to 2 modules + 1 router simultaneously. |

### Observations / thinking points (NOT design proposals)

- These three machines are **flat-stock diecutters** (folding carton / small-format work). SPOT's current routes are CAD (corrugated cutter) and Crest (corrugated rotary cutter). Neither is in this xlsx because both handle corrugated.
- The Bobst Speria 106-E being added is a real shop-floor capability change. Open question: is the Bobst becoming a new SPOT route alongside CAD/Crest, or is it for a separate folding-carton workflow that SPOT will need to handle differently (different board grades, different pricing model, NexPress-inherited sheet sizes)?
- "NexPress sheet sizes cannot be run" note in the Bobst row implies an upstream-printer constraint already in play.
- The Zund is digital (no steel die) — could be relevant as a die-free fallback for short runs, but again, not currently a SPOT route.
- All three machines have detailed operational thresholds (sheet size, paper thickness, speed, gripper margin) — same shape as the existing CAD/Crest constraints SPOT already encodes for routing decisions.

### Question for Michael (per "do nothing until we speak")

When we discuss this:
1. Is the Bobst becoming a SPOT route, or does it serve a different workflow that SPOT doesn't price?
2. If a SPOT route — what board grades / liner combinations does it apply to?
3. Pricing model — same `incaRate`-style $/hr × hours, or different (e.g., $/sheet, $/job)?
4. What die-supplier / die-cost workflow does the Bobst require? (D-085 currently triggers on Crest only — would Bobst trigger the same die auto-default?)
5. Where does the Heidelberg fit? It's in the spec sheet, has well-defined operational limits — has it always been there but never wired into SPOT?

---

## Things you owe me to move any of this forward

| # | Owe | Item it unblocks |
|---|---|---|
| 1 | Full column list of `customerList.csv` past `credit_limit` | Customer auto-populate (Part 2) |
| 2 | Customer file refresh source (manual / auto / cadence) | Customer auto-populate |
| 3 | Azure AD app registration for spot_server (or permission to create one) | Customer auto-populate, RFQ archive (if archive is on SharePoint vs fileshare) |
| 4 | Behavior calls on `oncredithold` and `po_required` | Customer auto-populate UX |
| 5 | Google My Maps URL / KML export for freight zones | Freight phase 2 |
| 6 | LTL/TL crossover threshold | Freight |
| 7 | Local truck capacity / spillover rules | Freight |
| 8 | Stop-charge rules (flat / per-stop / per-mile) | Freight |
| 9 | Will-Call zone treatment | Freight |
| 10 | Anthropic API account decision (use existing / provision new) | Drop-zone parser |
| 11 | Confidentiality posture (need contract w/ Anthropic before shipping?) | Drop-zone parser |
| 12 | Network root path for archive (fileshare vs SharePoint) | Drop-zone archive |
| 13 | Folder naming convention | Drop-zone archive |
| 14 | Retention policy | Drop-zone archive |
| 15 | Allowed file types + multi-file support | Drop-zone parser |
| 16 | Confidence threshold + failure-mode UX | Drop-zone parser |
| 17 | Bobst — SPOT route or separate workflow? | Diecutter design |
| 18 | Bobst pricing model | Diecutter design |
| 19 | Heidelberg current SPOT status | Diecutter design |

### What I owe you

- **Restart the chowder** (TC-024.4, TC-024.5, TC-023, TC-025.1) once we're done with this design pass. About 10-15 mins of Chrome work.
- File **D-113, D-114, D-115** as proper open issues in `01_OPEN_ISSUES.md` before R1.6 work starts.
- Once you answer enough questions on any one of Parts 2/3/4/5 above, I can promote that section to a proper **D-### Design Decision** doc and we start building.

---

## Recommended order of attack

1. **D-113 / D-114 / D-115** — close out the bug findings now. ~30 minutes.
2. **Freight phase 1** — most self-contained, fastest to ship. Hardcoded zone table + ZIP lookup. Useful immediately.
3. **Customer auto-populate** — moderate effort, big quality-of-life payoff. Depends on you confirming SharePoint auth path.
4. **Diecutter / Bobst** — discuss before scoping. Could be small (Bobst is a route variant) or large (folding carton workflow).
5. **Drop-zone parser + archive** — biggest impact, biggest scope. Ship after #2 and #3 are in place because the parser will use the customer database for autopopulate-on-parse.

Discussion welcome before any of this gets coded.

---

# SESSION 2026-04-25 — Answers Captured + Scope Corrections

This section appended at end of session to preserve the original design notes verbatim above and capture the answers + scope corrections from the question pass. The original 19-question table is the historical record of what was asked; this section is the historical record of what was answered.

## Status of bug findings (already filed — see `01_OPEN_ISSUES.md`)

D-113, D-114, D-115, D-116 were filed as proper open issues in `01_OPEN_ISSUES.md` 2026-04-25 (target R1.5.4). All four are documented in the 2026-04-25 release-history entry. No further action needed in this file.

## Customer auto-populate — answers

**Q1 (column list):** customerList.csv has exactly **15 columns**, nothing past `credit_limit`. Confirmed against the SharePoint preview. No ship-to ZIP, no contact email, no FOB preference, no preferred carrier, no customer_type — those are NOT in the customer record and will NOT be auto-populated by the autocomplete. Estimator enters per quote.

**Q2 (refresh source):** Daily push from SPC's live ERP. spot_server reads from disk on a nightly cron (suggest 2 AM) + on-demand `POST /customers/refresh` endpoint.

**Q3 (auth path):** Skip SharePoint Graph API entirely. spot_server reads `\\standardprinting.sharepoint.com\spcoc.com\SPOT\customerList.csv` as a mapped network drive. mtime-watch for change detection. No Azure AD, no MSAL, no service principal.

**Q4 (oncredithold + po_required behavior):** Deferred. Pull both flags into the customer record schema; do not wire any UX behavior in v1. Easy to revisit later.

## Freight zones — answers + MAJOR SCOPE CORRECTION

**Scope correction (this is the biggest finding of the session):** The skid + trailer-feet model is **already implemented** in `DEV_spot_engine.js`. The original Part 3 of this backlog was scoped as a net-new build; in reality, most of the model exists. Specifically:

- `SKID_SIZES` (S 40×48 / L 51×72 / WF 60×96) with weights 75/100/200 — matches `WF_Freight_docs.xlsx` "WF Skid Calculator" tab
- `SKID_GRIPPER` (0.5"), `SKID_SIDE_GUIDE` (0.5"), `SKID_MAX_PRODUCT_HEIGHT` (44") — match xlsx
- `TRAILER_FEET` lookup tables for S, L, WF — match xlsx skid-count → trailer-feet table verbatim
- `calcBoardWeight()`, `autoSelectSkid()`, `calcPiecesPerSkidLayer()`, `calcShipment()` — full pipeline already present
- `DEV_spot_server.js` has UTS integration via `utsRateEstimate()`, returns sorted carrier rates, 15% freight markup is SPOT-side per D-060

**What's missing — the only freight work for D-119:**
1. SPC local zone lookup (ZIP → Zone 1/2/3/out-of-zone) returning new rates $45/$70/$95 (post-uplift)
2. SPCOC-vs-UTS routing decision tree wired between `calcShipment()` and the freight panel
3. Wide-format gate — pending Q20

**Q5 (My Maps URL / KML):** None exists. Phase 1 is hardcoded ZIP-prefix table. I'll build the table from the Freight_Rates_Local.xlsx map screenshot when D-119 is promoted to Design Decision; estimator can correct borderline ZIPs at review.

**Rate uplift directive:** Customer rates increase $10 across the board. Effective rates for the new feature: Zone 1 = **$45**, Zone 2 = **$70**, Zone 3 = **$95**. Treat as a P-class planned deviation in fleet comparison (analogous to D-110's +8% sell premium); do not flag as out-of-tolerance.

**Q6 (LTL/TL crossover):** OVERRIDDEN by docs. Verbal answer was "UTS handles it." The freight rates image and skid calculator make clear SPC has its own dispatch rule:
- ≤ 10,000 lb → SPCOC truck (local zone rate from polygon)
- \> 10,000 lb → Truckload via UTS (40,000 lb max per TL)
- \> 40,000 lb → multiple TL

SPOT enforces the 10K-lb gate; UTS handles only the >10K-lb leg.

**Q7 (spillover):** OVERRIDDEN by docs. Verbal answer was "≤ 7 pallets." Real model is per-skid-type capacity:
- SPCOC truck capacity ≈ **24 trailer feet** (= 12 standard 40×48 S skids = 6 L skids = 3 WF skids)
- Use `TRAILER_FEET` lookup with total skid mix to compute trailer feet consumed
- ≤ 24 trailer feet AND ≤ 10,000 lb → SPCOC truck → local zone rate
- Otherwise → UTS path

**Q8 (stop charges):** One ship-to per quote. Multi-stop is dispatch's problem outside the quote. SPOT freight panel always quotes a single delivery.

**Q9 (Will-Call):** FOB Origin → no freight panel, no zone lookup, no freight line. SPC isn't shipping; not SPOT's concern.

**Q20 (NEW — wide-format caveat) — DEFERRED:** The freight rates image footer says *"This is a general guide; This does not necessarily apply to Wide Format materials."* SPC is a wide-format shop, but the dispatch rule for wide-format isn't documented. Options when this gets resolved:
- (a) Same rules — caveat is just legal cover, in practice WF follows the standard 10K-lb / 24-ft gate
- (b) Different weight gate (e.g., higher because WF material is dense)
- (c) Different capacity gate (e.g., always TL above 3 WF skids regardless of weight, because WF skids are oversized)
- (d) Different routing entirely — WF jobs always go UTS regardless of size/weight

D-119 design pass owes a conversation with dispatch about this before shipping the routing logic.

## Drop-zone parser + archive — answers + SCOPE EXPANSION

**Scope expansion:** Drop-zone is now also a **per-quote file vault** (not just an RFQ ingestion path). Architecture extended:

- **All file types accepted** (denylist of executables only — `.exe, .bat, .cmd, .msi, .com, .scr, .ps1`). Multi-file drop OK; all dropped files saved to the same per-quote folder.
- **RFQ-class files** (PDF, image, .eml, .msg, .docx, .xlsx) → parsed by Claude API + archived. Combined parse pass when multiple RFQ files dropped together.
- **Asset-class files** (.ai, .dxf, .eps, .psd, .pdf-art, .zip, .txt, .json, .csv) → archived only. Not for SPOT to load — for the estimator/production to find later.
- **Preview panel** alongside the file list. Click any archived file → preview renders inline. Tier 1 coverage in v1 (PDF.js, native `<img>`, `dxf-viewer`, `ag-psd`, `mammoth.js`, SheetJS, JSZip browse, eml-parser, msgreader, plain text) plus EPS via Ghostscript→PNG conversion server-side. .ard / .cf2 fall back to "Download to view" in v1.
- **`.ai` files (modern, CS2+):** PDF.js renders directly since .ai is internally a PDF. No Illustrator license needed. Edit requires download to local Illustrator.
- **Phasing:** Phase 1 = drop zone + parse + save. Phase 2 = retrieval/browse UI ("Find past quotes for {customer}" + load past intake.json back into SPOT for re-quoting + side-by-side compare current vs prior).

**Q10 (Anthropic API account):** Provision new account at console.anthropic.com using SPC company email + company card. Set monthly budget cap at $500 to start. (Claude.ai subscription is a separate product — does not include API access.)

**Q11 (confidentiality):** Anthropic's default API policy is acceptable. API data is not used for training across all tiers. No special legal review or ZDR addendum required at this stage. Revisit if a customer NDA later requires Zero Data Retention.

**Q12 (archive root path):** `https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/` — **note this is a different SharePoint site** than `customerList.csv`'s location. The `quotes 042526` folder seeded during this session is unused going forward; SPOT will create year folders itself.

**Q13 (folder naming):** `{Customer}_{EstNumber}` — e.g., `Skybox_SPC-260425-001`. Customer first for visual scan when browsing the year folder. SPOT normalizes illegal Windows chars (`/ \ : * ? " < > |`) to `_` and trims customer name to ~30 chars.

**Q14 (retention):** Keep forever. SharePoint storage is cheap; never auto-delete or auto-archive.

**Q15 (allowed file types + multi-file):** Accept everything except executable denylist. Multi-file drop accepted; all files saved to the same per-quote folder; combined parse pass for RFQ-class files.

**Q16 (confidence threshold + failure mode):**
- Low confidence: modal pops up before SPOT loads — *"Parsed 8 fields. 2 fields uncertain — please confirm: [Qty: ___] [Flute: ___]"* — estimator fills, then load proceeds.
- API failure: graceful — toast *"Parser unavailable. Files saved to {folder}; load manually."* Files archive normally; SPOT remains usable without the parser.

## Diecutter / Bobst — answers

**Heidelberg removed from scope (Q19).** SPC sold the Heidelberg. Out of `die_cutters.xlsx`, out of SPOT, out of conversation. Note in design doc as historical reference.

**Q17 (Bobst — SPOT route or separate workflow):** Add Bobst as a third SPOT route alongside CAD and Crest. Route comparison panel extends to (CAD vs Crest vs Bobst) for jobs where multiple routes are viable.

**Bobst gating rules (corrected this session):**
- **Flute = E only** (NOT B — Bobst's 0.060" max thickness can't handle B flute's ~0.125")
- **Sheet size:** ≥ 13.78 × 15.75" AND ≤ 41.75 × 29.125" (max diecut 41.75 × 28.5" w/ gripper)
- **NexPress sheet sizes excluded** (per xlsx note) — needs a `printedOn` field on the JSON or estimator override

**Q18 (Bobst pricing model):** Crest-clone with parameter swaps. Reuses the route-comparison `useMemo`, the D-085 die auto-default trigger, the difficulty-bucket plumbing, and the rule-inches calc. Bobst-specific values:

| Parameter | Bobst | Crest (for contrast) |
|---|---|---|
| Hourly rate | **$350/hr** | $45/hr |
| Setup time | 45 min flat | 45 min std / 90 min adv |
| Run speed | 3,000 sh/hr | 150 sh/hr |
| Default die cost | $1,800 | ~$1,000–1,200 |
| Difficulty buckets | None — flat pricing | Yes |

**Bobst rate derivation:** Cannot be derived from iQuote 785-job fleet — **zero historical SPC E-flute jobs would fit Bobst's 41.75 × 29.125 envelope** (every E-flute job ran on 48×96, 60×120, 63×126, 50×117, or 63×98 sheets — all too big for Bobst). $350/hr is a defensible mid-range placeholder between cost-accounting math ($135–270/hr) and premium positioning ($750/hr considered, rejected as too aggressive). Recalibrate against actual Bobst production data after ~90 days on the floor.

**Caveat for design doc:** Because no historical SPC work fits the Bobst envelope, **utilization is unknown until shop-floor data accumulates**. Bobst may be intended for a new work mix (smaller-format E flute retail/display, or eventually folding-carton work) rather than displacing existing Crest workload. Worth knowing before committing engine work.

---

## Updated D-### candidate list (post-answer)

| D-### | What | Effort vs original |
|---|---|---|
| D-117 | R1.5.4 ledger entry — close D-113/114/115/116 | small (mostly already filed) |
| D-118 | Customer auto-populate — full design + scaffolding | medium (unchanged) |
| **D-119** | **Freight zones — local zone lookup + SPCOC/UTS gate** | **small** (was medium — most of the engine math already exists) |
| D-120 | Drop-zone parser + archive + preview vault | large (unchanged; biggest scope) |
| D-121 | Bobst route addition | small (Crest-clone with parameter swaps) |

## Updated recommended order of attack

1. **D-117** — close D-113/114/115/116 from the chowder findings (fastest)
2. **D-119** — freight zones (smaller than originally thought; engine math already there)
3. **D-118** — customer auto-populate
4. **D-121** — Bobst route addition
5. **D-120** — drop-zone parser + archive + preview vault (last — leans on D-118's customer database)

## What's still open after this session

| Item | Status |
|---|---|
| Q4 — `oncredithold` + `po_required` UX behavior | Deferred to v2 of customer auto-populate |
| Q20 — wide-format freight gate | Deferred to D-119 design pass; conversation with dispatch needed before code |
| Bobst utilization unknown | Resolves with 90 days of shop-floor data; recalibrate then |

## What I owe you next session (clean break)

1. Promote each section to a proper D-### Design Decision doc, in the order above.
2. Restart the chowder if any TCs remain (TC-018 through TC-025 all PASS as of 2026-04-25; nothing left from that batch).
3. Resolve Q20 (wide-format gate) before coding D-119.
