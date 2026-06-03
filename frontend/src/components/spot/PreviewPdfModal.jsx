/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { previewPdfBlob, calculateAll, calculateMultiPart } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";
import { buildPayload, buildMpPayload } from "../../hooks/useEngine";
import { fmtInt, fmtMoney, fmtNum } from "../../lib/format";

/**
 * Preview Quote modal — ported 1:1 from legacy spot_r1_5.jsx (line 7632+).
 *  - HTML-rendered modal (NOT a PDF iframe)
 *  - Charges selector: "Lump Sum" | "By Type" | "By Part" (legacy default "By Type")
 *  - Export → backend PDF · Print → window.print of body · × → close
 *  - Shipping line shown when freightTreatment === "Line"
 */
export default function PreviewPdfModal({ onClose }) {
  const { active, pushToast } = useQuote();
  const s = active?.state || {};
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [chargeMode, setChargeMode] = useState("By Type");
  const [exporting, setExporting] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true); setErr("");
      try {
        const isMP = s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0;
        if (isMP) {
          const payload = buildMpPayload(s);
          const data = await calculateMultiPart(payload);
          if (!cancel) setResults(data.slots || []);
        } else {
          const payload = buildPayload(s);
          const { results: rs } = await calculateAll(payload);
          if (!cancel) setResults(rs || []);
        }
      } catch (e) {
        if (!cancel) setErr(e?.response?.data?.detail || e.message);
      } finally { if (!cancel) setBusy(false); }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // ESC closes
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const today = useMemo(() => new Date().toLocaleDateString("en-US",
    { month: "long", day: "numeric", year: "numeric" }), []);
  const expDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (parseInt(s.quoteExpDays, 10) || 30));
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }, [s.quoteExpDays]);

  // Active priced rows (no zero-qty)
  const previewRows = useMemo(() => (results || []).filter(
    (r) => r && r.pricable && !r.error && Number(r.qty) > 0
  ), [results]);

  // Are there any line-item charges? (Die / Freight / Prepress / Misc on a separate line)
  const hasLineItems = useMemo(() => previewRows.some((r) =>
    (r.dieLineCost > 0) || (r.freightLine > 0) || (r.prepressLineCost > 0) || ((r.miscLineCost || 0) > 0)
  ), [previewRows]);

  // Legacy fmLnr (spot_r1_5.jsx L1218): "None" → "Kraft", strip weight + "-Lite"/"-White"
  const fmLnr = (l) => (!l || l === "None") ? "Kraft"
    : String(l).replace(/^\d+#\s*/, "").replace("-Lite", "").replace("-White", "");

  // Item spec sub-line
  const specBits = [];
  if (s.custIdent) specBits.push(s.custIdent);
  if (s.boardGrade && s.flute) specBits.push(`${s.boardGrade}# ${s.flute}`);
  if (s.outsideLiner || s.insideLiner) specBits.push(`${fmLnr(s.outsideLiner)}/${fmLnr(s.insideLiner)}`);
  const w = Number(s.oneUpW || 0), l = Number(s.oneUpL || 0);
  if (w > 0 && l > 0) specBits.push(`${fmtNum(w, 4)}×${fmtNum(l, 4)}`);
  if (s.fscEnabled) specBits.push("FSC");

  // Export to backend PDF
  const onExport = async () => {
    setExporting(true);
    try {
      const quote = {
        est_num: s.estNum,
        customer_name: s.custName,
        state: s,
      };
      const blob = await previewPdfBlob(quote, results, { chargeMode });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `quote-${s.estNum || "draft"}.pdf`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
      pushToast("Quote PDF exported", "ok");
    } catch (e) {
      pushToast(e?.message || "Export failed", "err");
    } finally { setExporting(false); }
  };

  // Print only the quote body (uses an isolated iframe to avoid printing the surrounding app chrome)
  const onPrint = () => {
    if (!bodyRef.current) return;
    const html = bodyRef.current.innerHTML;
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) { pushToast("Pop-ups blocked — allow pop-ups to print", "warn"); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Quote ${s.estNum || ""}</title>
      <style>body{font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#1f2937;margin:32px 40px}
        table{border-collapse:collapse;width:100%}
        @media print{body{margin:12mm}}
      </style></head><body>${html}<script>setTimeout(()=>{window.print();window.close();},250);</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="sp-modal-backdrop" data-testid="modal-backdrop-preview"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div data-testid="modal-preview-pdf" role="dialog" aria-modal="true"
        style={{ background: "#fff", borderRadius: 10, width: 780, maxWidth: "95vw",
          maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
          color: "#1a1a1a", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>

        {/* Toolbar */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Quote Preview</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {hasLineItems && (
              <>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Charges:</span>
                {["Lump Sum", "By Type", "By Part"].map((m) => (
                  <button key={m} onClick={() => setChargeMode(m)}
                    data-testid={`preview-charges-${m.toLowerCase().replace(/ /g, "-")}`}
                    style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                      padding: "3px 8px", borderRadius: 3,
                      background: chargeMode === m ? "#2563eb" : "#e5e7eb",
                      color: chargeMode === m ? "#fff" : "#374151" }}>{m}</button>
                ))}
              </>
            )}
            <button onClick={onExport} disabled={exporting || busy}
              data-testid="preview-pdf-export"
              style={{ all: "unset", cursor: exporting || busy ? "wait" : "pointer",
                fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 4,
                background: "#2563eb", color: "#fff", marginLeft: 8, opacity: exporting || busy ? 0.6 : 1 }}>
              {exporting ? "Exporting…" : "Export"}
            </button>
            <button onClick={onPrint} disabled={busy}
              data-testid="preview-pdf-print"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                padding: "4px 12px", borderRadius: 4, background: "#8b5cf6", color: "#fff",
                marginLeft: 4 }}>⎙ Print</button>
            <button onClick={onClose} data-testid="preview-pdf-close-btn"
              style={{ all: "unset", cursor: "pointer", fontSize: 18, color: "#6b7280",
                padding: "4px 8px" }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} id="wf-quote-preview"
          data-testid="preview-quote-body"
          style={{ flex: 1, overflowY: "auto", padding: "32px 40px",
            fontFamily: "'DM Sans',Arial,sans-serif", fontSize: 13, lineHeight: 1.5, color: "#1f2937" }}>

          {busy && <div data-testid="preview-pdf-loading" style={{ color: "#6b7280" }}>Calculating…</div>}
          {err && <div data-testid="preview-pdf-error" style={{ color: "#dc2626" }}>{err}</div>}
          {!busy && !err && (
            <>
              {/* Company header */}
              <div style={{ borderBottom: "3px solid #1e40af", paddingBottom: 16, marginBottom: 20,
                display: "flex", alignItems: "center", gap: 18 }}>
                <img src="/spc_logo.png" alt="Standard Printing Company"
                  style={{ height: 60, width: "auto", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f",
                    letterSpacing: ".04em", textTransform: "uppercase" }}>
                    Standard Printing Company</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3, lineHeight: 1.5 }}>
                    1115 Cherry Ave NE, Canton, OH 44704</div>
                </div>
              </div>

              {/* Meta grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "12px 32px", marginBottom: 20 }}>
                <div>
                  <Label>Quote Number</Label>
                  <Big>{s.estNum || "—"}</Big>
                </div>
                <div>
                  <Label>Date</Label>
                  <Med>{today}</Med>
                </div>
                <div>
                  <Label>Customer</Label>
                  <Med>{s.custName || "—"}</Med>
                </div>
                <div>
                  <Label>Valid Until</Label>
                  <Med>{expDate}</Med>
                </div>
                {s.custRef && (
                  <div>
                    <Label>Project</Label>
                    <Plain>{s.custRef}</Plain>
                  </div>
                )}
                {s.quoteShipTo && (
                  <div>
                    <Label>Ship To</Label>
                    <Plain>{[s.quoteShipTo, s.destZip].filter(Boolean).join(", ")}</Plain>
                  </div>
                )}
              </div>

              {/* Item description bar */}
              <div style={{ background: "#f3f4f6", borderRadius: 6,
                padding: "10px 14px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {s.itemDesc || s.boxStyle || "—"}
                </div>
                {specBits.length > 0 && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    {specBits.join(" · ")}
                  </div>
                )}
              </div>

              {/* Pricing table — Simple quote shape */}
              <PricingTable
                rows={previewRows}
                hasLineItems={hasLineItems}
                chargeMode={chargeMode}
              />

              {/* Terms */}
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14,
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 12 }}>
                <div><strong style={{ color: "#6b7280" }}>Terms:</strong> {s.quoteTerms || "Net 30"}</div>
                <div><strong style={{ color: "#6b7280" }}>FOB:</strong>{" "}
                  {String(s.quoteFOB || "Origin").startsWith("Origin") ? "Origin" : "Destination"}</div>
                <div><strong style={{ color: "#6b7280" }}>Valid:</strong> {s.quoteExpDays || 30} days</div>
              </div>

              {s.quoteNotes && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "#fffbeb",
                  border: "1px solid #fde68a", borderRadius: 4, fontSize: 12, color: "#92400e" }}>
                  {s.quoteNotes}
                </div>
              )}

              {/* Signature lines */}
              <div style={{ marginTop: 32, display: "grid",
                gridTemplateColumns: "1fr 1fr", gap: 40 }}>
                <div>
                  <div style={{ borderBottom: "1px solid #d1d5db", height: 40 }} />
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Authorized Signature</div>
                </div>
                <div>
                  <div style={{ borderBottom: "1px solid #d1d5db", height: 40 }} />
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Customer Acceptance</div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>
                Estimate #{s.estNum || "—"} · Prepared by {s.estInitials || "SPC"} · {today}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────
const Label = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af",
    textTransform: "uppercase", letterSpacing: ".06em" }}>{children}</div>
);
const Big = ({ children }) => (
  <div style={{ fontSize: 14, fontWeight: 700 }}>{children}</div>
);
const Med = ({ children }) => (
  <div style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>
);
const Plain = ({ children }) => (
  <div style={{ fontSize: 14 }}>{children}</div>
);

const thS = {
  padding: "8px 10px", textAlign: "right", fontSize: 11, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: ".06em", color: "#6b7280",
};
const thL = { ...thS, textAlign: "left" };

function PricingTable({ rows, hasLineItems, chargeMode }) {
  if (!rows || rows.length === 0) {
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <tbody>
          <tr><td style={{ padding: 20, textAlign: "center", color: "#9ca3af" }}>
            No active quantities to display
          </td></tr>
        </tbody>
      </table>
    );
  }
  const showChargesCol = hasLineItems && chargeMode !== "Lump Sum";
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d1d5db" }}>
            <th style={thL}>Qty</th>
            <th style={thS}>Each</th>
            <th style={thS}>Per/M</th>
            <th style={thS}>Total</th>
            {showChargesCol && <th style={thS}>Charges</th>}
            <th style={{ ...thS, color: "#1e40af" }}>Quote Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sellPc = r.qty > 0 ? r.itemSell / r.qty : 0;
            const lineCharges = [];
            const die = Number(r.dieLineCost || 0);
            const freight = Number(r.freightLine || 0);
            const prep = Number(r.prepressLineCost || 0);
            const misc = Number(r.miscLineCost || 0);
            if (die > 0) lineCharges.push(`Die: ${fmtMoney(die)}`);
            if (freight > 0) lineCharges.push(`Freight: ${fmtMoney(freight)}`);
            if (prep > 0) lineCharges.push(`Prepress: ${fmtMoney(prep)}`);
            if (misc > 0) lineCharges.push(`Misc: ${fmtMoney(misc)}`);
            const chargesTotal = die + freight + prep + misc;
            const quoteTotal = Number(r.itemSell || 0) + chargesTotal;
            return (
              <tr key={r.slot ?? i} style={{ borderBottom: "1px solid #e5e7eb",
                background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>{fmtInt(r.qty)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(sellPc, 4)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: "#6b7280" }}>
                  {fmtMoney(sellPc * 1000)}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(r.itemSell)}</td>
                {showChargesCol && (
                  <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>
                    {chargeMode === "By Part"
                      ? (lineCharges.join(", ") || "—")
                      : (chargesTotal > 0 ? fmtMoney(chargesTotal) : "—")}
                  </td>
                )}
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>
                  {fmtMoney(quoteTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasLineItems && chargeMode === "Lump Sum" && (() => {
        const r = rows[0] || {};
        const lump = Number(r.dieLineCost || 0) + Number(r.freightLine || 0)
          + Number(r.prepressLineCost || 0) + Number(r.miscLineCost || 0);
        return lump > 0 ? (
          <div data-testid="preview-lumpsum-charges"
            style={{ textAlign: "right", fontSize: 12, color: "#6b7280",
              marginTop: -8, marginBottom: 12 }}>
            One-Time Charges: <b style={{ color: "#1f2937" }}>{fmtMoney(lump)}</b>
          </div>
        ) : null;
      })()}
    </>
  );
}
