/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import { useEngine, useRouteCompare } from "../../hooks/useEngine";
import { fmtMoney, fmtInt, fmtPct, fmtNum } from "../../lib/format";
import { deriveWarnings } from "../../lib/warnings";

export default function RightPanel() {
  const { active } = useQuote();
  const s = active.state;
  const { results, loading } = useEngine(s);
  const { routes } = useRouteCompare(s, 0);

  const primary = results[0]; // qty slot 0 (active row)
  const warnings = React.useMemo(() => deriveWarnings(s, primary), [s, primary]);

  return (
    <div data-testid="right-panel" style={{
      width: 380, flexShrink: 0, overflow: "auto",
      background: "var(--spot-bg2)", borderLeft: "1px solid var(--spot-line)",
      padding: 12, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <RouteComparison routes={routes} primary={primary} />
      <EconomicsPanel result={primary} state={s} loading={loading} />
      <CostBuildup result={primary} />
      <QuoteTable results={results} />
      <WarningsList warnings={warnings} />
    </div>
  );
}

function RouteComparison({ routes, primary }) {
  return (
    <div className="sp-sec" data-testid="route-comparison">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-green)" }}>
        <span>Route Comparison{primary?.qty ? ` · QTY ${primary.qty.toLocaleString()}` : ""}</span>
        {primary?.route && (
          <span className="sp-badge sp-badge-green" data-testid="route-winner-badge">{primary.route} WINS</span>
        )}
      </div>
      <div className="sp-sec-body" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {routes.map((r) => {
          const isWinner = r.route === primary?.route;
          const err = r.error;
          return (
            <div key={r.route}
              data-testid={`route-cmp-${r.route}`}
              style={{
                padding: "6px 8px", borderRadius: 4,
                background: isWinner ? "var(--spot-green-soft)" : "var(--spot-bg3)",
                border: `1px solid ${isWinner ? "var(--spot-green)" : "var(--spot-border)"}`,
              }}>
              <div style={{
                fontSize: 10, color: isWinner ? "var(--spot-green)" : "var(--spot-text3)",
                fontWeight: 700, textTransform: "uppercase",
              }}>
                {r.route}{isWinner ? " ✓" : ""}
              </div>
              {err ? (
                <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 2 }}>n/a</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoney(r.sellTotal, 0)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>
                    GM {fmtPct(r.gmPct, 1)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EconomicsPanel({ result, state, loading }) {
  if (loading && !result) return (
    <div className="sp-sec" data-testid="economics-panel-loading">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-accent)" }}>Economics</div>
      <div className="sp-sec-body" style={{ color: "var(--spot-text3)", fontSize: 12 }}>Calculating…</div>
    </div>
  );
  if (!result) return (
    <div className="sp-sec" data-testid="economics-panel-empty">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-accent)" }}>Economics</div>
      <div className="sp-sec-body" style={{ color: "var(--spot-text3)", fontSize: 12 }}>
        Enter dimensions, board, and at least one quantity to see pricing.
      </div>
    </div>
  );
  if (result.error) return (
    <div className="sp-sec" data-testid="economics-panel-error">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-err)" }}>Economics</div>
      <div className="sp-sec-body" style={{ color: "var(--spot-err)", fontSize: 12 }}>{result.error}</div>
    </div>
  );

  return (
    <div className="sp-sec" data-testid="economics-panel">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-accent)" }}>
        <span>Economics · QTY {result.qty?.toLocaleString()}</span>
      </div>
      <div className="sp-sec-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Metric label="Sell Total" value={fmtMoney(result.sellTotal)} big className="green" testid="metric-sell-total" />
          <Metric label="Sell / Pc"  value={fmtMoney(result.sellPc, 3)} big testid="metric-sell-pc" />
          <Metric label="Margin %" value={fmtPct(result.gmPct, 1)} className="green" testid="metric-gm-pct" />
          <Metric label="Margin $" value={fmtMoney(result.gmDollar)} className="green" testid="metric-gm-dollar" />
          <Metric label="Total Cost" value={fmtMoney(result.totalMfg)} testid="metric-total-cost" />
          <Metric label="Cost / Pc"  value={fmtMoney(result.costPc, 3)} testid="metric-cost-pc" />
          <Metric label="Sell / MSF" value={fmtMoney(result.sellMSF)} testid="metric-sell-msf" />
          <Metric label="Cost / MSF" value={fmtMoney(result.costMSF)} testid="metric-cost-msf" />
        </div>
        <div className="sp-divider" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
          <Metric label="Sheets" value={fmtInt(result.sheetsReq)} small testid="metric-sheets" />
          <Metric label="Pcs/Sh" value={fmtInt(result.pcsPerSheet)} small testid="metric-pcs-sh" />
          <Metric label="MSF"    value={fmtNum(result.oMSF, 2)} small testid="metric-msf" />
          <Metric label="Tier"   value={result.msfTier || "—"} small testid="metric-tier" />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, big, small, className, testid }) {
  return (
    <div className="sp-metric" data-testid={testid}>
      <div className="sp-metric-lbl">{label}</div>
      <div className={`sp-metric-val ${big ? "lg" : small ? "" : ""} ${className || ""}`}>{value}</div>
    </div>
  );
}

function CostBuildup({ result }) {
  if (!result || result.error) return null;
  return (
    <div className="sp-sec" data-testid="cost-buildup">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-orange)" }}>
        Cost Buildup
      </div>
      <div className="sp-sec-body">
        <SubHead label="Direct Production" color="var(--spot-green)" />
        <Row label="Material"  value={fmtMoney(result.matTotal)} />
        <Row label="Print"     value={fmtMoney(result.printDirect)} />
        <Row label={`Cutting (${result.route})`}   value={fmtMoney(result.cutterDirect)} />
        <Row label="Assembly"  value={fmtMoney(result.assemblyCost)} />
        <RowTotal label="Total Direct" value={fmtMoney(result.totalDirect)} />

        <SubHead label="Indirect" color="var(--spot-green)" />
        <Row label="Overhead"  value={fmtMoney(result.overhead)} />
        <Row label="Prepress (amort)" value={fmtMoney(result.prepressEmbedded)} />
        <Row label="Die (amort)"      value={fmtMoney(result.dieEmbedded)} />
        <Row label="Freight (embed)"  value={fmtMoney(result.freightEmbed)} />
        <RowTotal label="Total Cost" value={fmtMoney(result.totalMfg)} />

        <SubHead label="Pricing" color="var(--spot-purple)" />
        <Row label="Item Sell"  value={fmtMoney(result.itemSell)} />
        <Row label="Freight line" value={fmtMoney(result.freightLine)} />
        <Row label="Die line"     value={fmtMoney(result.dieLineCost)} />
        <Row label="Prepress line" value={fmtMoney(result.prepressLineCost)} />
        <RowTotal label="Quote Total" value={fmtMoney(result.sellTotal)} accent="var(--spot-purple)" />
      </div>
    </div>
  );
}

function SubHead({ label, color }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: ".08em",
      borderBottom: `1px solid ${color}33`, paddingBottom: 4, marginTop: 8, marginBottom: 4,
    }}>{label}</div>
  );
}
function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "var(--spot-text2)" }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
function RowTotal({ label, value, accent }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0",
      fontWeight: 700, color: accent || "var(--spot-text)", borderTop: "1px solid var(--spot-line)",
    }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function QuoteTable({ results }) {
  const valid = (results || []).filter((r) => !r.error);
  if (valid.length === 0) return null;
  return (
    <div className="sp-sec" data-testid="quote-table">
      <div className="sp-sec-head has-hue" style={{ "--hue": "var(--spot-accent)" }}>
        Quote Table · {valid.length} qtys
      </div>
      <div className="sp-sec-body" style={{ padding: 0 }}>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--spot-bg3)", color: "var(--spot-text3)" }}>
              <Th>Qty</Th><Th right>Sell/Ea</Th><Th right>GM%</Th><Th right>Total</Th>
            </tr>
          </thead>
          <tbody>
            {valid.map((r, i) => (
              <tr key={i} data-testid={`quote-table-row-${i}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                <Td><strong>{fmtInt(r.qty)}</strong></Td>
                <Td right>{fmtMoney(r.sellPc, 3)}</Td>
                <Td right>{fmtPct(r.gmPct, 1)}</Td>
                <Td right style={{ color: "var(--spot-green)", fontWeight: 700 }}>{fmtMoney(r.sellTotal)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const Th = ({ children, right }) => (
  <th style={{ textAlign: right ? "right" : "left", padding: "5px 8px", textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em", fontWeight: 700 }}>{children}</th>
);
const Td = ({ children, right, style }) => (
  <td style={{ textAlign: right ? "right" : "left", padding: "5px 8px", fontVariantNumeric: "tabular-nums", ...style }}>{children}</td>
);

function WarningsList({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  const byKind = { err: [], warn: [], info: [] };
  warnings.forEach((w) => byKind[w.severity]?.push(w));
  const icon = { err: "❗", warn: "⚠", info: "ⓘ" };

  return (
    <div className="sp-sec" data-testid="warnings-list">
      <div className="sp-sec-head has-hue" style={{ "--hue": byKind.err.length ? "var(--spot-err)" : "var(--spot-warn)" }}>
        <span>Guardrails · {warnings.length}</span>
        <span style={{ display: "flex", gap: 4 }}>
          {byKind.err.length > 0 && <span className="sp-badge sp-badge-err">{byKind.err.length}</span>}
          {byKind.warn.length > 0 && <span className="sp-badge sp-badge-warn">{byKind.warn.length}</span>}
          {byKind.info.length > 0 && <span className="sp-badge sp-badge-muted">{byKind.info.length}</span>}
        </span>
      </div>
      <div className="sp-sec-body" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 240, overflow: "auto" }}>
        {warnings.map((w) => (
          <div key={w.id} data-testid={`warning-${w.id}`}
            style={{
              padding: "5px 8px", borderRadius: 3,
              background: w.severity === "err" ? "var(--spot-err-bg)" : w.severity === "warn" ? "var(--spot-warn-bg)" : "var(--spot-bg3)",
              borderLeft: `3px solid ${w.severity === "err" ? "var(--spot-err)" : w.severity === "warn" ? "var(--spot-warn)" : "var(--spot-text3)"}`,
              fontSize: 11,
            }}>
            <div style={{
              fontWeight: 700, color: w.severity === "err" ? "var(--spot-err)" : w.severity === "warn" ? "var(--spot-warn)" : "var(--spot-text2)",
            }}>
              {icon[w.severity]} {w.title}
            </div>
            <div style={{ color: "var(--spot-text3)", marginTop: 2 }}>{w.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
