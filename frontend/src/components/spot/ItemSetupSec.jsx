/* eslint-disable */
import React, { useEffect, useRef } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { F } from "./Sec";
import Tile, { Num } from "./Tile";
import {
  BOX_STYLES, FLUTES, GRADES, getGradesForFlute, wallTypeForFlute, LINERS, MEDIUMS, allowed_liners,
} from "../../lib/defaults";
import { sheetAvailability, gradeAvailability } from "../../api/spot";
import { fmtMoney, fmtInt, fmtNum, fmtPct } from "../../lib/format";

// ECT → Mullen equivalence (ported from legacy spot_r1_5.jsx line 270)
// "200 meets 32ECT specs, but 32ECT does not meet 200 specs"
const ECT_GRADE_FALLBACK = {
  "ECT 23": "125", "ECT 26": "150", "ECT 29": "175", "ECT 32": "200",
  "ECT 40": "250", "ECT 44": "275", "ECT 55": "350",
};

export default function ItemSetupSec({ result }) {
  const { active, sec, toggleSec, setField, setManyFields, pushToast } = useQuote();
  const s = active?.state || {};
  const r = result || {};
  // Legacy parity (spot_r1_5.jsx L5876, L6084, L4149): when the engine returns
  // route="Saber + D/C" but the user hasn't manually enabled Saber, the badges
  // and Quote Table show "CAD" instead. Cost Buildup keeps the raw "Saber + D/C"
  // label so production knows the actual cutter path.
  const route = ((r.route === "Saber + D/C" && s.saber !== "Yes") ? "CAD" : (r.route || "—"));
  const fullyResolved = !!(r && !r.error && r.sheetW);
  const corrFlipped = !!s.corrFlipped;

  const onBoxStyle = (style) => {
    const cur = s.boxStyle === style ? "" : style;
    const descs = { RSC: "Regular Slotted Container", FOL: "Full Overlap Slotted Container",
      "D/C Tray": "Die Cut Tray", Mailer: "Mailer", "5PF": "Five Panel Folder" };
    const patch = { boxStyle: cur };
    // Always overwrite item desc when a box-style tile is clicked (legacy behavior).
    if (cur) patch.itemDesc = descs[cur];
    if (cur === "RSC" || cur === "Mailer") {
      patch.handGluing = "Yes"; patch.jointsPerPiece = "1"; patch.tape = "No";
    }
    setManyFields(patch);
  };

  const onFlipCorr = () => {
    const w = s.oneUpW, l = s.oneUpL;
    setManyFields({ oneUpW: l, oneUpL: w, corrFlipped: !corrFlipped });
  };

  // ─── Die auto-handler (legacy spot_r1_5.jsx L3863-3883) ───────────────
  // CAD route needs no die. Crest/Bobst route needs a steel rule die — auto-add
  // a default cost ($1,200 Crest / $1,800 Bobst). On route → CAD, clear die.
  const dieAutoRef = useRef({ savedTreatment: null, isAutoNone: false, lastItemKey: null });
  const anyDieRoute = route === "Crest" || route === "Bobst";
  const anyBobst = route === "Bobst";
  // Don't run during MP-Fulfillment items — they have no die at all
  const isFulfillment = s.itemType === "Fulfillment";
  // Track which BOM item we're operating on so we don't carry one component's
  // auto-cleared state into another's evaluation.
  const itemKey = `${active?.id || ""}-${s.activeItemIdx ?? 0}`;

  useEffect(() => {
    if (isFulfillment) return;
    if (route === "—" || !route) return;  // wait until engine has priced this component
    const da = dieAutoRef.current;
    // Reset memory when switching to a different BOM tab — each component has
    // its own die state, don't carry over the previous tab's auto-clear flag.
    if (da.lastItemKey !== itemKey) {
      da.savedTreatment = null;
      da.isAutoNone = false;
      da.lastItemKey = itemKey;
    }
    const dieLabel = anyBobst ? "Bobst" : "Crest";
    const dieDefault = anyBobst ? "1800" : "1200";
    const currentTreat = s.dieTreatment || "None";
    const currentCost = Number(s.cuttingDieCost || 0);

    // Route → CAD: clear die (save user's prior choice for restore)
    if (!anyDieRoute && !da.isAutoNone && currentTreat !== "None") {
      da.savedTreatment = currentTreat;
      da.isAutoNone = true;
      setField("dieTreatment", "None");
      pushToast && pushToast("Die cleared — CAD routing, no steel die needed", "ok");
      return;
    }
    // Route → Crest/Bobst AFTER we auto-cleared: restore user's prior treatment
    if (anyDieRoute && da.isAutoNone) {
      const restore = da.savedTreatment || "Separate Line";
      da.isAutoNone = false;
      da.savedTreatment = null;
      if (currentTreat !== restore) setField("dieTreatment", restore);
      pushToast && pushToast(`Die added — ${dieLabel} routing requires a steel die`, "ok");
      return;
    }
    // Route → Crest/Bobst, user has no treatment AND no cost yet — auto-add default
    if (anyDieRoute && !da.isAutoNone && currentTreat === "None" && currentCost <= 0) {
      setManyFields({ dieTreatment: "Separate Line", cuttingDieCost: dieDefault });
      pushToast && pushToast(
        `Die added — ${dieLabel} routing requires a steel die ($${dieDefault} default)`,
        "ok"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDieRoute, anyBobst, isFulfillment, route, itemKey]);

  // ─── Auto-flip corrugation (legacy spot_r1_5.jsx L3941-3957) ──────────
  // Engine reports `_pipeline.exceedsSheetLibrary` when the current oneUpW/L
  // doesn't fit any approved sheet (forced to CUSTOM-OVERSIZE) — legacy uses
  // this as the trigger to TRY a flipped orientation. We swap state and let
  // the next engine call validate; if the swap doesn't help, the user can
  // manually un-flip via the Flip Corr button.
  // Guards: ref-tracked W/L pair so manual un-flip doesn't immediately re-flip.
  const autoFlipRef = useRef({ flippedAtW: null, flippedAtL: null });
  useEffect(() => {
    if (corrFlipped) return;  // already flipped — don't override
    const _buyMinActive = !!r?.buyMinActive;
    const hasIssue = !!(r && (
      r._pipeline?.exceedsSheetLibrary ||
      (r.boardHasPrice && !r.boardMeetMin && !_buyMinActive)
    ));
    if (!hasIssue) return;
    const w = String(s.oneUpW || "");
    const l = String(s.oneUpL || "");
    if (!w || !l || w === "0" || l === "0") return;
    // If state.W/L matches what we LAST auto-flipped FROM, the user just
    // manually un-flipped — respect that decision and don't re-flip.
    if (autoFlipRef.current.flippedAtW === w && autoFlipRef.current.flippedAtL === l) return;
    autoFlipRef.current = { flippedAtW: w, flippedAtL: l };
    setManyFields({ oneUpW: l, oneUpL: w, corrFlipped: true });
    pushToast && pushToast("Corr direction auto-flipped — piece fits stock sheets. Verify with customer.", "ok");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?._pipeline?.exceedsSheetLibrary, r?.boardHasPrice, r?.boardMeetMin, r?.buyMinActive, corrFlipped]);

  // Reset the auto-flip memory when board spec changes (so a new pair of W/L
  // can be auto-flipped again).
  useEffect(() => {
    autoFlipRef.current = { flippedAtW: null, flippedAtL: null };
  }, [s.boardGrade, s.flute, s.outsideLiner, s.insideLiner, s.medium]);

  return (
    <Sec label="Item Setup" hue="#3b82f6" open={sec.qty} onToggle={() => toggleSec("qty")}
      badge={fullyResolved ? "READY" : !s.oneUpW || !s.oneUpL ? null : "ATTENTION"}
      accent={fullyResolved} warn={!fullyResolved && s.oneUpW && s.oneUpL}
      data-testid="sec-item-setup">

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Left column: identity + dims + board */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Identity row */}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 6 }}>
            <F l="Customer Ident">
              <input className="sp-input" value={s.custIdent || ""}
                data-testid="input-cust-ident"
                placeholder="Customer SKU / part #"
                onChange={(e) => setField("custIdent", e.target.value)}
                style={{ width: 220 }} />
            </F>
            <F l="Item Description">
              <input className="sp-input" value={s.itemDesc || ""}
                data-testid="input-item-desc"
                onChange={(e) => setField("itemDesc", e.target.value)}
                style={{ width: 220 }} />
            </F>
            {BOX_STYLES.map((bs) => (
              <Tile key={bs} label={bs} active={s.boxStyle === bs}
                data-testid={`tile-box-${bs.replace(/[^a-zA-Z0-9]/g, '')}`}
                onClick={() => onBoxStyle(bs)} small />
            ))}
          </div>

          {/* Dimensions row */}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 3 }}>
              <Tile label="One-Up"     active={s.quoteMode === "One-Up"}     onClick={() => setField("quoteMode", "One-Up")}     small data-testid="tile-mode-oneup" />
              <Tile label="Sheet Size" active={s.quoteMode === "Sheet Size"} onClick={() => setField("quoteMode", "Sheet Size")} small data-testid="tile-mode-sheetsize" />
            </div>
            {s.quoteMode !== "Sheet Size" ? (
              <>
                <F l="Width"><Num value={s.oneUpW} onChange={(v) => setField("oneUpW", v)} step="0.0001" min="0" data-testid="input-one-up-w" /></F>
                <F l="Length"><Num value={s.oneUpL} onChange={(v) => setField("oneUpL", v)} step="0.0001" min="0" data-testid="input-one-up-l" /></F>
                {/* Flip Corr — ALWAYS visible per legacy spot_r1_5.jsx */}
                <button onClick={onFlipCorr} data-testid="btn-flip-corr"
                  title="Swap Width ↔ Length (changes corrugation direction — requires customer approval)"
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    padding: "5px 8px", borderRadius: 4,
                    color: corrFlipped ? "var(--spot-err)" : "var(--spot-text3)",
                    background: corrFlipped ? "var(--spot-err-bg)" : "transparent",
                    border: `1px solid ${corrFlipped ? "var(--spot-err)" : "var(--spot-border)"}`,
                    whiteSpace: "nowrap",
                  }}>
                  {corrFlipped ? "⇄ CORR FLIPPED" : "⇄ Flip Corr"}
                </button>
              </>
            ) : (
              <>
                <F l="Sheet W"><Num value={s.sheetSizeW} onChange={(v) => setField("sheetSizeW", v)} step="0.0001" data-testid="input-sheet-w" /></F>
                <F l="Sheet L"><Num value={s.sheetSizeL} onChange={(v) => setField("sheetSizeL", v)} step="0.0001" data-testid="input-sheet-l" /></F>
                <F l="Pcs/Sh"><Num value={s.sheetPcsPerSheet} onChange={(v) => setField("sheetPcsPerSheet", v)} step="1" min="1" style={{ width: 55 }} data-testid="input-pcs-sheet" /></F>
              </>
            )}
            <button data-testid="btn-sheet-library"
              onClick={() => window.dispatchEvent(new CustomEvent("spot:open-sheet-library"))}
              style={{
              all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
              padding: "5px 12px", borderRadius: 4, background: "var(--spot-accent-soft)",
              color: "var(--spot-accent)", border: "1px solid var(--spot-accent)",
              whiteSpace: "nowrap",
            }}>Sheet Library</button>

            {/* Layout summary chip */}
            {fullyResolved && (
              <div data-testid="layout-summary" style={{ display: "flex", gap: 6, alignItems: "center",
                fontSize: 12, marginLeft: 4, flexWrap: "nowrap" }}>
                <span style={{ fontWeight: 700, color: "var(--spot-text)", fontFamily: "'JetBrains Mono',monospace" }}>
                  {r.numUp}×{r.numOut}
                </span>
                <span style={{ color: "var(--spot-text2)" }}>→</span>
                <span style={{ fontWeight: 700, color: "var(--spot-accent)" }}>{r.pcsPerSheet} out</span>
                <span style={{ color: "var(--spot-text3)" }}>on</span>
                <span style={{ fontWeight: 600 }}>{fmtNum(r.sheetW, 4)}×{fmtNum(r.sheetL, 4)}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                  background: `${routeColor(route)}22`, color: routeColor(route),
                }}>{s.routeOverride ? "" : "auto → "}{route}</span>
                {/* ORDER badge (legacy spot_r1_5.jsx L5889): shown when the auto-selected
                    sheet is a CUSTOM order (not stock). */}
                {(r._pipeline?.customOrder && !r._pipeline?.stockMode) && (
                  <span data-testid="sheet-order-badge" style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: "#3b82f618", color: "#3b82f6",
                  }}>ORDER</span>
                )}
                <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>Waste: {fmtPct(r.wastePct, 1)}</span>
              </div>
            )}
          </div>

          {/* Board Status Bar */}
          <BoardStatusBar s={s} r={r} setField={setField} />
        </div>

        {/* Right column: One-Time Costs panel */}
        <OneTimeCosts s={s} setField={setField} setManyFields={setManyFields} route={route} />
      </div>
    </Sec>
  );
}

function routeColor(rt) {
  if (rt === "CAD") return "#3b82f6";
  if (rt === "Crest") return "#f59e0b";
  if (rt === "Bobst") return "#a855f7";
  if (rt === "Saber+DC" || rt === "Saber→D/C") return "#22c55e";
  return "#6b7280";
}

function BoardStatusBar({ s, r, setField }) {
  // setManyFields is used for accept/force-substitution to atomically update
  // multiple board-spec fields. Pull from context directly since the parent
  // only forwards setField.
  const { setManyFields } = useQuote();
  const [tilesOpen, setTilesOpen] = React.useState(false);
  // Liners allowed for the current board grade (legacy spot_r1_5.jsx L265).
  // 33# Kla-White → only 175/ECT 32. 56# Kla-White → only 250.
  const allowed = React.useMemo(() => allowed_liners(s.boardGrade), [s.boardGrade]);
  // Approved-stock liners for the current grade/flute/medium combo (legacy L5983).
  const [avail, setAvail] = React.useState({ outside: new Set(), inside: new Set() });
  // Approved-stock GRADES for the current flute/medium combo (legacy GRADE dots).
  const [gradeAvail, setGradeAvail] = React.useState({ stocked: new Set(), viaFallback: new Set() });
  React.useEffect(() => {
    if (!s.boardGrade || !s.flute) return;
    let cancelled = false;
    sheetAvailability({ boardGrade: s.boardGrade, flute: s.flute, medium: s.medium || "None" })
      .then((d) => { if (!cancelled) setAvail({
        outside: new Set(d.outside || []), inside: new Set(d.inside || []),
      }); })
      .catch(() => { if (!cancelled) setAvail({ outside: new Set(), inside: new Set() }); });
    return () => { cancelled = true; };
  }, [s.boardGrade, s.flute, s.medium]);
  React.useEffect(() => {
    if (!s.flute) return;
    let cancelled = false;
    gradeAvailability({ flute: s.flute, medium: s.medium || "None" })
      .then((d) => { if (!cancelled) setGradeAvail({
        stocked: new Set(d.stocked || []), viaFallback: new Set(d.viaFallback || []),
      }); })
      .catch(() => { if (!cancelled) setGradeAvail({ stocked: new Set(), viaFallback: new Set() }); });
    return () => { cancelled = true; };
  }, [s.flute, s.medium]);
  // Auto-correct: if the persisted liner is NOT in the allowed list for the current
  // grade (e.g., quote saved with 33# Kla-White then grade changed to 200), snap
  // it to a sensible default. Matches legacy "setOutsideLiner('42# Kla-White')" cleanup.
  React.useEffect(() => {
    if (s.outsideLiner && !allowed.includes(s.outsideLiner)) {
      const fallback = allowed.includes("42# Kla-White") ? "42# Kla-White"
        : (allowed.includes("42# Kemi-Lite") ? "42# Kemi-Lite" : "None");
      setField("outsideLiner", fallback);
    }
    if (s.insideLiner && !allowed.includes(s.insideLiner)) {
      const fallback = allowed.includes("42# Kla-White") ? "42# Kla-White"
        : (allowed.includes("42# Kemi-Lite") ? "42# Kemi-Lite" : "None");
      setField("insideLiner", fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);
  // Legacy fmLnr (spot_r1_5.jsx L1218): "None" → "Kraft", strip weight prefix + "-Lite"/"-White"
  const fmLnr = (l) => (!l || l === "None") ? "Kraft"
    : String(l).replace(/^\d+#\s*/, "").replace("-Lite", "").replace("-White", "");
  const olShort = fmLnr(s.outsideLiner);
  const ilShort = fmLnr(s.insideLiner);
  // ─── D-070 Board Status Bar: SPEC vs RUNNING + substitution decision UX ───
  // Verbatim port of legacy spot_r1_5.jsx L5894-5970.
  const fmMed = (m) => !m || m === "None" ? "Std wt"
    : String(m).replace("# Medium", "#").replace("# Bleached Medium", "# Bl");
  const hasFb = !!(r?.gradeFallback || r?.mediumFallback);
  const specGrade = s.boardGrade;
  const runGrade = r?.gradeFallback || s.boardGrade;
  const specMed = s.medium || "None";
  const medChanged = r?.mediumFallback;
  const runMed = medChanged?.medium || "None";
  const isAccepted = s.boardSubstitution === "accepted";
  const isForced = s.boardSubstitution === "forced";
  const needsDecision = hasFb && !s.boardSubstitution;
  const buyMinActive = !!r?.buyMinActive;
  const buyMinSheets = r?.buyMinSheets;
  const actualSheets = r?.sheetsReq;
  const belowMin = !!(r && r.boardHasPrice && !r.boardMeetMin && !buyMinActive);
  const machineCapacityFail = !!(r?.exceedsMachineCapacity);
  const exceedsSheetLib = !!(r?.exceedsSheetLibrary);

  const acceptSub = () => {
    // Write the substituted grade/medium back to the selectors so the UI
    // tiles reflect what the engine is actually running. Without this the
    // selectors stay on the spec values and the user sees a desync.
    const patch = { boardSubstitution: "accepted", fallbackAccepted: true };
    if (r?.gradeFallback) patch.boardGrade = r.gradeFallback;
    if (r?.mediumFallback?.medium) patch.medium = r.mediumFallback.medium;
    setManyFields(patch);
    setTilesOpen(false);
  };
  const forceSub = () => {
    // Same write-back; "forced" additionally requires Buy Min mode for the
    // stock to be ordered at mill-min quantities.
    const patch = { boardSubstitution: "forced", fallbackAccepted: true, buyMinBoard: "Yes" };
    if (r?.gradeFallback) patch.boardGrade = r.gradeFallback;
    if (r?.mediumFallback?.medium) patch.medium = r.mediumFallback.medium;
    setManyFields(patch);
    setTilesOpen(false);
  };
  const revertToStock = () => { setField("boardSubstitution", "accepted"); setField("buyMinBoard", "Auto"); setTilesOpen(false); };

  const med = s.medium || "None";
  const specLine = `${s.boardGrade || "—"} · ${s.flute || "—"} · ${olShort}/${ilShort}${med !== "None" ? " · " + fmMed(med) : ""}`;
  const runMedLabel = isForced && medChanged ? fmMed(specMed) : (medChanged ? fmMed(runMed) : (specMed !== "None" ? fmMed(specMed) : ""));
  const runLine = `${runGrade}${hasFb ? " · " + s.flute + " · " + olShort + "/" + ilShort : ""}${runMedLabel ? " · " + runMedLabel : ""}`;

  const isStock = !!r?.stockMode;
  const isCustom = !!r?.customOrder && !isStock;
  const sheetInfo = r?.sheetW ? `${fmtNum(r.sheetW, 4)}×${fmtNum(r.sheetL, 4)}` : null;

  // Banner background/border per state
  const bannerBg = needsDecision ? "#f59e0b08"
    : hasFb ? (isAccepted ? "var(--spot-green-soft)" : isForced ? "#3b82f608" : "var(--spot-bg3)")
    : "var(--spot-bg3)";
  const bannerBorder = needsDecision ? "#f59e0b44"
    : hasFb ? (isAccepted ? "#22c55e33" : isForced ? "#3b82f633" : "var(--spot-border)")
    : "var(--spot-border)";

  return (
    <div data-testid="board-status-bar" style={{ borderTop: "1px solid var(--spot-line)", paddingTop: 4 }}>
      <div style={{
        background: bannerBg, border: `1px solid ${bannerBorder}`,
        borderRadius: 6, padding: "8px 12px", marginBottom: 4,
      }}>
        {/* Row 1: SPEC (or BOARD if no fallback) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: hasFb ? "#9ca3af" : "var(--spot-text3)",
            textTransform: "uppercase", letterSpacing: ".04em", minWidth: 50 }}>{hasFb ? "SPEC" : "BOARD"}</span>
          <span style={{ fontWeight: 700, color: "var(--spot-text)" }}>{specLine}</span>
          {!hasFb && isStock && sheetInfo && (
            <span className="sp-badge sp-badge-green" data-testid="board-stock-badge">IN STOCK</span>
          )}
          {!hasFb && isCustom && (
            <span className="sp-badge sp-badge-blue" data-testid="board-order-badge">ORDER</span>
          )}
          {!hasFb && sheetInfo && (
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {sheetInfo} · {r.pcsPerSheet} out · {fmtPct(r.wastePct, 1)} waste
            </span>
          )}
        </div>

        {/* Row 2: RUNNING (only when fallback) */}
        {hasFb && (
          <div data-testid="board-running-row"
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, marginTop: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700,
              color: isAccepted ? "#22c55e" : isForced ? "#3b82f6" : "#f59e0b",
              textTransform: "uppercase", letterSpacing: ".04em", minWidth: 50 }}>RUNNING</span>
            <span style={{ fontWeight: 700, color: "var(--spot-text)" }}>{runLine}</span>
            {isStock && <span className="sp-badge sp-badge-green">IN STOCK</span>}
            {isCustom && <span className="sp-badge sp-badge-blue">{isForced ? "CUSTOM ORDER" : "ORDER"}</span>}
            {sheetInfo && <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {sheetInfo} · {r.pcsPerSheet} out · {fmtPct(r.wastePct, 1)} waste
            </span>}
          </div>
        )}

        {/* Fallback notes */}
        {hasFb && r?.gradeFallback && (
          <div style={{ fontSize: 11, color: "var(--spot-text3)", marginTop: 2, paddingLeft: 58 }}>
            {runGrade}# meets {specGrade} spec{r?.mullenUpgrade ? " (Mullen upgrade)" : ""}
          </div>
        )}
        {hasFb && medChanged && !isForced && (
          <div style={{ fontSize: 11, marginTop: 1, paddingLeft: 58,
            color: medChanged.isHigher ? "var(--spot-text3)" : "#f59e0b" }}>
            {medChanged.isHigher ? "Stock has heavier medium — meets spec" : "Medium not in stock — running standard weight"}
          </div>
        )}

        {/* Buy Min readout */}
        {buyMinActive && buyMinSheets && (
          <div data-testid="board-buy-min-info"
            style={{ display: "flex", gap: 8, alignItems: "center",
              fontSize: 11, color: "#22c55e", fontWeight: 600, marginTop: 2, paddingLeft: 58 }}>
            <span>✓ Buy Min — purchasing {fmtInt(buyMinSheets)} sheets, using {fmtInt(actualSheets || 0)}</span>
            {/* Legacy parity (spot_r1_5.jsx L5994): inline "× Turn off Buy Min" so the
                user doesn't have to open the Edit board tile editor to disable it. */}
            <button onClick={(e) => { e.stopPropagation(); setField("buyMinBoard", "No"); }}
              data-testid="board-turn-off-buy-min-inline-btn"
              style={{
                all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                padding: "2px 8px", borderRadius: 3,
                color: "#ef4444", background: "#ef444418", border: "1px solid #ef444444",
              }}>
              × Turn off Buy Min
            </button>
          </div>
        )}
        {belowMin && s.buyMinBoard !== "Yes" && (
          <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, marginTop: 2, paddingLeft: 58 }}>
            Below minimum board order{s.buyMinBoard === "No" ? "" : " — will auto-enable Buy Min"}
          </div>
        )}

        {/* Machine capacity */}
        {machineCapacityFail && (
          <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 3, paddingLeft: 58 }}>
            ⛔ Too large for any machine — cannot manufacture
          </div>
        )}
        {exceedsSheetLib && !machineCapacityFail && (
          <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, marginTop: 2, paddingLeft: 58 }}>
            ⚠ Larger than any stock sheet — custom board order needed
          </div>
        )}

        {/* Decision-needed UI */}
        {needsDecision && (
          <div data-testid="board-decision-needed"
            style={{ marginTop: 6, padding: "6px 10px", background: "#f59e0b11",
              borderRadius: 4, border: "1px solid #f59e0b33" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>
              ⚠ Board substitution — {r?.gradeFallback ? "grade" : "medium"} changed from spec
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={acceptSub} data-testid="board-accept-sub-btn"
                style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  padding: "5px 12px", borderRadius: 4, background: "#22c55e", color: "#fff" }}>
                Accept substitution
              </button>
              <button onClick={forceSub} data-testid="board-force-spec-btn"
                style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  padding: "5px 12px", borderRadius: 4, background: "#3b82f6", color: "#fff" }}>
                Force spec'd board
              </button>
              <button onClick={() => setTilesOpen(true)} data-testid="board-edit-tiles-btn"
                style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  padding: "5px 12px", borderRadius: 4, color: "var(--spot-text3)",
                  border: "1px solid var(--spot-border)" }}>
                Edit tiles
              </button>
            </div>
          </div>
        )}

        {/* Accepted flag */}
        {isAccepted && hasFb && (
          <div data-testid="board-accepted-flag"
            style={{ fontSize: 11, fontWeight: 600, color: "#22c55e", marginTop: 4, paddingLeft: 58 }}>
            ✓ Substitution approved — {runGrade}# meets {specGrade} spec
            {medChanged ? " · " + (!medChanged.isHigher
              ? `standard weight (${fmMed(specMed)} unavailable)`
              : "heavier medium meets spec") : ""}
          </div>
        )}

        {/* Forced flag with Buy Min cost adder */}
        {isForced && hasFb && (
          <div data-testid="board-forced-flag"
            style={{ fontSize: 11, fontWeight: 600, color: "#3b82f6", marginTop: 4, paddingLeft: 58 }}>
            ℹ Spec'd board · {buyMinActive && buyMinSheets && r?.boardTotal ? (() => {
              const perPcAdd = (r.boardTotal - (actualSheets * (r.boardTotal / buyMinSheets))) / (actualSheets * (r.pcsPerSheet || 1));
              return `Buy Min ${fmtMoney(perPcAdd)}/pc · `;
            })() : ""}3-5 day lead time
          </div>
        )}

        {/* Footer toggle */}
        <div onClick={() => setTilesOpen((v) => !v)} data-testid="board-toggle-tiles"
          style={{
            display: "flex", gap: 8, alignItems: "center", marginTop: 4, paddingTop: 4,
            borderTop: "1px solid var(--spot-line)", cursor: "pointer", userSelect: "none",
          }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--spot-accent)" }}>
            {tilesOpen ? "Close" : "Edit board"}
          </span>
          <span onClick={(e) => { e.stopPropagation(); setField("fscEnabled", !s.fscEnabled); }}
            data-testid="board-fsc-toggle"
            style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
              background: s.fscEnabled ? "var(--spot-green-soft)" : "transparent",
              color: s.fscEnabled ? "var(--spot-green)" : "var(--spot-text3)",
              border: `1px solid ${s.fscEnabled ? "var(--spot-green)" : "var(--spot-border)"}`,
            }}>
            {s.fscEnabled ? `✓ FSC $${s.fscFee || 25}` : "FSC"}
          </span>
          {hasFb && isAccepted && (
            <span onClick={(e) => { e.stopPropagation(); forceSub(); }}
              data-testid="board-force-orig-link"
              style={{ fontSize: 11, fontWeight: 600, color: "#3b82f6", cursor: "pointer" }}>
              Force original spec
            </span>
          )}
          {hasFb && isForced && (
            <span onClick={(e) => { e.stopPropagation(); revertToStock(); }}
              data-testid="board-use-stock-link"
              style={{ fontSize: 11, fontWeight: 600, color: "#22c55e", cursor: "pointer" }}>
              Use stock option
            </span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: 11, color: "var(--spot-text3)",
            transform: tilesOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s",
          }}>▸</span>
        </div>
      </div>

      {tilesOpen && (
        <div style={{ padding: "6px 0 2px", display: "flex", flexDirection: "column", gap: 6 }} data-testid="board-tiles">
          <F l="Flute" inline fw={60}>
            <div style={{ display: "flex", gap: 2 }}>
              {FLUTES.map((f) => {
                // Green dot = stock-eligible singlewall flutes per legacy SPC sheet library
                const isStock = ["B", "C", "E"].includes(f);
                return (
                  <Tile key={f} label={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {isStock && <span style={{ width: 5, height: 5, borderRadius: 3,
                        background: "var(--spot-green)" }} />}
                      {f}
                    </span>
                  } active={s.flute === f}
                    data-testid={`tile-flute-${f.replace('/', '')}`}
                    onClick={() => setField("flute", f)} small />
                );
              })}
            </div>
          </F>
          <F l="Grade" inline fw={60}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
                {getGradesForFlute(s.flute).map((g) => {
                  const directStock = gradeAvail.stocked.has(g);
                  const viaFallback = gradeAvail.viaFallback.has(g);
                  const stockColor = directStock ? "var(--spot-green)"
                    : viaFallback ? "#f59e0b" : null;
                  const stockTitle = directStock ? `${g} (in stock for ${s.flute} flute)`
                    : viaFallback ? `${g} (substitutes to Mullen equiv — in stock)`
                    : `${g} (not stocked for ${s.flute} flute — custom order)`;
                  return (
                    <span key={g} title={stockTitle} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <Tile label={g.replace("#", "")} active={s.boardGrade === g}
                        data-testid={`tile-grade-${g.replace(/\s+/g, '').replace('#', '')}`}
                        onClick={() => setField("boardGrade", g)} small />
                      {stockColor && (
                        <span data-testid={`grade-dot-${g.replace(/\s+/g, '').replace('#', '')}`}
                          style={{ width: 5, height: 5, borderRadius: 3, background: stockColor, marginLeft: -2 }} />
                      )}
                    </span>
                  );
                })}
              </div>
              {/* Mullen-equiv note — only when an ECT grade IS selected, to the RIGHT of the tiles */}
              {ECT_GRADE_FALLBACK[s.boardGrade] && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#f59e0b",
                  whiteSpace: "nowrap", paddingLeft: 4,
                }} data-testid="mullen-equiv-note" title="ECT grades substitute DOWN to Mullen stock (Rule 4)">
                  → {ECT_GRADE_FALLBACK[s.boardGrade]}# Mullen equiv
                </span>
              )}
              {s.boardGrade === "NT" && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#f59e0b",
                  whiteSpace: "nowrap", paddingLeft: 4,
                }} data-testid="mullen-equiv-note" title="NT runs on Mullen 200# stock">
                  → 200# Mullen equiv
                </span>
              )}
            </div>
          </F>
          <F l="Outside" inline fw={60}>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {allowed.map((l) => {
                const hasStock = avail.outside.has(l);
                const text = l === "None" ? "Kraft" : l.replace("42# ", "").replace("33# ", "").replace("56# ", "");
                return (
                  <Tile key={l}
                    label={<span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {text}
                      {hasStock && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--spot-green)" }} />}
                    </span>}
                    active={s.outsideLiner === l}
                    data-testid={`tile-outside-${l.replace(/[^a-zA-Z0-9]/g, '')}`}
                    title={hasStock ? `${l} (stock sheets available)` : `${l} (no stock — custom order)`}
                    onClick={() => setField("outsideLiner", l)} small />
                );
              })}
            </div>
          </F>
          <F l="Inside" inline fw={60}>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {allowed.map((l) => {
                const hasStock = avail.inside.has(l);
                const text = l === "None" ? "Kraft" : l.replace("42# ", "").replace("33# ", "").replace("56# ", "");
                return (
                  <Tile key={l}
                    label={<span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {text}
                      {hasStock && <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--spot-green)" }} />}
                    </span>}
                    active={s.insideLiner === l}
                    data-testid={`tile-inside-${l.replace(/[^a-zA-Z0-9]/g, '')}`}
                    title={hasStock ? `${l} (stock sheets available)` : `${l} (no stock — custom order)`}
                    onClick={() => setField("insideLiner", l)} small />
                );
              })}
            </div>
          </F>
          <F l="Medium" inline fw={60}>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
              {MEDIUMS.map((m) => (
                <Tile key={m} label={m === "None" ? "None" : m.replace("# Medium", "#").replace("# Bleached Medium", "# Bl")}
                  active={s.medium === m}
                  data-testid={`tile-medium-${m.replace(/[^a-zA-Z0-9]/g, '')}`}
                  onClick={() => setField("medium", m)} small />
              ))}
              <span style={{ width: 1, height: 16, background: "var(--spot-border)", margin: "0 4px" }} />
              <Tile label="Off" active={!s.fscEnabled}  onClick={() => setField("fscEnabled", false)} small data-testid="tile-fsc-off" />
              <Tile label="FSC" active={s.fscEnabled}    onClick={() => setField("fscEnabled", true)}  small data-testid="tile-fsc-on" />
              {/* D-070 Buy Min toggle buttons (legacy spot_r1_5.jsx L5994-5995) */}
              {belowMin && s.buyMinBoard !== "Yes" && (
                <button onClick={() => setField("buyMinBoard", "Yes")}
                  data-testid="board-buy-min-amortize-btn"
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    padding: "5px 12px", borderRadius: 4, marginLeft: 6,
                    color: "#f59e0b", background: "#f59e0b22", border: "1px solid #f59e0b44",
                  }}>
                  Buy Min — amortize
                </button>
              )}
              {buyMinActive && (
                <button onClick={() => setField("buyMinBoard", "No")}
                  data-testid="board-turn-off-buy-min-btn"
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    padding: "5px 10px", borderRadius: 4, marginLeft: 6,
                    color: "#ef4444", background: "#ef444418", border: "1px solid #ef444444",
                  }}>
                  × Turn off Buy Min
                </button>
              )}
            </div>
          </F>
        </div>
      )}
    </div>
  );
}

function OneTimeCosts({ s, setField, setManyFields, route }) {
  const anyDieRoute = route === "Crest" || route === "Bobst";
  const setMisc = (idx, patch) => {
    setField("miscCharges", (s.miscCharges || []).map((c, i) => i === idx ? { ...c, ...patch } : c));
  };
  const addMisc = () => setField("miscCharges", [...(s.miscCharges || []), { id: "mc_" + Date.now(), name: "", cost: "0", treatment: "Separate Line" }]);
  const rmMisc = (idx) => setField("miscCharges", (s.miscCharges || []).filter((_, i) => i !== idx));

  return (
    <div data-testid="one-time-costs" style={{
      flexShrink: 0, width: 360, background: "var(--spot-bg3)",
      border: "1px solid var(--spot-border)", borderRadius: 5, padding: "8px 10px",
      alignSelf: "flex-start",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em",
        color: "var(--spot-text3)", marginBottom: 6,
      }}>One-Time Costs</div>

      {/* Prepress — ports legacy spot_r1_5.jsx L6024-6053 */}
      {s.printReq === "Yes" && (() => {
        const isMP = s.quoteType === "Multi-Part" && (s.bomItems || []).length > 0;
        const pScope = s.prepressScope || "Per Item";
        const pNone = isMP && pScope === "None";
        const pPerJob = isMP && pScope === "Per Job";
        // pAlloc: allocated share of jobPrepressCost for active item at selected slot
        // (will be wired through engine results later; for now show "pending setup" if missing)
        const pAlloc = 0;
        // Case 1: scope = None
        if (pNone) {
          return (
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text2)", width: 54, flexShrink: 0 }}>Prepress</span>
              <span style={{ fontSize: 13, color: "var(--spot-text3)" }} data-testid="prepress-otc-none">None</span>
            </div>
          );
        }
        // Case 2: scope = Per Job (Lot)
        if (pPerJob) {
          const treat = s.jobPrepressTreatment || "Separate Line";
          if (treat === "None") {
            return (
              <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text2)", width: 54, flexShrink: 0 }}>Prepress</span>
                <span style={{ fontSize: 13, color: "var(--spot-text3)" }}>None (Lot)</span>
              </div>
            );
          }
          return (
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 5 }} data-testid="prepress-otc-lot">
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--spot-text2)", width: 54, flexShrink: 0 }}>Prepress</span>
              <span style={{ fontSize: 13, color: "var(--spot-text3)" }}>Lot</span>
              {pAlloc > 0 ? (
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--spot-text)", marginLeft: "auto" }}>
                  ${Number(pAlloc).toFixed(2)}
                </span>
              ) : (
                <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--spot-text3)", marginLeft: "auto" }}>
                  pending setup
                </span>
              )}
            </div>
          );
        }
        // Case 3: scope = Per Item (default) — full per-item treatment tiles
        return (
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-text2)", width: 54, flexShrink: 0 }}>Prepress</span>
            <Tile label="Auto"  active={s.prepressTreatment === "Auto"}           onClick={() => setField("prepressTreatment", "Auto")} small tint="#22c55e" data-testid="tile-prepress-auto" />
            <Tile label="None"  active={s.prepressTreatment === "None"}           onClick={() => setField("prepressTreatment", "None")} small data-testid="tile-prepress-none" />
            <Tile label="Line"  active={s.prepressTreatment === "Separate Line"}  onClick={() => setField("prepressTreatment", "Separate Line")} small data-testid="tile-prepress-line" />
            <Tile label="Amort" active={s.prepressTreatment === "Amortize"}       onClick={() => setField("prepressTreatment", "Amortize")} small data-testid="tile-prepress-amort" />
            {s.prepressTreatment === "Auto" && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--spot-text3)", opacity: 0.5, padding: "4px 6px" }}>
                ${s.defaultPrepressCost || "50"} embedded
              </span>
            )}
            {s.prepressTreatment !== "None" && s.prepressTreatment !== "Auto" && (
              <Num
                value={s.prepressCost}
                onChange={(v) => setField("prepressCost", v)}
                step="0.01" min="0"
                style={{ width: 58, padding: "4px 5px", fontSize: 12 }}
                data-testid="input-prepress-cost" />
            )}
          </div>
        );
      })()}

      {/* Die — only when route requires it (Crest/Bobst), per legacy L6055. */}
      {anyDieRoute && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-text2)", width: 54, flexShrink: 0 }}>Die</span>
          <Tile label="None"  active={s.dieTreatment === "None"}          onClick={() => setField("dieTreatment", "None")} small data-testid="tile-die-none" />
          <Tile label="Line"  active={s.dieTreatment === "Separate Line"} onClick={() => setField("dieTreatment", "Separate Line")} small data-testid="tile-die-line" />
          <Tile label="Amort" active={s.dieTreatment === "Amortize"}      onClick={() => setField("dieTreatment", "Amortize")} small data-testid="tile-die-amort" />
          {s.dieTreatment !== "None" && (
            <Num value={s.cuttingDieCost} onChange={(v) => setField("cuttingDieCost", v)} step="0.01" min="0" style={{ width: 58, padding: "4px 5px", fontSize: 12 }} data-testid="input-die-cost" />
          )}
        </div>
      )}

      {/* Misc charges */}
      {(s.miscCharges || []).map((mc, mi) => (
        <div key={mc.id || mi} style={{ marginBottom: 4, padding: "3px 0",
          borderTop: mi === 0 ? "1px dashed var(--spot-border)" : "none" }} data-testid={`misc-charge-${mi}`}>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}>
            <input className="sp-input" value={mc.name || ""} placeholder="Name…"
              onChange={(e) => setMisc(mi, { name: e.target.value })}
              style={{ flex: 1, fontSize: 11, padding: "3px 6px" }} />
            {mc.treatment !== "None" && (
              <Num value={mc.cost} onChange={(v) => setMisc(mi, { cost: v })} step="0.01" min="0"
                style={{ width: 60, padding: "3px 6px", fontSize: 11 }} />
            )}
            <span onClick={() => rmMisc(mi)} data-testid={`misc-rm-${mi}`}
              style={{ fontSize: 16, fontWeight: 700, color: "var(--spot-err)", cursor: "pointer", padding: "0 4px" }}>×</span>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            <Tile label="None"  active={mc.treatment === "None"}          onClick={() => setMisc(mi, { treatment: "None" })} small />
            <Tile label="Line"  active={mc.treatment === "Separate Line"} onClick={() => setMisc(mi, { treatment: "Separate Line" })} small />
            <Tile label="Amort" active={mc.treatment === "Amortize"}      onClick={() => setMisc(mi, { treatment: "Amortize" })} small />
          </div>
        </div>
      ))}
      <button onClick={addMisc} data-testid="btn-add-misc" style={{
        all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
        color: "var(--spot-accent)", padding: "3px 0",
      }}>+ Charge</button>

      {/* AMORT method — only visible when ANY per-item cost is being amortized.
          Mirrors legacy spot_r1_5.jsx L6077. The same toggle drives die / prepress / misc
          amort math via prod.dieAmortMethod ("Markup" or "OrderMargin"). */}
      {(() => {
        const anyAmort = s.dieTreatment === "Amortize"
          || (s.printReq === "Yes" && s.prepressTreatment === "Amortize")
          || (s.miscCharges || []).some((c) => c.treatment === "Amortize")
          || (s.freightTreatment === "Amortize");
        if (!anyAmort) return null;
        return (
          <div style={{
            paddingTop: 4, marginTop: 4, borderTop: "1px solid var(--spot-border)",
            display: "flex", gap: 4, alignItems: "center",
          }} data-testid="amort-method-row">
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em" }}>AMORT</span>
            <Tile label="Markup"
              active={(s.dieAmortMethod || "Markup") === "Markup"}
              onClick={() => setField("dieAmortMethod", "Markup")}
              small data-testid="tile-amort-markup" />
            <Tile label="Order GM%"
              active={s.dieAmortMethod === "OrderMargin"}
              onClick={() => setField("dieAmortMethod", "OrderMargin")}
              small data-testid="tile-amort-ordermargin" />
          </div>
        );
      })()}
    </div>
  );
}
