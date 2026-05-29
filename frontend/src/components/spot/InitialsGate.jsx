/* eslint-disable */
import React, { useState, useEffect } from "react";
import { useQuote } from "../../context/QuoteContext";

/** First-launch popup asking estimator for their initials. */
export default function InitialsGate() {
  const { initialsGateOpen, commitInitials } = useQuote();
  const [v, setV] = useState("");

  useEffect(() => { if (initialsGateOpen) setV(""); }, [initialsGateOpen]);

  if (!initialsGateOpen) return null;

  const submit = () => commitInitials(v);

  return (
    <div data-testid="initials-gate" style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
        borderRadius: 8, padding: 20, width: 360,
        boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--spot-text)", marginBottom: 4 }}>
          Enter Your Initials
        </div>
        <div style={{ fontSize: 12, color: "var(--spot-text3)", marginBottom: 12 }}>
          Required before creating or modifying estimates. Used to stamp every quote # you generate.
        </div>
        <input className="sp-input" value={v}
          data-testid="initials-gate-input"
          onChange={(e) => setV(e.target.value.toUpperCase().slice(0, 4))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus maxLength={4} placeholder="—"
          style={{ width: "100%", padding: 10, fontSize: 16, textAlign: "center",
            fontWeight: 700, letterSpacing: ".1em" }} />
        <button onClick={submit} disabled={v.length < 2}
          data-testid="initials-gate-submit"
          style={{
            width: "100%", marginTop: 12, padding: "10px 0", fontSize: 13,
            fontWeight: 700, borderRadius: 4,
            background: v.length >= 2 ? "var(--spot-accent)" : "var(--spot-bg3)",
            color: v.length >= 2 ? "#fff" : "var(--spot-text3)",
            border: `1px solid ${v.length >= 2 ? "var(--spot-accent)" : "var(--spot-border)"}`,
            cursor: v.length >= 2 ? "pointer" : "not-allowed", all: "unset",
            display: "block", textAlign: "center", boxSizing: "border-box",
          }}>Save</button>
        <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 8, textAlign: "center" }}>
          2-4 letters · "SPC" is reserved for system estimates
        </div>
      </div>
    </div>
  );
}
