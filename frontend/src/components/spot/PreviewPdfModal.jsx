/* eslint-disable */
import React, { useState } from "react";
import Modal from "./Modal";
import { previewPdfBlob, calculateAll } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";
import { buildPayload } from "../../hooks/useEngine";

export default function PreviewPdfModal({ onClose }) {
  const { active, pushToast } = useQuote();
  const [busy, setBusy] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [err, setErr] = useState("");

  React.useEffect(() => {
    let urlRef = null;
    (async () => {
      try {
        const payload = buildPayload(active.state);
        const { results } = await calculateAll(payload);
        const quote = {
          est_num: active.state.estNum,
          customer_name: active.state.custName,
          customerName: active.state.custName,
          projectName: active.state.projectName,
          state: active.state,
        };
        const blob = await previewPdfBlob(quote, results || []);
        urlRef = URL.createObjectURL(blob);
        setPdfUrl(urlRef);
      } catch (e) {
        setErr(e?.response?.data?.detail || e.message);
      } finally { setBusy(false); }
    })();
    return () => { if (urlRef) URL.revokeObjectURL(urlRef); };
  }, [active.state]);

  return (
    <Modal title="Preview Quote PDF" onClose={onClose} width={900} data-testid="modal-preview-pdf"
      footer={
        <>
          <a className="sp-btn sp-btn-primary" data-testid="preview-pdf-download"
             href={pdfUrl || "#"} download={`quote-${active.state.estNum || "draft"}.pdf`}>
            Download
          </a>
          <button className="sp-btn" onClick={onClose} data-testid="preview-pdf-close-btn">Close</button>
        </>
      }>
      {busy && <div style={{ color: "var(--spot-text3)" }} data-testid="preview-pdf-loading">Generating PDF…</div>}
      {err && <div style={{ color: "var(--spot-err)" }} data-testid="preview-pdf-error">{err}</div>}
      {pdfUrl && !busy && (
        <iframe src={pdfUrl} title="quote-pdf"
          data-testid="preview-pdf-iframe"
          style={{ width: "100%", height: "70vh", border: "1px solid var(--spot-line)", background: "#fff" }} />
      )}
    </Modal>
  );
}
