/* eslint-disable */
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useQuote } from "../../context/QuoteContext";
import { createQuote, updateQuote, updateQuoteStatus, reassignParserFiles } from "../../api/spot";
import ApiStatusPill from "./ApiStatusPill";
import SpotCube from "./SpotCube";

/** Matches legacy SPOT top bar: cube logo + SPOT + version + Est#/Initials/Customer
 *  Right: Undo / Save / [File] / Load / Quote Header / Preview Quote / Cost Report */
export default function Toolbar({ openModal, onOpenAdmin, onOpenBomBuilder }) {
  const { user, logout } = useAuth();
  const { active, pushToast, convertToMultiPart, convertToSimple, setField } = useQuote();
  const s = active?.state || {};
  const isMP = s.quoteType === "Multi-Part";
  const itemCount = (s.bomItems || []).length;
  const [saving, setSaving] = React.useState(false);
  const fileCbRef = React.useRef(null);

  // Status of the saved quote — drives the colored dropdown pill in the toolbar.
  // `s.quoteId` is set on first save; before then the dropdown stays a hint.
  const quoteId = s.quoteId || null;
  const currentStatus = s.quoteStatus || "draft";
  const [statusSaving, setStatusSaving] = React.useState(false);
  const onStatusChange = async (newStatus) => {
    if (newStatus === currentStatus) return;
    if (!quoteId) {
      // No saved quote yet — just stash locally; will be persisted on first Save
      setField("quoteStatus", newStatus);
      pushToast(`Status set to ${newStatus} — save the quote to persist`, "info");
      return;
    }
    setStatusSaving(true);
    try {
      await updateQuoteStatus(quoteId, newStatus);
      setField("quoteStatus", newStatus);
      pushToast(`Status → ${newStatus}`, "ok");
    } catch (e) {
      pushToast(`Status change failed — ${e?.response?.data?.detail || e.message}`, "err");
    } finally { setStatusSaving(false); }
  };
  const statusTint = {
    draft: { bg: "var(--spot-bg3)",       fg: "var(--spot-text3)" },
    saved: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
    sent:  { bg: "rgba(245,158,11,0.15)", fg: "#f59e0b" },
    won:   { bg: "rgba(34,197,94,0.15)",  fg: "#22c55e" },
    lost:  { bg: "rgba(239,68,68,0.15)",  fg: "#ef4444" },
    hold:  { bg: "rgba(168,85,247,0.15)", fg: "#a855f7" },
  }[currentStatus] || { bg: "var(--spot-bg3)", fg: "var(--spot-text3)" };

  const onToggleMP = () => {
    if (isMP && itemCount >= 1) {
      // Already MP with items — convert back to Simple (only allowed if 1 item)
      if (itemCount > 1) {
        pushToast("Cannot convert — remove extra components first", "warn");
        return;
      }
      convertToSimple();
    } else {
      // Simple OR Multi-Part with 0 items: open BOM Builder (templates / manual)
      if (onOpenBomBuilder) onOpenBomBuilder();
    }
  };

  // Theme: default LIGHT (Rich Walter preference 2026-06-02). Persist to
  // localStorage so it survives reload. <html data-theme="..."> is read by
  // /app/frontend/src/theme.css to swap CSS variable palettes.
  const [theme, setTheme] = React.useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("spot_theme") || "light";
  });
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("spot_theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  const onSave = async () => {
    if (!active) return;
    if (saving) return;
    if (!s.estNum && !s.custName && !s.itemDesc) {
      pushToast("Add an estimate # or customer first", "warn");
      return;
    }
    setSaving(true);
    try {
      const body = {
        est_num: s.estNum || `DRAFT-${Date.now()}`,
        label: s.custRef || s.itemDesc || s.custName || "Untitled",
        state: s,
        status: currentStatus,
        customer_code: s.custCode || null,
        customer_name: s.custName || null,
      };
      // If this quote was already saved (or loaded from Saved), UPDATE it in
      // place — never create a duplicate. update_quote on the backend preserves
      // the pinned pricingVersionId, so a frozen quote stays frozen.
      const isUpdate = !!quoteId;
      const saved = isUpdate
        ? await updateQuote(quoteId, body)
        : await createQuote(body);
      // Stash the quote's id + status + pinned pricing version onto local state
      // so the status dropdown can PATCH and recalcs stay on the right version.
      setField("quoteId", saved.id);
      setField("quoteStatus", saved.status || currentStatus);
      if (saved.pricing_version_id) setField("pricingVersionId", saved.pricing_version_id);
      // Migrate parser files from the draft tab id → saved-quote id on FIRST save
      // so they remain accessible when the quote is later loaded back.
      // (Bug fix 2026-02-15.) On update the files already live under quoteId.
      try {
        if (!isUpdate && active?.id && saved.id && active.id !== saved.id) {
          await reassignParserFiles(active.id, saved.id);
        }
      } catch (_) {}
      pushToast(`${isUpdate ? "Updated" : "Saved"} ${saved.est_num || s.estNum || "quote"}`, "ok");
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
        <SpotCube size={20} />
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
        <button data-testid="toolbar-theme-toggle" onClick={toggleTheme}
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          style={{ ...btn, minWidth: 32, padding: "0 8px", fontSize: 14 }}>
          {theme === "light" ? "🌙" : "☀"}
        </button>
        <button data-testid="toolbar-undo" title="Undo (Ctrl+Z)" style={btn}>↩</button>
        <button data-testid="toolbar-toggle-mp" onClick={onToggleMP}
          title={isMP ? "Convert this quote back to Simple (single piece)" : "Convert this quote to Multi-Part (display, kit, or set)"}
          style={{ ...btn,
            background: isMP ? "#f59e0b22" : "var(--spot-bg3)",
            color: isMP ? "#f59e0b" : "var(--spot-text2)",
            border: `1px solid ${isMP ? "#f59e0b88" : "var(--spot-border)"}`,
            fontWeight: 700,
          }}>{isMP ? `Multi-Part · ${itemCount}` : "→ Multi-Part"}</button>
        <button data-testid="toolbar-save" onClick={onSave} disabled={saving} style={{ ...btn,
          background: "var(--spot-green-soft)", color: "var(--spot-green)",
          border: "1px solid var(--spot-green)",
          opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <select data-testid="toolbar-status" value={currentStatus}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={statusSaving}
          title={quoteId ? "Quote status — saved instantly" : "Quote status — will be saved when you Save"}
          style={{
            ...btn,
            background: statusTint.bg, color: statusTint.fg,
            border: `1px solid ${statusTint.fg}55`,
            fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em",
            fontSize: 10, padding: "4px 6px", cursor: statusSaving ? "wait" : "pointer",
            appearance: "auto",
          }}>
          <option value="draft">Draft</option>
          <option value="saved">Saved</option>
          <option value="sent">Sent</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="hold">Hold</option>
        </select>
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
        {user?.role === "admin" && onOpenAdmin && (
          <button onClick={onOpenAdmin} data-testid="toolbar-admin" title="Pricing Admin Console"
            style={{ ...btn, background: "var(--spot-purple-bg)", color: "var(--spot-purple)",
              border: "1px solid var(--spot-purple)" }}>Admin</button>
        )}
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
