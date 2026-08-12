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

  const overridden = !!ovr;

  // Smart default for CAD pricing method: when inches of rule are present
  // (typed or parsed), default to "By Inches of Rule"; otherwise "By Difficulty".
  // Only auto-manages until the estimator explicitly picks a method (cadMethodTouched).
  React.useEffect(() => {
    if (s.cadMethodTouched) return;
    const ri = parseFloat(s.totalRuleInches || 0);
    const want = ri > 0 ? "By Inches of Rule" : "By Difficulty";
    if ((s.cadPricingMethod || "By Difficulty") !== want) setField("cadPricingMethod", want);
  }, [s.totalRuleInches, s.cadMethodTouched, s.cadPricingMethod]);

  // Collapsed summary: print · saber(+layout) · route · cut · strip · glue · tape · perf.
  const sidesShort = s.printSides === "2-Sided" ? "2S" : s.printSides === "1-Sided" ? "1S" : "";
  const printPart = hasPrint
    ? `${s.printMode || "Print"}${sidesShort ? " " + sidesShort : ""}${s.whiteInk === "Yes" ? " +W" : ""}`
    : "No Print";
  const cadShort = s.cadDifficulty === "Standard" ? "Std" : s.cadDifficulty;
  const isCrestRoute = route === "Crest" || ovr === "Crest";
  const perfNum = Number(s.perfPct) || 0;
  const saberPart = s.saber === "Yes"
    ? (result?.saberBlanksOutN && result?.saberBlankW
        ? `Saber ${result.saberBlanksOutN}@${Math.round(result.saberBlankW)}×${Math.round(Number(result.saberBlankL))}${result.saberOut > 0 ? " (" + result.saberOut + "/blk)" : ""}`
        : `Saber ${s.saberCuts || 1}c×${s.saberBlanksOut || 1}`)
    : null;
  const preParts = [printPart, saberPart].filter(Boolean);
  const postParts = [
    isCrestRoute ? `Crest` : (s.cadDifficulty ? `Cut ${cadShort}` : null),
    s.handStripping === "Yes" ? `Strip ${s.strippingComplexity || ""}`.trim() : null,
    s.handGluing === "Yes" ? `Glue ${s.jointsPerPiece || 1}j${s.gluingComplexity ? " " + s.gluingComplexity : ""}` : null,
    s.tape === "Yes" ? `Tape ${s.tapeType === "Reinforced" ? "Reinf" : (s.tapeType || "")}`.trim() : null,
    perfNum > 0 ? `Perf ${+(perfNum * 100).toFixed(1)}%` : null,
  ].filter(Boolean);

  // Route node — when the estimator OVERRIDES the auto route, flag it with a
  // caution glyph and a yellow highlight pill.
  const routeNode = !route ? null : (overridden ? (
    <span data-testid="route-override-badge" title="Route manually overridden — not auto-selected"
      style={{ color: "#92400e", background: "#fde68a", border: "1px solid #f59e0b",
        borderRadius: 3, padding: "0 5px", fontWeight: 800 }}>⚠ {route}</span>
  ) : <span>auto → {route}</span>);

  const joinNodes = (arr) => arr.reduce((acc, n, i) =>
    i === 0 ? [<React.Fragment key={`n${i}`}>{n}</React.Fragment>]
            : [...acc, <span key={`s${i}`} style={{ opacity: .4, margin: "0 3px" }}>·</span>,
               <React.Fragment key={`n${i}`}>{n}</React.Fragment>], []);
  const collapsedNode = joinNodes([...preParts, routeNode, ...postParts].filter(Boolean));

  return (
    <Sec label="Production Specs" hue="#22c55e" open={sec.prod} onToggle={() => toggleSec("prod")}
      badge={sec.prod ? routeNode : collapsedNode} accent={!!route}
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
                {/* Blanks-out hint (legacy parity spot_r1_5.jsx L6091) */}
                {result?.saberBlankW > 0 && result?.saberBlankL > 0 && (
                  <span data-testid="saber-blanks-hint"
                    style={{ fontSize: 11, color: "var(--spot-text2)", marginLeft: 4, whiteSpace: "nowrap" }}>
                    {"\u2192"} {result.saberBlanksOutN} blanks at {Math.round(result.saberBlankW)}{"\u00D7"}{Number(result.saberBlankL).toFixed(1)}
                    {result.saberOut > 0 && (
                      <> {"\u2014"} <b style={{ color: "var(--spot-accent)" }}>{result.saberOut} out/blank</b></>
                    )}
                  </span>
                )}
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
        {/* CAD-only inputs — hidden on the Crest route, which uses its own
            Std/Adv complexity control below (these never affect Crest pricing). */}
        {!isCrestRoute && (() => {
          // ── Legacy parity (spot_r1_5.jsx L6139-6140): CAD pricing basis is an
          // explicit user choice — "By Difficulty" (bucket) OR "By Inches of Rule"
          // (actual knife length). The rule-inches value (often parsed from the
          // CAD/email) drives a NON-DESTRUCTIVE difficulty recommendation; it never
          // auto-overwrites the user's difficulty pick, and never changes the route
          // (auto-route is always difficulty-based, matching legacy L419/L3511).
          const method = s.cadPricingMethod || "By Difficulty";
          const byRule = method === "By Inches of Rule";
          const ri = parseFloat(s.totalRuleInches || 0);
          const uw = parseFloat(s.oneUpW || 0);
          const ul = parseFloat(s.oneUpL || 0);
          const perim = 2 * (uw + ul);
          const ratio = ri > 0 && perim > 0 ? ri / perim : 0;
          const recommend = ratio > 3 ? "Complex" : "Standard";
          const hasRec = ri > 0 && perim > 0;
          const pps = result?.pcsPerSheet || 0;
          const sheetRuleIn = ri > 0 && pps > 0 ? ri * pps * 1.15 : 0;
          return (
            <>
              <F l="CAD Price" inline>
                <div style={{ display: "flex", gap: 2 }}>
                  <Tile label="Diff" active={!byRule}
                    onClick={() => setManyFields({ cadPricingMethod: "By Difficulty", cadMethodTouched: true })}
                    small tint="#22c55e" data-testid="tile-cadprice-diff" />
                  <Tile label="Rule" active={byRule}
                    onClick={() => setManyFields({ cadPricingMethod: "By Inches of Rule", cadMethodTouched: true })}
                    small tint="#22c55e" data-testid="tile-cadprice-rule" />
                </div>
              </F>
              <F l="Difficulty" inline>
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {DIFFICULTY.map((d) => {
                    const lbl = d === "Standard" ? "Std" : d;
                    const suggested = hasRec && d === recommend && s.cadDifficulty !== d;
                    return <Tile key={d} label={lbl} active={s.cadDifficulty === d}
                      glow={suggested}
                      data-testid={`tile-difficulty-${lbl}`}
                      onClick={() => setField("cadDifficulty", d)} small tint="#22c55e" />;
                  })}
                  {/* Non-destructive recommendation (parsed rule-inches → suggested difficulty) */}
                  {hasRec && (
                    <span data-testid="difficulty-rule-hint"
                      title={`${ri.toFixed(1)}″ rule ÷ ${perim.toFixed(1)}″ perim = ${ratio.toFixed(2)}× — iQuote rule suggests ${recommend}`}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                        whiteSpace: "nowrap",
                        color: s.cadDifficulty === recommend ? "var(--spot-green)" : "#f59e0b",
                        background: s.cadDifficulty === recommend ? "var(--spot-green-soft, #22c55e22)" : "#f59e0b22",
                        border: `1px solid ${s.cadDifficulty === recommend ? "var(--spot-green)" : "#f59e0b"}`,
                      }}>
                      {s.cadDifficulty === recommend ? `${recommend === "Standard" ? "Std" : recommend} \u2713` : `Suggest: ${recommend === "Standard" ? "Std" : recommend}`}
                    </span>
                  )}
                </div>
              </F>
              {byRule && (
                <F l="Rule In/Pc" inline>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" step="0.1" min="0"
                      value={s.totalRuleInches || ""}
                      onChange={(e) => setField("totalRuleInches", e.target.value)}
                      placeholder="0"
                      data-testid="input-rule-inches"
                      style={{
                        width: 64, padding: "4px 6px", fontSize: 12, textAlign: "center",
                        background: "var(--spot-bg2)", color: "var(--spot-text)",
                        border: "1px solid var(--spot-border)", borderRadius: 3,
                        fontFamily: "'JetBrains Mono', monospace",
                      }} />
                    {sheetRuleIn > 0 && (
                      <span style={{ fontSize: 11, color: "var(--spot-text2)", whiteSpace: "nowrap" }}
                        data-testid="rule-sheet-hint">
                        {"\u00D7"}{pps} {"\u00D7"}1.15 = <b style={{ color: sheetRuleIn > 1000 ? "#f59e0b" : "var(--spot-text)" }}>{Math.round(sheetRuleIn)}</b> in/sheet
                      </span>
                    )}
                  </div>
                </F>
              )}
            </>
          );
        })()}
        <F l="Perf %" inline>
          {/* User enters a WHOLE percent (e.g. 25 for 25%); we store the decimal
              fraction (0.25) the engine expects, so pricing math / legacy parity
              are unchanged. Clamped 0–100 so a mis-typed value can't blow up the cut. */}
          <Num
            value={s.perfPct === "" || s.perfPct == null ? "" : String(+(Number(s.perfPct) * 100).toFixed(2))}
            onChange={(v) => {
              if (v === "") { setField("perfPct", "0"); return; }
              let pct = Number(v);
              if (Number.isNaN(pct)) return;
              pct = Math.max(0, Math.min(100, pct));
              setField("perfPct", String(+(pct / 100).toFixed(4)));
            }}
            step="1" min="0" max="100"
            title="Enter whole percent, e.g. 25 for 25% perforated"
            style={{ width: 60, textAlign: "center" }}
            data-testid="input-perf-pct"
          />
        </F>
        <F l="Mats" inline>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="No"  active={s.productMats === "No"}  onClick={() => setField("productMats", "No")}  small data-testid="tile-mats-no" />
            <Tile label="Yes" active={s.productMats === "Yes"} onClick={() => setField("productMats", "Yes")} small data-testid="tile-mats-yes" />
          </div>
        </F>
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
                <Tile label="Film" active={s.tapeType === "Film" || s.tapeType === "Clear"}      onClick={() => setField("tapeType", "Film")} small tint="#14b8a6" data-testid="tile-tapetype-film" />
                <Tile label="Foam" active={s.tapeType === "Foam" || s.tapeType === "Reinforced"} onClick={() => setField("tapeType", "Foam")} small tint="#14b8a6" data-testid="tile-tapetype-foam" />
                <Tile label="Duraco Red" active={s.tapeType === "Duraco Red"} onClick={() => setField("tapeType", "Duraco Red")} small tint="#14b8a6" data-testid="tile-tapetype-duracored" />
              </div>
            </F>
          )}
          {s.tape === "Yes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-end" }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--spot-text3)" }}>Strips</label>
              <input className="sp-input" type="number" min="1" value={s.tapeStrips ?? "1"}
                data-testid="input-tape-strips"
                onChange={(e) => setField("tapeStrips", e.target.value)}
                style={{ width: 50, padding: "5px 8px", fontSize: 12, textAlign: "center",
                  borderColor: (!s.tapeStrips || Number(s.tapeStrips) <= 0) ? "var(--spot-err)" : undefined }} />
            </div>
          )}
          {s.tape === "Yes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-end" }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--spot-text3)" }}>Strip Len (in)</label>
              <input className="sp-input" type="number" min="0" step="0.25" value={s.tapeStripLength ?? "0"}
                data-testid="input-tape-strip-length"
                onChange={(e) => setField("tapeStripLength", e.target.value)}
                style={{ width: 64, padding: "5px 8px", fontSize: 12, textAlign: "center",
                  borderColor: (!s.tapeStripLength || Number(s.tapeStripLength) <= 0) ? "var(--spot-err)" : undefined }} />
            </div>
          )}
        </div>
      </div>
    </Sec>
  );
}
