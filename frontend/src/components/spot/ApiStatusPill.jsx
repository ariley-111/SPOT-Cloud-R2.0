/* eslint-disable */
import React, { useEffect, useState } from "react";
import { onApiStatus } from "../../api/client";

/** Tiny live status pill that lights up while UTS / Anthropic / PDF API calls are in flight.
 *  Mirrors legacy SPOT's status badge in the top bar. */
export default function ApiStatusPill() {
  const [active, setActive] = useState([]);   // [{id, label, t0, kind}]
  const [lastErr, setLastErr] = useState(null);

  useEffect(() => {
    let seq = 0;
    return onApiStatus((ev) => {
      if (ev.kind === "start") {
        const id = ++seq;
        setActive((cur) => [...cur, { id, label: ev.label, t0: Date.now() }]);
      } else if (ev.kind === "end") {
        setActive((cur) => {
          const idx = cur.findIndex((x) => x.label === ev.label);
          if (idx < 0) return cur;
          const next = [...cur]; next.splice(idx, 1); return next;
        });
      } else if (ev.kind === "err") {
        setActive((cur) => cur.filter((x) => x.label !== ev.label));
        setLastErr({ label: ev.label, t: Date.now() });
        setTimeout(() => setLastErr(null), 4000);
      }
    });
  }, []);

  const inFlight = active.length > 0;
  if (!inFlight && !lastErr) return null;

  const label = inFlight ? active[active.length - 1].label : `${lastErr.label} failed`;
  const color = lastErr ? "var(--spot-err)" : "var(--spot-accent)";

  return (
    <div data-testid="api-status-pill" style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 8px", fontSize: 11, fontWeight: 600,
      background: `${color}22`, color, border: `1px solid ${color}55`,
      borderRadius: 999, marginLeft: 6,
    }}>
      {inFlight && (
        <span data-testid="api-status-spinner" style={{
          width: 8, height: 8, borderRadius: 4,
          border: `1.5px solid ${color}`, borderTopColor: "transparent",
          display: "inline-block", animation: "sp-spin 0.8s linear infinite",
        }} />
      )}
      <span data-testid="api-status-label">{label}{inFlight && active.length > 1 ? ` · +${active.length - 1}` : ""}</span>
      <style>{`@keyframes sp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
