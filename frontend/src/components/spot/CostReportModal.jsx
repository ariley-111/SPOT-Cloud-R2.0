/* eslint-disable */
import React from "react";
import Modal from "./Modal";
import { useQuote } from "../../context/QuoteContext";
import { useEngine } from "../../hooks/useEngine";
import { fmtMoney, fmtPct, fmtInt, fmtNum, fmtDim } from "../../lib/format";

/* ─── Internal Cost Report — 1:1 port of legacy spot_r1_5.jsx L8021-8252 ───
 *  NOT customer facing. Shows the full per-component cost build-up the
 *  estimator reviews before sending a quote: per-item detail tables
 *  (Material / Print / Cutter / Finish / Freight / OH / Tot Mfg / $/MSF /
 *  Sell / S/MSF / GM% / GM$) plus a Kit Rollup for multi-part quotes. */

const linerShort = (v) => (!v || v === "None") ? "Kraft" : String(v).replace("42# ", "");

const fmt0 = (n) => fmtMoney(n, 0);

// Legacy column set (17 cols)
const COLS = ["Qty", "Sheets", "MSF", "Sheet", "Route", "Material", "Print",
  "Cutter", "Finish", "Frt", "OH", "Tot Mfg", "$/MSF", "Sell", "S/MSF", "GM%", "GM$"];

// Normalize a Simple result row OR an MP componentPricing row into the
// fields the report columns need. Both shapes already expose these keys.
function norm(r, saberOn) {
  const oMSF = Number(r.oMSF || 0);
  const route = r.route || "—";
  const dispRoute = (route === "Saber + D/C" && !saberOn) ? "CAD" : route;
  const material = Number(r.matTotal || 0) + Number(r.matMakeready || 0);
  const cutter = Number(r.cutterDirect || 0) + Number(r.saberCost || 0);
  const finish = Number(r.stripCost || 0) + Number(r.assemblyCost || 0);
  const frt = Number(r.freightLine || 0) + Number(r.freightEmbed || 0);
  const totalMfg = Number(r.totalMfg || 0);
  const sellTotal = Number(r.sellTotal || 0);
  const itemSell = Number(r.itemSell || 0);
  return {
    qty: Number(r.qty ?? r.totalQty ?? 0),
    sheetsReq: Number(r.sheetsReq || 0),
    oMSF,
    sheetW: Number(r.sheetW || (r.sheet && r.sheet.w) || 0),
    sheetL: Number(r.sheetL || (r.sheet && r.sheet.l) || 0),
    route: dispRoute,
    material, print: Number(r.printDirect || 0), cutter, finish, frt,
    overhead: Number(r.overhead || 0),
    totalMfg, sellTotal, itemSell,
    costMSF: oMSF > 0 ? totalMfg / oMSF : null,
    sellMSF: oMSF > 0 ? itemSell / oMSF : null,
    gmPct: Number(r.gmPct || 0),
    gmDollar: Number(r.gmDollar ?? r["gm$"] ?? 0),
    pricable: r.pricable !== false,
  };
}

const TYPE_META = {
  Manufactured: { lbl: "MFG", color: "#22c55e" },
  Fulfillment:  { lbl: "FUL", color: "#f59e0b" },
  Purchased:    { lbl: "PUR", color: "#3b82f6" },
};

export default function CostReportModal({ onClose }) {
  const { active } = useQuote();
  const s = active.state || {};
  const { results, componentPricing, isMultiPart, loading } = useEngine(s);

  const isMatchedSet = isMultiPart && (s.pricingMode === "Matched Set");

  // ── Build per-item report rows ──
  let reportItems = [];
  if (isMultiPart && (componentPricing || []).length > 0) {
    reportItems = componentPricing.map((c) => {
      const bs = c.boardSpec || {};
      return {
        key: c.itemId || c.itemIndex,
        childNum: `${c.itemIndex + 1}`,
        desc: c.desc, type: c.type || "Manufactured",
        pcsPerSet: c.pcsPerSet, saberOn: false,
        spec: bs.boardGrade ? `${bs.boardGrade}# ${bs.flute || ""} OL:${linerShort(bs.outsideLiner)} IL:${linerShort(bs.insideLiner)}${(bs.medium && bs.medium !== "None") ? " MD:" + bs.medium : ""}` : "—",
        dims: Number(bs.oneUpW) > 0 ? `${fmtNum(bs.oneUpW, 2)}×${fmtNum(bs.oneUpL, 2)}` : "—",
        print: (bs.printReq || "Yes") === "Yes" ? (bs.printMode || "Satin") + (bs.printSides === "2-Sided" ? " 2S" : "") : "No Print",
        rows: (c.rows || []).filter((r) => r.pricable !== false).map((r) => norm(r, false)),
      };
    });
  } else {
    reportItems = [{
      key: 0, childNum: "", desc: s.itemDesc || s.custIdent || "Item",
      type: "Manufactured", pcsPerSet: 1, saberOn: s.saber === "Yes",
      spec: `${s.boardGrade || "200"}# ${s.flute || "B"} OL:${linerShort(s.outsideLiner)} IL:${linerShort(s.insideLiner)}${(s.medium && s.medium !== "None") ? " MD:" + s.medium : ""}`,
      dims: Number(s.oneUpW) > 0 ? `${fmtNum(s.oneUpW, 2)}×${fmtNum(s.oneUpL, 2)}` : "—",
      print: (s.printReq || "Yes") === "Yes" ? (s.printMode || "Satin") + (s.printSides === "2-Sided" ? " 2S" : "") : "No Print",
      rows: (results || []).filter((r) => !r.error && r.pricable !== false).map((r) => norm(r, s.saber === "Yes")),
    }];
  }
  const anyRows = reportItems.some((it) => it.rows.length > 0);

  // ── Kit Rollup (multi-part, 2+ components) ──
  let rollup = [];
  if (isMultiPart && (componentPricing || []).length > 1 && (results || []).length > 0) {
    rollup = (results || []).filter((sl) => !sl.error).map((sl) => {
      const components = (componentPricing || []).filter(
        (c) => (c.rows || []).some((r) => r.slotIdx === sl.slot)
      ).length;
      const totalMfg = Number(sl.totalMfg || 0);
      const totalSell = Number(sl.sellTotal || 0);
      const itemSell = Number(sl.itemSell || sl.itemsSell || 0);
      return {
        slot: sl.slot,
        setQty: Number(sl.setQty ?? sl.qty ?? 0),
        components,
        totalMfg,
        charges: Math.max(0, totalSell - itemSell),
        totalSell,
        gmDollar: Number(sl.gmDollar ?? sl["gm$"] ?? (totalSell - totalMfg)),
        gmPct: Number(sl.gmPct || (totalSell > 0 ? (totalSell - totalMfg) / totalSell : 0)),
        pricePerSet: Number(sl.setSell || 0),
      };
    }).filter((r) => r.totalSell > 0).sort((a, b) => a.setQty - b.setQty);
  }

  // ── FOB / Freight / Prepress / Pricing summary bar ──
  const fob = s.quoteFOB || "Origin";
  const isShip = fob === "Destination";
  const pricingLabel = isMatchedSet
    ? (s.setMarginOverride ? `Matched Set @ ${fmtPct(Number(s.setMarginPct || 0), 1)} GM` : "Matched Set (Item Margins)")
    : isMultiPart ? "Individual" : "Simple";

  const title = (
    <span>
      <span style={{ color: "var(--spot-purple)" }}>Internal Cost Report</span>
      <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 8, fontWeight: 400 }}>
        {s.estNum || "(draft)"}{s.custName ? ` — ${s.custName}` : ""}{s.custRef ? ` — ${s.custRef}` : ""}
      </span>
    </span>
  );

  return (
    <Modal title={title} onClose={onClose} width={940} data-testid="modal-cost-report"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Internal Use Only — Not Customer Facing</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>{s.estInitials || ""} · {new Date().toLocaleDateString()}</span>
            <button className="sp-btn" onClick={() => window.print()} data-testid="cost-report-print-btn">Print</button>
            <button className="sp-btn" onClick={onClose} data-testid="cost-report-close-btn">Close</button>
          </span>
        </div>
      }>

      {/* Summary bar */}
      <div data-testid="cost-report-summary" style={{
        marginBottom: 12, padding: "6px 10px", borderRadius: 5, background: "var(--spot-bg2)",
        display: "flex", gap: 16, fontSize: 11, color: "var(--spot-text2)", flexWrap: "wrap",
      }}>
        <span><b>FOB:</b> {fob === "Origin" ? "Will-Call" : fob === "LocalDelivery" ? "Local Delivery" : "Ship (Destination)"}</span>
        {isShip && isMultiPart && (
          <span><b>Freight:</b> {s.freightScope === "None"
            ? <span style={{ color: "var(--spot-orange)" }}>No Charge (absorbed){Number(s.jobFreightCost) > 0 ? ` — actual: ${fmtMoney(Number(s.jobFreightCost))}` : ""}</span>
            : s.freightScope === "Per Job" ? `Per Job — ${fmtMoney(Number(s.jobFreightCost || 0))} (${s.jobFreightTreatment || ""})`
            : "Per Item"}</span>
        )}
        {isShip && !isMultiPart && (
          <span><b>Freight:</b> {(s.freightTreatment || "None") === "None"
            ? <span style={{ color: "var(--spot-orange)" }}>No Charge (absorbed){Number(s.freightCost) > 0 ? ` — actual: ${fmtMoney(Number(s.freightCost))}` : ""}</span>
            : `${s.freightTreatment} — ${fmtMoney(Number(s.freightCost || 0))}`}</span>
        )}
        {isMultiPart && (
          <span><b>Prepress:</b> {s.prepressScope === "None" ? "None" : s.prepressScope === "Per Job" ? `Lot — ${fmtMoney(Number(s.jobPrepressCost || 0))}` : "Per Item"}</span>
        )}
        <span><b>Pricing:</b> {pricingLabel}</span>
      </div>

      {loading && <div data-testid="cost-report-loading" style={{ color: "var(--spot-text3)", padding: 8 }}>Calculating…</div>}

      {!loading && !anyRows && (
        <div data-testid="cost-report-empty" style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--spot-text3)" }}>
          No items to report. Enter dimensions and quantities first.
        </div>
      )}

      {/* Per-item detail cards */}
      {reportItems.map((item, ri) => {
        const tm = TYPE_META[item.type] || TYPE_META.Manufactured;
        return (
          <div key={item.key} data-testid={`cost-report-item-${ri}`} style={{
            marginBottom: 12, border: "1px solid var(--spot-border)", borderRadius: 6, overflow: "hidden",
            pageBreakInside: "avoid",
          }}>
            {/* Item header */}
            <div style={{
              padding: "8px 12px", background: tm.color + "15", borderBottom: "1px solid var(--spot-line)",
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            }}>
              {item.childNum && <Badge color={tm.color}>{item.childNum}</Badge>}
              <Badge color={tm.color}>{tm.lbl}</Badge>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)" }}>{item.desc || "(untitled)"}</span>
              {isMultiPart && <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>{item.pcsPerSet} pc/set</span>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--spot-text2)" }}>{item.spec}</span>
              <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>{item.dims}</span>
              <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>{item.print}</span>
            </div>
            {/* Detail table */}
            {item.rows.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }} data-testid={`cost-report-table-${ri}`}>
                <thead>
                  <tr style={{ background: "var(--spot-bg3)" }}>
                    {COLS.map((h, hi) => (
                      <th key={hi} style={{ padding: hi === 0 ? "4px 8px" : "4px 5px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "var(--spot-text3)", borderBottom: "1px solid var(--spot-line)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {item.rows.map((r, di) => (
                    <tr key={di} data-testid={`cost-report-row-${ri}-${di}`} style={{ borderBottom: "1px solid var(--spot-line)", background: di % 2 ? "var(--spot-bg2)" : "transparent" }}>
                      <C bold>{fmtInt(r.qty)}</C>
                      <C>{fmtInt(r.sheetsReq)}</C>
                      <C>{fmtNum(r.oMSF, 1)}</C>
                      <C>{r.sheetW > 0 ? `${fmtDim(r.sheetW)}×${fmtDim(r.sheetL)}` : "—"}</C>
                      <C>{r.route}</C>
                      <C>{fmt0(r.material)}</C>
                      <C>{fmt0(r.print)}</C>
                      <C>{fmt0(r.cutter)}</C>
                      <C>{fmt0(r.finish)}</C>
                      <C style={{ color: r.frt > 0 ? "var(--spot-orange)" : undefined }}>{r.frt > 0 ? fmt0(r.frt) : "$0"}</C>
                      <C>{fmt0(r.overhead)}</C>
                      <C bold>{fmt0(r.totalMfg)}</C>
                      <C bold style={{ color: "var(--spot-text2)" }}>{r.costMSF != null ? fmt0(r.costMSF) : "—"}</C>
                      <C bold style={{ color: "#3b82f6" }}>{fmt0(r.sellTotal)}</C>
                      <C bold style={{ color: "#3b82f6" }}>{r.sellMSF != null ? fmt0(r.sellMSF) : "—"}</C>
                      <C style={{ color: r.gmPct >= 0 ? "var(--spot-green)" : "#ef4444" }}>{fmtPct(r.gmPct, 1)}</C>
                      <C style={{ color: r.gmDollar >= 0 ? "var(--spot-green)" : "#ef4444" }}>{fmt0(r.gmDollar)}</C>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "var(--spot-text3)", fontStyle: "italic" }}>
                Enter dimensions and quantities to see costs
              </div>
            )}
          </div>
        );
      })}

      {/* Kit Rollup (Multi-Part) */}
      {rollup.length > 0 && (
        <div data-testid="cost-report-rollup" style={{ marginTop: 8, border: "1px solid #f59e0b44", borderRadius: 6, overflow: "hidden", pageBreakInside: "avoid" }}>
          <div style={{ padding: "8px 12px", background: "#f59e0b15", borderBottom: "1px solid #f59e0b22" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Kit Rollup</span>
            {isMatchedSet && <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 8 }}>{pricingLabel}</span>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--spot-bg3)" }}>
                {["Set Qty", "Components", "Total Cost", "Charges", "Total Sell", "GM$", "GM%"].concat(isMatchedSet ? ["Price/Set"] : []).map((h, hi) => (
                  <th key={hi} style={{ padding: "5px 8px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--spot-text3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rollup.map((r, ri) => (
                <tr key={ri} data-testid={`cost-report-rollup-row-${ri}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                  <C bold>{fmtInt(r.setQty)}</C>
                  <C>{r.components}</C>
                  <C>{fmt0(r.totalMfg)}</C>
                  <C style={{ color: "#f59e0b" }}>{fmt0(r.charges)}</C>
                  <C bold style={{ color: "#3b82f6" }}>{fmt0(r.totalSell)}</C>
                  <C style={{ color: r.gmDollar >= 0 ? "var(--spot-green)" : "#ef4444" }}>{fmt0(r.gmDollar)}</C>
                  <C style={{ color: r.gmPct >= 0 ? "var(--spot-green)" : "#ef4444" }}>{fmtPct(r.gmPct, 1)}</C>
                  {isMatchedSet && <C bold style={{ color: "#f59e0b" }}>{r.pricePerSet > 0 ? fmt0(r.pricePerSet) : "—"}</C>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

const Badge = ({ color, children }) => (
  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: color + "22", color }}>{children}</span>
);
const C = ({ children, bold, style }) => (
  <td style={{ padding: "4px 5px", textAlign: "right", fontWeight: bold ? 600 : 400, fontVariantNumeric: "tabular-nums", color: "var(--spot-text2)", ...style }}>{children}</td>
);
