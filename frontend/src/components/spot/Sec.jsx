/* eslint-disable */
import React from "react";

export default function Sec({ title, hue, children, defaultOpen = true, "data-testid": dti, right }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="sp-sec" data-testid={dti}>
      <div className="sp-sec-head has-hue"
        style={{ "--hue": hue || "var(--spot-accent)" }}
        onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {right}
          <span style={{ color: "var(--spot-text3)", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
        </span>
      </div>
      {open && <div className="sp-sec-body">{children}</div>}
    </div>
  );
}

export function OptGroup({ value, onChange, options, "data-testid": dti, color = "blue" }) {
  return (
    <div data-testid={dti} style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const lbl = typeof o === "string" ? o : (o.label || o.value);
        const active = v === value;
        const cls = `sp-opt ${active ? (color === "green" ? "is-active-green" : color === "purple" ? "is-active-purple" : "is-active") : ""}`;
        return (
          <button key={v} className={cls}
            data-testid={`${dti}-${v}`}
            onClick={() => onChange(v)} type="button">
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children, hint, "data-testid": dti }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }} data-testid={dti}>
      <label className="sp-label">{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: "var(--spot-text3)" }}>{hint}</div>}
    </div>
  );
}
