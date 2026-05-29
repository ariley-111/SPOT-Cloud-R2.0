/* eslint-disable */
import React, { useState, useRef, useEffect } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { F } from "./Sec";
import Tile from "./Tile";
import { searchCustomers } from "../../api/spot";
import { generateEstNum } from "../../lib/format";

export default function EstimateInfoSec() {
  const { active, sec, toggleSec, setField, setManyFields, initials } = useQuote();
  const s = active?.state || {};
  const headerLabel = (
    <>
      <span>Estimate Info</span>
      {s.spinOffOrigin && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
          background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44",
        }}>🔗 From: {s.spinOffOrigin}</span>
      )}
      {(s.custName || s.custRef) && (
        <span style={{
          flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800,
          letterSpacing: ".02em", color: "var(--spot-text)", textTransform: "none",
        }}>{[s.custName, s.custRef].filter(Boolean).join("  —  ")}</span>
      )}
    </>
  );

  return (
    <Sec label={headerLabel} hue="#94a3b8" open={sec.job} onToggle={() => toggleSec("job")}
         data-testid="sec-estimate-info">
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr 1fr auto" }}>
        <F l="Estimate #">
          <input className="sp-input" value={s.estNum || ""}
            data-testid="input-est-num"
            onChange={(e) => { setField("estNum", e.target.value); setField("estNumAuto", false); }} />
        </F>
        <F l="Customer">
          <CustomerInput value={s.custName}
            onChange={(v) => setField("custName", v)}
            onSelect={(r) => setManyFields({
              custName: r.name, custCode: r.code, customerRecord: r,
              destZip: r.zip || "", shipTo: [r.city, r.state, r.zip].filter(Boolean).join(", "),
            })} />
        </F>
        <F l="Project Name">
          <input className="sp-input" value={s.custRef || ""}
            data-testid="input-project-name"
            onChange={(e) => setField("custRef", e.target.value)} />
        </F>
        <F l="Initials">
          <input className="sp-input" value={s.estInitials || ""}
            data-testid="input-est-initials"
            maxLength={4}
            onChange={(e) => setField("estInitials", e.target.value.toUpperCase().slice(0, 4))}
            placeholder="—"
            style={{
              width: 52, textAlign: "center", fontWeight: 700, letterSpacing: ".05em",
              padding: "5px 6px", fontSize: 12,
              borderColor: (!s.estInitials || s.estInitials.length < 2) ? "var(--spot-err)" : undefined,
            }} />
        </F>
      </div>

      {/* Quote Type + Pricing Mode row */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text3)",
          textTransform: "uppercase", letterSpacing: ".06em", width: 64, flexShrink: 0 }}>Quote</span>
        <Tile label="Simple"     active={s.quoteType === "Simple"}     onClick={() => setField("quoteType", "Simple")}     small data-testid="tile-quote-simple" />
        <Tile label="Multi-Part" active={s.quoteType === "Multi-Part"} onClick={() => setField("quoteType", "Multi-Part")} small data-testid="tile-quote-multipart" />
        {s.quoteType === "Multi-Part" && (
          <>
            <span style={{ width: 1, height: 16, background: "var(--spot-border)", margin: "0 4px" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em", flexShrink: 0 }}>Pricing</span>
            <Tile label="Individual"  active={s.pricingMode === "Individual"}  onClick={() => setField("pricingMode", "Individual")}  small data-testid="tile-pricing-individual" />
            <Tile label="Matched Set" active={s.pricingMode === "Matched Set"} onClick={() => setField("pricingMode", "Matched Set")} small data-testid="tile-pricing-matched" />
          </>
        )}
      </div>

      {/* Quantities */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text3)",
          textTransform: "uppercase", letterSpacing: ".06em", width: 64, flexShrink: 0 }}>Qty</span>
        {(s.qtys || ["", "", "", "", ""]).map((q, i) => (
          <input key={i} className="sp-input" type="number" value={q || ""}
            data-testid={`input-qty-${i}`}
            placeholder="—"
            onChange={(e) => {
              const next = [...(s.qtys || ["", "", "", "", ""])];
              while (next.length < 5) next.push("");
              next[i] = e.target.value; setField("qtys", next);
            }}
            style={{ width: 65, padding: "4px 6px", fontSize: 12, textAlign: "center" }} />
        ))}
        <button onClick={() => {
          const filled = (s.qtys || []).filter((q) => Number(q) > 0);
          const last = filled[filled.length - 1] || 100;
          const tiers = [last, last * 2, last * 5, last * 10, last * 20].slice(0, 5).map(String);
          setField("qtys", tiers);
        }} style={{
          all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-green)",
          padding: "4px 6px",
        }} data-testid="btn-qty-autofill">+Qty Auto-Fill</button>
      </div>
    </Sec>
  );
}

function CustomerInput({ value, onChange, onSelect }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const t = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!value || value.length < 3) { setResults([]); setOpen(false); return; }
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      try { const r = await searchCustomers(value, 10); setResults(r || []); setOpen((r || []).length > 0); setHi(0); }
      catch (_) { setResults([]); setOpen(false); }
    }, 200);
    return () => clearTimeout(t.current);
  }, [value]);

  return (
    <div style={{ position: "relative" }}>
      <input ref={ref} className="sp-input" value={value || ""}
        data-testid="input-customer"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter")   { e.preventDefault(); onSelect(results[hi]); setOpen(false); }
          else if (e.key === "Escape")  { setOpen(false); }
        }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div data-testid="customer-typeahead-results" style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
          borderRadius: 4, marginTop: 2, maxHeight: 280, overflowY: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,.4)",
        }}>
          {results.map((r, i) => (
            <div key={r.code}
              data-testid={`customer-result-${r.code}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect(r); setOpen(false); }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                background: i === hi ? "var(--spot-accent-soft)" : "transparent",
                borderBottom: i < results.length - 1 ? "1px solid var(--spot-line)" : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>{[r.city, r.state].filter(Boolean).join(", ")}</span>
              </span>
              <span style={{ color: "var(--spot-text3)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{r.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
