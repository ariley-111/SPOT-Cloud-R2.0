/* eslint-disable */
import React from "react";

/** Sec — collapsible section header bar matching legacy SPOT.
 *  Props: label (string|JSX), hue (color), open (bool), onToggle, badge, accent, warn */
export default function Sec({
  label, hue = "#94a3b8", open, onToggle, badge, accent, warn,
  children, "data-testid": dti,
}) {
  const headBg = open ? "var(--spot-bg2)" : "transparent";
  return (
    <div className="sp-sec" data-testid={dti} style={{
      borderTop: `1px solid var(--spot-line)`, borderBottom: open ? `1px solid var(--spot-line)` : "none",
      background: "transparent", marginBottom: 0,
    }}>
      <div onClick={onToggle} className="sp-sec-head"
        style={{
          background: headBg, borderLeft: `3px solid ${hue}`,
          borderBottom: open ? "1px solid var(--spot-border)" : "none",
          color: hue, padding: "7px 12px", cursor: "pointer",
          fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase",
          display: "flex", alignItems: "center", gap: 8, userSelect: "none",
          borderRadius: 0,
        }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          {label}
        </span>
        {badge && (
          <span className="sp-badge" style={{
            background: warn ? "var(--spot-warn-bg)" : accent ? "var(--spot-green-soft)" : "var(--spot-bg3)",
            color: warn ? "var(--spot-warn)" : accent ? "var(--spot-green)" : "var(--spot-text3)",
            borderColor: warn ? "var(--spot-warn)" : accent ? "var(--spot-green)" : "var(--spot-border)",
          }} data-testid={dti ? `${dti}-badge` : undefined}>{badge}</span>
        )}
        <span style={{ color: hue, fontSize: 14, opacity: 0.7 }}>{open ? "▾" : "▸"}</span>
      </div>
      <div style={{
        display: open ? "block" : "none",
        padding: "10px 14px", background: "var(--spot-bg2)",
      }}>{children}</div>
    </div>
  );
}

/** F — labeled field wrapper (mirrors legacy `<F l=... t=...>`). */
export function F({ l, children, inline, fw, "data-testid": dti }) {
  if (inline) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-testid={dti}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
          textTransform: "uppercase", letterSpacing: ".06em",
          width: fw || undefined, flexShrink: 0,
        }}>{l}</span>
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }} data-testid={dti}>
      <label style={{
        fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
        textTransform: "uppercase", letterSpacing: ".06em",
      }}>{l}</label>
      {children}
    </div>
  );
}
