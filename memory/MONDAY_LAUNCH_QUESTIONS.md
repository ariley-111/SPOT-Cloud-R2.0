# SPOT — Monday Testing Launch Meeting: Open Questions / Discussion Items

> Created during cloud port. Items below need product/estimator team decisions
> before they can be implemented (or scrapped) in the cloud build.

---

## 1. Print Coverage — does legacy actually use it?

**Finding from code audit:** The legacy `spot_r1_5.jsx` (and `spot_engine.js`) contain **zero references** to `printCoverage`, `coverage`, `inkCoverage`, or `inkArea` — the legacy pricing engine does NOT consume an explicit print-coverage value. Ink cost is driven by `printMode` (Process / Spot), `printSides` (1 / 2), `whiteInk`, and `whiteMR/regMR` makeready, not by a numeric coverage percent.

**However**, some CADs/specs/emails the RFQ parser ingests DO carry an explicit "coverage %" line (e.g. "60% coverage one side, 100% coverage other side"). If the cloud parser is being trained to extract this number, we need:

   - **Decision needed:** Should the cloud add a "Print Coverage %" input/display field in the estimator UI? Legacy has no such field today.
   - If yes — does the estimator confirm/edit the parser's extracted value before quoting?
   - If yes — does coverage feed into pricing (new ink-cost logic)? Or is it purely an informational/note field that gets surfaced on the PDF?
   - If no — should the parser strip coverage data instead of presenting it as a parsed field?

---

## 2. Die auto-add when Crest/Bobst is VIABLE but not selected

**Finding from code audit:** Legacy line 3866-3883 fires the die auto-add (`setDieTreat("Separate Line"); setDieCost(default)`) only when `anyDieRoute = activeRows.some(r => r.routing.route === "Crest" || "Bobst")` — i.e. when the SELECTED route is Crest or Bobst. It does NOT fire when those routes are merely viable in Route Comparison while CAD wins.

   - **Decision needed:** Is this the desired behavior, or do we want the cloud to add the die line as soon as Crest/Bobst is *viable* (even if CAD ends up winning)? Today the cloud matches legacy exactly.
   - Recommendation: leave as-is unless estimators report this is missing — adding a die cost when CAD wins would be misleading on the customer quote.

---

## 3. Per-component validation badges (Multi-Part)

   - **Decision needed:** What should validation look like? Options:
       (a) Amber badge on the component tab when missing print/dims/grade/liner/qty
       (b) Red badge when an unaccepted substitution is present
       (c) Block PDF export when red badges exist
       (d) Some combo
   - We need to define *when* validation runs (live? on Save? on PDF export?) and *how loud* it is — we don't want the UI to feel busy/noisy for estimators rapid-quoting.

---

## 4. Cover Letter note field

   - Legacy has a Cover Letter / Notes block. Should the cloud's "Estimate Info → Notes" feed the cover letter on the PDF? Or do we need a separate "Cover Letter" field?

---

## 5. Valid Until vs 90-day PDF footer mismatch (Tuesday parking lot)

   - PDF footer currently always says "90 days" but `quoteExpDays` is configurable. Should the footer dynamically use `quoteExpDays` or stay at 90?

---

## 6. Buy-Min: amortize vs full charge (Tuesday parking lot)

   - When `buyMinBoard=Yes` (custom order at mill minimum), should the FULL mill-min cost hit the quote, or should it be amortized over the order qty using a "shippedMSF / mfgMSF" ratio? Legacy currently scales (amortizes). Estimators wanted clarification.

---

## 7. Customer Sync via Ignition API (NEW)

   - Standard Printing is moving customer master data into Ignition with an HTTPS API endpoint.
   - **Decision needed:** Endpoint URL, auth (API key vs OAuth), payload schema, refresh cadence (live lookup on Customer dropdown vs nightly sync into Mongo)?
   - Recommendation from cloud team: nightly sync to Mongo for performance + autocomplete UX; on-demand re-fetch via "Refresh from Ignition" button in Admin Console.

---

## 8. Sample Shipments via FedEx / UPS API (NEW)

   - Freight modal redesign: for sample shipments and small jobs, estimators want FedEx/UPS rate quotes alongside LTL carriers and Local Delivery.
   - **Decision needed:** account numbers, API credentials, service levels to expose (Ground / 2-Day / Priority Overnight)? Same Q for UPS.

---

## 9. Entra SSO (Phase 5)

   - Tenant ID, App registration ID, redirect URI, allowed groups for Admin role?

---

## 10. SharePoint PDF Archive (low-priority backlog)

   - Site URL + folder path for archived quote PDFs.
   - Naming convention (`EST-12345_v1_2026-02-10.pdf`?).
   - Retention policy.

---

## 11. Quote Table column detail (in-progress for today)

   - Legacy quote table shows per-qty rows: `ACT | QTY | SELL/EA | GM% | GM$ | TOTAL | $/MSF | COST/MSF | FREIGHT | SHEET | #OUT | ROUTE (with CAD hrs)`.
   - Cloud currently misses Freight $ value, $/MSF, COST/MSF, SHEET dimensions, #OUT, and CAD hrs in the Route cell.
   - This is being fixed in today's batch (P0 UI). No estimator decision needed unless additional columns are wanted.

---

_Owner: rwalter@standardprinting.com — living document, appended throughout dev sessions._
