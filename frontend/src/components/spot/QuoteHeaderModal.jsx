/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";

/**
 * Quote Header modal — verbatim port of legacy spot_r1_5.jsx L7600-7628.
 * Edits commercial fields that appear on the customer-facing PDF:
 *   Payment Terms · FOB display · Quote Valid (days) · Expiration date
 *   Ship To Address · ZIP · Quote Notes
 */
export default function QuoteHeaderModal({ onClose }) {
  const { active, setField, setManyFields } = useQuote();
  const s = active?.state || {};

  // Close on ESC
  React.useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const exp = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (parseInt(s.quoteExpDays, 10) || 30));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  })();

  const zipOk = (s.destZip || "").length >= 5;

  return (
    <div className="sp-modal-backdrop" data-testid="modal-backdrop-quote-header"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div data-testid="modal-quote-header" role="dialog" aria-modal="true"
        style={{ background: "var(--spot-bg2)", borderRadius: 8, width: 600, maxWidth: "94vw",
          maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
          color: "var(--spot-text)", border: "1px solid var(--spot-border)" }}>

        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--spot-line)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Quote Header</span>
          <button data-testid="quote-header-close" onClick={onClose}
            style={{ all: "unset", cursor: "pointer", fontSize: 20, color: "var(--spot-text3)",
              padding: "0 6px" }}>×</button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field l="Payment Terms">
              <select className="sp-input" data-testid="qh-terms"
                value={s.quoteTerms || "Net 30"}
                onChange={(e) => setField("quoteTerms", e.target.value)}>
                {["Net 30","Net 45","Net 60","Due on Receipt","COD","Prepaid"].map((o) =>
                  <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field l="FOB">
              <div style={{ display: "flex", gap: 4 }}>
                <Pill label="Origin (Will-Call)" active={(s.quoteFOB || "Origin") === "Origin"}
                  testid="qh-fob-origin" onClick={() => setField("quoteFOB", "Origin")} />
                <Pill label="Destination" active={s.quoteFOB === "Destination"}
                  testid="qh-fob-dest" onClick={() => setField("quoteFOB", "Destination")} />
              </div>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field l="Quote Valid (days)">
              <input className="sp-input" type="number" min="1" step="1" data-testid="qh-exp-days"
                value={s.quoteExpDays ?? 30}
                onChange={(e) => setField("quoteExpDays", e.target.value)} />
            </Field>
            <Field l="Expiration">
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--spot-text)", padding: "5px 0" }}>{exp}</div>
            </Field>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Field l="Ship To Address" style={{ flex: 1 }}>
              <input className="sp-input" data-testid="qh-ship-to" placeholder="Address, city, state"
                value={s.quoteShipTo || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const patch = { quoteShipTo: v };
                  // Legacy line 7619: extract ZIP only if destZip is empty
                  const m = v.match(/\b(\d{5})\b/);
                  if (m && !s.destZip) patch.destZip = m[1];
                  setManyFields(patch);
                }} />
            </Field>
            <Field l="ZIP" style={{ width: 80, flexShrink: 0 }}>
              <input className="sp-input" type="text" maxLength={5} data-testid="qh-zip"
                value={s.destZip || ""}
                onChange={(e) => setField("destZip", e.target.value.replace(/\D/g, ""))}
                placeholder="ZIP"
                style={{ textAlign: "center", fontWeight: 700, fontSize: 14, letterSpacing: ".05em",
                  border: `1px solid ${zipOk ? "#22c55e" : "#ef4444"}` }} />
            </Field>
          </div>

          <Field l="Quote Notes">
            <textarea className="sp-input" rows={3} data-testid="qh-notes"
              value={s.quoteNotes || ""}
              onChange={(e) => setField("quoteNotes", e.target.value)}
              placeholder="Special terms, conditions, or notes for customer..."
              style={{ resize: "vertical", minHeight: 60 }} />
          </Field>
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--spot-line)",
          display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} data-testid="qh-done-btn"
            style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
              padding: "6px 16px", borderRadius: 5, background: "var(--spot-accent)", color: "#fff" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ l, children, style }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
      textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</span>
    {children}
  </div>;
}

function Pill({ label, active, onClick, testid }) {
  return <button data-testid={testid} onClick={onClick}
    style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
      padding: "4px 10px", borderRadius: 3,
      background: active ? "var(--spot-accent)" : "transparent",
      color: active ? "#fff" : "var(--spot-text2)",
      border: `1px solid ${active ? "var(--spot-accent)" : "var(--spot-border)"}` }}>
    {label}
  </button>;
}
