/* eslint-disable */
/** BOM Builder modal — Pass 2 (R2.0)
 *
 *  Combines cloud layout with legacy functionality:
 *    - Project Name field at top
 *    - Display Style templates (built-in 10) + My Templates + Team Templates
 *    - Save Template / Update Template / Promote to Team
 *    - Per-row Lock icon + "Lock All" toggle
 *    - Drag-and-drop reorder + up/down arrows
 *    - Per-row dim info badge when the source BOM has dims populated
 *    - Default Qtys editor at footer
 */
import React, { useEffect, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import { DISPLAY_TEMPLATES } from "../../lib/displayTemplates";
import {
  listBomTemplates, createBomTemplate, updateBomTemplate,
  deleteBomTemplate, promoteBomTemplate,
} from "../../api/bomTemplates";

const SCOPES = { BUILTIN: "builtin", PERSONAL: "personal", TEAM: "team" };

export default function BomBuilderModal({ open, onClose, initialView = "templates" }) {
  const { active, convertToMultiPart, setField, pushToast } = useQuote();
  const [view, setView] = useState(initialView);
  const [tplSel, setTplSel] = useState(null); // {scope, id}
  const [defaultQtys, setDefaultQtys] = useState(["", "", "", "", ""]);
  const [projectName, setProjectName] = useState("");
  const [draft, setDraft] = useState([]);
  const [locks, setLocks] = useState({}); // {rowIndex: true}
  const [personalTpls, setPersonalTpls] = useState([]);
  const [teamTpls, setTeamTpls] = useState([]);
  const [saveName, setSaveName] = useState("");
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [editingTplId, setEditingTplId] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);

  const loadTemplates = async () => {
    try {
      const data = await listBomTemplates();
      setPersonalTpls(data.personal || []);
      setTeamTpls(data.team || []);
    } catch (e) {
      // Non-fatal — built-in templates still work
      pushToast(e?.response?.data?.detail || "Failed to load templates", "warn");
    }
  };

  useEffect(() => {
    if (!open) return;
    const s = active?.state || {};
    const items = s.bomItems || [];
    setProjectName(s.custRef || "");
    if (items.length > 0) {
      // Existing BOM → manual view, prefilled
      setDraft(items.map((it) => ({
        desc: it.desc, type: it.type || "Manufactured",
        pcs: it.pcsPerSet || 1, on: true,
        custIdent: it.custIdent || "",
        // Dim summary if the saved item state has dims
        dimInfo: dimSummary(it.state),
      })));
      setLocks({});
      setView("manual");
      setDefaultQtys(s.qtys || ["", "", "", "", ""]);
    } else {
      setDraft([]);
      setLocks({});
      setTplSel(null);
      setView(initialView);
    }
    setShowSavePanel(false);
    setSaveName("");
    setEditingTplId(null);
    loadTemplates();
  }, [open, initialView, active?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  /** Build "47.25×38 · 2 pcs/set" from a saved item.state. */
  function dimSummary(itState) {
    if (!itState) return null;
    const w = Number(itState.oneUpW || 0), l = Number(itState.oneUpL || 0);
    const pcs = Number(itState.pcsPerSet || 1);
    if (w > 0 && l > 0) return `${w}×${l}${pcs > 1 ? ` · ${pcs} pcs/set` : ""}`;
    return null;
  }

  const loadTemplate = (scope, id) => {
    let tpl;
    if (scope === SCOPES.BUILTIN) tpl = DISPLAY_TEMPLATES.find((t) => t.id === id);
    if (scope === SCOPES.PERSONAL) tpl = personalTpls.find((t) => t.id === id);
    if (scope === SCOPES.TEAM) tpl = teamTpls.find((t) => t.id === id);
    if (!tpl) return;
    setTplSel({ scope, id });
    if (Array.isArray(tpl.defaultQtys) && tpl.defaultQtys.some((q) => q !== "" && q != null)) {
      setDefaultQtys(tpl.defaultQtys);
    }
    setDraft(tpl.components.map((c) => ({
      desc: c.desc, type: c.type, pcs: c.pcs, on: c.on !== false, opt: !!c.opt, custIdent: "",
    })));
    setLocks({});
  };

  const setRow = (i, patch) => {
    if (locks[i]) return;
    setDraft((d) => d.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () =>
    setDraft((d) => [...d, { desc: `Item ${d.length + 1}`, type: "Manufactured", pcs: 1, on: true, custIdent: "" }]);
  const removeRow = (i) => {
    if (locks[i]) return;
    setDraft((d) => d.filter((_, idx) => idx !== i));
    setLocks((lk) => {
      const next = {};
      Object.keys(lk).forEach((k) => {
        const n = parseInt(k, 10);
        if (n < i) next[n] = lk[k];
        else if (n > i) next[n - 1] = lk[k];
      });
      return next;
    });
  };
  const moveRow = (from, to) => {
    if (to < 0 || to >= draft.length || from === to) return;
    if (locks[from]) return;
    setDraft((d) => {
      const next = [...d];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
    // Re-key locks to follow moved row
    setLocks((lk) => {
      const arr = draft.map((_, i) => !!lk[i]);
      const [mv] = arr.splice(from, 1);
      arr.splice(to, 0, mv);
      const next = {};
      arr.forEach((v, idx) => { if (v) next[idx] = true; });
      return next;
    });
  };
  const toggleLock = (i) => setLocks((lk) => ({ ...lk, [i]: !lk[i] }));
  const lockAll = () => {
    const all = {};
    draft.forEach((_, i) => { all[i] = true; });
    setLocks(all);
  };
  const unlockAll = () => setLocks({});

  const allLocked = draft.length > 0 && draft.every((_, i) => locks[i]);

  // Drag-and-drop
  const onDragStart = (i) => setDragIdx(i);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (i) => {
    if (dragIdx == null || dragIdx === i) return;
    moveRow(dragIdx, i);
    setDragIdx(null);
  };

  const activeRows = draft.filter((r) => r.on);
  const canSave = activeRows.length > 0;

  const onSaveBom = () => {
    if (!canSave) return;
    if (projectName !== (active?.state?.custRef || "")) setField("custRef", projectName);
    convertToMultiPart(
      activeRows.map((r) => ({
        desc: r.desc, type: r.type,
        pcsPerSet: parseInt(r.pcs, 10) || 1,
        custIdent: r.custIdent || "",
      })),
      { defaultQtys: defaultQtys.map((q) => String(q || "")) }
    );
    onClose();
  };

  // Template save / update / promote / delete
  const onSaveAsTemplate = async (scope) => {
    const name = saveName.trim();
    if (!name) return pushToast("Enter a template name", "warn");
    if (draft.length === 0) return pushToast("Add at least one component", "warn");
    try {
      const body = {
        name,
        scope,
        default_qtys: defaultQtys,
        components: draft.map((r) => ({
          desc: r.desc, type: r.type, pcs: parseInt(r.pcs, 10) || 1,
          on: !!r.on, opt: !!r.opt,
        })),
      };
      if (editingTplId) {
        await updateBomTemplate(editingTplId, body);
        pushToast(`Updated "${name}"`, "ok");
      } else {
        await createBomTemplate(body);
        pushToast(`Saved "${name}" to ${scope === "team" ? "Team" : "My"} Templates`, "ok");
      }
      setSaveName(""); setShowSavePanel(false); setEditingTplId(null);
      await loadTemplates();
    } catch (e) {
      pushToast(e?.response?.data?.detail || "Save failed", "err");
    }
  };

  const onEditTemplate = (tpl) => {
    setDraft(tpl.components.map((c) => ({
      desc: c.desc, type: c.type, pcs: c.pcs, on: c.on !== false, opt: !!c.opt, custIdent: "",
    })));
    if (Array.isArray(tpl.defaultQtys)) setDefaultQtys(tpl.defaultQtys);
    setEditingTplId(tpl.id);
    setSaveName(tpl.name);
    setShowSavePanel(true);
    setView("manual");
    setLocks({});
  };

  const onDeleteTemplate = async (tid, name) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      await deleteBomTemplate(tid);
      pushToast(`Deleted "${name}"`, "ok");
      await loadTemplates();
      if (editingTplId === tid) { setEditingTplId(null); setSaveName(""); setShowSavePanel(false); }
    } catch (e) {
      pushToast(e?.response?.data?.detail || "Delete failed", "err");
    }
  };

  const onPromote = async (tid, name) => {
    if (!window.confirm(`Promote "${name}" to Team Templates? Everyone in your org will be able to use it.`)) return;
    try {
      await promoteBomTemplate(tid);
      pushToast(`"${name}" is now a Team Template`, "ok");
      await loadTemplates();
    } catch (e) {
      pushToast(e?.response?.data?.detail || "Promote failed", "err");
    }
  };

  // ─── render ──────────────────────────────────────────────────────────
  return (
    <div onClick={onClose} data-testid="bom-builder-modal" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 11000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--spot-bg)", border: "1px solid var(--spot-border)",
        borderRadius: 8, width: 1040, maxWidth: "100%", maxHeight: "92vh",
        display: "flex", flexDirection: "column", boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
      }}>
        {/* ─── Header: BOM Builder · item count · Templates/Manual · × ──────── */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--spot-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)", flexShrink: 0 }}>BOM Builder</span>
            <span style={{ fontSize: 12, color: "var(--spot-text3)", fontWeight: 500 }}>
              {draft.length} item{draft.length !== 1 ? "s" : ""}
              {activeRows.length !== draft.length && ` (${activeRows.length} active)`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            <button onClick={() => setView("templates")} data-testid="bom-view-templates"
              style={tabBtn(view === "templates")}>Templates</button>
            <button onClick={() => setView("manual")} data-testid="bom-view-manual"
              style={tabBtn(view === "manual")}>Manual</button>
          </div>
          <button onClick={onClose} data-testid="bom-close"
            style={{ all: "unset", cursor: "pointer", fontSize: 22, color: "var(--spot-text3)", padding: "0 4px" }}>×</button>
        </div>

        {/* ─── Project Name (separate section, full width) ─── */}
        <div style={{ padding: "12px 18px 10px", borderBottom: "1px solid var(--spot-border)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
            textTransform: "uppercase", letterSpacing: ".08em" }}>Project Name</span>
          <input data-testid="bom-project-name" value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Overall project name..."
            style={{
              width: "100%", maxWidth: 520, background: "var(--spot-bg2)", color: "var(--spot-text)",
              border: "1px solid var(--spot-border)", borderRadius: 4,
              padding: "8px 12px", fontSize: 13, textAlign: "center",
            }} />
        </div>

        {/* ─── Templates view ─────────────────────────────────────── */}
        {view === "templates" && (
          <div style={{ padding: "10px 18px", borderBottom: draft.length > 0 ? "1px solid var(--spot-border)" : "none", flexShrink: 0 }}
            data-testid="bom-templates-grid">
            <TemplateSection label="Display Styles" hue="var(--spot-accent)"
              templates={DISPLAY_TEMPLATES.map((t) => ({ ...t, scope: SCOPES.BUILTIN }))}
              selected={tplSel} onPick={loadTemplate} testidPfx="bom-tpl" />
            <TemplateSection label={`My Templates${personalTpls.length ? ` (${personalTpls.length})` : ""}`}
              hue="#f59e0b" emptyMsg="Build a BOM and click Save Template to add your own."
              templates={personalTpls.map((t) => ({ ...t, scope: SCOPES.PERSONAL }))}
              selected={tplSel} onPick={loadTemplate} onEdit={onEditTemplate}
              onDelete={onDeleteTemplate} onPromote={onPromote} testidPfx="bom-tpl-personal" />
            <TemplateSection label={`Team Templates${teamTpls.length ? ` (${teamTpls.length})` : ""}`}
              hue="#a78bfa" emptyMsg="No team templates yet. Promote a personal template to share."
              templates={teamTpls.map((t) => ({ ...t, scope: SCOPES.TEAM }))}
              selected={tplSel} onPick={loadTemplate} onEdit={onEditTemplate}
              onDelete={onDeleteTemplate} testidPfx="bom-tpl-team" />
          </div>
        )}

        {/* ─── Draft list ─────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
          {draft.length === 0 && view === "manual" && (
            <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12,
              color: "var(--spot-text3)", fontStyle: "italic" }}>
              Add items below or pick a template — all components flagged "active" become tabs on Save BOM
            </div>
          )}
          {draft.length === 0 && view === "templates" && !tplSel && (
            <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12,
              color: "var(--spot-text3)", fontStyle: "italic" }}>
              Pick a display style above to get started
            </div>
          )}

          {draft.map((row, i) => {
            const badgeBg = row.type === "Manufactured" ? "#22c55e"
                          : row.type === "Fulfillment"  ? "#f59e0b" : "#3b82f6";
            const badgeLbl = row.type === "Manufactured" ? "MFG"
                           : row.type === "Fulfillment"  ? "FUL" : "PUR";
            const isLocked = !!locks[i];
            return (
              <div key={i} data-testid={`bom-draft-row-${i}`}
                draggable={!isLocked}
                onDragStart={() => onDragStart(i)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 4,
                  background: isLocked ? "var(--spot-bg3)" : "var(--spot-bg2)",
                  border: `1px solid ${isLocked ? "var(--spot-accent)" : "var(--spot-border)"}`,
                  borderRadius: 4, opacity: row.on ? 1 : 0.5,
                  cursor: isLocked ? "default" : "grab",
                }}>
                <span title="Drag to reorder" style={{
                  cursor: isLocked ? "default" : "grab", color: "var(--spot-text3)",
                  fontSize: 14, lineHeight: 1, userSelect: "none", flexShrink: 0,
                  opacity: isLocked ? 0.25 : 0.6,
                }}>⠿</span>
                <input type="checkbox" checked={row.on}
                  disabled={isLocked}
                  onChange={(e) => setRow(i, { on: e.target.checked })}
                  data-testid={`bom-draft-on-${i}`}
                  style={{ cursor: isLocked ? "not-allowed" : "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                  background: badgeBg, color: "#fff", letterSpacing: ".06em", flexShrink: 0 }}>{badgeLbl}</span>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <input value={row.desc}
                    disabled={isLocked}
                    onChange={(e) => setRow(i, { desc: e.target.value })}
                    data-testid={`bom-draft-desc-${i}`}
                    placeholder="Component description"
                    style={{ width: "100%", background: "transparent",
                      color: isLocked ? "var(--spot-text3)" : "var(--spot-text)",
                      border: "none", outline: "none", fontSize: 12, fontWeight: 600,
                      cursor: isLocked ? "not-allowed" : "text" }} />
                  {row.dimInfo && (
                    <span data-testid={`bom-draft-diminfo-${i}`} style={{
                      fontSize: 10, color: "var(--spot-text3)", fontWeight: 500,
                      fontFamily: "'JetBrains Mono', monospace", marginTop: 1,
                    }}>● {row.dimInfo}</span>
                  )}
                </div>
                <select value={row.type}
                  disabled={isLocked}
                  onChange={(e) => setRow(i, { type: e.target.value })}
                  data-testid={`bom-draft-type-${i}`}
                  style={{ background: isLocked ? "transparent" : "var(--spot-bg)",
                    color: "var(--spot-text2)",
                    border: "1px solid var(--spot-border)", borderRadius: 3, padding: "3px 6px",
                    fontSize: 11, cursor: isLocked ? "not-allowed" : "pointer" }}>
                  <option>Manufactured</option><option>Purchased</option><option>Fulfillment</option>
                </select>
                <span style={{ display: "flex", alignItems: "center", gap: 2,
                  background: isLocked ? "transparent" : "var(--spot-bg)", padding: "3px 6px", borderRadius: 3,
                  border: "1px solid var(--spot-border)" }}>
                  <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>×</span>
                  <input type="number" min="1" step="1" value={row.pcs}
                    disabled={isLocked}
                    onChange={(e) => setRow(i, { pcs: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    data-testid={`bom-draft-pcs-${i}`}
                    style={{ width: 32, background: "transparent", color: "var(--spot-text)",
                      border: "none", outline: "none", fontSize: 11, textAlign: "center",
                      fontFamily: "'JetBrains Mono', monospace", cursor: isLocked ? "not-allowed" : "text" }} />
                  <span style={{ fontSize: 9, color: "var(--spot-text3)" }}>/set</span>
                </span>
                {/* Lock toggle */}
                <button onClick={() => toggleLock(i)} data-testid={`bom-draft-lock-${i}`}
                  title={isLocked ? "Unlock row" : "Lock row"}
                  draggable={false} onMouseDown={(e) => e.stopPropagation()}
                  style={{ all: "unset", cursor: "pointer", fontSize: 13,
                    color: isLocked ? "var(--spot-accent)" : "var(--spot-text3)",
                    padding: "0 4px" }}>{isLocked ? "🔒" : "🔓"}</button>
                <span style={{ display: "flex", gap: 1 }}>
                  <button onClick={() => moveRow(i, i - 1)} disabled={i === 0 || isLocked}
                    data-testid={`bom-draft-up-${i}`}
                    draggable={false} onMouseDown={(e) => e.stopPropagation()}
                    style={{ all: "unset", cursor: i === 0 || isLocked ? "default" : "pointer",
                      fontSize: 12, color: "var(--spot-text3)",
                      opacity: i === 0 || isLocked ? 0.3 : 1, padding: "0 3px" }}>▲</button>
                  <button onClick={() => moveRow(i, i + 1)} disabled={i === draft.length - 1 || isLocked}
                    data-testid={`bom-draft-down-${i}`}
                    draggable={false} onMouseDown={(e) => e.stopPropagation()}
                    style={{ all: "unset", cursor: i === draft.length - 1 || isLocked ? "default" : "pointer",
                      fontSize: 12, color: "var(--spot-text3)",
                      opacity: i === draft.length - 1 || isLocked ? 0.3 : 1, padding: "0 3px" }}>▼</button>
                </span>
                <button onClick={() => removeRow(i)} disabled={isLocked}
                  data-testid={`bom-draft-rm-${i}`}
                  draggable={false} onMouseDown={(e) => e.stopPropagation()}
                  style={{ all: "unset", cursor: isLocked ? "not-allowed" : "pointer", fontSize: 14,
                    color: "var(--spot-err)", padding: "0 3px", opacity: isLocked ? 0.3 : 1 }}>×</button>
              </div>
            );
          })}

          <button onClick={addRow} data-testid="bom-draft-add"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
              padding: "6px 12px", marginTop: 6, borderRadius: 3,
              background: "var(--spot-bg3)", color: "var(--spot-text2)",
              border: "1px dashed var(--spot-border)" }}>+ Add component</button>
        </div>

        {/* ─── Save template inline panel ─────────────────────────── */}
        {showSavePanel && (
          <div data-testid="bom-save-panel" style={{
            padding: "10px 18px", borderTop: "1px solid var(--spot-border)",
            background: "#f59e0b0c", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
              textTransform: "uppercase", letterSpacing: ".06em" }}>
              {editingTplId ? "Update Template" : "Save Template"}
            </span>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)}
              data-testid="bom-save-name"
              placeholder="Template name..."
              onKeyDown={(e) => { if (e.key === "Enter") onSaveAsTemplate("personal"); }}
              autoFocus
              style={{
                flex: 1, maxWidth: 280, background: "var(--spot-bg)", color: "var(--spot-text)",
                border: "1px solid var(--spot-border)", borderRadius: 3, padding: "4px 8px", fontSize: 12,
              }} />
            <button onClick={() => onSaveAsTemplate("personal")} data-testid="bom-save-personal"
              disabled={!saveName.trim()}
              style={ftBtn("#f59e0b", saveName.trim())}>
              {editingTplId ? "Update (Personal)" : "Save (Personal)"}
            </button>
            <button onClick={() => onSaveAsTemplate("team")} data-testid="bom-save-team"
              disabled={!saveName.trim()}
              style={ftBtn("#a78bfa", saveName.trim())}>
              {editingTplId ? "Update (Team)" : "Save (Team)"}
            </button>
            <button onClick={() => { setShowSavePanel(false); setSaveName(""); setEditingTplId(null); }}
              data-testid="bom-save-cancel"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "var(--spot-text3)",
                padding: "4px 8px" }}>Cancel</button>
          </div>
        )}

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--spot-border)",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          background: "var(--spot-bg2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "var(--spot-text3)", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".06em" }}>Default Qtys</span>
          {defaultQtys.map((q, i) => (
            <input key={i} value={q} type="number" min="0"
              onChange={(e) => setDefaultQtys((arr) => arr.map((v, idx) => idx === i ? e.target.value : v))}
              data-testid={`bom-default-qty-${i}`}
              placeholder="—"
              style={{ width: 70, padding: "4px 6px", textAlign: "right", fontSize: 11,
                background: "var(--spot-bg)", color: "var(--spot-text)",
                border: "1px solid var(--spot-border)", borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace" }} />
          ))}
          <span style={{ flex: 1 }} />
          {/* Lock All */}
          {draft.length > 0 && (
            <button onClick={allLocked ? unlockAll : lockAll} data-testid="bom-lock-all"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                padding: "5px 12px", borderRadius: 3,
                background: allLocked ? "var(--spot-accent-soft)" : "var(--spot-bg)",
                color: allLocked ? "var(--spot-accent)" : "var(--spot-text2)",
                border: `1px solid ${allLocked ? "var(--spot-accent)" : "var(--spot-border)"}` }}>
              {allLocked ? "🔒 All Locked" : "🔓 Lock All"}
            </button>
          )}
          {/* Save Template */}
          {draft.length > 0 && (
            <button onClick={() => setShowSavePanel((v) => !v)} data-testid="bom-save-template-toggle"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                padding: "5px 12px", borderRadius: 3,
                background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b" }}>
              Save Template
            </button>
          )}
          <button onClick={onSaveBom} disabled={!canSave} data-testid="bom-save"
            style={{ all: "unset", cursor: canSave ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 700, padding: "6px 18px", borderRadius: 4,
              background: canSave ? "var(--spot-accent)" : "var(--spot-bg3)",
              color: canSave ? "#fff" : "var(--spot-text3)",
              border: `1px solid ${canSave ? "var(--spot-accent)" : "var(--spot-border)"}` }}>
            Save BOM ({activeRows.length} {activeRows.length === 1 ? "item" : "items"})
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TemplateSection({ label, hue, templates, selected, onPick, onEdit, onDelete, onPromote, emptyMsg, testidPfx }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: hue, marginBottom: 4,
        textTransform: "uppercase", letterSpacing: ".06em",
      }}>{label}</div>
      {templates.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--spot-text3)", fontStyle: "italic", padding: "4px 0" }}>
          {emptyMsg}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
          {templates.map((tpl) => {
            const sel = selected && selected.scope === tpl.scope && selected.id === tpl.id;
            const compCount = tpl.components.filter((c) => c.on !== false).length;
            return (
              <div key={`${tpl.scope}-${tpl.id}`} style={{ position: "relative" }}>
                <button onClick={() => onPick(tpl.scope, tpl.id)}
                  data-testid={`${testidPfx}-${tpl.id}`}
                  style={{
                    all: "unset", cursor: "pointer", padding: "8px 10px", borderRadius: 6,
                    background: sel ? hue : "var(--spot-bg2)",
                    border: `1px solid ${sel ? hue : "var(--spot-border)"}`,
                    textAlign: "left", display: "block", width: "100%", boxSizing: "border-box",
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 700,
                    color: sel ? "#fff" : "var(--spot-text)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    paddingRight: onDelete ? 18 : 0,
                  }}>{tpl.name}</div>
                  <div style={{ fontSize: 10, color: sel ? "rgba(255,255,255,0.85)" : "var(--spot-text3)", marginTop: 2 }}>
                    {compCount} default · {tpl.components.length} total
                  </div>
                </button>
                {/* Action mini-bar (edit/delete/promote) — only for personal/team */}
                {(onDelete || onPromote || onEdit) && (
                  <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2 }}>
                    {onEdit && (
                      <button onClick={(e) => { e.stopPropagation(); onEdit(tpl); }}
                        data-testid={`${testidPfx}-edit-${tpl.id}`}
                        title="Edit template"
                        style={miniBtn(sel)}>✎</button>
                    )}
                    {onPromote && tpl.scope === SCOPES.PERSONAL && (
                      <button onClick={(e) => { e.stopPropagation(); onPromote(tpl.id, tpl.name); }}
                        data-testid={`${testidPfx}-promote-${tpl.id}`}
                        title="Promote to Team Templates"
                        style={miniBtn(sel)}>↗</button>
                    )}
                    {onDelete && (
                      <button onClick={(e) => { e.stopPropagation(); onDelete(tpl.id, tpl.name); }}
                        data-testid={`${testidPfx}-delete-${tpl.id}`}
                        title="Delete template"
                        style={miniBtn(sel, "var(--spot-err)")}>×</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const tabBtn = (active) => ({
  all: "unset", cursor: "pointer", fontSize: 11, fontWeight: active ? 700 : 500,
  padding: "3px 10px", borderRadius: 3,
  background: active ? "var(--spot-accent)22" : "transparent",
  color: active ? "var(--spot-accent)" : "var(--spot-text3)",
  border: `1px solid ${active ? "var(--spot-accent)55" : "var(--spot-border)"}`,
});

const ftBtn = (hue, on) => ({
  all: "unset", cursor: on ? "pointer" : "not-allowed",
  fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 3,
  background: on ? hue : "var(--spot-bg3)",
  color: on ? "#fff" : "var(--spot-text3)",
  border: `1px solid ${on ? hue : "var(--spot-border)"}`,
  opacity: on ? 1 : 0.6,
});

const miniBtn = (sel, color) => ({
  all: "unset", cursor: "pointer", fontSize: 11, lineHeight: 1,
  width: 16, height: 16, borderRadius: 3, textAlign: "center",
  background: sel ? "rgba(255,255,255,0.25)" : "var(--spot-bg)",
  color: color || (sel ? "#fff" : "var(--spot-text2)"),
  border: `1px solid ${sel ? "rgba(255,255,255,0.45)" : "var(--spot-border)"}`,
});
