/* eslint-disable */
import React, { useState } from "react";
import Modal from "./Modal";
import { useQuote } from "../../context/QuoteContext";

const SINGLEWALL_SHEETS = [
  { w: 24, l: 36 }, { w: 30, l: 40 }, { w: 30, l: 48 }, { w: 36, l: 48 },
  { w: 40, l: 48 }, { w: 40, l: 60 }, { w: 48, l: 60 }, { w: 48, l: 72 },
  { w: 48, l: 96 }, { w: 60, l: 96 }, { w: 60, l: 120 }, { w: 63, l: 96 },
  { w: 63, l: 120 }, { w: 72, l: 96 }, { w: 72, l: 120 }, { w: 84, l: 120 },
  { w: 96, l: 120 }, { w: 96, l: 144 },
];

/** Sheet override format used by the backend engine: "OVR-{w}x{l}". */
const fmtOverrideId = (w, l) => `OVR-${w}x${l}`;
const parseOverrideId = (id) => {
  if (!id || typeof id !== "string" || !id.startsWith("OVR-")) return null;
  const [w, l] = id.slice(4).split("x").map((n) => parseInt(n, 10));
  return Number.isFinite(w) && Number.isFinite(l) ? { w, l } : null;
};

export default function SheetLibraryModal({ onClose, currentSheet, overrideId }) {
  const { setField, pushToast } = useQuote();
  const [q, setQ] = useState("");

  const ov = parseOverrideId(overrideId);

  const matches = SINGLEWALL_SHEETS.filter(({ w, l }) => {
    if (!q.trim()) return true;
    const s = `${w}x${l} ${w}×${l}`;
    return s.toLowerCase().includes(q.toLowerCase());
  });

  const pickSheet = ({ w, l }) => {
    setField("overrideSheetId", fmtOverrideId(w, l));
    pushToast(`Sheet override set: ${w}×${l}`, "ok");
    onClose();
  };

  const clearOverride = () => {
    setField("overrideSheetId", null);
    pushToast("Sheet override cleared — back to auto-pick", "ok");
    onClose();
  };

  return (
    <Modal title="Sheet Library — SPC Approved Singlewall" onClose={onClose}
      width={720} data-testid="modal-sheet-library"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          {ov && (
            <button className="sp-btn" onClick={clearOverride} data-testid="sheet-library-clear"
              style={{ color: "var(--spot-err)", borderColor: "var(--spot-err)" }}>
              Clear Override
            </button>
          )}
          <button className="sp-btn" onClick={onClose} data-testid="sheet-library-close">Close</button>
        </div>
      }>
      <div style={{ marginBottom: 12 }}>
        <input className="sp-input" placeholder="Search by dimension (e.g. 48x96)…"
          value={q} onChange={(e) => setQ(e.target.value)}
          data-testid="sheet-library-search" />
      </div>
      <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 8,
        display: "flex", gap: 12, flexWrap: "wrap" }}>
        {ov && (
          <span data-testid="active-override">
            Override active:&nbsp;
            <span style={{ color: "var(--spot-purple)", fontWeight: 700 }}>{ov.w}×{ov.l}</span>
          </span>
        )}
        {currentSheet && (
          <span data-testid="current-sheet">
            Engine pick:&nbsp;
            <span style={{ color: "var(--spot-accent)", fontWeight: 700 }}>
              {currentSheet.w}×{currentSheet.l}
            </span>
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6,
        maxHeight: "55vh", overflowY: "auto" }} data-testid="sheet-library-grid">
        {matches.map(({ w, l }) => {
          const isAuto = currentSheet && currentSheet.w === w && currentSheet.l === l;
          const isOverride = ov && ov.w === w && ov.l === l;
          const accent = isOverride ? "var(--spot-purple)" : isAuto ? "var(--spot-green)" : null;
          const accentBg = isOverride ? "var(--spot-purple-bg)" : isAuto ? "var(--spot-green-soft)" : "var(--spot-bg3)";
          return (
            <button key={`${w}x${l}`} data-testid={`sheet-${w}x${l}`}
              onClick={() => pickSheet({ w, l })}
              style={{
                all: "unset", cursor: "pointer", padding: "10px 14px",
                background: accentBg,
                border: `1px solid ${accent || "var(--spot-border)"}`,
                borderRadius: 4, textAlign: "center",
              }}>
              <div style={{ fontSize: 14, fontWeight: 700,
                color: accent || "var(--spot-text)" }}>
                {w}″ × {l}″
              </div>
              {(isOverride || isAuto) && (
                <div style={{ fontSize: 9, color: accent, marginTop: 2,
                  textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
                  {isOverride ? "Override" : "Auto-pick"}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--spot-text3)",
        padding: "6px 10px", background: "var(--spot-bg3)",
        border: "1px solid var(--spot-border)", borderRadius: 4 }}>
        Engine picks the cost-winner sheet automatically (D-124). Override only when production has a
        constraint — e.g., available stock, die already cut to a specific sheet. Overrides pin the route to
        CAD and trigger Buy Min (D-067) if not a stock size.
      </div>
    </Modal>
  );
}
