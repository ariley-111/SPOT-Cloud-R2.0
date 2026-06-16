/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import {
  listDrafts, listQuotes, listQuoteOwners,
  takeOverQuote, copyQuote, getQuote,
} from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";
import { useAuth } from "../../context/AuthContext";
import { Paperclip } from "lucide-react";

// ─── Owner color dots — stable hash → tint ─────────────────────────────
const OWNER_TINTS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#3b82f6","#84cc16"];
function ownerTint(id) {
  if (!id) return "#6b7280";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return OWNER_TINTS[h % OWNER_TINTS.length];
}

// ─── Status pill ───────────────────────────────────────────────────────
const STATUS_STYLE = {
  draft:  { bg: "#6b728022", fg: "#9ca3af", lbl: "Draft" },
  saved:  { bg: "#3b82f622", fg: "#3b82f6", lbl: "Saved" },
  sent:   { bg: "#f59e0b22", fg: "#f59e0b", lbl: "Sent" },
  won:    { bg: "#22c55e22", fg: "#22c55e", lbl: "Won ✓" },
  lost:   { bg: "#ef444422", fg: "#ef4444", lbl: "Lost" },
  hold:   { bg: "#a855f722", fg: "#a855f7", lbl: "Hold" },
};
function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
      background: s.bg, color: s.fg, textTransform: "uppercase", letterSpacing: ".04em",
    }}>{s.lbl}</span>
  );
}

// ─── Take Over confirm modal ───────────────────────────────────────────
function TakeOverConfirm({ row, onCancel, onConfirm }) {
  if (!row) return null;
  return (
    <div data-testid="takeover-confirm" onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                 borderRadius: 8, width: "min(440px, 96vw)", padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Take Over Quote?</div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", lineHeight: 1.5 }}>
          You're about to take ownership of <b>{row.est_num}</b>
          {row.customer_name ? ` (${row.customer_name})` : ""} from{" "}
          <b style={{ color: ownerTint(row.owner_id) }}>{row.owner_name || "the previous owner"}</b>.
          <br /><br />
          They'll lose write access. The transfer will be logged for audit.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="sp-btn" onClick={onCancel} data-testid="takeover-cancel">Cancel</button>
          <button className="sp-btn sp-btn-primary" onClick={onConfirm} data-testid="takeover-confirm-btn">
            Take Over
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────
export default function LoadQuoteModal({ onClose }) {
  const { replaceState, pushToast, deleteDraftById, clearAllDrafts } = useQuote();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState("drafts");            // drafts | saved
  const [scope, setScope] = useState("mine");          // mine | team
  const [ownerFilter, setOwnerFilter] = useState(""); // optional single-owner filter
  const [items, setItems] = useState([]);
  const [owners, setOwners] = useState([]);
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const [confirmRow, setConfirmRow] = useState(null);

  // Load list whenever tab/scope/owner filter changes
  useEffect(() => {
    setBusy(true);
    let ignore = false;
    let promise;
    if (tab === "drafts") {
      // Drafts stay personal per design — no scope toggle wired through.
      promise = listDrafts();
    } else {
      const params = { scope };
      if (ownerFilter) params.owner_id = ownerFilter;
      promise = listQuotes(params);
    }
    // Ignore-flag guards against a stale in-flight fetch (e.g. the initial
    // drafts load) resolving AFTER a newer one and overwriting `items` —
    // that race was dropping the per-quote file_count on the Saved tab.
    promise
      .then((d) => { if (!ignore) setItems(d); })
      .catch(() => { if (!ignore) setItems([]); })
      .finally(() => { if (!ignore) setBusy(false); });
    return () => { ignore = true; };
  }, [tab, scope, ownerFilter]);

  // Owner dropdown options — only meaningful when in team scope
  useEffect(() => {
    if (tab === "saved" && scope === "team") {
      listQuoteOwners().then(setOwners).catch(() => setOwners([]));
    }
  }, [tab, scope]);

  const filtered = useMemo(() => items.filter((it) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      (it.est_num || "").toLowerCase().includes(t) ||
      (it.label || "").toLowerCase().includes(t) ||
      (it.customer_name || (it.state || {}).custName || "").toLowerCase().includes(t) ||
      (it.owner_name || "").toLowerCase().includes(t)
    );
  }), [items, q]);

  const myUserId = currentUser?.id;

  const openInPlace = async (it) => {
    // If it's a saved quote owned by someone else and we're in team view,
    // we still allow direct "View Only" load → puts their state into the active
    // tab as read-only context. (We just load state; no autosave-back to their record.)
    if (tab === "saved" && it.owner_id !== myUserId) {
      // Pull fresh state via getQuote (cleaner audit + ensures we have full doc)
      try { const fresh = await getQuote(it.id); it = fresh; } catch {}
    }
    // Merge in quote-level fields (id + status) so the toolbar Status dropdown
    // can issue PATCH calls back to this same quote rather than creating new
    // copies on every status change.
    const stateWithMeta = {
      ...(it.state || {}),
      ...(tab === "saved" ? { quoteId: it.id, quoteStatus: it.status || "draft" } : {}),
    };
    replaceState(stateWithMeta);
    pushToast(`Loaded ${it.est_num || it.label || "draft"}${it.owner_id !== myUserId ? ` (view only — ${it.owner_name})` : ""}`, "ok");
    onClose();
  };

  const onTakeOver = async (it) => {
    try {
      const updated = await takeOverQuote(it.id);
      replaceState({ ...(updated.state || {}), quoteId: updated.id, quoteStatus: updated.status || "draft" });
      pushToast(`Took over ${updated.est_num} — you are now the owner`, "ok");
      onClose();
    } catch (e) {
      pushToast(`Take Over failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  const onCopy = async (it) => {
    try {
      const copy = await copyQuote(it.id);
      replaceState({ ...(copy.state || {}), quoteId: copy.id, quoteStatus: copy.status || "draft" });
      pushToast(`Copied ${it.est_num} → new draft (${copy.est_num})`, "ok");
      onClose();
    } catch (e) {
      pushToast(`Copy failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  const onDeleteDraft = async (it, e) => {
    e?.stopPropagation();
    if (!window.confirm(`Delete draft "${it.est_num || it.label || "(untitled)"}"? This cannot be undone.`)) return;
    try {
      await deleteDraftById(it.id);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      pushToast("Draft deleted", "ok");
    } catch (err) {
      pushToast(`Delete failed: ${err?.response?.data?.detail || err.message}`, "err");
    }
  };

  const onDeleteAllDrafts = async () => {
    if (!window.confirm(`Delete ALL ${filtered.length} draft(s)? This cannot be undone.`)) return;
    try {
      await clearAllDrafts();
      setItems([]);
      pushToast("All drafts deleted", "ok");
    } catch (err) {
      pushToast(`Delete failed: ${err?.response?.data?.detail || err.message}`, "err");
    }
  };

  return (
    <Modal title="Load Quote / Draft" onClose={onClose} width={920} data-testid="modal-load-quote">
      {/* Top controls row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`sp-btn ${tab === "drafts" ? "sp-btn-primary" : ""}`}
            onClick={() => setTab("drafts")} data-testid="load-tab-drafts">Drafts</button>
          <button className={`sp-btn ${tab === "saved" ? "sp-btn-primary" : ""}`}
            onClick={() => setTab("saved")} data-testid="load-tab-saved">Saved Quotes</button>
        </div>

        {tab === "saved" && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className={`sp-btn ${scope === "mine" ? "sp-btn-primary" : ""}`}
              onClick={() => { setScope("mine"); setOwnerFilter(""); }}
              data-testid="load-scope-mine">Mine</button>
            <button className={`sp-btn ${scope === "team" ? "sp-btn-primary" : ""}`}
              onClick={() => setScope("team")}
              data-testid="load-scope-team">Team</button>
            {scope === "team" && (
              <select className="sp-input"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                data-testid="load-owner-filter"
                style={{ padding: "4px 6px", fontSize: 12, minWidth: 130 }}>
                <option value="">All owners</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <input className="sp-input" placeholder="Search est#, customer, owner…"
          value={q} onChange={(e) => setQ(e.target.value)}
          data-testid="load-search-input" style={{ flex: 1, minWidth: 200 }} />

        {tab === "drafts" && filtered.length > 0 && (
          <button className="sp-btn sp-btn-sm" onClick={onDeleteAllDrafts}
            data-testid="load-delete-all-drafts"
            title="Delete all of your drafts"
            style={{ background: "rgba(239,68,68,0.12)", color: "var(--spot-err)",
                     border: "1px solid rgba(239,68,68,0.4)", fontWeight: 700 }}>
            Delete all
          </button>
        )}
      </div>

      {/* Body */}
      {busy && <div style={{ color: "var(--spot-text3)", padding: 20, textAlign: "center" }}>Loading…</div>}
      {!busy && filtered.length === 0 && (
        <div style={{ color: "var(--spot-text3)", fontSize: 12, textAlign: "center", padding: 30 }}>
          No {tab === "drafts" ? "drafts" : "quotes"} found.
        </div>
      )}

      {!busy && filtered.length > 0 && (
        <div style={{ maxHeight: "60vh", overflow: "auto" }} data-testid="load-quote-list">
          {/* Header row */}
          {tab === "saved" && (
            <div style={{
              display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1.2fr 1fr 0.9fr 220px",
              gap: 8, padding: "6px 10px", borderBottom: "2px solid var(--spot-line)",
              fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em",
            }}>
              <div>Est #</div>
              <div>Customer</div>
              <div>Owner</div>
              <div>Updated</div>
              <div>Status</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
          )}

          {filtered.map((it) => {
            const isMine = !it.owner_id || it.owner_id === myUserId;
            return tab === "saved" ? (
              <div key={it.id} data-testid={`load-row-${it.id}`}
                style={{
                  display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1.2fr 1fr 0.9fr 220px",
                  gap: 8, padding: "8px 10px",
                  borderBottom: "1px solid var(--spot-line)", alignItems: "center",
                  background: "transparent", transition: "background .12s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--spot-bg3)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontWeight: 700, color: "var(--spot-text)", fontSize: 13,
                  display: "flex", alignItems: "center", gap: 6 }}>
                  {it.est_num || "(no est#)"}
                  {it.file_count > 0 && (
                    <span data-testid={`load-files-badge-${it.id}`}
                      title={`${it.file_count} attached file${it.file_count === 1 ? "" : "s"}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 3,
                        fontSize: 10, fontWeight: 700, color: "#06b6d4",
                        background: "#06b6d418", border: "1px solid #06b6d455",
                        borderRadius: 10, padding: "1px 6px" }}>
                      <Paperclip size={11} /> {it.file_count}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--spot-text2)" }}>
                  {it.customer_name || (it.state || {}).custName || "—"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ownerTint(it.owner_id) }} />
                  <span style={{ color: isMine ? "var(--spot-accent)" : "var(--spot-text2)",
                    fontWeight: isMine ? 700 : 500 }}>
                    {isMine ? "You" : (it.owner_name || it.owner_id)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
                  {it.updated_at ? new Date(it.updated_at).toLocaleDateString() : ""}
                </div>
                <div><StatusPill status={it.status} /></div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button className="sp-btn sp-btn-sm" onClick={() => openInPlace(it)}
                    data-testid={`load-action-open-${it.id}`}>
                    {isMine ? "Open" : "View Only"}
                  </button>
                  {!isMine && (
                    <>
                      <button className="sp-btn sp-btn-sm" onClick={() => onCopy(it)}
                        data-testid={`load-action-copy-${it.id}`}
                        title="Clone into a new quote owned by you">Copy</button>
                      <button className="sp-btn sp-btn-sm" onClick={() => setConfirmRow(it)}
                        data-testid={`load-action-takeover-${it.id}`}
                        title="Transfer ownership to you (logs to audit)"
                        style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b",
                                 border: "1px solid rgba(245,158,11,0.4)" }}>
                        Take Over
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              // Drafts — simple row (no owner column since drafts are personal)
              <div key={it.id} data-testid={`load-row-${it.id}`}
                onClick={() => openInPlace(it)}
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--spot-text3)" }}>
                    {it.updated_at ? new Date(it.updated_at).toLocaleString() : ""}
                  </div>
                  <button onClick={(e) => onDeleteDraft(it, e)}
                    data-testid={`load-draft-delete-${it.id}`}
                    title="Delete draft"
                    style={{ all: "unset", cursor: "pointer", fontSize: 16, lineHeight: 1,
                      color: "var(--spot-text3)", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--spot-err)"; e.stopPropagation(); }}
                    onMouseLeave={(e) => e.currentTarget.style.color = "var(--spot-text3)"}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TakeOverConfirm
        row={confirmRow}
        onCancel={() => setConfirmRow(null)}
        onConfirm={() => {
          const r = confirmRow;
          setConfirmRow(null);
          if (r) onTakeOver(r);
        }} />
    </Modal>
  );
}
