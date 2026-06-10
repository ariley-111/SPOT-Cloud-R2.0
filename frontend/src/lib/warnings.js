/* eslint-disable */
/** Warnings — derive contextual guardrails from quote state + engine result.
 *  Returns array of { id, severity: "info"|"warn"|"err", title, message, actions? }
 *
 *  This consolidates the canonical guardrails Michael's legacy SPOT surfaced
 *  through 40+ inline popups, group-by-context to avoid notification fatigue.
 *  Each item is a one-line "rule + reason" the estimator must see before send.
 */
export function deriveWarnings(state, result) {
  const out = [];
  if (!state) return out;

  // ─── 1. Estimate Info gate ──────────────────────────────────
  if (!state.custName) out.push(W("est-no-cust", "warn", "Customer missing", "Pick a customer before saving."));
  if (!state.estNum) out.push(W("est-no-num", "warn", "Estimate # missing", "Set initials in Toolbar to auto-generate."));
  if (state.estInitialsBlocked) out.push(W("est-spc-blocked", "err", "SPC initials reserved", "SPC is reserved for system-generated estimates only."));
  if (state.poNumber && state.poRequired === false) out.push(W("po-not-required", "info", "PO captured", "Customer does not require a PO — captured for reference."));

  // ─── 2. Dimensions ──────────────────────────────────────────
  const w = Number(state.oneUpW || 0), l = Number(state.oneUpL || 0);
  if (state.oneUpW && state.oneUpL) {
    if (w <= 0 || l <= 0) out.push(W("dim-zero", "err", "Dimensions invalid", "Width and length must be > 0."));
    if (w > 0 && l > 0 && w > l) out.push(W("dim-swap", "info", "W > L", "Width is greater than length — confirm orientation."));
    if (w > 120 || l > 120) out.push(W("dim-oversize", "err", "Exceeds press envelope", "Piece exceeds the maximum supported sheet size (120\")."));
  }

  // ─── 3. Board ───────────────────────────────────────────────
  if (state.boardGrade === "ECT 44") out.push(W("ect-44", "warn", "ECT 44 grade selected", "ECT 44 has the steepest cost curve — verify against Mullen 200# unless customer specified."));
  if (state.boardGrade === "ECT 55") out.push(W("ect-55", "warn", "ECT 55 selected", "ECT 55 is mill-special — confirm stock availability before quoting."));
  if (state.flute === "E" && (state.boardGrade || "").startsWith("ECT") && Number((state.boardGrade || "").replace("ECT ", "")) >= 44) {
    out.push(W("flute-e-ect-heavy", "warn", "E-flute + heavy ECT", "Heavy ECT grades on E-flute are uncommon — confirm spec is intentional."));
  }
  if (state.outsideLiner === "Bleached White" && state.printReq !== "Yes") {
    out.push(W("bleached-no-print", "info", "Bleached White, no print", "Bleached liner adds cost — confirm it's needed without print."));
  }
  // Flute / wall-type sanity (ports legacy gate that hid mismatched grades).
  // Now that doublewall grades are visible, an estimator could pick e.g. "200 DW"
  // while flute is still "B" — that won't price. Warn loudly.
  {
    const isDwGrade = (g) => /\bDW\b/.test(g || "") ||
      ["ECT 42","ECT 48","ECT 51","ECT 61","ECT 71","ECT 82"].includes(g || "");
    const fluteIsDw = state.flute === "B/C";
    const gradeIsDw = isDwGrade(state.boardGrade);
    if (fluteIsDw && state.boardGrade && !gradeIsDw) {
      out.push(W("flute-dw-grade-sw", "err", "B/C flute + singlewall grade",
        `Flute B/C requires a doublewall grade (e.g. 275 DW, ECT 51). Selected grade '${state.boardGrade}' will not price.`));
    }
    if (!fluteIsDw && gradeIsDw) {
      out.push(W("flute-sw-grade-dw", "err", "Singlewall flute + DW grade",
        `Doublewall grade '${state.boardGrade}' requires flute B/C. Change one or the other to price.`));
    }
    if (fluteIsDw && state.flute) {
      out.push(W("flute-bc-info", "info", "B/C doublewall selected",
        "B/C flute is doublewall construction — verify the customer specified doublewall before sending."));
    }
  }

  // ─── 4. Route ───────────────────────────────────────────────
  const route = result?.route || result?._pipeline?.routeAuto;
  if (route === "Crest") {
    out.push(W("crest-approval", "warn", "Crest requires approval (RULE-021)", "Quotes routed through Crest must have rate sheet approval per RULE-021 before sending."));
  }
  if (route === "Bobst") {
    out.push(W("bobst-uncalibrated", "warn", "Bobst rates uncalibrated", "Bobst rates were left uncalibrated by Michael — sense-check totals before sending."));
  }
  if (result?._pipeline?.routeForced) {
    out.push(W("route-forced", "warn", "Route forced", `Auto-route selected ${result._pipeline.routeAuto}; you forced ${result.route}.`));
  }
  if (route === "Saber+DC" && Number(state.qty || 0) > 1000) {
    out.push(W("saber-high-qty", "warn", "Saber+DC at high qty", "Saber+DC is typically reserved for short runs — confirm at this quantity."));
  }

  // ─── 5. Sheet selection ─────────────────────────────────────
  if (result?._pipeline?.corrFlipped) {
    out.push(W("corr-flipped", "info", "Corrugation flipped", "Engine auto-flipped corrugation to find a pricable sheet."));
  }
  if (result?._pipeline?.buyMinActive) {
    out.push(W("buy-min", "warn", "Buy-min triggered", `Below mill minimum — ordering ${result._pipeline.buyMinSheets} sheets to meet min (Rule D-067 bypass for Stock).`));
  }
  // Mill-min + custom order: more explicit warn when the engine had to scale
  // (i.e. customer order is less than the mill's minimum board run).
  if (result?._pipeline?.isMillMinScaled) {
    out.push(W("mill-min-scaled", "warn", "Mill minimum scaled",
      `Order is below the mill minimum (${result._pipeline.minSqFt || 25000} sq ft). ` +
      `Buying ${result._pipeline.minBuySheets || result._pipeline.buyMinSheets || ""} sheets and scaling cost back to the actual order.`));
  }
  // Engine flagged the board as un-pricable even at mill min (no viable run).
  if (result && result.pricable === false && !result?._pipeline?.stockMode) {
    out.push(W("not-pricable", "err", "Board not pricable",
      "Engine could not find a pricable board option — check grade/flute/liner combo and dimensions."));
  }
  if (result?._pipeline?.gradeFallback) {
    out.push(W("grade-fallback", "info", "Grade fallback", `Requested grade fell back to ${result._pipeline.gradeFallback} (Rule 4: ECT→Mullen, transparent to customer).`));
  }
  // Medium fallback — distinguish heavier (meets spec, info) vs lighter (verify, warn).
  // Backend ships either a string or {medium, isHigher} object — handle both.
  if (result?._pipeline?.mediumFallback) {
    const mf = result._pipeline.mediumFallback;
    const isObj = typeof mf === "object" && mf !== null;
    const medName = isObj ? mf.medium : mf;
    const isHigher = isObj ? !!mf.isHigher : null;
    if (isHigher === true) {
      out.push(W("med-fallback-higher", "info", "Medium upgraded",
        `Stock has a heavier medium (${medName}) than requested — meets spec, no risk.`));
    } else if (isHigher === false) {
      out.push(W("med-fallback-lighter", "warn", "Medium downgraded — verify",
        `Stock medium (${medName}) is LIGHTER than what was requested. Confirm acceptable with customer.`));
    } else {
      out.push(W("med-fallback", "info", "Medium fallback", `Medium fell back to ${medName} (closest pool match).`));
    }
  }
  if (result?._pipeline?.mullenUpgrade) {
    out.push(W("mullen-upgrade", "info", "Mullen upgrade", "Grade upgraded to Mullen-equivalent (no ECT match in mill schedule)."));
  }
  if (result?._pipeline?.customOrder) {
    out.push(W("custom-order", "info", "Custom sheet order", "Sheet size is custom-cut (not in approved library)."));
  }
  if (result?._pipeline?.exceedsSheetLibrary) {
    out.push(W("exceeds-lib", "warn", "Exceeds sheet library", "Layout exceeds the approved sheet library — using a special-order sheet."));
  }
  if (result?._pipeline?.stockMode) {
    out.push(W("stock-mode", "info", "Stock sheet", "Using a stock sheet — bypasses Buy Min (D-067)."));
  }

  // ─── 6. Layout efficiency ───────────────────────────────────
  const waste = Number(result?.wastePct || 0);
  if (waste > 0.45) out.push(W("waste-high", "warn", "Waste > 45%", `Layout waste is ${(waste * 100).toFixed(1)}% — consider re-imposing or flipping corr.`));

  // ─── 7. Print ───────────────────────────────────────────────
  if (state.printReq === "Yes" && state.printMode === "Gloss") {
    out.push(W("gloss-default", "info", "Gloss selected", "Default print finish is Satin (Rule 8) — verify customer asked for Gloss."));
  }
  if (state.printReq === "Yes" && Number(state.colorsFront || 0) + Number(state.colorsBack || 0) === 0) {
    out.push(W("print-zero-colors", "err", "Print on, zero colors", "Print is required but no colors are set."));
  }
  if (state.whiteInk === "Yes" && state.outsideLiner === "Bleached White") {
    out.push(W("white-on-bleached", "warn", "White ink on bleached", "White ink on bleached liner is rarely needed — confirm."));
  }
  if (state.printSides === "2-Sided" && route === "Bobst") {
    out.push(W("two-sided-bobst", "warn", "2-sided + Bobst", "2-sided print + Bobst route adds make-ready cost — confirm with PM."));
  }

  // ─── 8. Cutting ─────────────────────────────────────────────
  if (Number(state.totalRuleInches || 0) > 200) {
    out.push(W("rule-inches-high", "warn", "High rule inches", "Total rule inches > 200 — die complexity will impact CAD rate."));
  }
  if (state.cadDifficulty === "Complex" && route === "Bobst") {
    out.push(W("complex-bobst", "info", "Complex on Bobst", "Complex CAD geometry on Bobst — verify die clearance with PM."));
  }
  if (Number(state.perfPct || 0) > 0 && route !== "CAD") {
    out.push(W("perf-non-cad", "warn", "Perforation outside CAD", "Perforations are typically run on CAD — review routing."));
  }

  // ─── 9. Assembly ────────────────────────────────────────────
  if (state.handGluing === "Yes" && state.tape === "Yes") {
    out.push(W("glue-and-tape", "warn", "Glue + Tape", "Both glue and tape are on — confirm this is intentional."));
  }
  if (state.handStripping === "Yes" && route === "Bobst") {
    out.push(W("hand-strip-bobst", "info", "Hand stripping on Bobst", "Bobst auto-strips most jobs — hand stripping is rarely needed."));
  }
  if (state.perimeterStripping === "Yes" && Number(state.qty || 0) > 5000) {
    out.push(W("perim-strip-high", "warn", "Perimeter strip at high qty", "Perimeter stripping adds significant labor — confirm at this volume."));
  }

  // ─── 10. Quantity / pricing ─────────────────────────────────
  const sheetsReq = Number(result?.sheetsReq || 0);
  if (sheetsReq > 0 && sheetsReq < 50) {
    out.push(W("low-sheet-count", "info", "Very low sheet count", "Setup cost dominates at this volume — consider Saber+DC."));
  }
  const gmPct = Number(result?.gmPct || 0);
  if (result && gmPct > 0 && gmPct < 0.25) {
    out.push(W("gm-low", "warn", "GM below 25%", `Gross margin is ${(gmPct * 100).toFixed(1)}% — review pricing tier.`));
  }
  if (result && gmPct > 0.65) {
    out.push(W("gm-high", "info", "GM above 65%", `Gross margin is ${(gmPct * 100).toFixed(1)}% — confirm sell tier is appropriate.`));
  }
  if (result?.forcedPrice) {
    out.push(W("forced-sell", "warn", "Forced sell price", "A sell price was forced — engine GM curve is overridden."));
  }

  // ─── 11. Freight ────────────────────────────────────────────
  if (state.quoteFOB === "Destination" && !state.destZip) {
    out.push(W("dest-no-zip", "err", "FOB Destination without ZIP", "Destination ZIP is required to quote freight."));
  }
  if (state.quoteFOB === "Destination" && Number(state.freightCost || 0) === 0) {
    out.push(W("dest-no-freight", "warn", "FOB Destination, no freight", "Freight is $0 — run Freight Dashboard before sending."));
  }

  // ─── 12. Multi-Part ─────────────────────────────────────────
  if (state.quoteType === "Multi-Part" && (state.bomItems || []).length === 0) {
    out.push(W("mp-empty", "warn", "Multi-Part with no items", "Add items to the BOM before saving."));
  }
  if (state.quoteType === "Multi-Part" && state.pricingMode === "Matched Set" && !state.setMarginOverride) {
    out.push(W("mp-no-set-margin", "info", "Matched Set, aggregating margins", "Set Margin Override is off — using aggregated individual margins."));
  }

  return out;
}

function W(id, severity, title, message) {
  return { id, severity, title, message };
}
