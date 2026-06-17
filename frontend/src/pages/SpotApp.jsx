/* eslint-disable */
import React, { useState, useEffect } from "react";
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
import { useQuote } from "../context/QuoteContext";
import { useEngine } from "../hooks/useEngine";

export default function SpotApp({ onOpenAdmin }) {
  const { active, toasts } = useQuote();
  const [modal, setModal] = useState(null);
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
          <EstimateInfoSec />
          <BomSec />
          <ItemSetupSec result={primary} />
          <ProductionSpecsSec result={primary} />
          <QuoteTableSec results={results} componentPricing={componentPricing} jobTotals={jobTotals} meta={meta} />
          <PricingStrategySec />
          <BoardEngineSec />
          <FilesSec />
        </div>

        <RightDashboard />
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
