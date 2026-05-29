/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec from "./Sec";

/** Placeholder collapsible sections — full controls land Phase 4. */

export function PricingStrategySec() {
  const { sec, toggleSec } = useQuote();
  return (
    <Sec label="Pricing Strategy" hue="#8b5cf6" open={sec.pricing} onToggle={() => toggleSec("pricing")}
      data-testid="sec-pricing-strategy">
      <Placeholder note="Tier targets, set-margin overrides, force-sell controls — Phase 4." />
    </Sec>
  );
}

export function AdvancedControlsSec() {
  const { sec, toggleSec } = useQuote();
  return (
    <Sec label="Advanced Controls" hue="#6b7280" open={sec.rates} onToggle={() => toggleSec("rates")}
      data-testid="sec-advanced-controls">
      <Placeholder note="Rate sheet, freight markup, UTS, default targets — Phase 4 (admin-gated)." />
    </Sec>
  );
}

export function BoardEngineSec() {
  const { sec, toggleSec } = useQuote();
  return (
    <Sec label="Board Engine" hue="#4b5563" open={sec.engine} onToggle={() => toggleSec("engine")}
      data-testid="sec-board-engine">
      <Placeholder note="Sheet library viewer, board substitution log, machine envelope checks — Phase 4." />
    </Sec>
  );
}

export function BomSec() {
  const { active, sec, toggleSec, setField, setManyFields } = useQuote();
  const s = active?.state || {};
  if (s.quoteType !== "Multi-Part") return null;
  const items = s.bomItems || [];
  const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a"];

  const addItem = () => {
    const next = [...items, { id: "it_"+Date.now(), desc: `Item ${items.length+1}`, type: "Manufactured", pcsPerSet: 1 }];
    setManyFields({ bomItems: next, activeItemIdx: next.length - 1 });
  };
  const rm = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    setManyFields({ bomItems: next, activeItemIdx: Math.max(0, Math.min(s.activeItemIdx, next.length - 1)) });
  };

  return (
    <Sec label={<>Bill of Materials <span style={{ opacity: 0.7 }}>· {items.length} Component{items.length !== 1 ? "s" : ""}</span></>}
      hue="#f59e0b" open={sec.bom} onToggle={() => toggleSec("bom")} data-testid="sec-bom">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }} data-testid="bom-strip">
        {items.map((it, i) => {
          const tint = tints[i % tints.length];
          const isActive = i === s.activeItemIdx;
          return (
            <div key={it.id} data-testid={`bom-item-${i}`}
              onClick={() => setField("activeItemIdx", i)}
              style={{
                padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                background: isActive ? `${tint}22` : "var(--spot-bg3)",
                border: `1px solid ${isActive ? tint : "var(--spot-border)"}`,
                color: isActive ? tint : "var(--spot-text2)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
              <input value={it.desc} onChange={(e) => {
                const next = items.map((c, idx) => idx === i ? { ...c, desc: e.target.value } : c);
                setField("bomItems", next);
              }} onClick={(e) => e.stopPropagation()}
                style={{ background: "transparent", border: "none", color: "inherit",
                  fontSize: 11, outline: "none", width: 120, fontFamily: "inherit" }} />
              <select value={it.type} onChange={(e) => {
                const next = items.map((c, idx) => idx === i ? { ...c, type: e.target.value } : c);
                setField("bomItems", next);
              }} onClick={(e) => e.stopPropagation()}
                style={{ background: "var(--spot-bg2)", color: "var(--spot-text3)",
                  border: "1px solid var(--spot-border)", borderRadius: 3,
                  fontSize: 10, padding: "1px 3px", outline: "none" }}>
                <option>Manufactured</option><option>Fulfillment</option><option>Purchased</option>
              </select>
              <span onClick={(e) => { e.stopPropagation(); rm(i); }} data-testid={`bom-rm-${i}`}
                style={{ color: "var(--spot-text3)", cursor: "pointer" }}>×</span>
            </div>
          );
        })}
        <button onClick={addItem} data-testid="bom-add-btn" style={{
          all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
          padding: "5px 10px", borderRadius: 3,
          background: "var(--spot-accent)", color: "#fff",
        }}>+ Component</button>
      </div>
    </Sec>
  );
}

function Placeholder({ note }) {
  return (
    <div style={{
      padding: "10px 12px", fontSize: 12, color: "var(--spot-text3)",
      fontStyle: "italic", background: "var(--spot-bg3)",
      border: "1px dashed var(--spot-border)", borderRadius: 4,
    }}>
      {note}
    </div>
  );
}
