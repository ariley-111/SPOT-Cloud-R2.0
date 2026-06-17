/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";

/** Fired ONCE per quote-open when an estimator makes a MATERIAL edit to a
 *  frozen quote (one pinned to an older board-pricing list). Two choices:
 *   • Keep frozen pricing → proceed with the edit, no further warnings.
 *   • Duplicate at current pricing → clone the quote AS LAST SAVED (discarding
 *     the in-progress dirty edit) and re-price it at the current list. */
export default function FrozenEditWarnModal() {
  const { frozenWarnTabId, active, dismissFrozenWarn, duplicateFrozenAtCurrent } = useQuote();
  const [busy, setBusy] = React.useState(false);
  if (!frozenWarnTabId) return null;
  const s = active?.state || {};
  const label = s.pricingVersionLabel;
  const est = s.estNum || "this quote";

  const onDuplicate = async () => {
    if (busy) return;
    setBusy(true);
    try { await duplicateFrozenAtCurrent(); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="frozen-edit-warn" onClick={dismissFrozenWarn}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1200,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--spot-bg2)", border: "1px solid #b8860b66",
                 borderRadius: 8, width: "min(480px, 96vw)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18, color: "#b8860b" }}>❄</span>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--spot-text)" }}>
            Editing a frozen quote
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", lineHeight: 1.6 }}>
          <b style={{ fontFamily: "'JetBrains Mono', monospace" }}>{est}</b> is preserved on an
          older board-pricing list{label ? <> (<b>{label}</b>)</> : ""}. Your changes will be
          priced using that <b>frozen</b> pricing — not the current rates.
          <br /><br />
          Want to re-price at the <b>current</b> board pricing instead? Duplicating creates a
          new quote from the <b>last saved</b> version (your in-progress change here will be
          discarded on the duplicate).
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="sp-btn" onClick={dismissFrozenWarn} disabled={busy}
            data-testid="frozen-keep-btn">
            Keep frozen pricing
          </button>
          <button className="sp-btn sp-btn-primary" onClick={onDuplicate} disabled={busy}
            data-testid="frozen-duplicate-btn"
            style={{ background: "#b8860b", borderColor: "#b8860b" }}>
            {busy ? "Duplicating…" : "Duplicate at current pricing"}
          </button>
        </div>
      </div>
    </div>
  );
}
