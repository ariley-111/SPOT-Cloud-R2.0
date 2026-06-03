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
  { k: "copy",    lbl: "",         align: "center", w: 36 },
];

export default function QuoteTableSec({ results }) {
  const { active, sec, toggleSec, setField, pushToast } = useQuote();
  const s = active?.state || {};
  const rows = (results || []).filter((r) => Number(r.qty) > 0);
  const selSlot = Math.min(s.selSlot ?? 0, Math.max(0, rows.length - 1));
  const excludeArr = Array.isArray(s.exportExclude) ? s.exportExclude : [];
  const isExcluded = (slot) => excludeArr.includes(slot);
  const activeCount = rows.filter((r, i) => !r.error && !isExcluded(i)).length;
  const total = rows.length;
  const isMP = s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0;
  const pricingMode = s.pricingMode || "Matched Set";
  const setOverride = !!s.setMarginOverride;

  const onPreview = () => window.dispatchEvent(new CustomEvent("spot:open-preview"));
  const onExport  = () => window.dispatchEvent(new CustomEvent("spot:export-csv"));
  const onPrint   = () => window.print();

  // Toggle a single qty slot's exclusion from PDF/Preview/Export (legacy "Act" checkbox).
  // If excluding the currently selected slot, move selection to the next active row.
  const toggleExclude = (slot) => {
    const currentlyExcluded = isExcluded(slot);
    const next = currentlyExcluded
      ? excludeArr.filter((x) => x !== slot)
      : [...excludeArr, slot];
    setField("exportExclude", next);
    // If we just excluded the currently-selected slot, jump to the first remaining active row.
    if (!currentlyExcluded && slot === selSlot) {
      const firstActive = rows.findIndex((_, i) => i !== slot && !next.includes(i));
      if (firstActive >= 0) setField("selSlot", firstActive);
    }
  };
  // Reset all exclusions (legacy "All Active" button)
  const allActive = () => {
    setField("exportExclude", []);
    pushToast("All quantity rows marked active", "ok");
  };
  // Click row to make it the selected slot (drives Per-Component, Order Total,
  // Economics, Cost Buildup, Board, Route Comparison — same as legacy).
  const selectRow = (i) => setField("selSlot", i);

  // Copy a single row as tab-separated values for Excel paste. Mirrors legacy
  // (spot_r1_5.jsx — per-row "Copy" button). Columns match the table headers.
  const copyRow = async (r) => {
    const sellEa = r.qty > 0 ? r.itemSell / r.qty : 0;
    const cells = [
      r.qty, sellEa.toFixed(2), (r.gmPct * 100).toFixed(1) + "%",
      r.gmDollar.toFixed(2), r.itemSell.toFixed(2),
      (r.sellMSF || 0).toFixed(2), (r.costMSF || 0).toFixed(2),
      (r.freightLine || r.freightEmbed || 0).toFixed(2),
      r.sheetW ? `${r.sheetW}x${r.sheetL}` : "",
      r.pcsPerSheet || "", r.route || "",
    ];
    const tsv = cells.join("\t");
    try {
      await navigator.clipboard.writeText(tsv);
      pushToast(`Row Qty ${r.qty} copied`, "ok");
    } catch (e) {
      pushToast("Copy failed — clipboard blocked", "err");
    }
  };

  return (
    <Sec label="Quote Table" hue="#a855f7" open={sec.quoteTable} onToggle={() => toggleSec("quoteTable")}
      badge={total > 0 ? `${activeCount}/${total}` : null}
      data-testid="sec-quote-table">

      {/* Multi-Part indicator banner */}
      {isMP && (
        <div data-testid="mp-banner" style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "6px 10px", marginBottom: 8, borderRadius: 4,
          background: "#f59e0b0c", border: "1px solid #f59e0b44",
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
            textTransform: "uppercase", letterSpacing: ".08em" }}>Multi-Part Totals</span>
          <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>
            {pricingMode} · {(s.bomItems || []).length} component{(s.bomItems || []).length !== 1 ? "s" : ""}
            {pricingMode === "Matched Set" && setOverride && (
              <> · GM override {(parseFloat(s.setMarginPct || 0) * 100).toFixed(1)}%</>
            )}
            {pricingMode === "Matched Set" && !setOverride && (
              <> · per-item GM tiers aggregated</>
            )}
          </span>
          <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: "auto" }}>
            Rows show <b>per-set</b> totals at each set quantity
          </span>
        </div>
      )}

      {/* Toolbar row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <button data-testid="qt-all-active" onClick={allActive} style={tbtn}>All Active</button>
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
              const isSel = i === selSlot;
              const excl = isExcluded(i);
              const rowTint = r._pipeline?.stockMode ? "#22c55e10" :
                              r._pipeline?.customOrder ? "#3b82f610" :
                              r._pipeline?.belowMin ? "#f59e0b14" : "transparent";
              return (
                <tr key={i} data-testid={`qt-row-${i}`}
                  onClick={() => selectRow(i)}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px solid var(--spot-line)",
                    background: isSel ? "var(--spot-accent-soft)" : rowTint,
                    opacity: excl ? 0.45 : 1,
                  }}>
                  <td style={{ padding: "4px 3px", textAlign: "center" }}
                    onClick={(e) => { e.stopPropagation(); toggleExclude(i); }}>
                    <span data-testid={`qt-act-${i}`}
                      style={{
                        display: "inline-block", width: 14, height: 14, borderRadius: 3,
                        border: `2px solid ${excl ? "var(--spot-text3)" : "var(--spot-accent)"}`,
                        background: excl ? "transparent" : "var(--spot-accent)",
                        color: "#fff", fontSize: 11, lineHeight: "10px", textAlign: "center",
                        cursor: "pointer", userSelect: "none",
                      }}>{excl ? "" : "✓"}</span>
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: isSel ? 700 : 600 }}>
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: dot, marginRight: 4 }} />
                    {fmtInt(r.qty)}
                    {isSel && (
                      <span style={{
                        marginLeft: 4, fontSize: 9, fontWeight: 700, padding: "1px 4px",
                        borderRadius: 2, background: "var(--spot-accent)", color: "#fff",
                      }}>SEL</span>
                    )}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.forcedPrice ? "#a855f7" : "var(--spot-text)" }}>
                    {fmtMoney(r.qty > 0 ? r.itemSell / r.qty : 0, 2)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.gmPct >= 0 ? "var(--spot-green)" : "var(--spot-err)", fontWeight: 600 }}>
                    {fmtPct(r.gmPct, 1)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: r.gmDollar >= 0 ? "var(--spot-green)" : "var(--spot-err)" }}>
                    {fmtMoney(r.gmDollar)}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(r.itemSell)}</td>
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
                  <td style={{ padding: "4px 4px", textAlign: "center" }}
                    onClick={(e) => e.stopPropagation()}>
                    <button data-testid={`qt-copy-row-${i}`} onClick={() => copyRow(r)}
                      title="Copy row to clipboard (Excel-friendly)"
                      style={{
                        all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
                        padding: "2px 6px", borderRadius: 3,
                        color: "var(--spot-accent)", border: "1px solid var(--spot-accent)",
                      }}>Copy</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Order Total Breakdown for selected qty — legacy parity: left cluster
          (QTY · Items · Freight · Die · Prepress) + right-justified Order Total. */}
      {rows.length > 0 && rows[selSlot] && !rows[selSlot].error && (
        <div data-testid="quote-order-total" style={{
          borderTop: "1px solid var(--spot-line)", padding: "8px 4px", marginTop: 4,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 13, gap: 24, flexWrap: "wrap",
        }}>
          {(() => {
            const r = rows[selSlot];
            const selExcluded = isExcluded(selSlot);
            return (
              <>
                <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
                    QTY {fmtInt(r.qty)}
                  </span>
                  {selExcluded && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "var(--spot-warn)",
                      padding: "1px 6px", borderRadius: 3,
                      background: "var(--spot-warn-soft, #f59e0b22)",
                      border: "1px solid var(--spot-warn)",
                      textTransform: "uppercase", letterSpacing: ".06em",
                    }} data-testid="order-total-excluded-badge">
                      Excluded from PDF
                    </span>
                  )}
                  <span><span style={{ color: "var(--spot-text2)" }}>Items: </span><b>{fmtMoney(r.itemSell)}</b></span>
                  {r.freightLine > 0    && <span><span style={{ color: "var(--spot-text2)" }}>Freight: </span><b>{fmtMoney(r.freightLine)}</b></span>}
                  {r.dieLineCost > 0    && <span><span style={{ color: "var(--spot-text2)" }}>Die: </span><b>{fmtMoney(r.dieLineCost)}</b></span>}
                  {r.prepressLineCost > 0 && <span><span style={{ color: "var(--spot-text2)" }}>Prepress: </span><b>{fmtMoney(r.prepressLineCost)}</b></span>}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: "var(--spot-accent)",
                  padding: "4px 10px", borderRadius: 3,
                  background: "var(--spot-accent-soft)", border: "1px solid var(--spot-accent)",
                  whiteSpace: "nowrap",
                }}>
                  Order Total: <span data-testid="quote-order-total-amt" style={{ fontSize: 14 }}>{fmtMoney(r.sellTotal)}</span>
                </div>
              </>
            );
          })()}
        </div>
      )}
      {/* MP-4: Per-component breakdown for the selected qty slot */}
      {isMP && rows.length > 0 && rows[selSlot] && Array.isArray(rows[selSlot].perComponent) && (
        <div data-testid="mp-per-component" style={{
          marginTop: 8, padding: "8px 10px", background: "var(--spot-bg3)",
          border: "1px solid var(--spot-border)", borderRadius: 4, fontSize: 12,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
            Per-Component Breakdown @ {fmtInt(rows[selSlot].qty)} sets
            <span style={{ marginLeft: 8, fontSize: 9, color: "var(--spot-accent)",
              textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
              Click a Qty row above to switch
            </span>
          </div>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--spot-text3)" }}>
              <th style={{ textAlign: "left",  padding: "3px 6px" }}>Component</th>
              <th style={{ textAlign: "center", padding: "3px 6px" }}>Type</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Pcs/Set</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Order Qty</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Cost/Pc</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Sell/Pc</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Cost</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Sell</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>GM%</th>
              <th style={{ textAlign: "right", padding: "3px 6px" }}>Route</th>
            </tr></thead>
            <tbody>
              {rows[selSlot].perComponent.map((pc, i) => {
                const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a","#9ca3af","#fbbf24"];
                const tint = tints[i % tints.length];
                return (
                  <tr key={pc.itemId || i} style={{ borderTop: "1px solid var(--spot-line)" }}
                    data-testid={`mp-pc-row-${i}`}>
                    <td style={{ padding: "3px 6px", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
                      {pc.desc || `Item ${i+1}`}
                      {pc.error && <span style={{ color: "var(--spot-err)", fontSize: 9, marginLeft: 4 }}>· {pc.error}</span>}
                    </td>
                    <td style={{ padding: "3px 6px", textAlign: "center", color: "var(--spot-text3)" }}>{pc.type?.[0] || "M"}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right" }}>×{pc.pcsPerSet || 1}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtInt(pc.qty || pc.totalQty || 0)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtMoney(pc.costPc || (pc.qty > 0 ? (pc.totalMfg || 0) / pc.qty : 0), 4)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtMoney(pc.sellPc || (pc.qty > 0 ? (pc.itemSell || 0) / pc.qty : 0), 4)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--spot-text2)" }}>{fmtMoney(pc.totalMfg || 0)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(pc.itemSell || 0)}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right",
                      color: (pc.gmPct || 0) >= 0 ? "var(--spot-green)" : "var(--spot-err)" }}>
                      {fmtPct(pc.gmPct || 0, 1)}
                    </td>
                    <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 10,
                      color: routeColor(pc.route), fontWeight: 600 }}>{pc.route || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Sec>
  );
}

function routeColor(rt) {
  if (rt === "CAD") return "#3b82f6";
  if (rt === "Crest") return "#f59e0b";
  if (rt === "Bobst") return "#a855f7";
  if (rt === "Purchased") return "#06b6d4";
  if (rt === "Fulfillment") return "#22c55e";
  if (rt === "Matched Set" || rt === "Individual") return "#f59e0b";
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
