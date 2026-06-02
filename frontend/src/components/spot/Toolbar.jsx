/* eslint-disable */
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useQuote } from "../../context/QuoteContext";
import { createQuote } from "../../api/spot";
import ApiStatusPill from "./ApiStatusPill";

/** Matches legacy SPOT top bar: cube logo + SPOT + version + Est#/Initials/Customer
 *  Right: Undo / Save / [File] / Load / Quote Header / Preview Quote / Cost Report */
export default function Toolbar({ openModal }) {
  const { user, logout } = useAuth();
  const { active, pushToast } = useQuote();
  const s = active?.state || {};
  const [saving, setSaving] = React.useState(false);
  const fileCbRef = React.useRef(null);

  const onSave = async () => {
    if (!active) return;
    if (saving) return;
    if (!s.estNum && !s.custName && !s.itemDesc) {
      pushToast("Add an estimate # or customer first", "warn");
      return;
    }
    setSaving(true);
    try {
      const saved = await createQuote({
        est_num: s.estNum || `DRAFT-${Date.now()}`,
        label: s.custRef || s.itemDesc || s.custName || "Untitled",
        state: s,
      });
      pushToast(`Saved ${saved.est_num || s.estNum || "quote"}`, "ok");
      // If "File" checkbox is checked, also download a .json snapshot
      if (fileCbRef.current?.checked) {
        const blob = new Blob([JSON.stringify({ est_num: saved.est_num, state: s }, null, 2)],
          { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(saved.est_num || s.estNum || "quote").replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
      }
    } catch (e) {
      pushToast(`Save failed — ${e?.response?.data?.detail || e.message}`, "err");
    } finally { setSaving(false); }
  };

  return (
    <div data-testid="spot-toolbar" style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 14px", height: 40, flexShrink: 0,
      background: "var(--spot-bg2)", borderBottom: "1px solid var(--spot-line)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.03em",
          color: "var(--spot-text)" }} data-testid="logo-text">SPOT</span>
        <span className="sp-pill" style={{
          background: "var(--spot-bg3)", color: "var(--spot-text3)",
          border: "1px solid var(--spot-border)", fontSize: 10,
        }} data-testid="version-pill">R2.0 Cloud</span>
        {s.estNum && (
          <span style={{ fontSize: 12, color: "var(--spot-text3)",
            fontFamily: "'JetBrains Mono', monospace" }} data-testid="toolbar-est-num">
            #{s.estNum}
          </span>
        )}
        {s.custName && (
          <span style={{ fontSize: 12, color: "var(--spot-text3)" }}
            data-testid="toolbar-cust">— {s.custName}</span>
        )}
        {s.custRef && (
          <span style={{ fontSize: 11, color: "var(--spot-text3)", opacity: 0.7 }}>/ {s.custRef}</span>
        )}
        {s.estInitials && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-accent)",
            padding: "1px 6px", border: "1px solid var(--spot-accent)", borderRadius: 3,
            marginLeft: 4 }}
            data-testid="toolbar-initials">{s.estInitials}</span>
        )}
        <ApiStatusPill />
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button data-testid="toolbar-undo" title="Undo (Ctrl+Z)" style={btn}>↩</button>
        <button data-testid="toolbar-save" onClick={onSave} disabled={saving} style={{ ...btn,
          background: "var(--spot-green-soft)", color: "var(--spot-green)",
          border: "1px solid var(--spot-green)",
          opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <label title="Also export .json on Save"
          style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 11, color: "var(--spot-text3)" }}>
          <input ref={fileCbRef} type="checkbox" data-testid="toolbar-file-checkbox" /> File
        </label>
        <button data-testid="toolbar-load" onClick={() => openModal("load")} style={btn}>Load</button>
        <span style={{ width: 1, height: 16, background: "var(--spot-border)" }} />
        <button data-testid="toolbar-quote-header" onClick={() => openModal("quote-header")} style={btn}>Quote Header</button>
        <button data-testid="toolbar-preview" onClick={() => openModal("preview")} style={{ ...btn,
          background: "var(--spot-accent-soft)", color: "var(--spot-accent)",
          border: "1px solid var(--spot-accent)" }}>Preview Quote</button>
        <button data-testid="toolbar-cost-report" onClick={() => openModal("cost-report")} style={{ ...btn,
          background: "var(--spot-purple-bg)", color: "var(--spot-purple)",
          border: "1px solid var(--spot-purple)" }}>Cost Report</button>
        <span style={{ width: 1, height: 16, background: "var(--spot-border)" }} />
        <span style={{ fontSize: 10, color: "var(--spot-text3)" }} data-testid="toolbar-user-email">{user?.email}</span>
        <button onClick={logout} title="Sign out" data-testid="toolbar-logout" style={btn}>⎋</button>
      </div>
    </div>
  );
}

const btn = {
  all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
  padding: "4px 10px", borderRadius: 4,
  background: "var(--spot-bg3)", color: "var(--spot-text2)",
  border: "1px solid var(--spot-border)",
};
