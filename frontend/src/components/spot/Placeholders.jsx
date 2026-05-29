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
  const { active, sec, toggleSec, setField, setManyFields } = useQuote();
  const s = active?.state || {};
  const isMP = s.quoteType === "Multi-Part";
  const isMatchedSet = isMP && s.pricingMode === "Matched Set";

  // D-110 default GM tier curve. SPC standard.
  const defaultGmByTier = {
    "0-1 MSF":  0.50,
    "1-3 MSF":  0.37,
    "3-5 MSF":  0.32,
    "5-9 MSF":  0.27,
    "10+ MSF":  0.25,
  };
  const gmByTier = s.gmByTier || defaultGmByTier;
  const setGm = (tier, pct) => setField("gmByTier", { ...gmByTier, [tier]: pct });
  const resetGm = () => setField("gmByTier", { ...defaultGmByTier });

  return (
    <Sec label="Pricing Strategy" hue="#8b5cf6" open={sec.pricing} onToggle={() => toggleSec("pricing")}
      data-testid="sec-pricing-strategy">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>

        {/* Pricing Mode (Multi-Part only) */}
        {isMP && (
          <div style={{ background: "#f59e0b0c", border: "1px solid #f59e0b22",
            borderRadius: 5, padding: "6px 8px", flex: "0 0 auto" }}
            data-testid="pricing-mode-panel">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>Pricing Mode</div>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="Individual"  active={s.pricingMode === "Individual"}  onClick={() => setField("pricingMode", "Individual")}  small tint="#f59e0b" />
              <Tile label="Matched Set" active={s.pricingMode === "Matched Set"} onClick={() => setField("pricingMode", "Matched Set")} small tint="#f59e0b" />
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

        {/* Tier Targets (GM% / Sell$/MSF) */}
        <div style={{ background: "#3b82f60c", border: "1px solid #3b82f622",
          borderRadius: 5, padding: "6px 8px", flex: 1, minWidth: 240 }}
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
            <button onClick={resetGm} data-testid="btn-reset-gm"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-err)" }}>
              Reset to Defaults
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 8px",
            fontSize: 11, alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "var(--spot-text3)" }}>TIER</span>
            <span style={{ fontWeight: 700, color: "var(--spot-text3)" }}>GM %</span>
            {Object.entries(gmByTier).map(([tier, pct]) => (
              <React.Fragment key={tier}>
                <span style={{ color: "var(--spot-text2)" }}>{tier}</span>
                <input className="sp-input" type="number" step="0.1" min="0" max="99.9"
                  value={Math.round(pct * 1000) / 10}
                  onChange={(e) => setGm(tier, (parseFloat(e.target.value) || 0) / 100)}
                  data-testid={`input-tier-${tier.replace(/\s+/g, '-')}`}
                  style={{ padding: "4px 6px", fontSize: 12, textAlign: "right" }} />
              </React.Fragment>
            ))}
          </div>
        </div>

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

        {/* Force Sell — per-qty override */}
        <ForceSellPanel s={s} setField={setField} />
      </div>
    </Sec>
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

/** ─── Advanced Controls ──────────────────────────────────────────────
 *  Ported from legacy spot_r1_5.jsx lines 6416-6605.
 *  Contains: General defaults · Rate display (D-110 calibrated) · Parser config */
export function AdvancedControlsSec() {
  const { sec, toggleSec } = useQuote();
  return (
    <Sec label="Advanced Controls" hue="#6b7280" open={sec.rates} onToggle={() => toggleSec("rates")}
      data-testid="sec-advanced-controls">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

        {/* Rate sheet (read-only display of D-110 calibrated rates) */}
        <RatePanel
          title="Calibrated Rates (D-110 FINAL)" color="#94a3b8"
          rows={[
            ["Inca Press",  "$485/hr  ·  75 sh/hr (Gloss/Satin equalized)"],
            ["CAD",         "$138/hr  ·  650 in/min  ·  Setup 8/20/25/22 min"],
            ["Crest",       "$45/hr  ·  150 sh/hr  ·  Setup Std 45 / Adv 90 min  ·  $1,200 default die"],
            ["Bobst",       "$350/hr (uncalibrated placeholder)  ·  3,000 sh/hr  ·  45 min flat  ·  $250 min  ·  $1,800 default die"],
            ["GM Curve",    "0-1 MSF: 50%  ·  1-3: 37%  ·  3-5: 32%  ·  5-9: 27%  ·  10+: 25%"],
            ["FSC/SFI",     "$25 amortized into board (D-086)"],
            ["Paper Uplift","+10% baked into base_matrix (D-102)"],
            ["Ink",         "$0.05/sqft LOCKED"],
            ["Under-5 MSF Fee", "$0 always (Rule 3)"],
          ]}
          dataTestId="rate-sheet"
        />

        {/* Defaults */}
        <RatePanel
          title="General Defaults" color="#6b7280"
          rows={[
            ["Default print finish",   "Satin (Rule 8 / D-105)"],
            ["Default FOB",            "Origin (ZIP 44704)"],
            ["Default initials",       "SPC (locked, Rule 2)"],
            ["Default freight markup", "15%"],
            ["Default die markup",     "15%"],
            ["Default Prepress",       "Auto ($50 if no charge)"],
          ]}
          dataTestId="defaults-panel"
        />

        <div style={{ background: "var(--spot-warn-bg)", border: "1px dashed var(--spot-warn)",
          borderRadius: 4, padding: "8px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)",
            textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>
            Rate Editing — admin only
          </div>
          <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
            These constants live in the Python engine (`/app/backend/engine/core.py`) and require an admin
            commit. Phase 4 will expose them via a Pricing Console with audit log.
          </div>
        </div>
      </div>
    </Sec>
  );
}

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
 *  Multi-Part only. Item strip + per-item type selector. */
export function BomSec() {
  const { active, sec, toggleSec, setField, setManyFields } = useQuote();
  const s = active?.state || {};
  if (s.quoteType !== "Multi-Part") return null;
  const items = s.bomItems || [];
  const tints = ["#e8927c","#b08cf5","#7dd3c0","#e88dc4","#8cc8e8","#d4a76a"];

  const addItem = () => {
    const next = [...items, { id: "it_"+Date.now(), desc: `Item ${items.length+1}`, type: "Manufactured", pcsPerSet: 1 }];
    setManyFields({ bomItems: next, activeItemIdx: next.length - 1 });
  };
  const rm = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    setManyFields({ bomItems: next, activeItemIdx: Math.max(0, Math.min(s.activeItemIdx, next.length - 1)) });
  };

  return (
    <Sec label={<>Bill of Materials <span style={{ opacity: 0.7 }}>· {items.length} Component{items.length !== 1 ? "s" : ""}</span></>}
      hue="#f59e0b" open={sec.bom} onToggle={() => toggleSec("bom")} data-testid="sec-bom">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }} data-testid="bom-strip">
        {items.map((it, i) => {
          const tint = tints[i % tints.length];
          const isActive = i === s.activeItemIdx;
          return (
            <div key={it.id} data-testid={`bom-item-${i}`}
              onClick={() => setField("activeItemIdx", i)}
              style={{
                padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                background: isActive ? `${tint}22` : "var(--spot-bg3)",
                border: `1px solid ${isActive ? tint : "var(--spot-border)"}`,
                color: isActive ? tint : "var(--spot-text2)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tint }} />
              <input value={it.desc} onChange={(e) => {
                const next = items.map((c, idx) => idx === i ? { ...c, desc: e.target.value } : c);
                setField("bomItems", next);
              }} onClick={(e) => e.stopPropagation()}
                style={{ background: "transparent", border: "none", color: "inherit",
                  fontSize: 11, outline: "none", width: 120, fontFamily: "inherit" }} />
              <select value={it.type} onChange={(e) => {
                const next = items.map((c, idx) => idx === i ? { ...c, type: e.target.value } : c);
                setField("bomItems", next);
              }} onClick={(e) => e.stopPropagation()}
                style={{ background: "var(--spot-bg2)", color: "var(--spot-text3)",
                  border: "1px solid var(--spot-border)", borderRadius: 3,
                  fontSize: 10, padding: "1px 3px", outline: "none" }}>
                <option>Manufactured</option><option>Fulfillment</option><option>Purchased</option>
              </select>
              <span onClick={(e) => { e.stopPropagation(); rm(i); }} data-testid={`bom-rm-${i}`}
                style={{ color: "var(--spot-text3)", cursor: "pointer" }}>×</span>
            </div>
          );
        })}
        <button onClick={addItem} data-testid="bom-add-btn" style={{
          all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
          padding: "5px 10px", borderRadius: 3,
          background: "var(--spot-accent)", color: "#fff",
        }}>+ Component</button>
      </div>
    </Sec>
  );
}
