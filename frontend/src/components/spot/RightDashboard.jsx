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
  const { results } = useEngine(s);
  const primary = results[s.selSlot || 0] || results[0];

  return (
    <div data-testid="right-dashboard" style={{
      width: 360, flexShrink: 0, overflow: "auto",
      background: "var(--spot-bg2)", borderLeft: "1px solid var(--spot-line)",
      display: "flex", flexDirection: "column",
      paddingBottom: 80,  // keep last row clear of the "Made with Emergent" badge
    }}>
      <FreightPanel s={s} />
      <RouteComparison s={s} primary={primary} />
      <EconomicsPanel s={s} result={primary} />
      <CostBuildup result={primary} />
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

        <div style={rowSpaced}>
          <span style={lbl}>Type</span>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="None"  active={s.freightTreatment === "None"}          onClick={() => setField("freightTreatment", "None")} small data-testid="tile-freight-none" />
            <Tile label="Line"  active={s.freightTreatment === "Separate Line"} onClick={() => setField("freightTreatment", "Separate Line")} small tint="#22c55e" data-testid="tile-freight-line" />
            <Tile label="Amort" active={s.freightTreatment === "Amortize"}      onClick={() => setField("freightTreatment", "Amortize")} small data-testid="tile-freight-amort" />
          </div>
        </div>

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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>{s.quoteFOB === "Origin" ? "ORIG" : "DEST"}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--spot-accent)" }}
              data-testid="freight-amount-display">{fmtMoney(s.freightCost || 0)}</span>
          </div>
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
      </div>
    </div>
    </>
  );
}

function RouteComparison({ s, primary }) {
  const [open, setOpen] = useState(true);  // default expanded for visibility (legacy default)
  const [comp, setComp] = useState(null);
  const [busy, setBusy] = useState(false);
  const { setField } = useQuote();
  const qty = primary?.qty;
  const forced = !!(s.routeOverride && s.routeOverride !== "Auto");

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

function EconomicsPanel({ s, result }) {
  const r = result || {};
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
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)", marginBottom: 6 }}>
              {s.itemDesc || "Item"} <span style={{ color: "var(--spot-accent)", marginLeft: 6 }}>{fmtInt(r.qty)} pcs</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Metric label="Sell Total" value={fmtMoney(r.itemSell)} big className="green" testid="metric-sell-total" />
              <Metric label="Sell / Pc"  value={fmtMoney(r.sellPc, 3)} big testid="metric-sell-pc" />
              <div style={{ gridColumn: "span 2", fontSize: 11, color: "var(--spot-text3)" }}>
                Freight: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(r.freightLine || 0)}</b>
                {" · "}Order: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(r.sellTotal)}</b>
              </div>
              <Metric label="Margin %"  value={fmtPct(r.gmPct, 1)} className="green" testid="metric-gm-pct" />
              <Metric label="Margin $"  value={fmtMoney(r.gmDollar)} className="green" testid="metric-gm-dollar" />
              <Metric label="Total Cost" value={fmtMoney(r.totalMfg)} testid="metric-total-cost" />
              <Metric label="Cost / Pc"  value={fmtMoney(r.costPc, 3)} testid="metric-cost-pc" />
              <Metric label="Sell / MSF" value={fmtMoney(r.sellMSF)} testid="metric-sell-msf" />
              <Metric label="Cost / MSF" value={fmtMoney(r.costMSF)} testid="metric-cost-msf" />
            </div>
            <div className="sp-divider" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
              <Metric label="Sheets" value={fmtInt(r.sheetsReq)} small testid="metric-sheets" />
              <Metric label="Pcs/Sh" value={fmtInt(r.pcsPerSheet)} small testid="metric-pcs-sh" />
              <Metric label="MSF"    value={fmtNum(r.oMSF, 2)} small testid="metric-msf" />
              <Metric label="Tier"   value={r.msfTier || "—"} small testid="metric-tier" />
            </div>
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

function CostBuildup({ result }) {
  const [view, setView] = useState("summary"); // summary | detail
  if (!result || result.error) return null;
  const r = result;
  const detail = view === "detail";
  const spoilSheets = Math.max(0, Math.round((r.matMakeready || 0) / Math.max(0.01, (r.boardEffRate || 1) * (r.boardOSqFt / 1000 || 0.001))));

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

        {(r.freightLine > 0 || r.dieLineCost > 0 || r.prepressLineCost > 0) && (
          <>
            <SubHead label="One-Time Line Items" color="#3b82f6" />
            {r.freightLine > 0 && (
              <Row label={<span style={{ fontStyle: "italic" }}>Freight <span style={{ color: "var(--spot-text3)" }}>{fmtMoney(r.freightCost || 0)} + {(Number(r.freightMarkup || 0) * 100).toFixed(0)}% markup</span></span>}
                value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.freightLine)}</span>} />
            )}
            {r.dieLineCost > 0 && <Row label={<span style={{ fontStyle: "italic" }}>Die</span>}
              value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.dieLineCost)}</span>} />}
            {r.prepressLineCost > 0 && <Row label={<span style={{ fontStyle: "italic" }}>Prepress</span>}
              value={<span style={{ fontStyle: "italic" }}>{fmtMoney(r.prepressLineCost)}</span>} />}
            <RowTotal label="Quote Total" value={fmtMoney(r.sellTotal)} accent="var(--spot-purple)" />
          </>
        )}
      </div>
    </div>
  );
}

function BoardPanel({ result, s }) {
  const [open, setOpen] = useState(false);  // default COLLAPSED (legacy default)
  if (!result || result.error) return null;
  const r = result;
  const sheetLbl = (r.sheetW && r.sheetL) ? `${fmtNum(r.sheetW, 0)}×${fmtNum(r.sheetL, 0)}` : "—";
  const isStock = !!r?._pipeline?.stockMode;
  const mode = isStock ? "STOCK" : "ORDER";
  const sqFt = Math.round(r.boardOSqFt || (r.oMSF * 1000));
  const wastePct = r.wastePct || 0;

  return (
    <div data-testid="board-panel" style={panelStyle("#a855f7")}>
      <div style={{ ...panelHeader("#a855f7"), cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)} data-testid="board-panel-toggle">
        <span>Board {sheetLbl} — {mode} {fmtMoney(r.boardTotal)}</span>
        <span style={{ fontSize: 11, transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform .15s" }}>▸</span>
      </div>
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
