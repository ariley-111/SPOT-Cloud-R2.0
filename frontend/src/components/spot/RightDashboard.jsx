/* eslint-disable */
import React, { useState, useEffect } from "react";
import { useQuote } from "../../context/QuoteContext";
import { useEngine } from "../../hooks/useEngine";
import { freightQuote, compareRoutes } from "../../api/spot";
import Tile from "./Tile";
import { fmtMoney, fmtInt, fmtPct, fmtNum } from "../../lib/format";
import ProgressModal from "./ProgressModal";

export default function RightDashboard() {
  const { active } = useQuote();
  const s = active?.state || {};
  const { results, perComponent, isMultiPart } = useEngine(s);
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
  const primary = isMultiPart ? (itemResult || aggregate) : aggregate;

  return (
    <div data-testid="right-dashboard" style={{
      width: 360, flexShrink: 0, overflow: "auto",
      background: "var(--spot-bg2)", borderLeft: "1px solid var(--spot-line)",
      display: "flex", flexDirection: "column",
      paddingBottom: 80,  // keep last row clear of the "Made with Emergent" badge
    }}>
      <FreightPanel s={s} />
      <RouteComparison s={s} primary={primary} />
      <EconomicsPanel s={s} result={primary} aggregate={aggregate} isMultiPart={isMultiPart} activeItemIdx={activeItemIdx} />
      <CostBuildup result={primary} isMultiPart={isMultiPart} aggregate={aggregate} />
      <BoardPanel result={primary} s={s} />
    </div>
  );
}

function FreightPanel({ s }) {
  const { setField, setManyFields, pushToast } = useQuote();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const updateFreight = async () => {
    if (!s.destZip) { setErr("Need ship-to ZIP first"); return; }
    setBusy(true); setErr("");
    try {
      const r = await freightQuote({ destZip: s.destZip, weightLbs: 1000, freightClass: "70" });
      setManyFields({
        freightCost: String(r.totalAmount), quoteFOB: "Destination",
        freightTreatment: s.freightTreatment === "None" ? "Separate Line" : s.freightTreatment,
      });
      pushToast(`Freight ${fmtMoney(r.totalAmount)} · ${r.carrier}`, "ok");
    } catch (e) { setErr(e?.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <ProgressModal open={busy} accent="#f59e0b"
        title="Getting Freight Quote"
        subtitle={`Calling UTS · ${s.destZip || ""}`} />
    <div data-testid="freight-panel" style={panelStyle("#f59e0b")}>
      <div style={panelHeader("#f59e0b")}>🚚 Freight</div>
      <div style={{ padding: "8px 10px" }}>
        <div style={rowSpaced}>
          <span style={lbl}>FOB</span>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="Will-Call" active={s.quoteFOB === "Origin"}      onClick={() => setField("quoteFOB", "Origin")}      small data-testid="tile-fob-willcall" />
            <Tile label="Ship"      active={s.quoteFOB === "Destination"} onClick={() => setField("quoteFOB", "Destination")} small tint="#3b82f6" data-testid="tile-fob-ship" />
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
                  <Tile label="None"     active={s.freightScope === "None-Off"}                onClick={() => setField("freightScope", "None-Off")}                  small data-testid="tile-freight-scope-none" />
                  <Tile label="Per Item" active={!s.freightScope || s.freightScope === "None"} onClick={() => setField("freightScope", "None")}                      small tint="#22c55e" data-testid="tile-freight-scope-per-item" />
                  <Tile label="Per Job"  active={s.freightScope === "Per Job"}                 onClick={() => setField("freightScope", "Per Job")}                   small tint="#06b6d4" data-testid="tile-freight-scope-per-job" />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 2 }}>
                  <Tile label="None"  active={s.freightTreatment === "None"}          onClick={() => setField("freightTreatment", "None")} small data-testid="tile-freight-none" />
                  <Tile label="Line"  active={s.freightTreatment === "Separate Line"} onClick={() => setField("freightTreatment", "Separate Line")} small tint="#22c55e" data-testid="tile-freight-line" />
                  <Tile label="Amort" active={s.freightTreatment === "Amortize"}      onClick={() => setField("freightTreatment", "Amortize")} small data-testid="tile-freight-amort" />
                </div>
              )}
            </div>

            {s.quoteType === "Multi-Part" && s.freightScope === "Per Job" ? (
              // Per Job mode — freight $ is set in Pricing Strategy → Job-Level Cost Allocation
              <div style={{ marginTop: 8, padding: "8px 10px", background: "#06b6d40c",
                border: "1px solid #06b6d444", borderRadius: 4 }} data-testid="freight-per-job-pointer">
                <div style={{ fontSize: 10, fontWeight: 700, color: "#06b6d4",
                  textTransform: "uppercase", letterSpacing: ".06em" }}>Per-Job Freight</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-text)", marginTop: 2 }}
                  data-testid="freight-per-job-amount">
                  {fmtMoney(Number(s.jobFreightCost) || 0)}
                  <span style={{ fontSize: 10, color: "var(--spot-text3)", marginLeft: 6 }}>
                    split {s.freightAllocMethod || "By MSF"} across {(s.bomItems || []).length} components
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "var(--spot-text3)" }}>
                  Set the amount + allocation method in <b>Pricing Strategy → Job-Level Cost Allocation</b>
                </div>
              </div>
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
              <input className="sp-input" value={s.freightMarkup || ""}
                data-testid="freight-markup-input"
                onChange={(e) => setField("freightMarkup", e.target.value)}
                style={{ width: 50, padding: "3px 6px", fontSize: 11 }} placeholder="0.15" />
            </div>

            <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--spot-accent-soft)",
              border: "1px solid var(--spot-accent)", borderRadius: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-accent)",
                textTransform: "uppercase", letterSpacing: ".06em" }}>Item Freight</div>
              {(() => {
                const raw = Number(s.freightCost) || 0;
                const mk  = Number(s.freightMarkup) || 0;
                const display = raw * (1 + mk);
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>DEST</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--spot-accent)" }}
                      data-testid="freight-amount-display"
                      title={mk > 0 ? `Raw ${fmtMoney(raw)} + ${(mk * 100).toFixed(0)}% markup` : undefined}>
                      {fmtMoney(display)}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: Number(s.freightCost) > 0 ? "var(--spot-green)" : "var(--spot-text3)" }}>
                {Number(s.freightCost) > 0 ? "● Freight verified — OK to quote" : "○ No freight yet"}
              </span>
            </div>

            <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
              <button onClick={updateFreight} disabled={busy} data-testid="btn-freight-update"
                style={{
                  all: "unset", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 700,
                  padding: "5px 10px", borderRadius: 3,
                  background: "var(--spot-accent)", color: "#fff",
                  opacity: busy ? 0.7 : 1,
                }}>{busy ? "…" : "Update All"}</button>
          <button data-testid="btn-freight-dash" style={{
            all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
            padding: "5px 10px", borderRadius: 3,
            background: "var(--spot-purple-bg)", color: "var(--spot-purple)",
            border: "1px solid var(--spot-purple)",
          }}>Dashboard</button>
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
  const { active, setField } = useQuote();
  const tabId = active?.id;
  const [open, setOpen] = useState(true);  // default expanded for visibility (legacy default)
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
        totalRuleInches: s.totalRuleInches, crestComplexity: s.crestComplexity,
        cadDifficulty: s.cadDifficulty,
      }).then((d) => { if (!cancel) setComp(d); })
        .catch(() => { if (!cancel) setComp(null); })
        .finally(() => { if (!cancel) setBusy(false); });
    }, 500);
    return () => { cancel = true; clearTimeout(t); };
  }, [s.oneUpW, s.oneUpL, qty, s.boardGrade, s.flute, s.outsideLiner, s.insideLiner, s.medium,
      s.printReq, s.printMode, s.dieTreatment, s.cuttingDieCost, s.totalRuleInches,
      s.crestComplexity, s.cadDifficulty]);

  const winner = comp?.winner;
  const winnerLabel = winner ? `${winner.toUpperCase()} ${forced ? "FORCED" : "WINS"}` : (primary?.route ? `${primary.route} AUTO` : "");
  const winnerColor = forced ? "sp-badge-warn" : "sp-badge-green";

  // Build column data for visible routes
  const cols = [];
  if (comp?.cad) cols.push({ key: "CAD", label: "CAD", d: comp.cad });
  if (comp?.crest) cols.push({ key: "Crest", label: "Crest", d: comp.crest });
  if (comp?.bobst) cols.push({ key: "Bobst", label: "Bobst", d: comp.bobst });

  const switchTo = (rt) => {
    setField("routeOverride", s.routeOverride === rt ? "Auto" : rt);
  };

  return (
    <div data-testid="route-comparison" style={panelStyle("#22c55e")}>
      <div style={{ ...panelHeader("#22c55e"), cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)} data-testid="route-comparison-toggle">
        <span>Route Comparison{qty ? ` — Qty ${fmtInt(qty)}` : ""}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {winnerLabel && (
            <span className={`sp-badge ${winnerColor}`} data-testid="route-winner-badge">
              {winnerLabel}
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
                  <CmpRow label="Sheet" cols={cols} get={(d) => (d.sheetW && d.sheetL) ? `${fmtNum(d.sheetW, 0)}×${fmtNum(d.sheetL, 0)}` : "—"} />
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

              {/* Verdict + warnings (legacy L7800 messaging) */}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--spot-line)" }}>
                {winner && comp.cad && comp.crest && (() => {
                  const delta = Math.abs(comp.cad.totalCost - comp.crest.totalCost);
                  const winnerCost = winner === "CAD" ? comp.cad.totalCost : comp.crest.totalCost;
                  const loser = winner === "CAD" ? "Crest" : "CAD";
                  const loserCost = winner === "CAD" ? comp.crest.totalCost : comp.cad.totalCost;
                  return (
                    <div style={{ fontWeight: 700, color: "var(--spot-green)", marginBottom: 4 }}>
                      {winner === "Bobst" ? winner : winner} is {fmtMoney(delta)} cheaper than {loser} at {fmtInt(qty)} pcs
                    </div>
                  );
                })()}
                {comp.bobstReason && (
                  <div style={{ fontSize: 11, color: "var(--spot-text3)", fontStyle: "italic", marginTop: 4 }}>
                    {comp.bobstReason}
                  </div>
                )}
                {comp.crest?.warning && (
                  <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                    ⚠ {comp.crest.warning}
                  </div>
                )}
                {comp.cad?.saberNeeded && (
                  <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                    ⚠ CAD sheet exceeds Crest max — Saber needed to switch routes later
                  </div>
                )}
              </div>

              {/* Switch buttons */}
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {cols.map((c) => {
                  if (c.key === winner) return null;
                  return (
                    <button key={c.key} onClick={() => switchTo(c.key)}
                      data-testid={`route-switch-${c.key.toLowerCase()}`}
                      style={{
                        all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                        padding: "4px 10px", borderRadius: 3,
                        background: s.routeOverride === c.key ? "var(--spot-accent-soft)" : "transparent",
                        color: c.key === "CAD" ? "#3b82f6" : c.key === "Crest" ? "#f59e0b" : "#a855f7",
                        border: `1px solid ${c.key === "CAD" ? "#3b82f6" : c.key === "Crest" ? "#f59e0b" : "#a855f7"}`,
                      }}>
                      Switch to {c.label}
                    </button>
                  );
                })}
                {forced && (
                  <button onClick={() => setField("routeOverride", "Auto")}
                    data-testid="route-switch-auto"
                    style={{
                      all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                      padding: "4px 10px", borderRadius: 3,
                      color: "var(--spot-green)", border: "1px solid var(--spot-green)",
                    }}>Back to Auto</button>
                )}
              </div>
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
        {!result || result.error ? (
          <div style={{ color: "var(--spot-text3)", fontSize: 12 }}>
            {result?.error || "Enter dimensions, board, and at least one quantity."}
          </div>
        ) : (
          <>
            {/* ─── MATCHED SET TOP BLOCK ─────────────────────────────────── */}
            {hasMatchedSetTotals && (() => {
              const setQty = agg.setQty || agg.qty || 0;
              const sell = agg.setSell ?? agg.jobSell ?? 0;
              const cost = agg.setCost ?? agg.jobCost ?? agg.totalMfg ?? 0;
              const gmDollar = sell - cost;
              const gmPct = sell > 0 ? gmDollar / sell : 0;
              const sellPerSet = setQty > 0 ? sell / setQty : 0;
              const costPerSet = setQty > 0 ? cost / setQty : 0;
              const lineCharges = Math.max(0, (agg.sellTotal || sell) - sell);
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
                    <Metric label="Sell Total" value={fmtMoney(sell)} big className="green" testid="econ-set-sell" />
                    <Metric label="Sell / Set" value={fmtMoney(sellPerSet)} big testid="econ-set-sell-per" />
                    <Metric label="Margin %"  value={fmtPct(gmPct, 1)} className="green" testid="econ-set-gm-pct" />
                    <Metric label="Margin $"  value={fmtMoney(gmDollar)} testid="econ-set-gm-dol" />
                    <Metric label="Total Cost" value={fmtMoney(cost)} testid="econ-set-cost" />
                    <Metric label="Cost / Set" value={fmtMoney(costPerSet)} testid="econ-set-cost-per" />
                  </div>
                  {lineCharges > 0 && (
                    <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--spot-text2)", fontStyle: "italic", paddingTop: 3 }}>
                      <span>Line Charges: {fmtMoney(lineCharges)}</span>
                      <span style={{ fontWeight: 700, color: "var(--spot-accent)", fontStyle: "normal" }}>
                        Quote Total: {fmtMoney(sell + lineCharges)}
                      </span>
                    </div>
                  )}
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
                <Metric label="Sell / Pc"  value={fmtMoney(r.sellPc, 3)} big testid="metric-sell-pc" />
              </div>
              {(() => {
                const dieSep = !!r.dieSep && (r.dieLineCost || 0) > 0;
                const freightSep = !!r.freightSep && (r.freightLine || 0) > 0;
                const prepressSep = !!r.prepressSep && (r.prepressLineCost || 0) > 0;
                const miscSep = (r.miscLineCost || 0) > 0;
                const hasAnyLine = dieSep || freightSep || prepressSep || miscSep;
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
                    {dieSep && <span>Die: {fmtMoney(r.dieLineCost)}</span>}
                    {prepressSep && <span>Prepress: {fmtMoney(r.prepressLineCost)}</span>}
                    {(r.miscLineItems || []).filter((li) => (li.amt || 0) > 0).map((li, mi) => (
                      <span key={`econ-mli-${mi}`}>{li.name || "Misc"}: {fmtMoney(li.amt)}</span>
                    ))}
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
              <Metric label="Cost / Pc"  value={fmtMoney(r.costPc, 3)} testid="metric-cost-pc" />
              <Metric label="Sell / MSF" value={fmtMoney(r.sellMSF)} testid="metric-sell-msf" />
              <Metric label="Cost / MSF" value={fmtMoney(r.costMSF)} testid="metric-cost-msf" />
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
              {r.route && <span className="sp-pill" style={{ color: "#22c55e", background: "#22c55e22", borderColor: "#22c55e55" }}>Cut {r.route} {labelize(s.cadDifficulty)}</span>}
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

function CostBuildup({ result, isMultiPart, aggregate }) {
  const [view, setView] = useState("summary"); // summary | detail
  if (!result || result.error) return null;
  const r = result;
  const detail = view === "detail";
  const spoilSheets = Math.max(0, Math.round((r.matMakeready || 0) / Math.max(0.01, (r.boardEffRate || 1) * (r.boardOSqFt / 1000 || 0.001))));

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
        <Row label={detail ? <RowInline main="Material" sub={`${r.msfTier || "—"} tier, ${fmtMoney(r.boardEffRate)}/MSF`} /> : "Material"} value={fmtMoney(r.matTotal)} />
        {detail && (r.matMakeready > 0) && (
          <SubRow label={`MR/Spoil Board ${spoilSheets || ""} extra sheets`.trim()} value={fmtMoney(r.matMakeready)} />
        )}
        {detail && r.pressHrs > 0 && (
          <SubRow label={`Press ${fmtNum(r.pressHrs, 1)}h @ ${fmtMoney(r.incaRate)}/hr`} value={fmtMoney(r.pressCost)} />
        )}
        {detail && r.inkCost > 0 && (
          <SubRow label={`Ink ${fmtInt(r.inkSqFt)} sqft @ ${fmtMoney(r.inkRate, 2)}/sqft`} value={fmtMoney(r.inkCost)} />
        )}
        <Row label="Print"    value={fmtMoney(r.printDirect)} />
        {detail && r.cutterDirect > 0 && (
          <SubRow label={`${r.route} ${labelize(r.cadDifficulty || "Standard")}`} value={fmtMoney(r.cutterDirect)} />
        )}
        <Row label={`Cutting ${r.route}`} value={fmtMoney(r.cutterDirect)} />
        {detail && r.assemblyCost > 0 && (
          <SubRow label={`Glue ${labelize(r.gluingComplexity || "Standard")}, ${r.jointsPerPiece || 1} jt @ $23.00/hr`} value={fmtMoney(r.assemblyCost)} />
        )}
        <Row label="Finishing" value={fmtMoney(r.assemblyCost)} />
        <RowTotal label="Total Direct" value={fmtMoney(r.totalDirect)} />

        <SubHead label="Indirect" color="#f59e0b" />
        <Row label={`Overhead ${detail ? `${fmtPct(0, 0)}` : ""}`} value={fmtMoney(r.overhead)} />
        <Row label={
          <span style={{ fontStyle: "italic" }}>
            Prepress amort.{detail && r.prepressEmbedded > 0 ? <span style={{ color: "var(--spot-text3)" }}> {fmtMoney(r.prepressEmbedded)}, no OH/GM</span> : ""}
          </span>
        } value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.prepressEmbedded)}</span>} />
        <Row label={<span style={{ fontStyle: "italic" }}>Die</span>}
          value={<span style={{ fontStyle: "italic" }}>{(r.dieEmbedded > 0) ? fmtMoney(r.dieEmbedded) : "None"}</span>} />
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
          // In MP mode, the One-Time Line Items section should reflect the
          // JOB-LEVEL totals (matches Quote Table "Order Total"), not the
          // active component's slice. r.freightLine on a component is its
          // share; the aggregate row carries the full job freight.
          const agg = isMultiPart ? (aggregate || {}) : null;
          const freight = isMultiPart ? (agg.freightLine || 0) : (r.freightLine || 0);
          const die = isMultiPart ? (agg.dieLineCost || 0) : (r.dieLineCost || 0);
          const prepress = isMultiPart ? (agg.prepressLineCost || 0) : (r.prepressLineCost || 0);
          const misc = isMultiPart ? (agg.miscLineCost || 0) : (r.miscLineCost || 0);
          // Job-level item sell = sum of all components' sell at this qty.
          const itemsSell = isMultiPart
            ? (agg.itemsSell != null ? agg.itemsSell : (agg.jobSell || 0) - freight - die - prepress - misc)
            : r.itemSell;
          const grandTotal = isMultiPart
            ? (agg.sellTotal || itemsSell + freight + die + prepress + misc)
            : r.sellTotal;
          const hasAnyLine = freight > 0 || die > 0 || prepress > 0 || misc > 0;
          if (!hasAnyLine) return null;
          const footerLabel = isMultiPart ? "Order Total" : "Quote Total";
          const itemsLabel = isMultiPart ? "Items (all components)" : "Items";
          return (
            <>
              <SubHead label="One-Time Line Items" color="#3b82f6" />
              {isMultiPart && (
                <Row label={<span style={{ color: "var(--spot-text3)" }}>{itemsLabel}</span>}
                  value={<span style={{ color: "var(--spot-text3)" }}>{fmtMoney(itemsSell)}</span>} />
              )}
              {freight > 0 && (
                <Row label={<span style={{ fontStyle: "italic" }}>Freight {!isMultiPart && (
                  <span style={{ color: "var(--spot-text3)" }}>{fmtMoney(r.freightCost || 0)} + {(Number(r.freightMarkup || 0) * 100).toFixed(0)}% markup</span>
                )}</span>}
                  value={<span style={{ fontStyle: "italic" }}>{fmtMoney(freight)}</span>} />
              )}
              {die > 0 && <Row label={<span style={{ fontStyle: "italic" }}>Die</span>}
                value={<span style={{ fontStyle: "italic" }}>{fmtMoney(die)}</span>} />}
              {prepress > 0 && <Row label={<span style={{ fontStyle: "italic" }}>Prepress</span>}
                value={<span style={{ fontStyle: "italic" }}>{fmtMoney(prepress)}</span>} />}
              {/* Named misc items — show one line per user-typed name */}
              {(() => {
                const miscItems = isMultiPart
                  ? (agg.miscLineItems || [])
                  : (r.miscLineItems || []);
                return miscItems.filter((li) => (li.amt || 0) > 0).map((li, mi) => (
                  <Row key={`mli-${mi}`} label={<span style={{ fontStyle: "italic" }}>{li.name || "Misc"}</span>}
                    value={<span style={{ fontStyle: "italic" }}>{fmtMoney(li.amt)}</span>} />
                ));
              })()}
              <RowTotal label={footerLabel} value={fmtMoney(grandTotal)} accent="var(--spot-purple)" />
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
  const sheetLbl = (r.sheetW && r.sheetL) ? `${fmtNum(r.sheetW, 0)}×${fmtNum(r.sheetL, 0)}` : "—";
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
