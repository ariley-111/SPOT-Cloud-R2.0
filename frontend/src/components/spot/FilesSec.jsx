/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec from "./Sec";
import { parserBudget, parseRfq, listParserFiles, deleteParserFile } from "../../api/spot";
import { fmtMoney } from "../../lib/format";
import { makeBomItem, applyItemStateTo, freshItemState, JOB_LEVEL_KEYS } from "../../lib/mpSchema";
import FilePreviewModal from "./FilePreviewModal";

export default function FilesSec() {
  const { active, sec, toggleSec, setManyFields, replaceState, pushToast } = useQuote();
  const s = active?.state || {};
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);              // {filename, size, mime, class, file}
  const [busy, setBusy] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [parserError, setParserError] = useState("");
  const [budget, setBudget] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Saved (quote-lifetime) parser files for this draft — fetched from
  // /api/parser/files on mount + after each successful parse.
  const [savedFiles, setSavedFiles] = useState([]);
  // Inline preview modal — clicking the ↓ on a saved file opens it here
  // instead of bouncing to a new browser tab. Legacy parity (R1.5+).
  const [previewFile, setPreviewFile] = useState(null);   // {id, filename} | null
  const inputRef = useRef(null);
  const folderName = s.estNum && s.custName ? `${s.custName}_${s.estNum}` : null;

  useEffect(() => { parserBudget().then(setBudget).catch(() => {}); }, []);

  // Load saved RFQ files for this draft (quote-lifetime storage).
  useEffect(() => {
    if (!active?.id) { setSavedFiles([]); return; }
    let cancel = false;
    listParserFiles(active.id)
      .then((arr) => { if (!cancel) setSavedFiles(arr); })
      .catch(() => { if (!cancel) setSavedFiles([]); });
    return () => { cancel = true; };
  }, [active?.id]);

  // Reset per-tab UI state when the active tab changes — files dropped on
  // tab A should not bleed into tab B (was a real bug, reported 2026-06-04).
  useEffect(() => {
    setFiles([]);
    setParseResult(null);
    setParserError("");
    setReviewOpen(false);
  }, [active?.id]);

  const isRfqLike = (name) => /\.(pdf|docx?|xlsx?|csv|tsv|rtf|eml|msg|txt|jpg|jpeg|png|webp|heic|zip)$/i.test(name || "");
  const ingestFiles = (list) => {
    const arr = Array.from(list || []).map((f) => ({
      filename: f.name, size: f.size, mime: f.type || "",
      class: isRfqLike(f.name) ? "rfq" : "file", file: f,
    }));
    setFiles((cur) => [...cur, ...arr]);
    // Per user direction (2026-02-15): NO auto-parse on drop. The estimator
    // loads all files first (email + attachments + extra docs), then clicks
    // "Build Estimate" to launch the parser. Removes the surprise factor
    // when the parser fires before the user has finished arranging their
    // uploads, and avoids burning budget on unintended re-runs.
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

  const runParseDirect = async (rfqFiles) => {
    if (!rfqFiles || rfqFiles.length === 0 || busy) return;
    setBusy(true); setParserError(""); setParseResult(null);
    try {
      const r = await parseRfq(rfqFiles, "", "", {
        customerCode: s.custCode || "",
        customerName: s.custName || "",
        estInitials:  s.estInitials || "",
        quoteId:      active?.id || "",  // tie persisted files to this draft (2026-06-12)
      });
      setParseResult(r);
      setReviewOpen(true);
      parserBudget().then(setBudget).catch(() => {});
      // Refresh saved-files list so the newly persisted uploads appear immediately.
      if (active?.id) listParserFiles(active.id).then(setSavedFiles).catch(() => {});
    } catch (e) {
      setParserError(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };
  const runParse = async () => {
    const onlyRfq = files.filter((f) => f.class === "rfq").map((f) => f.file);
    await runParseDirect(onlyRfq);
  };

  return (
    <Sec label={
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span>Files</span>
        {busy && (
          <span data-testid="parser-inline-spinner"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px", borderRadius: 99,
              background: "rgba(168,85,247,.18)", border: "1px solid #a855f7",
              fontSize: 10, fontWeight: 700, color: "#a855f7",
              letterSpacing: ".04em", textTransform: "uppercase",
            }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%",
              border: "2px solid #a855f7", borderTopColor: "transparent",
              display: "inline-block",
              animation: "spot-spin 0.9s linear infinite",
            }} />
            Parsing RFQ
          </span>
        )}
      </span>
    } hue="#06b6d4" open={sec.files} onToggle={() => toggleSec("files")}
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

      {/* Saved RFQ files (quote-lifetime persistence — 2026-06-12) */}
      {savedFiles.length > 0 && (
        <div data-testid="saved-rfq-files" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
            textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
            Saved RFQ files ({savedFiles.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {savedFiles.map((sf) => (
              <div key={sf.id} data-testid={`saved-rfq-${sf.id}`} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                borderRadius: 4, fontSize: 11,
              }}>
                <span style={{
                  fontSize: 10, color: "#06b6d4", fontWeight: 700, minWidth: 36,
                  textTransform: "uppercase", letterSpacing: ".06em",
                }}>{sf.source === "zip_member" ? "ZIP" : "RFQ"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", color: "var(--spot-text)" }} title={sf.filename}>
                  {sf.filename}
                </span>
                <span style={{ fontSize: 10, color: "var(--spot-text3)",
                  minWidth: 52, textAlign: "right" }}>{fmtBytes(sf.bytes || 0)}</span>
                <button onClick={(e) => {
                    e.stopPropagation();
                    setPreviewFile({ id: sf.id, filename: sf.filename });
                  }}
                  data-testid={`saved-rfq-dl-${sf.id}`}
                  title="Open in preview"
                  style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 700,
                    color: "var(--spot-accent)", padding: "2px 6px" }}>↓</button>
                <button onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Delete saved file "${sf.filename}"?`)) return;
                    try {
                      await deleteParserFile(sf.id);
                      setSavedFiles((cur) => cur.filter((x) => x.id !== sf.id));
                      pushToast("File deleted", "ok");
                    } catch (err) {
                      pushToast(err?.response?.data?.detail || err.message, "err");
                    }
                  }}
                  data-testid={`saved-rfq-rm-${sf.id}`}
                  style={{ all: "unset", cursor: "pointer", fontSize: 12,
                    color: "var(--spot-err)", padding: "2px 4px", fontWeight: 700 }}>×</button>
              </div>
            ))}
          </div>
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
          activeState={s}
          onClose={() => setReviewOpen(false)}
          onApplySimple={(patch) => { setManyFields(patch); pushToast("Parser fields applied", "ok"); setReviewOpen(false); }}
          onApplyMultiPart={(nextState) => { replaceState(nextState); pushToast(`Multi-Part applied — ${(nextState.bomItems || []).length} components`, "ok"); setReviewOpen(false); }}
        />
      )}

      {/* Inline spinner moved into section header (FilesSec label, see top).
          Full-screen ProgressModal was removed 2026-06-12 per user feedback
          ("don't take up the entire screen"). */}

      {/* Inline file preview — legacy parity (R1.5+). Opens any allowed
          attachment (pdf/image/text/csv/docx/xlsx/email/zip) directly
          inside SPOT without bouncing to a new browser tab. */}
      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          filename={previewFile.filename}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </Sec>
  );
}

function fmtBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

function ReviewParseModal({ result, activeState, onClose, onApplySimple, onApplyMultiPart }) {
  const p = result.parsed || {};
  const sources = result.sources || {};
  const method = result.method || "M1";
  const overallConf = result.confidence;
  const asksList = result.asks || [];

  // ─── MP-3: detect Multi-Part output ────────────────────────────────
  const isMP = (p.quoteType === "Multi-Part") && Array.isArray(p.bomItems) && p.bomItems.length > 0;
  const bomItems = isMP ? (p.bomItems || []) : [];
  const [mpTab, setMpTab] = React.useState("job");  // "job" | "0" | "1" | ...

  // Only DEFAULT to checked when value is truthy (non-null, non-empty).
  const [picks, setPicks] = React.useState(() => {
    const init = {};
    Object.keys(p).forEach((k) => {
      const v = p[k];
      if (v === null || v === undefined || v === "") return;          // skip nulls/blanks
      if (Array.isArray(v) && v.length === 0) return;
      if (typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x == null)) return;
      init[k] = true;
    });
    return init;
  });
  const toggle = (k) => setPicks((cur) => ({ ...cur, [k]: !cur[k] }));

  // Map legacy parser field names → our state field names
  const FIELD_MAP = {
    custName: "custName", customerName: "custName",
    custCode: "custCode", customerCode: "custCode",
    custRef: "custRef", projectName: "custRef",
    custIdent: "custIdent",
    po: "poNumber",
    itemDesc: "itemDesc",
    boxStyle: "boxStyle",
    oneUpW: "oneUpW", oneUpL: "oneUpL",
    qtys: "qtys",
    flute: "flute",
    boardGrade: "boardGrade",
    outsideLiner: "outsideLiner",
    insideLiner: "insideLiner",
    medium: "medium",
    printReq: "printReq", printMode: "printMode", printSides: "printSides",
    colorsFront: "colorsFront", colorsBack: "colorsBack",
    whiteInk: "whiteInk",
    cadDifficulty: "cadDifficulty",
    totalRuleInches: "totalRuleInches",
    handStripping: "handStripping", stripReq: "handStripping",
    handGluing: "handGluing", glueReq: "handGluing",
    tape: "tape", tapeReq: "tape",
    quoteFOB: "quoteFOB", fobMode: "quoteFOB",
    destZip: "destZip",
    dueDate: "dueDate",
    notes: "quoteNotes",
    quoteType: "quoteType",
    pricingMode: "pricingMode",
    setMarginPct: "setMarginPct",
    bomItems: "bomItems",
  };
  const NUMERIC_AS_STRING = new Set(["oneUpW", "oneUpL", "colorsFront", "colorsBack", "totalRuleInches", "setMarginPct"]);

  const apply = () => {
    // Build a Simple-style patch from the top-level parsed fields
    const patch = {};
    const has = (k) => picks[k] && p[k] !== null && p[k] !== undefined && p[k] !== "";

    Object.keys(p).forEach((k) => {
      const target = FIELD_MAP[k];
      if (!target) return;
      if (!has(k)) return;
      if (k === "bomItems") return;  // handled below for MP path
      let val = p[k];
      if (target === "qtys" && Array.isArray(val)) {
        const q = [...val.map(String)]; while (q.length < 5) q.push("");
        patch.qtys = q.slice(0, 5);
        return;
      }
      if (NUMERIC_AS_STRING.has(target) && val !== null) val = String(val);
      patch[target] = val;
    });

    // Honest "unspecified" print: only force "No" if parser explicitly left printReq null AND
    // didn't see ANY print signal (e.g. an unchecked Sample Request form).
    if (p.printReq === null && p.printMode === null && p.printSides === null && p.colorsFront === null && p.whiteInk === null && patch.printReq === undefined) {
      patch.printReq = "No";
    }

    // ─── MP-3: Multi-Part apply path ─────────────────────────────────
    if (isMP) {
      // Build full bomItems[] from parser output, normalizing each entry.
      const items = bomItems.map((raw, i) => {
        const rawState = raw.state || {};
        // Per-item state: coerce numeric strings, default qtys array, etc.
        const itemQtys = Array.isArray(rawState.qtys) ? rawState.qtys.map(String) : [];
        while (itemQtys.length < 5) itemQtys.push("");
        const itemState = freshItemState({
          ...rawState,
          qtys: itemQtys.slice(0, 5),
          itemDesc: raw.desc || rawState.itemDesc || `Item ${i + 1}`,
          boxStyle: rawState.boxStyle || "",
          custIdent: raw.custIdent || rawState.custIdent || "",
          // Coerce numerics to strings (our schema stores numeric inputs as strings)
          oneUpW: rawState.oneUpW != null ? String(rawState.oneUpW) : "",
          oneUpL: rawState.oneUpL != null ? String(rawState.oneUpL) : "",
          totalRuleInches: rawState.totalRuleInches != null ? String(rawState.totalRuleInches) : "0",
        });
        return makeBomItem({
          desc: raw.desc || itemState.itemDesc || `Item ${i + 1}`,
          type: raw.type || "Manufactured",
          pcsPerSet: raw.pcsPerSet || 1,
          custIdent: raw.custIdent || "",
          state: itemState,
        });
      });

      // Apply the active item's state into the top-level (mirror item 0)
      let next = applyItemStateTo(activeState, items[0]?.state || freshItemState());
      // Overlay JOB-LEVEL fields from the patch only (custName, custRef,
      // poNumber, dueDate, notes, FOB, destZip, etc.). Item-level fields
      // in the patch (oneUpW/L, qtys, flute, boardGrade, etc.) come from
      // the parser's TOP-LEVEL fields which historically represented the
      // first component or a union/best-guess. Letting them overlay
      // `next` here would clobber items[0]'s own per-component state.
      // Job-level filter via JOB_LEVEL_KEYS keeps MP imports clean.
      const jobLevelPatch = {};
      Object.keys(patch).forEach((k) => { if (JOB_LEVEL_KEYS.has(k)) jobLevelPatch[k] = patch[k]; });
      next = { ...next, ...jobLevelPatch };
      // Always set MP markers (even if patch didn't include them)
      next.quoteType = "Multi-Part";
      next.pricingMode = p.pricingMode || "Matched Set";
      if (p.setMarginPct != null) next.setMarginPct = String(p.setMarginPct);
      next.bomItems = items;
      next.activeItemIdx = 0;
      // Mirror first item's desc/custIdent to top-level
      next.itemDesc = items[0]?.desc || next.itemDesc || "";
      next.custIdent = items[0]?.custIdent || next.custIdent || "";

      onApplyMultiPart(next);
      return;
    }

    onApplySimple(patch);
  };

  const isFieldNull = (v) =>
    v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x == null));

  // Confidence display: legacy can return float 0-1 OR string high/medium/low
  const confLabel = typeof overallConf === "number"
    ? `${(overallConf * 100).toFixed(0)}%`
    : (overallConf || "—");
  const confColor = (() => {
    const n = typeof overallConf === "number" ? overallConf
      : overallConf === "high" ? 0.9 : overallConf === "low" ? 0.5 : 0.7;
    if (n >= 0.85) return "var(--spot-green)";
    if (n >= 0.65) return "var(--spot-warn)";
    return "var(--spot-err)";
  })();

  return (
    <div className="sp-modal-backdrop" data-testid="parse-review-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal" style={{ width: 880 }}>
        <div className="sp-modal-head">
          <span>Review Parsed Fields</span>
          <button className="sp-btn" onClick={onClose} data-testid="parse-review-close">×</button>
        </div>
        <div className="sp-modal-body">
          <div style={{ fontSize: 12, color: "var(--spot-text2)", marginBottom: 10,
            display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span data-testid="parse-method">Method <span style={{
              color: "var(--spot-accent)", fontWeight: 700, padding: "1px 6px",
              border: "1px solid var(--spot-accent)", borderRadius: 3,
            }}>{method}</span></span>
            <span style={{ color: "var(--spot-text3)" }}>·</span>
            <span data-testid="parse-confidence">Confidence <span style={{ color: confColor, fontWeight: 700 }}>{confLabel}</span></span>
            <span style={{ color: "var(--spot-text3)" }}>·</span>
            <span>Model {result.model}</span>
            <span style={{ color: "var(--spot-text3)" }}>·</span>
            <span>Tokens {result.usage?.input_tokens || 0} in / {result.usage?.output_tokens || 0} out</span>
            {result.usage?.cache_read_input_tokens > 0 && (
              <>
                <span style={{ color: "var(--spot-text3)" }}>·</span>
                <span style={{ color: "var(--spot-green)" }} title="Anthropic prompt cache HIT">
                  cache hit ({result.usage.cache_read_input_tokens.toLocaleString()} tok)
                </span>
              </>
            )}
          </div>

          {/* File ingestion summary — surfaces email expansion so estimators can see
              if attached spec PDFs were actually extracted from .eml/.msg files. */}
          {result.files && result.files.length > 0 && (
            <div data-testid="parse-file-summary" style={{
              marginBottom: 12, padding: "8px 12px", background: "var(--spot-bg3)",
              border: "1px solid var(--spot-border)", borderRadius: 4, fontSize: 11,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
                marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
                Ingested
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {result.files.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                      color: f.type === "email" ? "#06b6d4" : f.type === "pdf" ? "#a855f7"
                        : f.type === "image" ? "#f59e0b" : "var(--spot-text3)",
                      border: `1px solid ${f.type === "email" ? "#06b6d455" : f.type === "pdf" ? "#a855f755"
                        : f.type === "image" ? "#f59e0b55" : "var(--spot-border)"}`,
                      textTransform: "uppercase", minWidth: 36, textAlign: "center",
                    }}>{f.type}</span>
                    <span style={{ color: "var(--spot-text)", flex: 1, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    {f.type === "email" && (
                      <span style={{ color: "var(--spot-text3)" }}>
                        body: {f.body_chars || 0} chars · {f.attachments || 0} attachment{f.attachments === 1 ? "" : "s"} extracted
                      </span>
                    )}
                    {f.size && <span style={{ color: "var(--spot-text3)" }}>{fmtBytes(f.size)}</span>}
                    {f.error && <span style={{ color: "var(--spot-err)" }}>error: {f.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {asksList.length > 0 && (
            <div style={{
              marginBottom: 12, padding: "8px 12px",
              background: "var(--spot-warn-bg)", border: "1px solid var(--spot-warn)", borderRadius: 4,
            }} data-testid="parse-asks">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: ".06em" }}>
                Needs estimator input · {asksList.length} item{asksList.length === 1 ? "" : "s"}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--spot-text2)" }}>
                {asksList.map((a, i) => (
                  <li key={i}>
                    {typeof a === "string" ? a : (
                      <>
                        {a.field && <span style={{ fontFamily: "'JetBrains Mono', monospace",
                          color: "var(--spot-warn)", fontWeight: 700 }}>{a.field}</span>}
                        {a.field && a.reason && " — "}
                        {a.reason || ""}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* MP-3: Multi-Part banner + tab strip */}
          {isMP && (
            <div data-testid="parse-mp-banner" style={{
              marginBottom: 10, padding: "8px 10px",
              background: "#f59e0b0c", border: "1px solid #f59e0b44", borderRadius: 4,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
                  textTransform: "uppercase", letterSpacing: ".08em" }}>Multi-Part</span>
                <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>
                  {p.pricingMode || "Matched Set"} · {bomItems.length} component{bomItems.length !== 1 ? "s" : ""}
                  {p.setMarginPct != null && (<> · default GM {(parseFloat(p.setMarginPct) * 100).toFixed(1)}%</>)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} data-testid="parse-mp-tabs">
                <button onClick={() => setMpTab("job")}
                  data-testid="parse-mp-tab-job"
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    padding: "3px 8px", borderRadius: 3,
                    background: mpTab === "job" ? "var(--spot-accent)" : "var(--spot-bg3)",
                    color: mpTab === "job" ? "#fff" : "var(--spot-text2)",
                    border: `1px solid ${mpTab === "job" ? "var(--spot-accent)" : "var(--spot-border)"}`,
                  }}>Job</button>
                {bomItems.map((it, i) => {
                  const conf = it.confidence;
                  const lowConf = typeof conf === "number" && conf < 0.7;
                  return (
                    <button key={i} onClick={() => setMpTab(String(i))}
                      data-testid={`parse-mp-tab-${i}`}
                      style={{
                        all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                        padding: "3px 8px", borderRadius: 3, display: "flex", gap: 5, alignItems: "center",
                        background: mpTab === String(i) ? "#f59e0b22" : "var(--spot-bg3)",
                        color: mpTab === String(i) ? "#f59e0b" : "var(--spot-text2)",
                        border: `1px solid ${mpTab === String(i) ? "#f59e0b88" : "var(--spot-border)"}`,
                      }}>
                      {lowConf && <span title={`Low confidence ${Math.round(conf*100)}%`} style={{ color: "var(--spot-warn)" }}>⚠</span>}
                      {(it.desc || `Item ${i+1}`)} <span style={{ fontSize: 9, opacity: 0.6 }}>·{it.type?.[0] || "M"}·×{it.pcsPerSet || 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <table style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--spot-text3)", textAlign: "left", borderBottom: "1px solid var(--spot-line)" }}>
                <th style={{ width: 28 }}></th>
                <th>Field</th>
                <th>Value</th>
                <th style={{ width: 70 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Multi-Part: iterate job-level or selected item's state
                const rowEntries = !isMP
                  ? Object.entries(p).filter(([k]) => !["asks", "confidence", "_source", "sources", "method"].includes(k))
                  : mpTab === "job"
                    ? Object.entries(p).filter(([k]) => !["asks", "confidence", "_source", "sources", "method", "bomItems"].includes(k))
                    : Object.entries(bomItems[Number(mpTab)]?.state || {})
                        .concat([
                          ["desc", bomItems[Number(mpTab)]?.desc],
                          ["type", bomItems[Number(mpTab)]?.type],
                          ["pcsPerSet", bomItems[Number(mpTab)]?.pcsPerSet],
                          ["confidence", bomItems[Number(mpTab)]?.confidence],
                        ]);
                return rowEntries.map(([k, v]) => {
                  const isNull = isFieldNull(v);
                  // Source key: top-level "k" for job tab; "bomItems[N].state.k" for item tab
                  const srcKey = !isMP || mpTab === "job"
                    ? k : `bomItems[${mpTab}].state.${k}`;
                  const tag = sources[srcKey] || sources[k];
                  const tagColor = {
                    RFQ: "var(--spot-green)", CAD: "var(--spot-accent)",
                    REGISTRY: "var(--spot-purple)", CALC: "var(--spot-cyan)",
                    DEFAULT: "var(--spot-text3)", ASK: "var(--spot-warn)",
                  }[tag] || "var(--spot-text3)";
                  // Only the JOB tab's checkbox affects the apply patch. Item-tab rows
                  // are read-only previews — apply uses the entire bomItems array on Apply.
                  const interactive = !isMP || mpTab === "job";
                  return (
                    <tr key={`${mpTab}-${k}`} style={{ borderBottom: "1px solid var(--spot-line)" }}>
                      <td>{interactive
                        ? <input type="checkbox" disabled={isNull}
                            checked={!!picks[k] && !isNull} onChange={() => toggle(k)}
                            data-testid={`parse-pick-${k}`} />
                        : null}</td>
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
                      <td style={{ padding: "4px 6px" }}>
                        {tag && (
                          <span data-testid={`parse-source-${k}`} style={{
                            fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 2,
                            background: `${tagColor}22`, color: tagColor,
                            border: `1px solid ${tagColor}55`, letterSpacing: ".06em",
                          }}>{tag}</span>
                        )}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <div className="sp-modal-foot">
          <button className="sp-btn" onClick={onClose} data-testid="parse-review-cancel">Cancel</button>
          <button className="sp-btn sp-btn-green" onClick={apply} data-testid="parse-review-apply">
            {isMP ? `Apply Multi-Part (${bomItems.length} items)` : "Apply Selected"}
          </button>
        </div>
      </div>
    </div>
  );
}
