/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import { calculateAll, calculateSlot } from "../api/spot";
import { useDebounce } from "./useDebounce";

/** Hook that re-runs the engine for the active tab whenever inputs change. */
export function useEngine(state) {
  const [results, setResults] = useState([]);   // per-qty results
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Build a stable payload signature so we only recompute when relevant fields change
  const payload = useMemo(() => buildPayload(state), [state]);
  const dbg = useDebounce(payload, 400);

  useEffect(() => {
    if (!dbg) { setResults([]); return; }
    const w = Number(dbg.oneUpW || 0), l = Number(dbg.oneUpL || 0);
    const qtys = (dbg.qtys || []).filter((q) => Number(q) > 0);
    if (w <= 0 || l <= 0 || qtys.length === 0) { setResults([]); setErr(null); return; }

    let cancelled = false;
    setLoading(true);
    calculateAll(dbg)
      .then((data) => {
        if (!cancelled) { setResults(data.results || []); setErr(null); }
      })
      .catch((e) => { if (!cancelled) { setErr(e?.response?.data?.detail || e.message); setResults([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dbg]);

  return { results, loading, err };
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
  };
}
