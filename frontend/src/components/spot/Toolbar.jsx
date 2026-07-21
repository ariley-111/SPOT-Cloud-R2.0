/* eslint-disable */
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useQuote } from "../../context/QuoteContext";
import { createQuote, updateQuote, updateQuoteStatus, reassignParserFiles, setQuoteTestFlag, downloadTestingReport } from "../../api/spot";
import ApiStatusPill from "./ApiStatusPill";
import SpotCube from "./SpotCube";
import {
  FolderOpen, FileText, Eye, Calculator, Layers, Save as SaveIcon, Download,
  Moon, Sun, Settings, LogOut, User, ChevronDown,
} from "lucide-react";

/** SPOT top bar — 5-zone Swiss/high-contrast layout (design_guidelines.json).
 *  Zone 1 Brand · Zone 2 Quote context · Zone 3 Output actions (ghost) ·
 *  Zone 4 Multi-Part / Status dot / Save (primary) · Zone 5 Account menu. */
export default function Toolbar({ openModal, onOpenAdmin, onOpenBomBuilder }) {
  const { user, logout } = useAuth();
  const { active, pushToast, convertToMultiPart, convertToSimple, setField } = useQuote();
  const s = active?.state || {};
  const viewOnly = !!s.viewOnly;
  const isMP = s.quoteType === "Multi-Part";
  const itemCount = (s.bomItems || []).length;
  const [saving, setSaving] = React.useState(false);

  const quoteId = s.quoteId || null;
  const currentStatus = s.quoteStatus || "draft";
  const [statusSaving, setStatusSaving] = React.useState(false);
  const onStatusChange = async (newStatus) => {
    if (newStatus === currentStatus) return;
    if (!quoteId) {
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
  const statusDot = {
    draft: "#9CA3AF", saved: "#F59E0B", sent: "#10B981",
  }[currentStatus] || "#9CA3AF";

  const onToggleMP = () => {
    if (isMP && itemCount >= 1) {
      if (itemCount > 1) { pushToast("Cannot convert — remove extra components first", "warn"); return; }
      convertToSimple();
    } else if (onOpenBomBuilder) { onOpenBomBuilder(); }
  };

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
    if (!active || saving) return;
    if (!s.estNum && !s.custName && !s.itemDesc) {
      pushToast("Add an estimate # or customer first", "warn"); return;
    }
    setSaving(true);
    try {
      const body = {
        est_num: s.estNum || `DRAFT-${Date.now()}`,
        label: s.custRef || s.itemDesc || s.custName || "Untitled",
        state: s, status: currentStatus,
        customer_code: s.custCode || null, customer_name: s.custName || null,
      };
      const isUpdate = !!quoteId;
      const saved = isUpdate ? await updateQuote(quoteId, body) : await createQuote(body);
      setField("quoteId", saved.id);
      setField("quoteStatus", saved.status || currentStatus);
      if (saved.pricing_version_id) setField("pricingVersionId", saved.pricing_version_id);
      try {
        if (!isUpdate && active?.id && saved.id && active.id !== saved.id) {
          await reassignParserFiles(active.id, saved.id);
        }
      } catch (_) {}
      pushToast(`${isUpdate ? "Updated" : "Saved"} ${saved.est_num || s.estNum || "quote"}`, "ok");
    } catch (e) {
      pushToast(`Save failed — ${e?.response?.data?.detail || e.message}`, "err");
    } finally { setSaving(false); }
  };

  // TEMPORARY — testing/comparison flag helpers.
  const onToggleTestFlag = async (checked) => {
    setField("goodForTesting", checked);
    if (quoteId) {
      try { await setQuoteTestFlag(quoteId, { good_for_testing: checked, iquote_num: s.iquoteNum || "", became_job: !!s.iquoteWon }); } catch (_) {}
    } else if (checked) {
      pushToast("Flagged — Save the quote to include it in the testing report", "warn");
    }
  };
  const onToggleBecameJob = async (checked) => {
    setField("iquoteWon", checked);
    if (quoteId) {
      try { await setQuoteTestFlag(quoteId, { good_for_testing: !!s.goodForTesting, iquote_num: s.iquoteNum || "", became_job: checked }); } catch (_) {}
    }
  };
  const onTestReport = async () => {
    try {
      pushToast("Building testing report…", "info");
      await downloadTestingReport();
    } catch (e) {
      pushToast(`Report failed — ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  return (
    <div data-testid="spot-toolbar" style={{
      display: "flex", alignItems: "stretch", height: 56, flexShrink: 0,
      background: "var(--spot-bg)", borderBottom: "1px solid var(--spot-border)",
    }}>
      {/* ── Zone 1 · Brand ── */}
      <div style={{ ...zone, gap: 9, paddingLeft: 16 }}>
        <SpotCube size={22} />
        <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-.03em",
          color: "var(--spot-text)" }} data-testid="logo-text">SPOT</span>
        <span className="sp-pill" style={{
          background: "var(--spot-bg3)", color: "var(--spot-text3)",
          border: "1px solid var(--spot-border)", fontSize: 9.5, fontWeight: 700,
        }} data-testid="version-pill">R2.0 Cloud</span>
        <ApiStatusPill />
      </div>

      {/* ── Zone 2 · Quote context (2 lines, truncated) ── */}
      <div style={{ ...zone, flex: 1, minWidth: 0, flexDirection: "column",
        alignItems: "flex-start", justifyContent: "center", gap: 2, paddingLeft: 16 }}
        data-testid="toolbar-quote-context">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
          {s.estInitials && (
            <span data-testid="toolbar-initials" title="Estimator"
              style={{ fontSize: 11, fontWeight: 800, color: "var(--spot-accent)",
                padding: "1px 6px", border: "1px solid var(--spot-accent)", borderRadius: 4,
                lineHeight: 1.4, flexShrink: 0 }}>{s.estInitials}</span>
          )}
          {s.estNum ? (
            <span data-testid="toolbar-est-num" title={`Estimate ${s.estNum}`}
              style={{ fontSize: 13, fontWeight: 600, color: "var(--spot-text)",
                fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>#{s.estNum}</span>
          ) : (
            <span style={{ fontSize: 12, color: "var(--spot-text3)", fontStyle: "italic", flexShrink: 0 }}>
              New quote
            </span>
          )}
          {s.custName && (
            <span data-testid="toolbar-cust" title={s.custName}
              style={{ fontSize: 13, color: "var(--spot-text2)", fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 260, minWidth: 0 }}>{s.custName}</span>
          )}
        </div>
        {s.custRef && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%" }}>
            <span style={{ fontSize: 11, color: "var(--spot-text3)", flexShrink: 0 }}>↳</span>
            <span data-testid="toolbar-project" title={s.custRef}
              style={{ fontSize: 11.5, color: "var(--spot-text3)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 340, minWidth: 0 }}>{s.custRef}</span>
          </div>
        )}
      </div>

      {/* ── Zone 3 · Output actions (neutral ghost) ── */}
      <div style={{ ...zone, gap: 2 }}>
        {/* TEMPORARY — testing/comparison flag + iQuote # + report export */}
        <label data-testid="toolbar-test-flag-label" title="Flag this quote as good for testing/comparison with the legacy system (temporary)"
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
                   color: s.goodForTesting ? "var(--spot-green)" : "var(--spot-text3)", padding: "0 4px", cursor: viewOnly ? "not-allowed" : "pointer" }}>
          <input type="checkbox" data-testid="toolbar-test-flag" checked={!!s.goodForTesting}
            disabled={viewOnly} onChange={(e) => onToggleTestFlag(e.target.checked)} />
          Test
        </label>
        {s.goodForTesting && (
          <input data-testid="toolbar-iquote-num" value={s.iquoteNum || ""}
            onChange={(e) => setField("iquoteNum", e.target.value)}
            onBlur={() => { if (quoteId) setQuoteTestFlag(quoteId, { good_for_testing: true, iquote_num: s.iquoteNum || "", became_job: !!s.iquoteWon }).catch(() => {}); }}
            placeholder="iQuote #" className="sp-input"
            style={{ width: 76, fontSize: 11, padding: "3px 6px", marginRight: 2 }} />
        )}
        {s.goodForTesting && (
          <label data-testid="toolbar-became-job-label" title="Did this iQuote become a job?"
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
                     color: s.iquoteWon ? "var(--spot-green)" : "var(--spot-text3)", padding: "0 4px", cursor: "pointer" }}>
            <input type="checkbox" data-testid="toolbar-became-job" checked={!!s.iquoteWon}
              onChange={(e) => onToggleBecameJob(e.target.checked)} />
            Job?
          </label>
        )}
        <button data-testid="toolbar-test-report" onClick={onTestReport} className="sp-tb-ghost" style={ghost}
          title="Export all quotes flagged for testing to .xlsx">
          <Download size={15} strokeWidth={2} /> Report
        </button>
        <button data-testid="toolbar-load" onClick={() => openModal("load")} className="sp-tb-ghost" style={ghost} title="Load a saved quote">
          <FolderOpen size={15} strokeWidth={2} /> Load
        </button>
        <button data-testid="toolbar-quote-header" onClick={() => openModal("quote-header")} className="sp-tb-ghost" style={ghost} title="Edit quote header / customer details">
          <FileText size={15} strokeWidth={2} /> Header
        </button>
        <button data-testid="toolbar-preview" onClick={() => openModal("preview")} className="sp-tb-ghost" style={ghost} title="Preview the customer-facing quote">
          <Eye size={15} strokeWidth={2} /> Preview
        </button>
        <button data-testid="toolbar-cost-report" onClick={() => openModal("cost-report")} className="sp-tb-ghost" style={ghost} title="Internal cost breakdown report">
          <Calculator size={15} strokeWidth={2} /> Cost Report
        </button>
      </div>

      {/* ── Zone 4 · Multi-Part / Status / Save ── */}
      <div style={{ ...zone, gap: 8 }}>
        <button data-testid="toolbar-toggle-mp" onClick={onToggleMP}
          title={isMP ? "Convert back to Simple (single piece)" : "Convert to Multi-Part (display, kit, or set)"}
          className="sp-tb-ghost" style={{ ...ghost, color: isMP ? "#F59E0B" : "var(--spot-text2)", fontWeight: 700 }}>
          <Layers size={15} strokeWidth={2} />{isMP ? `Multi-Part · ${itemCount}` : "Multi-Part"}
        </button>

        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: statusDot,
            position: "absolute", left: 9, pointerEvents: "none" }} />
          <select data-testid="toolbar-status" value={currentStatus}
            onChange={(e) => onStatusChange(e.target.value)} disabled={statusSaving || viewOnly}
            title={viewOnly ? "View only — Take Over to change status" : (quoteId ? "Quote status — saved instantly" : "Quote status — saved when you Save")}
            style={{ ...outline, paddingLeft: 22, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: ".04em", fontSize: 10, cursor: (statusSaving || viewOnly) ? "not-allowed" : "pointer",
              opacity: viewOnly ? 0.5 : 1, appearance: "auto" }}>
            <option value="draft">Draft</option>
            <option value="saved">Saved</option>
            <option value="sent">Sent</option>
          </select>
        </div>

        <button data-testid="toolbar-save" onClick={onSave} disabled={saving || viewOnly}
          className="sp-tb-primary" title={viewOnly ? "View only — Take Over or Copy to save" : "Save quote"}
          style={{ ...primary, opacity: (saving || viewOnly) ? 0.5 : 1, cursor: viewOnly ? "not-allowed" : saving ? "wait" : "pointer" }}>
          <SaveIcon size={15} strokeWidth={2.2} />{saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── Zone 5 · Account menu ── */}
      <div style={{ display: "flex", alignItems: "center", paddingLeft: 12, paddingRight: 12 }}>
        <AccountMenu user={user} theme={theme} toggleTheme={toggleTheme}
          onOpenAdmin={onOpenAdmin} logout={logout} />
      </div>
    </div>
  );
}

function AccountMenu({ user, theme, toggleTheme, onOpenAdmin, logout }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const initials = (user?.email || "?").slice(0, 2).toUpperCase();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button data-testid="toolbar-user-menu" onClick={() => setOpen((o) => !o)}
        title="Account" className="sp-tb-ghost" style={{ ...ghost, gap: 6, paddingRight: 6 }}>
        <span style={{ width: 24, height: 24, borderRadius: 24, flexShrink: 0,
          background: "var(--spot-accent-soft)", color: "var(--spot-accent)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 800 }}>{initials}</span>
        <ChevronDown size={14} strokeWidth={2} style={{
          transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {open && (
        <div data-testid="toolbar-user-dropdown" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 220, zIndex: 1200,
          background: "var(--spot-bg2)", border: "1px solid var(--spot-border)", borderRadius: 8,
          boxShadow: "0 8px 28px rgba(0,0,0,0.22)", padding: 6,
          animation: "spotMenuIn .12s ease",
        }}>
          <div style={{ padding: "6px 10px 8px", borderBottom: "1px solid var(--spot-line)", marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em" }}>Signed in as</div>
            <div data-testid="toolbar-user-email" title={user?.email}
              style={{ fontSize: 12, color: "var(--spot-text)", fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
          </div>
          <button data-testid="toolbar-theme-toggle" onClick={() => { toggleTheme(); }} className="sp-tb-menuitem" style={menuItem}>
            {theme === "light" ? <Moon size={15} strokeWidth={2} /> : <Sun size={15} strokeWidth={2} />}
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          {user?.role === "admin" && onOpenAdmin && (
            <button data-testid="toolbar-admin" onClick={() => { setOpen(false); onOpenAdmin(); }} className="sp-tb-menuitem" style={menuItem}>
              <Settings size={15} strokeWidth={2} /> Pricing Admin
            </button>
          )}
          <button data-testid="toolbar-logout" onClick={() => { setOpen(false); logout(); }}
            className="sp-tb-menuitem" style={{ ...menuItem, color: "#EF4444" }}>
            <LogOut size={15} strokeWidth={2} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const zone = {
  display: "flex", alignItems: "center", paddingRight: 16, paddingLeft: 16,
  borderRight: "1px solid var(--spot-line)",
};
const ghost = {
  all: "unset", boxSizing: "border-box", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
  padding: "6px 10px", borderRadius: 6, color: "var(--spot-text)",
  display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
  transition: "background-color .12s ease",
};
const outline = {
  all: "unset", boxSizing: "border-box", cursor: "pointer",
  border: "1px solid var(--spot-border)", borderRadius: 6, padding: "6px 8px",
  background: "var(--spot-bg2)", color: "var(--spot-text)",
};
const primary = {
  all: "unset", boxSizing: "border-box", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
  padding: "7px 14px", borderRadius: 6, background: "var(--spot-green)", color: "#fff",
  display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
  boxShadow: "0 1px 2px rgba(0,0,0,0.12)", transition: "filter .12s ease",
};
const menuItem = {
  all: "unset", boxSizing: "border-box", cursor: "pointer", width: "100%",
  display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 6,
  fontSize: 12.5, fontWeight: 600, color: "var(--spot-text)",
  transition: "background-color .12s ease",
};
