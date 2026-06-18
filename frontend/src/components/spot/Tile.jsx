/* eslint-disable */
import React from "react";

/** Tile — segmented option button matching legacy `<Tile>`.
 *  Props: label, active, onClick, tint (color), small, glow, disabled */
export default function Tile({ label, active, onClick, tint, small, glow, disabled, "data-testid": dti, title }) {
  const c = tint || "#3b82f6";
  const bg = active ? `${c}22` : "var(--spot-bg3)";
  const fg = active ? c : "var(--spot-text3)";
  const bd = active ? c : "var(--spot-border)";
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      data-testid={dti}
      style={{
        all: "unset", cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? 11 : 12, fontWeight: active ? 700 : 600,
        padding: small ? "3px 8px" : "5px 10px",
        borderRadius: 3,
        background: bg, color: fg, border: `1px solid ${bd}`,
        textAlign: "center", lineHeight: 1.2, whiteSpace: "nowrap",
        boxShadow: glow ? `0 0 0 1px ${c}55, 0 0 6px ${c}44` : "none",
        opacity: disabled ? 0.4 : 1,
        transition: "all 120ms ease", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 3,
      }}>
      {label}
    </button>
  );
}

/** Num — numeric input with consistent styling. */
export function Num({ value, onChange, step = "0.01", min, max, style, "data-testid": dti, placeholder, onKeyDown, inputRef, title }) {
  return (
    <input ref={inputRef} type="number" step={step} min={min} max={max}
      data-testid={dti} placeholder={placeholder} title={title}
      value={value ?? ""} onKeyDown={onKeyDown}
      onChange={(e) => {
        let v = e.target.value;
        // strip leading zeros for numeric clarity
        if (v && v.length > 1 && v[0] === "0" && v[1] !== ".") v = v.replace(/^0+/, "") || "0";
        onChange(v);
      }}
      className="sp-input"
      style={{ width: 90, padding: "5px 8px", fontSize: 12, ...style }} />
  );
}
