/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec from "./Sec";
import { parserBudget, parseRfq } from "../../api/spot";
import { fmtMoney } from "../../lib/format";

export default function FilesSec() {
  const { active, sec, toggleSec, setManyFields, pushToast } = useQuote();
  const s = active?.state || {};
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);              // {filename, size, mime, class, file}
  const [busy, setBusy] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [parserError, setParserError] = useState("");
  const [budget, setBudget] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const inputRef = useRef(null);
  const folderName = s.estNum && s.custName ? `${s.custName}_${s.estNum}` : null;

  useEffect(() => { parserBudget().then(setBudget).catch(() => {}); }, []);

  const isRfqLike = (name) => /\.(pdf|docx?|eml|msg|txt|jpg|jpeg|png|webp|heic)$/i.test(name || "");
  const ingestFiles = (list) => {
    const arr = Array.from(list || []).map((f) => ({
      filename: f.name, size: f.size, mime: f.type || "",
      class: isRfqLike(f.name) ? "rfq" : "file", file: f,
    }));
    setFiles((cur) => [...cur, ...arr]);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    ingestFiles(e.dataTransfer.files);
  };
  const onBrowse = (e) => ingestFiles(e.target.files);
  const removeFile = (name) => setFiles((cur) => cur.filter((f) => f.filename !== name));

  const hasRfq = files.some((f) => f.class === "rfq");
  const hasCached = !!parseResult;
  const canParse = hasRfq && !busy;

  const runParse = async () => {
    setBusy(true); setParserError(""); setParseResult(null);
    try {
      const onlyRfq = files.filter((f) => f.class === "rfq").map((f) => f.file);
      const r = await parseRfq(onlyRfq, "", "");
      setParseResult(r);
      setReviewOpen(true);
      parserBudget().then(setBudget).catch(() => {});
    } catch (e) {
      setParserError(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  return (
    <Sec label="Files" hue="#06b6d4" open={sec.files} onToggle={() => toggleSec("files")}
      data-testid="sec-files">
      {/* Drop zone */}
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="files-drop-zone"
        style={{
          border: `2px dashed ${dragOver ? "#06b6d4" : "var(--spot-border)"}`,
          borderRadius: 8, padding: "36px 18px", minHeight: 100,
          textAlign: "center", cursor: "pointer",
          background: dragOver ? "#06b6d418" : "transparent",
          color: "var(--spot-text2)", transition: "background 120ms ease, border-color 120ms ease",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 6, userSelect: "none",
        }}>
        <span style={{ fontSize: 24, opacity: 0.7 }}>{dragOver ? "⤡" : "⤓"}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{dragOver ? "Release to upload" : "Drop files here"}</span>
        <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>
          {(s.custName && s.estNum) ? "or click to browse" : "customer + est# auto-fill on drop · or click to browse"}
        </span>
      </div>
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={onBrowse} data-testid="files-browse-input" />

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }} data-testid="files-list">
          {files.map((f) => (
            <div key={f.filename} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
              background: "var(--spot-bg3)", border: "1px solid var(--spot-border)",
              borderRadius: 4, fontSize: 11,
            }}>
              <span style={{
                fontSize: 11, color: f.class === "rfq" ? "#06b6d4" : "var(--spot-text3)",
                fontWeight: 700, minWidth: 32,
              }}>{f.class === "rfq" ? "RFQ" : "FILE"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: "var(--spot-text)" }}>{f.filename}</span>
              <span style={{ fontSize: 10, color: "var(--spot-text3)", minWidth: 48, textAlign: "right" }}>
                {fmtBytes(f.size)}
              </span>
              <button onClick={(e) => { e.stopPropagation(); removeFile(f.filename); }}
                data-testid={`file-rm-${f.filename}`}
                style={{ all: "unset", cursor: "pointer", fontSize: 11,
                  color: "var(--spot-err)", padding: "2px 4px", fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Folder status */}
      {folderName && (
        <div style={{ fontSize: 10, color: "var(--spot-text3)", marginTop: 6 }} data-testid="files-folder-name">
          Folder: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--spot-text2)" }}>{folderName}</span>
          {files.length > 0 && <span> ({files.length} file{files.length === 1 ? "" : "s"})</span>}
        </div>
      )}

      {/* Build Estimate sub-panel — the Anthropic parser launcher */}
      <div style={{
        marginTop: 10, display: "flex", flexDirection: "column", gap: 5,
        padding: "10px 12px", background: "#a855f70a",
        border: "1px solid #a855f733", borderRadius: 5,
      }} data-testid="build-estimate-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a855f7",
            textTransform: "uppercase", letterSpacing: ".06em" }}>Build Estimate</div>
          <div style={{ fontSize: 10, color: "var(--spot-text3)" }} data-testid="parser-status">
            {budget ? `✓ key configured · ${fmtMoney(budget.spend_usd || 0)} / ${fmtMoney(budget.cap_usd || 0)} (${budget.calls} calls)` : "loading…"}
          </div>
        </div>
        <button onClick={() => hasCached ? setReviewOpen(true) : runParse()}
          disabled={!canParse && !hasCached}
          data-testid="btn-build-estimate"
          title={!hasRfq && !hasCached ? "Drop an RFQ-class file (PDF) to enable" : "Run Anthropic parser"}
          style={{
            all: "unset", cursor: (canParse || hasCached) ? "pointer" : "not-allowed",
            fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 4,
            background: (canParse || hasCached) ? "#a855f722" : "var(--spot-bg3)",
            color: (canParse || hasCached) ? "#a855f7" : "var(--spot-text3)",
            border: `1px solid ${(canParse || hasCached) ? "#a855f755" : "var(--spot-border)"}`,
            opacity: busy ? 0.85 : 1, textAlign: "center",
          }}>
          {busy ? "↻ Building…" : !hasRfq && !hasCached ? "Build Estimate — no RFQ file" : hasCached ? "Review Build" : "Build Estimate"}
        </button>
        {parserError && (
          <div style={{ fontSize: 11, color: "#a855f7", padding: "4px 6px",
            background: "#a855f715", border: "1px solid #a855f733", borderRadius: 4 }}
            data-testid="parser-error">{parserError}</div>
        )}
      </div>

      {/* Review modal */}
      {reviewOpen && parseResult && (
        <ReviewParseModal result={parseResult}
          onClose={() => setReviewOpen(false)}
          onApply={(patch) => { setManyFields(patch); pushToast("Parser fields applied", "ok"); setReviewOpen(false); }} />
      )}
    </Sec>
  );
}

function fmtBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

function ReviewParseModal({ result, onClose, onApply }) {
  const p = result.parsed || {};
  // Only DEFAULT to checked when value is truthy (non-null, non-empty).
  const [picks, setPicks] = React.useState(() => {
    const init = {};
    Object.keys(p).forEach((k) => {
      const v = p[k];
      if (v === null || v === undefined || v === "") return;          // skip nulls/blanks
      if (Array.isArray(v) && v.length === 0) return;
      if (typeof v === "object" && Object.values(v).every((x) => x == null)) return;
      init[k] = true;
    });
    return init;
  });
  const toggle = (k) => setPicks((cur) => ({ ...cur, [k]: !cur[k] }));

  const apply = () => {
    const patch = {};
    const has = (k) => picks[k] && p[k] !== null && p[k] !== undefined && p[k] !== "";
    if (has("customerName")) patch.custName = p.customerName;
    if (has("customerCode")) patch.custCode = p.customerCode;
    if (has("projectName"))  patch.custRef  = p.projectName;
    if (has("custIdent"))    patch.custIdent = p.custIdent;
    if (has("po"))           patch.poNumber = p.po;
    if (has("itemDesc"))     patch.itemDesc = p.itemDesc;
    if (has("boxStyle"))     patch.boxStyle = p.boxStyle;
    if (has("oneUpW"))       patch.oneUpW = String(p.oneUpW);
    if (has("oneUpL"))       patch.oneUpL = String(p.oneUpL);
    if (has("qtys") && Array.isArray(p.qtys)) {
      const q = [...p.qtys.map(String)]; while (q.length < 5) q.push("");
      patch.qtys = q.slice(0, 5);
    }
    if (has("flute"))         patch.flute = p.flute;
    if (has("boardGrade"))    patch.boardGrade = p.boardGrade;
    if (has("outsideLiner"))  patch.outsideLiner = p.outsideLiner;
    if (has("insideLiner"))   patch.insideLiner = p.insideLiner;
    if (has("medium"))        patch.medium = p.medium;
    // Print: if parser left ALL print fields null, explicitly turn print OFF so the
    // estimator sees blank-tray pricing — they can flip it back on with intent.
    const parserSawPrintFields = ["printReq","printMode","printSides","colorsFront","colorsBack","whiteInk"]
      .some((k) => p[k] !== null && p[k] !== undefined && p[k] !== "");
    if (has("printReq"))      patch.printReq = p.printReq;
    else if (!parserSawPrintFields) patch.printReq = "No";    // honest "unspecified" → No print until estimator opts in
    if (has("printMode"))     patch.printMode = p.printMode;
    if (has("printSides"))    patch.printSides = p.printSides;
    if (has("colorsFront"))   patch.colorsFront = String(p.colorsFront);
    if (has("colorsBack"))    patch.colorsBack  = String(p.colorsBack);
    if (has("whiteInk"))      patch.whiteInk = p.whiteInk;
    if (has("handStripping")) patch.handStripping = p.handStripping;
    if (has("handGluing"))    patch.handGluing = p.handGluing;
    if (has("tape"))          patch.tape = p.tape;
    if (has("quoteFOB"))      patch.quoteFOB = p.quoteFOB;
    if (has("dueDate"))       patch.dueDate = p.dueDate;
    if (has("notes"))         patch.quoteNotes = p.notes;
    onApply(patch);
  };

  return (
    <div className="sp-modal-backdrop" data-testid="parse-review-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal" style={{ width: 820 }}>
        <div className="sp-modal-head">
          <span>Review Parsed Fields</span>
          <button className="sp-btn" onClick={onClose} data-testid="parse-review-close">×</button>
        </div>
        <div className="sp-modal-body">
          <div style={{ fontSize: 12, color: "var(--spot-text2)", marginBottom: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Confidence <span style={{
              color: p.confidence === "high" ? "var(--spot-green)" :
                     p.confidence === "low"  ? "var(--spot-err)"   : "var(--spot-warn)",
              fontWeight: 700,
            }}>{p.confidence || "—"}</span></span>
            <span style={{ color: "var(--spot-text3)" }}>·</span>
            <span>Model {result.model}</span>
            <span style={{ color: "var(--spot-text3)" }}>·</span>
            <span>Tokens {result.usage?.input_tokens || 0} in / {result.usage?.output_tokens || 0} out</span>
            {p._source?.form_type && (
              <>
                <span style={{ color: "var(--spot-text3)" }}>·</span>
                <span>Source: <span style={{ color: "var(--spot-text)", fontWeight: 600 }}>{p._source.form_type}</span></span>
              </>
            )}
          </div>

          {/* Evidence trail */}
          {p._source?.key_excerpts?.length > 0 && (
            <details style={{
              marginBottom: 12, padding: "6px 10px",
              background: "var(--spot-bg3)", border: "1px solid var(--spot-border)", borderRadius: 4,
            }} data-testid="parse-evidence-trail">
              <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--spot-text3)",
                textTransform: "uppercase", letterSpacing: ".06em" }}>
                Evidence trail · {p._source.key_excerpts.length} excerpts the parser saw
              </summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11,
                color: "var(--spot-text2)", fontFamily: "'JetBrains Mono', monospace" }}>
                {p._source.key_excerpts.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </details>
          )}

          {p.asks?.length > 0 && (
            <div style={{
              marginBottom: 12, padding: "8px 12px",
              background: "var(--spot-warn-bg)", border: "1px solid var(--spot-warn)", borderRadius: 4,
            }} data-testid="parse-asks">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)", marginBottom: 4,
                textTransform: "uppercase", letterSpacing: ".06em" }}>
                Needs estimator input · {p.asks.length} item{p.asks.length === 1 ? "" : "s"}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--spot-text2)" }}>
                {p.asks.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <table style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--spot-text3)", textAlign: "left", borderBottom: "1px solid var(--spot-line)" }}>
                <th style={{ width: 30 }}></th><th>Field</th><th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p)
                .filter(([k]) => !["asks", "confidence", "_source"].includes(k))
                .map(([k, v]) => {
                  const isNull = v === null || v === undefined || v === "" ||
                    (Array.isArray(v) && v.length === 0) ||
                    (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x == null));
                  return (
                    <tr key={k} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                      <td><input type="checkbox" disabled={isNull}
                        checked={!!picks[k] && !isNull} onChange={() => toggle(k)}
                        data-testid={`parse-pick-${k}`} /></td>
                      <td style={{ padding: "4px 6px",
                        color: isNull ? "var(--spot-text3)" : "var(--spot-text2)",
                        fontWeight: isNull ? 400 : 600 }}>{k}</td>
                      <td style={{ padding: "4px 6px",
                        color: isNull ? "var(--spot-warn)" : "var(--spot-text)",
                        fontStyle: isNull ? "italic" : "normal" }}>
                        {isNull ? "— null (needs estimator) —" : (
                          <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                            {typeof v === "object" ? JSON.stringify(v, null, 0) : String(v)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="sp-modal-foot">
          <button className="sp-btn" onClick={onClose} data-testid="parse-review-cancel">Cancel</button>
          <button className="sp-btn sp-btn-green" onClick={apply} data-testid="parse-review-apply">Apply Selected</button>
        </div>
      </div>
    </div>
  );
}
