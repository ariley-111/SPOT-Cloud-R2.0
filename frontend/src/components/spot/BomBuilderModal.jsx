/* eslint-disable */
/** BOM Builder modal — MP-7
 *  Ported from legacy spot_r1_5.jsx (BOM Builder modal, ~L5400-5800).
 *
 *  Two views:
 *    Templates — visual cards of the 10 DISPLAY_TEMPLATES; click loads the draft
 *    Manual   — empty list; estimator adds rows one by one
 *
 *  The draft is editable inline (toggle on/off, change type, pcs-per-set, desc).
 *  "Save BOM" commits the draft to the QuoteContext via convertToMultiPart(),
 *  which seeds each item with the current intake's common fields and creates
 *  the per-component tabs we already built in MP-1.
 */
import React, { useEffect, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import { DISPLAY_TEMPLATES } from "../../lib/displayTemplates";

export default function BomBuilderModal({ open, onClose, initialView = "templates" }) {
  const { active, convertToMultiPart } = useQuote();
  const [view, setView] = useState(initialView);
  const [tplId, setTplId] = useState(null);
  const [defaultQtys, setDefaultQtys] = useState(["", "", "", "", ""]);
  // Working draft — array of {desc, type, pcs, on, opt?, custIdent?}
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (open) {
      // Pre-load draft from current bomItems if user clicked Edit; else empty
      const s = active?.state || {};
      const items = s.bomItems || [];
      if (items.length > 0) {
        setDraft(items.map((i) => ({
          desc: i.desc, type: i.type || "Manufactured",
          pcs: i.pcsPerSet || 1, on: true, custIdent: i.custIdent || "",
        })));
        setView("manual");
        setDefaultQtys(s.qtys || ["", "", "", "", ""]);
      } else {
        setDraft([]);
        setTplId(null);
        setView(initialView);
      }
    }
  }, [open, initialView, active?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const loadTemplate = (tid) => {
    const tpl = DISPLAY_TEMPLATES.find((t) => t.id === tid);
    if (!tpl) return;
    setTplId(tid);
    setDefaultQtys(tpl.defaultQtys);
    setDraft(tpl.components.map((c) => ({
      desc: c.desc, type: c.type, pcs: c.pcs, on: c.on, opt: !!c.opt, custIdent: "",
    })));
  };

  const setRow = (i, patch) =>
    setDraft((d) => d.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () =>
    setDraft((d) => [...d, { desc: `Item ${d.length + 1}`, type: "Manufactured", pcs: 1, on: true, custIdent: "" }]);
  const removeRow = (i) =>
    setDraft((d) => d.filter((_, idx) => idx !== i));
  const moveRow = (from, to) =>
    setDraft((d) => {
      if (to < 0 || to >= d.length) return d;
      const next = [...d];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });

  const activeRows = draft.filter((r) => r.on);
  const canSave = activeRows.length > 0;

  const onSave = () => {
    if (!canSave) return;
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

  return (
    <div onClick={onClose} data-testid="bom-builder-modal" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 11000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--spot-bg)", border: "1px solid var(--spot-border)",
        borderRadius: 8, width: 900, maxWidth: "100%", maxHeight: "90vh",
        display: "flex", flexDirection: "column", boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--spot-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)" }}>BOM Builder</span>
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {draft.length} item{draft.length !== 1 ? "s" : ""}
              {activeRows.length !== draft.length && ` (${activeRows.length} active)`}
            </span>
            <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
              <button onClick={() => setView("templates")} data-testid="bom-view-templates"
                style={tabBtn(view === "templates")}>Templates</button>
              <button onClick={() => setView("manual")} data-testid="bom-view-manual"
                style={tabBtn(view === "manual")}>Manual</button>
            </div>
          </div>
          <button onClick={onClose} data-testid="bom-close"
            style={{ all: "unset", cursor: "pointer", fontSize: 22, color: "var(--spot-text3)" }}>×</button>
        </div>

        {/* Templates view */}
        {view === "templates" && (
          <div style={{ padding: "12px 18px", borderBottom: draft.length > 0 ? "1px solid var(--spot-border)" : "none", flexShrink: 0 }}
            data-testid="bom-templates-grid">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
              {DISPLAY_TEMPLATES.map((tpl) => {
                const sel = tpl.id === tplId;
                return (
                  <button key={tpl.id} onClick={() => loadTemplate(tpl.id)}
                    data-testid={`bom-tpl-${tpl.id}`}
                    style={{
                      all: "unset", cursor: "pointer", padding: "10px 12px", borderRadius: 6,
                      background: sel ? "var(--spot-accent)" : "var(--spot-bg2)",
                      border: `1px solid ${sel ? "var(--spot-accent)" : "var(--spot-border)"}`,
                      textAlign: "left",
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700,
                      color: sel ? "#fff" : "var(--spot-text)" }}>{tpl.name}</div>
                    <div style={{ fontSize: 10,
                      color: sel ? "rgba(255,255,255,0.85)" : "var(--spot-text3)", marginTop: 2 }}>
                      {tpl.components.filter((c) => c.on).length} default · {tpl.components.length} total
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Draft list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
          {draft.length === 0 && view === "manual" && (
            <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12,
              color: "var(--spot-text3)", fontStyle: "italic" }}>
              Add items below or pick a template — all components flagged "active" become tabs on Save BOM
            </div>
          )}
          {draft.length === 0 && view === "templates" && !tplId && (
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
            return (
              <div key={i} data-testid={`bom-draft-row-${i}`} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 4,
                background: "var(--spot-bg2)", border: "1px solid var(--spot-border)", borderRadius: 4,
                opacity: row.on ? 1 : 0.5,
              }}>
                <input type="checkbox" checked={row.on} onChange={(e) => setRow(i, { on: e.target.checked })}
                  data-testid={`bom-draft-on-${i}`}
                  style={{ cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                  background: badgeBg, color: "#fff", letterSpacing: ".06em", flexShrink: 0 }}>{badgeLbl}</span>
                <input value={row.desc} onChange={(e) => setRow(i, { desc: e.target.value })}
                  data-testid={`bom-draft-desc-${i}`}
                  placeholder="Component description"
                  style={{ flex: 1, background: "transparent", color: "var(--spot-text)",
                    border: "none", outline: "none", fontSize: 12, fontWeight: 600 }} />
                <input value={row.custIdent} onChange={(e) => setRow(i, { custIdent: e.target.value })}
                  data-testid={`bom-draft-custident-${i}`}
                  placeholder="Cust ID"
                  style={{ width: 90, background: "var(--spot-bg)", color: "var(--spot-text3)",
                    border: "1px solid var(--spot-border)", borderRadius: 3, padding: "3px 6px",
                    fontSize: 11 }} />
                <select value={row.type} onChange={(e) => setRow(i, { type: e.target.value })}
                  data-testid={`bom-draft-type-${i}`}
                  style={{ background: "var(--spot-bg)", color: "var(--spot-text2)",
                    border: "1px solid var(--spot-border)", borderRadius: 3, padding: "3px 6px",
                    fontSize: 11 }}>
                  <option>Manufactured</option><option>Purchased</option><option>Fulfillment</option>
                </select>
                <span style={{ display: "flex", alignItems: "center", gap: 2,
                  background: "var(--spot-bg)", padding: "3px 6px", borderRadius: 3,
                  border: "1px solid var(--spot-border)" }}>
                  <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>×</span>
                  <input type="number" min="1" step="1" value={row.pcs}
                    onChange={(e) => setRow(i, { pcs: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    data-testid={`bom-draft-pcs-${i}`}
                    style={{ width: 32, background: "transparent", color: "var(--spot-text)",
                      border: "none", outline: "none", fontSize: 11, textAlign: "center",
                      fontFamily: "'JetBrains Mono', monospace" }} />
                  <span style={{ fontSize: 9, color: "var(--spot-text3)" }}>/set</span>
                </span>
                {row.opt && (
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2,
                    background: "var(--spot-bg3)", color: "var(--spot-text3)", letterSpacing: ".04em" }}>OPTIONAL</span>
                )}
                <span style={{ display: "flex", gap: 1 }}>
                  <button onClick={() => moveRow(i, i - 1)} disabled={i === 0}
                    data-testid={`bom-draft-up-${i}`}
                    style={{ all: "unset", cursor: i === 0 ? "default" : "pointer",
                      fontSize: 12, color: "var(--spot-text3)", opacity: i === 0 ? 0.3 : 1,
                      padding: "0 3px" }}>▲</button>
                  <button onClick={() => moveRow(i, i + 1)} disabled={i === draft.length - 1}
                    data-testid={`bom-draft-down-${i}`}
                    style={{ all: "unset", cursor: i === draft.length - 1 ? "default" : "pointer",
                      fontSize: 12, color: "var(--spot-text3)",
                      opacity: i === draft.length - 1 ? 0.3 : 1, padding: "0 3px" }}>▼</button>
                </span>
                <button onClick={() => removeRow(i)} data-testid={`bom-draft-rm-${i}`}
                  style={{ all: "unset", cursor: "pointer", fontSize: 14,
                    color: "var(--spot-err)", padding: "0 3px" }}>×</button>
              </div>
            );
          })}

          <button onClick={addRow} data-testid="bom-draft-add"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
              padding: "6px 12px", marginTop: 6, borderRadius: 3,
              background: "var(--spot-bg3)", color: "var(--spot-text2)",
              border: "1px dashed var(--spot-border)" }}>+ Add component</button>
        </div>

        {/* Footer — default qtys + save */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--spot-border)",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          background: "var(--spot-bg2)" }}>
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
          <button onClick={onSave} disabled={!canSave} data-testid="bom-save"
            style={{ all: "unset", cursor: canSave ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 700, padding: "6px 18px", borderRadius: 4,
              background: canSave ? "var(--spot-accent)" : "var(--spot-bg3)",
              color: canSave ? "#fff" : "var(--spot-text3)",
              border: `1px solid ${canSave ? "var(--spot-accent)" : "var(--spot-border)"}`,
              marginLeft: "auto" }}>
            Save BOM ({activeRows.length} {activeRows.length === 1 ? "item" : "items"})
          </button>
        </div>
      </div>
    </div>
  );
}

const tabBtn = (active) => ({
  all: "unset", cursor: "pointer", fontSize: 11, fontWeight: active ? 700 : 500,
  padding: "3px 10px", borderRadius: 3,
  background: active ? "var(--spot-accent)" + "22" : "transparent",
  color: active ? "var(--spot-accent)" : "var(--spot-text3)",
  border: `1px solid ${active ? "var(--spot-accent)" + "55" : "var(--spot-border)"}`,
});
