/* eslint-disable */
import React, { useState, useEffect } from "react";
import { useQuote } from "../../context/QuoteContext";
import { useEngine } from "../../hooks/useEngine";
import { freightQuote, freightQuoteBatch, compareRoutes } from "../../api/spot";
import Tile from "./Tile";
import { fmtMoney, fmtInt, fmtPct, fmtNum, fmtDim } from "../../lib/format";
import ProgressModal from "./ProgressModal";
import { calcShipment } from "../../lib/shipment";
import { allocateJobCost, detectFreightMinimum, isLocalCarrier } from "../../lib/freight";
import FreightDashModal from "./FreightDashModal";
import CrestApprovalModal from "./CrestApprovalModal";

export default function RightDashboard({ width }) {
  const { active, setField, pushToast } = useQuote();
  const s = active?.state || {};
  const { results, perComponent, componentPricing, isMultiPart } = useEngine(s);
  const selSlot = s.selSlot || 0;
  const activeItemIdx = s.activeItemIdx ?? 0;
  const aggregate = results[selSlot] || results[0];
  // In Multi-Part mode the right rail must show the ACTIVE component's row
  // (sheet, board, cost buildup, economics) — not the aggregated job row,
  // which only carries job-level totals (no sheetW/boardTotal/matTotal).
  // Matches the same branching SpotApp does for the main column.
  const itemResult = isMultiPart
    ? ((perComponent.find((p) => p.slot === selSlot) || perComponent[0])?.items?.[activeItemIdx] || null)
    : null;
  // Merge the active component's per-qty-row line-charges (from componentPricing)
  // onto the per-component result so r.freightLine reflects the Per-Job
  // allocated SHARE (not 0, which is what run_estimate returns when freightCost
  // was zeroed by buildMpPayload's Per-Job branch). Same for die/prepress/misc.
  const itemResultWithLines = (() => {
    if (!isMultiPart || !itemResult) return itemResult;
    const cp = (componentPricing || [])[activeItemIdx];
    if (!cp) return itemResult;
    const row = (cp.rows || []).find((rw) => rw.slotIdx === selSlot) || (cp.rows || [])[0];
    if (!row) return itemResult;
    return {
      ...itemResult,
      freightLine: row.freightLine || itemResult.freightLine || 0,
      freightEmbed: row.freightEmbed || itemResult.freightEmbed || 0,
      dieLineCost: row.dieLineCost || itemResult.dieLineCost || 0,
      prepressLineCost: row.prepressLineCost || itemResult.prepressLineCost || 0,
      proofLineCost: row.proofLineCost || itemResult.proofLineCost || 0,
      miscLineCost: row.miscLineCost || itemResult.miscLineCost || 0,
      sellTotal: row.sellTotal || itemResult.sellTotal || 0,
      miscLineItems: row.miscLineItems || itemResult.miscLineItems || [],
    };
  })();
  const primary = isMultiPart ? (itemResultWithLines || aggregate) : aggregate;

  // ── Crest Approval popup (legacy parity) — once per component per quote-open ──
  // Fires when the active component routes to Crest AND its die exceeds 1,000
  // rule-inches/sheet (engine routeWarning). Tracked per component so it only
  // shows for the applicable component(s), one time each.
  const quoteKey = active?.id || active?.estNum || "q";
  const compKey = `${quoteKey}:${isMultiPart ? activeItemIdx : 0}`;
  const crestWarning = (primary?.route === "Crest"
    && typeof primary?.routeWarning === "string"
    && primary.routeWarning.includes("needs approval"))
    ? primary.routeWarning : null;
  const [crestAcked, setCrestAcked] = useState(() => new Set());
  // Reset acknowledgements when the open quote changes (re-opening re-pops).
  useEffect(() => { setCrestAcked(new Set()); }, [quoteKey]);
  const showCrestApproval = !!crestWarning && !crestAcked.has(compKey);
  const ackCrest = () => setCrestAcked((cur) => new Set(cur).add(compKey));
  const activeCompName = isMultiPart
    ? (active?.state?.bomItems?.[activeItemIdx]?.desc || `Component ${activeItemIdx + 1}`)
    : (active?.state?.itemDesc || null);
  const forceCadFromApproval = () => {
    setField("routeOverride", "CAD");
    ackCrest();
    pushToast && pushToast("Route forced to CAD — Crest die avoided", "ok");
  };

  return (
    <div data-testid="right-dashboard" style={{
      width: width || 360, flexShrink: 0, overflow: "auto",
      background: "var(--spot-bg2)", borderLeft: "1px solid var(--spot-line)",
      display: "flex", flexDirection: "column",
      paddingBottom: 80,  // keep last row clear of the "Made with Emergent" badge
    }}>
      <CrestApprovalModal
        open={showCrestApproval}
        message={crestWarning}
        componentName={activeCompName}
        onAcknowledge={ackCrest}
        onForceCad={forceCadFromApproval}
      />
      <Collapsible id="freight" title="🚚 Freight">
        <FreightPanel s={s} />
      </Collapsible>
      <Collapsible id="route" title="🛣 Route Comparison">
        <RouteComparison s={s} primary={primary} />
      </Collapsible>
      <Collapsible id="economics" title="📊 Economics">
        <EconomicsPanel s={s} result={primary} aggregate={aggregate} isMultiPart={isMultiPart} activeItemIdx={activeItemIdx} />
      </Collapsible>
      <Collapsible id="costbuildup" title="🧮 Cost Buildup">
        <CostBuildup result={primary} isMultiPart={isMultiPart} aggregate={aggregate} s={s} />
      </Collapsible>
      <Collapsible id="board" title="📦 Board">
        <BoardPanel result={primary} s={s} />
      </Collapsible>
    </div>
  );
}

// ─── Collapsible wrapper for right-side panels ────────────────────────
// Each panel already has its own internal header — when expanded, the
// wrapper is invisible. When collapsed, we render a thin stub bar with a
// chevron in place of the full panel. State is persisted per-panel-id in
// localStorage so users get a consistent layout across reloads.
function Collapsible({ id, title, children }) {
  const lsKey = `spot_panel_collapsed_${id}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(lsKey) === "1";
  });
  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(lsKey, next ? "1" : "0"); } catch {}
      return next;
    });
  };
  if (collapsed) {
    return (
      <button data-testid={`panel-collapsed-${id}`} onClick={toggle}
        style={{
          all: "unset", cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--spot-line)",
          background: "var(--spot-bg2)",
          fontSize: 12, fontWeight: 700, color: "var(--spot-text2)",
          textTransform: "uppercase", letterSpacing: ".06em",
        }}>
        <span>{title}</span>
        <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>▶</span>
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }} data-testid={`panel-expanded-${id}`}>
      {/* Tiny collapse handle in the top-right corner of the expanded panel */}
      <button onClick={toggle}
        data-testid={`panel-collapse-btn-${id}`}
        title="Collapse"
        style={{
          all: "unset", cursor: "pointer",
          position: "absolute", top: 8, right: 10, zIndex: 5,
          fontSize: 11, color: "var(--spot-text3)",
          padding: "2px 6px", borderRadius: 3,
          background: "var(--spot-bg3)55",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--spot-line)"; e.currentTarget.style.color = "var(--spot-text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--spot-bg3)55"; e.currentTarget.style.color = "var(--spot-text3)"; }}>
        ▼
      </button>
      {children}
    </div>
  );
}

function FreightPanel({ s }) {
  const { setField, setManyFields, pushToast, active } = useQuote();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dashOpen, setDashOpen] = useState(false);

  // Build per-component construction spec (used in calcShipment). For the
  // active item we read live state (s.*); for the others we read each
  // bomItem.state. Matches legacy updateAllFreight L4326-4328 selection.
  const activeIdx = s.activeItemIdx ?? 0;
  // Tab-INDEPENDENT unified SET qtys for Matched Set. `s.qtys` only mirrors the
  // ACTIVE BOM tab, so a tier added on one component (e.g. a 300 added on
  // "Header") then switching to another tab ("Display Base") would make the
  // new tier invisible to the freight dashboard. We instead take the qty array
  // with the MOST populated tiers across the active mirror AND every
  // component's stored state, so every set-qty tier is always discovered.
  // Returns parsed ints (null for empty slots), or null when not applicable
  // (single-part or Individual mode — each component keeps its own qtys).
  const _countTiers = (arr) => (arr || []).filter((q) => {
    const n = parseInt(q, 10); return Number.isFinite(n) && n > 0;
  }).length;
  const getSetQtys = () => {
    const items = Array.isArray(s.bomItems) && s.bomItems.length > 0 ? s.bomItems : null;
    if (!items) return null;
    const isMatched = (s.pricingMode || "Matched Set") !== "Individual";
    if (!isMatched) return null;
    let best = s.qtys || [];
    let bestN = _countTiers(best);
    items.forEach((it, i) => {
      const arr = (i === activeIdx) ? (s.qtys || []) : ((it.state || {}).qtys || []);
      const n = _countTiers(arr);
      if (n > bestN) { bestN = n; best = arr; }
    });
    return best.map((q) => { const n = parseInt(q, 10); return Number.isFinite(n) && n > 0 ? n : null; });
  };
  const buildItems = () => {
    const items = Array.isArray(s.bomItems) && s.bomItems.length > 0 ? s.bomItems : null;
    if (!items) {
      return [{
        boardGrade: s.boardGrade, flute: s.flute,
        outsideLiner: s.outsideLiner || "None",
        insideLiner: s.insideLiner || "None",
        medium: s.medium || "None",
        oneUpW: parseFloat(s.oneUpW || 0),
        oneUpL: parseFloat(s.oneUpL || 0),
        qtys: s.qtys || [],
      }];
    }
    // Matched Set is the MP default; Individual is the explicit opt-in.
    const isMatched = (s.pricingMode || "Matched Set") !== "Individual";
    const setQtys = getSetQtys(); // null in Individual / single-part
    return items.map((it, i) => {
      const st = (i === activeIdx)
        ? { boardGrade: s.boardGrade, flute: s.flute,
            outsideLiner: s.outsideLiner, insideLiner: s.insideLiner, medium: s.medium,
            oneUpW: s.oneUpW, oneUpL: s.oneUpL, qtys: s.qtys }
        : (it.state || {});
      // Matched Set: every component is produced at the SAME set quantities
      // (× pcsPerSet), so broadcast the tab-independent unified set qtys to ALL
      // components — this matches the pricing engine (which uses top_qtys for
      // matched-set) and fixes the bug where non-active components dropped tiers
      // the active item had (e.g. a 300 tier quoting only the active component).
      // Individual mode keeps each component's own qtys.
      const pcs = parseInt(it.pcsPerSet ?? st.pcsPerSet ?? 1, 10) || 1;
      const itemQtys = (isMatched && setQtys)
        ? setQtys.map((n) => (n != null && n > 0 ? String(n * pcs) : ""))
        : (st.qtys || []);
      return {
        boardGrade: st.boardGrade,
        flute: st.flute,
        outsideLiner: st.outsideLiner || "None",
        insideLiner: st.insideLiner || "None",
        medium: st.medium || "None",
        oneUpW: parseFloat(st.oneUpW || 0),
        oneUpL: parseFloat(st.oneUpL || 0),
        qtys: itemQtys,
      };
    });
  };

  // Per-item shipment using legacy calcShipment(...) verbatim. Returns array
  // aligned to bomItems (or single entry for Simple). Each entry has the same
  // shape as legacy calcShipment output.
  const _parseQty = (q) => { const n = parseInt(q, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const shipmentForQtySlot = (slotIndex) => {
    const items = buildItems();
    return items.map((it) => {
      const qty = _parseQty((it.qtys || [])[slotIndex]) || _parseQty((it.qtys || [])[0]);
      const uw = it.oneUpW, ul = it.oneUpL;
      if (qty <= 0 || uw <= 0 || ul <= 0) {
        return { totalWeight: 0, skidCount: 0, trailerFeet: 0, productWeight: 0 };
      }
      // oMSF approximation when engine shippedMSF not available in this scope.
      const oMSF = (uw * ul * qty) / 144 / 1000;
      return calcShipment(
        it.boardGrade, it.flute, it.outsideLiner, it.insideLiner, it.medium,
        oMSF, uw, ul, qty
      );
    });
  };

  // Per-item shipment at each component's OWN first-non-zero qty.
  const shipmentForOwnQtys = () => {
    const items = buildItems();
    return items.map((it) => {
      let qty = 0;
      const qtys = it.qtys || [];
      for (let i = 0; i < qtys.length; i++) {
        const v = _parseQty(qtys[i]);
        if (v > 0) { qty = v; break; }
      }
      const uw = it.oneUpW, ul = it.oneUpL;
      if (qty <= 0 || uw <= 0 || ul <= 0) {
        return { totalWeight: 0, skidCount: 0, trailerFeet: 0, productWeight: 0, qty: 0 };
      }
      const oMSF = (uw * ul * qty) / 144 / 1000;
      return { ...calcShipment(
        it.boardGrade, it.flute, it.outsideLiner, it.insideLiner, it.medium,
        oMSF, uw, ul, qty
      ), qty };
    });
  };

  // Aggregate weight for the Update-All header/summary. Sums each component's
  // own-qty calcShipment totalWeight + skidCount (legacy: combined LTL load).
  const shipmentEst = (() => {
    const per = shipmentForOwnQtys();
    const lbs = per.reduce((a, p) => a + (p.totalWeight || 0), 0);
    const skids = per.reduce((a, p) => a + (p.skidCount || 0), 0);
    return { lbs: Math.max(100, Math.round(lbs)), skids };
  })();
  const estimatedWeight = shipmentEst.lbs;

  // Builds the Per-Job scenario matrix used by both updateFreight and the
  // Freight Dashboard. Returns { perItemRows, perJobScenarios }.
  //  - perItemRows[i] = array of { slot, qty, ship: calcShipment() }  for each
  //    qty in component i's qtys[].
  //  - perJobScenarios[k] = {
  //       scenarioIdx,
  //       perComp: [{ idx, slot, qty, ship }],
  //       combinedWeight, combinedSkids, combinedFt
  //    }
  //    max_slots = max(component.qtys.length). In scenario k, each component
  //    contributes its qty at min(k, qtys.length - 1) — single-qty components
  //    repeat their qty across all scenarios; multi-qty components advance.
  // NOTE: qtys arrays often carry the literal string "null" (cloud's draft
  // serializer) for empty slots. parseInt("null") returns NaN which slips
  // past `q <= 0`; we coerce via `|| 0` to drop those properly.
  const parseQty = (q) => {
    const n = parseInt(q, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const buildScenarioMatrix = () => {
    const items = buildItems();
    const setQtys = getSetQtys(); // null in Individual / single-part
    const perItemRows = items.map((it) => {
      const qtys = (it.qtys || []).map(parseQty);
      return qtys.map((q, slot) => {
        if (q <= 0 || !it.oneUpW || !it.oneUpL) return null;
        const oMSF = (it.oneUpW * it.oneUpL * q) / 144 / 1000;
        return {
          slot, qty: q,
          setQty: setQtys && setQtys[slot] != null ? setQtys[slot] : null,
          ship: calcShipment(
            it.boardGrade, it.flute, it.outsideLiner, it.insideLiner, it.medium,
            oMSF, it.oneUpW, it.oneUpL, q
          ),
        };
      }).filter(Boolean);
    });

    const maxSlots = Math.max(0, ...items.map((it) => (it.qtys || []).map(parseQty).filter((q) => q > 0).length));
    const perJobScenarios = [];
    for (let k = 0; k < maxSlots; k++) {
      const perComp = items.map((it, i) => {
        const qtys = (it.qtys || []).map(parseQty).filter((q) => q > 0);
        if (qtys.length === 0 || !it.oneUpW || !it.oneUpL) return null;
        const slot = Math.min(k, qtys.length - 1);
        const qty = qtys[slot];
        const oMSF = (it.oneUpW * it.oneUpL * qty) / 144 / 1000;
        return {
          idx: i, slot, qty, oMSF,
          ship: calcShipment(
            it.boardGrade, it.flute, it.outsideLiner, it.insideLiner, it.medium,
            oMSF, it.oneUpW, it.oneUpL, qty
          ),
        };
      }).filter(Boolean);
      const combinedWeight = perComp.reduce((a, p) => a + (p.ship.totalWeight || 0), 0);
      const combinedSkids  = perComp.reduce((a, p) => a + (p.ship.skidCount   || 0), 0);
      const combinedFt     = perComp.reduce((a, p) => a + (p.ship.trailerFeet || 0), 0);
      perJobScenarios.push({
        scenarioIdx: k,
        setQty: setQtys && setQtys[k] != null ? setQtys[k] : null,
        perComp, combinedWeight, combinedSkids, combinedFt,
      });
    }
    return { perItemRows, perJobScenarios };
  };

  const updateFreight = async () => {
    if (!s.destZip) { setErr("Need ship-to ZIP first"); return; }
    setBusy(true); setErr("");
    try {
      const isMP = s.quoteType === "Multi-Part" && Array.isArray(s.bomItems) && s.bomItems.length > 0;

      // ─── Single-Part: quote freight for EVERY priceable qty slot ─────────
      // Legacy parity (spot_r1_5.jsx updateAllFreight): freight is recomputed
      // per quantity because the shipped weight + skid count grow with qty. We
      // fire one UTS quote per non-empty qty slot, store the per-slot result in
      // `freightByQty[slot]`, and let the engine apply the matching freight to
      // each Quote Table row.
      if (!isMP) {
        const uw = parseFloat(s.oneUpW || 0), ul = parseFloat(s.oneUpL || 0);
        // Build a per-slot shipment for each populated qty.
        const slots = [];
        (s.qtys || []).forEach((raw, slot) => {
          const qty = _parseQty(raw);
          if (qty <= 0 || uw <= 0 || ul <= 0) return;
          const oMSF = (uw * ul * qty) / 144 / 1000;
          const ship = calcShipment(s.boardGrade, s.flute, s.outsideLiner || "None",
            s.insideLiner || "None", s.medium || "None", oMSF, uw, ul, qty);
          slots.push({ slot, qty, ship, weight: Math.max(100, Math.round(ship.totalWeight || 100)) });
        });
        if (slots.length === 0) { setErr("Enter dimensions and at least one quantity first"); return; }

        // Batch the UTS quotes (chunked to 4 to stay under the ~60s ingress cap).
        const dest = { destZip: s.destZip, freightClass: "70" };
        const batchItems = slots.map((sl, k) => ({ ...dest, weightLbs: sl.weight, ref: `s:${k}` }));
        const byRef = {};
        const CHUNK = 4;
        for (let i = 0; i < batchItems.length; i += CHUNK) {
          const chunk = batchItems.slice(i, i + CHUNK);
          const resp = await freightQuoteBatch(chunk);
          (resp.results || []).forEach((r) => { byRef[r.ref] = r; });
        }
        const perItemQuotes = slots.map((sl, k) => {
          const r = byRef[`s:${k}`] || {};
          return {
            idx: 0, slot: sl.slot, qty: sl.qty, ship: sl.ship, weight: sl.weight,
            totalAmount: r.totalAmount || 0, carrier: r.carrier || "",
            transitDays: r.transitDays != null ? r.transitDays : null,
            allCarriers: r.allCarriers || [],
          };
        });
        // Per-slot freight map the engine reads: { slot: rawCost }.
        const freightByQty = {};
        perItemQuotes.forEach((q) => { freightByQty[q.slot] = String(Number(q.totalAmount || 0).toFixed(2)); });

        // The active/selected slot drives the single freightCost the legacy
        // Economics/Cost-Buildup panels read; default to the selected row.
        const selSlot = Number(s.selSlot || 0);
        const activeQuote = perItemQuotes.find((q) => q.slot === selSlot) || perItemQuotes[0];
        const isLocal = activeQuote?.carrier === "SPC Local Delivery"
          || s.quoteFOB === "LocalDelivery";

        // Per-Job for a single-part quote == the same per-slot shipments (one
        // component), so the Dashboard's Per-Job view mirrors Per-Item.
        const perJobQuotes = perItemQuotes.map((q) => ({
          scenarioIdx: q.slot,
          perComp: [{ idx: 0, slot: q.slot, qty: q.qty, ship: q.ship }],
          combinedWeight: q.ship.totalWeight, combinedSkids: q.ship.skidCount,
          combinedFt: q.ship.trailerFeet, weight: q.weight,
          totalAmount: q.totalAmount, carrier: q.carrier,
          transitDays: q.transitDays, allCarriers: q.allCarriers,
        }));

        const totalAll = perItemQuotes.reduce((a, q) => a + (Number(q.totalAmount) || 0), 0);
        const minNotice = detectFreightMinimum(perItemQuotes);
        setManyFields({
          freightByQty,
          freightCost: String(activeQuote?.totalAmount ?? 0),
          quoteFOB: "Destination",
          freightCarrier: activeQuote?.carrier || "",
          freightTransit: activeQuote?.transitDays != null ? String(activeQuote.transitDays) : "",
          freightTreatment: s.freightTreatment === "None" ? "Amortize" : s.freightTreatment,
          freightMarkup: isLocal ? "0" : "0.15",
          freightDashCache: {
            perItemQuotes,
            perJobQuotes,
            minNotice,
            lastCalcZip: s.destZip,
            lastCalcAt: new Date().toISOString(),
          },
        });
        const minMsg = minNotice ? ` · ⚠ carrier LTL minimum ${fmtMoney(minNotice.amount)} in play` : "";
        pushToast(`Freight quoted for ${perItemQuotes.length} qty tier${perItemQuotes.length === 1 ? "" : "s"} · ${fmtMoney(totalAll)} total${isLocal ? " (local, no markup)" : ""}${minMsg} — open Dashboard for per-qty detail`, "ok");
        return;
      }

      // ─── Multi-Part: fire BOTH Per-Item AND Per-Job quotes in one pass ───
      // Per-Item:  one UTS quote per (component × qty)  — solo shipment
      // Per-Job:   one UTS quote per scenario           — combined shipment
      // Cache both result sets on the quote so the user can flip the scope
      // toggle without re-fetching, and the Freight Dashboard can read them.
      const { perItemRows, perJobScenarios } = buildScenarioMatrix();
      const flatPerItem = [];
      perItemRows.forEach((rows, i) => rows.forEach((r) => flatPerItem.push({ idx: i, ...r })));
      if (flatPerItem.length === 0 && perJobScenarios.length === 0) {
        setErr("No priceable quantities for freight"); return;
      }

      const dest = { destZip: s.destZip, freightClass: "70" };
      // Batch all UTS quotes — but K8s ingress times out at ~60s per HTTP
      // request, and each UTS call takes ~10s through the server-side lock.
      // So we chunk to 4 quotes per batch (~40s each) and run chunks in series.
      const batchItems = [
        ...flatPerItem.map((row, k) => ({
          ...dest,
          weightLbs: Math.max(100, Math.round(row.ship.totalWeight || 100)),
          ref: `pi:${k}`,
        })),
        ...perJobScenarios.map((sc, k) => ({
          ...dest,
          weightLbs: Math.max(100, Math.round(sc.combinedWeight || 100)),
          ref: `pj:${k}`,
        })),
      ];
      const CHUNK = 4;
      const byRef = {};
      // Resilient batching: a single chunk hitting a transient 502 (UTS/ingress
      // hiccup) must NOT abort the whole quote or flash a red error when the
      // other chunks succeed. Retry each chunk once, accumulate what we get, and
      // only surface an error if NOTHING came back.
      for (let i = 0; i < batchItems.length; i += CHUNK) {
        const chunk = batchItems.slice(i, i + CHUNK);
        let resp = null;
        for (let attempt = 0; attempt < 2 && !resp; attempt++) {
          try { resp = await freightQuoteBatch(chunk); }
          catch (e) { /* retry once, then move on */ }
        }
        (resp?.results || []).forEach((r) => { byRef[r.ref] = r; });
      }
      if (Object.keys(byRef).length === 0) {
        setErr("Freight quote failed — no carrier rates returned. Check the ZIP and try again.");
        return;
      }
      const perItemQuotes = flatPerItem.map((row, k) => {
        const r = byRef[`pi:${k}`] || {};
        return { ...row, weight: Math.max(100, Math.round(row.ship.totalWeight || 100)),
                 totalAmount: r.totalAmount || 0, carrier: r.carrier || "",
                 transitDays: r.transitDays != null ? r.transitDays : null,
                 allCarriers: r.allCarriers || [] };
      });
      const perJobQuotes = perJobScenarios.map((sc, k) => {
        const r = byRef[`pj:${k}`] || {};
        return { ...sc, weight: Math.max(100, Math.round(sc.combinedWeight || 100)),
                 totalAmount: r.totalAmount || 0, carrier: r.carrier || "",
                 transitDays: r.transitDays != null ? r.transitDays : null,
                 allCarriers: r.allCarriers || [] };
      });

      // ─── Per-Item map: { compIdx: { slot: cost } } ─────────────────────
      const perItemMap = {};
      perItemQuotes.forEach((q) => {
        if (!perItemMap[q.idx]) perItemMap[q.idx] = {};
        perItemMap[q.idx][q.slot] = String(Number(q.totalAmount || 0).toFixed(2));
      });

      // ─── Per-Job map: { compIdx: { slot: allocated_share } } + totals ──
      // Allocate each scenario's combined freight across components using the
      // SELECTED method (Board MSF / Equal / By Weight) — matches the backend
      // _alloc_job so the dashboard, the per-component panels and the priced
      // quote all agree.
      const allocMethod = s.freightAllocMethod || "By MSF";
      const perJobMap = {};
      const jobFreightBySlot = {};
      const carrierBySlot = {};
      perJobQuotes.forEach((sc) => {
        const total = Number(sc.totalAmount || 0);
        jobFreightBySlot[sc.scenarioIdx] = String(total.toFixed(2));
        carrierBySlot[sc.scenarioIdx] = {
          carrier: sc.carrier || "", transit: sc.transitDays != null ? String(sc.transitDays) : "",
          combinedWeight: sc.combinedWeight, combinedSkids: sc.combinedSkids,
          allCarriers: sc.allCarriers || [],
        };
        if (total > 0) {
          const comps = sc.perComp.map((p) => ({ oMSF: p.oMSF || 0, weight: p.ship?.totalWeight || 0 }));
          const allocs = allocateJobCost(comps, total, allocMethod);
          sc.perComp.forEach((p, ci) => {
            if (!perJobMap[p.idx]) perJobMap[p.idx] = {};
            perJobMap[p.idx][sc.scenarioIdx] = String((allocs[ci] || 0).toFixed(2));
          });
        }
      });

      // ─── Apply currently-selected mode's values to live engine state ───
      const scope = s.freightScope || "None"; // "None" / "Per Item" both = per-item solo
      const activeIdx = s.activeItemIdx ?? 0;
      const selSlot = Number(s.selSlot || 0);
      const isPerJob = scope === "Per Job";

      const nextBom = (s.bomItems || []).map((bi, i) => {
        const itemPerItem = perItemMap[i] || {};
        const itemPerJob  = perJobMap[i]  || {};
        const liveMap = isPerJob ? itemPerJob : itemPerItem;
        const currentSlot = Number(bi.state?.selSlot ?? selSlot);
        const liveCost = liveMap[currentSlot] || "0";
        return {
          ...bi,
          state: {
            ...(bi.state || {}),
            freightByQty: itemPerItem,           // always store the solo map here
            perJobFreightByQty: itemPerJob,      // and the allocated map here
            freightCost: liveCost,                // engine reads this for active mode
            freightTreatment: bi.state?.freightTreatment === "None" ? "Amortize" : (bi.state?.freightTreatment || "Amortize"),
            freightCarrier: (isPerJob ? carrierBySlot[currentSlot]?.carrier : perItemQuotes.find((q) => q.idx === i && q.slot === currentSlot)?.carrier) || "",
            freightTransit: (isPerJob ? carrierBySlot[currentSlot]?.transit : (perItemQuotes.find((q) => q.idx === i && q.slot === currentSlot)?.transitDays != null ? String(perItemQuotes.find((q) => q.idx === i && q.slot === currentSlot).transitDays) : "")) || "",
            quoteFOB: "Destination",
          },
        };
      });

      const activeJobCost = jobFreightBySlot[selSlot] || jobFreightBySlot[0] || "0";
      // Auto-set markup based on active scenario's carrier. SPC Local Delivery
      // (within our zones) → 0% markup. Anything else → 15% legacy default.
      const activeScenarioCarrier = (perJobQuotes[selSlot] || perJobQuotes[0] || {}).carrier
        || (perItemQuotes[0] || {}).carrier || "";
      // Robust local-delivery detection: ANY of these signals counts as Local
      // (legacy parity + bug-prevention). Previously only checked carrier name,
      // which missed cases where the scenario didn't have a carrier set yet.
      const activeIsLocal = s.quoteFOB === "LocalDelivery"
        || activeScenarioCarrier === "SPC Local Delivery"
        || activeScenarioCarrier === "Local Delivery";
      // Detect a carrier LTL-minimum floor across the solo + combined quotes
      // so we can surface it to the estimator (per-item shipments often all
      // land on the same minimum charge).
      const minNotice = detectFreightMinimum([
        ...perItemQuotes.map((q) => ({ weight: q.weight, totalAmount: q.totalAmount, carrier: q.carrier })),
        ...perJobQuotes.map((q) => ({ weight: q.weight, totalAmount: q.totalAmount, carrier: q.carrier })),
      ]);
      const patch = {
        bomItems: nextBom,
        quoteFOB: "Destination",
        freightTreatment: s.freightTreatment === "None" ? "Amortize" : s.freightTreatment,
        jobFreightBySlot,
        jobFreightCost: activeJobCost,
        jobFreightTreatment: s.jobFreightTreatment || "Amortize",
        freightMarkup: activeIsLocal ? "0" : "0.15",
        // Snapshot the full cache so the Dashboard renders without re-fetching
        freightDashCache: {
          perItemQuotes,   // [{idx, slot, qty, ship, weight, totalAmount, carrier, transitDays, allCarriers}]
          perJobQuotes,    // [{scenarioIdx, perComp, combinedWeight, weight, totalAmount, carrier, transitDays, allCarriers}]
          minNotice,       // { amount, carrier } | null — carrier LTL minimum in play
          lastCalcZip: s.destZip,
          lastCalcAt: new Date().toISOString(),
        },
      };
      const activeBi = nextBom[activeIdx];
      if (activeBi?.state) {
        patch.freightCost = activeBi.state.freightCost;
        patch.freightCarrier = isPerJob ? (carrierBySlot[selSlot]?.carrier || "") : (activeBi.state.freightCarrier || "");
        patch.freightTransit = isPerJob ? (carrierBySlot[selSlot]?.transit || "") : (activeBi.state.freightTransit || "");
      }
      setManyFields(patch);

      // Toast summary — show whichever mode is active
      const minMsg = minNotice ? ` · ⚠ carrier LTL minimum ${fmtMoney(minNotice.amount)} in play` : "";
      if (isPerJob) {
        const total = Number(activeJobCost) || 0;
        const sc = perJobQuotes[selSlot] || perJobQuotes[0];
        pushToast(`Per-Job Freight ${fmtMoney(total)} · ${sc?.carrier || "—"} · ${sc?.combinedSkids || 0} skids · ${sc?.combinedWeight || 0} lbs combined${minMsg}`, "ok");
      } else {
        const itemTotal = perItemQuotes.reduce((a, q) => a + (Number(q.totalAmount) || 0), 0);
        pushToast(`Per-Item Freight ${fmtMoney(itemTotal)} across ${perItemQuotes.length} shipments · open Dashboard to compare${minMsg}`, "ok");
      }
    } catch (e) { setErr(e?.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  // When the user toggles Per Item ↔ Per Job, swap cached freight values into
  // live engine state without re-fetching UTS. Called from the FOB/scope tiles.
  // (Exposed via the s.freightDashCache stored by updateFreight.)
  const applyScopeFromCache = (nextScope) => {
    const cache = s.freightDashCache;
    if (!cache || !Array.isArray(s.bomItems)) return;
    const isPerJob = nextScope === "Per Job";
    const selSlot = Number(s.selSlot || 0);
    const activeIdx = s.activeItemIdx ?? 0;
    const perItemBy = {}, perJobBy = {};
    (cache.perItemQuotes || []).forEach((q) => {
      if (!perItemBy[q.idx]) perItemBy[q.idx] = {};
      perItemBy[q.idx][q.slot] = String(Number(q.totalAmount || 0).toFixed(2));
    });
    (cache.perJobQuotes || []).forEach((sc) => {
      const total = Number(sc.totalAmount || 0);
      if (total <= 0) return;
      const comps = (sc.perComp || []).map((p) => ({ oMSF: p.oMSF || 0, weight: p.ship?.totalWeight || 0 }));
      const allocs = allocateJobCost(comps, total, s.freightAllocMethod || "By MSF");
      (sc.perComp || []).forEach((p, ci) => {
        if (!perJobBy[p.idx]) perJobBy[p.idx] = {};
        perJobBy[p.idx][sc.scenarioIdx] = String((allocs[ci] || 0).toFixed(2));
      });
    });
    const nextBom = s.bomItems.map((bi, i) => {
      const liveMap = isPerJob ? (perJobBy[i] || {}) : (perItemBy[i] || {});
      const currentSlot = Number(bi.state?.selSlot ?? selSlot);
      return {
        ...bi,
        state: {
          ...(bi.state || {}),
          freightByQty: perItemBy[i] || {},
          perJobFreightByQty: perJobBy[i] || {},
          freightCost: liveMap[currentSlot] || "0",
        },
      };
    });
    const jobBySlot = {};
    (cache.perJobQuotes || []).forEach((sc) => {
      jobBySlot[sc.scenarioIdx] = String(Number(sc.totalAmount || 0).toFixed(2));
    });
    const patch = {
      bomItems: nextBom,
      jobFreightBySlot: jobBySlot,
      jobFreightCost: jobBySlot[selSlot] || jobBySlot[0] || "0",
      freightScope: nextScope,
    };
    // Auto-set markup based on currently-selected scenario's carrier
    const activeCarrier = (cache.perJobQuotes?.[selSlot] || cache.perJobQuotes?.[0] || {}).carrier
      || (cache.perItemQuotes?.[0] || {}).carrier || "";
    // Robust local-delivery detection (see line ~452 explanation).
    const _isLocal = s.quoteFOB === "LocalDelivery"
      || activeCarrier === "SPC Local Delivery"
      || activeCarrier === "Local Delivery";
    patch.freightMarkup = _isLocal ? "0" : "0.15";
    const activeBi = nextBom[activeIdx];
    if (activeBi?.state) patch.freightCost = activeBi.state.freightCost;
    setManyFields(patch);
  };

  return (
    <>
      {/* UTS inline spinner moved into FreightDashModal header — see
          FreightDashModal busy prop (2026-06-12, per user feedback that the
          full-screen ProgressModal blocked the rest of the UI). */}
      <FreightDashModal open={dashOpen} onClose={() => setDashOpen(false)}
        applyScopeFromCache={applyScopeFromCache} updateFreight={updateFreight} busy={busy} />
    <div data-testid="freight-panel" style={panelStyle("#f59e0b")}>
      <div style={panelHeader("#f59e0b")}>🚚 Freight</div>
      <div style={{ padding: "8px 10px" }}>
        {/* BOM color sync — display the active component's tint as a visual cue
            so the Freight section visibly matches the BOM section / Quote
            Table row the user is operating on. Matches BOM_TINTS in
            QuoteTableSec.jsx (kept in sync for design consistency). */}
        {(() => {
          const TINTS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a", "#9ca3af", "#fbbf24"];
          const idx = Number(s.activeItemIdx ?? 0);
          const itemTint = TINTS[idx % TINTS.length];
          const isMP = s.quoteType === "Multi-Part" && Array.isArray(s.bomItems) && s.bomItems.length > 0;
          const activeBomDesc = isMP && (s.bomItems[idx]?.desc) ? s.bomItems[idx].desc : "";
          if (!isMP || s.freightScope === "Per Job" || s.quoteFOB === "Origin" || s.quoteFOB === "LocalDelivery") return null;
          return (
            <div data-testid="freight-active-comp" style={{
              fontSize: 10, fontWeight: 700, color: itemTint,
              padding: "3px 8px", marginBottom: 4, borderRadius: 3,
              background: `${itemTint}18`, border: `1px solid ${itemTint}55`,
              borderLeft: `4px solid ${itemTint}`,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: itemTint }} />
              {idx + 1}. {(activeBomDesc || `Item ${idx + 1}`).slice(0, 32)}
              <span style={{ color: "var(--spot-text3)", fontWeight: 500 }}>· per-component freight</span>
            </div>
          );
        })()}
        <div style={rowSpaced}>
          <span style={lbl}>FOB</span>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Tile label="Will-Call" active={s.quoteFOB === "Origin"}
              onClick={() => {
                // Will-Call: NO freight at all. Clear job-level + per-component freight.
                // Do NOT reset freightMarkup — preserve the user's prior setting
                // (especially 0% for Local Delivery scenarios).
                const patch = {
                  quoteFOB: "Origin",
                  localDeliveryZone: null,
                  jobFreightCost: "",
                  jobFreightTreatment: "",
                  freightScope: "None-Off",
                  freightCost: "0",
                  freightTreatment: "None",
                  freightCarrier: "",
                  freightTransit: "",
                };
                // Clear each component's freight in MP mode
                if (Array.isArray(s.bomItems) && s.bomItems.length > 0) {
                  patch.bomItems = s.bomItems.map((bi) => ({
                    ...bi,
                    state: {
                      ...(bi.state || {}),
                      freightCost: "0", freightTreatment: "None",
                      freightCarrier: "", freightTransit: "",
                    },
                  }));
                }
                setManyFields(patch);
              }}
              small data-testid="tile-fob-willcall" />
            <Tile label="Ship"      active={s.quoteFOB === "Destination"}
              onClick={() => {
                // Ship: Per Item / Line defaults (legacy). Clear LocalDelivery zone.
                // Do NOT reset freightMarkup on FOB switch — preserve the user's
                // prior choice. Auto-set happens in updateFreight() once a quote
                // is fetched, based on the carrier (SPC Local Delivery → 0%).
                const patch = {
                  quoteFOB: "Destination",
                  localDeliveryZone: null,
                  jobFreightCost: "",
                  jobFreightTreatment: "Amortize",
                  freightScope: "None",   // "None" actually means Per Item in legacy
                  freightTreatment: "Amortize",
                };
                setManyFields(patch);
              }}
              small tint="#3b82f6" data-testid="tile-fob-ship" />
          </div>
        </div>

        {s.quoteFOB === "Origin" ? (
          // Will-Call: legacy parity (spot_r1_5.jsx L3890, L4264-4265). Skip Type /
          // Ship-To / Markup / Update All — there's nothing to ship, customer picks up.
          // Engine + PDF already gate on quoteFOB===Destination so no freight is added.
          <div data-testid="freight-willcall-info"
            style={{ marginTop: 8, padding: "10px 12px", background: "var(--spot-bg3)",
              border: "1px solid var(--spot-border)", borderRadius: 4, textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)" }}>
              No freight — customer will pick up at our dock
            </div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", marginTop: 4 }}>
              Canton, OH (1115 Cherry Ave NE)
            </div>
          </div>
        ) : (
          <>
            <div style={rowSpaced}>
              <span style={lbl}>Type</span>
              {s.quoteType === "Multi-Part" ? (
                // Multi-Part: scope tiles match legacy (None / Per Item / Per Job)
                <div style={{ display: "flex", gap: 2 }} data-testid="freight-scope-tiles">
                  <Tile label="None"     active={s.freightScope === "None-Off"}                onClick={() => setField("freightScope", "None-Off")}                                              small data-testid="tile-freight-scope-none" />
                  <Tile label="Per Item" active={!s.freightScope || s.freightScope === "None"} onClick={() => { if (s.freightDashCache) applyScopeFromCache("None"); else setField("freightScope", "None"); }} small tint="#22c55e" data-testid="tile-freight-scope-per-item" />
                  <Tile label="Per Job"  active={s.freightScope === "Per Job"}                 onClick={() => { if (s.freightDashCache) applyScopeFromCache("Per Job"); else setField("freightScope", "Per Job"); }} small tint="#06b6d4" data-testid="tile-freight-scope-per-job" />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 2 }}>
                  <Tile label="None"  active={s.freightTreatment === "None"}          onClick={() => setField("freightTreatment", "None")} small data-testid="tile-freight-none" />
                  <Tile label="Line"  active={s.freightTreatment === "Separate Line"} onClick={() => setField("freightTreatment", "Separate Line")} small tint="#22c55e" data-testid="tile-freight-line" />
                  <Tile label="Amort" active={s.freightTreatment === "Amortize"}      onClick={() => setField("freightTreatment", "Amortize")} small data-testid="tile-freight-amort" />
                </div>
              )}
            </div>

            {/* Legacy parity: MP mode also exposes Line vs Amortize treatment. In
                Per Item scope the treatment applies per-component (uses item's
                freightTreatment); in Per Job scope the treatment applies to the
                job freight (jobFreightTreatment). */}
            {s.quoteType === "Multi-Part" && s.freightScope !== "None-Off" && (
              <div style={rowSpaced} data-testid="freight-treatment-mp-row">
                <span style={lbl}>Treatment</span>
                {s.freightScope === "Per Job" ? (
                  <div style={{ display: "flex", gap: 2 }} data-testid="freight-treatment-mp-perjob">
                    <Tile label="Line"  active={s.jobFreightTreatment === "Separate Line"}
                      onClick={() => setField("jobFreightTreatment", "Separate Line")} small tint="#22c55e"
                      data-testid="tile-jobfreight-line" />
                    <Tile label="Amort" active={(s.jobFreightTreatment || "Amortize") === "Amortize"}
                      onClick={() => setField("jobFreightTreatment", "Amortize")} small
                      data-testid="tile-jobfreight-amort" />
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 2 }} data-testid="freight-treatment-mp-peritem">
                    <Tile label="Line"  active={s.freightTreatment === "Separate Line"}
                      onClick={() => setField("freightTreatment", "Separate Line")} small tint="#22c55e"
                      data-testid="tile-itemfreight-line" />
                    <Tile label="Amort" active={!s.freightTreatment || s.freightTreatment === "Amortize"}
                      onClick={() => setField("freightTreatment", "Amortize")} small
                      data-testid="tile-itemfreight-amort" />
                  </div>
                )}
                <span style={{ fontSize: 10, color: "var(--spot-text3)", marginLeft: "auto" }}>
                  {s.freightScope === "Per Job"
                    ? "Job freight is shown as a line item or rolled into per-pc cost"
                    : "Each component's freight is shown as a line item or rolled into per-pc cost"}
                </span>
              </div>
            )}

            {s.quoteType === "Multi-Part" && s.freightScope === "Per Job" ? (
              // Per Job mode — freight $ + markup display, no verbose pointer text.
              <>
              {(() => {
                // Show the Per-Job freight for the CURRENTLY SELECTED qty tier
                // (driven by the Quote Table row selection, s.selSlot). Per-slot
                // value comes from jobFreightBySlot; fall back to the flat
                // jobFreightCost only when no per-slot value exists.
                const selSlot = Number(s.selSlot || 0);
                const jbs = s.jobFreightBySlot || {};
                const perSlot = jbs[selSlot] ?? jbs[String(selSlot)];
                const hasPerSlot = perSlot != null && perSlot !== "" && perSlot !== "null";
                const raw = Number(hasPerSlot ? perSlot : s.jobFreightCost) || 0;
                const selQty = Number((s.qtys || [])[selSlot]) || 0;
                const _isLocal = isLocalCarrier(s.freightCarrier) || s.quoteFOB === "LocalDelivery";
                const mk  = _isLocal ? 0 : (Number(s.freightMarkup ?? 0.15) || 0);
                const total = raw * (1 + mk);
                return (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#06b6d40c",
                    border: "1px solid #06b6d444", borderRadius: 4 }} data-testid="freight-per-job-pointer">
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#06b6d4",
                      textTransform: "uppercase", letterSpacing: ".06em" }}>
                      Per-Job Freight
                      {selQty > 0 && (
                        <span data-testid="freight-per-job-qty"
                          style={{ color: "var(--spot-text3)", fontWeight: 700 }}>
                          {" · Qty "}{selQty.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: "var(--spot-text3)" }}
                        data-testid="freight-per-job-base">
                        {fmtMoney(raw)} + {(mk * 100).toFixed(0)}% markup
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#06b6d4" }}
                        data-testid="freight-per-job-amount">{fmtMoney(total)}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: "var(--spot-text3)" }}>
                      Allocated {s.freightAllocMethod || "By MSF"} across {(s.bomItems || []).length} components
                    </div>
                  </div>
                );
              })()}
              {/* Per-Job mode still needs Ship-To ZIP + Update All + Dashboard for rate lookup */}
              <div style={rowSpaced}>
                <span style={lbl}>Ship To</span>
                <input className="sp-input" value={s.destZip || ""}
                  data-testid="freight-zip-input"
                  onChange={(e) => setField("destZip", e.target.value)}
                  style={{ width: 70, padding: "3px 6px", fontSize: 11 }} placeholder="ZIP" />
                <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Markup</span>
                <input className="sp-input" value={s.freightMarkup ?? (s.quoteFOB === "LocalDelivery" ? "0" : "0.15")}
                  data-testid="freight-markup-input"
                  onChange={(e) => setField("freightMarkup", e.target.value)}
                  style={{ width: 50, padding: "3px 6px", fontSize: 11 }} placeholder={s.quoteFOB === "LocalDelivery" ? "0" : "0.15"} />
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={updateFreight} disabled={busy} data-testid="btn-freight-update"
                  style={{
                    all: "unset", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 700,
                    padding: "5px 10px", borderRadius: 3,
                    background: "var(--spot-accent)", color: "#fff",
                    opacity: busy ? 0.7 : 1,
                  }}>{busy ? "…" : "Update All"}</button>
                <button data-testid="btn-freight-dash" onClick={() => setDashOpen(true)} style={{
                  all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  padding: "5px 10px", borderRadius: 3,
                  background: "var(--spot-purple-bg)", color: "var(--spot-purple)",
                  border: "1px solid var(--spot-purple)",
                }}>Dashboard</button>
                {shipmentEst.lbs > 100 && (
                  <span data-testid="freight-shipment-est" style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                    background: "var(--spot-bg3)", color: "var(--spot-text2)",
                    border: "1px solid var(--spot-border)",
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".02em",
                  }} title="Estimated shipment: pallets + weight. Used for UTS rate request.">
                    📦 {shipmentEst.skids} skid{shipmentEst.skids !== 1 ? "s" : ""}
                    {" · "}{shipmentEst.lbs.toLocaleString()} lbs est
                  </span>
                )}
              </div>
              {s.freightCarrier && s.quoteFOB !== "LocalDelivery" && (
                <div data-testid="freight-carrier" style={{
                  fontSize: 11, color: "var(--spot-green)", fontWeight: 700,
                  textAlign: "right", marginTop: 4,
                }}>
                  via {s.freightCarrier}
                  {s.freightTransit && <span style={{ fontWeight: 500, color: "var(--spot-text3)" }}>{" · "}{s.freightTransit} day{s.freightTransit === "1" ? "" : "s"} transit</span>}
                </div>
              )}
              {err && <div style={{ marginTop: 6, fontSize: 11, color: "var(--spot-err)" }} data-testid="freight-err">{err}</div>}
              </>
            ) : s.quoteType === "Multi-Part" && s.freightScope === "None-Off" ? (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--spot-bg3)",
                border: "1px solid var(--spot-border)", borderRadius: 4, fontSize: 11,
                color: "var(--spot-text3)" }} data-testid="freight-mp-off">
                No freight on this multi-part quote.
              </div>
            ) : (
              <>
            <div style={rowSpaced}>
              <span style={lbl}>Ship To</span>
              <input className="sp-input" value={s.destZip || ""}
                data-testid="freight-zip-input"
                onChange={(e) => setField("destZip", e.target.value)}
                style={{ width: 70, padding: "3px 6px", fontSize: 11 }} placeholder="ZIP" />
              <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Markup</span>
              <input className="sp-input" value={s.freightMarkup ?? (s.quoteFOB === "LocalDelivery" ? "0" : "0.15")}
                data-testid="freight-markup-input"
                onChange={(e) => setField("freightMarkup", e.target.value)}
                style={{ width: 50, padding: "3px 6px", fontSize: 11 }} placeholder={s.quoteFOB === "LocalDelivery" ? "0" : "0.15"} />
            </div>

            {(() => {
              const TINTS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a", "#9ca3af", "#fbbf24"];
              const isMP = s.quoteType === "Multi-Part" && Array.isArray(s.bomItems) && s.bomItems.length > 0;
              const idx = Number(s.activeItemIdx ?? 0);
              const tint = isMP ? TINTS[idx % TINTS.length] : "var(--spot-accent)";
              const tintSoft = isMP ? `${tint}18` : "var(--spot-accent-soft)";
              // Show the freight for the CURRENTLY SELECTED qty tier (driven by the
              // Quote Table row selection, s.selSlot). Per-slot value comes from
              // freightByQty; fall back to the flat freightCost if not yet quoted.
              const selSlot = Number(s.selSlot || 0);
              const fbq = s.freightByQty || {};
              const perSlot = fbq[selSlot] ?? fbq[String(selSlot)];
              const hasPerSlot = perSlot != null && perSlot !== "" && perSlot !== "null";
              const raw = Number(hasPerSlot ? perSlot : s.freightCost) || 0;
              const selQty = Number((s.qtys || [])[selSlot]) || 0;
              const _isLocal2 = isLocalCarrier(s.freightCarrier) || s.quoteFOB === "LocalDelivery";
              const mk  = _isLocal2 ? 0 : (Number(s.freightMarkup ?? 0.15) || 0);
              const total = raw * (1 + mk);
              return (
                <div style={{ marginTop: 8, padding: "8px 10px",
                  background: tintSoft, border: `1px solid ${tint}`,
                  borderLeft: `4px solid ${tint}`, borderRadius: 4 }}
                  data-testid="freight-item-card">
                  <div style={{ fontSize: 10, fontWeight: 700, color: tint,
                    textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {isMP ? `Item ${idx + 1} · Freight` : "Item Freight"}
                    {selQty > 0 && (
                      <span data-testid="freight-item-qty"
                        style={{ color: "var(--spot-text3)", fontWeight: 700 }}>
                        {" · Qty "}{selQty.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "baseline", marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: "var(--spot-text3)" }}
                      data-testid="freight-item-base">
                      {fmtMoney(raw)} + {(mk * 100).toFixed(0)}% markup
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: tint }}
                      data-testid="freight-amount-display"
                      title={`Total to ship the selected qty (cost + markup)`}>
                      {fmtMoney(total)}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: Number(s.freightCost) > 0 ? "var(--spot-green)" : "var(--spot-text3)" }}>
                {Number(s.freightCost) > 0 ? "● Freight verified — OK to quote" : "○ No freight yet"}
              </span>
            </div>
            {s.freightCarrier && s.quoteFOB !== "LocalDelivery" && (
              <div data-testid="freight-carrier" style={{
                fontSize: 11, color: "var(--spot-green)", fontWeight: 700,
                textAlign: "right", marginTop: 2,
              }}>
                via {s.freightCarrier}
                {s.freightTransit && <span style={{ fontWeight: 500, color: "var(--spot-text3)" }}>{" · "}{s.freightTransit} day{s.freightTransit === "1" ? "" : "s"} transit</span>}
              </div>
            )}

            <div style={{ marginTop: 6, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={updateFreight} disabled={busy} data-testid="btn-freight-update"
                style={{
                  all: "unset", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 700,
                  padding: "5px 10px", borderRadius: 3,
                  background: "var(--spot-accent)", color: "#fff",
                  opacity: busy ? 0.7 : 1,
                }}>{busy ? "…" : "Update All"}</button>
          <button data-testid="btn-freight-dash" onClick={() => setDashOpen(true)} style={{
            all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
            padding: "5px 10px", borderRadius: 3,
            background: "var(--spot-purple-bg)", color: "var(--spot-purple)",
            border: "1px solid var(--spot-purple)",
          }}>Dashboard</button>
              {/* Live shipment estimate from skid calc + density tables */}
              {shipmentEst.lbs > 100 && (
                <span data-testid="freight-shipment-est" style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                  background: "var(--spot-bg3)", color: "var(--spot-text2)",
                  border: "1px solid var(--spot-border)",
                  fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".02em",
                }} title="Estimated shipment: pallets + weight. Used for UTS rate request.">
                  📦 {shipmentEst.skids} skid{shipmentEst.skids !== 1 ? "s" : ""}
                  {" · "}{shipmentEst.lbs.toLocaleString()} lbs est
                </span>
              )}
        </div>
        {err && <div style={{ marginTop: 6, fontSize: 11, color: "var(--spot-err)" }} data-testid="freight-err">{err}</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}

function RouteComparison({ s, primary }) {
  const { active, setField, setManyFields, pushToast } = useQuote();
  const tabId = active?.id;
  // LEGACY PARITY (spot_r1_5.jsx L3686): showRouteComp defaults to FALSE.
  // Estimator clicks the header to expand the comparison table.
  const [open, setOpen] = useState(false);
  const [comp, setComp] = useState(null);
  const [busy, setBusy] = useState(false);
  const qty = primary?.qty;
  const forced = !!(s.routeOverride && s.routeOverride !== "Auto");

  // Clear stale comparison when switching tabs OR when inputs become invalid
  // (new blank tab, board cleared, etc). Without this, the prior tab's CAD/Crest/
  // Bobst numbers stick to the panel until the new tab gets valid inputs.
  useEffect(() => {
    if (!s.oneUpW || !s.oneUpL || !qty) {
      setComp(null);
      setBusy(false);
    }
  }, [tabId, s.oneUpW, s.oneUpL, qty]);

  // Debounced fetch (matches useEngine cadence)
  useEffect(() => {
    if (!s.oneUpW || !s.oneUpL || !qty) return;
    let cancel = false;
    const t = setTimeout(() => {
      setBusy(true);
      compareRoutes({
        oneUpW: s.oneUpW, oneUpL: s.oneUpL, qty,
        boardGrade: s.boardGrade, flute: s.flute,
        outsideLiner: s.outsideLiner, insideLiner: s.insideLiner, medium: s.medium,
        printReq: s.printReq, printMode: s.printMode,
        dieTreatment: s.dieTreatment, cuttingDieCost: s.cuttingDieCost,
        totalRuleInches: s.totalRuleInches,
        cadDifficulty: s.cadDifficulty,
      }).then((d) => { if (!cancel) setComp(d); })
        .catch(() => { if (!cancel) setComp(null); })
        .finally(() => { if (!cancel) setBusy(false); });
    }, 500);
    return () => { cancel = true; clearTimeout(t); };
  }, [s.oneUpW, s.oneUpL, qty, s.boardGrade, s.flute, s.outsideLiner, s.insideLiner, s.medium,
      s.printReq, s.printMode, s.dieTreatment, s.cuttingDieCost, s.totalRuleInches,
      s.cadDifficulty]);

  const winner = comp?.winner;  // auto cheapest route (legacy parity — header always shows auto winner)
  const forcedRoute = forced ? s.routeOverride : null;
  // Legacy badge color: CAD green / Bobst purple / else (Crest) blue (spot_r1_5.jsx L6914)
  const winnerBadgeColor = winner === "CAD" ? "#22c55e" : winner === "Bobst" ? "#a855f7" : "#3b82f6";
  const dieNone = !s.dieTreatment || s.dieTreatment === "None";

  // Switch handlers — 1:1 with legacy spot_r1_5.jsx L6976-6978: force the route,
  // auto-fill a die cost on Crest/Bobst when none is set, collapse the panel, toast.
  const applyPatch = (patch) => {
    if (setManyFields) setManyFields(patch);
    else Object.entries(patch).forEach(([k, v]) => setField(k, v));
  };
  const switchToCrest = () => {
    const patch = { routeOverride: "Crest" };
    if (dieNone && comp?.crest) {
      patch.dieTreatment = "Separate Line";
      patch.cuttingDieCost = String(comp.crest.dieEstimated ? Math.round(comp.crest.die || 0) : (comp.crest.die || 1200));
    }
    applyPatch(patch);
    setOpen(false);
    pushToast && pushToast("Route forced to Crest — verify die cost", "ok");
  };
  const switchToCad = () => {
    setField("routeOverride", "CAD");
    setOpen(false);
    pushToast && pushToast("Route forced to CAD", "ok");
  };
  const switchToBobst = () => {
    const patch = { routeOverride: "Bobst" };
    if (dieNone && comp?.bobst) {
      patch.dieTreatment = "Separate Line";
      patch.cuttingDieCost = String(comp.bobst.dieEstimated ? Math.round(comp.bobst.die || 0) : (comp.bobst.die || 1800));
    }
    applyPatch(patch);
    setOpen(false);
    pushToast && pushToast(`Route forced to Bobst${comp?.bobst?.dieEstimated ? " — verify die cost" : ""}`, "ok");
  };
  const resetToAuto = () => {
    setField("routeOverride", "Auto");
    pushToast && pushToast("Route reset to auto", "ok");
  };

  // Build column data for visible routes
  const cols = [];
  if (comp?.cad) cols.push({ key: "CAD", label: "CAD", d: comp.cad });
  if (comp?.crest) cols.push({ key: "Crest", label: "Crest", d: comp.crest });
  if (comp?.bobst) cols.push({ key: "Bobst", label: "Bobst", d: comp.bobst });

  // LEGACY PARITY (spot_r1_5.jsx L6909): only render the panel when BOTH
  // CAD and Crest are viable. compareRoutes returns null when either route
  // fails (Crest envelope, board grade not Crest-eligible, etc.). For unstocked
  // grades like 275 DW B/C, Crest is typically not viable → panel hidden entirely.
  if (!comp || !comp.cad || !comp.crest) return null;

  return (
    <div data-testid="route-comparison" style={panelStyle("#22c55e")}>
      <div style={{ ...panelHeader("#22c55e"), cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)} data-testid="route-comparison-toggle">
        <span>Route Comparison{qty ? ` — Qty ${fmtInt(qty)}` : ""}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {winner && (
            <span data-testid="route-winner-badge"
              style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                background: winnerBadgeColor + "18", color: winnerBadgeColor }}>
              {winner} wins
            </span>
          )}
          <span style={{ fontSize: 11, transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform .15s" }}>▸</span>
        </span>
      </div>
      {open && (
        <div style={{ padding: "8px 10px", fontSize: 12 }}>
          {busy && !comp ? (
            <div style={{ color: "var(--spot-text3)" }}>Computing…</div>
          ) : !comp || cols.length === 0 ? (
            <div style={{ color: "var(--spot-text3)" }}>Enter dimensions, board, and quantity.</div>
          ) : (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ color: "var(--spot-text)", fontWeight: 700 }}>
                    <th style={{ textAlign: "left", padding: "2px 4px" }}></th>
                    {cols.map((c) => (
                      <th key={c.key} style={{ textAlign: "right", padding: "2px 4px" }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ color: "var(--spot-text2)" }}>
                  <CmpRow label="Sheet" cols={cols} get={(d) => (d.sheetW && d.sheetL) ? `${fmtDim(d.sheetW)}×${fmtDim(d.sheetL)}` : "—"} />
                  <CmpRow label="Layout" cols={cols} get={(d) => d.pcsPerSheet ? `${d.pcsPerSheet} out` : "—"} />
                  <CmpRow label="Sheets" cols={cols} get={(d) => d.sheetsReq ? fmtInt(d.sheetsReq) : "—"} />
                  <CmpRow label="" cols={cols} get={() => ""} sep />
                  <CmpRow label="Board" cols={cols} get={(d) => d.board ? fmtMoney(d.board) : "—"} />
                  <CmpRow label="Press" cols={cols} get={(d) => d.press ? fmtMoney(d.press) : "—"} />
                  <CmpRow label="Cutting" cols={cols} get={(d) => d.cut ? (
                    <span>{fmtMoney(d.cut)} <span style={{ color: "var(--spot-text3)" }}>({fmtNum(d.hrs, 1)}h)</span></span>
                  ) : "—"} />
                  <CmpRow label="Die" cols={cols} get={(d) => d.die ? (
                    <span>{fmtMoney(d.die)} {d.dieEstimated ? <span style={{ color: "var(--spot-text3)", fontStyle: "italic" }}>(est.)</span> : ""}</span>
                  ) : "—"} />
                  <CmpRow label="" cols={cols} get={() => ""} sep />
                  <CmpRow label="Total" cols={cols} bold get={(d, idx) => (
                    <span style={{ color: cols[idx].key === winner ? "var(--spot-green)" : "var(--spot-text)" }}>
                      {d.totalCost ? fmtMoney(d.totalCost) : "—"}
                    </span>
                  )} />
                  <CmpRow label="Per piece" cols={cols} get={(d) => (d.totalCost && qty) ? fmtMoney(d.totalCost / qty) : "—"} />
                </tbody>
              </table>

              {/* Verdict + breakeven + notes — 1:1 legacy spot_r1_5.jsx L6945-6964 */}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--spot-line)", fontSize: 12 }}>
                {(() => {
                  const totals = [{ n: "CAD", v: comp.cad.totalCost }, { n: "Crest", v: comp.crest.totalCost }];
                  if (comp.bobst) totals.push({ n: "Bobst", v: comp.bobst.totalCost });
                  totals.sort((a, b) => a.v - b.v);
                  const diff = Math.abs(totals[0].v - totals[1].v);
                  return (
                    <div style={{ fontWeight: 700, color: "var(--spot-green)", marginBottom: 2 }}>
                      {diff < 1 ? "Routes are equal at this quantity"
                        : `${totals[0].n} is ${fmtMoney(diff)} cheaper than ${totals[1].n} at ${fmtInt(qty)} pcs`}
                    </div>
                  );
                })()}
                {comp.breakeven?.qty > 0 && (
                  <div style={{ color: "var(--spot-text2)", marginBottom: 2 }}>
                    {winner === "CAD"
                      ? `Crest breaks even at ${fmtInt(comp.breakeven.qty)} pcs`
                      : `CAD wins below ${fmtInt(comp.breakeven.qty)} pcs`}
                  </div>
                )}
                {comp.breakeven && (
                  <div style={{ color: "var(--spot-text3)" }}>Crest wins if die {"<"} {fmtMoney(comp.breakeven.die)}</div>
                )}
                {comp.cadSaberNeeded && (
                  <div style={{ color: "#f59e0b", fontWeight: 600, marginTop: 4 }}>
                    ⚠ CAD sheet exceeds Crest max — Saber needed to switch routes later
                  </div>
                )}
                {comp.crest?.isStock && !comp.cad?.isStock && (
                  <div style={{ color: "var(--spot-green)", marginTop: 2 }}>✓ Crest path uses stock sheets</div>
                )}
                {!comp.bobst && comp.bobstReason && (
                  <div style={{ color: "var(--spot-text3)", marginTop: 2, fontStyle: "italic" }}>
                    Bobst not viable: {comp.bobstReason}
                  </div>
                )}
                {comp.bobst?.isMillMinScaled && (
                  <div style={{ color: "#a855f7", marginTop: 2, fontStyle: "italic" }}>
                    Bobst pays mill min — actual sheets {fmtInt(comp.bobst.sheetsReq)}, billed {fmtInt(comp.bobst.minBuySheets || 0)}
                  </div>
                )}
              </div>

              {/* Action buttons — 1:1 legacy spot_r1_5.jsx L6966-6980 */}
              {forced ? (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700,
                    color: forcedRoute === "CAD" ? "var(--spot-green)" : forcedRoute === "Bobst" ? "#a855f7" : "#3b82f6" }}
                    data-testid="route-forced-label">
                    ✓ Route forced to {forcedRoute}
                  </span>
                  <button onClick={resetToAuto} data-testid="route-switch-auto"
                    style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                      padding: "5px 10px", borderRadius: 4, border: "1px solid var(--spot-line)",
                      color: "var(--spot-text3)", background: "var(--spot-bg2)" }}>
                    Reset to Auto
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <button onClick={switchToCrest} data-testid="route-switch-crest"
                    style={{ all: "unset", cursor: "pointer", flex: 1, textAlign: "center", fontSize: 11,
                      fontWeight: 700, padding: "5px 0", borderRadius: 4, border: "1px solid #3b82f644",
                      color: "#3b82f6", background: "#3b82f60a" }}>Switch to Crest</button>
                  <button onClick={switchToCad} data-testid="route-switch-cad"
                    style={{ all: "unset", cursor: "pointer", flex: 1, textAlign: "center", fontSize: 11,
                      fontWeight: 700, padding: "5px 0", borderRadius: 4, border: "1px solid #22c55e44",
                      color: "#22c55e", background: "#22c55e0a" }}>Switch to CAD</button>
                  {comp.bobst && (
                    <button onClick={switchToBobst} data-testid="route-switch-bobst"
                      style={{ all: "unset", cursor: "pointer", flex: 1, textAlign: "center", fontSize: 11,
                        fontWeight: 700, padding: "5px 0", borderRadius: 4, border: "1px solid #a855f744",
                        color: "#a855f7", background: "#a855f70a" }}>Switch to Bobst</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CmpRow({ label, cols, get, bold, sep }) {
  if (sep) return (
    <tr><td colSpan={cols.length + 1}>
      <div style={{ borderTop: "1px solid var(--spot-line)", margin: "4px 0" }} />
    </td></tr>
  );
  return (
    <tr>
      <td style={{ padding: "2px 4px", color: "var(--spot-text3)" }}>{label}</td>
      {cols.map((c, i) => (
        <td key={c.key} style={{
          textAlign: "right", padding: "2px 4px",
          fontWeight: bold ? 700 : 500,
        }}>{get(c.d, i)}</td>
      ))}
    </tr>
  );
}

function EconomicsPanel({ s, result, aggregate, isMultiPart, activeItemIdx }) {
  const r = result || {};
  const agg = aggregate || {};
  const bom = Array.isArray(s.bomItems) ? s.bomItems : [];
  const activeItem = isMultiPart ? (bom[activeItemIdx] || null) : null;
  const itemType = activeItem?.type || "Manufactured";
  const isMatchedSet = isMultiPart && (s.pricingMode === "Matched Set");
  const setMarginOverride = !!s.setMarginOverride;
  // ── D-070 Board substitution banner (verbatim legacy spot_r1_5.jsx L6992-6995) ──
  // Shows when the engine selected a fallback (gradeFallback or mediumFallback).
  // States: needs-decision (orange) / accepted (green) / forced (blue).
  // Forced = "Spec'd board — custom order" per user spec ("i Spec'd board - custom order in blue").
  const hasBoardFb = !!(r?.gradeFallback || r?.mediumFallback);
  const boardSub = s.boardSubstitution;
  const subBgColor = boardSub === "accepted" ? "#22c55e18"
    : boardSub === "forced" ? "#3b82f618" : "#f59e0b18";
  const subBorderColor = boardSub === "accepted" ? "#22c55e33"
    : boardSub === "forced" ? "#3b82f633" : "#f59e0b33";
  const subTextColor = boardSub === "accepted" ? "#22c55e"
    : boardSub === "forced" ? "#3b82f6" : "#f59e0b";
  const subLabel = boardSub === "accepted" ? "✓ Stock substitution approved"
    : boardSub === "forced" ? "ℹ Spec'd board — custom order"
    : "⚠ Board substitution — decision needed";
  const subSuffix = (r?.gradeFallback && !boardSub)
    ? ` — ${r.gradeFallback}# meets ${s.boardGrade} spec`
    : "";
  // Aggregate row carries the Matched Set / job-level totals when present.
  const hasMatchedSetTotals = isMatchedSet && agg && !agg.error
    && (agg.setSell != null || agg.jobSell != null);
  const isFulfillment = isMultiPart && itemType === "Fulfillment";
  const typeBadge = itemType === "Fulfillment" ? "FUL"
    : itemType === "Purchased" ? "PUR"
    : isMultiPart ? "MFG" : null;
  const typeColor = itemType === "Fulfillment" ? "#f59e0b"
    : itemType === "Purchased" ? "#3b82f6" : "#22c55e";
  const sectionLabel = isMatchedSet ? "Active Component" : isMultiPart ? "Item" : null;
  const itemName = isMultiPart
    ? (activeItem?.desc || `Item ${activeItemIdx + 1}`)
    : (s.itemDesc || "Item");
  return (
    <div data-testid="economics-panel" style={panelStyle("#a855f7")}>
      <div style={panelHeader("#a855f7")}>
        <span>Economics{r.qty ? ` · QTY ${fmtInt(r.qty)}` : ""}</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        {/* D-070 Board substitution banner (legacy spot_r1_5.jsx L6992-6995) */}
        {hasBoardFb && (
          <div data-testid="econ-board-sub-banner"
            style={{
              padding: "4px 8px", marginBottom: 6, borderRadius: 4,
              background: subBgColor, border: `1px solid ${subBorderColor}`,
              fontSize: 11, fontWeight: 700, color: subTextColor,
              textAlign: "center",
            }}>
            {subLabel}{subSuffix}
          </div>
        )}
        {!result || result.error ? (
          <div style={{ color: "var(--spot-text3)", fontSize: 12 }}>
            {result?.error || "Enter dimensions, board, and at least one quantity."}
          </div>
        ) : (
          <>
            {/* ─── MATCHED SET TOP BLOCK ─────────────────────────────────── */}
            {hasMatchedSetTotals && (() => {
              const setQty = agg.setQty || agg.qty || 0;
              // Legacy parity: big metric is SELL TOTAL = merchandise sell.
              // Below: "Line Charges: $X  Quote Total: $Y" breakdown.
              const projectSell = agg.jobSell ?? agg.sellTotal ?? 0;
              const projectCost = agg.jobCost ?? agg.totalMfg ?? 0;
              const lineCharges = Math.max(0, (agg.sellTotal || projectSell) - projectSell);
              const projectQuoteTotal = projectSell + lineCharges;
              const gmDollar = projectSell - projectCost;
              const gmPct = projectSell > 0 ? gmDollar / projectSell : 0;
              const sellPerSet = setQty > 0 ? projectSell / setQty : 0;
              const costPerSet = setQty > 0 ? projectCost / setQty : 0;
              return (
                <div data-testid="econ-matched-set" style={{
                  padding: "4px 0 8px", marginBottom: 6,
                  borderBottom: "1px solid var(--spot-line)",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    marginBottom: 4,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: "#f59e0b",
                      textTransform: "uppercase", letterSpacing: ".06em",
                    }}>
                      Matched Set{setMarginOverride ? " (Override)" : ""}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>
                      {fmtInt(setQty)} <span style={{ fontSize: 11, fontWeight: 600, color: "var(--spot-text3)" }}>sets</span>
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
                    <Metric label="Sell Total" value={fmtMoney(projectSell)} big className="green" testid="econ-set-sell" />
                    <Metric label="Sell / Set" value={fmtMoney(sellPerSet)} big testid="econ-set-sell-per" />
                    <Metric label="Margin %"  value={fmtPct(gmPct, 1)} className="green" testid="econ-set-gm-pct" />
                    <Metric label="Margin $"  value={fmtMoney(gmDollar)} testid="econ-set-gm-dol" />
                    <Metric label="Total Cost" value={fmtMoney(projectCost)} testid="econ-set-cost" />
                    <Metric label="Cost / Set" value={fmtMoney(costPerSet)} testid="econ-set-cost-per" />
                  </div>
                  {/* Always show Line Charges + Quote Total breakdown, even when $0,
                      so the estimator can verify the value. */}
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--spot-text2)", fontStyle: "italic", paddingTop: 3 }} data-testid="econ-set-line-charges">
                    <span>Line Charges: <b style={{ color: "var(--spot-text)", fontStyle: "normal" }} data-testid="econ-set-line-charges-value">{fmtMoney(lineCharges)}</b></span>
                    <span style={{ fontStyle: "normal" }}>
                      <span style={{ fontStyle: "italic", color: "var(--spot-text2)" }}>Quote Total: </span>
                      <b style={{ color: "var(--spot-accent)" }} data-testid="econ-set-quote-total">{fmtMoney(projectQuoteTotal)}</b>
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* ─── ITEM / ACTIVE COMPONENT HEADER ─────────────────────────── */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                {sectionLabel && (
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: isMatchedSet ? "#f59e0b" : "var(--spot-accent)",
                    textTransform: "uppercase", letterSpacing: ".06em",
                  }}>{sectionLabel}</span>
                )}
                {typeBadge && (
                  <span data-testid="econ-type-badge" style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 5px", borderRadius: 3,
                    background: `${typeColor}22`, color: typeColor, flexShrink: 0,
                  }}>{typeBadge}</span>
                )}
                {isMultiPart && (s.estNum || s.custIdent) && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--spot-text3)", flexShrink: 0 }}>
                    -{activeItemIdx + 1}
                  </span>
                )}
                <span style={{
                  fontSize: 13, fontWeight: 700, color: "var(--spot-text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{itemName}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-accent)", whiteSpace: "nowrap" }}>
                {fmtInt(r.qty)} <span style={{ fontSize: 11, fontWeight: 600, color: "var(--spot-text3)" }}>pcs</span>
              </span>
            </div>
            {isFulfillment && (
              <div data-testid="econ-fulfillment-label" style={{
                padding: "2px 0", fontSize: 11, fontWeight: 700, color: "#f59e0b",
                textTransform: "uppercase", letterSpacing: ".06em",
              }}>Fulfillment — Cost Only</div>
            )}

            {/* ─── SELL ROW with optional line-item breakdown ──────────────── */}
            <div style={{ opacity: isFulfillment ? 0.5 : 1, paddingBottom: 6, borderBottom: "1px solid var(--spot-line)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Metric label="Sell Total" value={fmtMoney(r.itemSell)} big className="green" testid="metric-sell-total" />
                {/* Sell/Pc reflects ORDER total / qty (legacy spot_engine.js
                    L838: sellPc = sellTotal/ordQty) so a $1,380 die on a
                    2,500-pc job makes Sell/Pc = $1.27, not $0.72. */}
                <Metric label="Sell / Pc"  value={fmtMoney(r.sellPc, 2)} big testid="metric-sell-pc" />
              </div>
              {(() => {
                const dieSep = !!r.dieSep && (r.dieLineCost || 0) > 0;
                const freightSep = !!r.freightSep && (r.freightLine || 0) > 0;
                const prepressSep = !!r.prepressSep && (r.prepressLineCost || 0) > 0;
                const proofSep = !!r.proofSep && (r.proofLineCost || 0) > 0;
                const miscSep = (r.miscLineCost || 0) > 0;
                const hasAnyLine = dieSep || freightSep || prepressSep || proofSep || miscSep;
                if (!hasAnyLine) {
                  return (
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--spot-text3)" }}>
                      Freight: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(r.freightLine || 0)}</b>
                      {" · "}Order: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(r.sellTotal)}</b>
                    </div>
                  );
                }
                return (
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--spot-text2)", fontStyle: "italic", paddingTop: 4, flexWrap: "wrap" }}>
                    {freightSep && <span>Freight: {fmtMoney(r.freightLine)}</span>}
                    {prepressSep && <span>Prepress: {fmtMoney(r.prepressLineCost)}</span>}
                    {proofSep && <span>Proofs: {fmtMoney(r.proofLineCost)}</span>}
                    {(r.miscLineItems || []).filter((li) => (li.amt || 0) > 0).map((li, mi) => (
                      <span key={`econ-mli-${mi}`}>{li.name || "Misc"}: {fmtMoney(li.amt)}</span>
                    ))}
                    {dieSep && <span>Die: {fmtMoney(r.dieLineCost)}</span>}
                    <span style={{ fontWeight: 700, color: "var(--spot-accent)", fontStyle: "normal" }}>
                      Order: {fmtMoney(r.sellTotal)}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* ─── MARGIN + COST GRID ──────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "6px 0",
              borderBottom: "1px solid var(--spot-line)", opacity: isFulfillment ? 0.5 : 1 }}>
              <Metric label="Margin %"  value={fmtPct(r.gmPct, 1)} className="green" testid="metric-gm-pct" />
              <Metric label="Margin $"  value={fmtMoney(r.gmDollar)} className="green" testid="metric-gm-dollar" />
              <Metric label="Total Cost" value={fmtMoney(r.totalMfg)} testid="metric-total-cost" />
              <Metric label="Cost / Pc"  value={fmtMoney(r.costPc, 2)} testid="metric-cost-pc" />
              <Metric label="Sell / MSF" value={fmtMoney(r.sellMSF, 2)} testid="metric-sell-msf" />
              <Metric label="Cost / MSF" value={fmtMoney(r.costMSF, 2)} testid="metric-cost-msf" />
            </div>

            {/* ─── PRODUCTION ROW ──────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, paddingTop: 6 }}>
              <Metric label="Sheets" value={fmtInt(r.sheetsReq)} small testid="metric-sheets" />
              <Metric label="Pcs/Sh" value={fmtInt(r.pcsPerSheet)} small testid="metric-pcs-sh" />
              <Metric label="MSF"    value={fmtNum(r.oMSF, 2)} small testid="metric-msf" />
              <Metric label="Tier"   value={r.msfTier || "—"} small testid="metric-tier" />
            </div>

            {/* ─── ROUTING PILLS ───────────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              {(s.printReq === "Yes" || s.printReq === "On") && <span className="sp-pill" style={{ color: "#3b82f6", background: "#3b82f622", borderColor: "#3b82f655" }}>Print {labelize(s.printMode)}</span>}
              {r.route && <span className="sp-pill" style={{ color: "#22c55e", background: "#22c55e22", borderColor: "#22c55e55" }}>Cut {(r.route === "Saber + D/C" && s.saber !== "Yes") ? "CAD" : r.route} {labelize(s.cadDifficulty)}</span>}
              {s.saber === "Yes" && <span className="sp-pill" data-testid="pill-saber-on" style={{ color: "#14b8a6", background: "#14b8a622", borderColor: "#14b8a655" }}>Saber On</span>}
              {s.handGluing === "Yes" && <span className="sp-pill" style={{ color: "#3b82f6", background: "#3b82f622", borderColor: "#3b82f655" }}>Gluing {labelize(s.gluingComplexity)}</span>}
              {s.tape === "Yes" && <span className="sp-pill" style={{ color: "#3b82f6", background: "#3b82f622", borderColor: "#3b82f655" }}>Tape {labelize(s.tapeType || "Clear")}</span>}
              {s.handStripping === "Yes" && <span className="sp-pill" style={{ color: "#f59e0b", background: "#f59e0b22", borderColor: "#f59e0b55" }}>Strip {labelize(s.strippingComplexity)}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CostBuildup({ result, isMultiPart, aggregate, s }) {
  const [view, setView] = useState("summary"); // summary | detail
  if (!result || result.error) return null;
  const r = result;
  const detail = view === "detail";
  const spoilSheets = r.extraSheets || 0;

  // ─── Multi-Part empty state ──────────────────────────────────────────
  // When the active BOM component lacks dims/specs, run_estimate returns
  // no breakdown fields (matTotal, totalDirect, sheetW, etc). Show a
  // helpful empty state rather than a wall of dashes.
  const hasBreakdown = (r.matTotal != null && r.matTotal > 0) ||
                       (r.totalDirect != null && r.totalDirect > 0) ||
                       (r.sheetW && r.sheetL);
  if (!hasBreakdown) {
    return (
      <div data-testid="cost-buildup-empty" style={panelStyle("#06b6d4")}>
        <div style={panelHeader("#06b6d4")}><span>Cost Buildup</span></div>
        <div style={{ padding: "14px 12px", fontSize: 11, color: "var(--spot-text3)",
          lineHeight: 1.55 }}>
          <div style={{ fontWeight: 700, color: "var(--spot-text2)", marginBottom: 4 }}>
            No breakdown yet for the active component
          </div>
          This BOM component needs <b>One-Up Width / Length</b> and a <b>board spec</b>
          (flute · grade · liners) before the engine can price the material, print, cutting,
          and finishing detail.
          <div style={{ marginTop: 8, padding: "5px 8px", background: "var(--spot-bg)",
            borderRadius: 3, color: "var(--spot-text3)", fontSize: 10 }}>
            Tip: pick the component tab above, then fill the Item Setup section.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="cost-buildup" style={panelStyle("#06b6d4")}>
      <div style={panelHeader("#06b6d4")}>
        <span>Cost Buildup</span>
        <span style={{ display: "flex", gap: 4 }}>
          <Tile label="Summary" active={view === "summary"} onClick={() => setView("summary")} small data-testid="cb-tab-summary" />
          <Tile label="Detail"  active={view === "detail"}  onClick={() => setView("detail")}  small data-testid="cb-tab-detail" />
        </span>
      </div>
      <div style={{ padding: "8px 10px", fontSize: 12 }}>
        <SubHead label="Direct Production" color="var(--spot-green)" />
        {/* Material header rolls up base board + MR/Spoil makeready so it sums
            its sub-lines (matches the Print pattern AND the Cost Report modal,
            which uses matTotal + matMakeready). */}
        <Row label="Material" value={fmtMoney((r.matTotal || 0) + (r.matMakeready || 0))} />
        {detail && (
          <SubRow label={`Board ${r.msfTier || "—"} tier, ${fmtMoney(r.matPerMsf || r.boardEffRate)}/MSF`} value={fmtMoney(r.matTotal)} />
        )}
        {detail && (r.matMakeready > 0) && (
          <SubRow label={`MR/Spoil Board ${spoilSheets} extra sheets`} value={fmtMoney(r.matMakeready)} />
        )}
        {/* Print row — hide entirely when print is off (Bug H). Press + Ink are
            the components of Print, so they belong UNDER the Print header. */}
        {r.printDirect > 0 && (
          <Row label="Print"    value={fmtMoney(r.printDirect)} />
        )}
        {detail && r.pressHrs > 0 && (
          <SubRow label={`Press ${fmtNum(r.pressHrs, 1)}h @ ${fmtMoney(r.incaRate)}/hr`} value={fmtMoney(r.pressCost)} />
        )}
        {detail && r.inkCost > 0 && (
          <SubRow label={`Ink ${fmtInt(r.inkSqFt)} sqft @ ${fmtMoney(r.inkRate, 2)}/sqft`} value={fmtMoney(r.inkCost)} />
        )}
        {/* White Ink + Side 2 Print — components of Print, legacy parity
            (spot_r1_5.jsx L7124-7125). Without these the Detail sub-lines
            (Press + Ink) don't reconcile to the Print header on 2-sided /
            white-ink jobs. */}
        {detail && (r.whiteCost || 0) > 0 && (
          <SubRow
            label={`White Ink ${fmtPct((r.matTotal + r.inkCost + r.pressCost) > 0 ? r.whiteCost / (r.matTotal + r.inkCost + r.pressCost) : 0, 0)} of mat+ink+press`}
            value={fmtMoney(r.whiteCost)} />
        )}
        {detail && (r.side2Cost || 0) > 0 && (
          <SubRow
            label={`Side 2 print ${fmtPct((r.pressCost + r.inkCost + r.whiteCost) > 0 ? r.side2Cost / (r.pressCost + r.inkCost + r.whiteCost) : 0, 0)} of side 1`}
            value={fmtMoney(r.side2Cost)} />
        )}
        <Row label="Cutting" value={fmtMoney((r.cutterDirect || 0) + (r.saberCost || 0))} />
        {detail && (r.saberCost || 0) > 0 && (
          <SubRow label={`Saber @ ${fmtMoney(r.saberRate || 2)}/hr`} value={fmtMoney(r.saberCost)} />
        )}
        {detail && r.cutterDirect > 0 && (
          <SubRow label={r.cutterBasis ? `${r.route} ${r.cutterBasis}` : `${r.route} ${labelize(r.cadDifficulty || "Standard")}`}
            value={fmtMoney(r.cutterDirect)} />
        )}
        {/* Finishing = Stripping + Assembly (legacy spot_r1_5.jsx L7106, Bug B) */}
        <Row label="Finishing" value={fmtMoney((r.stripCost || 0) + (r.assemblyCost || 0))} />
        {detail && (r.stripCost || 0) > 0 && (
          <SubRow label={`Stripping ${labelize(s.strippingComplexity || "Standard")}${s.perimeterStripping === "Yes" ? " + edge" : ""} @ $17.00/hr`} value={fmtMoney(r.stripCost)} />
        )}
        {detail && r.assemblyCost > 0 && (
          <SubRow label={s.tape === "Yes"
            ? `Tape ${s.tapeType === "Clear" ? "Film" : s.tapeType === "Reinforced" ? "Foam" : (s.tapeType || "Film")} · ${s.tapeStrips || 1} strip${Number(s.tapeStrips) === 1 ? "" : "s"} × ${s.tapeStripLength || 0}"`
            : `Glue ${labelize(s.gluingComplexity || "Standard")}, ${s.jointsPerPiece || 1} jt @ $23.00/hr`}
            value={fmtMoney(r.assemblyCost)} />
        )}
        <RowTotal label="Total Direct" value={fmtMoney(r.totalDirect)} />

        <SubHead label="Indirect" color="#f59e0b" />
        <Row label={`Overhead ${detail ? `${fmtPct(0, 0)}` : ""}`} value={fmtMoney(r.overhead)} />
        <Row label={
          <span style={{ fontStyle: "italic" }}>
            Prepress amort.{detail && r.prepressEmbedded > 0 ? <span style={{ color: "var(--spot-text3)" }}> {fmtMoney(r.prepressEmbedded)}, no OH/GM</span> : ""}
          </span>
        } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.prepressEmbedded)}</span>} />
        {(r.proofEmbedded || 0) > 0 && (
          <Row label={
            <span style={{ fontStyle: "italic" }}>
              Proofs amort.{detail ? <span style={{ color: "var(--spot-text3)" }}> {fmtMoney(r.proofEmbedded)}, no OH/GM</span> : ""}
            </span>
          } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.proofEmbedded)}</span>} />
        )}
        {/* Hide Die row in Indirect when no embedded die — legacy parity:
            legacy doesn't render a "Die: None" line in the Indirect section.
            Embedded die only appears when treatment is Amortize and engine
            computed an embedded portion. Otherwise dies show as One-Time
            Line Items below. */}
        {(r.dieEmbedded || 0) > 0 && (
          <Row label={<span style={{ fontStyle: "italic" }}>Die</span>}
            value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.dieEmbedded)}</span>} />
        )}
        {(r.freightEmbed || 0) > 0 && (
          <Row label={<span style={{ fontStyle: "italic" }}>Freight (embed)</span>}
            value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.freightEmbed)}</span>} />
        )}
        <RowTotal label="Total Cost" value={fmtMoney(r.totalMfg)} />

        <SubHead label="Pricing" color="var(--spot-purple)" />
        <Row label={<span>Margin <span style={{ color: "var(--spot-text3)" }}>{fmtPct(r.gmPct, 1)} of sell</span></span>} value={fmtMoney(r.gmDollar)} />
        <RowTotal label="Sell Total" value={fmtMoney(r.itemSell)} />
        <Row label={<span>Sell/Pc <span style={{ color: "var(--spot-text3)" }}>{fmtInt(r.qty)} pcs</span></span>}
          value={fmtMoney(r.sellPc, 2)} />

        {(() => {
          // Cost Buildup is COMPONENT-SCOPED by default (every line shows the
          // ACTIVE component's costs). EXCEPTION: in MP Per-Job mode freight is
          // a JOB-level charge, so the One-Time Line Items section mirrors the
          // job rollup (Items = job sell, Freight = full per-job freight for the
          // selected tier, Quote Total = order total) — matching the Quote Table
          // footer. Otherwise it stays component-scoped.
          const isMpPerJob = isMultiPart && s?.freightScope === "Per Job";
          const src = isMpPerJob ? (aggregate || r) : r;
          const freight = src.freightLine || 0;
          const die = src.dieLineCost || 0;
          const prepress = src.prepressLineCost || 0;
          const proof = src.proofLineCost || 0;
          const misc = src.miscLineCost || 0;
          const itemsSell = src.itemSell || 0;
          const grandTotal = src.sellTotal || (itemsSell + freight + die + prepress + proof + misc);
          const hasAnyLine = freight > 0 || die > 0 || prepress > 0 || proof > 0 || misc > 0;
          return (
            <>
              {hasAnyLine && (
                <>
                  <SubHead label="One-Time Line Items" color="#3b82f6" />
                  {isMultiPart && (
                    <Row label={<span style={{ color: "var(--spot-text3)" }}>Items{isMpPerJob ? " (job)" : ""}</span>}
                      value={<span style={{ color: "var(--spot-text3)" }}>{fmtMoney(itemsSell)}</span>} />
                  )}
                  {freight > 0 && (() => {
                // Distinct label & breakdown for Local Delivery — make it
                // unmistakable on the customer-facing cost buildup.
                const isLocal = isLocalCarrier(s?.freightCarrier) || s?.quoteFOB === "LocalDelivery";
                const zone = s?.localDeliveryZone || "";
                const freightLabel = isLocal
                  ? `Freight — Local Delivery${zone ? ` · ${zone}` : ""}`
                  : (isMpPerJob ? "Freight (per-job)" : "Freight");
                // freight already includes markup; derive the pre-markup base.
                const markupPct = isLocal
                  ? 0
                  : (isMpPerJob
                      ? Number(s?.freightMarkup || 0)
                      : Number(s?.freightMarkup || r.freightMarkup || 0));
                const baseCost = isMpPerJob
                  ? (markupPct > 0 ? freight / (1 + markupPct) : freight)
                  : Number(s?.freightCost || r.freightCost || 0);
                const showBreakdown = baseCost > 0;
                return (
                  <Row label={
                    <span style={{ fontStyle: "italic" }}>
                      {freightLabel}
                      {showBreakdown && (
                        <span style={{ color: "var(--spot-text3)" }}>
                          {" "}{fmtMoney(baseCost)} + {(markupPct * 100).toFixed(0)}% markup
                        </span>
                      )}
                      {isLocal && (
                        <span style={{ display: "block", color: "var(--spot-text3)", fontSize: 10, fontStyle: "italic", paddingLeft: 6, marginTop: 1 }}>
                          flat rate, no markup
                        </span>
                      )}
                    </span>
                  } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(freight)}</span>} />
                );
              })()}
              {prepress > 0 && (() => {
                const baseCost = isMpPerJob ? 0 : Number(s?.prepressCost || r.prepressCost || 0);
                const markupPct = Number(s?.prepressMarkup || r.prepressMarkup || 0);
                const showBreakdown = baseCost > 0 && markupPct > 0;
                return (
                  <Row label={
                    <span style={{ fontStyle: "italic" }}>
                      Prepress
                      {showBreakdown && (
                        <span style={{ color: "var(--spot-text3)" }}>
                          {" "}{fmtMoney(baseCost)} + {(markupPct * 100).toFixed(0)}% markup
                        </span>
                      )}
                    </span>
                  } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(prepress)}</span>} />
                );
              })()}
              {proof > 0 && (() => {
                const baseCost = isMpPerJob ? 0 : Number(s?.proofCost || r.proofCost || 0);
                const markupPct = Number(s?.proofMarkup || r.proofMarkup || 0);
                const showBreakdown = baseCost > 0 && markupPct > 0;
                return (
                  <Row label={
                    <span style={{ fontStyle: "italic" }}>
                      Proofs
                      {showBreakdown && (
                        <span style={{ color: "var(--spot-text3)" }}>
                          {" "}{fmtMoney(baseCost)} + {(markupPct * 100).toFixed(0)}% markup
                        </span>
                      )}
                    </span>
                  } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(proof)}</span>} />
                );
              })()}
              {/* Named misc items — one row per user-typed name, with markup */}
              {(() => {
                // Component-scoped by default; job-scoped in Per-Job mode.
                const miscItems = src.miscLineItems || [];
                const miscMarkup = Number(s?.miscMarkup || r.miscMarkup || 0);
                const miscCharges = s?.miscCharges || [];
                return miscItems.filter((li) => (li.amt || 0) > 0).map((li, mi) => {
                  const baseEntry = miscCharges.find((mc) => (mc.name || "") === (li.name || ""));
                  const baseCost = (!isMpPerJob && baseEntry) ? Number(baseEntry.cost || 0) : 0;
                  const showBreakdown = baseCost > 0 && miscMarkup > 0;
                  return (
                    <Row key={`mli-${mi}`} label={
                      <span style={{ fontStyle: "italic" }}>
                        {li.name || "Misc"}
                        {showBreakdown && (
                          <span style={{ color: "var(--spot-text3)" }}>
                            {" "}{fmtMoney(baseCost)} + {(miscMarkup * 100).toFixed(0)}% markup
                          </span>
                        )}
                      </span>
                    } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(li.amt)}</span>} />
                  );
                });
              })()}
              {/* Die is intentionally LAST among one-time line items (per estimator
                  convention) — only misc/other charges may follow it above the total. */}
              {die > 0 && (() => {
                const baseCost = isMpPerJob
                  ? Number(src.dieBaseTotal || 0)
                  : Number(s?.cuttingDieCost || r.cuttingDieCost || 0);
                const markupPct = isMpPerJob
                  ? Number(src.dieMarkupAvg || 0)
                  : Number(s?.dieMarkup || r.dieMarkup || 0);
                const showBreakdown = baseCost > 0 && markupPct > 0;
                return (
                  <Row label={
                    <span style={{ fontStyle: "italic" }}>
                      Die
                      {showBreakdown && (
                        <span style={{ color: "var(--spot-text3)" }}>
                          {" "}{fmtMoney(baseCost)} + {(markupPct * 100).toFixed(0)}% markup
                        </span>
                      )}
                    </span>
                  } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(die)}</span>} />
                );
              })()}
                  <RowTotal label={isMpPerJob ? "Quote Total (job)" : "Quote Total"} value={fmtMoney(grandTotal)} accent="var(--spot-purple)" />
                </>
              )}
              {!hasAnyLine && (
                <RowTotal label="Quote Total" value={fmtMoney(grandTotal)} accent="var(--spot-purple)" />
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function BoardPanel({ result, s }) {
  const { setField } = useQuote();
  const [open, setOpen] = useState(false);  // default COLLAPSED (legacy default)
  if (!result || result.error) return null;
  const r = result;
  const sheetLbl = (r.sheetW && r.sheetL) ? `${fmtDim(r.sheetW)}×${fmtDim(r.sheetL)}` : "—";
  const isStock = !!r?._pipeline?.stockMode;
  const isOverride = !!r?._pipeline?.overrideActive || !!r?.overrideActive || !!s?.overrideSheetId;
  const mode = isOverride ? "OVERRIDE" : (isStock ? "STOCK" : "ORDER");
  const modeColor = isOverride ? "var(--spot-purple)" : "var(--spot-text3)";
  const sqFt = Math.round(r.boardOSqFt || (r.oMSF * 1000));
  const wastePct = r.wastePct || 0;
  const hasBoard = !!(r.sheetW && r.sheetL && r.boardTotal > 0);

  if (!hasBoard) {
    return (
      <div data-testid="board-panel-empty" style={panelStyle("#a855f7")}>
        <div style={panelHeader("#a855f7")}>
          <span>Board — no sheet selected</span>
        </div>
        <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--spot-text3)" }}>
          Fill the active component's <b>One-Up dims + board spec</b> for sheet picking and
          board cost detail.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="board-panel" style={panelStyle("#a855f7")}>
      <div style={{ ...panelHeader("#a855f7"), cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)} data-testid="board-panel-toggle">
        <span>
          Board {sheetLbl} — <span style={{ color: modeColor }}>{mode}</span> {fmtMoney(r.boardTotal)}
        </span>
        <span style={{ fontSize: 11, transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform .15s" }}>▸</span>
      </div>
      {isOverride && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "5px 10px", background: "var(--spot-purple-bg)",
          borderBottom: "1px solid var(--spot-purple)" }} data-testid="board-override-banner">
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--spot-purple)",
            textTransform: "uppercase", letterSpacing: ".06em" }}>
            User Override · Route pinned to CAD
          </span>
          <button onClick={(e) => { e.stopPropagation(); setField("overrideSheetId", null); }}
            data-testid="board-override-clear"
            style={{ all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
              color: "var(--spot-err)", padding: "1px 6px",
              border: "1px solid var(--spot-err)", borderRadius: 3 }}>
            Clear
          </button>
        </div>
      )}
      {open && (
        <div style={{ padding: "8px 10px", fontSize: 12 }}>
          <Row label="Sq Ft" value={fmtInt(sqFt)} />
          <Row label="MSF" value={fmtNum(r.oMSF, 4)} />
          <Row label="Tier" value={r.msfTier || "—"} />
          <Row label={<b>Base</b>} value={<b>{fmtMoney(r.boardBase)}</b>} />
          <Row label={<b>Eff Rate</b>} value={<b>{fmtMoney(r.boardEffRate)}</b>} />
          <Row label="FSC" value={fmtMoney(r.boardFscAmt || 0)} />
          <Row label="Setup" value={fmtMoney(r.boardSetup || 0)} />
          <Row label="Pallet" value={fmtMoney(r.boardPp || 0)} />
          <RowTotal label="Board PO" value={fmtMoney(r.boardTotal)} />
          <Row label="Waste" value={fmtPct(wastePct, 1)} />
        </div>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────
const panelStyle = (hue) => ({ borderTop: `1px solid var(--spot-line)`, background: "var(--spot-bg2)" });
const panelHeader = (hue) => ({
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "6px 10px", fontSize: 12, fontWeight: 800,
  textTransform: "uppercase", letterSpacing: ".06em",
  color: hue, background: `${hue}11`, borderLeft: `3px solid ${hue}`,
});
const rowSpaced = { display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" };
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--spot-text3)", textTransform: "uppercase", letterSpacing: ".05em", minWidth: 44 };
function labelize(s) { return (s || "").replace("Standard", "Std").replace("OnQ Lightbox", "OnQ LB").replace("OnQ Styrene", "OnQ Sty"); }

function Metric({ label, value, big, small, className, testid }) {
  return (
    <div className="sp-metric" data-testid={testid}>
      <div className="sp-metric-lbl">{label}</div>
      <div className={`sp-metric-val ${big ? "lg" : ""} ${className || ""}`}>{value}</div>
    </div>
  );
}
function SubHead({ label, color }) {
  return <div style={{
    fontSize: 10, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: ".08em",
    borderBottom: `1px solid ${color}33`, paddingBottom: 4, marginTop: 8, marginBottom: 4,
  }}>{label}</div>;
}
function RowInline({ main, sub }) {
  return <span>{main} <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>{sub}</span></span>;
}
function SubRow({ label, value }) {
  return <div style={{
    display: "flex", justifyContent: "space-between", padding: "1px 0 1px 14px",
    color: "var(--spot-text3)", fontSize: 11,
  }}>
    <span>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>;
}
function Row({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: "var(--spot-text2)" }}>
    <span>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>;
}
function RowTotal({ label, value, accent }) {
  return <div style={{
    display: "flex", justifyContent: "space-between", padding: "4px 0",
    fontWeight: 700, color: accent || "var(--spot-text)", borderTop: "1px solid var(--spot-line)",
  }}>
    <span>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>;
}
