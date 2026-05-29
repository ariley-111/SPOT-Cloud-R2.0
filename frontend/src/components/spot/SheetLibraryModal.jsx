/* eslint-disable */
import React, { useState } from "react";
import Modal from "./Modal";

const SINGLEWALL_SHEETS = [
  { w: 24, l: 36 }, { w: 30, l: 40 }, { w: 30, l: 48 }, { w: 36, l: 48 },
  { w: 40, l: 48 }, { w: 40, l: 60 }, { w: 48, l: 60 }, { w: 48, l: 72 },
  { w: 48, l: 96 }, { w: 60, l: 96 }, { w: 60, l: 120 }, { w: 63, l: 96 },
  { w: 63, l: 120 }, { w: 72, l: 96 }, { w: 72, l: 120 }, { w: 84, l: 120 },
  { w: 96, l: 120 }, { w: 96, l: 144 },
];

export default function SheetLibraryModal({ onClose, currentSheet, onPick }) {
  const [q, setQ] = useState("");

  const matches = SINGLEWALL_SHEETS.filter(({ w, l }) => {
    if (!q.trim()) return true;
    const s = `${w}x${l} ${w}×${l}`;
    return s.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <Modal title="Sheet Library — SPC Approved Singlewall" onClose={onClose}
      width={720} data-testid="modal-sheet-library"
      footer={<button className="sp-btn" onClick={onClose} data-testid="sheet-library-close">Close</button>}>
      <div style={{ marginBottom: 12 }}>
        <input className="sp-input" placeholder="Search by dimension (e.g. 48x96)…"
          value={q} onChange={(e) => setQ(e.target.value)}
          data-testid="sheet-library-search" />
      </div>
      {currentSheet && (
        <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 8 }} data-testid="current-sheet">
          Engine auto-pick: <span style={{ color: "var(--spot-accent)", fontWeight: 700 }}>
            {currentSheet.w}×{currentSheet.l}
          </span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6,
        maxHeight: "55vh", overflowY: "auto" }} data-testid="sheet-library-grid">
        {matches.map(({ w, l }) => {
          const isAuto = currentSheet && currentSheet.w === w && currentSheet.l === l;
          return (
            <button key={`${w}x${l}`} data-testid={`sheet-${w}x${l}`}
              onClick={() => { onPick && onPick({ w, l }); onClose(); }}
              style={{
                all: "unset", cursor: "pointer", padding: "10px 14px",
                background: isAuto ? "var(--spot-green-soft)" : "var(--spot-bg3)",
                border: `1px solid ${isAuto ? "var(--spot-green)" : "var(--spot-border)"}`,
                borderRadius: 4, textAlign: "center",
              }}>
              <div style={{ fontSize: 14, fontWeight: 700,
                color: isAuto ? "var(--spot-green)" : "var(--spot-text)" }}>
                {w}″ × {l}″
              </div>
              {isAuto && (
                <div style={{ fontSize: 9, color: "var(--spot-green)", marginTop: 2,
                  textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
                  Auto-pick
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
        constraint — e.g., available stock, die already cut to a specific sheet. Overrides trigger Buy Min
        (D-067) if not a stock size.
      </div>
    </Modal>
  );
}
