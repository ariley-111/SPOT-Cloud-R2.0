/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";

const COLORS = ["#e8927c", "#b08cf5", "#7dd3c0", "#e88dc4", "#8cc8e8", "#d4a76a"];

export default function BomStrip() {
  const { active, setField, setManyFields } = useQuote();
  const s = active.state;
  const items = s.bomItems || [];
  const activeIdx = s.activeItemIdx || 0;

  const addItem = () => {
    const next = [...items, { id: "it_" + Date.now(), desc: `Item ${items.length + 1}`, type: "Manufactured", pcsPerSet: 1 }];
    setManyFields({ bomItems: next, activeItemIdx: next.length - 1 });
  };
  const removeItem = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    setManyFields({ bomItems: next, activeItemIdx: Math.max(0, Math.min(activeIdx, next.length - 1)) });
  };
  const renameItem = (i, desc) => {
    const next = items.map((it, idx) => idx === i ? { ...it, desc } : it);
    setField("bomItems", next);
  };
  const setType = (i, type) => {
    const next = items.map((it, idx) => idx === i ? { ...it, type } : it);
    setField("bomItems", next);
  };

  return (
    <div data-testid="bom-strip" style={{
      background: "var(--spot-bg3)", border: "1px solid var(--spot-line)",
      borderRadius: 4, padding: 8, marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="sp-label" style={{ margin: 0 }}>BOM · {items.length} items</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select className="sp-input" style={{ width: 130, padding: "3px 6px", fontSize: 11 }}
            value={s.pricingMode} onChange={(e) => setField("pricingMode", e.target.value)}
            data-testid="select-pricing-mode">
            <option>Individual</option>
            <option>Matched Set</option>
          </select>
          <button className="sp-btn sp-btn-primary" onClick={addItem} data-testid="bom-add-item-btn"
            style={{ padding: "2px 8px", fontSize: 11 }}>+ Item</button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {items.map((it, i) => {
          const tint = COLORS[i % COLORS.length];
          const isActive = i === activeIdx;
          return (
            <div key={it.id}
              data-testid={`bom-item-${i}`}
              onClick={() => setField("activeItemIdx", i)}
              style={{
                padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                background: isActive ? `${tint}22` : "var(--spot-bg2)",
                border: `1px solid ${isActive ? tint : "var(--spot-border)"}`,
                color: isActive ? tint : "var(--spot-text2)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
              <input value={it.desc} onChange={(e) => renameItem(i, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "transparent", border: "none", color: "inherit",
                  fontSize: 11, fontFamily: "inherit", outline: "none", width: 100,
                }} />
              <select value={it.type} onChange={(e) => { e.stopPropagation(); setType(i, e.target.value); }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--spot-bg3)", color: "var(--spot-text3)",
                  border: "1px solid var(--spot-border)", borderRadius: 3,
                  fontSize: 10, padding: "1px 3px", outline: "none",
                }}>
                <option>Manufactured</option><option>Fulfillment</option><option>Purchased</option>
              </select>
              <span onClick={(e) => { e.stopPropagation(); removeItem(i); }}
                data-testid={`bom-remove-${i}`}
                style={{ color: "var(--spot-text3)", cursor: "pointer", marginLeft: 2 }}>×</span>
            </div>
          );
        })}
        {items.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--spot-text3)", padding: 4 }}>
            No items yet — click <strong>+ Item</strong> to start building a Multi-Part quote.
          </div>
        )}
      </div>
    </div>
  );
}
