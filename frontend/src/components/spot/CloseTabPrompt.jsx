import React from "react";
import { useQuote } from "../../context/QuoteContext";

/* Save / Discard / Cancel prompt shown when a user closes a tab that has
 * unsaved estimate content. Empty tabs close silently (handled in context). */
export default function CloseTabPrompt() {
  const { closePromptId, tabs, cancelClose, discardCloseTab, saveAndCloseTab } = useQuote();
  const [saving, setSaving] = React.useState(false);
  if (!closePromptId) return null;

  const tab = (tabs || []).find((t) => t.id === closePromptId);
  const name = tab?.state?.estNum || tab?.state?.custName || tab?.label || "this quote";

  const doSave = async () => {
    setSaving(true);
    try { await saveAndCloseTab(closePromptId); } finally { setSaving(false); }
  };

  return (
    <div data-testid="close-tab-prompt" onClick={cancelClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 420, background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
        borderRadius: 8, padding: 20, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--spot-text)", marginBottom: 6 }}>
          Close tab — save your work?
        </div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", marginBottom: 18, lineHeight: 1.5 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text)" }}>{name}</span> has
          unsaved changes. Save it as a quote, discard it, or keep editing?
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button data-testid="close-tab-cancel" onClick={cancelClose} disabled={saving}
            style={btn("ghost")}>Cancel</button>
          <button data-testid="close-tab-discard" onClick={() => discardCloseTab(closePromptId)} disabled={saving}
            style={btn("danger")}>Discard</button>
          <button data-testid="close-tab-save" onClick={doSave} disabled={saving}
            style={btn("primary")}>{saving ? "Saving…" : "Save & Close"}</button>
        </div>
      </div>
    </div>
  );
}

const btn = (kind) => {
  const base = { padding: "7px 14px", fontSize: 13, fontWeight: 600, borderRadius: 5, cursor: "pointer", border: "1px solid var(--spot-line)" };
  if (kind === "primary") return { ...base, background: "var(--spot-green)", color: "#04210f", border: "1px solid var(--spot-green)" };
  if (kind === "danger") return { ...base, background: "transparent", color: "#ef4444", border: "1px solid #ef444466" };
  return { ...base, background: "transparent", color: "var(--spot-text2)" };
};
