/* eslint-disable */
import React, { useEffect, useState } from "react";
import api from "../../api/client";
import Modal from "./Modal";
import { fmtBytes } from "../../lib/format";

/**
 * In-app inline preview for any quote-attached file.
 * Legacy parity (R1.5): clicking ↓ on a saved RFQ opens the file *inside*
 * SPOT — never bounces to a new browser tab unless the type can't render.
 *
 *  • pdf            → <iframe srcDoc=base64> (inline render)
 *  • image          → <img>
 *  • text/csv/docx  → preformatted <pre> with mono font
 *  • email (.eml/.msg) → subject/from header + body + attachment list
 *  • sheet (.xlsx)  → tabular render per worksheet
 *  • zip            → list of members
 *  • binary         → fallback message + Download button
 */
export default function FilePreviewModal({ fileId, filename, onClose }) {
  const [state, setState] = useState({ status: "loading" });
  // When the user clicks an email attachment, we push a new entry onto the
  // stack and render it; close on the nested view pops back to the email.
  // stack entry: { fileId | attachmentOf, idx?, filename, title }
  const [stack, setStack] = useState([{ fileId, filename, title: filename, kind: "file" }]);
  const current = stack[stack.length - 1];

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    const url = current.kind === "attachment"
      ? `/parser/files/${encodeURIComponent(current.parentId)}/attachment/${current.idx}/preview`
      : `/parser/files/${encodeURIComponent(current.fileId)}/preview`;
    api.get(url)
      .then((r) => { if (alive) setState({ status: "ok", payload: r.data }); })
      .catch((e) => {
        if (alive) setState({
          status: "err",
          message: e?.response?.data?.detail || e.message || "Preview failed",
        });
      });
    return () => { alive = false; };
  }, [current.fileId, current.parentId, current.idx, current.kind]);

  const openAttachment = (idx, attFilename) => {
    setStack((s) => [...s, {
      kind: "attachment",
      parentId: s[s.length - 1].fileId || s[s.length - 1].parentId,
      idx,
      filename: attFilename,
      title: attFilename,
    }]);
  };
  const popStack = () => setStack((s) => s.length > 1 ? s.slice(0, -1) : s);
  const isNested = stack.length > 1;

  const downloadRaw = async () => {
    try {
      // For an attachment, we don't have an independent download endpoint —
      // re-fetch the preview payload (already base64) and synthesize a blob.
      if (current.kind === "attachment" && state.status === "ok" && state.payload?.data) {
        const p = state.payload;
        let blob;
        if (p.kind === "pdf") {
          const bin = atob(p.data); const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          blob = new Blob([arr], { type: "application/pdf" });
        } else if (p.kind === "image") {
          const bin = atob(p.data); const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          blob = new Blob([arr], { type: p.imgMime || "image/*" });
        } else if (p.kind === "text") {
          blob = new Blob([p.data || ""], { type: "text/plain" });
        } else {
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = current.filename || "attachment";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return;
      }
      const r = await api.get(`/parser/files/${encodeURIComponent(current.fileId)}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = current.filename || `file-${(current.fileId||"").slice(0, 8)}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      // swallow — user can retry
    }
  };

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%" }}>
      <div>
        {isNested && (
          <button className="sp-btn" onClick={popStack} data-testid="file-preview-back">
            ← Back to {stack[stack.length - 2].title}
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="sp-btn" onClick={downloadRaw} data-testid="file-preview-download">↓ Download original</button>
        <button className="sp-btn" onClick={onClose} data-testid="file-preview-close">Close</button>
      </div>
    </div>
  );

  return (
    <Modal title={current.title || "File preview"} onClose={onClose} footer={footer} width={1080}
      data-testid="file-preview-modal">
      <div style={{ minHeight: 320 }}>
        {state.status === "loading" && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--spot-text3)" }}>Loading preview…</div>
        )}
        {state.status === "err" && (
          <div style={{ padding: 20, color: "var(--spot-err)", fontSize: 13 }} data-testid="file-preview-error">
            ⚠ {state.message}
          </div>
        )}
        {state.status === "ok" && <PreviewBody p={state.payload} onOpenAttachment={openAttachment} />}
      </div>
    </Modal>
  );
}

function PreviewBody({ p, onOpenAttachment }) {
  if (!p) return null;
  const headerStrip = (
    <div style={{
      display: "flex", gap: 12, fontSize: 11, color: "var(--spot-text3)",
      borderBottom: "1px solid var(--spot-line)", paddingBottom: 6, marginBottom: 10,
    }}>
      <span>{p.mime || "—"}</span>
      <span>·</span>
      <span>{fmtBytes(p.bytes || 0)}</span>
      <span>·</span>
      <span data-testid="file-preview-kind">{p.kind}</span>
    </div>
  );

  if (p.kind === "pdf") {
    const src = `data:application/pdf;base64,${p.data}`;
    return (
      <>
        {headerStrip}
        <iframe title={p.filename} src={src} data-testid="file-preview-pdf"
          style={{ width: "100%", height: "70vh", border: "1px solid var(--spot-line)", borderRadius: 4, background: "#fff" }} />
      </>
    );
  }

  if (p.kind === "image") {
    const src = `data:${p.imgMime || "image/*"};base64,${p.data}`;
    return (
      <>
        {headerStrip}
        <div style={{ textAlign: "center" }}>
          <img alt={p.filename} src={src} data-testid="file-preview-image"
            style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 4, background: "#0b1220" }} />
        </div>
      </>
    );
  }

  if (p.kind === "text") {
    return (
      <>
        {headerStrip}
        <pre data-testid="file-preview-text"
          style={{
            fontFamily: "'JetBrains Mono', 'Consolas', monospace", fontSize: 12,
            background: "var(--spot-bg2)", color: "var(--spot-text)",
            padding: 12, borderRadius: 4, border: "1px solid var(--spot-line)",
            maxHeight: "70vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{p.data}</pre>
      </>
    );
  }

  if (p.kind === "email") {
    const d = p.data || {};
    return (
      <>
        {headerStrip}
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12, marginBottom: 12 }}>
          <span style={{ color: "var(--spot-text3)", fontWeight: 700 }}>From</span>
          <span data-testid="file-preview-email-from">{d.from || "—"}</span>
          <span style={{ color: "var(--spot-text3)", fontWeight: 700 }}>Subject</span>
          <span data-testid="file-preview-email-subject">{d.subject || "—"}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 4,
          textTransform: "uppercase", letterSpacing: ".06em" }}>Body</div>
        <pre data-testid="file-preview-email-body"
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13,
            background: "var(--spot-bg2)", color: "var(--spot-text)",
            padding: 12, borderRadius: 4, border: "1px solid var(--spot-line)",
            maxHeight: "45vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            margin: 0,
          }}>{d.body || "(no body text)"}</pre>
        {Array.isArray(d.attachments) && d.attachments.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 4,
              textTransform: "uppercase", letterSpacing: ".06em" }}>
              Attachments — {d.attachments.length}  <span style={{ color: "var(--spot-text3)",
                textTransform: "none", letterSpacing: 0, fontSize: 10 }}>· click to preview</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {d.attachments.map((a, i) => (
                <button key={i}
                  onClick={() => onOpenAttachment && onOpenAttachment(i, a.filename || `attachment-${i}`)}
                  data-testid={`file-preview-email-att-${i}`}
                  style={{
                    all: "unset", cursor: "pointer", display: "flex",
                    alignItems: "center", gap: 8, padding: "5px 8px",
                    background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                    borderRadius: 4, fontSize: 12,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--spot-bg3)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "var(--spot-bg2)"}>
                  <span style={{ fontSize: 10, color: "var(--spot-accent)", fontWeight: 700, minWidth: 16 }}>↗</span>
                  <span style={{ flex: 1, color: "var(--spot-text)", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                  <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>{fmtBytes(a.bytes || 0)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  if (p.kind === "sheet") {
    const sheets = (p.data && p.data.sheets) || [];
    return (
      <>
        {headerStrip}
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>
          {sheets.map((sh, i) => (
            <div key={i} style={{ marginBottom: 18 }} data-testid={`file-preview-sheet-${i}`}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--spot-accent)",
                marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                {sh.name} {sh.truncated && <span style={{
                  marginLeft: 6, fontSize: 10, color: "var(--spot-warn)", fontWeight: 600,
                }}>(first 50 rows)</span>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <tbody>
                  {(sh.rows || []).map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{
                          padding: "3px 6px",
                          background: ri === 0 ? "var(--spot-bg3)" : "transparent",
                          fontWeight: ri === 0 ? 700 : 400,
                          maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (p.kind === "zip") {
    const members = (p.data && p.data.members) || [];
    return (
      <>
        {headerStrip}
        <div style={{ fontSize: 11, color: "var(--spot-text3)", marginBottom: 4,
          textTransform: "uppercase", letterSpacing: ".06em" }}>
          ZIP contents — {members.length} file{members.length === 1 ? "" : "s"}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {members.map((m, i) => (
              <tr key={i} data-testid={`file-preview-zip-${i}`}
                style={{ borderBottom: "1px solid var(--spot-line)" }}>
                <td style={{ padding: "5px 6px" }}>{m.name}</td>
                <td style={{ padding: "5px 6px", textAlign: "right",
                  color: "var(--spot-text3)", whiteSpace: "nowrap" }}>{fmtBytes(m.bytes || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  // binary / unknown
  return (
    <>
      {headerStrip}
      <div data-testid="file-preview-binary"
        style={{ padding: 24, textAlign: "center", color: "var(--spot-text2)", fontSize: 13 }}>
        Can't preview this file type inline. {p.data ? <em style={{ color: "var(--spot-text3)" }}> {p.data} </em> : null}
        <br /><br />
        Use <b>↓ Download original</b> below to save it.
      </div>
    </>
  );
}
