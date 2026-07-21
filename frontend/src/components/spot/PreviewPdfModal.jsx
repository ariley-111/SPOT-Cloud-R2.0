/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { previewPdfBlob, calculateAll, calculateMultiPart } from "../../api/spot";
import EmailQuoteModal from "./EmailQuoteModal";
import { useQuote } from "../../context/QuoteContext";
import { buildPayload, buildMpPayload } from "../../hooks/useEngine";
import { fmtInt, fmtMoney, fmtNum, fmtDim } from "../../lib/format";

// Customer-facing print descriptor for spec lines: "Satin 1S" / "CMYK 2S" / "No Print".
const printShort = (d) => {
  if (!d) return "No Print";
  const req = d.printReq || d.printRequired;
  if (req !== "Yes") return "No Print";
  const mode = d.printMode || "Print";
  const sides = d.printSides === "2-Sided" ? " 2S" : d.printSides === "1-Sided" ? " 1S" : "";
  return `${mode}${sides}`;
};


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
  // Freight sanity check: warn estimator if Will-Call or Local Delivery is selected
  // (these are common sources of customer pricing complaints when wrong).
  useEffect(() => {
    if (s.quoteFOB === "Origin") {
      pushToast("⚠ FOB Will-Call — customer picks up, no freight added. Confirm before sending.", "warn");
    } else if (s.quoteFOB === "LocalDelivery") {
      const z = s.localDeliveryZone || "(no zone selected)";
      pushToast(`⚠ Local Delivery — ${z}. Verify zone matches customer distance from 44704.`, "warn");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [results, setResults] = useState([]);
  const [componentPricing, setComponentPricing] = useState([]);
  const [jobTotalsState, setJobTotalsState] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [chargeMode, setChargeMode] = useState("By Type");
  const [exporting, setExporting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
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
          if (!cancel) {
            setResults(data.slots || []);
            setComponentPricing(data.componentPricing || []);
            setJobTotalsState(data.jobTotals || null);
          }
        } else {
          const payload = buildPayload(s);
          const { results: rs } = await calculateAll(payload);
          if (!cancel) { setResults(rs || []); setComponentPricing([]); setJobTotalsState(null); }
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

  // Active priced rows (no zero-qty, no user-excluded rows)
  const exclSet = useMemo(() => new Set(
    Array.isArray(s.exportExclude) ? s.exportExclude : []
  ), [s.exportExclude]);
  const previewRows = useMemo(() => (results || []).filter(
    (r, i) => r && r.pricable && !r.error && Number(r.qty) > 0 && !exclSet.has(i)
  ), [results, exclSet]);

  // Are there any line-item charges? (Die / Freight / Prepress / Misc on a separate line)
  const hasLineItems = useMemo(() => previewRows.some((r) =>
    (r.dieLineCost > 0) || (r.freightLine > 0) || (r.prepressLineCost > 0) || ((r.proofLineCost || 0) > 0) || ((r.miscLineCost || 0) > 0)
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
  if (w > 0 && l > 0) specBits.push(`${fmtDim(w)}×${fmtDim(l)}`);
  if (s.fscEnabled) specBits.push("FSC");
  specBits.push(printShort(s));
  if (s.tape === "Yes") {
    const tType = (s.tapeType === "Foam" || s.tapeType === "Reinforced") ? "Foam" : "Film";
    const nStrips = Number(s.tapeStrips || 1);
    const tLen = Number(s.tapeStripLength || 0);
    let tp = `${tType} ${nStrips} strip${nStrips === 1 ? "" : "s"}`;
    if (tLen > 0) tp += ` ${tLen}"`;
    specBits.push(tp);
  }

  // Export to backend PDF
  const onExport = async () => {
    setExporting(true);
    try {
      const quote = {
        est_num: s.estNum,
        customer_name: s.custName,
        state: s,
      };
      // Only send active (non-excluded) priced rows to the backend PDF generator
      const blob = await previewPdfBlob(quote, previewRows, {
        chargeMode,
        componentPricing,
        jobTotals: jobTotalsState,
      });
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

  // PDF payload shared by Export + Email (same shape the backend expects)
  const pdfPayload = useMemo(() => ({
    quote: { est_num: s.estNum, customer_name: s.custName, state: s },
    results: previewRows,
    chargeMode,
    componentPricing,
    jobTotals: jobTotalsState,
  }), [s, previewRows, chargeMode, componentPricing, jobTotalsState]);

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
            <button onClick={() => setEmailOpen(true)} disabled={busy}
              data-testid="preview-pdf-email"
              style={{ all: "unset", cursor: busy ? "wait" : "pointer", fontSize: 11, fontWeight: 600,
                padding: "4px 12px", borderRadius: 4, background: "#0ea5e9", color: "#fff",
                marginLeft: 4, opacity: busy ? 0.6 : 1 }}>✉ Email</button>
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

              {/* Item description bar — single-piece quotes only. For Multi-Part
                  (Matched Set or Individual), the BOM listing serves as the
                  identifier; an extra item bar would duplicate the project
                  name above. */}
              {!(s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0) && (
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
              )}

              {/* MP-Matched Set: BOM listing with all components — # / Component / Board / Blank / Pcs/Set. */}
              {s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0 && (s.pricingMode || "Matched Set") === "Matched Set" && (
                <div style={{ background: "#f3f4f6",
                  borderRadius: 6, padding: "10px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                    Matched Set — {(s.bomItems || []).length} Items
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ borderBottom: "1px solid #d1d5db", color: "#6b7280" }}>
                      <th style={{ ...thS, textAlign: "left", width: 24 }}>#</th>
                      <th style={{ ...thL, textAlign: "left" }}>Component</th>
                      <th style={{ ...thL, textAlign: "left" }}>Board</th>
                      <th style={{ ...thL, textAlign: "left" }}>Blank</th>
                      <th style={{ ...thS, textAlign: "right" }}>Pcs/Set</th>
                    </tr></thead>
                    <tbody>
                      {(s.bomItems || []).map((it, i) => {
                        const ist = it.state || {};
                        let brd = "", dims = "—";
                        if ((it.type || "Manufactured") === "Manufactured") {
                          const fl = ist.flute || "", gr = ist.boardGrade || "";
                          const ol = fmLnr(ist.outsideLiner), il = fmLnr(ist.insideLiner);
                          brd = `${gr}# ${fl} ${ol}/${il}`;
                          const iw = Number(ist.oneUpW || 0), il2 = Number(ist.oneUpL || 0);
                          if (iw > 0 && il2 > 0) dims = `${fmtDim(iw)}×${fmtDim(il2)}`;
                          brd += ` · ${printShort(ist)}`;
                        } else {
                          brd = it.type === "Purchased" ? "Purchased" : "Fulfillment";
                        }
                        return (
                          <tr key={it.id || i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                            <td style={{ padding: "5px 8px", fontWeight: 700, color: "#6b7280" }}>{i + 1}</td>
                            <td style={{ padding: "5px 10px", fontWeight: 600 }}>{it.desc || `Item ${i + 1}`}</td>
                            <td style={{ padding: "5px 10px", color: "#6b7280" }}>{brd}</td>
                            <td style={{ padding: "5px 10px", color: "#6b7280" }}>{dims}</td>
                            <td style={{ padding: "5px 10px", textAlign: "right", color: "#6b7280" }}>{it.pcsPerSet || 1}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* MP-Individual: per-component sections — each component with its own qty rows */}
              {s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0 && (s.pricingMode || "Matched Set") === "Individual" && componentPricing.length > 0 && (
                <PerComponentSections
                  componentPricing={componentPricing}
                  jobTotals={jobTotalsState}
                  excludeMap={s.exportExcludeByComponent || {}}
                  fmLnr={fmLnr}
                />
              )}

              {/* MP-Matched Set: Per-component pricing grid (legacy parity, spot_r1_5.jsx L4639-4702) */}
              {s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0 && (s.pricingMode || "Matched Set") === "Matched Set" && (
                <MatchedSetPricingGrid
                  bomItems={s.bomItems || []}
                  componentPricing={componentPricing}
                  slots={previewRows}
                />
              )}

              {/* Pricing table — for Simple-piece quotes only */}
              {!(s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0) && (
                <PricingTable
                  rows={previewRows}
                  hasLineItems={hasLineItems}
                  chargeMode={chargeMode}
                  isMP={false}
                />
              )}

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

      {emailOpen && (
        <EmailQuoteModal
          state={s}
          pdfPayload={pdfPayload}
          pushToast={pushToast}
          onClose={() => setEmailOpen(false)}
        />
      )}
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

function PricingTable({ rows, hasLineItems, chargeMode, isMP }) {
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
  const qtyLabel = isMP ? "Sets" : "Qty";
  const eachLabel = isMP ? "Per Set" : "Each";
  const perMLabel = isMP ? "Per/M Sets" : "Per/M";

  // ─── Charge-mode column model ──────────────────────────────────────────
  //  • By Type  → single "Charges" column = sum of all one-time charges / row
  //  • By Part  → one column per charge TYPE present (Die | Freight | Prepress
  //               | <each misc name>), each summing into Quote Total
  //  • Lump Sum → no charge column; a per-qty descriptive list is shown below
  const byPart = hasLineItems && chargeMode === "By Part";
  const byType = hasLineItems && chargeMode === "By Type";
  // When Freight is the ONLY line charge present, the combined "By Type" column
  // is labeled "Freight" (per user); otherwise it stays the generic "Charges".
  const _anyFrt = rows.some((r) => Number(r.freightLine || 0) > 0);
  const _anyOther = rows.some((r) => Number(r.dieLineCost || 0) > 0
    || Number(r.prepressLineCost || 0) > 0 || Number(r.proofLineCost || 0) > 0 || Number(r.miscLineCost || 0) > 0
    || (r.miscLineItems || []).some((li) => Number(li.amt || 0) > 0));
  const byTypeLabel = _anyFrt && !_anyOther ? "Freight" : "Charges";
  // Per-row charge extraction helper.
  const rowCharges = (r) => {
    const die = Number(r.dieLineCost || 0);
    const freight = Number(r.freightLine || 0);
    const prep = Number(r.prepressLineCost || 0);
    const proof = Number(r.proofLineCost || 0);
    const miscItems = (r.miscLineItems || []).filter((li) => (li.amt || 0) > 0);
    const miscFallback = Number(r.miscLineCost || 0);
    return { die, freight, prep, proof, miscItems, miscFallback };
  };
  // Discover which type-columns to render for By Part (only present ones).
  const colDie = byPart && rows.some((r) => Number(r.dieLineCost || 0) > 0);
  const colFrt = byPart && rows.some((r) => Number(r.freightLine || 0) > 0);
  const colPrep = byPart && rows.some((r) => Number(r.prepressLineCost || 0) > 0);
  const colProof = byPart && rows.some((r) => Number(r.proofLineCost || 0) > 0);
  const miscNames = [];
  if (byPart) {
    rows.forEach((r) => (r.miscLineItems || []).forEach((li) => {
      if ((li.amt || 0) > 0 && !miscNames.includes(li.name || "Misc")) miscNames.push(li.name || "Misc");
    }));
    // Fallback unnamed misc → a single "Misc" column
    if (miscNames.length === 0 && rows.some((r) => Number(r.miscLineCost || 0) > 0)) miscNames.push("Misc");
  }
  const miscAmt = (r, name) => {
    const li = (r.miscLineItems || []).find((x) => (x.name || "Misc") === name && (x.amt || 0) > 0);
    if (li) return Number(li.amt || 0);
    if (name === "Misc" && (!r.miscLineItems || r.miscLineItems.length === 0)) return Number(r.miscLineCost || 0);
    return 0;
  };
  // Build the descriptive label for a row's combined charges (Lump Sum list).
  const chargeLabel = (r) => {
    const c = rowCharges(r);
    const parts = [];
    if (c.freight > 0) parts.push("Freight");
    if (c.die > 0) parts.push("Die");
    if (c.prep > 0) parts.push("Prepress");
    if (c.proof > 0) parts.push("Proofs");
    c.miscItems.forEach((li) => parts.push(li.name || "Misc"));
    if (parts.length === 0 && c.miscFallback > 0) parts.push("Misc");
    return parts.join(" + ");
  };
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d1d5db" }}>
            <th style={thL}>{qtyLabel}</th>
            <th style={thS}>{eachLabel}</th>
            <th style={thS}>{perMLabel}</th>
            <th style={thS}>Total</th>
            {byType && <th style={thS}>{byTypeLabel}</th>}
            {colDie && <th style={thS}>Die</th>}
            {colFrt && <th style={thS}>Freight</th>}
            {colPrep && <th style={thS}>Prepress</th>}
            {colProof && <th style={thS}>Proofs</th>}
            {miscNames.map((n) => <th key={n} style={thS}>{n}</th>)}
            <th style={{ ...thS, color: "#1e40af" }}>Quote Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sellPc = r.qty > 0 ? r.itemSell / r.qty : 0;
            const c = rowCharges(r);
            const chargesTotal = c.die + c.freight + c.prep + c.proof
              + (c.miscItems.length > 0 ? c.miscItems.reduce((a, li) => a + Number(li.amt || 0), 0) : c.miscFallback);
            const quoteTotal = Number(r.itemSell || 0) + chargesTotal;
            const DASH = "—";
            return (
              <tr key={r.slot ?? i} style={{ borderBottom: "1px solid #e5e7eb",
                background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>{fmtInt(r.qty)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(sellPc, 4)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: "#6b7280" }}>
                  {fmtMoney(sellPc * 1000)}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(r.itemSell)}</td>
                {byType && (
                  <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>
                    {chargesTotal > 0 ? fmtMoney(chargesTotal) : DASH}
                  </td>
                )}
                {colDie && <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>{c.die > 0 ? fmtMoney(c.die) : DASH}</td>}
                {colFrt && <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>{c.freight > 0 ? fmtMoney(c.freight) : DASH}</td>}
                {colPrep && <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>{c.prep > 0 ? fmtMoney(c.prep) : DASH}</td>}
                {colProof && <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>{c.proof > 0 ? fmtMoney(c.proof) : DASH}</td>}
                {miscNames.map((n) => {
                  const v = miscAmt(r, n);
                  return <td key={n} style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>{v > 0 ? fmtMoney(v) : DASH}</td>;
                })}
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>
                  {fmtMoney(quoteTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasLineItems && chargeMode === "Lump Sum" && (() => {
        // One descriptive line PER qty tier (not just the first row). Each line
        // names the charge types that apply at that qty and shows the combined sum.
        const lines = rows.map((r) => {
          const c = rowCharges(r);
          const sum = c.die + c.freight + c.prep + c.proof
            + (c.miscItems.length > 0 ? c.miscItems.reduce((a, li) => a + Number(li.amt || 0), 0) : c.miscFallback);
          return { qty: r.qty, label: chargeLabel(r), sum };
        }).filter((x) => x.sum > 0);
        if (lines.length === 0) return null;
        return (
          <div data-testid="preview-lumpsum-charges"
            style={{ marginTop: -8, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
              One-Time Charges
            </div>
            {lines.map((ln, i) => (
              <div key={i} data-testid={`preview-lumpsum-line-${i}`}
                style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
                  color: "#374151", padding: "2px 0" }}>
                <span>{ln.label} @ {isMP ? "Set " : "Qty "}{fmtInt(ln.qty)}</span>
                <b style={{ color: "#1f2937" }}>{fmtMoney(ln.sum)}</b>
              </div>
            ))}
          </div>
        );
      })()}
    </>
  );
}

// ─── Matched-Set Per-Component Pricing Grid (legacy parity, spot_r1_5.jsx L4639-4702) ──────
// For Multi-Part quotes in Matched Set mode. Lists every component with its
// clean per-piece sell price (itemSell/qty, no embedded charges), then
// Price/Set row, line-charge rows (Die / Freight / Prepress / Misc) when present,
// QUOTE TOTAL row, and SETS row.
function MatchedSetPricingGrid({ bomItems, componentPricing, slots }) {
  if (!slots || slots.length === 0) {
    return (
      <div style={{ padding: 18, textAlign: "center", color: "#9ca3af",
        marginBottom: 16, fontSize: 12 }}>No priced set quantities</div>
    );
  }
  const cpByIdx = new Map();
  const cpById = new Map();
  (componentPricing || []).forEach((c) => {
    if (c.itemIndex !== undefined) cpByIdx.set(c.itemIndex, c);
    if (c.itemId) cpById.set(c.itemId, c);
  });

  const tiers = slots.map((s) => ({
    slot: Number(s.slot ?? 0),
    setQty: Number(s.setQty ?? s.qty ?? 0),
    sellTotal: Number(s.sellTotal || 0),
    sellPerSet: Number(s.sellPc || s.sellPerSet || 0),
    die: Number(s.dieLineCost || 0),
    freight: Number(s.freightLine || 0),
    prepress: Number(s.prepressLineCost || 0),
    misc: Number(s.miscLineCost || 0),
  }));

  const lineRow = (label, vals) => {
    if (!vals.some((v) => v > 0)) return null;
    return (
      <tr key={label}>
        <td style={{ padding: "4px 8px", color: "#6b7280", fontStyle: "italic" }}>{label}</td>
        {vals.map((v, i) => (
          <td key={i} style={{ padding: "4px 8px", textAlign: "right", color: "#6b7280" }}>
            {v > 0 ? fmtMoney(v) : "—"}
          </td>
        ))}
      </tr>
    );
  };

  const dieVals = tiers.map((t) => t.die);
  const frtVals = tiers.map((t) => t.freight);
  const ppVals = tiers.map((t) => t.prepress);
  const miscVals = tiers.map((t) => t.misc);

  return (
    <div style={{ marginBottom: 16 }} data-testid="preview-mp-matched-grid">
      <div style={{ fontSize: 12, fontWeight: 700, color: "#1e40af",
        textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
        Per-Component Pricing
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d1d5db" }}>
            <th style={{ ...thL, color: "#374151" }}>Component</th>
            {tiers.map((t) => (
              <th key={t.slot} style={{ ...thS, color: "#374151" }}>{fmtInt(t.setQty)} sets</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(bomItems || []).map((it, i) => {
            const cp = cpById.get(it.id) || cpByIdx.get(i) || {};
            const rowBySlot = new Map();
            (cp.rows || []).forEach((r) => rowBySlot.set(Number(r.slotIdx ?? 0), r));
            const bg = i % 2 ? "#f9fafb" : "#fff";
            return (
              <tr key={it.id || i}>
                <td style={{ padding: "4px 8px", background: bg }}>
                  <b>{i + 1}.</b> {it.desc || `Item ${i + 1}`}
                </td>
                {tiers.map((t) => {
                  const r = rowBySlot.get(t.slot);
                  const qv = Number(r?.qty || 0);
                  const isell = Number(r?.itemSell || 0);
                  const sellPc = qv > 0 ? isell / qv : 0;
                  return (
                    <td key={t.slot} style={{ padding: "4px 8px", textAlign: "right", background: bg }}>
                      {sellPc > 0 ? `${fmtMoney(sellPc)}/pc` : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* Price/Set row */}
          <tr style={{ borderTop: "2px solid #1e40af" }}>
            <td style={{ padding: "6px 8px", color: "#1e40af", fontWeight: 700 }}>Price/Set</td>
            {tiers.map((t) => (
              <td key={t.slot} style={{ padding: "6px 8px", textAlign: "right",
                color: "#1e40af", fontWeight: 700 }}>
                {t.sellPerSet > 0 ? fmtMoney(t.sellPerSet) : "—"}
              </td>
            ))}
          </tr>
          {lineRow("Die", dieVals)}
          {lineRow("Freight", frtVals)}
          {lineRow("Prepress", ppVals)}
          {lineRow("Misc", miscVals)}
          {/* QUOTE TOTAL row */}
          <tr style={{ borderTop: "2px solid #1e40af", background: "#f0f4ff" }}>
            <td style={{ padding: "8px", color: "#1e40af", fontWeight: 700, fontSize: 12 }}>
              QUOTE TOTAL
            </td>
            {tiers.map((t) => (
              <td key={t.slot} style={{ padding: "8px", textAlign: "right",
                color: "#1e40af", fontWeight: 700, fontSize: 13 }}>
                {fmtMoney(t.sellTotal)}
              </td>
            ))}
          </tr>
          {/* SETS row */}
          <tr>
            <td style={{ padding: "3px 8px", fontSize: 11, color: "#9ca3af" }}>SETS</td>
            {tiers.map((t) => (
              <td key={t.slot} style={{ padding: "3px 8px", textAlign: "right",
                fontSize: 11, color: "#9ca3af" }}>
                {fmtInt(t.setQty)} sets
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}


// Each BOM component renders as its own section with its own qty rows.
// Per-Job costs go in a Job Totals footer at the bottom.
// ─── Per-Component Sections (MP-Individual mode) ──────────────────────
// Each BOM component renders as its own section with its own qty rows.
// Per-Job costs go in a Quote Summary footer at the bottom.
function PerComponentSections({ componentPricing, jobTotals, excludeMap, fmLnr }) {
  const isExcl = (itemId, slotIdx) => (excludeMap[itemId] || []).includes(slotIdx);

  // ── Per-qty Quote Summary (legacy parity) ──────────────────────────────
  // MP-Individual: each qty tier combines EVERY component priced at that qty.
  // Each component's sellTotal ALREADY includes its allocated per-slot job
  // freight/prepress (the engine bakes Per-Job allocation into the rows), so we
  // do NOT add jobFreightCost/jobPrepressCost again — that double-counted the
  // freight and leaked the dollar figure even on "Amortize" (which hides cost).
  const tierMap = new Map();
  componentPricing.forEach((c) => {
    (c.rows || []).forEach((r) => {
      if (isExcl(c.itemId, r.slotIdx)) return;
      const q = Number(r.qty) || 0;
      if (q <= 0) return;
      const lineTotal = Number(r.sellTotal || 0);
      tierMap.set(q, (tierMap.get(q) || 0) + lineTotal);
    });
  });
  const summaryTiers = [...tierMap.entries()].sort((a, b) => a[0] - b[0]).map(([qty, comp]) => {
    return { qty, comp, perSet: qty > 0 ? comp / qty : 0, total: comp };
  });

  return (
    <div data-testid="preview-mp-individual-sections">
      {componentPricing.map((c) => {
        const bs = c.boardSpec || {};
        const specLine = [
          bs.custIdent,
          bs.boardGrade && bs.flute ? `${bs.boardGrade}# ${bs.flute}` : "",
          (bs.outsideLiner || bs.insideLiner) ? `${fmLnr(bs.outsideLiner)}/${fmLnr(bs.insideLiner)}` : "",
          (bs.medium && bs.medium !== "None") ? String(bs.medium).replace("# Medium", "#").replace("# Bleached Medium", "# Bl") : "",
          (Number(bs.oneUpW) > 0 && Number(bs.oneUpL) > 0)
            ? `${fmtDim(bs.oneUpW)}×${fmtDim(bs.oneUpL)}` : "",
          (c.type || "Manufactured") === "Manufactured" ? printShort(bs) : "",
          `${c.pcsPerSet || 1} pc/set`,
        ].filter(Boolean).join(" · ");
        const rows = (c.rows || []).filter((r) => !isExcl(c.itemId, r.slotIdx));
        // Show a charge column ONLY when that charge is a separate Line item for
        // this component (engine zeroes *LineCost when treatment is Amortize/None).
        const colFrt  = rows.some((r) => Number(r.freightLine || 0) > 0);
        const colDie  = rows.some((r) => Number(r.dieLineCost || 0) > 0);
        const colPrep = rows.some((r) => Number(r.prepressLineCost || 0) > 0);
        const colMisc = rows.some((r) => Number(r.miscLineCost || 0) > 0);
        const chargeCols = (colFrt ? 1 : 0) + (colDie ? 1 : 0) + (colPrep ? 1 : 0) + (colMisc ? 1 : 0);
        const chgTd = { padding: "6px 10px", textAlign: "right", fontSize: 11, color: "#6b7280" };

        return (
          <div key={c.itemId || c.itemIndex} style={{ marginBottom: 18 }}
            data-testid={`preview-comp-section-${c.itemIndex}`}>
            <div style={{ background: "#f3f4f6", borderRadius: 6,
              padding: "8px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {c.desc || `Component ${c.itemIndex + 1}`}
              </div>
              {specLine && (
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{specLine}</div>
              )}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                  <th style={thL}>Qty</th>
                  <th style={thS}>Each</th>
                  <th style={thS}>Per/M</th>
                  {colFrt && <th style={thS}>Freight</th>}
                  {colDie && <th style={thS}>Die</th>}
                  {colPrep && <th style={thS}>Prepress</th>}
                  {colMisc && <th style={thS}>Misc</th>}
                  <th style={{ ...thS, color: "#1e40af" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={4 + chargeCols} style={{ padding: 16, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                    No qty entered
                  </td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e7eb",
                    background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{fmtInt(r.qty)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtMoney(r.sellPc, 4)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "#6b7280" }}>{fmtMoney(r.perM, 2)}</td>
                    {colFrt && <td style={chgTd}>{Number(r.freightLine || 0) > 0 ? fmtMoney(r.freightLine) : "—"}</td>}
                    {colDie && <td style={chgTd}>{Number(r.dieLineCost || 0) > 0 ? fmtMoney(r.dieLineCost) : "—"}</td>}
                    {colPrep && <td style={chgTd}>{Number(r.prepressLineCost || 0) > 0 ? fmtMoney(r.prepressLineCost) : "—"}</td>}
                    {colMisc && <td style={chgTd}>{Number(r.miscLineCost || 0) > 0 ? fmtMoney(r.miscLineCost) : "—"}</td>}
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#1e40af" }}>
                      {fmtMoney(r.sellTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {summaryTiers.length > 0 && (
        <div data-testid="preview-job-totals" style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 6,
          background: "#f9fafb", border: "1px solid #e5e7eb",
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#1e40af",
            textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6,
          }}>Quote Summary</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                <th style={thL}>Qty</th>
                <th style={thS}>Components</th>
                <th style={thS}>Price/Set</th>
                <th style={{ ...thS, color: "#1e40af" }}>Quote Total</th>
              </tr>
            </thead>
            <tbody>
              {summaryTiers.map((t, i) => (
                <tr key={t.qty} style={{ borderBottom: "1px solid #e5e7eb",
                  background: i % 2 === 0 ? "#fff" : "#f9fafb" }}
                  data-testid={`preview-summary-tier-${t.qty}`}>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{fmtInt(t.qty)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtMoney(t.comp)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: "#6b7280" }}>{fmtMoney(t.perSet)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700,
                    fontSize: 14, color: "#1e40af" }} data-testid={`preview-summary-total-${t.qty}`}>
                    {fmtMoney(t.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
