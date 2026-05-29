/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec from "./Sec";
import { fmtMoney, fmtInt, fmtPct, fmtNum } from "../../lib/format";

const COLS = [
  { k: "act",     lbl: "Act",      align: "center", w: 24 },
  { k: "qty",     lbl: "Qty",      align: "right" },
  { k: "sellEa",  lbl: "Sell/Ea",  align: "right", accent: true },
  { k: "gmPct",   lbl: "GM%",      align: "right" },
  { k: "gmDol",   lbl: "GM$",      align: "right" },
  { k: "total",   lbl: "Total",    align: "right" },
  { k: "sellMSF", lbl: "$/MSF",    align: "right" },
  { k: "costMSF", lbl: "Cost/MSF", align: "right" },
  { k: "freight", lbl: "Freight",  align: "right" },
  { k: "sheet",   lbl: "Sheet",    align: "right" },
  { k: "out",     lbl: "#Out",     align: "right" },
  { k: "route",   lbl: "Route",    align: "right" },
];

export default function QuoteTableSec({ results }) {
  const { active, sec, toggleSec } = useQuote();
  const s = active?.state || {};
  const rows = (results || []).filter((r) => Number(r.qty) > 0);
  const activeCount = rows.filter((r) => !r.error).length;
  const total = rows.length;

  const onPreview = () => window.dispatchEvent(new CustomEvent("spot:open-preview"));
  const onExport  = () => window.dispatchEvent(new CustomEvent("spot:export-csv"));
  const onPrint   = () => window.print();

  return (
    <Sec label="Quote Table" hue="#a855f7" open={sec.quoteTable} onToggle={() => toggleSec("quoteTable")}
      badge={total > 0 ? `${activeCount}/${total}` : null}
      data-testid="sec-quote-table">

      {/* Toolbar row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <button data-testid="qt-all-active" style={tbtn}>All Active</button>
        <span style={{ fontSize: 12, color: "var(--spot-text2)" }}>{activeCount} of {total} active</span>
        <span style={{ fontSize: 12, color: "var(--spot-text2)", display: "flex", gap: 8, alignItems: "center" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#22c55e", marginRight: 4 }} />Stock</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#3b82f6", marginRight: 4 }} />Custom</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#f59e0b", marginRight: 4 }} />Below Min</span>
        </span>
        <button data-testid="qt-export-csv" onClick={onExport} style={{ ...tbtn, marginLeft: "auto" }}>Export CSV</button>
        <button data-testid="qt-copy-all" style={tbtn}>Copy All</button>
        <button data-testid="qt-preview" onClick={onPreview} style={tbtnAccent("#3b82f6")}>Preview</button>
        <button data-testid="qt-export" style={tbtnAccent("#22c55e")}>Export</button>
        <button data-testid="qt-print" onClick={onPrint} style={tbtnAccent("#8b5cf6")}>⎙ Print</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table data-testid="quote-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif" }}>
          <thead>
            <tr style={{ background: "var(--spot-bg3)" }}>
              {COLS.map((c) => (
                <th key={c.k} style={{
                  padding: "5px 6px", textAlign: c.align, fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", color: c.accent ? "var(--spot-accent)" : "var(--spot-text3)",
                  borderBottom: "1px solid var(--spot-line)", whiteSpace: "nowrap",
                }}>{c.lbl}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={COLS.length} style={{ padding: 16, textAlign: "center",
                color: "var(--spot-text3)", fontSize: 13 }} data-testid="quote-table-empty">
                Enter dimensions and quantities
              </td></tr>
            ) : rows.map((r, i) => {
              if (r.error) {
                return (
                  <tr key={i} data-testid={`qt-row-${i}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                    <td style={{ padding: "4px 3px", textAlign: "center" }}>—</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtInt(r.qty)}</td>
                    <td colSpan={COLS.length - 2} style={{ padding: "4px 6px", color: "var(--spot-warn)", fontSize: 11 }}>
                      {r.error}
                    </td>
                  </tr>
                );
              }
              const dot = r._pipeline?.stockMode ? "#22c55e" :
                          r._pipeline?.customOrder ? "#3b82f6" :
                          r._pipeline?.belowMin ? "#f59e0b" : "var(--spot-text3)";
              return (
                <tr key={i} data-testid={`qt-row-${i}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                  <td style={{ padding: "4px 3px", textAlign: "center" }}>
                    <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3,
                      border: "2px solid var(--spot-accent)", background: "var(--spot-accent)",
                      color: "#fff", fontSize: 11, lineHeight: "14px", textAlign: "center" }}>✓</span>
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 600 }}>
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: dot, marginRight: 4 }} />
                    {fmtInt(r.qty)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.forcedPrice ? "#a855f7" : "var(--spot-text)" }}>
                    {fmtMoney(r.sellPc, 2)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.gmPct >= 0 ? "var(--spot-green)" : "var(--spot-err)", fontWeight: 600 }}>
                    {fmtPct(r.gmPct, 1)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.gmDollar >= 0 ? "var(--spot-green)" : "var(--spot-err)" }}>
                    {fmtMoney(r.gmDollar)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(r.sellTotal)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(r.sellMSF)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(r.costMSF)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11 }}>{fmtMoney(r.freightLine || r.freightEmbed || 0)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, color: "var(--spot-text2)" }}>
                    {r.sheetW ? `${fmtNum(r.sheetW, 3)}×${fmtNum(r.sheetL, 3)}` : "—"}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, fontWeight: 600 }}>{r.pcsPerSheet || "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, color: routeColor(r.route), fontWeight: 600 }}>
                    {r.route || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Order Total Breakdown for selected qty */}
      {rows.length > 0 && rows[s.selSlot || 0] && !rows[s.selSlot || 0].error && (
        <div data-testid="quote-order-total" style={{
          borderTop: "1px solid var(--spot-line)", padding: "6px 0", marginTop: 4,
          display: "flex", gap: 16, alignItems: "baseline", fontSize: 13, flexWrap: "wrap",
        }}>
          {(() => {
            const r = rows[s.selSlot || 0];
            const parts = [];
            parts.push(<span key="q" style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-text3)", textTransform: "uppercase" }}>QTY {fmtInt(r.qty)} </span>);
            parts.push(<span key="i"><span style={{ color: "var(--spot-text2)" }}>Item: </span><b>{fmtMoney(r.itemSell)}</b></span>);
            if (r.freightLine > 0)  parts.push(<span key="f"><span style={{ color: "var(--spot-text2)" }}>Freight: </span><b>{fmtMoney(r.freightLine)}</b></span>);
            if (r.dieLineCost > 0)  parts.push(<span key="d"><span style={{ color: "var(--spot-text2)" }}>Die: </span><b>{fmtMoney(r.dieLineCost)}</b></span>);
            if (r.prepressLineCost > 0) parts.push(<span key="p"><span style={{ color: "var(--spot-text2)" }}>Prepress: </span><b>{fmtMoney(r.prepressLineCost)}</b></span>);
            parts.push(<span key="ot" style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-accent)", marginLeft: "auto" }}>Order Total: {fmtMoney(r.sellTotal)}</span>);
            return parts;
          })()}
        </div>
      )}
    </Sec>
  );
}

function routeColor(rt) {
  if (rt === "CAD") return "#3b82f6";
  if (rt === "Crest") return "#f59e0b";
  if (rt === "Bobst") return "#a855f7";
  return "var(--spot-text2)";
}

const tbtn = {
  all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
  padding: "4px 10px", borderRadius: 3,
  background: "var(--spot-bg3)", color: "var(--spot-text2)",
  border: "1px solid var(--spot-border)",
};
const tbtnAccent = (c) => ({
  all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
  padding: "4px 10px", borderRadius: 3,
  background: `${c}22`, color: c, border: `1px solid ${c}44`,
});
