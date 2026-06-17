/* eslint-disable */
/** Pricing Admin Console — Phase 4
 *  Admin-only UI for managing engine rates, GM curve, sell curve, and grade adders.
 *  Defaults baked in code; overrides persisted in MongoDB; baseline always restorable.
 *  See /app/backend/services/rate_overrides.py for the override layer architecture. */
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import {
  adminGetRates, adminGetCategories, adminGetCalibration,
  adminSetRate, adminResetRate, adminResetAll, adminGetAudit,
  adminGetIntegrations, adminSetIntegration, adminResetIntegration, adminGetUsage,
  adminGetSheets, adminAddSheet, adminEditSheet, adminDisableSheet, adminEnableSheet,
  adminExportSheetsCsv, adminImportSheetsCsv,
  adminPricingVersions, adminPricingGetVersion, adminPricingImport,
  adminPricingActivate, adminPricingDeleteDraft,
  listQuoteAudit,
} from "../api/spot";

const TAB_LABELS = {
  rate:         "Rates",
  gm_tier:      "GM Curve",
  sell_tier:    "Sell Curve",
  grade_adder:  "Grade Adders",
  board_pricing:"Board Pricing",
  sheets:       "Sheet Library",
  integrations: "Integrations",
  usage:        "Usage",
  audit:        "Audit Log",
  calibration:  "Calibration",
};
const TAB_ORDER = ["rate", "gm_tier", "sell_tier", "grade_adder", "board_pricing",
                   "sheets", "integrations", "usage", "audit", "calibration"];

export default function AdminPage({ onClose }) {
  const { user } = useAuth();
  const [tab, setTab] = useState("rate");
  const [data, setData] = useState(null);
  const [cats, setCats] = useState(null);
  const [calib, setCalib] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const reload = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [rates, categories, baseline] = await Promise.all([
        adminGetRates(), adminGetCategories(), adminGetCalibration(),
      ]);
      setData(rates); setCats(categories); setCalib(baseline);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const onSave = async (cat, key, val) => {
    try {
      await adminSetRate(cat, key, val);
      await reload();
      flash(`Saved ${key} = ${val}`);
    } catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };
  const onReset = async (cat, key) => {
    try {
      await adminResetRate(cat, key);
      await reload();
      flash(`Reset ${key} → baseline`);
    } catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };
  const onResetAll = async (cat) => {
    const label = cat ? TAB_LABELS[cat] : "ALL CATEGORIES";
    if (!window.confirm(`Reset ALL overrides in ${label}? This restores every value to its calibrated baseline. The change will be audit-logged.`)) return;
    try {
      const r = await adminResetAll(cat);
      await reload();
      flash(`Reset ${r.reset_count} override${r.reset_count !== 1 ? "s" : ""}`);
    } catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };

  if (user?.role !== "admin") {
    return (
      <FullScreen onClose={onClose}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--spot-text2)" }} data-testid="admin-denied">
          <h2 style={{ color: "var(--spot-err)" }}>Admin only</h2>
          <p>You need administrator privileges to view this page.</p>
          <button onClick={onClose} style={btnStyle}>← Back to SPOT</button>
        </div>
      </FullScreen>
    );
  }

  const overrideCount = data?.override_count ?? 0;

  return (
    <FullScreen onClose={onClose}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 20px", borderBottom: "1px solid var(--spot-border)",
        background: "var(--spot-bg2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={onClose} data-testid="admin-back-btn" style={{
            ...btnStyle, padding: "6px 12px",
          }}>← Back to SPOT</button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--spot-text)" }}>
              Pricing Admin Console
            </div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {loading ? "Loading…" : (
                <>{overrideCount} active override{overrideCount !== 1 ? "s" : ""} · baseline: {calib?.name || "—"}</>
              )}
            </div>
          </div>
        </div>
        {!loading && overrideCount > 0 && (
          <button onClick={() => onResetAll(null)} data-testid="admin-reset-all-btn" style={{
            ...btnStyle, background: "var(--spot-err)", color: "#fff", borderColor: "var(--spot-err)",
          }}>Reset ALL overrides</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, padding: "0 20px", borderBottom: "1px solid var(--spot-border)",
        background: "var(--spot-bg2)" }} data-testid="admin-tabs">
        {TAB_ORDER.map((t) => (
          <button key={t} onClick={() => setTab(t)} data-testid={`admin-tab-${t}`}
            style={{
              all: "unset", cursor: "pointer", padding: "10px 18px", fontSize: 12, fontWeight: 600,
              color: tab === t ? "var(--spot-accent)" : "var(--spot-text3)",
              borderBottom: `2px solid ${tab === t ? "var(--spot-accent)" : "transparent"}`,
              textTransform: "uppercase", letterSpacing: ".05em",
            }}>{TAB_LABELS[t]}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: 20, background: "var(--spot-bg)" }}>
        {err && <div style={{ color: "var(--spot-err)", padding: 10 }} data-testid="admin-err">{err}</div>}
        {loading && <div style={{ color: "var(--spot-text3)" }}>Loading rates…</div>}
        {!loading && data && (
          <>
            {(tab === "rate" || tab === "gm_tier" || tab === "sell_tier" || tab === "grade_adder") && (
              <CategoryPanel
                category={tab}
                rows={data.categories[tab] || []}
                meta={cats?.[tab]}
                onSave={onSave}
                onReset={onReset}
                onResetAll={() => onResetAll(tab)}
              />
            )}
            {tab === "sheets" && <SheetLibraryPanel />}
            {tab === "board_pricing" && <BoardPricingPanel flash={flash} />}
            {tab === "integrations" && <IntegrationsPanel />}
            {tab === "usage" && <UsagePanel />}
            {tab === "audit" && <AuditPanel />}
            {tab === "calibration" && <CalibrationPanel data={calib} />}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div data-testid="admin-toast" style={{
          position: "fixed", bottom: 20, right: 20,
          background: toast.startsWith("✗") ? "var(--spot-err)" : "var(--spot-green)",
          color: "#fff", padding: "8px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}>{toast}</div>
      )}
    </FullScreen>
  );
}

function FullScreen({ children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "var(--spot-bg)",
      backgroundColor: "var(--spot-bg, #f5f5f4)",  // hard fallback so it's never transparent
      display: "flex", flexDirection: "column",
    }} data-testid="admin-page">
      {/* Opaque underlay — guarantees nothing from SpotApp bleeds through */}
      <div style={{ position: "absolute", inset: 0, background: "var(--spot-bg)",
        backgroundColor: "#fafaf9", zIndex: -1 }} aria-hidden="true" />
      {children}
    </div>
  );
}

// ─── Category panel (Rates / GM / Sell / Grade) ─────────────────────────
function CategoryPanel({ category, rows, meta, onSave, onReset, onResetAll }) {
  const groups = meta?.groups || [{ label: meta?.label || category, keys: rows.map((r) => r.key) }];
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const overrideRows = rows.filter((r) => r.is_override);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>{meta?.label || TAB_LABELS[category]}</div>
        <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>{meta?.description}</div>
        {overrideRows.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--spot-warn)", fontWeight: 600 }}>
              {overrideRows.length} override{overrideRows.length !== 1 ? "s" : ""} active in this category
            </span>
            <button onClick={onResetAll} data-testid={`admin-reset-cat-${category}`} style={{
              ...btnStyle, fontSize: 10, padding: "3px 8px",
            }}>Reset all in {TAB_LABELS[category]}</button>
          </div>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: "var(--spot-text3)", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>{g.label}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "32%" }} />     {/* Key */}
              <col style={{ width: "20%" }} />     {/* Current value */}
              <col style={{ width: "16%" }} />     {/* Baseline */}
              <col style={{ width: "12%" }} />     {/* Status */}
              <col style={{ width: "20%" }} />     {/* Actions */}
            </colgroup>
            <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
              <th style={th}>Key</th>
              <th style={{ ...th, textAlign: "right" }}>Current value</th>
              <th style={{ ...th, textAlign: "right" }}>Baseline</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {g.keys.map((k) => {
                const r = byKey[k];
                if (!r) return null;
                return <RateRow key={r.key} r={r} onSave={onSave} onReset={onReset} category={category} />;
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function RateRow({ r, onSave, onReset, category }) {
  const [val, setVal] = useState(String(r.value ?? ""));
  const [editing, setEditing] = useState(false);
  React.useEffect(() => { setVal(String(r.value ?? "")); }, [r.value]);

  const isDirty = String(val) !== String(r.value);
  const isOverride = r.is_override;

  return (
    <tr style={{ borderBottom: "1px solid var(--spot-line)" }} data-testid={`admin-row-${category}-${r.key}`}>
      <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text2)" }}>{r.key}</td>
      <td style={{ ...td, textAlign: "right" }}>
        <input value={val} onChange={(e) => { setVal(e.target.value); setEditing(true); }}
          data-testid={`admin-input-${category}-${r.key}`}
          onKeyDown={(e) => { if (e.key === "Enter" && isDirty) onSave(category, r.key, val);
                              if (e.key === "Escape") { setVal(String(r.value ?? "")); setEditing(false); } }}
          style={{
            background: editing ? "var(--spot-bg2)" : "transparent",
            border: `1px solid ${editing ? "var(--spot-accent)" : "var(--spot-border)"}`,
            padding: "3px 6px", borderRadius: 3, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            color: isOverride ? "var(--spot-warn)" : "var(--spot-text)", textAlign: "right",
            width: 120, maxWidth: "100%", boxSizing: "border-box",
            fontWeight: isOverride ? 700 : 400, outline: "none",
          }} />
      </td>
      <td style={{ ...td, textAlign: "right", color: "var(--spot-text3)",
        fontFamily: "'JetBrains Mono', monospace" }}>{String(r.baseline)}</td>
      <td style={{ ...td, textAlign: "center" }}>
        {isOverride ? (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
            background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b66" }}>OVERRIDE</span>
        ) : (
          <span style={{ fontSize: 9, color: "var(--spot-text3)" }}>baseline</span>
        )}
      </td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        {isDirty && (
          <button onClick={() => onSave(category, r.key, val)} data-testid={`admin-save-${category}-${r.key}`}
            style={{ ...btnSmall, background: "var(--spot-green)", color: "#fff", borderColor: "var(--spot-green)" }}>
            Save
          </button>
        )}
        {isOverride && !isDirty && (
          <button onClick={() => onReset(category, r.key)} data-testid={`admin-reset-${category}-${r.key}`}
            style={{ ...btnSmall, marginLeft: 4 }}>↶ Reset</button>
        )}
      </td>
    </tr>
  );
}

// ─── Audit log ──────────────────────────────────────────────────────────
function AuditPanel() {
  const [source, setSource] = useState("rates");  // "rates" | "quotes"
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [filter, setFilter] = useState({ category: "", key: "" });
  const [quoteFilter, setQuoteFilter] = useState({ event: "", quoteId: "" });
  const PAGE = 100;

  const loadRates = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE, skip };
      if (filter.category) params.category = filter.category;
      if (filter.key) params.key = filter.key;
      const r = await adminGetAudit(params);
      setRows(r.rows || []);
    } catch (e) { setRows([]); } finally { setLoading(false); }
  }, [skip, filter]);

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listQuoteAudit(quoteFilter.quoteId || null);
      let filtered = r || [];
      // Apply event-type filter client-side
      if (quoteFilter.event) {
        const want = quoteFilter.event;
        filtered = filtered.filter((row) => {
          if (want === "takeover") return (row.source || "").startsWith("take-over");
          if (want === "copy") return row.source === "copy" || row.field === "copy";
          if (want === "status") return row.field === "status";
          return true;
        });
      }
      setRows(filtered);
    } catch (e) { setRows([]); } finally { setLoading(false); }
  }, [quoteFilter]);

  useEffect(() => {
    if (source === "rates") loadRates(); else loadQuotes();
  }, [source, loadRates, loadQuotes]);

  const fmtTs = (t) => t ? t.replace("T", " ").slice(0, 19) : "—";

  return (
    <div>
      {/* Source switcher — Rate vs Quote activity */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid var(--spot-line)", paddingBottom: 10 }}>
        <button data-testid="audit-source-rates"
          onClick={() => { setSource("rates"); setSkip(0); }}
          style={{
            all: "unset", cursor: "pointer", padding: "6px 14px", borderRadius: 4,
            fontSize: 12, fontWeight: 700,
            background: source === "rates" ? "var(--spot-accent)" : "var(--spot-bg3)",
            color: source === "rates" ? "#fff" : "var(--spot-text2)",
            border: `1px solid ${source === "rates" ? "var(--spot-accent)" : "var(--spot-border)"}`,
          }}>Rate Changes</button>
        <button data-testid="audit-source-quotes"
          onClick={() => { setSource("quotes"); setSkip(0); }}
          style={{
            all: "unset", cursor: "pointer", padding: "6px 14px", borderRadius: 4,
            fontSize: 12, fontWeight: 700,
            background: source === "quotes" ? "var(--spot-accent)" : "var(--spot-bg3)",
            color: source === "quotes" ? "#fff" : "var(--spot-text2)",
            border: `1px solid ${source === "quotes" ? "var(--spot-accent)" : "var(--spot-border)"}`,
          }}>Quote Activity</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--spot-text3)", alignSelf: "center" }}>
          Append-only · retained forever
        </span>
      </div>

      {source === "rates" ? (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Rate-change Audit</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--spot-text3)" }}>Filter:</span>
            <select value={filter.category} onChange={(e) => { setSkip(0); setFilter({ ...filter, category: e.target.value }); }}
              data-testid="admin-audit-cat-filter"
              style={{ fontSize: 11, padding: "3px 6px", background: "var(--spot-bg2)", color: "var(--spot-text2)",
                border: "1px solid var(--spot-border)", borderRadius: 3 }}>
              <option value="">All categories</option>
              {["rate", "gm_tier", "sell_tier", "grade_adder"].map((c) => <option key={c} value={c}>{TAB_LABELS[c]}</option>)}
            </select>
            <input value={filter.key} onChange={(e) => { setSkip(0); setFilter({ ...filter, key: e.target.value }); }}
              placeholder="key (e.g. incaRate)" data-testid="admin-audit-key-filter"
              style={{ fontSize: 11, padding: "3px 6px", background: "var(--spot-bg2)", color: "var(--spot-text2)",
                border: "1px solid var(--spot-border)", borderRadius: 3, width: 140 }} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }} data-testid="admin-audit-table">
            <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
              <th style={th}>Timestamp (UTC)</th>
              <th style={th}>Action</th>
              <th style={th}>Category</th>
              <th style={th}>Key</th>
              <th style={th}>Before</th>
              <th style={th}>After</th>
              <th style={th}>Baseline</th>
              <th style={th}>User</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ ...td, color: "var(--spot-text3)" }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} style={{ ...td, color: "var(--spot-text3)" }}>No history yet</td></tr>
              : rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{fmtTs(r.timestamp)}</td>
                    <td style={td}>{actionLabel(r.type)}</td>
                    <td style={{ ...td, color: "var(--spot-text3)" }}>{r.category || "—"}</td>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace" }}>{r.key || ("count=" + (r.count || ""))}</td>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text3)" }}>{fmtVal(r.value_before)}</td>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-warn)", fontWeight: 600 }}>{fmtVal(r.value_after)}</td>
                    <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text3)" }}>{fmtVal(r.baseline)}</td>
                    <td style={{ ...td, fontSize: 10, color: "var(--spot-text3)" }}>{r.user || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setSkip(Math.max(0, skip - PAGE))} disabled={skip === 0}
              style={{ ...btnSmall, opacity: skip === 0 ? 0.4 : 1 }} data-testid="admin-audit-prev">← Newer</button>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              Showing {skip + 1}–{skip + rows.length}
            </span>
            <button onClick={() => setSkip(skip + PAGE)} disabled={rows.length < PAGE}
              style={{ ...btnSmall, opacity: rows.length < PAGE ? 0.4 : 1 }} data-testid="admin-audit-next">Older →</button>
          </div>
        </>
      ) : (
        // ─── Quote Activity log ─────────────────────────────────────
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Quote Activity</span>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Take-overs · Copies · Status changes</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--spot-text3)" }}>Filter:</span>
            <select value={quoteFilter.event} onChange={(e) => setQuoteFilter({ ...quoteFilter, event: e.target.value })}
              data-testid="audit-quote-event-filter"
              style={{ fontSize: 11, padding: "3px 6px", background: "var(--spot-bg2)", color: "var(--spot-text2)",
                border: "1px solid var(--spot-border)", borderRadius: 3 }}>
              <option value="">All events</option>
              <option value="takeover">Take Over</option>
              <option value="copy">Copy</option>
              <option value="status">Status change</option>
            </select>
            <input value={quoteFilter.quoteId}
              onChange={(e) => setQuoteFilter({ ...quoteFilter, quoteId: e.target.value })}
              placeholder="Quote ID (full UUID)"
              data-testid="audit-quote-id-filter"
              style={{ fontSize: 11, padding: "3px 6px", background: "var(--spot-bg2)", color: "var(--spot-text2)",
                border: "1px solid var(--spot-border)", borderRadius: 3, width: 200 }} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }} data-testid="audit-quote-table">
            <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
              <th style={th}>Timestamp (UTC)</th>
              <th style={th}>Event</th>
              <th style={th}>Quote ID</th>
              <th style={th}>Field</th>
              <th style={th}>Before</th>
              <th style={th}>After</th>
              <th style={th}>Pricing Version</th>
              <th style={th}>By User</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ ...td, color: "var(--spot-text3)" }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} style={{ ...td, color: "var(--spot-text3)" }}>No quote activity yet</td></tr>
              : rows.map((r, i) => {
                  // Pretty event label
                  let eventLabel = r.field;
                  let eventColor = "var(--spot-text2)";
                  if ((r.source || "").startsWith("take-over")) { eventLabel = "Take Over"; eventColor = "#f59e0b"; }
                  else if (r.source === "copy" || r.field === "copy") { eventLabel = "Copy"; eventColor = "#06b6d4"; }
                  else if (r.field === "status") { eventLabel = "Status"; eventColor = "#a855f7"; }
                  // Show owner names instead of UUIDs when we have them
                  const before = r.field === "owner_id" ? (r.old_value_name || r.old_value) : fmtVal(r.old_value);
                  const after = r.field === "owner_id" ? (r.user_name || r.new_value) : fmtVal(r.new_value);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                      <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{fmtTs(r.timestamp)}</td>
                      <td style={{ ...td, fontWeight: 700, color: eventColor }}>{eventLabel}</td>
                      <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text3)", fontSize: 10 }}>
                        {(r.quote_id || "").slice(0, 8)}…
                      </td>
                      <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace" }}>{r.field}</td>
                      <td style={{ ...td, color: "var(--spot-text3)" }}>{before || "—"}</td>
                      <td style={{ ...td, color: "var(--spot-warn)", fontWeight: 600 }}>{after || "—"}</td>
                      <td style={{ ...td, fontSize: 10, color: "var(--spot-text3)" }}>{r.pricing_version_label || "—"}</td>
                      <td style={{ ...td, fontSize: 10, color: "var(--spot-text3)" }}>{r.user_name || r.user_id || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function actionLabel(t) {
  if (t === "rate_override_set") return "Set";
  if (t === "rate_override_reset") return "Reset";
  if (t === "rate_override_reset_all") return "Reset All";
  return t;
}
function fmtVal(v) { return v === null || v === undefined ? "—" : String(v); }

// ─── Sheet Library panel ────────────────────────────────────────────────
function SheetLibraryPanel() {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [toast, setToast] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("active");  // "active" | "all" | "disabled" | "added"
  const [showAdd, setShowAdd] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try { setData(await adminGetSheets()); }
    catch (e) { setToast(`✗ ${e?.response?.data?.detail || e.message}`); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { reload(); }, [reload]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const onDisable = async (id) => {
    const reason = window.prompt(`Reason for disabling ${id}? (optional)`);
    if (reason === null) return;
    try { await adminDisableSheet(id, reason || undefined); await reload(); flash(`Disabled ${id}`); }
    catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };
  const onEnable = async (id) => {
    try { await adminEnableSheet(id); await reload(); flash(`Re-enabled ${id}`); }
    catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };
  const onExport = async () => {
    try {
      const csv = await adminExportSheetsCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "spot_sheet_library.csv"; a.click();
      URL.revokeObjectURL(url);
      flash("Exported sheet library CSV");
    } catch (e) { flash(`✗ ${e.message}`); }
  };

  if (loading || !data) return <div style={{ color: "var(--spot-text3)" }}>Loading sheet library…</div>;
  const counts = data.counts;
  const rows = data.rows
    .filter((r) => {
      if (statusFilter === "active") return r.status === "active" || r.status === "added" || r.status === "edited";
      if (statusFilter === "disabled") return r.status === "disabled";
      if (statusFilter === "added") return r.status === "added" || r.status === "edited";
      return true;  // "all"
    })
    .filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (`${r.f} ${r.g} ${r.ol} ${r.il} ${r.md} ${r.w}x${r.l} ${r.id}`).toLowerCase().includes(q);
    });

  return (
    <div data-testid="sheets-panel">
      {/* Header + counts */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Approved Sheet Library</div>
          <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
            {counts.active} active · {counts.added} user-added · {counts.disabled} disabled · {counts.baseline} baseline
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAdd(true)} data-testid="sheets-add-btn"
            style={{ ...btnStyle, background: "var(--spot-accent)", color: "#fff",
              borderColor: "var(--spot-accent)" }}>+ Add Sheet</button>
          <button onClick={() => setShowImport(true)} data-testid="sheets-import-btn" style={btnStyle}>Import CSV</button>
          <button onClick={onExport} data-testid="sheets-export-btn" style={btnStyle}>Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by spec…"
          data-testid="sheets-search"
          style={{ flex: 1, padding: "5px 8px", fontSize: 12, background: "var(--spot-bg2)",
            color: "var(--spot-text)", border: "1px solid var(--spot-border)", borderRadius: 3 }} />
        {["active", "added", "disabled", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} data-testid={`sheets-filter-${s}`}
            style={{ ...btnSmall,
              background: statusFilter === s ? "var(--spot-accent)" : "var(--spot-bg3)",
              color: statusFilter === s ? "#fff" : "var(--spot-text2)",
              borderColor: statusFilter === s ? "var(--spot-accent)" : "var(--spot-border)" }}>
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }} data-testid="sheets-table">
        <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
          <th style={th}>ID</th>
          <th style={th}>Flute</th>
          <th style={th}>Grade</th>
          <th style={th}>Out Liner</th>
          <th style={th}>In Liner</th>
          <th style={th}>Medium</th>
          <th style={{ ...th, textAlign: "right" }}>W</th>
          <th style={{ ...th, textAlign: "right" }}>L</th>
          <th style={{ ...th, textAlign: "center" }}>Status</th>
          <th style={th}>Updated by</th>
          <th style={th}></th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={11} style={{ ...td, color: "var(--spot-text3)", textAlign: "center", padding: 20 }}>
              No sheets match filter
            </td></tr>
          ) : rows.map((r) => {
            const isDisabled = r.status === "disabled";
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--spot-line)",
                opacity: isDisabled ? 0.55 : 1 }} data-testid={`sheets-row-${r.id}`}>
                <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{r.id}</td>
                <td style={td}>{r.f}</td>
                <td style={td}>{r.g}</td>
                <td style={td}>{r.ol}</td>
                <td style={td}>{r.il}</td>
                <td style={td}>{r.md}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{r.w}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{r.l}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <StatusPill status={r.status} />
                </td>
                <td style={{ ...td, fontSize: 10, color: "var(--spot-text3)" }}>
                  {r.updated_by ? <>{r.updated_by}<br/><span style={{ fontSize: 9 }}>{(r.updated_at || "").slice(0, 16)}</span></> : "—"}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                  {isDisabled ? (
                    <button onClick={() => onEnable(r.id)} data-testid={`sheets-enable-${r.id}`}
                      style={{ ...btnSmall, background: "var(--spot-green)", color: "#fff",
                        borderColor: "var(--spot-green)" }}>Enable</button>
                  ) : (
                    <button onClick={() => onDisable(r.id)} data-testid={`sheets-disable-${r.id}`}
                      style={{ ...btnSmall, color: "var(--spot-err)",
                        borderColor: "var(--spot-err)" }}>Disable</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {showAdd && <AddSheetModal onClose={() => setShowAdd(false)}
        onSaved={(msg) => { setShowAdd(false); reload(); flash(msg); }} />}
      {showImport && <ImportSheetsModal onClose={() => setShowImport(false)}
        onSaved={(msg) => { setShowImport(false); reload(); flash(msg); }} />}

      {toast && (
        <div data-testid="sheets-toast" style={{
          position: "fixed", bottom: 20, right: 20,
          background: toast.startsWith("✗") ? "var(--spot-err)" : "var(--spot-green)",
          color: "#fff", padding: "8px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}>{toast}</div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const styles = {
    active:   { bg: "#22c55e22", fg: "#22c55e", border: "#22c55e66" },
    added:    { bg: "#3b82f622", fg: "#3b82f6", border: "#3b82f666" },
    edited:   { bg: "#f59e0b22", fg: "#f59e0b", border: "#f59e0b66" },
    disabled: { bg: "#ef444422", fg: "#ef4444", border: "#ef444466" },
  }[status] || { bg: "var(--spot-bg3)", fg: "var(--spot-text3)", border: "var(--spot-border)" };
  return (
    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
      background: styles.bg, color: styles.fg, border: `1px solid ${styles.border}` }}>
      {status.toUpperCase()}
    </span>
  );
}

function AddSheetModal({ onClose, onSaved }) {
  const [form, setForm] = React.useState({
    flute: "C", grade: "200", outsideLiner: "42# Kemi-Lite",
    insideLiner: "None", medium: "None", width: "", length: "", reason: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    try {
      await adminAddSheet({
        ...form, width: parseFloat(form.width), length: parseFloat(form.length),
      });
      onSaved(`Added sheet`);
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };
  return (
    <ModalShell title="Add Sheet to Library" onClose={onClose} testid="add-sheet-modal">
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 12px", fontSize: 12 }}>
        {[
          ["Flute",         "flute"],
          ["Grade",         "grade"],
          ["Outside Liner", "outsideLiner"],
          ["Inside Liner",  "insideLiner"],
          ["Medium",        "medium"],
          ["Width (in)",    "width"],
          ["Length (in)",   "length"],
          ["Reason",        "reason"],
        ].map(([label, k]) => (
          <React.Fragment key={k}>
            <span style={{ color: "var(--spot-text3)" }}>{label}</span>
            <input value={form[k]} onChange={(e) => set(k, e.target.value)}
              data-testid={`add-sheet-${k}`}
              type={(k === "width" || k === "length") ? "number" : "text"}
              step="0.01"
              style={{ padding: "5px 8px", fontSize: 12, background: "var(--spot-bg2)",
                color: "var(--spot-text)", border: "1px solid var(--spot-border)",
                borderRadius: 3, fontFamily: (k === "width" || k === "length") ? "'JetBrains Mono', monospace" : "inherit" }} />
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnStyle}>Cancel</button>
        <button onClick={submit} data-testid="add-sheet-submit"
          style={{ ...btnStyle, background: "var(--spot-accent)", color: "#fff",
            borderColor: "var(--spot-accent)" }}>Add Sheet</button>
      </div>
    </ModalShell>
  );
}

function ImportSheetsModal({ onClose, onSaved }) {
  const [file, setFile] = React.useState(null);
  const [reason, setReason] = React.useState("");
  const [result, setResult] = React.useState(null);
  const submit = async () => {
    if (!file) return;
    try {
      const r = await adminImportSheetsCsv(file, reason || undefined);
      setResult(r);
      if (!r.errors.length) onSaved(`Imported ${r.added_count} sheets`);
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };
  return (
    <ModalShell title="Import Sheets CSV" onClose={onClose} testid="import-sheets-modal">
      <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 10, lineHeight: 1.5 }}>
        CSV columns (header required): <code>flute, grade, outsideLiner, insideLiner, medium, width, length</code>.
        Legacy short names (f, g, ol, il, md, w, l) are also accepted.
        Each row becomes a new <b>USR-</b> sheet — no duplicate-detection. Audit-logged.
      </div>
      <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0])}
        data-testid="import-sheets-file"
        style={{ marginBottom: 10, fontSize: 12 }} />
      <input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (audit log)" data-testid="import-sheets-reason"
        style={{ width: "100%", padding: "5px 8px", fontSize: 12,
          background: "var(--spot-bg2)", color: "var(--spot-text)",
          border: "1px solid var(--spot-border)", borderRadius: 3, marginBottom: 12 }} />
      {result && (
        <div style={{ background: "var(--spot-bg2)", padding: 8, borderRadius: 4, fontSize: 11,
          maxHeight: 200, overflow: "auto", marginBottom: 12 }}>
          Added: {result.added_count}.{" "}
          {result.errors.length > 0 && (
            <span style={{ color: "var(--spot-err)" }}>{result.errors.length} errors:
              <ul style={{ margin: "4px 0 0 16px" }}>
                {result.errors.slice(0, 10).map((e, i) =>
                  <li key={i}>Row {e.row}: {e.error}</li>
                )}
              </ul>
            </span>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={btnStyle}>Close</button>
        <button onClick={submit} disabled={!file} data-testid="import-sheets-submit"
          style={{ ...btnStyle, background: file ? "var(--spot-accent)" : "var(--spot-bg3)",
            color: file ? "#fff" : "var(--spot-text3)",
            borderColor: file ? "var(--spot-accent)" : "var(--spot-border)",
            cursor: file ? "pointer" : "not-allowed" }}>Import</button>
      </div>
    </ModalShell>
  );
}

// ─── Board Pricing Versions panel (import / diff / activate) ────────────
function BoardPricingPanel({ flash }) {
  const [versions, setVersions] = React.useState([]);
  const [activeId, setActiveId] = React.useState(null);
  const [sel, setSel] = React.useState(null);       // {version, diff, warnings, ...}
  const [loading, setLoading] = React.useState(true);
  const [showImport, setShowImport] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminPricingVersions();
      setVersions(r.versions || []);
      setActiveId(r.active_id || null);
    } catch (e) { flash("✗ " + (e?.response?.data?.detail || e.message)); }
    finally { setLoading(false); }
  }, [flash]);
  React.useEffect(() => { reload(); }, [reload]);

  const openVersion = async (id) => {
    try { setSel(await adminPricingGetVersion(id)); }
    catch (e) { flash("✗ " + (e?.response?.data?.detail || e.message)); }
  };

  const onImported = async (res) => {
    setShowImport(false);
    await reload();
    setSel(res);                 // import response already carries version + diff
    flash(`Draft created — review the diff, then Activate`);
  };

  const activate = async (id) => {
    if (!window.confirm("Activate this pricing version? New quotes will price on it immediately. Saved quotes stay frozen on their pinned version.")) return;
    setBusy(true);
    try {
      await adminPricingActivate(id);
      flash("✓ Pricing version activated");
      await reload();
      await openVersion(id);
    } catch (e) { flash("✗ " + (e?.response?.data?.detail || e.message)); }
    finally { setBusy(false); }
  };

  const discard = async (id) => {
    if (!window.confirm("Discard this draft pricing version?")) return;
    setBusy(true);
    try {
      await adminPricingDeleteDraft(id);
      flash("Draft discarded");
      setSel(null);
      await reload();
    } catch (e) { flash("✗ " + (e?.response?.data?.detail || e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="board-pricing-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Board Pricing Versions</div>
          <div style={{ fontSize: 11, color: "var(--spot-text3)", marginTop: 2 }}>
            Import a supplier board-price spreadsheet → review the diff → Activate. Imports update
            the board <code>base_matrix</code> only; liner/medium adders are carried forward.
          </div>
        </div>
        <button onClick={() => setShowImport(true)} data-testid="pricing-import-btn"
          style={{ ...btnStyle, background: "var(--spot-accent)", color: "#fff", borderColor: "var(--spot-accent)" }}>
          + Import price list
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Version list */}
        <div style={{ width: 280, flexShrink: 0 }}>
          {loading && <div style={{ color: "var(--spot-text3)", fontSize: 12 }}>Loading…</div>}
          {!loading && versions.map((v) => (
            <button key={v.id} onClick={() => openVersion(v.id)} data-testid={`pricing-version-${v.id}`}
              style={{
                all: "unset", cursor: "pointer", display: "block", width: "100%", boxSizing: "border-box",
                padding: "10px 12px", marginBottom: 6, borderRadius: 6,
                background: sel?.version?.id === v.id ? "var(--spot-bg3)" : "var(--spot-bg2)",
                border: `1px solid ${sel?.version?.id === v.id ? "var(--spot-accent)" : "var(--spot-border)"}`,
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text)" }}>{v.label}</span>
                <PricingStatusPill status={v.status} isActive={v.id === activeId} />
              </div>
              <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 3 }}>
                {v.effective_date ? `Eff ${v.effective_date}` : "—"}
                {v.change_summary?.cells_changed != null && ` · ${v.change_summary.cells_changed} cells`}
                {v.change_summary?.uniform_pct != null && ` · +${v.change_summary.uniform_pct}%`}
              </div>
            </button>
          ))}
        </div>

        {/* Diff detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!sel && <div style={{ color: "var(--spot-text3)", fontSize: 12, paddingTop: 20 }}>
            Select a version to see its rate changes, or import a new price list.</div>}
          {sel && <VersionDetail data={sel} activeId={activeId} busy={busy}
            onActivate={activate} onDiscard={discard} />}
        </div>
      </div>

      {showImport && <ImportPricingModal onClose={() => setShowImport(false)} onImported={onImported} />}
    </div>
  );
}

function PricingStatusPill({ status, isActive }) {
  const map = {
    active: ["var(--spot-green)", "ACTIVE"],
    draft:  ["var(--spot-amber, #b8860b)", "DRAFT"],
    archived: ["var(--spot-text3)", "ARCHIVED"],
  };
  const [bg, label] = map[isActive ? "active" : status] || map.archived;
  return <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#fff",
    background: bg, padding: "2px 6px", borderRadius: 3 }} data-testid="pricing-status-pill">{label}</span>;
}

function VersionDetail({ data, activeId, busy, onActivate, onDiscard }) {
  const v = data.version;
  const diff = data.diff;
  const warnings = data.warnings || [];
  const isActive = v.id === activeId;
  const isDraft = v.status === "draft";
  const s = diff?.summary;
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 }));

  return (
    <div data-testid="pricing-version-detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--spot-text)" }}>{v.label}</span>
          {v.source_file && <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 8 }}>· {v.source_file}</span>}
          {data.sheet_used && <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 6 }}>· tab “{data.sheet_used}”</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isDraft && <button onClick={() => onDiscard(v.id)} disabled={busy} data-testid="pricing-discard-btn"
            style={{ ...btnStyle, color: "var(--spot-err)", borderColor: "var(--spot-err)" }}>Discard</button>}
          {isDraft && <button onClick={() => onActivate(v.id)} disabled={busy} data-testid="pricing-activate-btn"
            style={{ ...btnStyle, background: "var(--spot-green)", color: "#fff", borderColor: "var(--spot-green)" }}>
            {busy ? "Activating…" : "Activate"}</button>}
          {isActive && <span style={{ fontSize: 11, color: "var(--spot-green)", fontWeight: 700, alignSelf: "center" }}>● Live now</span>}
        </div>
      </div>

      {s && (
        <div style={{ display: "flex", gap: 18, fontSize: 12, marginBottom: 10, color: "var(--spot-text2)" }}>
          <span data-testid="pricing-summary-cells"><b>{s.cells_changed}</b> cells changed
            {data.compared_to && <span style={{ color: "var(--spot-text3)" }}> vs {data.compared_to}</span>}</span>
          {s.uniform_pct != null
            ? <span style={{ color: "var(--spot-green)" }}>Uniform <b>+{s.uniform_pct}%</b></span>
            : s.avg_pct != null && <span>avg <b>{s.avg_pct}%</b> ({s.min_pct}% to {s.max_pct}%)</span>}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-amber, #b8860b)",
          borderRadius: 4, padding: 8, marginBottom: 10, fontSize: 11, color: "var(--spot-text2)" }}
          data-testid="pricing-warnings">
          <b style={{ color: "var(--spot-amber, #b8860b)" }}>⚠ {warnings.length} note(s):</b>
          <ul style={{ margin: "4px 0 0 16px" }}>{warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {diff && diff.cells.length > 0 ? (
        <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid var(--spot-border)", borderRadius: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ position: "sticky", top: 0, background: "var(--spot-bg2)" }}>
              {["Wall", "Grade", "Tier", "Old", "New", "Δ%"].map((h) =>
                <th key={h} style={{ textAlign: h === "Old" || h === "New" || h === "Δ%" ? "right" : "left",
                  padding: "6px 10px", borderBottom: "1px solid var(--spot-border)",
                  color: "var(--spot-text3)", fontWeight: 700 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {diff.cells.map((c, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--spot-border)" }}>
                  <td style={{ padding: "4px 10px", color: "var(--spot-text3)" }}>{c.wall === "singlewall" ? "SW" : "DW"}</td>
                  <td style={{ padding: "4px 10px", color: "var(--spot-text)", fontWeight: 600 }}>{c.grade}</td>
                  <td style={{ padding: "4px 10px", color: "var(--spot-text3)" }}>{c.tier}</td>
                  <td style={{ padding: "4px 10px", textAlign: "right", color: "var(--spot-text3)" }}>{fmt(c.old)}</td>
                  <td style={{ padding: "4px 10px", textAlign: "right", color: "var(--spot-text)", fontWeight: 600 }}>{fmt(c.new)}</td>
                  <td style={{ padding: "4px 10px", textAlign: "right",
                    color: c.pct > 0 ? "var(--spot-green)" : c.pct < 0 ? "var(--spot-err)" : "var(--spot-text3)" }}>
                    {c.pct == null ? "—" : `${c.pct > 0 ? "+" : ""}${c.pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--spot-text3)", fontSize: 12 }}>
          {v.is_baseline ? "Baseline version — the in-code rates all quotes started on." : "No board-rate changes vs the active version."}
        </div>
      )}
    </div>
  );
}

function ImportPricingModal({ onClose, onImported }) {
  const [file, setFile] = React.useState(null);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const submit = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const r = await adminPricingImport(file, { label: label || undefined });
      onImported(r);
    } catch (e) { setErr(e?.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  return (
    <ModalShell title="Import Board Price List" onClose={onClose} testid="import-pricing-modal">
      <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 10, lineHeight: 1.5 }}>
        Upload the supplier <code>.xlsx</code>. We read the <b>SINGLEWALL / DOUBLEWALL</b> grade × tier
        board rates only and land them as a <b>draft</b> for review. Liner/medium adders are not changed.
        Nothing goes live until you click Activate.
      </div>
      <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0])}
        data-testid="import-pricing-file" style={{ marginBottom: 10, fontSize: 12 }} />
      <input value={label} onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional — defaults to the sheet date)" data-testid="import-pricing-label"
        style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box",
          background: "var(--spot-bg2)", color: "var(--spot-text)",
          border: "1px solid var(--spot-border)", borderRadius: 3, marginBottom: 12 }} />
      {err && <div style={{ color: "var(--spot-err)", fontSize: 11, marginBottom: 10 }} data-testid="import-pricing-err">{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={btnStyle}>Cancel</button>
        <button onClick={submit} disabled={!file || busy} data-testid="import-pricing-submit"
          style={{ ...btnStyle, background: file ? "var(--spot-accent)" : "var(--spot-bg3)",
            color: file ? "#fff" : "var(--spot-text3)",
            borderColor: file ? "var(--spot-accent)" : "var(--spot-border)",
            cursor: file && !busy ? "pointer" : "not-allowed" }}>
          {busy ? "Parsing…" : "Import & Review"}</button>
      </div>
    </ModalShell>
  );
}


function ModalShell({ title, children, onClose, testid }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 11000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} data-testid={testid}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--spot-bg)", border: "1px solid var(--spot-border)",
        borderRadius: 8, padding: 20, minWidth: 420, maxWidth: 600,
        boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>{title}</div>
          <button onClick={onClose} style={{ all: "unset", cursor: "pointer", fontSize: 18, color: "var(--spot-text3)" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Integrations panel (Anthropic, UTS) ────────────────────────────────
function IntegrationsPanel() {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [toast, setToast] = React.useState("");

  const reload = React.useCallback(async () => {
    setLoading(true);
    try { setData(await adminGetIntegrations()); }
    catch (e) { setToast(`✗ ${e?.response?.data?.detail || e.message}`); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { reload(); }, [reload]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const onSave = async (key, val) => {
    try { await adminSetIntegration(key, val); await reload(); flash(`Saved ${key}`); }
    catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };
  const onReset = async (key) => {
    try { await adminResetIntegration(key); await reload(); flash(`Reset ${key} → .env fallback`); }
    catch (e) { flash(`✗ ${e?.response?.data?.detail || e.message}`); }
  };

  if (loading) return <div style={{ color: "var(--spot-text3)" }}>Loading integrations…</div>;
  if (!data) return null;

  return (
    <div data-testid="integrations-panel">
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)", marginBottom: 4 }}>
        Third-Party Integrations
      </div>
      <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 16 }}>
        Keys are stored encrypted in MongoDB and override the server <code>.env</code> values.
        Secrets are masked when displayed. Reset clears the override → falls back to <code>.env</code>.
      </div>

      {/* Provider status pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }} data-testid="integrations-providers">
        {data.providers.map((p) => (
          <div key={p.provider} style={{
            padding: "8px 14px", borderRadius: 6,
            background: p.configured ? `${p.color}11` : "var(--spot-bg3)",
            border: `1px solid ${p.configured ? `${p.color}55` : "var(--spot-border)"}`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%",
              background: p.configured ? p.color : "var(--spot-text3)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-text)" }}>{p.label}</span>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {p.configured ? "configured" : "missing"}
            </span>
          </div>
        ))}
      </div>

      {/* Per-key table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
          <th style={th}>Label</th>
          <th style={th}>Current value</th>
          <th style={{ ...th, textAlign: "center" }}>.env set</th>
          <th style={{ ...th, textAlign: "center" }}>Status</th>
          <th style={th}></th>
        </tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <IntegrationRow key={r.key} r={r} onSave={onSave} onReset={onReset} />
          ))}
        </tbody>
      </table>

      {toast && (
        <div data-testid="integ-toast" style={{
          position: "fixed", bottom: 20, right: 20,
          background: toast.startsWith("✗") ? "var(--spot-err)" : "var(--spot-green)",
          color: "#fff", padding: "8px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}>{toast}</div>
      )}
    </div>
  );
}

function IntegrationRow({ r, onSave, onReset }) {
  // For secret types, the displayed value is masked. The input shows blank until
  // user types — saving an empty string CLEARS the override (= reset). Saving a
  // value applies it. We don't pre-fill the masked value so admins can't
  // accidentally "Save" a masked string back as the real key.
  const [val, setVal] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { setVal(""); setEditing(false); }, [r.value]);

  const isSecret = r.type === "secret";
  const isOverride = r.is_override;

  return (
    <tr style={{ borderBottom: "1px solid var(--spot-line)" }} data-testid={`integ-row-${r.key}`}>
      <td style={{ ...td }}>
        <div style={{ fontWeight: 600, color: "var(--spot-text)" }}>{r.label}</div>
        <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>{r.hint}</div>
      </td>
      <td style={{ ...td }}>
        {editing || !isSecret ? (
          <input value={val} onChange={(e) => { setVal(e.target.value); setEditing(true); }}
            type={isSecret ? "password" : "text"}
            placeholder={isSecret ? r.value || "(empty)" : r.value || "(empty)"}
            data-testid={`integ-input-${r.key}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(r.key, val);
              if (e.key === "Escape") { setVal(""); setEditing(false); }
            }}
            style={{
              width: "100%", padding: "5px 8px", fontSize: 12,
              background: "var(--spot-bg2)", color: "var(--spot-text)",
              border: `1px solid ${editing ? "var(--spot-accent)" : "var(--spot-border)"}`,
              borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", outline: "none",
            }} />
        ) : (
          <span onClick={() => setEditing(true)}
            data-testid={`integ-masked-${r.key}`}
            style={{ cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12, color: r.value ? "var(--spot-text)" : "var(--spot-text3)",
              padding: "4px 6px", display: "inline-block",
              borderBottom: "1px dashed var(--spot-border)" }}
            title="Click to replace">
            {r.value || "(empty — click to set)"}
          </span>
        )}
      </td>
      <td style={{ ...td, textAlign: "center", fontSize: 10, color: "var(--spot-text3)" }}>
        {r.env_set ? "yes" : "no"}
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        {r.status === "set" ? (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
            background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e66" }}>SET</span>
        ) : (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
            background: "#ef444422", color: "#ef4444", border: "1px solid #ef444466" }}>MISSING</span>
        )}
      </td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        {(editing && val.length > 0) && (
          <button onClick={() => onSave(r.key, val)} data-testid={`integ-save-${r.key}`}
            style={{ ...btnSmall, background: "var(--spot-green)", color: "#fff", borderColor: "var(--spot-green)" }}>
            Save
          </button>
        )}
        {isOverride && !editing && (
          <button onClick={() => onReset(r.key)} data-testid={`integ-reset-${r.key}`}
            style={{ ...btnSmall, marginLeft: 4 }}>↶ Reset</button>
        )}
        {isOverride && (
          <div style={{ fontSize: 9, color: "var(--spot-warn)", marginTop: 2 }}>OVERRIDE</div>
        )}
      </td>
    </tr>
  );
}

// ─── Usage panel ────────────────────────────────────────────────────────
function UsagePanel() {
  const [data, setData] = React.useState(null);
  const [months, setMonths] = React.useState(6);
  const [customer, setCustomer] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = { months };
      if (customer.trim()) params.customer_code = customer.trim();
      setData(await adminGetUsage(params));
    } catch (e) { setData(null); }
    finally { setLoading(false); }
  }, [months, customer]);
  React.useEffect(() => { reload(); }, [reload]);

  const fmt$ = (n) => n == null ? "$0.00" : `$${Number(n).toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const fmtN = (n) => (n == null ? 0 : Number(n)).toLocaleString();
  const fmtTs = (t) => t ? t.replace("T", " ").slice(0, 19) : "—";

  if (loading) return <div style={{ color: "var(--spot-text3)" }}>Loading usage…</div>;
  if (!data) return <div style={{ color: "var(--spot-err)" }}>Usage data unavailable</div>;

  const t = data.totals || {};
  return (
    <div data-testid="usage-panel">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Parser Usage</span>
        <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
          Per-customer Anthropic spend · since {data.window?.since_yyyymm}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Window:</span>
          {[1, 3, 6, 12, 24].map((n) => (
            <button key={n} onClick={() => setMonths(n)} data-testid={`usage-window-${n}`}
              style={{ ...btnSmall, background: months === n ? "var(--spot-accent)" : "var(--spot-bg3)",
                color: months === n ? "#fff" : "var(--spot-text2)",
                borderColor: months === n ? "var(--spot-accent)" : "var(--spot-border)" }}>
              {n}mo
            </button>
          ))}
          <input value={customer} onChange={(e) => setCustomer(e.target.value)}
            placeholder="filter by cust code" data-testid="usage-customer-filter"
            style={{ fontSize: 11, padding: "4px 8px", background: "var(--spot-bg2)",
              color: "var(--spot-text2)", border: "1px solid var(--spot-border)",
              borderRadius: 3, width: 130 }} />
        </span>
      </div>

      {/* Grand totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}
        data-testid="usage-totals">
        {[
          ["Total parses", fmtN(t.calls), "var(--spot-accent)"],
          ["Anthropic cost", fmt$(t.cost_usd), "#a855f7"],
          ["Tokens in",  fmtN(t.tokens_in),  "var(--spot-text3)"],
          ["Tokens out", fmtN(t.tokens_out), "var(--spot-text3)"],
        ].map(([label, value, color]) => (
          <div key={label} style={{
            background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
            borderRadius: 6, padding: "10px 14px",
          }}>
            <div style={{ fontSize: 10, color: "var(--spot-text3)", textTransform: "uppercase",
              letterSpacing: ".06em", fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 20, color, fontWeight: 700, marginTop: 2,
              fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Side-by-side breakdowns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        <BreakdownCard title="By Month" rows={data.by_month}
          cols={[["Month", "yyyymm"], ["Parses", "calls"], ["Cost", "cost_usd", fmt$]]}
          dataTestId="usage-by-month" />
        <BreakdownCard title="By Customer (top 20)" rows={data.by_customer}
          cols={[["Code", "customer_code"], ["Name", "customer_name"],
                 ["Parses", "calls"], ["Cost", "cost_usd", fmt$]]}
          dataTestId="usage-by-customer" />
        <BreakdownCard title="By Estimator" rows={data.by_estimator}
          cols={[["Initials", "est_initials"], ["Parses", "calls"], ["Cost", "cost_usd", fmt$]]}
          dataTestId="usage-by-estimator" />
      </div>

      {/* Recent calls */}
      <div>
        <div style={{ fontSize: 11, color: "var(--spot-text3)", fontWeight: 700,
          textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
          Recent Calls (newest 50)
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }} data-testid="usage-recent">
          <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
            <th style={th}>Timestamp</th>
            <th style={th}>Est</th>
            <th style={th}>Customer</th>
            <th style={th}>Model</th>
            <th style={{ ...th, textAlign: "right" }}>Tok in</th>
            <th style={{ ...th, textAlign: "right" }}>Tok out</th>
            <th style={{ ...th, textAlign: "right" }}>Cost</th>
            <th style={{ ...th, textAlign: "center" }}>OK</th>
          </tr></thead>
          <tbody>
            {data.recent.length === 0 ? (
              <tr><td colSpan={8} style={{ ...td, color: "var(--spot-text3)" }}>No parses logged yet</td></tr>
            ) : data.recent.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{fmtTs(r.timestamp)}</td>
                <td style={{ ...td, fontWeight: 600 }}>{r.est_initials || "—"}</td>
                <td style={{ ...td }}>{r.customer_code ? `${r.customer_code} · ${r.customer_name || ""}` : "—"}</td>
                <td style={{ ...td, fontSize: 10, color: "var(--spot-text3)" }}>{r.model}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{fmtN(r.tokens_in)}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{fmtN(r.tokens_out)}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#a855f7", fontWeight: 600 }}>{fmt$(r.cost_usd)}</td>
                <td style={{ ...td, textAlign: "center" }}>{r.success
                  ? <span style={{ color: "var(--spot-green)" }}>✓</span>
                  : <span style={{ color: "var(--spot-err)" }} title={r.error || ""}>✗</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows, cols, dataTestId }) {
  return (
    <div data-testid={dataTestId} style={{
      background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
      borderRadius: 6, padding: "8px 10px",
    }}>
      <div style={{ fontSize: 11, color: "var(--spot-text3)", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>{title}</div>
      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead><tr style={{ color: "var(--spot-text3)" }}>
          {cols.map(([h], i) => (
            <th key={i} style={{ ...th, fontSize: 9,
              textAlign: typeof h === "string" && /Parses|Cost/.test(h) ? "right" : "left" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} style={{ ...td, color: "var(--spot-text3)" }}>—</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--spot-line)" }}>
              {cols.map(([h, k, fmt], j) => (
                <td key={j} style={{ ...td, padding: "3px 4px",
                  textAlign: /Parses|Cost/.test(h) ? "right" : "left",
                  fontFamily: /Parses|Cost|Tok/.test(h) ? "'JetBrains Mono', monospace" : "inherit" }}>
                  {fmt ? fmt(row[k]) : (row[k] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Calibration baseline (read-only) ───────────────────────────────────
function CalibrationPanel({ data }) {
  if (!data) return null;
  return (
    <div data-testid="admin-calibration">
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--spot-text)" }}>
        Fleet Calibration Baseline
      </div>
      <div style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
        borderRadius: 6, padding: 14, maxWidth: 520 }}>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            {[
              ["Calibration name", data.name],
              ["Date", data.date],
              ["Fleet size (jobs)", `${data.fleet_jobs} of ${data.fleet_jobs_total}`],
              ["Segment R² (cost)", data.segment_r2_cost],
              ["Segment R² (sell)", data.segment_r2_sell],
              ["Per-job R² (cost)", data.per_job_r2_cost],
              ["Per-job R² (sell)", data.per_job_r2_sell],
              ["Fleet cost Δ (%)", `${data.fleet_cost_delta_pct?.toFixed?.(2) || data.fleet_cost_delta_pct}`],
              ["Fleet sell premium (%)", `${data.fleet_sell_premium_pct?.toFixed?.(2) || data.fleet_sell_premium_pct}`],
              ["Margin lift ($)", `$${(data.margin_lift_usd || 0).toLocaleString()}`],
            ].map(([k, v]) => (
              <tr key={k} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                <td style={{ padding: "5px 6px", color: "var(--spot-text3)" }}>{k}</td>
                <td style={{ padding: "5px 6px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace",
                  color: "var(--spot-text)", fontWeight: 600 }}>{v ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--spot-text3)", lineHeight: 1.5 }}>
          The values above describe the production calibration run that the engine defaults
          (RATE_DEFAULTS, GM_DEFAULTS, etc.) are tuned against. Read-only — changing the
          baseline requires a code release + new fleet validation pass.
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const th = { textAlign: "left", padding: "6px 8px", fontSize: 10,
  textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 };
const td = { padding: "6px 8px", verticalAlign: "middle" };
const btnStyle = {
  all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
  padding: "6px 12px", borderRadius: 4,
  background: "var(--spot-bg3)", color: "var(--spot-text2)",
  border: "1px solid var(--spot-border)",
};
const btnSmall = { ...btnStyle, fontSize: 10, padding: "3px 8px" };
