/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import { searchCustomers } from "../../api/spot";

export default function CustomerTypeahead({ value, onSelect, onChangeName, "data-testid": dti }) {
  const [q, setQ] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const t = useRef(null);

  useEffect(() => setQ(value || ""), [value]);

  const search = (s) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      if (!s || s.length < 2) { setResults([]); return; }
      try { const r = await searchCustomers(s, 8); setResults(r || []); } catch (_) { setResults([]); }
    }, 200);
  };

  return (
    <div style={{ position: "relative" }}>
      <input className="sp-input" value={q}
        data-testid={dti || "customer-typeahead-input"}
        placeholder="Search by code or name…"
        onChange={(e) => { const v = e.target.value; setQ(v); onChangeName?.(v); setOpen(true); search(v); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") { setHi((h) => Math.min(h + 1, results.length - 1)); e.preventDefault(); }
          if (e.key === "ArrowUp") { setHi((h) => Math.max(h - 1, 0)); e.preventDefault(); }
          if (e.key === "Enter") { const r = results[hi]; if (r) { onSelect?.(r); setQ(r.name); setOpen(false); } }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <div data-testid="customer-typeahead-results" style={{
          position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 30,
          background: "var(--spot-bg3)", border: "1px solid var(--spot-border)",
          borderRadius: 4, maxHeight: 240, overflow: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          {results.map((r, i) => (
            <div key={r.code}
              data-testid={`customer-result-${r.code}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect?.(r); setQ(r.name); setOpen(false); }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                background: i === hi ? "var(--spot-accent-soft)" : "transparent",
                borderBottom: "1px solid var(--spot-line)",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--spot-text)" }}>{r.name}</span>
                <span style={{ color: "var(--spot-text3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{r.code}</span>
              </div>
              {(r.city || r.state) && (
                <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>
                  {[r.city, r.state, r.zip].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
