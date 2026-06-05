/* eslint-disable */
import React, { useState, useMemo } from "react";
import { useQuote } from "../../context/QuoteContext";
import { fmtMoney, fmtInt } from "../../lib/format";
import { freightQuote } from "../../api/spot";

// Port of legacy Freight Dashboard (spot_r1_5.jsx). Shows Ship Individually
// vs Ship Together comparison, per-qty-tier breakdown with components and
// weight allocation, and carrier options. Opens via btn-freight-dash in the
// Freight section.
const lbsPerSqFt = 0.5;
const BOM_TINTS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a", "#9ca3af", "#fbbf24"];

export default function FreightDashModal({ open, onClose }) {
  const { active, setField } = useQuote();
  const s = active?.state || {};
  const markup = Number(s.freightMarkup ?? 0.15) || 0;
  const bomItems = Array.isArray(s.bomItems) ? s.bomItems : [];
  const topQtys = (s.qtys || []).map((q) => parseInt(q || 0, 10)).filter((q) => q > 0);
  // Each component's own qty (first non-zero) — used in MP-Individual
  const compOwnQty = bomItems.map((it) => {
    const qs = (it.state || {}).qtys || [];
    for (let i = 0; i < qs.length; i++) {
      const v = parseInt(qs[i] || 0, 10);
      if (v > 0) return v;
    }
    return 0;
  });
  // Unique qty tiers to display panels for. In MP-Individual, the unique
  // per-component qtys; in MP-Matched-Set, the top-level qtys.
  const tierQtys = useMemo(() => {
    const set = new Set();
    if ((s.pricingMode || "Matched Set") === "Individual") {
      compOwnQty.forEach((q) => { if (q > 0) set.add(q); });
    } else {
      topQtys.forEach((q) => { if (q > 0) set.add(q); });
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [bomItems, topQtys, s.pricingMode]);  // eslint-disable-line

  const [carrier, setCarrierUI] = useState(s.freightCarrier || "PITT OHIO EXPRESS");
  const [tierFilter, setTierFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");
  const [tierQuotes, setTierQuotes] = useState({});  // { qty: { totalLbs, skids, totalAmount, carrier } }
  const [busy, setBusy] = useState(false);

  // Compute per-tier metrics (mirrors RightDashboard.updateFreight allocation)
  const computeTier = (qtyAt) => {
    const perComp = bomItems.map((it) => {
      const st = it.state || {};
      const uw = parseFloat(st.oneUpW || 0), ul = parseFloat(st.oneUpL || 0);
      if (qtyAt <= 0 || uw <= 0 || ul <= 0) return { lbs: 0, w: uw, l: ul, flute: st.flute };
      const sqFt = (uw * ul * qtyAt * 1.25) / 144;
      return { lbs: sqFt * lbsPerSqFt, w: uw, l: ul, flute: st.flute, sqFt };
    });
    let dom = perComp[0], maxLbs = 0;
    perComp.forEach((p) => { if ((p.lbs || 0) > maxLbs) { maxLbs = p.lbs; dom = p; } });
    const totalQty = bomItems.length * qtyAt;
    let skids = 1;
    if (dom && dom.w && dom.l && totalQty > 0) {
      const longS = Math.max(dom.w, dom.l), shortS = Math.min(dom.w, dom.l);
      const ppl = Math.max(
        Math.floor((48 - 0.5) / longS) * Math.floor((40 - 0.5) / shortS),
        Math.floor((48 - 0.5) / shortS) * Math.floor((40 - 0.5) / longS), 1);
      const cal = ({ B: 0.125, C: 0.1875, E: 0.0625, F: 0.05, "B/C": 0.236 })[dom.flute || "C"] || 0.1875;
      const sp = Math.max(1, Math.floor(44 / cal));
      skids = Math.max(1, Math.ceil(totalQty / (ppl * sp)));
    }
    const boardSum = perComp.reduce((a, p) => a + (p.lbs || 0), 0);
    const palletLbs = skids * 75;
    const totalLbs = Math.max(100, Math.round(boardSum + palletLbs));
    return { perComp, boardSum, palletLbs, skids, totalLbs };
  };

  const fetchAllTiers = async () => {
    if (!s.destZip) return;
    setBusy(true);
    try {
      const out = {};
      for (const q of tierQtys) {
        const t = computeTier(q);
        try {
          const r = await freightQuote({ destZip: s.destZip, weightLbs: t.totalLbs, freightClass: "70" });
          out[q] = { ...t, totalAmount: Number(r.totalAmount || 0), carrier: r.carrier || "" };
        } catch { out[q] = { ...t, totalAmount: 0, carrier: "" }; }
      }
      setTierQuotes(out);
    } finally { setBusy(false); }
  };

  if (!open) return null;
  const shipTogetherRaw = Object.values(tierQuotes).reduce((a, t) => a + (t.totalAmount || 0), 0);
  const shipIndividuallyRaw = shipTogetherRaw * 1.3; // rough heuristic — minimums per shipment

  return (
    <div data-testid="freight-dash-modal" onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={hdr}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--spot-accent)" }}>Freight Dashboard</div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", marginTop: 2 }}>
              Ship-To {s.destZip || "—"} · {bomItems.length} components · {tierQtys.length} qty tier{tierQtys.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button data-testid="freight-dash-close" onClick={onClose} style={closeBtn}>×</button>
        </div>

        {/* Ship Together vs Individually */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--spot-line)" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
            <div style={card}>
              <div style={cardLbl}>SHIP INDIVIDUALLY</div>
              <div style={cardAmt}>{fmtMoney(shipIndividuallyRaw * (1 + markup))}</div>
              <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>
                Each component ships alone (hits LTL min per shipment)
              </div>
            </div>
            <div style={{ ...card, background: "var(--spot-accent-soft)", borderColor: "var(--spot-accent)" }}>
              <div style={cardLbl}>SHIP TOGETHER ✓</div>
              <div style={{ ...cardAmt, color: "var(--spot-accent)" }}>{fmtMoney(shipTogetherRaw * (1 + markup))}</div>
              <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>
                One consolidated LTL — recommended (saves {fmtMoney((shipIndividuallyRaw - shipTogetherRaw) * (1 + markup))})
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button data-testid="freight-dash-refresh" disabled={busy || !s.destZip}
              onClick={fetchAllTiers} style={actionBtn(busy)}>
              {busy ? "Fetching…" : "Refresh all qty tier rates"}
            </button>
          </div>
        </div>

        {/* Per-qty-tier breakdown panels */}
        <div style={{ padding: "10px 14px", maxHeight: 400, overflowY: "auto" }}>
          {tierQtys.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--spot-text3)" }}>
              No qty tiers set yet — enter qtys on at least one component.
            </div>
          ) : tierQtys.map((q) => {
            const tier = tierQuotes[q] || computeTier(q);
            const raw = tier.totalAmount || 0;
            const wm = raw * (1 + markup);
            return (
              <div key={q} style={tierBox} data-testid={`freight-dash-tier-${q}`}>
                <div style={tierHdr}>
                  <span style={{ fontWeight: 700 }}>Qty {fmtInt(q)}</span>
                  <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
                    {tier.totalLbs.toLocaleString()} lbs · {tier.skids} skid{tier.skids !== 1 ? "s" : ""}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12 }}>
                    <span style={{ color: "var(--spot-text3)" }}>Raw:</span> <b>{fmtMoney(raw)}</b>
                    <span style={{ color: "var(--spot-text3)", marginLeft: 10 }}>w/ Markup:</span>
                    <b style={{ color: "var(--spot-accent)", marginLeft: 4 }}>{fmtMoney(wm)}</b>
                  </span>
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 6 }}>
                  <thead><tr style={{ color: "var(--spot-text3)" }}>
                    <th style={th}>Component</th>
                    <th style={{ ...th, textAlign: "right" }}>Wt (lbs)</th>
                    <th style={{ ...th, textAlign: "right" }}>Wt %</th>
                    <th style={{ ...th, textAlign: "right" }}>Freight</th>
                    <th style={{ ...th, textAlign: "right" }}>w/ Markup</th>
                  </tr></thead>
                  <tbody>
                    {bomItems.map((bi, i) => {
                      const myBoard = tier.perComp[i]?.lbs || 0;
                      const myPal = tier.boardSum > 0 ? tier.palletLbs * (myBoard / tier.boardSum) : 0;
                      const myW = myBoard + myPal;
                      const pct = tier.totalLbs > 0 ? (myW / tier.totalLbs) : 0;
                      const myRaw = raw * pct;
                      const myWm = myRaw * (1 + markup);
                      const tint = BOM_TINTS[i % BOM_TINTS.length];
                      return (
                        <tr key={i} style={{ borderTop: "1px solid var(--spot-line)" }}>
                          <td style={{ padding: "4px 6px" }}>
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: tint, marginRight: 6 }} />
                            {bi.desc || `Item ${i + 1}`}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{Math.round(myW)}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{(pct * 100).toFixed(1)}%</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtMoney(myRaw)}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: "var(--spot-accent)" }}>{fmtMoney(myWm)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Carrier options */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--spot-line)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>
            Carrier Options
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["PITT OHIO EXPRESS", "FEDEX FREIGHT", "WARD TRUCKING", "R&L CARRIERS"].map((c) => {
              const active = c === carrier;
              return (
                <button key={c} data-testid={`freight-dash-carrier-${c.replace(/ /g, "-")}`}
                  onClick={() => { setCarrierUI(c); setField("freightCarrier", c); }}
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    padding: "5px 10px", borderRadius: 3,
                    background: active ? "var(--spot-accent)" : "var(--spot-bg3)",
                    color: active ? "#fff" : "var(--spot-text2)",
                    border: `1px solid ${active ? "var(--spot-accent)" : "var(--spot-border)"}`,
                  }}>
                  {active ? "✓ " : ""}{c}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modal = { width: "min(960px, 92vw)", maxHeight: "92vh", background: "var(--spot-bg)", borderRadius: 6, border: "1px solid var(--spot-border)", display: "flex", flexDirection: "column", overflow: "hidden" };
const hdr = { padding: "12px 14px", borderBottom: "1px solid var(--spot-line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" };
const closeBtn = { all: "unset", cursor: "pointer", fontSize: 22, color: "var(--spot-text2)", padding: "0 6px" };
const card = { flex: 1, padding: "10px 14px", borderRadius: 4, border: "1px solid var(--spot-border)", background: "var(--spot-bg3)" };
const cardLbl = { fontSize: 10, fontWeight: 700, color: "var(--spot-text3)", textTransform: "uppercase", letterSpacing: ".06em" };
const cardAmt = { fontSize: 20, fontWeight: 800, marginTop: 4 };
const tierBox = { padding: "8px 10px", borderRadius: 4, border: "1px solid var(--spot-line)", marginBottom: 8, background: "var(--spot-bg2)" };
const tierHdr = { display: "flex", alignItems: "center", gap: 10 };
const th = { padding: "3px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left", color: "var(--spot-text3)" };
const actionBtn = (busy) => ({
  all: "unset", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 700,
  padding: "5px 12px", borderRadius: 3,
  background: "var(--spot-accent)", color: "#fff", opacity: busy ? 0.7 : 1,
});
