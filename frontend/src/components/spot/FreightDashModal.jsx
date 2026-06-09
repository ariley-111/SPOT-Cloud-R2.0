/* eslint-disable */
/**
 * Freight Dashboard modal — corrected design (2026-06-05):
 *  - NO synthetic comparison. Tiers are driven by SLOT INDEX, not qty values.
 *  - Per Item mode: one row per (component × qty) — each component shipped
 *    alone via its own UTS quote.
 *  - Per Job mode: one row per scenario; each scenario combines all
 *    components at their qty for that scenario (single-qty components repeat
 *    their qty; multi-qty components advance through their array).
 *
 * The modal renders entirely from `state.freightDashCache` which is populated
 * by FreightPanel.updateFreight (one click → both modes computed in parallel).
 * No UTS calls happen inside the modal except via "Update All Rates" which
 * re-runs updateFreight to refresh the cache.
 */
import React, { useState, useMemo } from "react";
import { useQuote } from "../../context/QuoteContext";
import { fmtMoney, fmtInt } from "../../lib/format";

const BOM_TINTS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a", "#9ca3af", "#fbbf24"];

export default function FreightDashModal({ open, onClose, applyScopeFromCache, updateFreight, busy }) {
  const { active, setField } = useQuote();
  const s = active?.state || {};
  const markup = Number(s.freightMarkup ?? 0.15) || 0;
  const bomItems = Array.isArray(s.bomItems) && s.bomItems.length > 0
    ? s.bomItems
    // Single-Part: synthesize a 1-item BOM so the dashboard renders cleanly
    : (s.quoteType === "Multi-Part" ? [] : [{ desc: s.itemDescription || "Single Item" }]);
  const cache = s.freightDashCache || null;
  const currentMode = s.freightScope === "Per Job" ? "Per Job" : "Per Item";
  const isSinglePart = !Array.isArray(s.bomItems) || s.bomItems.length === 0;

  // Filter chips — qty-slot filter (Per Item) or scenario filter (Per Job)
  const [qtyFilter, setQtyFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");

  // Derive totals from the cache (used by the comparison banner + recommendation).
  const perItemTotal = useMemo(() => {
    if (!cache?.perItemQuotes) return 0;
    return cache.perItemQuotes.reduce((a, q) => a + (Number(q.totalAmount) || 0), 0);
  }, [cache]);

  const perJobTotal = useMemo(() => {
    if (!cache?.perJobQuotes) return 0;
    return cache.perJobQuotes.reduce((a, q) => a + (Number(q.totalAmount) || 0), 0);
  }, [cache]);

  // ─── Group Per-Item rows by slot index for display ─────────────────────
  // Per Item view: one section per UNIQUE slot index seen across components,
  // showing each component-qty as its own solo shipment.
  const perItemSections = useMemo(() => {
    if (!cache?.perItemQuotes) return [];
    const bySlot = {};
    cache.perItemQuotes.forEach((q) => {
      if (!bySlot[q.slot]) bySlot[q.slot] = [];
      bySlot[q.slot].push(q);
    });
    return Object.keys(bySlot).map(Number).sort((a, b) => a - b).map((slot) => ({
      slot, rows: bySlot[slot],
    }));
  }, [cache]);

  if (!open) return null;

  const savings = perItemTotal - perJobTotal;
  const savingsPct = perItemTotal > 0 ? (savings / perItemTotal) * 100 : 0;
  const recommendJob = savings > 0 && savingsPct >= 10;

  return (
    <div data-testid="freight-dash-modal" onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        {/* ─── Header ───────────────────────────────────────────────────── */}
        <div style={hdr}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>📦 Freight Dashboard</div>
            <div style={shipToBox}>
              <span style={{ fontSize: 9, color: "var(--spot-text3)", letterSpacing: ".08em" }}>SHIP TO</span>
              <input className="sp-input" value={s.destZip || ""}
                data-testid="freight-dash-zip-input"
                onChange={(e) => setField("destZip", e.target.value)}
                style={{ width: 70, padding: "3px 6px", fontSize: 12, fontWeight: 700, textAlign: "center" }} placeholder="ZIP" />
            </div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {bomItems.length} components · Mode: <b style={{ color: "var(--spot-text)" }}>{currentMode}</b>
            </div>
          </div>
          <button data-testid="freight-dash-close" onClick={onClose} style={closeBtn}>×</button>
        </div>

        {/* ─── FOB / Mode / Markup bar ──────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 16px",
                      borderBottom: "1px solid var(--spot-line)", fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--spot-text3)", fontSize: 10 }}>FOB</span>
            <button data-testid="dash-fob-willcall" onClick={() => setField("quoteFOB", "Origin")}
              style={chip(s.quoteFOB === "Origin", "#94a3b8")}>Will-Call</button>
            <button data-testid="dash-fob-ship" onClick={() => setField("quoteFOB", "Destination")}
              style={chip(s.quoteFOB === "Destination", "#3b82f6")}>Ship</button>
          </div>
          <div style={{ height: 18, width: 1, background: "var(--spot-line)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--spot-text3)", fontSize: 10 }}>Type</span>
            <button data-testid="dash-scope-none" onClick={() => setField("freightScope", "None-Off")}
              style={chip(s.freightScope === "None-Off", "#94a3b8")}>None</button>
            <button data-testid="dash-scope-peritem" onClick={() => { if (cache) applyScopeFromCache("None"); else setField("freightScope", "None"); }}
              style={chip(!s.freightScope || s.freightScope === "None", "#22c55e")}>Per Item</button>
            <button data-testid="dash-scope-perjob" onClick={() => { if (cache) applyScopeFromCache("Per Job"); else setField("freightScope", "Per Job")}}
              style={chip(s.freightScope === "Per Job", "#06b6d4")}>Per Job</button>
          </div>
          <div style={{ height: 18, width: 1, background: "var(--spot-line)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--spot-text3)", fontSize: 10 }}>Markup</span>
            <input className="sp-input" value={s.freightMarkup ?? "0.15"}
              data-testid="dash-markup-input"
              onChange={(e) => setField("freightMarkup", e.target.value)}
              style={{ width: 50, padding: "3px 6px", fontSize: 11, fontWeight: 700, textAlign: "center" }} />
            <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>{(markup * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* ─── ALLOCATE BY / Treatment toolbar (Per Job only, MP only) ──── */}
        {!isSinglePart && s.freightScope === "Per Job" && (
          <FreightAllocBar s={s} setField={setField} markup={markup} />
        )}

        {/* ─── Comparison + recommendation banner ───────────────────────── */}
        {cache && !isSinglePart && (perItemTotal > 0 || perJobTotal > 0) && (
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--spot-line)",
                        background: recommendJob ? "rgba(34,197,94,0.06)" : "rgba(6,182,212,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 8 }}>
              <div style={cmpBox}>
                <div style={cmpLbl}>SHIP INDIVIDUALLY</div>
                <div style={cmpAmt} data-testid="dash-per-item-total">{fmtMoney(perItemTotal)}</div>
                <div style={cmpMarkup} data-testid="dash-per-item-total-markup">
                  w/ markup: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(perItemTotal * (1 + markup))}</b>
                </div>
                <div style={cmpSub}>{cache.perItemQuotes?.length || 0} solo shipments</div>
              </div>
              {savings !== 0 && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, color: savings > 0 ? "var(--spot-green)" : "var(--spot-err)" }}>
                    {savings > 0 ? "↓" : "↑"}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: savings > 0 ? "var(--spot-green)" : "var(--spot-err)" }}
                       data-testid="dash-savings">
                    {fmtMoney(Math.abs(savings))}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>
                    {Math.abs(savingsPct).toFixed(1)}% {savings > 0 ? "cheaper together" : "cheaper apart"}
                  </div>
                </div>
              )}
              <div style={cmpBox}>
                <div style={cmpLbl}>SHIP TOGETHER</div>
                <div style={cmpAmt} data-testid="dash-per-job-total">{fmtMoney(perJobTotal)}</div>
                <div style={cmpMarkup} data-testid="dash-per-job-total-markup">
                  w/ markup: <b style={{ color: "var(--spot-text)" }}>{fmtMoney(perJobTotal * (1 + markup))}</b>
                </div>
                <div style={cmpSub}>{cache.perJobQuotes?.length || 0} combined shipment{cache.perJobQuotes?.length !== 1 ? "s" : ""}</div>
              </div>
            </div>
            {recommendJob && (
              <div data-testid="dash-recommendation"
                   style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 12px", background: "rgba(34,197,94,0.12)",
                            border: "1px solid rgba(34,197,94,0.3)", borderRadius: 4, fontSize: 12 }}>
                <div style={{ color: "var(--spot-green)" }}>
                  <b>✓ Recommendation:</b> Ship together and save {fmtMoney(savings)} ({savingsPct.toFixed(1)}%). Switch to Per Job freight.
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button data-testid="dash-rec-per-item"
                    onClick={() => { if (cache) applyScopeFromCache("None"); }}
                    style={chip(!s.freightScope || s.freightScope === "None", "#94a3b8")}>Per Item</button>
                  <button data-testid="dash-rec-per-job"
                    onClick={() => { if (cache) applyScopeFromCache("Per Job"); }}
                    style={chip(s.freightScope === "Per Job", "#22c55e")}>Per Job</button>
                </div>
              </div>
            )}
            {!recommendJob && savings <= 0 && perJobTotal > 0 && (
              <div data-testid="dash-recommendation"
                   style={{ padding: "6px 12px", fontSize: 11, color: "var(--spot-text3)", textAlign: "center" }}>
                Combined shipment isn't materially cheaper here — stick with Per Item.
              </div>
            )}
          </div>
        )}

        {/* ─── Body: Per Item OR Per Job table (active mode) ────────────── */}
        <div style={{ padding: "10px 16px", overflowY: "auto", flex: 1 }}>
          {!cache ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--spot-text3)", fontSize: 13 }}>
              No freight quotes yet — click <b>Update All Rates</b> below to fetch live UTS quotes for both Per Item and Per Job modes.
            </div>
          ) : currentMode === "Per Item" ? (
            <>
              <PerItemTable cache={cache} bomItems={bomItems} markup={markup} qtyFilter={qtyFilter} itemFilter={itemFilter}
                            sections={perItemSections} setQtyFilter={setQtyFilter} setItemFilter={setItemFilter} />
              {isSinglePart && (
                <div style={{ textAlign: "center", padding: "10px 8px", fontStyle: "italic",
                              fontSize: 11, color: "var(--spot-text3)" }}>
                  Single-item quote. Use "Update All Rates" in the shipment panel to fetch carrier data.
                </div>
              )}
            </>
          ) : (
            <PerJobTable cache={cache} bomItems={bomItems} markup={markup} qtyFilter={qtyFilter} itemFilter={itemFilter}
                         setQtyFilter={setQtyFilter} setItemFilter={setItemFilter} />
          )}
        </div>

        {/* ─── Carrier options table ────────────────────────────────────── */}
        {cache && currentMode === "Per Job" && cache.perJobQuotes?.[0]?.allCarriers?.length > 0 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--spot-line)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
                          textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>
              Carrier Options
            </div>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--spot-text3)" }}>
                  <th style={th}>Carrier</th>
                  <th style={{ ...th, textAlign: "right" }}>Rate</th>
                  <th style={{ ...th, textAlign: "right" }}>w/ Markup</th>
                  <th style={{ ...th, textAlign: "right" }}>Transit</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {(cache.perJobQuotes[0].allCarriers || []).slice(0, 6).map((c, i) => {
                  const isActive = c.name === s.freightCarrier;
                  const wm = (c.total || 0) * (1 + markup);
                  // Backend's allCarriers maps transitDays → "transit" — accept either.
                  const transit = c.transit != null ? c.transit : c.transitDays;
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--spot-line)",
                                         background: isActive ? "rgba(34,197,94,0.08)" : "transparent" }}>
                      <td style={{ padding: "5px 6px", fontWeight: 700 }}>
                        {c.name}
                        {isActive && <span style={{ marginLeft: 8, fontSize: 9, padding: "2px 6px",
                                                     background: "var(--spot-green)", color: "#fff",
                                                     borderRadius: 2, fontWeight: 800, letterSpacing: ".05em" }}>ACTIVE</span>}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "right" }}>{fmtMoney(c.total || 0)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: "var(--spot-green)" }}>{fmtMoney(wm)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "right", color: "var(--spot-text3)" }}>
                        {transit != null ? `${transit} day${transit === 1 ? "" : "s"}` : "—"}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "right" }}>
                        {!isActive && (
                          <button data-testid={`dash-use-carrier-${i}`}
                            onClick={() => setField("freightCarrier", c.name)}
                            style={useBtn}>Use</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* FedEx / UPS placeholders */}
                <tr style={{ borderTop: "1px solid var(--spot-line)", opacity: 0.5 }}>
                  <td style={{ padding: "5px 6px", fontStyle: "italic" }}>FedEx Direct API</td>
                  <td colSpan={3} style={{ padding: "5px 6px", textAlign: "right", color: "var(--spot-text3)", fontSize: 10 }}>
                    Connect in Admin → Integrations
                  </td>
                  <td></td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--spot-line)", opacity: 0.5 }}>
                  <td style={{ padding: "5px 6px", fontStyle: "italic" }}>UPS Direct API</td>
                  <td colSpan={3} style={{ padding: "5px 6px", textAlign: "right", color: "var(--spot-text3)", fontSize: 10 }}>
                    Connect in Admin → Integrations
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Footer ───────────────────────────────────────────────────── */}
        <div style={ftr}>
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--spot-text3)" }}>
            <span><b style={{ color: "var(--spot-text)" }}>FOB:</b> {s.quoteFOB === "Origin" ? "Will-Call" : "Destination"}</span>
            <span><b style={{ color: "var(--spot-text)" }}>Scope:</b> {currentMode}</span>
            <span><b style={{ color: "var(--spot-text)" }}>Markup:</b> {(markup * 100).toFixed(1)}%</span>
            <span><b style={{ color: "var(--spot-text)" }}>Ship To:</b> {s.destZip || "—"}</span>
            {cache?.lastCalcAt && (
              <span><b style={{ color: "var(--spot-text)" }}>Last Calc:</b> {new Date(cache.lastCalcAt).toLocaleTimeString()}</span>
            )}
          </div>
          <button data-testid="dash-update-rates" onClick={updateFreight} disabled={busy || !s.destZip}
            style={{
              all: "unset", cursor: busy || !s.destZip ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 4,
              background: busy || !s.destZip ? "var(--spot-bg3)" : "var(--spot-accent)",
              color: busy || !s.destZip ? "var(--spot-text3)" : "#fff",
              opacity: busy ? 0.7 : 1,
            }}>{busy ? "Calculating…" : (cache ? "Update All Rates" : "Calculate Freight")}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Per Item table — one section per slot, one row per component-qty ──
function PerItemTable({ cache, bomItems, markup, qtyFilter, itemFilter, sections, setQtyFilter, setItemFilter }) {
  // Build the unique qtys for the filter chips
  const uniqueQtys = useMemo(() => {
    const set = new Set();
    (cache?.perItemQuotes || []).forEach((q) => set.add(q.qty));
    return Array.from(set).sort((a, b) => a - b);
  }, [cache]);

  return (
    <>
      <FilterChips uniqueQtys={uniqueQtys} qtyFilter={qtyFilter} setQtyFilter={setQtyFilter}
                   bomItems={bomItems} itemFilter={itemFilter} setItemFilter={setItemFilter}
                   markup={markup} />
      {sections.map(({ slot, rows }) => {
        const visible = rows.filter((r) =>
          (qtyFilter === "all" || String(r.qty) === String(qtyFilter)) &&
          (itemFilter === "all" || String(r.idx) === String(itemFilter))
        );
        if (visible.length === 0) return null;
        const totalLbs = visible.reduce((a, r) => a + (r.ship.totalWeight || 0), 0);
        const totalSkids = visible.reduce((a, r) => a + (r.ship.skidCount || 0), 0);
        const totalFt = visible.reduce((a, r) => a + (r.ship.trailerFeet || 0), 0);
        const rawTotal = visible.reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
        const wmTotal = rawTotal * (1 + markup);
        return (
          <div key={slot} style={tierBox} data-testid={`dash-per-item-slot-${slot}`}>
            <div style={tierHdr}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>Slot {slot + 1}</span>
              <span style={tierMeta}>{fmtInt(totalLbs)} lbs · {totalSkids} skid{totalSkids !== 1 ? "s" : ""} · {totalFt} ft</span>
              <span style={{ marginLeft: "auto", fontSize: 12 }}>
                <span style={{ color: "var(--spot-text3)" }}>Raw:</span> <b>{fmtMoney(rawTotal)}</b>
                <span style={{ color: "var(--spot-text3)", marginLeft: 12 }}>w/ Markup:</span>
                <b style={{ color: "var(--spot-green)", marginLeft: 4 }}>{fmtMoney(wmTotal)}</b>
              </span>
            </div>
            <table style={tbl}>
              <thead><tr style={{ color: "var(--spot-text3)" }}>
                <th style={th}>Component</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>Product</th>
                <th style={{ ...th, textAlign: "right" }}>Skid</th>
                <th style={{ ...th, textAlign: "right" }}>Total Wt</th>
                <th style={{ ...th, textAlign: "right" }}>Skids</th>
                <th style={{ ...th, textAlign: "right" }}>Ft</th>
                <th style={{ ...th, textAlign: "right" }}>Freight</th>
                <th style={{ ...th, textAlign: "right" }}>w/ Markup</th>
              </tr></thead>
              <tbody>
                {visible.map((r, i) => {
                  const tint = BOM_TINTS[r.idx % BOM_TINTS.length];
                  const wm = (Number(r.totalAmount) || 0) * (1 + markup);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--spot-line)" }}>
                      <td style={tdName}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3,
                                       background: tint, marginRight: 6 }} />
                        {bomItems[r.idx]?.desc || `Item ${r.idx + 1}`}
                      </td>
                      <td style={tdNum}>{fmtInt(r.qty)}</td>
                      <td style={tdNum}>{Math.round(r.ship.productWeight)}</td>
                      <td style={tdNum}>{r.ship.skidTotalWeight}</td>
                      <td style={{ ...tdNum, fontWeight: 700 }}>{Math.round(r.ship.totalWeight)}</td>
                      <td style={tdNum}>{r.ship.skidCount}({r.ship.skidKey})</td>
                      <td style={tdNum}>{r.ship.trailerFeet}</td>
                      <td style={tdNum}>{fmtMoney(Number(r.totalAmount) || 0)}</td>
                      <td style={{ ...tdNum, fontWeight: 700, color: "var(--spot-green)" }}>{fmtMoney(wm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

// ─── Per Job table — one section per scenario ──────────────────────────
function PerJobTable({ cache, bomItems, markup, qtyFilter, itemFilter, setQtyFilter, setItemFilter }) {
  const scenarios = cache?.perJobQuotes || [];
  // Unique qtys for filter chips = union of all qtys appearing in any scenario
  const uniqueQtys = useMemo(() => {
    const set = new Set();
    scenarios.forEach((sc) => (sc.perComp || []).forEach((p) => set.add(p.qty)));
    return Array.from(set).sort((a, b) => a - b);
  }, [scenarios]);

  return (
    <>
      <FilterChips uniqueQtys={uniqueQtys} qtyFilter={qtyFilter} setQtyFilter={setQtyFilter}
                   bomItems={bomItems} itemFilter={itemFilter} setItemFilter={setItemFilter}
                   markup={markup} />
      {scenarios.map((sc) => {
        const visibleRows = (sc.perComp || []).filter((p) =>
          (qtyFilter === "all" || String(p.qty) === String(qtyFilter)) &&
          (itemFilter === "all" || String(p.idx) === String(itemFilter))
        );
        if (visibleRows.length === 0) return null;
        const raw = Number(sc.totalAmount) || 0;
        const wm = raw * (1 + markup);
        const combinedWt = sc.combinedWeight || 0;
        return (
          <div key={sc.scenarioIdx} style={tierBox} data-testid={`dash-per-job-scenario-${sc.scenarioIdx}`}>
            <div style={tierHdr}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>
                Scenario {sc.scenarioIdx + 1}
              </span>
              <span style={tierMeta}>
                {fmtInt(Math.round(combinedWt))} lbs · {sc.combinedSkids} skid{sc.combinedSkids !== 1 ? "s" : ""} · {sc.combinedFt} ft combined
              </span>
              <span style={{ marginLeft: "auto", fontSize: 12 }}>
                <span style={{ color: "var(--spot-text3)" }}>Raw:</span> <b>{fmtMoney(raw)}</b>
                <span style={{ color: "var(--spot-text3)", marginLeft: 12 }}>w/ Markup:</span>
                <b style={{ color: "var(--spot-green)", marginLeft: 4 }}>{fmtMoney(wm)}</b>
              </span>
            </div>
            <table style={tbl}>
              <thead><tr style={{ color: "var(--spot-text3)" }}>
                <th style={th}>Component</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>Product</th>
                <th style={{ ...th, textAlign: "right" }}>Skid</th>
                <th style={{ ...th, textAlign: "right" }}>Total Wt</th>
                <th style={{ ...th, textAlign: "right" }}>Wt %</th>
                <th style={{ ...th, textAlign: "right" }}>Skids</th>
                <th style={{ ...th, textAlign: "right" }}>Ft</th>
                <th style={{ ...th, textAlign: "right" }}>Freight</th>
                <th style={{ ...th, textAlign: "right" }}>w/ Markup</th>
              </tr></thead>
              <tbody>
                {visibleRows.map((p, i) => {
                  const tint = BOM_TINTS[p.idx % BOM_TINTS.length];
                  const myW = p.ship.totalWeight || 0;
                  const pct = combinedWt > 0 ? (myW / combinedWt) * 100 : 0;
                  const myRaw = combinedWt > 0 ? raw * (myW / combinedWt) : 0;
                  const myWm = myRaw * (1 + markup);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--spot-line)" }}>
                      <td style={tdName}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3,
                                       background: tint, marginRight: 6 }} />
                        {bomItems[p.idx]?.desc || `Item ${p.idx + 1}`}
                      </td>
                      <td style={tdNum}>{fmtInt(p.qty)}</td>
                      <td style={tdNum}>{Math.round(p.ship.productWeight)}</td>
                      <td style={tdNum}>{p.ship.skidTotalWeight}</td>
                      <td style={{ ...tdNum, fontWeight: 700 }}>{Math.round(myW)}</td>
                      <td style={tdNum}>{pct.toFixed(1)}%</td>
                      <td style={tdNum}>{p.ship.skidCount}({p.ship.skidKey})</td>
                      <td style={tdNum}>{p.ship.trailerFeet}</td>
                      <td style={tdNum}>{fmtMoney(myRaw)}</td>
                      <td style={{ ...tdNum, fontWeight: 700, color: "var(--spot-green)" }}>{fmtMoney(myWm)}</td>
                    </tr>
                  );
                })}
                {visibleRows.length === sc.perComp.length && (
                  <tr style={{ borderTop: "2px solid var(--spot-border)", fontWeight: 700, background: "var(--spot-bg3)" }}>
                    <td style={tdName}>Combined</td>
                    <td style={tdNum}>{fmtInt(sc.perComp.reduce((a, p) => a + p.qty, 0))}</td>
                    <td style={tdNum}>{Math.round(sc.perComp.reduce((a, p) => a + p.ship.productWeight, 0))}</td>
                    <td style={tdNum}>{sc.perComp.reduce((a, p) => a + p.ship.skidTotalWeight, 0)}</td>
                    <td style={tdNum}>{Math.round(combinedWt)}</td>
                    <td style={tdNum}>100.0%</td>
                    <td style={tdNum}>{sc.combinedSkids}</td>
                    <td style={tdNum}>{sc.combinedFt}</td>
                    <td style={tdNum}>{fmtMoney(raw)}</td>
                    <td style={{ ...tdNum, color: "var(--spot-green)" }}>{fmtMoney(wm)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function FilterChips({ uniqueQtys, qtyFilter, setQtyFilter, bomItems, itemFilter, setItemFilter, markup }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {uniqueQtys.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: "var(--spot-text3)", fontWeight: 700, letterSpacing: ".06em",
                         textTransform: "uppercase", fontSize: 9, minWidth: 30 }}>QTY</span>
          {uniqueQtys.map((q) => (
            <button key={q} data-testid={`dash-chip-qty-${q}`} onClick={() => setQtyFilter(String(q))}
                    style={chipFilter(String(qtyFilter) === String(q), "#3b82f6")}>{fmtInt(q)}</button>
          ))}
          <button data-testid="dash-chip-qty-all" onClick={() => setQtyFilter("all")}
                  style={chipFilter(qtyFilter === "all", "#94a3b8")}>All</button>
          <span style={{ marginLeft: 12, color: "var(--spot-text3)", fontSize: 10 }}>
            Markup: <b style={{ color: "var(--spot-text)" }}>{(markup * 100).toFixed(1)}%</b>
          </span>
        </div>
      )}
      {bomItems.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: "var(--spot-text3)", fontWeight: 700, letterSpacing: ".06em",
                         textTransform: "uppercase", fontSize: 9, minWidth: 30 }}>ITEMS</span>
          {bomItems.map((bi, i) => {
            const tint = BOM_TINTS[i % BOM_TINTS.length];
            return (
              <button key={i} data-testid={`dash-chip-item-${i}`} onClick={() => setItemFilter(String(i))}
                      style={chipFilter(String(itemFilter) === String(i), tint)}>
                {bi.desc || `Item ${i + 1}`}
              </button>
            );
          })}
          <button data-testid="dash-chip-item-all" onClick={() => setItemFilter("all")}
                  style={chipFilter(itemFilter === "all", "#94a3b8")}>All</button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modal = { width: "min(1100px, 96vw)", maxHeight: "94vh", background: "var(--spot-bg)",
                borderRadius: 6, border: "1px solid var(--spot-border)",
                display: "flex", flexDirection: "column", overflow: "hidden",
                boxShadow: "0 24px 64px rgba(0,0,0,0.6)" };
const hdr = { padding: "14px 16px", borderBottom: "1px solid var(--spot-line)",
              display: "flex", justifyContent: "space-between", alignItems: "center" };
const shipToBox = { display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 8px", background: "var(--spot-bg3)",
                    border: "1px solid var(--spot-border)", borderRadius: 4 };
const closeBtn = { all: "unset", cursor: "pointer", fontSize: 24,
                   color: "var(--spot-text3)", padding: "0 8px" };
const cmpBox = { textAlign: "center", padding: "8px 16px" };
const cmpLbl = { fontSize: 9, fontWeight: 700, color: "var(--spot-text3)",
                 textTransform: "uppercase", letterSpacing: ".08em" };
const cmpAmt = { fontSize: 22, fontWeight: 800, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" };
const cmpMarkup = { fontSize: 10, color: "var(--spot-text3)", marginTop: 3 };
const cmpSub = { fontSize: 10, color: "var(--spot-text3)", marginTop: 2 };
const tierBox = { padding: "10px 12px", borderRadius: 4, border: "1px solid var(--spot-line)",
                  marginBottom: 10, background: "var(--spot-bg2)" };
const tierHdr = { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 };
const tierMeta = { fontSize: 11, color: "var(--spot-text3)" };
const tbl = { width: "100%", fontSize: 11, borderCollapse: "collapse" };
const th = { padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
             letterSpacing: ".06em", textAlign: "left", color: "var(--spot-text3)" };
const tdName = { padding: "5px 6px" };
const tdNum = { padding: "5px 6px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" };
const ftr = { display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", borderTop: "1px solid var(--spot-line)",
              background: "var(--spot-bg2)" };
const useBtn = { all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
                 padding: "3px 10px", borderRadius: 3,
                 background: "var(--spot-accent)", color: "#fff" };

function chip(active, color) {
  return {
    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
    padding: "4px 10px", borderRadius: 3,
    background: active ? color : "var(--spot-bg3)",
    color: active ? "#fff" : "var(--spot-text2)",
    border: `1px solid ${active ? color : "var(--spot-border)"}`,
  };
}
function chipFilter(active, color) {
  return {
    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
    padding: "3px 10px", borderRadius: 3,
    background: active ? color : "var(--spot-bg3)",
    color: active ? "#fff" : "var(--spot-text2)",
    border: `1px solid ${active ? color : "var(--spot-border)"}`,
  };
}

// ─── Allocate-By / Treatment toolbar ─────────────────────────────────
// Mirrors the legacy "ALLOCATE BY" + "Treatment" controls. Wires to:
//   - freightAllocMethod (Board MSF | Equal Split | By Weight)
//   - jobFreightTreatment (Separate Line | Amortize)
// NOTE on "By Weight": legacy `allocateJobCost` (spot_r1_5.jsx L897-917)
// silently falls back to By MSF when the method is anything other than
// "Equal" — so "By Weight" produces identical math to "By MSF" in the
// legacy engine. Cloud mirrors this for pricing parity.
function FreightAllocBar({ s, setField, markup }) {
  const method = s.freightAllocMethod || "By MSF";
  const treat = s.jobFreightTreatment || "Separate Line";
  const jobFreight = Number(s.jobFreightCost || 0);
  const allocChip = (label, value) => ({
    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: method === value ? 700 : 500,
    padding: "4px 10px", borderRadius: 3,
    background: method === value ? "rgba(59,130,246,0.2)" : "transparent",
    color: method === value ? "#3b82f6" : "var(--spot-text3)",
    border: `1px solid ${method === value ? "rgba(59,130,246,0.4)" : "var(--spot-border)"}`,
  });
  const treatChip = (label, value) => ({
    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: treat === value ? 700 : 500,
    padding: "4px 10px", borderRadius: 3,
    background: treat === value ? "rgba(59,130,246,0.2)" : "transparent",
    color: treat === value ? "#3b82f6" : "var(--spot-text3)",
    border: `1px solid ${treat === value ? "rgba(59,130,246,0.4)" : "var(--spot-border)"}`,
  });
  return (
    <div data-testid="freight-alloc-bar" style={{
      display: "flex", alignItems: "center", gap: 14, padding: "8px 16px",
      borderBottom: "1px solid var(--spot-line)", fontSize: 12, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
        textTransform: "uppercase", letterSpacing: ".08em" }}>Allocate By</span>
      <button data-testid="alloc-board-msf"
        onClick={() => setField("freightAllocMethod", "By MSF")}
        style={allocChip("Board MSF", "By MSF")}>Board MSF</button>
      <button data-testid="alloc-equal"
        onClick={() => setField("freightAllocMethod", "Equal")}
        style={allocChip("Equal Split", "Equal")}>Equal Split</button>
      <button data-testid="alloc-by-weight"
        onClick={() => setField("freightAllocMethod", "By Weight")}
        title="Legacy behavior: 'By Weight' produces identical math to Board MSF."
        style={allocChip("By Weight", "By Weight")}>By Weight</button>

      <span style={{ height: 18, width: 1, background: "var(--spot-line)" }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
        textTransform: "uppercase", letterSpacing: ".08em" }}>Treatment:</span>
      <button data-testid="treat-line-item"
        onClick={() => setField("jobFreightTreatment", "Separate Line")}
        style={treatChip("Line Item", "Separate Line")}>Line Item</button>
      <button data-testid="treat-amortize"
        onClick={() => setField("jobFreightTreatment", "Amortize")}
        style={treatChip("Amortize", "Amortize")}>Amortize</button>

      <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11, color: "var(--spot-text3)" }}>
        <span data-testid="alloc-job-freight">
          <b style={{ color: "var(--spot-text)" }}>Job Freight:</b>{" "}
          <span style={{ color: "var(--spot-green)", fontWeight: 700 }}>
            {fmtMoney(jobFreight * (1 + markup))}
          </span>
        </span>
        <span><b style={{ color: "var(--spot-text)" }}>Markup:</b> {(markup * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

