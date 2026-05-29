/* eslint-disable */
import React, { useState, useEffect } from "react";
import Modal from "./Modal";
import { parseRfq, parserBudget } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";
import { fmtMoney } from "../../lib/format";

export default function ParseRfqModal({ onClose }) {
  const { setManyFields, pushToast } = useQuote();
  const [files, setFiles] = useState([]);
  const [emailBody, setEmailBody] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [budget, setBudget] = useState(null);
  const [picks, setPicks] = useState({});

  useEffect(() => { parserBudget().then(setBudget).catch(() => {}); }, []);

  const onFiles = (e) => setFiles([...(e.target.files || [])]);

  const runParse = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await parseRfq(files, emailBody, notes);
      setResult(r);
      // default all parsed fields to "applied"
      const init = {};
      Object.keys(r.parsed || {}).forEach((k) => { if (r.parsed[k] !== null && r.parsed[k] !== undefined && r.parsed[k] !== "") init[k] = true; });
      setPicks(init);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const apply = () => {
    if (!result?.parsed) return;
    const p = result.parsed;
    const patch = {};
    if (picks.customerName)   patch.custName = p.customerName;
    if (picks.customerCode)   patch.custCode = p.customerCode;
    if (picks.projectName)    patch.projectName = p.projectName;
    if (picks.po)             patch.poNumber = p.po;
    if (picks.oneUpW)         patch.oneUpW = String(p.oneUpW);
    if (picks.oneUpL)         patch.oneUpL = String(p.oneUpL);
    if (picks.qtys && Array.isArray(p.qtys)) {
      const q = [...p.qtys.map(String)]; while (q.length < 5) q.push("");
      patch.qtys = q.slice(0, 5);
    }
    if (picks.flute)          patch.flute = p.flute;
    if (picks.boardGrade)     patch.boardGrade = p.boardGrade;
    if (picks.outsideLiner)   patch.outsideLiner = p.outsideLiner;
    if (picks.insideLiner)    patch.insideLiner = p.insideLiner;
    if (picks.medium)         patch.medium = p.medium;
    if (picks.printReq)       patch.printReq = p.printReq;
    if (picks.printMode)      patch.printMode = p.printMode;
    if (picks.printSides)     patch.printSides = p.printSides;
    if (picks.colorsFront !== undefined) patch.colorsFront = String(p.colorsFront);
    if (picks.colorsBack !== undefined)  patch.colorsBack = String(p.colorsBack);
    if (picks.whiteInk)       patch.whiteInk = p.whiteInk;
    if (picks.cadDifficulty)  patch.cadDifficulty = p.cadDifficulty;
    if (picks.totalRuleInches) patch.totalRuleInches = String(p.totalRuleInches);
    if (picks.handStripping)  patch.handStripping = p.handStripping;
    if (picks.handGluing)     patch.handGluing = p.handGluing;
    if (picks.tape)           patch.tape = p.tape;
    if (picks.quoteFOB)       patch.quoteFOB = p.quoteFOB;
    if (picks.shipTo && p.shipTo) {
      patch.shipTo = [p.shipTo.city, p.shipTo.state, p.shipTo.zip].filter(Boolean).join(", ");
      patch.destZip = p.shipTo.zip || "";
    }
    if (picks.dueDate)        patch.dueDate = p.dueDate;
    if (picks.notes)          patch.notes = p.notes;
    setManyFields(patch);
    pushToast(`Parser applied ${Object.keys(picks).filter((k) => picks[k]).length} fields`, "ok");
    onClose();
  };

  const togglePick = (k) => setPicks((cur) => ({ ...cur, [k]: !cur[k] }));

  return (
    <Modal title="Parse RFQ · Anthropic Opus 4.7" onClose={onClose} width={820} data-testid="modal-parse-rfq"
      footer={
        <>
          {!result && (
            <button className="sp-btn sp-btn-primary" disabled={busy || (files.length === 0 && !emailBody)}
              onClick={runParse} data-testid="parse-rfq-submit-btn">
              {busy ? "Parsing…" : "Parse"}
            </button>
          )}
          {result && (
            <>
              <button className="sp-btn" onClick={() => { setResult(null); setPicks({}); }} data-testid="parse-rfq-back-btn">
                ← Back
              </button>
              <button className="sp-btn sp-btn-green" onClick={apply} data-testid="parse-rfq-apply-btn">
                Apply Selected
              </button>
            </>
          )}
        </>
      }
    >
      {!result && (
        <>
          {budget && (
            <div style={{ marginBottom: 12, fontSize: 11, color: "var(--spot-text3)" }} data-testid="parser-budget-line">
              Budget: {fmtMoney(budget.spend_usd || 0)} / {fmtMoney(budget.cap_usd || 0)} ({budget.calls} calls · {budget.model})
            </div>
          )}
          <label className="sp-label">RFQ Files (PDF / image / Word / text)</label>
          <input type="file" multiple onChange={onFiles}
            data-testid="parse-rfq-files-input"
            style={{ background: "var(--spot-bg3)", border: "1px solid var(--spot-border)",
                     borderRadius: 4, padding: 8, fontSize: 12, color: "var(--spot-text2)", width: "100%" }} />
          {files.length > 0 && (
            <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 11, color: "var(--spot-text2)" }} data-testid="parse-rfq-file-list">
              {files.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024).toFixed(0)} KB</li>)}
            </ul>
          )}

          <label className="sp-label" style={{ marginTop: 12 }}>Email body (optional)</label>
          <textarea className="sp-input" rows={4} value={emailBody}
            data-testid="parse-rfq-email-textarea"
            onChange={(e) => setEmailBody(e.target.value)} placeholder="Paste customer email text…" />

          <label className="sp-label" style={{ marginTop: 12 }}>Notes to parser (optional)</label>
          <textarea className="sp-input" rows={2} value={notes}
            data-testid="parse-rfq-notes-textarea"
            onChange={(e) => setNotes(e.target.value)} placeholder="Anything else the parser should know…" />

          {err && <div data-testid="parse-rfq-error" style={{
            marginTop: 12, padding: "6px 10px", color: "var(--spot-err)",
            background: "var(--spot-err-bg)", border: "1px solid var(--spot-err)", borderRadius: 4, fontSize: 12,
          }}>{err}</div>}
        </>
      )}

      {result && (
        <>
          <div style={{ marginBottom: 8, fontSize: 12, color: "var(--spot-text2)" }} data-testid="parse-rfq-meta">
            Confidence: <span style={{ color: "var(--spot-green)" }}>{result.parsed?.confidence || "—"}</span>
            {" · "}Model: {result.model}
            {" · "}Tokens in/out: {result.usage?.input_tokens || 0} / {result.usage?.output_tokens || 0}
          </div>
          {result.parsed?.asks?.length > 0 && (
            <div data-testid="parse-rfq-asks" style={{
              marginBottom: 12, padding: "8px 12px",
              background: "var(--spot-warn-bg)", border: "1px solid var(--spot-warn)", borderRadius: 4,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--spot-warn)", marginBottom: 4 }}>
                Parser questions (must verify):
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--spot-text2)" }}>
                {result.parsed.asks.map((a, i) => <li key={i}>{a}</li>)}
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
              {Object.entries(result.parsed || {})
                .filter(([k]) => !["asks", "confidence"].includes(k))
                .map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid var(--spot-line)" }} data-testid={`parse-row-${k}`}>
                    <td><input type="checkbox" checked={!!picks[k]} onChange={() => togglePick(k)}
                      data-testid={`parse-pick-${k}`} /></td>
                    <td style={{ padding: "4px 6px", color: "var(--spot-text3)" }}>{k}</td>
                    <td style={{ padding: "4px 6px", color: "var(--spot-text)" }}>
                      <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                        {typeof v === "object" ? JSON.stringify(v, null, 0) : String(v)}
                      </pre>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
