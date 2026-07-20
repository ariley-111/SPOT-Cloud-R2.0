/* eslint-disable */
import React, { useEffect, useRef, useState } from "react";
import { useQuote } from "../../context/QuoteContext";
import { useAuth } from "../../context/AuthContext";
import Sec from "./Sec";
import { parserBudget, parseRfqPolling, listParserFiles, deleteParserFile, uploadParserFiles, searchCustomers, getQuote, copyQuote, updateQuote } from "../../api/spot";
import { fmtMoney, generateEstNum } from "../../lib/format";
import { linerLabel } from "../../lib/defaults";
import { makeBomItem, applyItemStateTo, freshItemState, JOB_LEVEL_KEYS } from "../../lib/mpSchema";
import { parseAskField, metaFor, canonField, NUMERIC_KEYS, humanizeFieldPath, labelForKey } from "../../lib/parserFieldRegistry";
import FilePreviewModal from "./FilePreviewModal";

export default function FilesSec() {
  const { active, sec, toggleSec, setManyFields, replaceState, pushToast, loadIntoTab } = useQuote();
  const { user: currentUser } = useAuth();
  const s = active?.state || {};
  // Stable file-ownership id — prefer the saved quote id (set after Save Quote)
  // so files survive save/reload, fall back to the active tab/draft id during
  // the pre-save phase. autoSave + Toolbar.onSave migrate file records when
  // these ids change, so listParserFiles(filesQuoteId) always resolves.
  const filesQuoteId = s.quoteId || active?.id || "";
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
  const [matchedQuote, setMatchedQuote] = useState(null);  // LOQ re-submission detected
  const [sentConfirm, setSentConfirm] = useState(null);    // own sent quote pending open
  const inputRef = useRef(null);
  const folderName = s.estNum && s.custName ? `${s.custName}_${s.estNum}` : null;

  useEffect(() => { parserBudget().then(setBudget).catch(() => {}); }, []);

  // Load saved RFQ files for this quote/draft (quote-lifetime storage).
  // Re-fetch whenever the stable id changes (e.g. local→draft promotion,
  // draft→saved quote migration, or loading a different quote).
  useEffect(() => {
    if (!filesQuoteId) { setSavedFiles([]); return; }
    let cancel = false;
    listParserFiles(filesQuoteId)
      .then((arr) => { if (!cancel) setSavedFiles((arr || []).filter((f) => f.source !== "document")); })
      .catch(() => { if (!cancel) setSavedFiles([]); });
    return () => { cancel = true; };
  }, [filesQuoteId]);

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
    // Staging changed → invalidate any cached parse result so the button
    // reverts from "Review Build" to "Build Estimate" and parses the NEW set
    // (lets the user swap a wrong file and re-parse).
    setParseResult(null); setParserError("");
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
  const removeFile = (name) => {
    setFiles((cur) => cur.filter((f) => f.filename !== name));
    // Removing a staged file also invalidates the cached parse so the user can
    // re-parse with the corrected file set.
    setParseResult(null); setParserError("");
  };

  // Auto-save on parse: the parser persists every attached RFQ file to the
  // quote (GridFS) as part of the parse. Any non-RFQ staged files are saved
  // too (see runParseDirect) so nothing attached is ever lost. There is no
  // separate manual "attach" step.

  const hasRfq = files.some((f) => f.class === "rfq");
  const hasCached = !!parseResult;
  const canParse = hasRfq && !busy;

  const runParseDirect = async (rfqFiles) => {
    if (!rfqFiles || rfqFiles.length === 0 || busy) return;
    setBusy(true); setParserError(""); setParseResult(null);
    try {
      const r = await parseRfqPolling(rfqFiles, "", "", {
        customerCode: s.custCode || "",
        customerName: s.custName || "",
        estInitials:  s.estInitials || "",
        quoteId:      filesQuoteId,  // saved quote id if available, else draft id
      });
      setParseResult(r);
      setReviewOpen(true);
      // Letter-of-Quote re-submission: the parser recognized one of OUR quote
      // numbers in the RFQ → surface a prompt to pull the original up + duplicate.
      if (r.matchedQuote && r.matchedQuote.id) setMatchedQuote(r.matchedQuote);
      // Auto-save any non-RFQ staged files too, so nothing attached is lost
      // when the staging list is cleared below.
      const extras = files.filter((f) => f.class !== "rfq").map((f) => f.file);
      if (extras.length && filesQuoteId) {
        try { await uploadParserFiles(extras, filesQuoteId); } catch (_) {}
      }
      // Parsed files are now persisted to the quote (server-side, before the
      // Anthropic call) — they show in "Saved RFQ files". Clear the staging
      // list so a later swap re-parses ONLY the new file, not old + new.
      setFiles([]);
      parserBudget().then(setBudget).catch(() => {});
    } catch (e) {
      setParserError(e?.response?.data?.detail || e.message);
    } finally {
      // Always refresh the saved-files panel — files are persisted BEFORE the
      // Anthropic call, so even on parse failure (budget/timeout) the file is
      // already saved and should appear immediately.
      if (filesQuoteId) listParserFiles(filesQuoteId).then(setSavedFiles).catch(() => {});
      setBusy(false);
    }
  };
  const runParse = async () => {
    const onlyRfq = files.filter((f) => f.class === "rfq").map((f) => f.file);
    await runParseDirect(onlyRfq);
  };

  // ─── Letter-of-Quote re-submission handlers ───────────────────────────
  // "Open original" loads the matched quote into a new tab (bound to its id);
  // "Duplicate" clones it with a fresh estimate number and opens that.
  const loqOpenOriginal = async () => {
    const mq = matchedQuote; setMatchedQuote(null);
    if (!mq) return;
    try {
      const full = await getQuote(mq.id);
      const notMine = full.owner_id && full.owner_id !== currentUser?.id;
      // Re-opening your OWN already-sent estimate → warn before editing/overwriting.
      if (!notMine && full.status === "sent") {
        setSentConfirm(full);
        return;
      }
      doOpenOriginal(full, notMine);
    } catch (e) {
      pushToast(`Couldn't open ${mq.est_num}: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };
  const doOpenOriginal = (full, notMine) => {
    loadIntoTab({
      ...(full.state || {}),
      quoteId: full.id, quoteStatus: full.status || "draft",
      viewOnly: notMine,
      ownerName: notMine ? (full.owner_name || "another user") : null,
      pricingVersionId: full.pricing_version_id || null,
    }, {});
    pushToast(`Opened original quote ${full.est_num}`, "ok");
  };
  // Duplicate a saved quote (full doc) into a fresh tab with a brand-new est#.
  const duplicateQuoteFresh = async (full) => {
    try {
      const copy = await copyQuote(full.id);
      const initials = (s.estInitials || "SPC").toUpperCase();
      const freshEst = generateEstNum(initials);
      const newState = {
        ...(copy.state || {}),
        estNum: freshEst, estNumAuto: false,
        quoteId: copy.id, quoteStatus: copy.status || "draft",
        pricingVersionId: copy.pricing_version_id || null,
        viewOnly: false, ownerName: null,
      };
      try {
        await updateQuote(copy.id, {
          est_num: freshEst, state: newState, status: copy.status || "draft",
          customer_code: copy.customer_code || newState.custCode || null,
          customer_name: copy.customer_name || newState.custName || null,
        });
      } catch (_) {}
      loadIntoTab(newState, {});
      pushToast(`Duplicated ${full.est_num} → new quote ${freshEst}`, "ok");
    } catch (e) {
      pushToast(`Duplicate failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };
  const loqDuplicate = async () => {
    const mq = matchedQuote; setMatchedQuote(null);
    if (!mq) return;
    try {
      const copy = await copyQuote(mq.id);
      const initials = (s.estInitials || "SPC").toUpperCase();
      const freshEst = generateEstNum(initials);
      const newState = {
        ...(copy.state || {}),
        estNum: freshEst, estNumAuto: false,
        quoteId: copy.id, quoteStatus: copy.status || "draft",
        pricingVersionId: copy.pricing_version_id || null,
        viewOnly: false, ownerName: null,
      };
      try {
        await updateQuote(copy.id, {
          est_num: freshEst, state: newState, status: copy.status || "draft",
          customer_code: copy.customer_code || newState.custCode || null,
          customer_name: copy.customer_name || newState.custName || null,
        });
      } catch (_) {}
      loadIntoTab(newState, {});
      pushToast(`Duplicated ${mq.est_num} → new quote ${freshEst}`, "ok");
    } catch (e) {
      pushToast(`Duplicate failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  // Collapsed-section summary pill — total staged + saved file count.
  const totalFiles = files.length + savedFiles.length;
  const filesSummary = totalFiles > 0 ? `${totalFiles} file${totalFiles === 1 ? "" : "s"}` : null;

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
      badge={!sec.files ? filesSummary : null}
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
                    if (!window.confirm(`Permanently delete "${sf.filename}" from this quote? This cannot be undone.`)) return;
                    try {
                      await deleteParserFile(sf.id);
                      setSavedFiles((cur) => cur.filter((x) => x.id !== sf.id));
                      // Invalidate any cached parse so the "Review Build" modal
                      // can't show data extracted from a file that's now gone.
                      setParseResult(null); setParserError(""); setReviewOpen(false);
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

      {/* Letter-of-Quote re-submission banner — the parser recognized one of
          our own quote numbers in the RFQ. Offer to open the original and/or
          duplicate it into a fresh quote number. */}
      {matchedQuote && (
        <LoqMatchModal
          mq={matchedQuote}
          onClose={() => setMatchedQuote(null)}
          onOpen={loqOpenOriginal}
          onDuplicate={loqDuplicate}
        />
      )}

      {sentConfirm && (
        <SentEditWarn
          row={sentConfirm}
          onCancel={() => setSentConfirm(null)}
          onDuplicate={() => { const f = sentConfirm; setSentConfirm(null); duplicateQuoteFresh(f); }}
          onEditAnyway={() => { const f = sentConfirm; setSentConfirm(null); doOpenOriginal(f, false); }}
        />
      )}

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

// ─── Sent-quote edit warning (LOQ Open Original path) ─────────────────
function SentEditWarn({ row, onCancel, onDuplicate, onEditAnyway }) {
  if (!row) return null;
  const fmt = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d) ? "—" : d.toLocaleString([], { month: "numeric", day: "numeric",
      year: "2-digit", hour: "numeric", minute: "2-digit" });
  };
  const when = fmt(row.sent_at || row.updated_at);
  return (
    <div data-testid="loq-sent-warn" onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1200,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                 borderRadius: 8, width: "min(480px, 96vw)", padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#16a34a" }}>
          Quote Already Sent
        </div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", lineHeight: 1.55 }}>
          This estimate <b>{row.est_num}</b>{row.customer_name ? ` (${row.customer_name})` : ""} was
          already sent to the customer on <b>{when}</b>. Any edits will <b>overwrite this estimate</b>
          {" "}and the original sent version will be lost. Do you want to make a duplicate instead?
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sp-btn" onClick={onCancel} data-testid="loq-sent-cancel">Cancel</button>
          <button className="sp-btn" onClick={onEditAnyway} data-testid="loq-sent-edit"
            style={{ background: "rgba(239,68,68,0.12)", color: "var(--spot-err)",
                     border: "1px solid rgba(239,68,68,0.4)", fontWeight: 700 }}>
            Edit Original (overwrite)
          </button>
          <button className="sp-btn sp-btn-primary" onClick={onDuplicate} data-testid="loq-sent-duplicate">
            Make a Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Letter-of-Quote match modal ──────────────────────────────────────
function LoqMatchModal({ mq, onClose, onOpen, onDuplicate }) {
  if (!mq) return null;
  const fmt = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toLocaleString([], { month: "numeric", day: "numeric",
      year: "2-digit", hour: "numeric", minute: "2-digit" });
  };
  const sentLine = mq.status === "sent" && fmt(mq.sent_at)
    ? `sent ${fmt(mq.sent_at)}${mq.owner_name ? ` by ${mq.owner_name}` : ""}`
    : (mq.owner_name ? `owned by ${mq.owner_name}` : null);
  const stale = mq.pricing_is_current === false;
  return (
    <div data-testid="loq-match-modal" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                 borderRadius: 8, width: "min(500px, 96vw)", padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#a855f7" }}>
          We recognize this RFQ
        </div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", lineHeight: 1.55 }}>
          This RFQ references one of our existing quotes — <b>{mq.est_num}</b>
          {mq.customer_name ? ` (${mq.customer_name})` : ""}{sentLine ? `, ${sentLine}` : ""}.
          {stale && (
            <><br /><br /><b style={{ color: "#b8860b" }}>Note:</b> this quote is on an
            older board-pricing list. Duplicating re-prices it at current rates.</>
          )}
          <br /><br />
          Open the original for reference, or duplicate it into a brand-new quote number?
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sp-btn" onClick={onClose} data-testid="loq-dismiss">Dismiss</button>
          <button className="sp-btn" onClick={onOpen} data-testid="loq-open-original">
            Open Original
          </button>
          <button className="sp-btn sp-btn-primary" onClick={onDuplicate} data-testid="loq-duplicate">
            Duplicate as New Quote
          </button>
        </div>
      </div>
    </div>
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

  // ─── Inline ask-correction edits ─────────────────────────────────
  // Keyed: job-scope "job:<key>" · item-scope "item:<idx>:<key>".
  const [edits, setEdits] = React.useState({});
  const ekey = (norm) => norm.scope === "item" ? `item:${norm.itemIdx}:${norm.key}` : `job:${norm.key}`;
  const setEdit = (k, v) => setEdits((cur) => ({ ...cur, [k]: v }));

  // Coerce an edited value into the shape our state expects.
  const coerceEdit = (key, val) => {
    const k = canonField(key);
    const meta = metaFor(k);
    if (meta && meta.bool) return val === "Yes" || val === true;
    if (k === "qtys") {
      const arr = String(val || "").split(/[\s,]+/).filter(Boolean);
      while (arr.length < 5) arr.push("");
      return arr.slice(0, 5);
    }
    if (NUMERIC_KEYS.has(k)) return val === "" || val == null ? "" : String(val);
    return val;
  };

  // Current value backing an ask editor (parser value, overlaid by any edit).
  const askCurrentValue = (norm) => {
    const k = ekey(norm);
    if (k in edits) return edits[k];
    if (norm.scope === "job") {
      const v = p[norm.key];
      if (norm.key === "qtys" && Array.isArray(v)) return v.filter(Boolean).join(", ");
      if (norm.key === "fscEnabled") return v === true ? "Yes" : v === false ? "No" : "";
      return v == null ? "" : (typeof v === "object" ? "" : String(v));
    }
    const it = bomItems[norm.itemIdx] || {};
    const src = (norm.key === "type" || norm.key === "pcsPerSet") ? it : (it.state || {});
    const v = src[norm.key];
    if (norm.key === "qtys" && Array.isArray(v)) return v.filter(Boolean).join(", ");
    return v == null ? "" : (typeof v === "object" ? "" : String(v));
  };

  // Normalize the asks list into editable descriptors (drops bare-string asks
  // into a non-editable note row).
  const normAsks = asksList.map((a) => {
    if (typeof a === "string") return { raw: null, reason: a, norm: null, meta: null };
    const norm = parseAskField(a.field);
    return { raw: a.field, reason: a.reason || "", norm, meta: norm ? metaFor(norm.key) : null };
  });

  // Matched-Set vs Individual toggle: only surface for Multi-Part when the parser
  // is unsure (pricingMode missing or low overall confidence). Estimator-set value
  // wins on apply.
  const lowPricingConf = isMP && (p.pricingMode == null ||
    (typeof overallConf === "number" && overallConf < 0.7));
  const [pricingModeSel, setPricingModeSel] = React.useState(p.pricingMode || "Matched Set");

  // Asks filtered to the CURRENT selection so estimators fix one scope at a time
  // and never wonder which component a field belongs to.
  //   • single (non-MP) quote → all asks (they're all job-scope)
  //   • MP + "Job" tab        → job-scope asks only (Estimate Info, customer, etc.)
  //   • MP + component tab     → only that component's asks
  const visibleAsks = normAsks.filter((a) => {
    if (!isMP) return true;
    if (!a.norm) return mpTab === "job";                 // bare notes live under Job
    if (mpTab === "job") return a.norm.scope === "job";
    return a.norm.scope === "item" && a.norm.itemIdx === Number(mpTab);
  });
  const showQty = !isMP || mpTab !== "job";              // qty is per-component on MP


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
    // Capture the RFQ sender email (external contact) for the Email Quote To: default.
    // IMPORTANT: we read ONLY the email's `from` (sender/buyer) — never its To/CC/BCC —
    // so any blind-CC'd competitors or third parties on the original RFQ are NEVER
    // carried into the outgoing quote. Returns a SINGLE address; skips our own domain
    // and system/auto-forwarder senders (no-reply, mailer-daemon, postmaster).
    const rfqEmail = (() => {
      const SKIP = /(@standardprinting\.com$|^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|bounce)@)/i;
      for (const f of (result.files || [])) {
        const m = String(f.from || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        if (m && !SKIP.test(m[0])) return m[0];
      }
      return "";
    })();
    const has = (k) => picks[k] && p[k] !== null && p[k] !== undefined && p[k] !== "";

    // Collect inline ask-correction edits into job / per-item maps.
    const jobEdits = {};
    const itemEdits = {};  // idx -> { key: val }
    Object.entries(edits).forEach(([ek, val]) => {
      const parts = ek.split(":");
      if (parts[0] === "job") jobEdits[parts[1]] = val;
      else if (parts[0] === "item") {
        const idx = Number(parts[1]); const key = parts.slice(2).join(":");
        (itemEdits[idx] = itemEdits[idx] || {})[key] = val;
      }
    });
    const applyJobEditTo = (obj, key, rawVal) => {
      const k = canonField(key);
      const target = FIELD_MAP[k] || k;
      obj[target] = coerceEdit(k, rawVal);
    };

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
        const ie = itemEdits[i] || {};
        // Overlay this component's inline edits onto its parsed state.
        const es = { ...rawState };
        Object.keys(ie).forEach((k) => {
          if (["type", "pcsPerSet", "desc", "confidence"].includes(k)) return;
          es[canonField(k)] = coerceEdit(k, ie[k]);
        });
        // Per-item state: coerce numeric strings, default qtys array, etc.
        const itemQtys = Array.isArray(es.qtys) ? es.qtys.map(String) : [];
        while (itemQtys.length < 5) itemQtys.push("");
        // Canonical board fields: a parser can emit "" / null (e.g. no medium
        // on the CAD) which would overwrite the form default and break stock
        // matching (blank medium ≠ stocked "None" → spurious Buy-Min). Coerce
        // blanks back to the canonical defaults so dropdowns + pricing are right.
        const _canon = (v, d) => (v == null || String(v).trim() === "" ? d : v);
        const _canonLiner = (v, d) => {
          if (v == null || String(v).trim() === "") return d;
          const s = String(v).trim().toLowerCase();
          return ["kraft", "none", "null", "n/a", "na"].includes(s) ? "None" : v;
        };
        const _canonMedium = (v) => {
          const s = v == null ? "" : String(v).trim().toLowerCase();
          return (s === "" || ["none", "null", "kraft", "n/a", "na"].includes(s)) ? "None" : v;
        };
        const itemState = freshItemState({
          ...es,
          qtys: itemQtys.slice(0, 5),
          flute: _canon(es.flute, "B"),
          boardGrade: _canon(es.boardGrade, "200"),
          outsideLiner: _canonLiner(es.outsideLiner, "42# Kemi-Lite"),
          insideLiner: _canonLiner(es.insideLiner, "None"),
          medium: _canonMedium(es.medium),
          itemDesc: (ie.desc != null ? ie.desc : raw.desc) || es.itemDesc || `Item ${i + 1}`,
          boxStyle: es.boxStyle || "",
          custIdent: raw.custIdent || es.custIdent || "",
          // Coerce numerics to strings (our schema stores numeric inputs as strings)
          oneUpW: es.oneUpW != null ? String(es.oneUpW) : "",
          oneUpL: es.oneUpL != null ? String(es.oneUpL) : "",
          totalRuleInches: es.totalRuleInches != null ? String(es.totalRuleInches) : "0",
        });
        return makeBomItem({
          desc: (ie.desc != null ? ie.desc : raw.desc) || itemState.itemDesc || `Item ${i + 1}`,
          type: ie.type || raw.type || "Manufactured",
          pcsPerSet: ie.pcsPerSet != null ? Number(ie.pcsPerSet) || 1 : (raw.pcsPerSet || 1),
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
      next.pricingMode = pricingModeSel || p.pricingMode || "Matched Set";
      if (p.setMarginPct != null) next.setMarginPct = String(p.setMarginPct);
      next.bomItems = items;
      next.activeItemIdx = 0;
      // Mirror first item's desc/custIdent to top-level
      next.itemDesc = items[0]?.desc || next.itemDesc || "";
      next.custIdent = items[0]?.custIdent || next.custIdent || "";

      // Job-scope inline ask corrections override everything above (last word).
      Object.entries(jobEdits).forEach(([k, v]) => applyJobEditTo(next, k, v));

      if (rfqEmail) next.rfqContactEmail = rfqEmail;
      onApplyMultiPart(next);
      return;
    }

    // Job-scope inline ask corrections override the picked top-level fields.
    Object.entries(jobEdits).forEach(([k, v]) => applyJobEditTo(patch, k, v));

    if (rfqEmail) patch.rfqContactEmail = rfqEmail;
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

          {/* Component / Job selector — pick a scope FIRST, then fix that scope's
              fields, so estimators are never confused about which component a
              field belongs to. */}
          {isMP && (
            <div data-testid="parse-mp-banner" style={{
              marginBottom: 12, padding: "8px 10px",
              background: "#f59e0b0c", border: "1px solid #f59e0b44", borderRadius: 4,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
                  textTransform: "uppercase", letterSpacing: ".08em" }}>Multi-Part</span>
                <span style={{ fontSize: 11, color: "var(--spot-text2)" }}>
                  {pricingModeSel || "Matched Set"} · {bomItems.length} component{bomItems.length !== 1 ? "s" : ""}
                  {p.setMarginPct != null && (<> · default GM {(parseFloat(p.setMarginPct) * 100).toFixed(1)}%</>)}
                </span>
                <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>· select a tab to fix that scope</span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} data-testid="parse-mp-tabs">
                {(() => {
                  const jobAskCount = normAsks.filter((a) => !a.norm || a.norm.scope === "job").length;
                  return (
                    <button onClick={() => setMpTab("job")} data-testid="parse-mp-tab-job"
                      style={{
                        all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                        padding: "3px 8px", borderRadius: 3, display: "flex", gap: 5, alignItems: "center",
                        background: mpTab === "job" ? "var(--spot-accent)" : "var(--spot-bg3)",
                        color: mpTab === "job" ? "#fff" : "var(--spot-text2)",
                        border: `1px solid ${mpTab === "job" ? "var(--spot-accent)" : "var(--spot-border)"}`,
                      }}>Job{jobAskCount > 0 && <span style={{ fontSize: 9, fontWeight: 800,
                        background: "var(--spot-warn)", color: "#000", borderRadius: 8, padding: "0 5px" }}>{jobAskCount}</span>}</button>
                  );
                })()}
                {bomItems.map((it, i) => {
                  const conf = it.confidence;
                  const lowConf = typeof conf === "number" && conf < 0.7;
                  const askCount = normAsks.filter((a) => a.norm && a.norm.scope === "item" && a.norm.itemIdx === i).length;
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
                      {askCount > 0 && <span style={{ fontSize: 9, fontWeight: 800,
                        background: "var(--spot-warn)", color: "#000", borderRadius: 8, padding: "0 5px" }}>{askCount}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Job-level: Matched-Set vs Individual — only when parser is unsure */}
          {isMP && mpTab === "job" && lowPricingConf && (
            <div data-testid="parse-pricing-mode" style={{
              marginBottom: 12, padding: "10px 12px",
              background: "var(--spot-bg2)", border: "1px solid var(--spot-border)", borderRadius: 4,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-text)", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: ".06em" }}>
                Pricing mode
                <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none", letterSpacing: 0,
                  color: "var(--spot-text3)", fontSize: 10 }}>parser unsure — confirm how this multi-part prices</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["Matched Set", "Individual"].map((m) => (
                  <button key={m} onClick={() => setPricingModeSel(m)}
                    data-testid={`parse-pricing-${m.replace(/\s+/g, "-").toLowerCase()}`}
                    style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 700,
                      padding: "5px 12px", borderRadius: 4,
                      background: pricingModeSel === m ? "var(--spot-accent)" : "var(--spot-bg3)",
                      color: pricingModeSel === m ? "#fff" : "var(--spot-text2)",
                      border: `1px solid ${pricingModeSel === m ? "var(--spot-accent)" : "var(--spot-border)"}` }}>{m}</button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity verification — per selected component on Multi-Part */}
          {showQty && (
          <div style={{
            marginBottom: 12, padding: "10px 12px",
            background: "var(--spot-accent-soft)", border: "1px solid var(--spot-accent)", borderRadius: 4,
          }} data-testid="parse-qty-verify">
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-accent)", marginBottom: 8,
              textTransform: "uppercase", letterSpacing: ".06em" }}>
              Verify quantities{isMP && bomItems[Number(mpTab)] ? ` · ${bomItems[Number(mpTab)].desc || `Item ${Number(mpTab) + 1}`}` : ""}
              <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none", letterSpacing: 0,
                color: "var(--spot-text3)", fontSize: 10 }}>
                comma-separated · always double-check — parser qtys are often wrong
              </span>
            </div>
            {!isMP ? (
              (() => {
                const norm = { scope: "job", itemIdx: null, key: "qtys" };
                const k = ekey(norm);
                return (
                  <input className="sp-input" data-testid="parse-qty-input-job"
                    value={k in edits ? edits[k] : askCurrentValue(norm)}
                    placeholder="e.g. 515, 1150, 2300"
                    onChange={(e) => setEdit(k, e.target.value)}
                    style={{ maxWidth: 360, borderColor: k in edits ? "var(--spot-green)" : undefined }} />
                );
              })()
            ) : (
              (() => {
                const i = Number(mpTab);
                const norm = { scope: "item", itemIdx: i, key: "qtys" };
                const k = ekey(norm);
                return (
                  <input className="sp-input" data-testid={`parse-qty-input-item-${i}`}
                    value={k in edits ? edits[k] : askCurrentValue(norm)}
                    placeholder="e.g. 515, 1150, 2300"
                    onChange={(e) => setEdit(k, e.target.value)}
                    style={{ maxWidth: 360, borderColor: k in edits ? "var(--spot-green)" : undefined }} />
                );
              })()
            )}
          </div>
          )}


          {visibleAsks.length > 0 && (
            <div style={{
              marginBottom: 12, padding: "10px 12px",
              background: "var(--spot-warn-bg)", border: "1px solid var(--spot-warn)", borderRadius: 4,
            }} data-testid="parse-asks">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)", marginBottom: 8,
                textTransform: "uppercase", letterSpacing: ".06em" }}>
                {isMP && mpTab !== "job"
                  ? `Fixes for ${bomItems[Number(mpTab)]?.desc || `Item ${Number(mpTab) + 1}`}`
                  : (isMP ? "Job-level fixes" : "Needs estimator input")} · {visibleAsks.length} item{visibleAsks.length === 1 ? "" : "s"}
                <span style={{ marginLeft: 8, fontWeight: 500, textTransform: "none",
                  letterSpacing: 0, color: "var(--spot-text3)", fontSize: 10 }}>
                  fix below — applies on {isMP ? "Apply Multi-Part" : "Apply Selected"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleAsks.map((a, i) => {
                  // Non-editable note (bare string ask or unrecognized field path).
                  if (!a.norm || !a.meta) {
                    return (
                      <div key={i} data-testid={`parse-ask-note-${i}`} style={{ fontSize: 12, color: "var(--spot-text2)" }}>
                        {a.raw && <span style={{ fontWeight: 700, color: "var(--spot-warn)" }}>{humanizeFieldPath(a.raw)}</span>}
                        {a.raw && a.reason && " — "}{a.reason}
                      </div>
                    );
                  }
                  const k = ekey(a.norm);
                  const compName = a.norm.scope === "item"
                    ? (bomItems[a.norm.itemIdx]?.desc || `Item ${a.norm.itemIdx + 1}`) : null;
                  const scopeId = a.norm.scope === "item" ? `item-${a.norm.itemIdx}` : "job";
                  const edited = k in edits;
                  return (
                    <div key={i} data-testid={`parse-ask-${scopeId}-${a.norm.key}`} style={{
                      padding: "8px 10px", background: "var(--spot-bg2)",
                      border: `1px solid ${edited ? "var(--spot-green)" : "var(--spot-border)"}`,
                      borderRadius: 4,
                    }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, color: "var(--spot-text)", fontSize: 12 }}>{a.meta.label}</span>
                        <span style={{ fontSize: 10, color: "var(--spot-text3)" }}>{a.meta.section}</span>
                        {compName && <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b",
                          padding: "0 5px", border: "1px solid #f59e0b55", borderRadius: 2 }}>{compName}</span>}
                        {edited && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-green)" }}>✓ set</span>}
                      </div>
                      {a.reason && <div style={{ fontSize: 11, color: "var(--spot-text2)", margin: "3px 0 6px" }}>{a.reason}</div>}
                      <AskEditor
                        meta={a.meta} field={a.norm.key} testid={`parse-ask-input-${scopeId}-${a.norm.key}`}
                        value={askCurrentValue(a.norm)}
                        onChange={(v) => setEdit(k, v)}
                        onPickCustomer={(rec) => {
                          setEdit("job:custCode", rec.code);
                          setEdit("job:custName", rec.name);
                          setEdit("job:customerRecord", rec);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* (Multi-Part selector moved above — see top of modal body) */}

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
                        fontWeight: isNull ? 400 : 600 }} title={k}>{labelForKey(k)}</td>
                      <td style={{ padding: "4px 6px",
                        color: isNull ? "var(--spot-warn)" : "var(--spot-text)",
                        fontStyle: isNull ? "italic" : "normal" }}>
                        {isNull ? "— null (needs estimator) —" : (
                          <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                            {(k === "outsideLiner" || k === "insideLiner") ? linerLabel(String(v))
                              : (typeof v === "object" ? JSON.stringify(v, null, 0) : String(v))}
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


// Inline editor for a single flagged parser field. Picks the control type
// from the field registry so the estimator fixes it without leaving the modal.
function AskEditor({ meta, field, value, onChange, onPickCustomer, testid }) {
  if (meta.control === "customer") {
    return <AskCustomerPicker value={value} onChange={onChange} onPick={onPickCustomer} testid={testid} />;
  }
  if (meta.control === "select") {
    const isLiner = field === "outsideLiner" || field === "insideLiner";
    const optLabel = isLiner ? linerLabel : (o) => o;
    return (
      <select className="sp-input" data-testid={testid} value={value || ""}
        onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 320 }}>
        <option value="">— choose —</option>
        {(meta.options || []).map((o) => <option key={o} value={o}>{optLabel(o)}</option>)}
      </select>
    );
  }
  if (meta.control === "textarea") {
    return (
      <textarea className="sp-input" data-testid={testid} value={value || ""} rows={2}
        onChange={(e) => onChange(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
    );
  }
  const isNum = meta.control === "number";
  return (
    <input className="sp-input" data-testid={testid} type={isNum ? "number" : "text"}
      value={value || ""} onChange={(e) => onChange(e.target.value)}
      placeholder={meta.control === "qtys" ? "e.g. 515, 1150, 2300" : ""}
      style={{ maxWidth: meta.control === "qtys" ? 320 : isNum ? 160 : 360 }} />
  );
}

// Customer registry typeahead — used for the custCode ask so the estimator
// picks the correct branch from the live customer file.
function AskCustomerPicker({ value, onChange, onPick, testid }) {
  const [q, setQ] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [picked, setPicked] = useState(null);
  const t = useRef(null);
  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); setOpen(false); return; }
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      try { const r = await searchCustomers(q, 10); setResults(r || []); setOpen((r || []).length > 0); setHi(0); }
      catch (_) { setResults([]); setOpen(false); }
    }, 200);
    return () => clearTimeout(t.current);
  }, [q]);
  const choose = (r) => {
    setPicked(r); setQ(`${r.name} · ${r.code}`); setOpen(false);
    onChange(r.code); if (onPick) onPick(r);
  };
  return (
    <div style={{ position: "relative", maxWidth: 460 }}>
      <input className="sp-input" data-testid={testid} value={q}
        placeholder="Search customer name / code…"
        onChange={(e) => { setPicked(null); setQ(e.target.value); }}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(results[hi]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: "100%", borderColor: picked ? "var(--spot-green)" : undefined }} />
      {open && results.length > 0 && (
        <div data-testid={`${testid}-results`} style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60,
          background: "var(--spot-bg2)", border: "1px solid var(--spot-border)",
          borderRadius: 4, marginTop: 2, maxHeight: 240, overflowY: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,.4)",
        }}>
          {results.map((r, i) => (
            <div key={r.code} data-testid={`${testid}-result-${r.code}`}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                background: i === hi ? "var(--spot-accent-soft)" : "transparent",
                borderBottom: i < results.length - 1 ? "1px solid var(--spot-line)" : "none",
                display: "flex", justifyContent: "space-between", gap: 8,
              }}>
              <span style={{ display: "flex", gap: 6, minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>{[r.city, r.state].filter(Boolean).join(", ")}</span>
              </span>
              <span style={{ color: "var(--spot-text3)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{r.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
