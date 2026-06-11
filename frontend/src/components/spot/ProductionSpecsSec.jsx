/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { F } from "./Sec";
import Tile, { Num } from "./Tile";
import { PRINT_MODES, DIFFICULTY, STRIP_COMP, GLUE_COMP } from "../../lib/defaults";

export default function ProductionSpecsSec({ result }) {
  const { active, sec, toggleSec, setField, setManyFields } = useQuote();
  const s = active?.state || {};
  const rawRoute = result?.route;
  // Legacy parity (spot_r1_5.jsx L5876, L4149): when engine returns
  // route="Saber + D/C" but Saber is OFF, the badge displays "CAD" instead.
  const route = (rawRoute === "Saber + D/C" && s.saber !== "Yes") ? "CAD" : rawRoute;
  const ovr = s.routeOverride;
  const hasPrint = s.printReq === "Yes";

  const badge = !route ? null : `${ovr ? "" : "auto → "}${route}`;

  return (
    <Sec label="Production Specs" hue="#22c55e" open={sec.prod} onToggle={() => toggleSec("prod")}
      badge={badge} accent={!!route}
      data-testid="sec-production">

      {/* Row 1: Print */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <F l="Print" inline>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="On"  active={s.printReq === "Yes"}
              onClick={() => {
                // Default to Satin / 1-Sided when turning print on, but don't
                // clobber an existing user selection.
                const patch = { printReq: "Yes" };
                if (!s.printMode || s.printMode === "None") patch.printMode = "Satin";
                if (!s.printSides || s.printSides === "None") patch.printSides = "1-Sided";
                setManyFields(patch);
              }}
              small tint="#3b82f6" data-testid="tile-print-on" />
            <Tile label="Off" active={s.printReq === "No"}  onClick={() => setField("printReq", "No")}  small tint="#3b82f6" data-testid="tile-print-off" />
          </div>
        </F>
        {hasPrint && (
          <F l="Mode" inline>
            <div style={{ display: "flex", gap: 2 }}>
              {PRINT_MODES.map((m) => {
                const lbl = m === "OnQ Styrene" ? "OnQ Sty" : m === "OnQ Lightbox" ? "OnQ LB" : m;
                return (
                  <Tile key={m} label={lbl} active={s.printMode === m}
                    data-testid={`tile-mode-${lbl.replace(/\s+/g, '')}`}
                    onClick={() => setField("printMode", m)} small tint="#3b82f6" />
                );
              })}
            </div>
          </F>
        )}
        {hasPrint && (
          <F l="Sides" inline>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="1-Side" active={s.printSides === "1-Sided"} onClick={() => setField("printSides", "1-Sided")} small tint="#3b82f6" data-testid="tile-sides-1" />
              <Tile label="2-Side" active={s.printSides === "2-Sided"} onClick={() => setField("printSides", "2-Sided")} small tint="#3b82f6" data-testid="tile-sides-2" />
              <Tile label="White"  active={s.whiteInk === "Yes"}       onClick={() => setField("whiteInk", s.whiteInk === "Yes" ? "No" : "Yes")} small tint="#8b5cf6" data-testid="tile-sides-white" />
            </div>
          </F>
        )}
        <F l="Saber" inline>
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <Tile label="No"  active={s.saber === "No"}  onClick={() => setField("saber", "No")}  small tint="#14b8a6" data-testid="tile-saber-no" />
            <Tile label="Yes" active={s.saber === "Yes"} onClick={() => setField("saber", "Yes")} small tint="#14b8a6" data-testid="tile-saber-yes" />
            {s.saber === "Yes" && (
              <>
                <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 4 }}>Cuts:</span>
                <input className="sp-input" type="number" min="1" max="10" value={s.saberCuts || "1"}
                  data-testid="input-saber-cuts"
                  onChange={(e) => setField("saberCuts", e.target.value)}
                  style={{ width: 40, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
                <span style={{ fontSize: 11, color: "var(--spot-text3)", marginLeft: 4 }}>Blanks Out:</span>
                <input className="sp-input" type="number" min="1" max="10" value={s.saberBlanksOut || "1"}
                  data-testid="input-saber-blanks"
                  onChange={(e) => setField("saberBlanksOut", e.target.value)}
                  style={{ width: 40, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
              </>
            )}
          </div>
        </F>
      </div>

      {/* Row 2: Cutting */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <F l="Route" inline>
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <Tile label="Auto"  active={!ovr}              onClick={() => setField("routeOverride", null)} small tint="#22d3ee" glow={!ovr} data-testid="tile-route-auto" />
            <Tile label="CAD"   active={ovr === "CAD"   || (!ovr && route === "CAD")}   onClick={() => setField("routeOverride", ovr === "CAD"   ? null : "CAD")}   small tint={ovr === "CAD"   ? "#ec4899" : "#22c55e"} data-testid="tile-route-cad" />
            <Tile label="Crest" active={ovr === "Crest" || (!ovr && route === "Crest")} onClick={() => setField("routeOverride", ovr === "Crest" ? null : "Crest")} small tint={ovr === "Crest" ? "#ec4899" : "#22c55e"} data-testid="tile-route-crest" />
            <Tile label="Bobst" active={ovr === "Bobst" || (!ovr && route === "Bobst")} onClick={() => setField("routeOverride", ovr === "Bobst" ? null : "Bobst")} small tint={ovr === "Bobst" ? "#ec4899" : "#a855f7"} data-testid="tile-route-bobst" />
            {ovr && <span style={{ fontSize: 11, fontWeight: 700, color: "#f472b6", alignSelf: "center", marginLeft: 2 }}>ALL {ovr.toUpperCase()}</span>}
          </div>
        </F>
        <F l="Difficulty" inline>
          <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
            {DIFFICULTY.map((d) => {
              const lbl = d === "Standard" ? "Std" : d;
              return <Tile key={d} label={lbl} active={s.cadDifficulty === d}
                data-testid={`tile-difficulty-${lbl}`}
                onClick={() => setField("cadDifficulty", d)} small tint="#22c55e" />;
            })}
            <span style={{ width: 1, height: 18, background: "var(--spot-border)", margin: "0 4px" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em" }}>RULE IN</span>
            <input type="number" step="0.1" min="0"
              value={s.totalRuleInches || ""}
              onChange={(e) => {
                const v = e.target.value;
                setField("totalRuleInches", v);
                const ri = parseFloat(v || 0);
                const uw = parseFloat(s.oneUpW || 0);
                const ul = parseFloat(s.oneUpL || 0);
                const perim = 2 * (uw + ul);
                if (ri > 0 && perim > 0) {
                  const recommend = (ri / perim) > 3 ? "Complex" : "Standard";
                  if (s.cadDifficulty !== recommend && s.cadDifficulty !== "Simple") {
                    setField("cadDifficulty", recommend);
                  }
                }
              }}
              placeholder="0"
              data-testid="input-rule-inches"
              style={{
                width: 56, padding: "2px 5px", fontSize: 11, textAlign: "center",
                background: "var(--spot-bg2)", color: "var(--spot-text)",
                border: "1px solid var(--spot-border)", borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace",
              }} />
            {/* Auto-classifier indicator */}
            {(() => {
              const ri = parseFloat(s.totalRuleInches || 0);
              const uw = parseFloat(s.oneUpW || 0);
              const ul = parseFloat(s.oneUpL || 0);
              if (ri <= 0 || uw <= 0 || ul <= 0) return null;
              const perim = 2 * (uw + ul);
              const ratio = ri / perim;
              const recommend = ratio > 3 ? "Complex" : "Standard";
              const matches = s.cadDifficulty === recommend;
              return (
                <span data-testid="difficulty-rule-hint"
                  title={`${ri.toFixed(1)}″ rule ÷ ${perim.toFixed(1)}″ perim = ${ratio.toFixed(2)}× — iQuote rule suggests ${recommend}`}
                  style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                    color: matches ? "var(--spot-green)" : "#f59e0b",
                    background: matches ? "var(--spot-green-soft, #22c55e22)" : "#f59e0b22",
                    border: `1px solid ${matches ? "var(--spot-green)" : "#f59e0b"}`,
                  }}>
                  {ratio.toFixed(1)}×
                </span>
              );
            })()}
          </div>
        </F>
        <F l="Perf %" inline>
          <Num value={s.perfPct} onChange={(v) => setField("perfPct", v)} step="0.01" min="0" max="1" style={{ width: 60, textAlign: "center" }} data-testid="input-perf-pct" />
        </F>
        <F l="Mats" inline>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="No"  active={s.productMats === "No"}  onClick={() => setField("productMats", "No")}  small data-testid="tile-mats-no" />
            <Tile label="Yes" active={s.productMats === "Yes"} onClick={() => setField("productMats", "Yes")} small data-testid="tile-mats-yes" />
          </div>
        </F>
        {(route === "Crest" || ovr === "Crest") && (
          <F l="Crest" inline>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="Std" active={s.crestComplexity === "Standard"} onClick={() => setField("crestComplexity", "Standard")} small tint="#22c55e" data-testid="tile-crest-std" />
              <Tile label="Adv" active={s.crestComplexity === "Advanced"} onClick={() => setField("crestComplexity", "Advanced")} small tint="#22c55e" data-testid="tile-crest-adv" />
            </div>
          </F>
        )}
      </div>

      {/* Row 3: Finishing */}
      <div style={{ display: "flex", gap: 30, alignItems: "flex-end", flexWrap: "wrap" }}>
        {/* Strip */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <F l="Strip" inline>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="No"  active={s.handStripping === "No"}  onClick={() => setField("handStripping", "No")}  small tint="#f59e0b" data-testid="tile-strip-no" />
              <Tile label="Yes" active={s.handStripping === "Yes"} onClick={() => setField("handStripping", "Yes")} small tint="#f59e0b" data-testid="tile-strip-yes" />
            </div>
          </F>
          {s.handStripping === "Yes" && (
            <F l="" inline>
              <div style={{ display: "flex", gap: 2 }}>
                {STRIP_COMP.map((c) => {
                  const lbl = c === "Standard" ? "Std" : c;
                  return <Tile key={c} label={lbl} active={s.strippingComplexity === c}
                    data-testid={`tile-stripcomp-${lbl}`}
                    onClick={() => setField("strippingComplexity", c)} small tint="#f59e0b" />;
                })}
              </div>
            </F>
          )}
          {s.handStripping === "Yes" && (
            <F l="Edge" inline>
              <div style={{ display: "flex", gap: 2 }}>
                <Tile label="No"  active={s.perimeterStripping === "No"}  onClick={() => setField("perimeterStripping", "No")}  small tint="#f59e0b" data-testid="tile-edge-no" />
                <Tile label="Yes" active={s.perimeterStripping === "Yes"} onClick={() => setField("perimeterStripping", "Yes")} small tint="#f59e0b" data-testid="tile-edge-yes" />
              </div>
            </F>
          )}
        </div>
        {/* Glue */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <F l="Glue" inline>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="No"  active={s.handGluing === "No"}  onClick={() => setField("handGluing", "No")}  small tint="#a855f7" data-testid="tile-glue-no" />
              <Tile label="Yes" active={s.handGluing === "Yes"} onClick={() => { setField("handGluing", "Yes"); setField("tape", "No"); }} small tint="#a855f7" data-testid="tile-glue-yes" />
            </div>
          </F>
          {s.handGluing === "Yes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-end" }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--spot-text3)" }}>Joints</label>
              <input className="sp-input" type="number" min="1" value={s.jointsPerPiece || "1"}
                data-testid="input-joints"
                onChange={(e) => setField("jointsPerPiece", e.target.value)}
                style={{ width: 50, padding: "5px 8px", fontSize: 12, textAlign: "center" }} />
            </div>
          )}
          {s.handGluing === "Yes" && (
            <F l="" inline>
              <div style={{ display: "flex", gap: 2 }}>
                {GLUE_COMP.map((c) => {
                  const lbl = c === "Standard" ? "Std" : c;
                  return <Tile key={c} label={lbl} active={s.gluingComplexity === c}
                    data-testid={`tile-gluecomp-${lbl}`}
                    onClick={() => setField("gluingComplexity", c)} small tint="#a855f7" />;
                })}
              </div>
            </F>
          )}
        </div>
        {/* Tape */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <F l="Tape" inline>
            <div style={{ display: "flex", gap: 2 }}>
              <Tile label="No"  active={s.tape === "No"}  onClick={() => setField("tape", "No")}  small tint="#14b8a6" data-testid="tile-tape-no" />
              <Tile label="Yes" active={s.tape === "Yes"} onClick={() => { setField("tape", "Yes"); setField("handGluing", "No"); }} small tint="#14b8a6" data-testid="tile-tape-yes" />
            </div>
          </F>
          {s.tape === "Yes" && (
            <F l="" inline>
              <div style={{ display: "flex", gap: 2 }}>
                <Tile label="Clear" active={s.tapeType === "Clear"}      onClick={() => setField("tapeType", "Clear")} small tint="#14b8a6" data-testid="tile-tapetype-clear" />
                <Tile label="Reinf" active={s.tapeType === "Reinforced"} onClick={() => setField("tapeType", "Reinforced")} small tint="#14b8a6" data-testid="tile-tapetype-reinf" />
              </div>
            </F>
          )}
        </div>
      </div>
    </Sec>
  );
}
