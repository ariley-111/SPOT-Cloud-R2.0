/* eslint-disable */
import React, { useState } from "react";
import Toolbar from "../components/spot/Toolbar";
import TabBar from "../components/spot/TabBar";
import LeftPanel from "../components/spot/LeftPanel";
import RightPanel from "../components/spot/RightPanel";
import ParseRfqModal from "../components/spot/ParseRfqModal";
import PreviewPdfModal from "../components/spot/PreviewPdfModal";
import CostReportModal from "../components/spot/CostReportModal";
import FreightModal from "../components/spot/FreightModal";
import LoadQuoteModal from "../components/spot/LoadQuoteModal";
import { useQuote } from "../context/QuoteContext";
import { useEngine } from "../hooks/useEngine";

export default function SpotApp() {
  const { active, toasts } = useQuote();
  const [modal, setModal] = useState(null);
  const { results } = useEngine(active.state);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--spot-bg)" }}
         data-testid="spot-app-root">
      <Toolbar openModal={setModal} />
      <TabBar />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LeftPanel result={results[0]} />
        <RightPanel />
      </div>

      {modal === "parse"       && <ParseRfqModal     onClose={() => setModal(null)} />}
      {modal === "preview"     && <PreviewPdfModal   onClose={() => setModal(null)} />}
      {modal === "cost-report" && <CostReportModal   onClose={() => setModal(null)} />}
      {modal === "freight"     && <FreightModal      onClose={() => setModal(null)} />}
      {modal === "load"        && <LoadQuoteModal    onClose={() => setModal(null)} />}

      {/* Toast wrap */}
      <div className="sp-toast-wrap" data-testid="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`sp-toast ${t.kind}`} data-testid={`toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
