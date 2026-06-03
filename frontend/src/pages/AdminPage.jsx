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
} from "../api/spot";

const TAB_LABELS = {
  rate:         "Rates",
  gm_tier:      "GM Curve",
  sell_tier:    "Sell Curve",
  grade_adder:  "Grade Adders",
  integrations: "Integrations",
  usage:        "Usage",
  audit:        "Audit Log",
  calibration:  "Calibration",
};
const TAB_ORDER = ["rate", "gm_tier", "sell_tier", "grade_adder", "integrations", "usage", "audit", "calibration"];

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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [filter, setFilter] = useState({ category: "", key: "" });
  const PAGE = 100;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE, skip };
      if (filter.category) params.category = filter.category;
      if (filter.key) params.key = filter.key;
      const r = await adminGetAudit(params);
      setRows(r.rows || []);
    } catch (e) { setRows([]); } finally { setLoading(false); }
  }, [skip, filter]);
  useEffect(() => { load(); }, [load]);

  const fmtTs = (t) => t ? t.replace("T", " ").slice(0, 19) : "—";

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>Audit Log</span>
        <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Append-only · retained forever</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--spot-text3)" }}>
          Filter:
        </span>
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
