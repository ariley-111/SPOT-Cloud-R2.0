/* eslint-disable */
import React, { useState, useEffect } from "react";
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
            const cadLabel = (r.route === "CAD" && Number(r.cadHrs) > 0)
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
function ComponentLayout({ componentPricing, jobTotals, bomItems, activeItemIdx, excludeMap, setField }) {
  // Default: first 3 components expanded, plus the BOM-selected one
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    componentPricing.forEach((c, i) => {
      init[c.itemId || c.itemIndex] = i < 3 || i === activeItemIdx;
    });
    return init;
  });
  // Auto-expand and scroll-into-view when user picks a different component in BOM
  useEffect(() => {
    const target = componentPricing.find((c) => c.itemIndex === activeItemIdx);
    if (!target) return;
    const k = target.itemId || target.itemIndex;
    setExpanded((prev) => prev[k] ? prev : { ...prev, [k]: true });
    // Scroll the selected section into view (smooth, top-aligned)
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
          return (
            <button key={k} data-testid={`qt-nav-comp-${c.itemIndex}`}
              onClick={() => {
                setExpanded((p) => ({ ...p, [k]: true }));
                setTimeout(() => {
                  const el = document.querySelector(`[data-comp-section="${k}"]`);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }}
              style={{
                all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 600,
                padding: "3px 8px", borderRadius: 10,
                background: open ? "var(--spot-accent-soft)" : "var(--spot-bg3)",
                color: open ? "var(--spot-accent)" : "var(--spot-text2)",
                border: `1px solid ${open ? "var(--spot-accent)" : "var(--spot-border)"}`,
              }} title={c.desc}>
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
        const compSell = (c.rows || []).reduce((a, r) => a + Number(r.itemSell || 0), 0);
        const totalQtyCount = (c.rows || []).length;
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
              border: `${isBomSelected ? "2px" : "1px"} solid ${isBomSelected ? "var(--spot-accent)" : "var(--spot-line)"}`,
              borderRadius: 5, marginBottom: 8,
              background: "var(--spot-bg2)",
              boxShadow: isBomSelected ? "0 0 0 2px var(--spot-accent-soft)" : "none",
              transition: "box-shadow .15s, border-color .15s",
            }}>
            {/* Section header — always visible */}
            <div onClick={() => toggle(k)}
              style={{
                cursor: "pointer", padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 12,
                background: isBomSelected
                  ? "var(--spot-accent-soft)"
                  : (open ? "var(--spot-bg3)" : "transparent"),
                borderBottom: open ? "1px solid var(--spot-line)" : "none",
              }}>
              <span style={{
                display: "inline-block", width: 14, textAlign: "center",
                fontSize: 11, color: "var(--spot-text2)",
                transform: open ? "rotate(90deg)" : "none", transition: "transform .15s",
              }}>▸</span>
              <span style={{ fontWeight: 700, fontSize: 13,
                color: isBomSelected ? "var(--spot-accent)" : "inherit" }}>
                {c.itemIndex + 1}. {c.desc || `Item ${c.itemIndex + 1}`}
              </span>
              {isBomSelected && (
                <span data-testid={`qt-comp-${c.itemIndex}-bom-selected`} style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 6px",
                  borderRadius: 2, background: "var(--spot-accent)", color: "#fff",
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
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--spot-accent)" }}>
                {fmtMoney(compSell)}
              </span>
            </div>

            {open && (
              <ComponentSubTable
                comp={c}
                isRowExcluded={isRowExcluded}
                toggleRowExclude={toggleRowExclude}
              />
            )}
          </div>
        );
      })}

      {/* Job Totals footer — only when any per-job cost exists */}
      {(perJobFreight > 0 || perJobPrepress > 0 || componentPricing.length > 1) && (
        <div data-testid="qt-job-totals" style={{
          marginTop: 10, padding: "10px 14px", borderRadius: 5,
          background: "var(--spot-bg3)", border: "1px solid var(--spot-line)",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6,
          }}>Job Totals</div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Items (base sell)</td>
                <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(baseSell)}</td></tr>
              {baseFreight > 0 && (
                <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Item Freight (sum)</td>
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
              {perJobFreight > 0 && (
                <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Job Freight</td>
                  <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(perJobFreight)}</td></tr>
              )}
              {perJobPrepress > 0 && (
                <tr><td style={{ padding: "2px 0", color: "var(--spot-text2)" }}>Per-Job Prepress</td>
                  <td style={{ padding: "2px 0", textAlign: "right" }}>{fmtMoney(perJobPrepress)}</td></tr>
              )}
              <tr style={{ borderTop: "1px solid var(--spot-line)" }}>
                <td style={{ padding: "6px 0 0", fontWeight: 700, color: "var(--spot-accent)" }}>Quote Grand Total</td>
                <td style={{ padding: "6px 0 0", textAlign: "right", fontWeight: 700, fontSize: 14,
                  color: "var(--spot-accent)" }} data-testid="qt-grand-total">{fmtMoney(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ComponentSubTable({ comp, isRowExcluded, toggleRowExclude }) {
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
            const cadLabel = (r.route === "CAD" && Number(r.cadHrs) > 0)
              ? `${r.route} ${Number(r.cadHrs).toFixed(1)}h`
              : (r.route || "—");
            const cellBase = { padding: "3px 6px" };
            return (
              <tr key={i} data-testid={`qt-comp-${comp.itemIndex}-row-${i}`}
                style={{ borderBottom: "1px solid var(--spot-line)", opacity: excl ? 0.45 : 1 }}>
                <td style={{ ...cellBase, textAlign: "center" }}
                  onClick={() => toggleRowExclude(comp.itemId, r.slotIdx)}>
                  <span style={{
                    display: "inline-block", width: 13, height: 13, borderRadius: 3,
                    border: `2px solid ${excl ? "var(--spot-text3)" : "var(--spot-accent)"}`,
                    background: excl ? "transparent" : "var(--spot-accent)",
                    color: "#fff", fontSize: 10, lineHeight: "10px", textAlign: "center",
                    cursor: "pointer",
                  }}>{excl ? "" : "✓"}</span>
                </td>
                <td style={{ ...cellBase, textAlign: "right", fontWeight: 600 }}>{fmtInt(r.qty)}</td>
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
                <td style={{ ...cellBase, textAlign: "right" }}>{Number(r.freightLine) > 0 ? fmtMoney(r.freightLine) : "—"}</td>
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
