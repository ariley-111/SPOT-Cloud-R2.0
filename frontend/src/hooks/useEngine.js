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
  const [meta, setMeta] = useState(null);         // MP only: meta block
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const isMP = state?.quoteType === "Multi-Part" && (state?.bomItems || []).length > 0;

  // Multi-Part payload includes bomItems + job-level keys; Simple uses buildPayload.
  const payload = useMemo(() => isMP ? buildMpPayload(state) : buildPayload(state), [state, isMP]);
  const dbg = useDebounce(payload, 400);

  useEffect(() => {
    if (!dbg) { setResults([]); setPerComponent([]); setMeta(null); return; }

    if (isMP) {
      // Multi-Part path
      const qtys = (dbg.qtys || []).filter((q) => Number(q) > 0);
      if (qtys.length === 0 || !(dbg.bomItems || []).length) {
        setResults([]); setPerComponent([]); setMeta(null); setErr(null); return;
      }
      let cancelled = false;
      setLoading(true);
      calculateMultiPart(dbg)
        .then((data) => {
          if (cancelled) return;
          setResults(data.slots || []);
          setPerComponent((data.slots || []).map((s) => ({ slot: s.slot, items: s.perComponent || [] })));
          setMeta(data.meta || null);
          setErr(null);
        })
        .catch((e) => { if (!cancelled) { setErr(e?.response?.data?.detail || e.message); setResults([]); setPerComponent([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    // Simple path (existing behavior)
    const w = Number(dbg.oneUpW || 0), l = Number(dbg.oneUpL || 0);
    const qtys = (dbg.qtys || []).filter((q) => Number(q) > 0);
    if (w <= 0 || l <= 0 || qtys.length === 0) { setResults([]); setPerComponent([]); setMeta(null); setErr(null); return; }

    let cancelled = false;
    setLoading(true);
    calculateAll(dbg)
      .then((data) => {
        if (!cancelled) { setResults(data.results || []); setPerComponent([]); setMeta(null); setErr(null); }
      })
      .catch((e) => { if (!cancelled) { setErr(e?.response?.data?.detail || e.message); setResults([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dbg, isMP]);

  return { results, perComponent, meta, loading, err, isMultiPart: isMP };
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
    cadDifficulty: state.cadDifficulty, crestComplexity: state.crestComplexity,
    totalRuleInches: state.totalRuleInches, perfPct: state.perfPct, productMats: state.productMats,
    saber: state.saber, saberCuts: state.saberCuts, saberBlanksOut: state.saberBlanksOut,
    handStripping: state.handStripping, perimeterStripping: state.perimeterStripping,
    strippingComplexity: state.strippingComplexity,
    handGluing: state.handGluing, jointsPerPiece: state.jointsPerPiece, gluingComplexity: state.gluingComplexity,
    tape: state.tape, tapeType: state.tapeType,
    quoteFOB: state.quoteFOB, freightCost: state.freightCost,
    freightTreatment: state.freightTreatment, freightMarkup: state.freightMarkup,
    cuttingDieCost: state.cuttingDieCost, dieTreatment: state.dieTreatment, dieMarkup: state.dieMarkup,
    prepressCost: state.prepressCost, prepressTreatment: state.prepressTreatment,
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
        crestComplexity: state.crestComplexity, totalRuleInches: state.totalRuleInches,
        perfPct: state.perfPct, productMats: state.productMats,
        saber: state.saber, saberCuts: state.saberCuts, saberBlanksOut: state.saberBlanksOut,
        handStripping: state.handStripping, perimeterStripping: state.perimeterStripping,
        strippingComplexity: state.strippingComplexity,
        handGluing: state.handGluing, jointsPerPiece: state.jointsPerPiece, gluingComplexity: state.gluingComplexity,
        tape: state.tape, tapeType: state.tapeType,
        prepressTreatment: state.prepressTreatment, prepressCost: state.prepressCost,
        dieTreatment: state.dieTreatment, cuttingDieCost: state.cuttingDieCost,
        dieAmortMethod: state.dieAmortMethod,
        miscCharges: state.miscCharges,
        freightType: state.freightType, freightTreatment: state.freightTreatment,
        freightCost: state.freightCost, freightMarkup: state.freightMarkup,
        freightByQty: state.freightByQty,
        forcedSellPc: state.forcedSellPc,
        gmByTier: state.gmByTier, pricingBasis: state.pricingBasis,
      },
    };
  }
  return {
    quoteType: state.quoteType,
    pricingMode: state.pricingMode || "Matched Set",
    setMarginPct: state.setMarginPct || "0.40",
    setMarginOverride: !!state.setMarginOverride,
    fulfillmentMarginPct: state.fulfillmentMarginPct || "0.45",
    purchasedMarginPct: state.purchasedMarginPct || "0.40",
    qtys: (state.qtys || []).map(String),
    activeItemIdx: activeIdx,
    bomItems: items,
    // Job-level overlays
    estInitials: state.estInitials,
    custName: state.custName, custCode: state.custCode, custRef: state.custRef,
    destZip: state.destZip, quoteFOB: state.quoteFOB,
    // Job-level freight / prepress
    freightScope: state.freightScope, freightAllocMethod: state.freightAllocMethod,
    jobFreightCost: state.jobFreightCost, jobFreightTreatment: state.jobFreightTreatment,
    prepressScope: state.prepressScope, prepressAllocMethod: state.prepressAllocMethod,
    jobPrepressCost: state.jobPrepressCost, jobPrepressTreatment: state.jobPrepressTreatment,
  };
}
