import React, { useEffect, useRef, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import { listParserFiles, uploadParserFiles, deleteParserFile, openParserFile } from "../../api/spot";
import Sec from "./Sec";

// Quote Documents — files attached OUTSIDE the parser (invoices, outsourcing
// docs, die POs, etc.). Stored in GridFS with source="document", auto-saved to
// the estimate on upload, previewable, and deletable (with a warning).
export default function DocumentsSec() {
  const { state: s, active } = useQuote();
  const quoteId = s.quoteId || active?.id || "";
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  const refresh = () => {
    if (!quoteId) { setDocs([]); return; }
    listParserFiles(quoteId)
      .then((arr) => setDocs((arr || []).filter((f) => f.source === "document")))
      .catch(() => setDocs([]));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [quoteId]);

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (inputRef.current) inputRef.current.value = "";
    if (!files.length) return;
    if (!quoteId) { setErr("Save the quote first, then attach documents."); return; }
    setBusy(true); setErr("");
    try {
      await uploadParserFiles(files, quoteId, "document");
      refresh();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const onDelete = async (d) => {
    if (!window.confirm(`Permanently delete "${d.filename}" from this quote? This cannot be undone.`)) return;
    try { await deleteParserFile(d.id); refresh(); }
    catch (ex) { setErr(ex?.response?.data?.detail || ex.message); }
  };

  const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  return (
    <Sec title="Documents" testid="sec-documents">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input ref={inputRef} type="file" multiple onChange={onPick} style={{ display: "none" }}
            data-testid="documents-file-input" />
          <button onClick={() => inputRef.current?.click()} disabled={busy || !quoteId}
            data-testid="documents-upload-btn"
            title="Attach invoices, outsourcing docs, die POs, etc. — auto-saved to this quote"
            style={{
              all: "unset", cursor: busy || !quoteId ? "not-allowed" : "pointer",
              fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 4,
              background: "#6366f118", color: "#818cf8", border: "1px solid #6366f155",
              opacity: busy || !quoteId ? 0.6 : 1,
            }}>
            {busy ? "↻ Uploading…" : "＋ Attach document"}
          </button>
          <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
            Invoices, outside-cost docs, POs — kept with the quote (not on the customer PDF)
          </span>
        </div>

        {err && <div style={{ fontSize: 11, color: "var(--spot-err)" }} data-testid="documents-error">{err}</div>}

        {docs.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--spot-text3)", fontStyle: "italic" }} data-testid="documents-empty">
            No documents attached.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="documents-list">
            {docs.map((d) => (
              <div key={d.id} data-testid={`document-row-${d.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderRadius: 4, background: "var(--spot-panel2)", border: "1px solid var(--spot-border)",
                }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={d.filename}>📎 {d.filename}</span>
                <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>{fmtSize(d.bytes || 0)}</span>
                <button onClick={() => openParserFile(d.id, d.filename)} data-testid={`document-open-${d.id}`}
                  style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#818cf8" }}>Open</button>
                <button onClick={() => onDelete(d)} data-testid={`document-delete-${d.id}`}
                  style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--spot-err)" }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sec>
  );
}
