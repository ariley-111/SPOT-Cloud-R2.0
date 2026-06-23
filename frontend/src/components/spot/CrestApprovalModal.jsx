/* eslint-disable */
import React from "react";

/**
 * Crest Approval Required popup — legacy parity (spot_r1_5.jsx L7580-7593).
 * Fires when a component routes to Crest AND its die exceeds 1,000 rule-inches
 * per sheet (engine `routeWarning`). The estimator must either Acknowledge
 * (keep Crest, flag for management approval before ordering the die) or
 * Force CAD Instead (avoid the big die by routing to CAD).
 *
 * Shown once per component per quote-open (parent gates with `open`).
 */
export default function CrestApprovalModal({ open, message, componentName, onAcknowledge, onForceCad }) {
  if (!open) return null;
  return (
    <div data-testid="crest-approval-modal"
      style={{
        position: "fixed", inset: 0, zIndex: 4000,
        background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div style={{
        width: 460, maxWidth: "92vw", background: "var(--spot-bg2, #fff)",
        border: "1px solid var(--spot-line, #e5e7eb)", borderRadius: 12,
        boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", background: "#f59e0b14",
          borderBottom: "1px solid #f59e0b33",
        }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#b45309" }}>
            Crest Approval Required
          </div>
        </div>
        <div style={{ padding: "18px" }}>
          {componentName && (
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: ".06em", color: "var(--spot-text3, #9ca3af)", marginBottom: 6 }}>
              {componentName}
            </div>
          )}
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--spot-text, #111827)" }}
            data-testid="crest-approval-message">
            {message}
          </div>
          <div style={{ fontSize: 12, color: "var(--spot-text2, #6b7280)", marginTop: 10 }}>
            Get management approval before ordering this die, or switch to CAD to avoid the die entirely.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button data-testid="crest-approval-force-cad" onClick={onForceCad}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 700, border: "1px solid #22c55e55",
                color: "#16a34a", background: "#22c55e0a",
              }}>
              Force CAD Instead
            </button>
            <button data-testid="crest-approval-acknowledge" onClick={onAcknowledge}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 700, border: "none",
                color: "#fff", background: "#f59e0b",
              }}>
              Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
