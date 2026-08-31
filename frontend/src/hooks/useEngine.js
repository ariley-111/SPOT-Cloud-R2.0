/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import { calculateAll, calculateSlot, calculateMultiPart } from "../api/spot";
import { useDebounce } from "./useDebounce";

/** Hook that re-runs the engine for the active tab whenever inputs change.
 *  Routes to Simple (`/engine/calculate-all`) or Multi-Part (`/engine/calculate-multi-part`)
 *  depending on state.quoteType. Multi-Part returns slots[] aggregated to a job
 *  level + perComponent breakdown. */
export function useEngine(state) {
  const [results, setResults] = useState([]);     // per-qty results (or aggregate rows for MP)
  const [perComponent, setPerComponent] = useState([]); // MP only: per-slot per-component
  const [componentPricing, setComponentPricing] = useState([]); // MP only: per-component view with its own qty rows
  const [jobTotals, setJobTotals] = useState(null); // MP only: job-level totals for footer
  const [meta, setMeta] = useState(null);         // MP only: meta block
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const isMP = state?.quoteType === "Multi-Part" && (state?.bomItems || []).length > 0;

  // Multi-Part payload includes bomItems + job-level keys; Simple uses buildPayload.
  const payload = useMemo(() => isMP ? buildMpPayload(state) : buildPayload(state), [state, isMP]);
  const dbg = useDebounce(payload, 400);

  useEffect(() => {
    if (!dbg) { setResults([]); setPerComponent([]); setComponentPricing([]); setJobTotals(null); setMeta(null); return; }

    if (isMP) {
      // Multi-Part path
      const qtys = (dbg.qtys || []).filter((q) => Number(q) > 0);
      const anyComponentHasQty = (dbg.bomItems || []).some((bi) =>
        ((bi.state && bi.state.qtys) || []).some((q) => Number(q) > 0)
      );
      if ((qtys.length === 0 && !anyComponentHasQty) || !(dbg.bomItems || []).length) {
        setResults([]); setPerComponent([]); setComponentPricing([]); setJobTotals(null); setMeta(null); setErr(null); return;
      }
      let cancelled = false;
      setLoading(true);
      calculateMultiPart(dbg)
        .then((data) => {
          if (cancelled) return;
          setResults(data.slots || []);
          setPerComponent((data.slots || []).map((s) => ({ slot: s.slot, items: s.perComponent || [] })));
          setComponentPricing(data.componentPricing || []);
          setJobTotals(data.jobTotals || null);
          setMeta(data.meta || null);
          setErr(null);
        })
        .catch((e) => { if (!cancelled) { setErr(e?.response?.data?.detail || e.message); setResults([]); setPerComponent([]); setComponentPricing([]); setJobTotals(null); } })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    // Simple path (existing behavior)
    const w = Number(dbg.oneUpW || 0), l = Number(dbg.oneUpL || 0);
    const qtys = (dbg.qtys || []).filter((q) => Number(q) > 0);
    if (w <= 0 || l <= 0 || qtys.length === 0) { setResults([]); setPerComponent([]); setComponentPricing([]); setJobTotals(null); setMeta(null); setErr(null); return; }

    let cancelled = false;
    setLoading(true);
    calculateAll(dbg)
      .then((data) => {
        if (!cancelled) { setResults(data.results || []); setPerComponent([]); setComponentPricing([]); setJobTotals(null); setMeta(null); setErr(null); }
      })
      .catch((e) => { if (!cancelled) { setErr(e?.response?.data?.detail || e.message); setResults([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dbg, isMP]);

  return { results, perComponent, componentPricing, jobTotals, meta, loading, err, isMultiPart: isMP };
}

/** Route comparison — runs CAD / Crest / Bobst / Saber+DC for slot 0. */
export function useRouteCompare(state, slotIndex = 0) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const payload = useMemo(() => buildPayload(state), [state]);
  const dbg = useDebounce(payload, 600);

  useEffect(() => {
    if (!dbg) { setRoutes([]); return; }
    const w = Number(dbg.oneUpW || 0), l = Number(dbg.oneUpL || 0);
    if (w <= 0 || l <= 0) { setRoutes([]); return; }
    const candidates = ["CAD", "Crest", "Bobst"];
    let cancelled = false;
    setLoading(true);
    Promise.all(
      candidates.map((r) =>
        calculateSlot({ ...dbg, routeOverride: r }, slotIndex)
          .then((res) => ({ route: r, ...res }))
          .catch((e) => ({ route: r, error: e.message }))
      )
    ).then((rs) => { if (!cancelled) setRoutes(rs); })
     .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dbg, slotIndex]);
  return { routes, loading };
}

export function buildPayload(state) {
  if (!state) return null;
  return {
    oneUpW: state.oneUpW || "0",
    oneUpL: state.oneUpL || "0",
    qtys: (state.qtys || []).map(String),
    flute: state.flute, boardGrade: state.boardGrade,
    outsideLiner: state.outsideLiner, insideLiner: state.insideLiner, medium: state.medium,
    fscEnabled: !!state.fscEnabled,
    printReq: state.printReq, printMode: state.printMode, printSides: state.printSides,
    whiteInk: state.whiteInk,
    colorsFront: state.colorsFront, colorsBack: state.colorsBack,
    routeOverride: state.routeOverride && state.routeOverride !== "Auto" ? state.routeOverride : undefined,
    cadDifficulty: state.cadDifficulty, cadPricingMethod: state.cadPricingMethod,
    cadMethodTouched: !!state.cadMethodTouched,
    totalRuleInches: state.totalRuleInches, perfPct: state.perfPct, productMats: state.productMats,
    saber: state.saber, saberCuts: state.saberCuts, saberBlanksOut: state.saberBlanksOut,
    handStripping: state.handStripping, perimeterStripping: state.perimeterStripping,
    strippingComplexity: state.strippingComplexity,
    handGluing: state.handGluing, jointsPerPiece: state.jointsPerPiece, gluingComplexity: state.gluingComplexity,
    tape: state.tape, tapeType: state.tapeType,
    tapeStrips: state.tapeStrips, tapeStripLength: state.tapeStripLength,
    quoteFOB: state.quoteFOB, freightCost: state.freightCost,
    freightTreatment: state.freightTreatment, freightMarkup: state.freightMarkup,
    freightCarrier: state.freightCarrier,
    cuttingDieCost: state.cuttingDieCost, dieTreatment: state.dieTreatment, dieMarkup: state.dieMarkup,
    prepressCost: state.prepressCost, prepressTreatment: state.prepressTreatment,
    proofTreatment: state.proofTreatment, proofCost: state.proofCost, proofMarkup: state.proofMarkup,
    miscCharges: state.miscCharges, miscChargeMarkup: state.miscChargeMarkup,
    pricingBasis: state.pricingBasis,
    // Pricing Strategy — tier curves + per-qty overrides (legacy parity)
    gmByTier: state.gmByTier || undefined,
    sellByTier: state.sellByTier || undefined,
    freightByQty: state.freightByQty || undefined,
    forcedSellPc: state.forcedSellPc || undefined,
    // D-070 Board Status Bar — substitution decision & Buy Min toggle
    buyMinBoard: state.buyMinBoard || "Auto",
    boardSubstitution: state.boardSubstitution || null,
    // User sheet override (legacy parity — pins route to CAD)
    overrideSheetId: state.overrideSheetId || null,
    // Board Pricing Freeze: pinned version (saved quotes recalc on their frozen
    // rates; drafts/new quotes send null → backend uses the ACTIVE version).
    pricingVersionId: state.pricingVersionId || undefined,
    // Rate Freeze: a saved quote sends its id so the backend applies the rate
    // snapshot pinned at save time. Drafts/new quotes omit it → live admin rates.
    quoteId: state.quoteId || undefined,
  };
}

/** MP-2: Multi-Part payload — top-level job keys + raw bomItems (with their full state).
 *  The backend `/engine/calculate-multi-part` orchestrates per-component pricing using
 *  the per-item state we send here. We also snapshot the CURRENT active item-level
 *  fields into bomItems[activeItemIdx].state so unsaved edits flow through. */
export function buildMpPayload(state) {
  if (!state) return null;
  const items = (state.bomItems || []).slice();
  const activeIdx = state.activeItemIdx ?? 0;
  if (items[activeIdx]) {
    // Mirror current top-level item-level fields into the active item's state so the
    // engine sees the latest UI values without waiting for a tab switch.
    items[activeIdx] = {
      ...items[activeIdx],
      state: {
        ...(items[activeIdx].state || {}),
        // Item-level keys — must stay in sync with /app/frontend/src/lib/mpSchema.js
        itemDesc: state.itemDesc, boxStyle: state.boxStyle, custIdent: state.custIdent,
        quoteMode: state.quoteMode, oneUpW: state.oneUpW, oneUpL: state.oneUpL,
        sheetSizeW: state.sheetSizeW, sheetSizeL: state.sheetSizeL, sheetPcsPerSheet: state.sheetPcsPerSheet,
        corrFlipped: state.corrFlipped, overrideSheetId: state.overrideSheetId,
        qtys: state.qtys, selSlot: state.selSlot,
        flute: state.flute, boardGrade: state.boardGrade,
        outsideLiner: state.outsideLiner, insideLiner: state.insideLiner, medium: state.medium,
        fscEnabled: state.fscEnabled, fscFee: state.fscFee,
        buyMinBoard: state.buyMinBoard, boardSubstitution: state.boardSubstitution,
        printReq: state.printReq, printMode: state.printMode, printSides: state.printSides,
        whiteInk: state.whiteInk, colorsFront: state.colorsFront, colorsBack: state.colorsBack,
        routeOverride: state.routeOverride,
        cadDifficulty: state.cadDifficulty, cadPricingMethod: state.cadPricingMethod,
        cadMethodTouched: !!state.cadMethodTouched,
        totalRuleInches: state.totalRuleInches,
        perfPct: state.perfPct, productMats: state.productMats,
        saber: state.saber, saberCuts: state.saberCuts, saberBlanksOut: state.saberBlanksOut,
        handStripping: state.handStripping, perimeterStripping: state.perimeterStripping,
        strippingComplexity: state.strippingComplexity,
        handGluing: state.handGluing, jointsPerPiece: state.jointsPerPiece, gluingComplexity: state.gluingComplexity,
        tape: state.tape, tapeType: state.tapeType,
        tapeStrips: state.tapeStrips, tapeStripLength: state.tapeStripLength,
        prepressTreatment: state.prepressTreatment, prepressCost: state.prepressCost,
        proofTreatment: state.proofTreatment, proofCost: state.proofCost, proofMarkup: state.proofMarkup,
        dieTreatment: state.dieTreatment, cuttingDieCost: state.cuttingDieCost,
        dieAmortMethod: state.dieAmortMethod,
        miscCharges: state.miscCharges,
        freightType: state.freightType, freightTreatment: state.freightTreatment,
        freightCost: state.freightCost, freightMarkup: state.freightMarkup,
        freightCarrier: state.freightCarrier,
        freightByQty: state.freightByQty,
        forcedSellPc: state.forcedSellPc,
        gmByTier: state.gmByTier, sellByTier: state.sellByTier,
        pricingBasis: state.pricingBasis, miscChargeMarkup: state.miscChargeMarkup,
      },
    };
  }
  // ── Matched Set qty normalization (BUG-2026-02: Cost-Buildup Quote Total
  // changed per active component). In Matched Set mode, top-level state.qtys
  // holds the ACTIVE component's PRE-MULTIPLIED item qty (pcsPerSet × set qty),
  // per legacy commit semantics (spot_r1_5.jsx L2074). The backend engine's
  // Matched Set path treats payload.qtys as the SET qty and multiplies each
  // component's pcsPerSet against it. So sending state.qtys as-is causes the
  // Shelf tab (pcsPerSet=3, state.qtys=['6']) to be interpreted as 6 SETS,
  // producing 3× kit totals on tab switches. Fix: divide by ACTIVE component's
  // pcsPerSet before sending, so the engine always sees the raw SET qty
  // regardless of which tab is active. Individual mode uses top-level qtys as
  // the fall-back for blank per-item slots, so we leave it unchanged there.
  const pricingMode = state.pricingMode || "Matched Set";
  const activePcs = Math.max(1, Number((items[activeIdx] || {}).pcsPerSet) || 1);
  const rawQtys = (state.qtys || []).map(String);
  const setQtys = (state.quoteType === "Multi-Part" && pricingMode === "Matched Set")
    ? rawQtys.map((q) => {
        const n = Number(q);
        if (!Number.isFinite(n) || n <= 0) return "";
        return String(Math.round(n / activePcs));
      })
    : rawQtys;

  return {
    quoteType: state.quoteType,
    pricingMode: pricingMode,
    setMarginPct: state.setMarginPct || "0.40",
    setMarginOverride: !!state.setMarginOverride,
    fulfillmentMarginPct: state.fulfillmentMarginPct || "0.45",
    purchasedMarginPct: state.purchasedMarginPct || "0.40",
    qtys: setQtys,
    activeItemIdx: activeIdx,
    // When freight is being allocated at the job level (Local Delivery, Per-Job UTS, etc.)
    // we MUST zero out each component's per-item freightCost — otherwise the engine
    // computes BOTH per-component freight AND the job-level allocation, double-billing.
    // (Reported: Zone 1 $35 → $191 on 3-component MP RFQ.)
    bomItems: state.freightScope === "Per Job"
      ? items.map((it) => ({
          ...it,
          state: { ...(it.state || {}), freightCost: "0", freightTreatment: "None" },
        }))
      : items,
    // Job-level overlays
    estInitials: state.estInitials,
    custName: state.custName, custCode: state.custCode, custRef: state.custRef,
    destZip: state.destZip, quoteFOB: state.quoteFOB,
    // Job-level freight / prepress
    freightScope: state.freightScope, freightAllocMethod: state.freightAllocMethod,
    jobFreightCost: state.jobFreightCost, jobFreightTreatment: state.jobFreightTreatment,
    // Per-slot job freight: each set-qty tier ships a different combined load,
    // so its UTS-quoted job freight differs. jobFreightBySlot maps {slotIdx:
    // rawCost}; the backend applies the matching value to each Quote Table tier,
    // PDF column and aggregate (was previously flat jobFreightCost for all tiers).
    jobFreightBySlot: state.jobFreightBySlot || {},
    // BUG-2026-02: Job-level freightMarkup MUST be on the payload so the
    // backend allocator uses the correct rate (0 for Local Delivery, 0.15 for
    // Ship). Without this the backend defaulted to 0.15, double-billing
    // LocalDelivery quotes by 15% and creating a 3-way mismatch between
    // Quote Table rows, footer and One-Time line item.
    freightMarkup: state.freightMarkup,
    // Resolved carrier — engine zeroes the markup for local delivery (our truck).
    freightCarrier: state.freightCarrier,
    prepressScope: state.prepressScope, prepressAllocMethod: state.prepressAllocMethod,
    jobPrepressCost: state.jobPrepressCost, jobPrepressTreatment: state.jobPrepressTreatment,
    // Board Pricing Freeze: pinned version for the whole matched set.
    pricingVersionId: state.pricingVersionId || undefined,
    // Rate Freeze: saved quote id → backend applies its pinned rate snapshot.
    quoteId: state.quoteId || undefined,
  };
}
