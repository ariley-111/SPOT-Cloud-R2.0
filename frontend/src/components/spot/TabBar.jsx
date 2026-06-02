/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";

/** Tabs row matching legacy: tab pills + "+" / Duplicate / (Spin Off)
 *  Right side: Expand / Collapse all sections links */
export default function TabBar() {
  const { tabs, activeId, setActiveId, closeTab, newTab, duplicateTab,
    initials, expandAll, collapseAll } = useQuote();

  return (
    <div data-testid="spot-tab-bar" style={{
      display: "flex", alignItems: "center", paddingLeft: 6,
      background: "var(--spot-bg2)", height: 32, flexShrink: 0,
      borderBottom: "1px solid var(--spot-line)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, flex: 1, overflow: "hidden" }}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const hasCust = !!t.state.custName;
          return (
            <div key={t.id}
              data-testid={`tab-${t.id}`}
              data-active={isActive ? "1" : "0"}
              onClick={() => setActiveId(t.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 10px", fontSize: 12, fontWeight: 600,
                background: isActive ? "var(--spot-bg)" : "var(--spot-bg3)",
                color: isActive ? "var(--spot-text)" : "var(--spot-text3)",
                border: "1px solid var(--spot-line)", borderBottom: "none",
                borderRadius: "5px 5px 0 0", cursor: "pointer",
                position: "relative", top: 1,
                maxWidth: 240, minWidth: 90,
              }}>
              {hasCust && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--spot-green)" }} />}
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: t.state.estNum ? "'JetBrains Mono', monospace" : "inherit",
                fontSize: 11,
              }}>{t.state.estNum || t.label || "New Quote"}</span>
              {hasCust && (
                <span style={{ fontSize: 10, color: "var(--spot-text3)", maxWidth: 60,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.state.custName}
                </span>
              )}
              <span data-testid={`tab-close-${t.id}`}
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                style={{ marginLeft: 4, color: "var(--spot-text3)", cursor: "pointer", fontSize: 14 }}>×</span>
            </div>
          );
        })}

        {/* "+" New Quote button (initials chip removed — already shown in toolbar
            header next to customer/project name per user request 2026-06-02). */}
        <button onClick={newTab} data-testid="tab-add-btn" style={{
          all: "unset", cursor: "pointer", fontSize: 16, fontWeight: 700,
          padding: "0 12px", color: "var(--spot-green)", whiteSpace: "nowrap",
          height: 22, lineHeight: "22px",
        }}>+</button>
        <button onClick={duplicateTab} data-testid="tab-duplicate-btn" style={{
          all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
          padding: "0 8px", color: "var(--spot-accent)",
          height: 22, lineHeight: "22px",
        }}>Duplicate</button>
        <button data-testid="tab-spinoff-btn" style={{
          all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
          padding: "0 8px", color: "var(--spot-text3)",
          height: 22, lineHeight: "22px",
        }}>Spin Off</button>
      </div>

      <div style={{ display: "flex", gap: 12, paddingRight: 14 }}>
        <button onClick={expandAll} data-testid="btn-expand-all" style={linkBtn}>Expand</button>
        <button onClick={collapseAll} data-testid="btn-collapse-all" style={linkBtn}>Collapse</button>
      </div>
    </div>
  );
}

const linkBtn = {
  all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
  color: "var(--spot-text3)",
};
