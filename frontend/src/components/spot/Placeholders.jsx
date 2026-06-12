/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { F } from "./Sec";
import Tile, { Num } from "./Tile";

/** ─── Pricing Strategy ──────────────────────────────────────────────
 *  Ported from legacy spot_r1_5.jsx lines 6291-6415.
 *  Contains: Pricing Mode (Multi-Part) · Tier Targets (GM% / $/MSF) ·
 *            Force Sell/Pc · Fulfillment/Purchased GM (when applicable) */
export function PricingStrategySec() {
  const { active, sec, toggleSec, setField, setManyFields, setPricingMode } = useQuote();
  const s = active?.state || {};
  const isMP = s.quoteType === "Multi-Part";
  const isMatchedSet = isMP && s.pricingMode === "Matched Set";

  // D-110 default GM tier curve + Sell tier curve — must match backend
  //   engine/core.py:GM_DEFAULTS / SELL_DEFAULTS (9 tiers).
  const defaultGmByTier = {
    "0-1":   0.50, "1-3":   0.37, "3-5":   0.32, "5-9":   0.27,
    "10-24": 0.25, "25-49": 0.25, "50-74": 0.25, "75-99": 0.25, "100+": 0.25,
  };
  const defaultSellByTier = {
    "0-1": 600, "1-3": 500, "3-5": 450, "5-9": 400,
    "10-24": 375, "25-49": 325, "50-74": 300, "75-99": 285, "100+": 260,
  };
  const tierKeys = Object.keys(defaultGmByTier);
  const gmByTier   = s.gmByTier   || defaultGmByTier;
  const sellByTier = s.sellByTier || defaultSellByTier;
  const setGm   = (t, p) => setField("gmByTier",   { ...gmByTier,   [t]: p });
  const setSell = (t, v) => setField("sellByTier", { ...sellByTier, [t]: v });
  const resetTiers = () =>
    setManyFields({ gmByTier: { ...defaultGmByTier }, sellByTier: { ...defaultSellByTier } });

  return (
    <Sec label="Pricing Strategy" hue="#8b5cf6" open={sec.pricing} onToggle={() => toggleSec("pricing")}
      data-testid="sec-pricing-strategy">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>

        {/* Pricing Mode (Multi-Part only) */}
        {isMP && (
          <div style={{ background: "#f59e0b0c", border: "1px solid #f59e0b22",
            borderRadius: 5, padding: "6px 8px", flex: "0 0 100%" }}
            data-testid="pricing-mode-panel">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>Pricing Mode</div>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="Individual"  active={s.pricingMode === "Individual"}  onClick={() => setPricingMode("Individual")}  small tint="#f59e0b" />
              <Tile label="Matched Set" active={s.pricingMode === "Matched Set"} onClick={() => setPricingMode("Matched Set")} small tint="#f59e0b" />
            </div>
            {isMatchedSet && (
              <div style={{ marginTop: 4, display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => setField("setMarginOverride", !s.setMarginOverride)}
                  data-testid="btn-override-gm"
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 12, fontWeight: s.setMarginOverride ? 700 : 600,
                    padding: "3px 10px", borderRadius: 4,
                    background: s.setMarginOverride ? "#f59e0b22" : "transparent",
                    color: s.setMarginOverride ? "#f59e0b" : "var(--spot-text3)",
                    border: `1px solid ${s.setMarginOverride ? "#f59e0b55" : "var(--spot-border)"}`,
                  }}>{s.setMarginOverride ? "✓ Override GM%" : "Override GM%"}</button>
                {s.setMarginOverride && (
                  <>
                    <Num value={Math.round((parseFloat(s.setMarginPct || 0)) * 1000) / 10}
                      onChange={(v) => setField("setMarginPct", String((parseFloat(v) || 0) / 100))}
                      step="0.1" min="0" max="99"
                      style={{ width: 55, padding: "5px 8px", textAlign: "center" }}
                      data-testid="input-set-margin-pct" />
                    <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>% uniform across all items</span>
                  </>
                )}
                {!s.setMarginOverride && (
                  <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Each item uses its own GM tier curve</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── TIER TARGETS — both GM% AND Sell$/MSF columns (legacy parity) ── */}
        <div style={{ background: "#3b82f60c", border: "1px solid #3b82f622",
          borderRadius: 5, padding: "6px 8px", flex: 1, minWidth: 280 }}
          data-testid="tier-targets-panel">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6",
                textTransform: "uppercase", letterSpacing: ".06em" }}>Tier Targets</span>
              <div style={{ display: "flex", gap: 2 }}>
                <Tile label="GM %"  active={s.pricingBasis === "Gross Margin %"} onClick={() => setField("pricingBasis", "Gross Margin %")} small tint="#a855f7" data-testid="tile-basis-gm" />
                <Tile label="$/MSF" active={s.pricingBasis === "Sell $/MSF"}     onClick={() => setField("pricingBasis", "Sell $/MSF")}     small tint="#a855f7" data-testid="tile-basis-msf" />
              </div>
            </div>
            <button onClick={resetTiers} data-testid="btn-reset-tiers"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-err)" }}>
              Reset Margins to My Defaults
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "3px 8px",
            fontSize: 11, alignItems: "center" }} data-testid="tier-grid">
            <span style={{ fontWeight: 700, color: "var(--spot-text3)" }}>TIER</span>
            <span style={{ fontWeight: 700, color: "var(--spot-text3)", textAlign: "right" }}>GM %</span>
            <span style={{ fontWeight: 700, color: "var(--spot-text3)", textAlign: "right" }}>SELL $/MSF</span>
            {tierKeys.map((tier) => {
              const pct = gmByTier[tier] ?? defaultGmByTier[tier];
              const sellMsf = sellByTier[tier] ?? defaultSellByTier[tier];
              const isGmPrimary  = s.pricingBasis !== "Sell $/MSF";
              return (
                <React.Fragment key={tier}>
                  <span style={{ color: "var(--spot-text2)" }}>{tier} MSF</span>
                  <input className="sp-input" type="number" step="0.1" min="0" max="99.9"
                    value={Math.round(pct * 1000) / 10}
                    onChange={(e) => setGm(tier, (parseFloat(e.target.value) || 0) / 100)}
                    data-testid={`input-tier-gm-${tier}`}
                    style={{ padding: "4px 6px", fontSize: 12, textAlign: "right",
                      opacity: isGmPrimary ? 1 : 0.6,
                      fontWeight: isGmPrimary ? 600 : 400 }} />
                  <input className="sp-input" type="number" step="1" min="0"
                    value={sellMsf}
                    onChange={(e) => setSell(tier, parseFloat(e.target.value) || 0)}
                    data-testid={`input-tier-sell-${tier}`}
                    style={{ padding: "4px 6px", fontSize: 12, textAlign: "right",
                      opacity: !isGmPrimary ? 1 : 0.6,
                      fontWeight: !isGmPrimary ? 600 : 400 }} />
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ─── FORCE SELL/PC ─────────────────────────────────────────── */}
        <ForceSellPanel s={s} setField={setField} />

        {/* ─── FREIGHT $/QTY (per-qty override) ─────────────────────── */}
        <FreightByQtyPanel s={s} setField={setField} />

        {/* Fulfillment/Purchased GM (Multi-Part with those item types) */}
        {isMP && (s.bomItems || []).some((i) => i.type === "Fulfillment") && (
          <div style={{ background: "#f59e0b0c", border: "1px solid #f59e0b22",
            borderRadius: 5, padding: "6px 8px" }} data-testid="fulfillment-gm-panel">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>Fulfillment</div>
            <Num value={Math.round((parseFloat(s.fulfillmentMarginPct || 0)) * 1000) / 10}
              onChange={(v) => setField("fulfillmentMarginPct", String((parseFloat(v) || 0) / 100))}
              step="0.1" min="0" max="99" style={{ width: 55, padding: "5px 8px", textAlign: "center" }}
              data-testid="input-fulfillment-pct" />
            <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 4 }}>%</span>
          </div>
        )}
        {isMP && (s.bomItems || []).some((i) => i.type === "Purchased") && (
          <div style={{ background: "#3b82f60c", border: "1px solid #3b82f622",
            borderRadius: 5, padding: "6px 8px" }} data-testid="purchased-gm-panel">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>Purchased</div>
            <Num value={Math.round((parseFloat(s.purchasedMarginPct || 0)) * 1000) / 10}
              onChange={(v) => setField("purchasedMarginPct", String((parseFloat(v) || 0) / 100))}
              step="0.1" min="0" max="99" style={{ width: 55, padding: "5px 8px", textAlign: "center" }}
              data-testid="input-purchased-pct" />
            <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 4 }}>%</span>
          </div>
        )}

        {/* MP-4: Job-Level Cost Allocation (Multi-Part only) */}
        {isMP && (
          <JobLevelAllocPanel s={s} setField={setField} />
        )}
      </div>
    </Sec>
  );
}

function JobLevelAllocPanel({ s, setField }) {
  const items = s.bomItems || [];
  const fScope = s.freightScope || "None";
  const pScope = s.prepressScope || "Per Item";
  const allocMethod = s.freightAllocMethod || "By MSF";
  return (
    <div style={{
      background: "#06b6d40c", border: "1px solid #06b6d422",
      borderRadius: 5, padding: "6px 8px", flex: "1 0 100%",
    }} data-testid="job-level-alloc-panel">
      <div style={{ fontSize: 11, fontWeight: 700, color: "#06b6d4",
        textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
        Job-Level Cost Allocation
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr",
        gap: "4px 10px", alignItems: "center", fontSize: 11 }}>

        <span style={{ color: "var(--spot-text3)" }}>Freight scope</span>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Tile label="Per Item" active={fScope === "None"} onClick={() => setField("freightScope", "None")}
            small tint="#94a3b8" data-testid="tile-freight-scope-item" />
          <Tile label="Per Job"  active={fScope === "Per Job"} onClick={() => setField("freightScope", "Per Job")}
            small tint="#06b6d4" data-testid="tile-freight-scope-job" />
          {/* Treatment (Line / Amort) — legacy parity, target depends on scope */}
          <span style={{ width: 6 }} />
          {fScope === "Per Job" ? (
            <>
              <Tile label="Line" active={(s.jobFreightTreatment || "Separate Line") === "Separate Line"}
                onClick={() => setField("jobFreightTreatment", "Separate Line")}
                small tint="#22c55e" data-testid="tile-jobfreight-line" />
              <Tile label="Amort" active={s.jobFreightTreatment === "Amortize"}
                onClick={() => setField("jobFreightTreatment", "Amortize")}
                small data-testid="tile-jobfreight-amort" />
            </>
          ) : (
            <>
              <Tile label="Line" active={(s.freightTreatment || "Separate Line") === "Separate Line"}
                onClick={() => setField("freightTreatment", "Separate Line")}
                small tint="#22c55e" data-testid="tile-itemfreight-line" />
              <Tile label="Amort" active={s.freightTreatment === "Amortize"}
                onClick={() => setField("freightTreatment", "Amortize")}
                small data-testid="tile-itemfreight-amort" />
            </>
          )}
        </div>
        <span style={{ color: "var(--spot-text3)" }}>Job freight $</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Num value={s.jobFreightCost || 0}
            onChange={(v) => setField("jobFreightCost", String(v))}
            step="0.01" min="0" disabled={fScope !== "Per Job"}
            style={{ width: 80, padding: "4px 6px", textAlign: "right",
              opacity: fScope === "Per Job" ? 1 : 0.5 }}
            data-testid="input-job-freight-cost" />
          {fScope === "Per Job" && (
            <select value={allocMethod} onChange={(e) => setField("freightAllocMethod", e.target.value)}
              data-testid="select-freight-alloc-method"
              style={{ background: "var(--spot-bg2)", color: "var(--spot-text2)",
                border: "1px solid var(--spot-border)", borderRadius: 3,
                fontSize: 10, padding: "2px 4px" }}>
              <option>By MSF</option>
              <option>Equal</option>
              <option>By Weight</option>
            </select>
          )}
        </div>

        <span style={{ color: "var(--spot-text3)" }}>Prepress scope</span>
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Tile label="None" active={pScope === "None"} onClick={() => setField("prepressScope", "None")}
            small tint="#94a3b8" data-testid="tile-prepress-scope-none" />
          <Tile label="Per Item" active={pScope === "Per Item"} onClick={() => setField("prepressScope", "Per Item")}
            small tint="#22c55e" data-testid="tile-prepress-scope-item" />
          <Tile label="Lot Charge" active={pScope === "Per Job"} onClick={() => {
            setField("prepressScope", "Per Job");
            if ((s.jobPrepressTreatment || "None") === "None") setField("jobPrepressTreatment", "Separate Line");
          }} small tint="#06b6d4" data-testid="tile-prepress-scope-lot" />
          <span style={{ width: 6 }} />
          {pScope === "Per Job" ? (
            <>
              <Tile label="Line" active={(s.jobPrepressTreatment || "Separate Line") === "Separate Line"}
                onClick={() => setField("jobPrepressTreatment", "Separate Line")}
                small tint="#22c55e" data-testid="tile-jobprepress-line" />
              <Tile label="Amort" active={s.jobPrepressTreatment === "Amortize"}
                onClick={() => setField("jobPrepressTreatment", "Amortize")}
                small data-testid="tile-jobprepress-amort" />
            </>
          ) : pScope === "Per Item" ? (
            <>
              <Tile label="Line" active={(s.prepressTreatment || "Separate Line") === "Separate Line"}
                onClick={() => setField("prepressTreatment", "Separate Line")}
                small tint="#22c55e" data-testid="tile-itemprepress-line" />
              <Tile label="Amort" active={s.prepressTreatment === "Amortize"}
                onClick={() => setField("prepressTreatment", "Amortize")}
                small data-testid="tile-itemprepress-amort" />
            </>
          ) : null}
        </div>
        <span style={{ color: "var(--spot-text3)" }}>Job prepress $</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Num value={s.jobPrepressCost || 0}
            onChange={(v) => setField("jobPrepressCost", String(v))}
            step="0.01" min="0" disabled={pScope !== "Per Job"}
            style={{ width: 80, padding: "4px 6px", textAlign: "right",
              opacity: pScope === "Per Job" ? 1 : 0.5 }}
            data-testid="input-job-prepress-cost" />
          {pScope === "Per Job" && (
            <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>split Equal · MFG items only</span>
          )}
        </div>
      </div>
      {(fScope === "Per Job" || pScope === "Per Job") && items.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--spot-text3)" }}>
          {fScope === "Per Job" && <span>Freight ${parseFloat(s.jobFreightCost || 0).toFixed(2)} split <b>{allocMethod}</b> across {items.length} components · </span>}
          {pScope === "Per Job" && <span>Prepress ${parseFloat(s.jobPrepressCost || 0).toFixed(2)} split <b>Equal</b> across MFG components (FUL items get $0)</span>}
        </div>
      )}
    </div>
  );
}

function ForceSellPanel({ s, setField }) {
  const validQtys = (s.qtys || []).filter((q) => Number(q) > 0);
  if (validQtys.length === 0) return null;
  const forced = s.forcedSellPc || {};
  const setForced = (idx, v) => setField("forcedSellPc", { ...forced, [idx]: v });
  const clearAll = () => setField("forcedSellPc", {});

  return (
    <div style={{ background: "#f59e0b0c", border: "1px solid #f59e0b22",
      borderRadius: 5, padding: "6px 8px", flex: 1, minWidth: 220 }}
      data-testid="force-sell-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b",
          textTransform: "uppercase", letterSpacing: ".06em" }}>Force Sell/Pc</span>
        {Object.values(forced).some((v) => Number(v) > 0) && (
          <button onClick={clearAll} data-testid="btn-clear-forced-sell"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-err)" }}>Clear All</button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 4 }}>
        {validQtys.map((q, i) => {
          const hasVal = Number(forced[i]) > 0;
          return (
            <div key={i}>
              <label style={{ fontSize: 11, fontWeight: 600,
                color: hasVal ? "#a855f7" : "var(--spot-text3)" }}>{Number(q).toLocaleString()}</label>
              <input className="sp-input" type="number" step="0.01" min="0" placeholder="—"
                value={forced[i] || ""}
                onChange={(e) => setForced(i, e.target.value)}
                data-testid={`input-forced-sell-${i}`}
                style={{ padding: "4px 6px", fontSize: 12, textAlign: "center",
                  borderColor: hasVal ? "#a855f7" : undefined }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ─── Freight $/Qty ─────────────────────────────────────────────────
 *  Per-qty freight cost override. The engine reads `freightByQty[slot]` and
 *  uses it as the freight $ for that quantity tier (replacing the engine-
 *  computed base freight). Engine ref: /app/backend/engine/runner.py:68.
 *  Legacy parity: side-by-side with Force Sell/Pc, with Clear All link. */
function FreightByQtyPanel({ s, setField }) {
  const validQtys = (s.qtys || []).filter((q) => Number(q) > 0);
  if (validQtys.length === 0) return null;
  const fbq = s.freightByQty || {};
  const setFbq = (idx, v) => setField("freightByQty", { ...fbq, [idx]: v });
  const clearAll = () => setField("freightByQty", {});

  return (
    <div style={{ background: "#ef44440c", border: "1px solid #ef444422",
      borderRadius: 5, padding: "6px 8px", flex: 1, minWidth: 220 }}
      data-testid="freight-by-qty-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444",
          textTransform: "uppercase", letterSpacing: ".06em" }}>Freight $/Qty</span>
        {Object.values(fbq).some((v) => Number(v) > 0) && (
          <button onClick={clearAll} data-testid="btn-clear-freight-by-qty"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-err)" }}>Clear All</button>
        )}
      </div>
      <div style={{ fontSize: 10, color: "var(--spot-text3)", marginBottom: 4 }}>
        Override base freight per qty. Leaves engine freight in place if blank.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 4 }}>
        {validQtys.map((q, i) => {
          const hasVal = Number(fbq[i]) > 0;
          return (
            <div key={i}>
              <label style={{ fontSize: 11, fontWeight: 600,
                color: hasVal ? "#ef4444" : "var(--spot-text3)" }}>{Number(q).toLocaleString()}</label>
              <input className="sp-input" type="number" step="0.01" min="0" placeholder="—"
                value={fbq[i] ?? ""}
                onChange={(e) => setFbq(i, e.target.value)}
                data-testid={`input-freight-by-qty-${i}`}
                style={{ padding: "4px 6px", fontSize: 12, textAlign: "center",
                  borderColor: hasVal ? "#ef4444" : undefined }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ─── Advanced Controls — REMOVED 2026-06-03 ────────────────────────
 *  All editable rates / GM curve / sell curve / grade adders now live in
 *  the Pricing Admin Console (admin-only pop-out, see /pages/AdminPage.jsx).
 *  Integration credentials (Anthropic, UTS) live in Admin → Integrations tab.
 *  Per-quote usage tracking lives in Admin → Usage tab. */

function RatePanel({ title, color, rows, dataTestId }) {
  return (
    <div style={{ background: `${color}0c`, border: `1px solid ${color}22`, borderRadius: 5, padding: "8px 10px" }}
      data-testid={dataTestId}>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase",
        letterSpacing: ".06em", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "3px 14px",
        fontSize: 12, lineHeight: 1.4 }}>
        {rows.map(([k, v], i) => (
          <React.Fragment key={i}>
            <span style={{ color: "var(--spot-text3)", fontWeight: 600 }}>{k}</span>
            <span style={{ color: "var(--spot-text)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** ─── Board Engine ──────────────────────────────────────────────────
 *  1:1 cloud port of legacy spot_r1_5.jsx L6606-6758. Fetches the live
 *  engine manifest from /api/engine/manifest so the panel reflects the
 *  ACTUAL pricing data the backend uses — not a hardcoded summary.
 *
 *  Renders:
 *    • MSF Tiers pills
 *    • Singlewall Base Rates table (Grade × all 6 tiers)
 *    • Doublewall Base Rates table (Grade × all 6 tiers)  ← includes 275 DW etc.
 *    • Liner Upgrades + Medium Upgrades two-column
 *    • Flute Rules + Dim Adders + Fixed Charges three-column
 *    • Approved Sheets summary chips (spec → count) */
export function BoardEngineSec() {
  const { sec, toggleSec } = useQuote();
  const [manifest, setManifest] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    import("../../api/spot").then(({ engineManifest }) =>
      engineManifest().then(setManifest).catch((e) => setErr(e?.message || String(e)))
    );
  }, []);

  // Number formatter matching legacy `fn`
  const fn2 = (n, mx = 2, mn = 2) =>
    Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: mx, minimumFractionDigits: mn });

  const HEAD = { padding: "4px 6px", fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
    borderBottom: "1px solid var(--spot-border)" };
  const SUBHEAD = { fontSize: 11, fontWeight: 700, color: "var(--spot-text3)",
    textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 };
  const PILL = { fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
    background: "var(--spot-bg2)", color: "var(--spot-text2)", border: "1px solid var(--spot-border)" };
  const CHIP = { fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 3,
    background: "var(--spot-bg2)", color: "var(--spot-text2)", border: "1px solid var(--spot-border)" };
  const LIST_ROW = { display: "flex", justifyContent: "space-between", padding: "2px 0",
    fontSize: 11, borderBottom: "1px solid var(--spot-border)33" };

  const renderMatrix = (label, rows, tiers, testid) => (
    <div style={{ marginBottom: 8 }} data-testid={testid}>
      <div style={SUBHEAD}>{label}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ background: "var(--spot-bg3)" }}>
            <th style={{ ...HEAD, textAlign: "left" }}>Grade</th>
            {tiers.map((tier) => (
              <th key={tier.name} style={{ ...HEAD, textAlign: "right" }}>{tier.name}</th>
            ))}
          </tr></thead>
          <tbody>
            {Object.entries(rows).map(([grade, byTier], i) => (
              <tr key={grade} style={{ background: i % 2 ? "var(--spot-bg2)" : "transparent",
                borderBottom: "1px solid var(--spot-border)22" }}
                data-testid={`board-matrix-row-${grade.replace(/\s+/g, "")}`}>
                <td style={{ padding: "3px 6px", fontWeight: 600, color: "var(--spot-text)", whiteSpace: "nowrap" }}>
                  {grade}
                </td>
                {tiers.map((tier) => {
                  const v = byTier[tier.name];
                  return (
                    <td key={tier.name} style={{ padding: "3px 4px", textAlign: "right",
                      color: v != null ? "var(--spot-text2)" : "var(--spot-text3)",
                      fontFamily: "'JetBrains Mono', monospace" }}>
                      {v != null ? fn2(v) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <Sec label="Board Engine" hue="#4b5563" open={sec.engine} onToggle={() => toggleSec("engine")}
      data-testid="sec-board-engine">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {err && (
          <div style={{ fontSize: 11, color: "var(--spot-err)" }} data-testid="board-engine-err">
            Failed to load Board Engine manifest: {err}
          </div>
        )}
        {!manifest && !err && (
          <div style={{ fontSize: 11, color: "var(--spot-text3)" }} data-testid="board-engine-loading">
            Loading live engine manifest…
          </div>
        )}
        {manifest && (
          <>
            {/* MSF Tiers */}
            <div style={{ marginBottom: 4 }} data-testid="board-msf-tiers">
              <div style={SUBHEAD}>MSF Tiers</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {manifest.msf_tiers.map((tier) => (
                  <span key={tier.name} style={PILL}>
                    {tier.name}{" "}
                    <span style={{ color: "var(--spot-text3)" }}>
                      ({tier.min}
                      {tier.maxExclusive !== null && tier.maxExclusive !== undefined
                        ? "\u2013" + (tier.maxExclusive - 1)
                        : "+"})
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* Singlewall + Doublewall Base Rates */}
            {renderMatrix(
              `Singlewall Base Rates ($/MSF) — ${Object.keys(manifest.base_matrix.singlewall).length} grades`,
              manifest.base_matrix.singlewall, manifest.msf_tiers, "board-sw-matrix"
            )}
            {renderMatrix(
              `Doublewall Base Rates ($/MSF) — ${Object.keys(manifest.base_matrix.doublewall).length} grades`,
              manifest.base_matrix.doublewall, manifest.msf_tiers, "board-dw-matrix"
            )}

            {/* Liner + Medium Upgrades */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div data-testid="board-liner-upgrades-list">
                <div style={SUBHEAD}>Liner Upgrades</div>
                {Object.entries(manifest.liner_upgrades).map(([name, r]) => {
                  const isKemi = name === "42# Kemi-Lite";
                  const amt = isKemi ? (r.base_amount_per_msf || 0) : (r.amount_per_msf || 0);
                  return (
                    <div key={name} style={LIST_ROW}>
                      <span style={{ color: name === "None" ? "var(--spot-text3)" : "var(--spot-text)" }}>
                        {name === "None" ? "None (Kraft)" : name}
                        {r.enforce && r.allowed_board_grades && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--spot-text3)" }}>
                            ({r.allowed_board_grades.join(", ")} only)
                          </span>
                        )}
                      </span>
                      <span style={{ color: "var(--spot-text2)", fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace" }}>
                        {fn2(amt, 1, 1)}{isKemi ? "+T" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div data-testid="board-medium-upgrades-list">
                <div style={SUBHEAD}>Medium Upgrades</div>
                {Object.entries(manifest.medium_upgrades).map(([name, r]) => (
                  <div key={name} style={LIST_ROW}>
                    <span style={{ color: name === "None" ? "var(--spot-text3)" : "var(--spot-text)" }}>
                      {name}
                    </span>
                    <span style={{ color: "var(--spot-text2)", fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace" }}>
                      {fn2(r.amount_per_msf || 0, 1, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Flute Rules + Dim Adders + Fixed Charges */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div data-testid="board-flute-rules-list">
                <div style={SUBHEAD}>Flute Rules</div>
                {Object.entries(manifest.flute_rules).map(([f, r]) => (
                  <div key={f} style={LIST_ROW}>
                    <span style={{ color: "var(--spot-text)", fontWeight: 600 }}>{f}</span>
                    <span style={{ color: "var(--spot-text2)" }}>
                      {r.wall_type === "doublewall" ? "DW" : "SW"}
                      {r.flute_upcharge_per_msf > 0 ? " +" + fn2(r.flute_upcharge_per_msf, 1, 1) : ""}
                      <span style={{ marginLeft: 6, color: "var(--spot-text3)",
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                        caliper {fn2(manifest.constants?.FLUTE_CALIPERS?.[f] || 0, 4, 4)}″
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div data-testid="board-dim-adders-list">
                <div style={SUBHEAD}>Dim Adders</div>
                <div style={{ fontSize: 11, color: "var(--spot-text2)", marginBottom: 2 }}>
                  Width:{" "}
                  {(manifest.dimensional_adders.width || []).map((r) =>
                    `${fn2(r.min, 3, 0)}\u2013${fn2(r.max, 1, 0)}" +$${fn2(r.amount_per_msf, 1, 1)}`
                  ).join(", ")}
                </div>
                <div style={{ fontSize: 11, color: "var(--spot-text2)" }}>
                  Length:{" "}
                  {(manifest.dimensional_adders.length || []).map((r) =>
                    `${fn2(r.min, 1, 0)}\u2013${fn2(r.max, 1, 0)}" +$${fn2(r.amount_per_msf, 1, 1)}`
                  ).join(", ")}
                </div>
              </div>
              <div data-testid="board-fixed-charges-list">
                <div style={SUBHEAD}>Fixed Charges</div>
                <div style={{ fontSize: 11, color: "var(--spot-text2)" }}>
                  Under {manifest.fixed_charges?.under_5_msf_setup_fee?.trigger_order_msf_lt} MSF:{" "}
                  ${fn2(manifest.fixed_charges?.under_5_msf_setup_fee?.amount || 0)}
                </div>
                <div style={{ fontSize: 11, color: "var(--spot-text2)" }}>
                  Pallet Prep: ${fn2(manifest.fixed_charges?.pallet_prep_fee?.amount || 0)}/MSF
                </div>
              </div>
            </div>

            {/* Route Eligibility (constants from manifest) */}
            <div style={{ marginBottom: 8 }} data-testid="board-route-eligibility">
              <div style={SUBHEAD}>Route Eligibility</div>
              <div style={{ fontSize: 11, color: "var(--spot-text2)", lineHeight: 1.5 }}>
                <div>• CAD (rotary die): All flutes · All library sheets · ALWAYS eligible</div>
                <div>
                  • Crest (flat-bed): All flutes · Sheet ≤ {manifest.constants?.CREST_MAX_W}
                  ×{manifest.constants?.CREST_MAX_L} · Requires steel die
                </div>
                <div>
                  • Bobst (high-speed): {(manifest.constants?.BOBST_FLUTES || []).join(" or ")} flute ONLY ·
                  Sheet {manifest.constants?.BOBST_MIN_W}×{manifest.constants?.BOBST_MIN_L} →{" "}
                  {manifest.constants?.BOBST_MAX_W}×{manifest.constants?.BOBST_MAX_L}
                </div>
                <div>• Mullen upgrade chain: {Object.entries(manifest.constants?.MULLEN_UPGRADE || {})
                  .map(([k, v]) => `${k}→${v}`).join(" · ")}</div>
              </div>
            </div>

            {/* Approved Sheets summary */}
            <div style={{ marginBottom: 4 }} data-testid="board-approved-sheets-summary">
              <div style={SUBHEAD}>Approved Sheets ({manifest.approved_sheets_total})</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(manifest.approved_specs || []).map((spec) => (
                  <span key={`${spec.grade}-${spec.flute}`} style={CHIP}
                    data-testid={`board-sheet-chip-${spec.grade.replace(/\s+/g, "")}-${spec.flute.replace("/", "")}`}>
                    {spec.grade} {spec.flute}{" "}
                    <span style={{ fontWeight: 700, color: "var(--spot-text3)" }}>({spec.count})</span>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 10, color: "var(--spot-text3)", fontStyle: "italic",
              borderTop: "1px solid var(--spot-border)", paddingTop: 6, marginTop: 4 }}>
              Live snapshot from <code>/api/engine/manifest</code> — matches the math
              the backend pricing pipeline runs. Any board grade visible here can be quoted.
            </div>
          </>
        )}
      </div>
    </Sec>
  );
}

/** ─── Bill of Materials ─────────────────────────────────────────────
 *  Multi-Part only. Item strip with Add / Duplicate / Delete / Reorder + per-item
 *  desc, type, pcsPerSet. Active item is highlighted; clicking a tab calls
 *  `switchBomItem` which snapshots the current item-level state and loads the target.
 *  Ported from legacy spot_r1_5.jsx L2775-2820 (switchBomItem, addBomItem,
 *  removeBomItem) + R1.5.x BOM strip UI. */
export function BomSec() {
  const {
    active, sec, toggleSec,
    switchBomItem, addBomItem, duplicateBomItem, removeBomItem,
    reorderBomItem, updateBomItem, updateBomItemState, spinOffBomItem,
  } = useQuote();
  // ⚠️ ALL HOOKS BEFORE EARLY RETURN — rules of hooks
  const [dragIdx, setDragIdx] = React.useState(null);
  // Per-tab Die popover (open by item idx; null = closed)
  const [dieOpenIdx, setDieOpenIdx] = React.useState(null);

  const s = active?.state || {};
  if (s.quoteType !== "Multi-Part") return null;
  const items = s.bomItems || [];
  const activeIdx = s.activeItemIdx ?? 0;
  const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a","#9ca3af","#fbbf24"];

  // Read the die value for an item — for the active item it lives at top-level
  // state; for inactive items it's in bi.state. Mirrors how legacy spot_r1_5.jsx
  // L3854 surfaces per-row die badges in the BOM table.
  const itemDie = (it, i) => {
    const src = i === activeIdx ? s : (it.state || {});
    return {
      treatment: src.dieTreatment || "None",
      cost: Number(src.cuttingDieCost) || 0,
    };
  };

  return (
    <Sec
      label={<>Bill of Materials <span style={{ opacity: 0.7 }}>· {items.length} Component{items.length !== 1 ? "s" : ""}</span></>}
      hue="#f59e0b" open={sec.bom} onToggle={() => toggleSec("bom")} data-testid="sec-bom">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="bom-strip">
          {items.map((it, i) => {
            const tint = tints[i % tints.length];
            const isActive = i === activeIdx;
            return (
              <div key={it.id || i}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) reorderBomItem(dragIdx, i); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
                data-testid={`bom-item-${i}`}
                onClick={() => switchBomItem(i)}
                style={{
                  padding: "5px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                  background: isActive ? `${tint}22` : "var(--spot-bg3)",
                  border: `1px solid ${isActive ? tint : "var(--spot-border)"}`,
                  color: isActive ? tint : "var(--spot-text2)",
                  display: "flex", alignItems: "center", gap: 6,
                  opacity: dragIdx === i ? 0.45 : 1,
                }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
                {/* Name is DISPLAY-ONLY in the BOM strip — edit in the BOM Builder
                 *  modal or via the Item Description field at the top of Item Setup
                 *  (per legacy parity + user request 2026-06-10). */}
                <span data-testid={`bom-item-desc-${i}`}
                  title="Click to select; edit name in BOM Builder or Item Description"
                  style={{ fontSize: 11, fontWeight: isActive ? 700 : 500,
                    color: "inherit", maxWidth: 160, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: "inherit", userSelect: "none" }}>
                  {it.desc || `Item ${i + 1}`}
                </span>
                <select value={it.type || "Manufactured"}
                  onChange={(e) => updateBomItem(i, { type: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`bom-item-type-${i}`}
                  style={{ background: "var(--spot-bg2)", color: "var(--spot-text3)",
                    border: "1px solid var(--spot-border)", borderRadius: 3,
                    fontSize: 10, padding: "1px 3px", outline: "none" }}>
                  <option>Manufactured</option><option>Purchased</option><option>Fulfillment</option>
                </select>
                <span title="Pieces per set" style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 9, color: "var(--spot-text3)" }}>×</span>
                  <input type="number" min="1" step="1" value={it.pcsPerSet ?? 1}
                    onChange={(e) => updateBomItem(i, { pcsPerSet: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`bom-item-pcs-${i}`}
                    style={{ width: 30, background: "transparent", border: "none",
                      color: "inherit", fontSize: 11, outline: "none", textAlign: "center",
                      fontFamily: "'JetBrains Mono', monospace" }} />
                </span>
                {/* Per-item Die chip — legacy parity (spot_r1_5.jsx BOM-row badges).
                    Click to open a popover and set Cost + Treatment for any
                    component regardless of route. Stored on per-item state so
                    inactive items keep their dies. */}
                {(() => {
                  const d = itemDie(it, i);
                  const has = d.treatment !== "None" && d.cost > 0;
                  return (
                    <span style={{ position: "relative" }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); setDieOpenIdx(dieOpenIdx === i ? null : i); }}
                        data-testid={`bom-item-die-${i}`}
                        title={has ? `Die ${d.treatment}: $${d.cost.toFixed(2)}` : "Add die"}
                        style={{
                          padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                          cursor: "pointer", userSelect: "none",
                          background: has ? "rgba(34,197,94,0.18)" : "transparent",
                          border: `1px solid ${has ? "rgba(34,197,94,0.55)" : "var(--spot-border)"}`,
                          color: has ? "#22c55e" : "var(--spot-text3)",
                        }}>
                        {has ? `Die $${d.cost.toFixed(0)}` : "+ Die"}
                      </span>
                      {dieOpenIdx === i && (
                        <div onClick={(e) => e.stopPropagation()}
                          data-testid={`bom-item-die-pop-${i}`}
                          style={{
                            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
                            background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
                            borderRadius: 4, padding: 8, minWidth: 220,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            display: "flex", flexDirection: "column", gap: 6,
                          }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)" }}>
                            Die — {it.desc || `Item ${i+1}`}
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            {["None", "Separate Line", "Amortize"].map((t) => (
                              <button key={t}
                                onClick={() => updateBomItemState(i, { dieTreatment: t, ...(t === "None" ? { cuttingDieCost: 0 } : {}) })}
                                data-testid={`bom-item-die-treat-${i}-${t.replace(/\s/g, "")}`}
                                style={{
                                  flex: 1, padding: "4px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                                  cursor: "pointer",
                                  background: d.treatment === t ? "var(--spot-accent)" : "var(--spot-bg3)",
                                  color: d.treatment === t ? "#fff" : "var(--spot-text2)",
                                  border: `1px solid ${d.treatment === t ? "var(--spot-accent)" : "var(--spot-border)"}`,
                                }}>
                                {t === "Separate Line" ? "Line" : t === "Amortize" ? "Amort" : t}
                              </button>
                            ))}
                          </div>
                          {d.treatment !== "None" && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>Cost $</span>
                              <input type="number" step="0.01" min="0" value={d.cost || ""}
                                onChange={(e) => updateBomItemState(i, { cuttingDieCost: e.target.value })}
                                data-testid={`bom-item-die-cost-${i}`}
                                style={{ flex: 1, padding: "3px 5px", fontSize: 11,
                                  background: "var(--spot-bg3)", color: "var(--spot-text)",
                                  border: "1px solid var(--spot-border)", borderRadius: 3, outline: "none",
                                  fontFamily: "'JetBrains Mono', monospace" }} />
                              <button onClick={() => updateBomItemState(i, { cuttingDieCost: 1200 })}
                                title="Crest default ($1,200)"
                                style={{ fontSize: 10, padding: "3px 6px", borderRadius: 3,
                                  background: "var(--spot-bg3)", color: "var(--spot-text2)",
                                  border: "1px solid var(--spot-border)", cursor: "pointer" }}>
                                $1200
                              </button>
                            </div>
                          )}
                          <button onClick={() => setDieOpenIdx(null)}
                            data-testid={`bom-item-die-close-${i}`}
                            style={{ alignSelf: "flex-end", fontSize: 10, padding: "2px 8px",
                              borderRadius: 3, background: "var(--spot-bg3)", color: "var(--spot-text2)",
                              border: "1px solid var(--spot-border)", cursor: "pointer" }}>
                            Done
                          </button>
                        </div>
                      )}
                    </span>
                  );
                })()}
                {items.length > 1 && (
                  <span onClick={(e) => { e.stopPropagation(); spinOffBomItem(i); }}
                    data-testid={`bom-spinoff-${i}`}
                    title="Spin off as a separate Simple quote tab"
                    style={{ color: "var(--spot-accent)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "0 2px" }}>↗</span>
                )}
                {items.length > 1 && (
                  <span onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove "${it.desc || `Item ${i+1}`}"?`)) removeBomItem(i); }}
                    data-testid={`bom-rm-${i}`}
                    title="Remove component"
                    style={{ color: "var(--spot-text3)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</span>
                )}
              </div>
            );
          })}
          <button onClick={() => addBomItem()} data-testid="bom-add-btn" style={{
            all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
            padding: "5px 10px", borderRadius: 3,
            background: "var(--spot-accent)", color: "#fff",
          }}>+ Component</button>
          {items.length > 0 && (
            <button onClick={() => duplicateBomItem()} data-testid="bom-dup-btn" style={{
              all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
              padding: "5px 10px", borderRadius: 3,
              background: "var(--spot-bg3)", color: "var(--spot-text2)",
              border: "1px solid var(--spot-border)",
            }}>⎘ Duplicate</button>
          )}
          <button onClick={() => window.dispatchEvent(new CustomEvent("spot:open-bom-builder"))}
            data-testid="bom-edit-builder-btn" title="Reopen BOM Builder to add/edit components from templates"
            style={{
              all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
              padding: "5px 10px", borderRadius: 3,
              background: "var(--spot-bg3)", color: "#3b82f6",
              border: "1px solid #3b82f655",
            }}>✎ Edit in BOM Builder</button>
        </div>
        <div style={{ fontSize: 10, color: "var(--spot-text3)", paddingLeft: 4 }}>
          Drag a component to reorder · Click a component tab to make it active · Edits to the
          fields below (board, dims, qty, print, finishing) apply to the highlighted component.
        </div>
      </div>
    </Sec>
  );
}
