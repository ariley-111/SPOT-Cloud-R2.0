/* eslint-disable */
import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { useQuote } from "../../context/QuoteContext";
import KpiTimer from "./KpiTimer";

export default function Toolbar({ openModal }) {
  const { user, logout } = useAuth();
  const { active, initials, setInitials, setField, newTab } = useQuote();
  const [editingInitials, setEditingInitials] = useState(!initials);
  const [initInput, setInitInput] = useState(initials);
  const initRef = useRef(null);

  useEffect(() => { if (editingInitials) initRef.current?.focus(); }, [editingInitials]);

  const commitInitials = () => {
    const v = (initInput || "").trim().toUpperCase();
    if (v.length < 2) { setEditingInitials(false); return; }
    setInitials(v);
    setEditingInitials(false);
  };

  return (
    <div data-testid="spot-toolbar" style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 16px", height: 44, flexShrink: 0,
      background: "var(--spot-bg2)", borderBottom: "1px solid var(--spot-line)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 4, background: "var(--spot-accent)",
          display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 13,
        }}>S</div>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>SPOT</span>
        <span className="sp-pill" style={{ background: "var(--spot-accent-soft)", color: "var(--spot-accent)", borderColor: "var(--spot-accent)" }}>
          R2.0 CLOUD
        </span>

        <div style={{ width: 1, height: 22, background: "var(--spot-line)", margin: "0 6px" }} />

        {/* Initials */}
        {editingInitials ? (
          <input ref={initRef} value={initInput}
            onChange={(e) => setInitInput(e.target.value.toUpperCase().slice(0, 4))}
            onBlur={commitInitials}
            onKeyDown={(e) => { if (e.key === "Enter") commitInitials(); }}
            placeholder="Initials"
            className="sp-input"
            style={{ width: 70, padding: "3px 6px", fontSize: 11 }}
            data-testid="initials-input"
          />
        ) : (
          <button className="sp-pill" onClick={() => { setInitInput(initials); setEditingInitials(true); }}
            data-testid="initials-display"
            style={{ background: "var(--spot-green-soft)", color: "var(--spot-green)", borderColor: "var(--spot-green)" }}>
            {initials || "Set initials"}
          </button>
        )}

        {/* Est # */}
        {active?.state?.estNum && (
          <span style={{ fontSize: 12, color: "var(--spot-text2)", fontFamily: "'JetBrains Mono', monospace" }}
            data-testid="active-est-num">
            #{active.state.estNum}
          </span>
        )}
        {active?.state?.custName && (
          <span style={{ fontSize: 12, color: "var(--spot-text3)" }} data-testid="active-cust-name">
            — {active.state.custName}
          </span>
        )}
        {active?.state?.projectName && (
          <span style={{ fontSize: 12, color: "var(--spot-text3)", opacity: 0.7 }}>
            / {active.state.projectName}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <KpiTimer />
        <button className="sp-btn" onClick={() => openModal("parse")} data-testid="toolbar-parse-btn">
          Parse RFQ
        </button>
        <button className="sp-btn" onClick={() => openModal("load")} data-testid="toolbar-load-btn">
          Load
        </button>
        <button className="sp-btn" onClick={() => openModal("freight")} data-testid="toolbar-freight-btn">
          Freight
        </button>
        <button className="sp-btn" onClick={() => openModal("preview")} data-testid="toolbar-preview-btn">
          Preview Quote
        </button>
        <button className="sp-btn" onClick={() => openModal("cost-report")} data-testid="toolbar-cost-report-btn">
          Cost Report
        </button>
        <button className="sp-btn sp-btn-primary" onClick={newTab} data-testid="toolbar-new-btn">
          + New
        </button>

        <div style={{ width: 1, height: 22, background: "var(--spot-line)", margin: "0 6px" }} />

        <span style={{ fontSize: 11, color: "var(--spot-text3)" }} data-testid="toolbar-user-email">
          {user?.email}
        </span>
        <button className="sp-btn" onClick={logout} data-testid="toolbar-logout-btn" title="Sign out">⎋</button>
      </div>
    </div>
  );
}
