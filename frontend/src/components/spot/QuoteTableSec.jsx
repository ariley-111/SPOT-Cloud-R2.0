/* eslint-disable */
import React, { useState, useEffect, useRef } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec from "./Sec";
import { fmtMoney, fmtInt, fmtPct, fmtNum } from "../../lib/format";

// Column definitions — used for both Single-Part and the per-component sub-tables.
// Order per user spec: Act, Qty, Sell/Ea, GM%, GM$, Total, $/MSF, Cost/MSF,
// Freight, Sheet Size (no decimals), #Out, Route.
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

export default function QuoteTableSec({ results, componentPricing, jobTotals, meta }) {
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
  // Per-component grouped view is only used in MP-Individual mode where each
  // component has its own qty tier(s). Matched Set keeps the aggregate layout.
  const useComponentLayout = isMP && pricingMode === "Individual"
    && Array.isArray(componentPricing) && componentPricing.length > 0;

  const onPreview = () => window.dispatchEvent(new CustomEvent("spot:open-preview"));
  const onExport  = () => window.dispatchEvent(new CustomEvent("spot:export-csv"));
  const onPrint   = () => window.print();

  // Toggle a single qty slot's exclusion from PDF/Preview/Export (legacy "Act" checkbox).
  const toggleExclude = (slot) => {
    const currentlyExcluded = isExcluded(slot);
    const next = currentlyExcluded
      ? excludeArr.filter((x) => x !== slot)
      : [...excludeArr, slot];
    setField("exportExclude", next);
    if (!currentlyExcluded && slot === selSlot) {
      const firstActive = rows.findIndex((_, i) => i !== slot && !next.includes(i));
      if (firstActive >= 0) setField("selSlot", firstActive);
    }
  };
  const allActive = () => {
    setField("exportExclude", []);
    pushToast("All quantity rows marked active", "ok");
  };
  const selectRow = (i) => setField("selSlot", i);

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
    try { await navigator.clipboard.writeText(cells.join("\t")); pushToast(`Row Qty ${r.qty} copied`, "ok"); }
    catch (e) { pushToast("Copy failed — clipboard blocked", "err"); }
  };

  return (
    <Sec label="Quote Table" hue="#a855f7" open={sec.quoteTable} onToggle={() => toggleSec("quoteTable")}
      badge={useComponentLayout
        ? `${componentPricing.length} comp · ${componentPricing.reduce((a, c) => a + (c.rows || []).length, 0)} qty`
        : (total > 0 ? `${activeCount}/${total}` : null)}
      data-testid="sec-quote-table">

      {/* Multi-Part indicator banner */}
      {isMP && (
        <div data-testid="mp-banner" style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "6px 10px", marginBottom: 8, borderRadius: 4,
          background: "#f59e0b0c", border: "1px solid #f59e0b44",
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
            textTransform: "uppercase", letterSpacing: ".08em" }}>Multi-Part · {pricingMode}</span>
          <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>
            {(s.bomItems || []).length} component{(s.bomItems || []).length !== 1 ? "s" : ""}
            {pricingMode === "Matched Set" && setOverride && (
              <> · GM override {(parseFloat(s.setMarginPct || 0) * 100).toFixed(1)}%</>
            )}
            {pricingMode === "Matched Set" && !setOverride && (
              <> · per-item GM tiers aggregated</>
            )}
            {pricingMode === "Individual" && (
              <> · each component has its own qty tier(s)</>
            )}
          </span>
          <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: "auto" }}>
            {pricingMode === "Matched Set"
              ? <>Rows show <b>per-set</b> totals at each set quantity</>
              : <>Each component shows its <b>own</b> qty rows · Job costs in footer</>}
          </span>
        </div>
      )}

      {/* Toolbar row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        {!useComponentLayout && (
          <>
            <button data-testid="qt-all-active" onClick={allActive} style={tbtn}>All Active</button>
            <span style={{ fontSize: 12, color: "var(--spot-text2)" }}>{activeCount} of {total} active</span>
          </>
        )}
        <span style={{ fontSize: 12, color: "var(--spot-text2)", display: "flex", gap: 8, alignItems: "center" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#22c55e", marginRight: 4 }} />Stock</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#3b82f6", marginRight: 4 }} />Custom</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "#f59e0b", marginRight: 4 }} />Below Min</span>
        </span>
        <button data-testid="qt-export-csv" onClick={onExport} style={{ ...tbtn, marginLeft: "auto" }}>Export CSV</button>
        <button data-testid="qt-preview" onClick={onPreview} style={tbtnAccent("#3b82f6")}>Preview</button>
        <button data-testid="qt-print" onClick={onPrint} style={tbtnAccent("#8b5cf6")}>⎙ Print</button>
      </div>

      {useComponentLayout ? (
        <ComponentLayout
          componentPricing={componentPricing}
          jobTotals={jobTotals}
          bomItems={s.bomItems || []}
          activeItemIdx={s.activeItemIdx ?? 0}
          excludeMap={s.exportExcludeByComponent || {}}
          quoteFOB={s.quoteFOB || ""}
          localDeliveryZone={s.localDeliveryZone || ""}
          freightCarrier={s.freightCarrier || ""}
          freightScope={s.freightScope || "None"}
          topQtys={s.qtys || []}
          jobFreightBySlot={s.jobFreightBySlot || {}}
          setField={setField}
        />
      ) : (
        <FlatLayout
          rows={rows}
          isExcluded={isExcluded}
          toggleExclude={toggleExclude}
          selSlot={selSlot}
          selectRow={selectRow}
          copyRow={copyRow}
          totalCols={COLS.length}
        />
      )}

      {/* Order Total Breakdown for selected qty — only for flat layout (SP / MP-MatchedSet) */}
      {!useComponentLayout && rows.length > 0 && rows[selSlot] && !rows[selSlot].error && (
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
                  {(r.miscLineItems || []).filter((li) => (li.amt || 0) > 0).map((li, mi) => (
                    <span key={`mli-${mi}`} data-testid={`order-total-misc-${mi}`}>
                      <span style={{ color: "var(--spot-text2)" }}>{li.name || "Misc"}: </span>
                      <b>{fmtMoney(li.amt)}</b>
                    </span>
                  ))}
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

      {/* MP-MatchedSet: keep the legacy per-component breakdown chip */}
      {isMP && !useComponentLayout && rows.length > 0 && rows[selSlot] && Array.isArray(rows[selSlot].perComponent) && (
        <PerComponentBreakdownLegacy row={rows[selSlot]} />
      )}
    </Sec>
  );
}

// ─── FlatLayout (SP and MP-Matched Set) ─────────────────────────────────
function FlatLayout({ rows, isExcluded, toggleExclude, selSlot, selectRow, copyRow, totalCols }) {
  return (
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
            <tr><td colSpan={totalCols} style={{ padding: 16, textAlign: "center",
              color: "var(--spot-text3)", fontSize: 13 }} data-testid="quote-table-empty">
              Enter dimensions and quantities
            </td></tr>
          ) : rows.map((r, i) => {
            if (r.error) {
              return (
                <tr key={i} data-testid={`qt-row-${i}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                  <td style={{ padding: "4px 3px", textAlign: "center" }}>—</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtInt(r.qty)}</td>
                  <td colSpan={totalCols - 2} style={{ padding: "4px 6px", color: "var(--spot-warn)", fontSize: 11 }}>
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
            const cadLabel = Number(r.cadHrs) > 0 && r.route
              ? `${r.route} ${Number(r.cadHrs).toFixed(1)}h`
              : (r.route || "—");
            return (
              <tr key={i} data-testid={`qt-row-${i}`}
                onClick={() => selectRow(i)}
                style={{
                  cursor: "pointer", borderBottom: "1px solid var(--spot-line)",
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
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11 }}>
                  {Number(r.freightLine || r.freightEmbed) > 0 ? fmtMoney(r.freightLine || r.freightEmbed) : "—"}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, color: "var(--spot-text2)" }}>
                  {r.sheetW ? `${Math.round(Number(r.sheetW))}×${Math.round(Number(r.sheetL))}` : "—"}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, fontWeight: 600 }}>{r.pcsPerSheet || "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 11, color: routeColor(r.route), fontWeight: 600 }}>
                  {cadLabel}
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
  );
}

// ─── ComponentLayout (MP-Individual) ──────────────────────────────────
// Each component is its own collapsible section with its own qty rows.
// Scales cleanly to 25+ components via expand/collapse controls.
function ComponentLayout({ componentPricing, jobTotals, bomItems, activeItemIdx, excludeMap, quoteFOB, localDeliveryZone, freightCarrier, freightScope, topQtys, jobFreightBySlot, setField }) {
  // Default: first 3 components expanded, plus the BOM-selected one
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    componentPricing.forEach((c, i) => {
      init[c.itemId || c.itemIndex] = i < 3 || i === activeItemIdx;
    });
    return init;
  });
  // Track per-component selected qty row (default = first row).
  // Keyed by itemId so the selection survives across engine recomputations.
  const [selRowByComp, setSelRowByComp] = useState({});

  // Auto-scroll-into-view fires ONLY when the user changes the active BOM
  // component (not on every engine recompute / data refresh). We track the
  // previous activeItemIdx in a ref to detect the actual user intent.
  const prevActiveRef = useRef(activeItemIdx);
  useEffect(() => {
    if (prevActiveRef.current === activeItemIdx) return;  // not a user-initiated change
    prevActiveRef.current = activeItemIdx;
    const target = componentPricing.find((c) => c.itemIndex === activeItemIdx);
    if (!target) return;
    const k = target.itemId || target.itemIndex;
    setExpanded((prev) => prev[k] ? prev : { ...prev, [k]: true });
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-comp-section="${k}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [activeItemIdx, componentPricing]);
  useEffect(() => {
    // Keep newly added components closed by default; only adjust if list grows
    setExpanded((prev) => {
      const next = { ...prev };
      componentPricing.forEach((c, i) => {
        const k = c.itemId || c.itemIndex;
        if (!(k in next)) next[k] = i < 3;
      });
      return next;
    });
  }, [componentPricing.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const expandAll = () => {
    const all = {};
    componentPricing.forEach((c) => { all[c.itemId || c.itemIndex] = true; });
    setExpanded(all);
  };
  const collapseAll = () => {
    const none = {};
    componentPricing.forEach((c) => { none[c.itemId || c.itemIndex] = false; });
    setExpanded(none);
  };
  const toggle = (k) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  // Toggle a (component, slotIdx) row's exclusion from PDF
  const isRowExcluded = (itemId, slotIdx) => {
    const arr = excludeMap[itemId] || [];
    return arr.includes(slotIdx);
  };
  const toggleRowExclude = (itemId, slotIdx) => {
    const arr = excludeMap[itemId] || [];
    const next = arr.includes(slotIdx) ? arr.filter((x) => x !== slotIdx) : [...arr, slotIdx];
    setField("exportExcludeByComponent", { ...excludeMap, [itemId]: next });
  };

  // Aggregate totals across all components for Job Totals footer
  const sum = (key) => componentPricing.reduce(
    (acc, c) => acc + (c.rows || []).reduce((a, r) => a + Number(r[key] || 0), 0), 0
  );
  const baseSell = sum("itemSell");
  const baseFreight = sum("freightLine");
  const baseDie = sum("dieLineCost");
  const basePrepress = sum("prepressLineCost");
  const totalSell = baseSell + baseFreight + baseDie + basePrepress;

  const perJobFreight = jobTotals?.freightScope === "Per Job" ? Number(jobTotals.jobFreightCost || 0) : 0;
  const perJobPrepress = jobTotals?.prepressScope === "Per Job" ? Number(jobTotals.jobPrepressCost || 0) : 0;
  const grandTotal = totalSell + perJobFreight + perJobPrepress;

  return (
    <div data-testid="quote-table-component-layout">
      {/* Component nav strip */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button data-testid="qt-expand-all" onClick={expandAll} style={tbtn}>Expand All</button>
        <button data-testid="qt-collapse-all" onClick={collapseAll} style={tbtn}>Collapse All</button>
        <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 8 }}>Components:</span>
        {componentPricing.map((c) => {
          const k = c.itemId || c.itemIndex;
          const open = !!expanded[k];
          const isActive = c.itemIndex === activeItemIdx;
          const tint = tintFor(c.itemIndex);
          return (
            <button key={k} data-testid={`qt-nav-comp-${c.itemIndex}`}
              onClick={() => {
                setExpanded((p) => ({ ...p, [k]: true }));
                setField("activeItemIdx", c.itemIndex);
              }}
              style={{
                all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
                padding: "3px 8px", borderRadius: 10,
                background: isActive ? tint : (open ? `${tint}22` : "var(--spot-bg3)"),
                color: isActive ? "#1a1a1a" : (open ? tint : "var(--spot-text2)"),
                border: `1px solid ${isActive || open ? tint : "var(--spot-border)"}`,
              }} title={c.desc}>
              <span style={{
                display: "inline-block", width: 6, height: 6, borderRadius: 3,
                background: isActive ? "#1a1a1a" : tint, marginRight: 5,
              }} />
              {c.itemIndex + 1}. {(c.desc || `Item ${c.itemIndex + 1}`).slice(0, 24)}
            </button>
          );
        })}
      </div>

      {/* Per-component sections */}
      {componentPricing.map((c) => {
        const k = c.itemId || c.itemIndex;
        const open = !!expanded[k];
        const isBomSelected = c.itemIndex === activeItemIdx;
        const compRows = c.rows || [];
        const totalQtyCount = compRows.length;
        // Selected qty row (default = first available row).
        const selRowIdx = Math.min(
          selRowByComp[k] ?? 0,
          Math.max(0, totalQtyCount - 1),
        );
        const selRow = compRows[selRowIdx];
        // Header total reflects the selected qty row's full sellTotal.
        const headerTotal = selRow ? Number(selRow.sellTotal || 0) : 0;
        // Breakdown of what's included in the selected total
        const breakdownParts = [];
        if (selRow) {
          breakdownParts.push(`base ${fmtMoney(selRow.itemSell || 0)}`);
          if (Number(selRow.freightLine) > 0)      breakdownParts.push(`frt ${fmtMoney(selRow.freightLine)}`);
          if (Number(selRow.dieLineCost) > 0)      breakdownParts.push(`die ${fmtMoney(selRow.dieLineCost)}`);
          if (Number(selRow.prepressLineCost) > 0) breakdownParts.push(`prep ${fmtMoney(selRow.prepressLineCost)}`);
          if (Number(selRow.miscLineCost) > 0)     breakdownParts.push(`misc ${fmtMoney(selRow.miscLineCost)}`);
        }
        const bs = c.boardSpec || {};
        const specLine = [
          bs.custIdent,
          bs.boardGrade && bs.flute ? `${bs.boardGrade}# ${bs.flute}` : "",
          `${linerShort(bs.outsideLiner)}/${linerShort(bs.insideLiner)}`,
          (Number(bs.oneUpW) > 0 && Number(bs.oneUpL) > 0) ? `${fmtNum(bs.oneUpW, 4)}×${fmtNum(bs.oneUpL, 4)}` : "",
          mediumShort(bs.medium),
        ].filter(Boolean).join(" · ");

        return (
          <div key={k} data-comp-section={k} data-testid={`qt-comp-section-${c.itemIndex}`}
            data-bom-selected={isBomSelected ? "true" : "false"}
            style={{
              border: `${isBomSelected ? "2px" : "1px"} solid ${isBomSelected ? tintFor(c.itemIndex) : "var(--spot-line)"}`,
              borderLeft: `4px solid ${tintFor(c.itemIndex)}`,
              borderRadius: 5, marginBottom: 8,
              background: "var(--spot-bg2)",
              boxShadow: isBomSelected ? `0 0 0 2px ${tintFor(c.itemIndex)}33` : "none",
              transition: "box-shadow .15s, border-color .15s",
            }}>
            {/* Section header — always visible */}
            <div onClick={() => toggle(k)}
              style={{
                cursor: "pointer", padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                background: isBomSelected
                  ? `${tintFor(c.itemIndex)}22`
                  : (open ? "var(--spot-bg3)" : "transparent"),
                borderBottom: open ? "1px solid var(--spot-line)" : "none",
              }}>
              <span style={{
                display: "inline-block", width: 14, textAlign: "center",
                fontSize: 11, color: "var(--spot-text2)",
                transform: open ? "rotate(90deg)" : "none", transition: "transform .15s",
              }}>▸</span>
              <span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: 4,
                background: tintFor(c.itemIndex),
              }} />
              <span style={{ fontWeight: 700, fontSize: 13,
                color: isBomSelected ? tintFor(c.itemIndex) : "inherit" }}>
                {c.itemIndex + 1}. {c.desc || `Item ${c.itemIndex + 1}`}
              </span>
              {isBomSelected && (
                <span data-testid={`qt-comp-${c.itemIndex}-bom-selected`} style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 6px",
                  borderRadius: 2, background: tintFor(c.itemIndex), color: "#1a1a1a",
                  textTransform: "uppercase", letterSpacing: ".06em",
                }}>BOM</span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 700, color: typeColor(c.type),
                padding: "1px 6px", borderRadius: 3, background: `${typeColor(c.type)}18`,
                border: `1px solid ${typeColor(c.type)}66`, textTransform: "uppercase",
                letterSpacing: ".06em",
              }}>{c.type || "Mfg"}</span>
              <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
                {totalQtyCount} qty tier{totalQtyCount !== 1 ? "s" : ""} · {c.pcsPerSet || 1}/set
              </span>
              {specLine && (
                <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>{specLine}</span>
              )}
              {/* Header total: reflects the SELECTED qty row, with breakdown of what it includes. */}
              <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-accent)" }}
                  data-testid={`qt-comp-${c.itemIndex}-sel-total`}>
                  {selRow ? `@${fmtInt(selRow.qty)}: ${fmtMoney(headerTotal)}` : "—"}
                </span>
                {breakdownParts.length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 1 }}
                    title="Breakdown of the selected quantity's total">
                    {breakdownParts.join(" + ")}
                  </span>
                )}
              </div>
            </div>

            {open && (
              <ComponentSubTable
                comp={c}
                selRowIdx={selRowIdx}
                onSelectRow={(idx) => setSelRowByComp((p) => ({ ...p, [k]: idx }))}
                isRowExcluded={isRowExcluded}
                toggleRowExclude={toggleRowExclude}
                freightDisplayMode={
                  quoteFOB === "Origin" ? "na"
                  : quoteFOB === "LocalDelivery" ? "na"
                  : (freightScope === "Per Job") ? "allocated"
                  : "per-item"
                }
              />
            )}
          </div>
        );
      })}

      {/* Job Totals footer — labels per-job freight as Local Delivery + Zone
          when applicable; surfaces per-qty freight when costs vary by slot.
          Show ONLY the freight row relevant to the selected FOB:
          - Will-Call (Origin): no freight row at all
          - Ship + Per Item: "Per-Item Freight (sum)"
          - Ship + Per Job: "Per-Job Freight" (with carrier)
          - Local Delivery: "Per-Job Freight: Local Delivery · Zone N" */}
      {(perJobFreight > 0 || perJobPrepress > 0 || componentPricing.length > 1) && (() => {
        const isWillCall = quoteFOB === "Origin";
        const isLocalDelivery = quoteFOB === "LocalDelivery" || quoteFOB === "Local Delivery";
        const isShip = quoteFOB === "Destination" && !isLocalDelivery;
        const isPerJob = freightScope === "Per Job";
        // Decide which freight summary line to show (mutually exclusive)
        const showPerItemFreight = isShip && !isPerJob && baseFreight > 0;
        const showPerJobFreightLine = (isLocalDelivery && perJobFreight > 0)
          || (isShip && isPerJob && perJobFreight > 0);
        // Detect per-qty variation: any component with 2+ qty rows
        const anyMultiQty = componentPricing.some((c) => (c.rows || []).length > 1);
        const perSlotAgg = {};
        componentPricing.forEach((c) => {
          (c.rows || []).forEach((r) => {
            const si = r.slotIdx;
            if (!perSlotAgg[si]) perSlotAgg[si] = { slotIdx: si, qty: r.qty, items: 0, freight: 0, die: 0, prep: 0 };
            perSlotAgg[si].items   += Number(r.itemSell || 0);
            perSlotAgg[si].freight += Number(r.freightLine || 0);
            perSlotAgg[si].die     += Number(r.dieLineCost || 0);
            perSlotAgg[si].prep    += Number(r.prepressLineCost || 0);
          });
        });
        const perSlotList = Object.values(perSlotAgg).sort((a, b) => a.slotIdx - b.slotIdx);
        const perJobFreightLabel = isLocalDelivery
          ? `Per-Job Freight: Local Delivery${localDeliveryZone ? ` · ${localDeliveryZone}` : ""}`
          : (freightCarrier
            ? `Per-Job Freight · via ${freightCarrier}`
            : "Per-Job Freight");
        const perJobBySlot = perSlotList.map((p) => {
          const v = jobFreightBySlot[p.slotIdx];
          const amt = (v !== undefined && v !== "" && v !== null) ? Number(v) : (perJobFreight / Math.max(1, perSlotList.length));
          return { ...p, perJobFreightAtSlot: amt };
        });

        return (
          <div data-testid="qt-job-totals" style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 5,
            background: "var(--spot-bg3)", border: "1px solid var(--spot-line)",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>Job Totals</span>
              {anyMultiQty && (
                <span style={{ fontSize: 9, color: "var(--spot-text3)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
                  Costs vary by qty — breakdown shown by quantity tier
                </span>
              )}
            </div>

            {anyMultiQty ? (
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }} data-testid="qt-job-totals-by-qty">
                <thead><tr style={{ borderBottom: "1px solid var(--spot-line)" }}>
                  <th style={{ ...thMini, textAlign: "left" }}>Qty Tier</th>
                  <th style={{ ...thMini, textAlign: "right" }}>Items</th>
                  {showPerItemFreight       && <th style={{ ...thMini, textAlign: "right" }}>Per-Item Freight</th>}
                  {baseDie > 0              && <th style={{ ...thMini, textAlign: "right" }}>Die</th>}
                  {basePrepress > 0         && <th style={{ ...thMini, textAlign: "right" }}>Prepress</th>}
                  {showPerJobFreightLine    && <th style={{ ...thMini, textAlign: "right" }}>{isLocalDelivery ? "Local Delivery" : "Per-Job Freight"}</th>}
                  <th style={{ ...thMini, textAlign: "right", color: "var(--spot-accent)" }}>Total @ Tier</th>
                </tr></thead>
                <tbody>
                  {perJobBySlot.map((p) => {
                    const tierTotal = p.items + (showPerItemFreight ? p.freight : 0) + p.die + p.prep
                      + (showPerJobFreightLine ? p.perJobFreightAtSlot : 0);
                    return (
                      <tr key={p.slotIdx} style={{ borderBottom: "1px solid var(--spot-line)" }}
                        data-testid={`qt-job-totals-tier-${p.slotIdx}`}>
                        <td style={{ padding: "4px 6px", fontWeight: 600 }}>@ {fmtInt(p.qty)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(p.items)}</td>
                        {showPerItemFreight       && <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(p.freight)}</td>}
                        {baseDie > 0              && <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(p.die)}</td>}
                        {basePrepress > 0         && <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(p.prep)}</td>}
                        {showPerJobFreightLine    && <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(p.perJobFreightAtSlot)}</td>}
                        <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700,
                          color: "var(--spot-accent)" }}>{fmtMoney(tierTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <tbody>
                  <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Items (base sell)</td>
                    <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(baseSell)}</td></tr>
                  {showPerItemFreight && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }} data-testid="qt-peritem-freight-row">Per-Item Freight (sum)</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(baseFreight)}</td></tr>
                  )}
                  {baseDie > 0 && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Item Die (sum)</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(baseDie)}</td></tr>
                  )}
                  {basePrepress > 0 && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Item Prepress (sum)</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(basePrepress)}</td></tr>
                  )}
                  {showPerJobFreightLine && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }} data-testid="qt-perjob-freight-label">
                      {perJobFreightLabel}</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(perJobFreight)}</td></tr>
                  )}
                  {perJobPrepress > 0 && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Job Prepress</td>
                      <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(perJobPrepress)}</td></tr>
                  )}
                  {isWillCall && (
                    <tr><td style={{ padding: "2px 0", color: "var(--spot-text3)", fontStyle: "italic" }} colSpan={2}
                      data-testid="qt-willcall-note">
                      Will-Call · no freight on this quote
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}

            <div style={{
              borderTop: "1px solid var(--spot-line)", marginTop: 6, paddingTop: 6,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-accent)" }}>Quote Grand Total</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--spot-accent)" }}
                data-testid="qt-grand-total">{fmtMoney(
                  // Grand total respects FOB: exclude per-item freight in non-Ship modes
                  baseSell
                  + (showPerItemFreight ? baseFreight : 0)
                  + baseDie + basePrepress
                  + (showPerJobFreightLine ? perJobFreight : 0)
                  + (perJobPrepress > 0 ? perJobPrepress : 0)
                )}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ComponentSubTable({ comp, selRowIdx, onSelectRow, isRowExcluded, toggleRowExclude, freightDisplayMode }) {
  const rows = comp.rows || [];
  // Sub-table column set matches the user's requested legacy order:
  // Act, Qty, Sell/Ea, GM%, GM$, Total, $/MSF, Cost/MSF, Freight, Sheet Size, #Out, Route
  const SUB_COLS = [
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
  if (rows.length === 0) {
    return (
      <div style={{ padding: 14, textAlign: "center", color: "var(--spot-text3)", fontSize: 12 }}>
        No qty entered for this component
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        data-testid={`qt-comp-table-${comp.itemIndex}`}>
        <thead>
          <tr style={{ background: "var(--spot-bg3)" }}>
            {SUB_COLS.map((c) => (
              <th key={c.k} style={{
                padding: "4px 6px", textAlign: c.align, fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", color: c.accent ? "var(--spot-accent)" : "var(--spot-text3)",
                borderBottom: "1px solid var(--spot-line)", whiteSpace: "nowrap",
              }}>{c.lbl}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const excl = isRowExcluded(comp.itemId, r.slotIdx);
            const isSelRow = i === selRowIdx;
            const cadLabel = Number(r.cadHrs) > 0 && r.route
              ? `${r.route} ${Number(r.cadHrs).toFixed(1)}h`
              : (r.route || "—");
            const cellBase = { padding: "3px 6px" };
            return (
              <tr key={i} data-testid={`qt-comp-${comp.itemIndex}-row-${i}`}
                data-row-selected={isSelRow ? "true" : "false"}
                onClick={() => onSelectRow && onSelectRow(i)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--spot-line)",
                  opacity: excl ? 0.45 : 1,
                  background: isSelRow ? "var(--spot-accent-soft)" : "transparent",
                  outline: isSelRow ? "1px solid var(--spot-accent)" : "none",
                  outlineOffset: "-1px",
                }}>
                <td style={{ ...cellBase, textAlign: "center" }}
                  onClick={(e) => { e.stopPropagation(); toggleRowExclude(comp.itemId, r.slotIdx); }}>
                  <span style={{
                    display: "inline-block", width: 13, height: 13, borderRadius: 3,
                    border: `2px solid ${excl ? "var(--spot-text3)" : "var(--spot-accent)"}`,
                    background: excl ? "transparent" : "var(--spot-accent)",
                    color: "#fff", fontSize: 10, lineHeight: "10px", textAlign: "center",
                    cursor: "pointer",
                  }}>{excl ? "" : "✓"}</span>
                </td>
                <td style={{ ...cellBase, textAlign: "right", fontWeight: isSelRow ? 800 : 600 }}>
                  {fmtInt(r.qty)}
                  {isSelRow && (
                    <span style={{
                      marginLeft: 4, fontSize: 8, fontWeight: 700, padding: "0px 4px",
                      borderRadius: 2, background: "var(--spot-accent)", color: "#fff",
                      verticalAlign: "middle",
                    }}>SEL</span>
                  )}
                </td>
                <td style={{ ...cellBase, textAlign: "right" }}>{fmtMoney(r.sellPc, 2)}</td>
                <td style={{ ...cellBase, textAlign: "right",
                  color: (r.gmPct || 0) >= 0 ? "var(--spot-green)" : "var(--spot-err)", fontWeight: 600 }}>
                  {fmtPct(r.gmPct || 0, 1)}
                </td>
                <td style={{ ...cellBase, textAlign: "right",
                  color: (r.gmDollar || 0) >= 0 ? "var(--spot-green)" : "var(--spot-err)" }}>
                  {fmtMoney(r.gmDollar || 0)}
                </td>
                <td style={{ ...cellBase, textAlign: "right", fontWeight: 700, color: "var(--spot-accent)" }}>
                  {fmtMoney(r.sellTotal)}
                </td>
                <td style={{ ...cellBase, textAlign: "right" }}>{fmtMoney(r.sellMSF, 2)}</td>
                <td style={{ ...cellBase, textAlign: "right", color: "var(--spot-text2)" }}>{fmtMoney(r.costMSF, 2)}</td>
                <td style={{ ...cellBase, textAlign: "right" }}>{
                  freightDisplayMode === "na"
                    ? <span style={{ color: "var(--spot-text3)", fontStyle: "italic" }}>N/A</span>
                    : (Number(r.freightLine) > 0 ? fmtMoney(r.freightLine) : "—")
                }</td>
                <td style={{ ...cellBase, textAlign: "right", color: "var(--spot-text2)" }}>
                  {r.sheetW ? `${Math.round(Number(r.sheetW))}×${Math.round(Number(r.sheetL))}` : "—"}
                </td>
                <td style={{ ...cellBase, textAlign: "right", fontWeight: 600 }}>{r.pcsPerSheet || "—"}</td>
                <td style={{ ...cellBase, textAlign: "right", color: routeColor(r.route), fontWeight: 600 }}>{cadLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Legacy per-component breakdown chip — kept for MP-MatchedSet mode
function PerComponentBreakdownLegacy({ row }) {
  return (
    <div data-testid="mp-per-component" style={{
      marginTop: 8, padding: "8px 10px", background: "var(--spot-bg3)",
      border: "1px solid var(--spot-border)", borderRadius: 4, fontSize: 12,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
        textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
        Per-Component Breakdown @ {fmtInt(row.qty)} sets
      </div>
      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead><tr style={{ color: "var(--spot-text3)" }}>
          <th style={{ textAlign: "left",  padding: "3px 6px" }}>Component</th>
          <th style={{ textAlign: "center", padding: "3px 6px" }}>Type</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Pcs/Set</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Order Qty</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Cost/Pc</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Sell/Pc</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Sell</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>GM%</th>
          <th style={{ textAlign: "right", padding: "3px 6px" }}>Route</th>
        </tr></thead>
        <tbody>
          {(row.perComponent || []).map((pc, i) => {
            const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a","#9ca3af","#fbbf24"];
            const tint = tints[i % tints.length];
            return (
              <tr key={pc.itemId || i} style={{ borderTop: "1px solid var(--spot-line)" }}
                data-testid={`mp-pc-row-${i}`}>
                <td style={{ padding: "3px 6px", display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
                  {pc.desc || `Item ${i+1}`}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "center", color: "var(--spot-text3)" }}>{pc.type?.[0] || "M"}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>×{pc.pcsPerSet || 1}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtInt(pc.qty || pc.totalQty || 0)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtMoney(pc.costPc || (pc.qty > 0 ? (pc.totalMfg || 0) / pc.qty : 0), 4)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmtMoney(pc.sellPc || (pc.qty > 0 ? (pc.itemSell || 0) / pc.qty : 0), 4)}</td>
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
  );
}

// BOM component tints — matches the per-component colors used by the BOM
// section / Placeholders.jsx so the Quote Table component sections + nav
// chips visually align with the BOM rows.
const BOM_TINTS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a", "#9ca3af", "#fbbf24"];
const tintFor = (i) => BOM_TINTS[i % BOM_TINTS.length];


function linerShort(liner) {
  // Legacy fmLnr semantics (spot_r1_5.jsx L1218):
  //   null/empty/"None" → "Kraft"; strip weight prefix (e.g. "42# ") and
  //   trailing "-Lite" / "-White" suffixes.
  if (!liner || String(liner).toLowerCase() === "none") return "Kraft";
  const s = String(liner).replace(/^\s*\d+#\s*/, "").replace(/-(Lite|White)$/i, "");
  if (/kemi/i.test(s)) return "Kemi";
  if (/kla/i.test(s) && /white/i.test(liner)) return "Kla";
  if (/white/i.test(s)) return "White";
  if (/kraft/i.test(s)) return "Kraft";
  return s;
}

function mediumShort(medium) {
  // Strip the trailing " Medium" / " Bleached Medium" — keep the weight prefix
  // (e.g. "33# Medium" → "33#", "26# Bleached Medium" → "26# Bl").
  if (!medium || String(medium).toLowerCase() === "none") return "";
  return String(medium)
    .replace(/\s*Bleached Medium\s*$/i, " Bl")
    .replace(/\s*Medium\s*$/i, "")
    .trim();
}

function typeColor(t) {
  if (t === "Manufactured") return "#3b82f6";
  if (t === "Purchased") return "#06b6d4";
  if (t === "Fulfillment") return "#22c55e";
  return "var(--spot-text3)";
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
const thMini = {
  padding: "3px 6px", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: ".06em",
  color: "var(--spot-text3)",
};
