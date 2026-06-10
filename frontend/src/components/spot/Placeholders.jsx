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
 *  Ported from legacy spot_r1_5.jsx lines 6606-6758.
 *  Contains: Sheet library viewer · Route eligibility · Buy Min behavior */
export function BoardEngineSec() {
  const { active, sec, toggleSec } = useQuote();
  const s = active?.state || {};

  return (
    <Sec label="Board Engine" hue="#4b5563" open={sec.engine} onToggle={() => toggleSec("engine")}
      data-testid="sec-board-engine">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

        <RatePanel
          title="Singlewall Flutes / Grades" color="#4b5563"
          rows={[
            ["Flutes",  "B  ·  C  ·  E"],
            ["Grades",  "200  ·  ECT 32  ·  ECT 44  ·  ECT 48  ·  ECT 55  ·  ECT 61  ·  ECT 71  ·  ECT 82  ·  NT"],
            ["Liners (outside/inside)", "None (kraft)  ·  42# Kla-White  ·  42# Kemi-Lite  ·  42# Bleached White  ·  33# Kla-White  ·  56# Kla-White"],
            ["Mediums", "None  ·  26#  ·  33#  ·  35HPL#  ·  40#  ·  42# Bl"],
          ]}
          dataTestId="board-singlewall"
        />

        <RatePanel
          title="Liner Upgrade Rules" color="#06b6d4"
          rows={[
            ["33# Kla-White",   "allowed on 175 / ECT 32 only"],
            ["56# Kla-White",   "allowed on 250 only"],
            ["42# Bleached White", "+$17.50/MSF surcharge"],
          ]}
          dataTestId="board-liner-upgrades"
        />

        <RatePanel
          title="Route Eligibility (D-121 / D-124)" color="#22c55e"
          rows={[
            ["CAD (rotary die)",      "All flutes  ·  All library sheets  ·  ALWAYS eligible"],
            ["Crest (flat-bed die)",  "All flutes  ·  Sheet ≤ 60×120  ·  Requires steel die"],
            ["Bobst (high-speed)",    "E or F flute ONLY  ·  Sheet 13.78×15.75 → 41.75×29.125  ·  0.060″ caliper limit"],
            ["Auto-route preference", "Cost-winner — lowest viable route wins (D-124, R1.6.1)"],
            ["B/C flute → Bobst",     "HARD-BLOCKED — never emitted as route hint"],
          ]}
          dataTestId="board-route-elig"
        />

        <RatePanel
          title="Buy Min Behavior (D-067)" color="#f59e0b"
          rows={[
            ["Stock sheets",  "BYPASS mill minimums  ·  Engine pulls from library directly"],
            ["Custom sheets", "Trigger mill Buy Min  ·  Engine orders enough sheets to satisfy"],
            ["Current quote", s.boardSubstitution ? `Board substitution: ${s.boardSubstitution}` : "No substitution active"],
          ]}
          dataTestId="board-buy-min"
        />

        <div style={{ background: "var(--spot-warn-bg)", border: "1px dashed var(--spot-warn)",
          borderRadius: 4, padding: "8px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)",
            textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>
            Sheet Library Editor — admin only
          </div>
          <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
            The approved sheet library lives in `/app/backend/engine/routing.py` (singlewall + doublewall
            tables). Phase 4 will expose sheet add/edit/disable via a Board Engine admin console with audit log.
          </div>
        </div>
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
    reorderBomItem, updateBomItem, spinOffBomItem,
  } = useQuote();
  // ⚠️ ALL HOOKS BEFORE EARLY RETURN — rules of hooks
  const [dragIdx, setDragIdx] = React.useState(null);

  const s = active?.state || {};
  if (s.quoteType !== "Multi-Part") return null;
  const items = s.bomItems || [];
  const activeIdx = s.activeItemIdx ?? 0;
  const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a","#9ca3af","#fbbf24"];

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
