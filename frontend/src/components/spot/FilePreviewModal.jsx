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

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    api.get(`/parser/files/${encodeURIComponent(fileId)}/preview`)
      .then((r) => { if (alive) setState({ status: "ok", payload: r.data }); })
      .catch((e) => {
        if (alive) setState({
          status: "err",
          message: e?.response?.data?.detail || e.message || "Preview failed",
        });
      });
    return () => { alive = false; };
  }, [fileId]);

  const downloadRaw = async () => {
    try {
      const r = await api.get(`/parser/files/${encodeURIComponent(fileId)}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename || `file-${fileId.slice(0, 8)}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      // swallow — user can retry
    }
  };

  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button className="sp-btn" onClick={downloadRaw} data-testid="file-preview-download">↓ Download original</button>
      <button className="sp-btn" onClick={onClose} data-testid="file-preview-close">Close</button>
    </div>
  );

  return (
    <Modal title={filename || "File preview"} onClose={onClose} footer={footer} width={1080}
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
        {state.status === "ok" && <PreviewBody p={state.payload} />}
      </div>
    </Modal>
  );
}

function PreviewBody({ p }) {
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
              Attachments — {d.attachments.length}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {d.attachments.map((a, i) => (
                <li key={i} data-testid={`file-preview-email-att-${i}`}>
                  {a.filename} <span style={{ color: "var(--spot-text3)" }}>· {fmtBytes(a.bytes || 0)}</span>
                </li>
              ))}
            </ul>
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
