/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";

export default function TabBar() {
  const { tabs, activeId, setActiveId, closeTab, newTab } = useQuote();
  return (
    <div data-testid="spot-tab-bar" style={{
      display: "flex", alignItems: "flex-end", gap: 4, paddingLeft: 12,
      background: "var(--spot-bg2)", height: 34, flexShrink: 0,
      borderBottom: "1px solid var(--spot-line)",
    }}>
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        return (
          <div key={t.id}
            data-testid={`tab-${t.id}`}
            data-active={isActive ? "1" : "0"}
            className={`sp-tab ${isActive ? "is-active" : ""}`}
            onClick={() => setActiveId(t.id)}>
            <span style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160,
              color: isActive ? "var(--spot-text)" : "var(--spot-text3)",
            }}>
              {t.state.estNum || t.label || "New Quote"}
            </span>
            {t.state.custName && (
              <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>· {t.state.custName.slice(0, 14)}</span>
            )}
            <span className="close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              data-testid={`tab-close-${t.id}`}
              style={{ marginLeft: 6, color: "var(--spot-text3)", cursor: "pointer", fontSize: 12 }}>×</span>
          </div>
        );
      })}
      <button className="sp-btn" onClick={newTab} data-testid="tab-add-btn"
        style={{ marginLeft: 4, padding: "2px 10px", fontSize: 14 }}>+</button>
    </div>
  );
}
