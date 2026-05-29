/* eslint-disable */
import React, { useState, useEffect } from "react";
import Toolbar from "../components/spot/Toolbar";
import TabBar from "../components/spot/TabBar";
import EstimateInfoSec from "../components/spot/EstimateInfoSec";
import ItemSetupSec from "../components/spot/ItemSetupSec";
import ProductionSpecsSec from "../components/spot/ProductionSpecsSec";
import QuoteTableSec from "../components/spot/QuoteTableSec";
import FilesSec from "../components/spot/FilesSec";
import { BomSec, PricingStrategySec, AdvancedControlsSec, BoardEngineSec } from "../components/spot/Placeholders";
import RightDashboard from "../components/spot/RightDashboard";
import InitialsGate from "../components/spot/InitialsGate";
import PreviewPdfModal from "../components/spot/PreviewPdfModal";
import CostReportModal from "../components/spot/CostReportModal";
import LoadQuoteModal from "../components/spot/LoadQuoteModal";
import { useQuote } from "../context/QuoteContext";
import { useEngine } from "../hooks/useEngine";

export default function SpotApp() {
  const { active, toasts } = useQuote();
  const [modal, setModal] = useState(null);
  const { results } = useEngine(active?.state);
  const primary = results[(active?.state?.selSlot) || 0] || results[0];

  // Allow Quote Table buttons to open modals
  useEffect(() => {
    const onPreview = () => setModal("preview");
    window.addEventListener("spot:open-preview", onPreview);
    return () => window.removeEventListener("spot:open-preview", onPreview);
  }, []);

  return (
    <div data-testid="spot-app-root" style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--spot-bg)", overflow: "hidden",
    }}>
      <Toolbar openModal={setModal} />
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
          <QuoteTableSec results={results} />
          <PricingStrategySec />
          <AdvancedControlsSec />
          <BoardEngineSec />
          <FilesSec />
        </div>

        <RightDashboard />
      </div>

      {/* Modals */}
      {modal === "preview"     && <PreviewPdfModal onClose={() => setModal(null)} />}
      {modal === "cost-report" && <CostReportModal onClose={() => setModal(null)} />}
      {modal === "load"        && <LoadQuoteModal  onClose={() => setModal(null)} />}

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
