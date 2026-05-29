/* eslint-disable */
import React, { useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import { useEngine, useRouteCompare } from "../../hooks/useEngine";
import { freightQuote } from "../../api/spot";
import Tile from "./Tile";
import { fmtMoney, fmtInt, fmtPct, fmtNum } from "../../lib/format";

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
    }}>
      <FreightPanel s={s} />
      <RouteComparison s={s} primary={primary} />
      <EconomicsPanel s={s} result={primary} />
      <CostBuildup result={primary} />
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
  );
}

function RouteComparison({ s, primary }) {
  const { routes } = useRouteCompare(s, 0);
  const qty = primary?.qty;
  const forced = !!s.routeOverride;
  return (
    <div data-testid="route-comparison" style={panelStyle("#22c55e")}>
      <div style={panelHeader("#22c55e")}>
        <span>Route Comparison{qty ? ` · QTY ${fmtInt(qty)}` : ""}</span>
        {primary?.route && (
          <span className={`sp-badge ${forced ? "sp-badge-warn" : "sp-badge-green"}`}
            data-testid="route-winner-badge">
            {primary.route} {forced ? "FORCED" : "AUTO"}
          </span>
        )}
      </div>
      <div style={{ padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {(routes.length > 0 ? routes : ["CAD", "Crest", "Bobst"].map((r) => ({ route: r }))).map((r) => {
          const isWinner = r.route === primary?.route;
          return (
            <div key={r.route} data-testid={`route-cmp-${r.route}`} style={{
              padding: "6px 8px", borderRadius: 4,
              background: isWinner ? "var(--spot-green-soft)" : "var(--spot-bg3)",
              border: `1px solid ${isWinner ? "var(--spot-green)" : "var(--spot-border)"}`,
            }}>
              <div style={{
                fontSize: 10, color: isWinner ? "var(--spot-green)" : "var(--spot-text3)",
                fontWeight: 700, textTransform: "uppercase",
              }}>{r.route}{isWinner ? " ✓" : ""}</div>
              {r.error ? (
                <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 2 }}>n/a</div>
              ) : r.sellTotal ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)", marginTop: 2 }}>
                    {fmtMoney(r.sellTotal, 0)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>GM {fmtPct(r.gmPct, 1)}</div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 2 }}>—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
              <Metric label="Sell Total" value={fmtMoney(r.sellTotal)} big className="green" testid="metric-sell-total" />
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
              {s.printReq === "Yes" && <span className="sp-pill" style={{ color: "#3b82f6", background: "#3b82f622", borderColor: "#3b82f655" }}>Print {labelize(s.printMode)}</span>}
              {r.route && <span className="sp-pill" style={{ color: "#22c55e", background: "#22c55e22", borderColor: "#22c55e55" }}>Cut {r.route} {labelize(s.cadDifficulty)}</span>}
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
        <Row label="Material" value={fmtMoney(r.matTotal)} />
        <Row label="Print"    value={fmtMoney(r.printDirect)} />
        <Row label={`Cutting ${r.route}`} value={fmtMoney(r.cutterDirect)} />
        <Row label="Finishing" value={fmtMoney(r.assemblyCost)} />
        <RowTotal label="Total Direct" value={fmtMoney(r.totalDirect)} />

        <SubHead label="Indirect" color="var(--spot-green)" />
        <Row label="Overhead" value={fmtMoney(r.overhead)} />
        <Row label="Prepress (amort)" value={fmtMoney(r.prepressEmbedded)} />
        <Row label="Die (amort)" value={fmtMoney(r.dieEmbedded || 0)} />
        <Row label="Freight (embed)" value={fmtMoney(r.freightEmbed || 0)} />
        <RowTotal label="Total Cost" value={fmtMoney(r.totalMfg)} />

        <SubHead label="Pricing" color="var(--spot-purple)" />
        <Row label={`Margin ${fmtPct(r.gmPct, 1)}`} value={fmtMoney(r.gmDollar)} />
        <RowTotal label="Sell Total" value={fmtMoney(r.itemSell)} />
        <Row label={`Sell/Pc ${fmtInt(r.qty)} pcs`} value={fmtMoney(r.sellPc, 3)} />

        {(r.freightLine > 0 || r.dieLineCost > 0 || r.prepressLineCost > 0) && (
          <>
            <SubHead label="One-Time Line Items" color="var(--spot-accent)" />
            {r.freightLine > 0 && <Row label={`Freight + ${(Number(r.freightMarkup || 0) * 100).toFixed(0)}% markup`} value={fmtMoney(r.freightLine)} />}
            {r.dieLineCost > 0 && <Row label="Die" value={fmtMoney(r.dieLineCost)} />}
            {r.prepressLineCost > 0 && <Row label="Prepress" value={fmtMoney(r.prepressLineCost)} />}
            <RowTotal label="Quote Total" value={fmtMoney(r.sellTotal)} accent="var(--spot-purple)" />
          </>
        )}
      </div>
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
