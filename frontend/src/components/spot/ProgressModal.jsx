/* eslint-disable */
import React, { useEffect, useState } from "react";

/**
 * Generic in-flight progress modal. Shows a centered, non-dismissible spinner with
 * a label + sub-label + animated dots. Used during long-running calls:
 *   - RFQ Parser (Anthropic Opus, ~5-15 sec)
 *   - UTS Freight quote (~3-8 sec)
 *
 * Caller controls visibility via `open` prop; closing is automatic when the parent
 * sets open=false. Not user-dismissible (esc/backdrop) so estimators can't accidentally
 * abandon a call that's already cost money.
 */
export default function ProgressModal({ open, title, subtitle, accent = "#06b6d4" }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    if (!open) { setDots(""); return; }
    const id = setInterval(() => setDots((d) => d.length >= 3 ? "" : d + "."), 350);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;
  return (
    <div data-testid="progress-modal-backdrop"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div data-testid="progress-modal"
        style={{ background: "var(--spot-bg2)", borderRadius: 10, padding: "32px 48px",
          border: `1px solid ${accent}55`, minWidth: 380, maxWidth: "85vw",
          color: "var(--spot-text)", textAlign: "center",
          boxShadow: `0 12px 36px ${accent}33, 0 0 0 1px ${accent}22 inset` }}>
        {/* Spinner */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            border: `4px solid ${accent}22`, borderTopColor: accent,
            animation: "spot-spin 0.7s linear infinite",
          }} />
        </div>
        <div data-testid="progress-modal-title" style={{
          fontSize: 18, fontWeight: 700, marginBottom: 8, color: accent,
        }}>
          {title}<span style={{ display: "inline-block", width: 24, textAlign: "left" }}>{dots}</span>
        </div>
        {subtitle && (
          <div data-testid="progress-modal-subtitle" style={{
            fontSize: 12, color: "var(--spot-text3)", lineHeight: 1.5, marginTop: 6,
            maxWidth: 320, marginLeft: "auto", marginRight: "auto",
          }}>{subtitle}</div>
        )}
        <style>{`@keyframes spot-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
