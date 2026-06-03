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
} from "../api/spot";

const TAB_LABELS = {
  rate:        "Rates",
  gm_tier:     "GM Curve",
  sell_tier:   "Sell Curve",
  grade_adder: "Grade Adders",
  audit:       "Audit Log",
  calibration: "Calibration",
};
const TAB_ORDER = ["rate", "gm_tier", "sell_tier", "grade_adder", "audit", "calibration"];

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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: "1px solid var(--spot-border)", color: "var(--spot-text3)" }}>
              <th style={th}>Key</th>
              <th style={{ ...th, textAlign: "right" }}>Current value</th>
              <th style={{ ...th, textAlign: "right" }}>Baseline</th>
              <th style={{ ...th, textAlign: "center", width: 100 }}>Status</th>
              <th style={{ ...th, width: 110 }}></th>
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
            color: isOverride ? "var(--spot-warn)" : "var(--spot-text)", textAlign: "right", width: 100,
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
