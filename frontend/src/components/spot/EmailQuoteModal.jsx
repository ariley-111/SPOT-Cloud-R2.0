/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import { emailStatus, sendQuoteEmail, previewPdfBlob, createQuote, updateQuote } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";

/**
 * Email Quote — compose & send the customer quote PDF via Microsoft Graph 365.
 * Opens from the Preview Quote toolbar. Sender (estimates@standardprinting.com)
 * is fixed server-side. To: prefers the RFQ-parsed contact email over the
 * customer master email. CC: customer CSR + Salesperson (from synced record).
 */
export default function EmailQuoteModal({ state, pdfPayload, onClose, pushToast }) {
  const { setField } = useQuote();
  const s = state || {};
  const rec = s.customerRecord || {};
  const estNum = s.estNum || "draft";
  const custName = s.custName || rec.name || "";
  const project = s.custRef ? ` — ${s.custRef}` : "";
  const validDays = parseInt(s.quoteExpDays, 10) || 30;
  const estName = s.estInitials || "";

  // To: prefer RFQ-parsed external email, then customer-master email.
  const defaultTo = s.rfqContactEmail || rec.email || "";
  // CC: customer's CSR + Salesperson emails (skip blanks / @standardprinting duplicates handled server-side).
  const defaultCc = useMemo(() => {
    const list = [rec.csr_email, rec.salesperson_email].filter(
      (e) => e && String(e).trim()
    );
    return Array.from(new Set(list)).join(", ");
  }, [rec.csr_email, rec.salesperson_email]);

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(
    `Quote #${estNum} — ${custName}${project ? project.replace(" — ", " — ") : ""} — Standard Printing Company`
  );
  const [body, setBody] = useState(
    `Hello,\n\n` +
      `Please find attached our quote #${estNum} for ${custName}${project}. ` +
      `This quote is valid for ${validDays} days.\n\n` +
      `Please let us know if you have any questions.\n\n` +
      `Thank you,\n${estName ? estName + " — " : ""}Standard Printing Company`
  );

  const [status, setStatus] = useState(null); // {configured, sender}
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    emailStatus().then(setStatus).catch(() => setStatus({ configured: false }));
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const parseList = (str) =>
    String(str || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

  const viewPdf = async () => {
    setErr(""); setViewing(true);
    const tab = window.open("", "_blank");  // open synchronously to avoid pop-up blockers
    try {
      const { quote, results, chargeMode, componentPricing, jobTotals } = pdfPayload || {};
      const blob = await previewPdfBlob(quote, results, { chargeMode, componentPricing, jobTotals });
      const url = URL.createObjectURL(blob);
      if (tab) { tab.location = url; }
      else { window.open(url, "_blank"); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (tab) tab.close();
      setErr("Could not open the quote PDF: " + (e?.response?.data?.detail || e.message));
    } finally { setViewing(false); }
  };

  const send = async () => {
    setErr("");
    const toList = parseList(to);
    if (toList.length === 0) { setErr("At least one recipient is required in the To field."); return; }
    const bodyHtml = body.split("\n").map((l) => (l.trim() === "" ? "<br/>" : l)).join("<br/>");
    setSending(true);
    try {
      const r = await sendQuoteEmail({
        to: toList, cc: parseList(cc), subject,
        bodyHtml, pdf: pdfPayload,
      });
      // Auto-save the quote as "Sent" once it's been emailed successfully.
      try {
        const body = {
          est_num: s.estNum || `DRAFT-${Date.now()}`,
          label: s.custRef || s.itemDesc || s.custName || "Untitled",
          state: { ...s, quoteStatus: "sent" }, status: "sent",
          customer_code: s.custCode || null, customer_name: s.custName || null,
        };
        const saved = s.quoteId ? await updateQuote(s.quoteId, body) : await createQuote(body);
        setField("quoteId", saved.id);
        setField("quoteStatus", "sent");
        if (saved.pricing_version_id) setField("pricingVersionId", saved.pricing_version_id);
      } catch (_) { /* email sent; save is best-effort */ }
      pushToast(`Quote emailed to ${r.to.join(", ")} · saved as Sent`, "ok");
      onClose();
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Send failed";
      setErr(msg);
    } finally { setSending(false); }
  };

  const notConfigured = status && !status.configured;
  const lbl = { fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 3 };
  const inp = { width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d5db",
    borderRadius: 6, color: "#1a1a1a", boxSizing: "border-box", fontFamily: "inherit" };

  return (
    <div className="sp-modal-backdrop" data-testid="modal-backdrop-email"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div data-testid="modal-email-quote" role="dialog" aria-modal="true"
        style={{ background: "#fff", borderRadius: 10, width: 620, maxWidth: "95vw",
          maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
          color: "#1a1a1a", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>

        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>✉ Email Quote #{estNum}</span>
          <button onClick={onClose} data-testid="email-quote-close-btn"
            style={{ all: "unset", cursor: "pointer", fontSize: 18, color: "#6b7280", padding: "0 6px" }}>×</button>
        </div>

        <div style={{ padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {status && (
            <div style={{ fontSize: 11, color: notConfigured ? "#92400e" : "#6b7280",
              background: notConfigured ? "#fffbeb" : "#f3f4f6",
              border: `1px solid ${notConfigured ? "#fde68a" : "#e5e7eb"}`,
              borderRadius: 6, padding: "8px 12px" }} data-testid="email-quote-status">
              {notConfigured
                ? "⚠ Email sending isn't enabled yet — IT must grant Microsoft Graph Mail.Send consent. You can compose now, but Send will be disabled until then."
                : <>Sending from <b>{status.sender}</b>. The quote PDF is attached automatically.</>}
            </div>
          )}

          <div>
            <label style={lbl}>To</label>
            <input data-testid="email-quote-to" value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@company.com" style={inp} />
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
              {s.rfqContactEmail ? "Prefilled from the RFQ sender — confirm it's the right contact." : "Enter the customer contact (prefer the RFQ sender's email)."}
            </div>
          </div>

          <div>
            <label style={lbl}>CC</label>
            <input data-testid="email-quote-cc" value={cc} onChange={(e) => setCc(e.target.value)}
              placeholder="csr@…, salesperson@…" style={inp} />
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
              {defaultCc ? "CSR + Salesperson from the customer record." : "No CSR/Salesperson on this customer — add manually if needed."}
            </div>
          </div>

          <div>
            <label style={lbl}>Subject</label>
            <input data-testid="email-quote-subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={inp} />
          </div>

          <div>
            <label style={lbl}>Message</label>
            <textarea data-testid="email-quote-body" value={body} onChange={(e) => setBody(e.target.value)}
              rows={9} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
          </div>

          <button onClick={viewPdf} disabled={viewing} data-testid="email-quote-view-pdf"
            style={{ all: "unset", cursor: viewing ? "wait" : "pointer", fontSize: 12,
              color: "#2563eb", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
            title="Open the quote PDF in a new tab">
            <span style={{ fontSize: 14 }}>📎</span>
            <span style={{ textDecoration: "underline" }}>quote-{estNum}.pdf</span>
            <span style={{ color: "#9ca3af", fontWeight: 400, textDecoration: "none" }}>
              {viewing ? "(opening…)" : "(click to view · attached automatically)"}
            </span>
          </button>

          {err && <div style={{ color: "#dc2626", fontSize: 12 }} data-testid="email-quote-error">{err}</div>}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid #e5e7eb", display: "flex",
          justifyContent: "flex-end", gap: 8, background: "#f9fafb" }}>
          <button onClick={onClose} data-testid="email-quote-cancel"
            style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 600,
              padding: "7px 16px", borderRadius: 6, background: "#e5e7eb", color: "#374151" }}>Cancel</button>
          <button onClick={send} disabled={sending || notConfigured} data-testid="email-quote-send"
            style={{ all: "unset", cursor: sending || notConfigured ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 700, padding: "7px 18px", borderRadius: 6,
              background: notConfigured ? "#9ca3af" : "#2563eb", color: "#fff",
              opacity: sending ? 0.6 : 1 }}>
            {sending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
