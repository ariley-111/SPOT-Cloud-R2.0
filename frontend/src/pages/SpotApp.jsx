/* eslint-disable */
import React, { useState, useEffect, useRef } from "react";
import Toolbar from "../components/spot/Toolbar";
import TabBar from "../components/spot/TabBar";
import EstimateInfoSec from "../components/spot/EstimateInfoSec";
import ItemSetupSec from "../components/spot/ItemSetupSec";
import ProductionSpecsSec from "../components/spot/ProductionSpecsSec";
import QuoteTableSec from "../components/spot/QuoteTableSec";
import FilesSec from "../components/spot/FilesSec";
import { BomSec, PricingStrategySec, BoardEngineSec } from "../components/spot/Placeholders";
import RightDashboard from "../components/spot/RightDashboard";
import InitialsGate from "../components/spot/InitialsGate";
import PreviewPdfModal from "../components/spot/PreviewPdfModal";
import CostReportModal from "../components/spot/CostReportModal";
import LoadQuoteModal from "../components/spot/LoadQuoteModal";
import SheetLibraryModal from "../components/spot/SheetLibraryModal";
import QuoteHeaderModal from "../components/spot/QuoteHeaderModal";
import BomBuilderModal from "../components/spot/BomBuilderModal";
import FrozenEditWarnModal from "../components/spot/FrozenEditWarnModal";
import CloseTabPrompt from "../components/spot/CloseTabPrompt";
import { useQuote } from "../context/QuoteContext";
import { useEngine } from "../hooks/useEngine";

export default function SpotApp({ onOpenAdmin }) {
  const { active, toasts, viewOnly, viewOnlyOwner, takeOverActive, copyActive } = useQuote();
  const [modal, setModal] = useState(null);

  // ── Resizable right rail (#4) + responsive default (#3) ──
  const RW_MIN = 280, RW_MAX = 760, RW_DEF = 360;
  const [rightW, setRightW] = useState(() => {
    const saved = parseInt(localStorage.getItem("spot:rightW") || "", 10);
    if (!Number.isNaN(saved)) return Math.min(RW_MAX, Math.max(RW_MIN, saved));
    return window.innerWidth < 1440 ? 300 : RW_DEF;  // tighter default on laptops
  });
  const rightWRef = useRef(rightW); rightWRef.current = rightW;
  const startResize = (e) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const w = Math.min(RW_MAX, Math.max(RW_MIN, window.innerWidth - ev.clientX));
      setRightW(w);
    };
    const onUp = () => {
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      localStorage.setItem("spot:rightW", String(rightWRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const resetRightW = () => { setRightW(RW_DEF); localStorage.setItem("spot:rightW", String(RW_DEF)); };

  const { results, perComponent, componentPricing, jobTotals, meta, isMultiPart } = useEngine(active?.state);
  const selSlot = (active?.state?.selSlot) || 0;
  const activeItemIdx = active?.state?.activeItemIdx ?? 0;
  // For MP: the active item's pipeline result at the selected slot (so the right
  // dashboard / item setup show per-component buildup, not the aggregate row).
  const itemResult = React.useMemo(() => {
    if (!isMultiPart) return null;
    const slot = perComponent.find((p) => p.slot === selSlot) || perComponent[0];
    return slot?.items?.[activeItemIdx] || null;
  }, [isMultiPart, perComponent, selSlot, activeItemIdx]);
  // Aggregate row for the selected slot (used by Quote Table banner totals)
  const aggregate = results[selSlot] || results[0];
  // What the right dashboard + item setup show:
  //   - Simple mode: aggregate (= the single-piece per-qty result)
  //   - Multi-Part mode: the active item's per-component result so the cost
  //     buildup / route / sheet info reflect THAT component, not the job total.
  const primary = isMultiPart ? (itemResult || aggregate) : aggregate;

  // Allow Quote Table buttons to open modals
  useEffect(() => {
    const onPreview = () => setModal("preview");
    const onSheetLib = () => setModal("sheet-library");
    const onBomBuilder = () => setModal("bom-builder");
    window.addEventListener("spot:open-preview", onPreview);
    window.addEventListener("spot:open-sheet-library", onSheetLib);
    window.addEventListener("spot:open-bom-builder", onBomBuilder);
    return () => {
      window.removeEventListener("spot:open-preview", onPreview);
      window.removeEventListener("spot:open-sheet-library", onSheetLib);
      window.removeEventListener("spot:open-bom-builder", onBomBuilder);
    };
  }, []);

  return (
    <div data-testid="spot-app-root" style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--spot-bg)", overflow: "hidden",
    }}>
      <Toolbar openModal={setModal} onOpenAdmin={onOpenAdmin} onOpenBomBuilder={() => setModal("bom-builder")} />
      <TabBar />

      {/* Main + Right rail */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* MAIN COLUMN — full-width vertical stack of Secs */}
        <div data-testid="main-column" style={{
          flex: 1, minWidth: 0, overflowY: "auto",
          background: "var(--spot-bg)",
        }}>
          {viewOnly && (
            <div data-testid="view-only-banner" style={{
              position: "sticky", top: 0, zIndex: 20,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "10px 16px", background: "#f59e0b18",
              borderBottom: "1px solid #f59e0b66", color: "var(--spot-text)",
            }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b",
                textTransform: "uppercase", letterSpacing: ".08em" }}>View only</span>
              <span style={{ fontSize: 13, flex: 1, minWidth: 180 }}>
                This quote is owned by <b>{viewOnlyOwner}</b>. Take it over or make a copy to edit.
              </span>
              <button data-testid="view-only-takeover" onClick={takeOverActive}
                className="sp-btn sp-btn-sm">Take Over</button>
              <button data-testid="view-only-copy" onClick={copyActive}
                className="sp-btn sp-btn-sm sp-btn-green">Copy to my drafts</button>
            </div>
          )}
          <div data-testid="quote-sections" style={viewOnly ? {
            pointerEvents: "none", opacity: 0.55, userSelect: "none",
          } : undefined} aria-disabled={viewOnly || undefined}>
            <EstimateInfoSec />
            <BomSec />
            <ItemSetupSec result={primary} />
            <ProductionSpecsSec result={primary} />
            <QuoteTableSec results={results} componentPricing={componentPricing} jobTotals={jobTotals} meta={meta} />
            <PricingStrategySec />
            <BoardEngineSec result={primary} />
            <FilesSec />
          </div>
        </div>

        <div
          data-testid="panel-resizer"
          onMouseDown={startResize}
          onDoubleClick={resetRightW}
          title="Drag to resize · double-click to reset"
          className="sp-resizer"
        />
        <RightDashboard width={rightW} />
      </div>

      {/* Modals */}
      {modal === "preview"     && <PreviewPdfModal onClose={() => setModal(null)} />}
      {modal === "cost-report" && <CostReportModal onClose={() => setModal(null)} />}
      {modal === "load"        && <LoadQuoteModal  onClose={() => setModal(null)} />}
      {modal === "quote-header" && <QuoteHeaderModal onClose={() => setModal(null)} />}
      {modal === "sheet-library" && (
        <SheetLibraryModal
          onClose={() => setModal(null)}
          currentSheet={primary && primary.sheetW ? { w: Math.round(primary.sheetW), l: Math.round(primary.sheetL) } : null}
          overrideId={active?.state?.overrideSheetId || null}
        />
      )}
      <BomBuilderModal open={modal === "bom-builder"} onClose={() => setModal(null)} />

      {/* Frozen-quote material-edit warning (global, driven by context) */}
      <FrozenEditWarnModal />

      {/* Close-tab Save/Discard/Cancel prompt (global, driven by context) */}
      <CloseTabPrompt />

      {/* Initials gate (first-launch popup) */}
      <InitialsGate />

      {/* Toasts */}
      <div className="sp-toast-wrap" data-testid="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`sp-toast ${t.kind}`} data-testid={`toast-${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
