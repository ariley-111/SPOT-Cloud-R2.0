/* eslint-disable */
import React, { useState, useRef, useEffect } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { F } from "./Sec";
import Tile from "./Tile";
import { searchCustomers } from "../../api/spot";
import { generateEstNum } from "../../lib/format";

export default function EstimateInfoSec() {
  const { active, sec, toggleSec, setField, setManyFields, setPricingMode, initials } = useQuote();
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
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 2fr 1fr" }}>
        <F l="Estimate #">
          <input className="sp-input" value={s.estNum || ""}
            data-testid="input-est-num"
            onChange={(e) => { setField("estNum", e.target.value); setField("estNumAuto", false); }} />
        </F>
        <F l="Customer">
          <CustomerInput value={s.custName}
            onChange={(v) => setField("custName", v)}
            onSelect={(r) => {
              // Build full ship-to address from customer record (legacy parity:
              // includes street + city + state, ZIP held in destZip).
              const parts = [r.address_1, r.address_2, r.city, r.state].filter(Boolean);
              const ship = parts.join(", ");
              setManyFields({
                custName: r.name, custCode: r.code, customerRecord: r,
                destZip: r.zip || "",
                quoteShipTo: ship,    // legacy reads this for PDF Ship To row
                shipTo: ship,         // back-compat
              });
            }} />
        </F>
        <F l="Project Name">
          <input className="sp-input" value={s.custRef || ""}
            data-testid="input-project-name"
            onChange={(e) => setField("custRef", e.target.value)} />
        </F>
      </div>

      {/* Quote Type + Pricing Mode + Prepress Scope row */}
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
            <Tile label="Individual"  active={s.pricingMode === "Individual"}  onClick={() => setPricingMode("Individual")}  small data-testid="tile-pricing-individual" />
            <Tile label="Matched Set" active={s.pricingMode === "Matched Set"} onClick={() => setPricingMode("Matched Set")} small data-testid="tile-pricing-matched" />
            {/* Prepress Scope — ports legacy spot_r1_5.jsx L5598-5610 (MP only, gated on print) */}
            {s.printReq === "Yes" && (() => {
              const pScope = s.prepressScope || "Per Item";
              const treat = s.jobPrepressTreatment || "Separate Line";
              return (
                <>
                  <span style={{ width: 1, height: 16, background: "var(--spot-border)", margin: "0 4px" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text3)",
                    textTransform: "uppercase", letterSpacing: ".06em", flexShrink: 0 }}>Prepress</span>
                  <Tile label="None"       active={pScope === "None"}     onClick={() => setField("prepressScope", "None")}     small tint="#94a3b8" data-testid="tile-prepress-scope-none" />
                  <Tile label="Per Item"   active={pScope === "Per Item"} onClick={() => setField("prepressScope", "Per Item")} small tint="#22c55e" data-testid="tile-prepress-scope-item" />
                  <Tile label="Lot Charge" active={pScope === "Per Job"}  onClick={() => {
                    setField("prepressScope", "Per Job");
                    if ((s.jobPrepressTreatment || "None") === "None") setField("jobPrepressTreatment", "Separate Line");
                  }} small tint="#06b6d4" data-testid="tile-prepress-scope-lot" />
                  {pScope === "Per Job" && (
                    <>
                      <span style={{ width: 1, height: 16, background: "var(--spot-border)", margin: "0 2px" }} />
                      <Tile label="Line"  active={treat === "Separate Line"} onClick={() => setField("jobPrepressTreatment", "Separate Line")} small tint="#22c55e" data-testid="tile-jobprepress-line" />
                      <Tile label="Amort" active={treat === "Amortize"}      onClick={() => setField("jobPrepressTreatment", "Amortize")}      small data-testid="tile-jobprepress-amort" />
                      <div style={{ position: "relative", display: "inline-flex" }}>
                        <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                          fontSize: 11, color: "var(--spot-text3)", pointerEvents: "none" }}>$</span>
                        <input className="sp-input" type="number"
                          value={s.jobPrepressCost ?? ""}
                          onChange={(e) => setField("jobPrepressCost", e.target.value)}
                          step="0.01" min="0"
                          data-testid="input-job-prepress-cost"
                          style={{ width: 85, padding: "6px 10px 6px 20px", fontSize: 13 }} />
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Quantities — up to 8 slots, +Qty adds a slot, Auto-Fill multiplies last */}
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
          const cur = s.qtys || [];
          if (cur.length >= 8) return;
          setField("qtys", [...cur, ""]);
        }} data-testid="btn-qty-add"
          disabled={(s.qtys || []).length >= 8}
          style={{
            all: "unset", cursor: (s.qtys || []).length >= 8 ? "not-allowed" : "pointer",
            fontSize: 11, fontWeight: 700, color: "var(--spot-accent)",
            padding: "4px 8px", border: "1px solid var(--spot-accent)", borderRadius: 3,
            opacity: (s.qtys || []).length >= 8 ? 0.4 : 1,
          }}
          title="Add another quantity slot (max 8)">+ Qty</button>
        <button onClick={() => {
          const filled = (s.qtys || []).filter((q) => Number(q) > 0);
          const last = Number(filled[filled.length - 1]) || 100;
          const tiers = [last, last * 2, last * 5, last * 10, last * 20].slice(0, 5).map(String);
          setField("qtys", tiers);
        }} data-testid="btn-qty-autofill"
          style={{
            all: "unset", cursor: "pointer",
            fontSize: 11, fontWeight: 700, color: "var(--spot-green)",
            padding: "4px 8px", border: "1px solid var(--spot-green)", borderRadius: 3,
          }}
          title="Auto-fill 5 tiers from last entered (×1, ×2, ×5, ×10, ×20)">Auto-Fill</button>
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
