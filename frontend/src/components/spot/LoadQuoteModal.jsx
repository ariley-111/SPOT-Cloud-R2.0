/* eslint-disable */
import React, { useEffect, useState } from "react";
import Modal from "./Modal";
import { listDrafts, listQuotes } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";

export default function LoadQuoteModal({ onClose }) {
  const { loadDraftIntoActive } = useQuote();
  const [tab, setTab] = useState("drafts");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    setBusy(true);
    const p = tab === "drafts" ? listDrafts() : listQuotes(100);
    p.then(setItems).catch(() => setItems([])).finally(() => setBusy(false));
  }, [tab]);

  const filtered = items.filter((it) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      (it.est_num || "").toLowerCase().includes(t) ||
      (it.label || "").toLowerCase().includes(t) ||
      ((it.state || {}).custName || it.customer_name || "").toLowerCase().includes(t)
    );
  });

  const onPick = (it) => {
    loadDraftIntoActive(it.state || {});
    onClose();
  };

  return (
    <Modal title="Load Quote / Draft" onClose={onClose} width={720} data-testid="modal-load-quote">
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        <button className={`sp-btn ${tab === "drafts" ? "sp-btn-primary" : ""}`} onClick={() => setTab("drafts")}
          data-testid="load-tab-drafts">Drafts</button>
        <button className={`sp-btn ${tab === "saved" ? "sp-btn-primary" : ""}`} onClick={() => setTab("saved")}
          data-testid="load-tab-saved">Saved</button>
        <input className="sp-input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
          data-testid="load-search-input" style={{ flex: 1, marginLeft: 12 }} />
      </div>
      {busy && <div style={{ color: "var(--spot-text3)" }}>Loading…</div>}
      {!busy && filtered.length === 0 && (
        <div style={{ color: "var(--spot-text3)", fontSize: 12, textAlign: "center", padding: 30 }}>
          No {tab} found.
        </div>
      )}
      <div style={{ maxHeight: "60vh", overflow: "auto" }} data-testid="load-quote-list">
        {filtered.map((it) => (
          <div key={it.id} onClick={() => onPick(it)} data-testid={`load-row-${it.id}`}
            style={{
              padding: "8px 10px", borderBottom: "1px solid var(--spot-line)", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--spot-bg3)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--spot-text)" }}>
                {it.est_num || it.label || "(no est#)"}
              </div>
              <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
                {(it.state || {}).custName || it.customer_name || "—"}
                {" · "}{(it.state || {}).itemDesc || ""}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
              {it.updated_at ? new Date(it.updated_at).toLocaleString() : ""}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
