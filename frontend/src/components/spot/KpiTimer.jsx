/* eslint-disable */
import React, { useEffect, useState } from "react";

const KPI_SEC = 6 * 60; // 6 minutes

export default function KpiTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  const over = elapsed > KPI_SEC;
  const pct = Math.min(1, elapsed / KPI_SEC);
  const tint = over ? "var(--spot-err)" : pct > 0.66 ? "var(--spot-warn)" : "var(--spot-green)";

  const toggle = () => setRunning((r) => !r);
  const reset = () => { setElapsed(0); setRunning(false); };

  return (
    <div data-testid="kpi-timer" style={{
      display: "flex", alignItems: "center", gap: 6, padding: "3px 8px",
      background: "var(--spot-bg3)", border: "1px solid var(--spot-border)", borderRadius: 4,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: tint,
    }} title="6-min KPI timer">
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint, opacity: running ? 1 : 0.4 }} />
      <span data-testid="kpi-timer-display">{m}:{s}</span>
      <span style={{ color: "var(--spot-text3)" }}>/ 6:00</span>
      <button onClick={toggle} className="sp-btn" data-testid="kpi-timer-toggle"
        style={{ padding: "1px 5px", fontSize: 10 }}>
        {running ? "⏸" : "▶"}
      </button>
      <button onClick={reset} className="sp-btn" data-testid="kpi-timer-reset"
        style={{ padding: "1px 5px", fontSize: 10 }}>↺</button>
    </div>
  );
}
