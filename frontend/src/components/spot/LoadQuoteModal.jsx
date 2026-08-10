/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import {
  listDrafts, listQuotes, listQuoteOwners,
  takeOverQuote, copyQuote, getQuote, deleteQuote, updateQuote,
} from "../../api/spot";
import { generateEstNum } from "../../lib/format";
import { useQuote } from "../../context/QuoteContext";
import { useAuth } from "../../context/AuthContext";
import { Paperclip, AlertTriangle, Trash2, Pencil, Save, CheckCircle2, Send } from "lucide-react";

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
  draft: { bg: "#6b728022", fg: "#9ca3af", lbl: "Draft", Icon: Pencil },
  saved: { bg: "#f59e0b22", fg: "#d97706", lbl: "Saved", Icon: Save },
  sent:  { bg: "#22c55e22", fg: "#16a34a", lbl: "Sent", Icon: CheckCircle2 },
};
function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  const Icon = s.Icon;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
      background: s.bg, color: s.fg, textTransform: "uppercase", letterSpacing: ".04em",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}><Icon size={11} strokeWidth={2.5} />{s.lbl}</span>
  );
}

// ─── Date/time + duration helpers ──────────────────────────────────────
function fmtDT(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return d.toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit",
    hour: "numeric", minute: "2-digit" });
}
function fmtDur(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  if (isNaN(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
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

// ─── Sent-quote edit warning ───────────────────────────────────────────
function fmtDTLocal(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return d.toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit",
    hour: "numeric", minute: "2-digit" });
}
function SentWarnConfirm({ row, onCancel, onDuplicate, onEditAnyway }) {
  if (!row) return null;
  const when = fmtDTLocal(row.sent_at || row.updated_at);
  const who = row.owner_name || "another user";
  return (
    <div data-testid="sent-warn-confirm" onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100,
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
                 borderRadius: 8, width: "min(480px, 96vw)", padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6,
          display: "flex", alignItems: "center", gap: 8, color: "#16a34a" }}>
          <CheckCircle2 size={18} /> Quote Already Sent
        </div>
        <div style={{ fontSize: 13, color: "var(--spot-text2)", lineHeight: 1.55 }}>
          This estimate <b>{row.est_num}</b>{row.customer_name ? ` (${row.customer_name})` : ""} was
          already sent to the customer on <b>{when}</b> by <b>{who}</b>.
          <br /><br />
          Any edits will <b>overwrite this estimate</b> and the original sent version will be lost.
          Do you want to make a duplicate instead?
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="sp-btn" onClick={onCancel} data-testid="sent-warn-cancel">Cancel</button>
          <button className="sp-btn" onClick={onEditAnyway} data-testid="sent-warn-edit"
            style={{ background: "rgba(239,68,68,0.12)", color: "var(--spot-err)",
                     border: "1px solid rgba(239,68,68,0.4)", fontWeight: 700 }}>
            Edit Original (overwrite)
          </button>
          <button className="sp-btn sp-btn-primary" onClick={onDuplicate} data-testid="sent-warn-duplicate">
            Make a Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────
export default function LoadQuoteModal({ onClose }) {
  const { loadIntoTab, pushToast, deleteDraftById, clearAllDrafts } = useQuote();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState("drafts");            // drafts | saved
  const [scope, setScope] = useState("mine");          // mine | team
  const [ownerFilter, setOwnerFilter] = useState(""); // optional single-owner filter
  const [items, setItems] = useState([]);
  const [owners, setOwners] = useState([]);
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [confirmRow, setConfirmRow] = useState(null);
  const [sentRow, setSentRow] = useState(null);

  // Debounce the search term so the backend query fires ~350ms after typing.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Load list whenever tab/scope/owner filter / search term changes
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
      if (qDebounced) params.q = qDebounced;
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
  }, [tab, scope, ownerFilter, qDebounced]);

  // Owner dropdown options — only meaningful when in team scope
  useEffect(() => {
    if (tab === "saved" && scope === "team") {
      listQuoteOwners().then(setOwners).catch(() => setOwners([]));
    }
  }, [tab, scope]);

  const filtered = useMemo(() => items.filter((it) => {
    // Saved Quotes tab must exclude items whose lifecycle status is still
    // "draft" — those are quotes-collection rows that were persisted but never
    // finalized. They belong on the Drafts tab visually.
    if (tab === "saved" && (it.status || it.state?.quoteStatus) === "draft") {
      return false;
    }
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    const st = it.state || {};
    // iQuote # may be stored as a string OR a number (legacy prod data).
    // Coerce to string for the contains-check so the client-side filter matches
    // whichever type the doc actually holds.
    const iq = st.iquoteNum;
    const iqStr = iq === undefined || iq === null ? "" : String(iq).toLowerCase();
    return (
      (it.est_num || "").toLowerCase().includes(t) ||
      (it.label || "").toLowerCase().includes(t) ||
      (it.customer_name || st.custName || "").toLowerCase().includes(t) ||
      (it.customer_code || st.custCode || "").toLowerCase().includes(t) ||
      (st.custRef || "").toLowerCase().includes(t) ||             // project name
      (st.itemDesc || "").toLowerCase().includes(t) ||            // item description
      (st.estInitials || "").toLowerCase().includes(t) ||         // estimating team
      (it.owner_name || "").toLowerCase().includes(t) ||          // owner first name
      iqStr.includes(t)                                           // iQuote #
    );
  }), [items, q, tab]);

  const myUserId = currentUser?.id;

  const openInPlace = async (it, force = false) => {
    // Sent-quote guard: re-opening one of YOUR OWN already-sent estimates warns
    // before letting an edit overwrite the sent version (offers Duplicate).
    if (tab === "saved" && (!it.owner_id || it.owner_id === myUserId)
        && it.status === "sent" && !force) {
      setSentRow(it);
      return;
    }
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
      ...(tab === "saved" ? {
        quoteId: it.id,
        quoteStatus: it.status || "draft",
        // Hard read-only when the saved quote belongs to a teammate — the
        // estimator must Take Over or Copy before they can edit (option a).
        viewOnly: it.owner_id !== myUserId,
        ownerName: it.owner_id !== myUserId ? (it.owner_name || "another user") : null,
        // Carry the quote's PINNED board-pricing version so recalcs stay FROZEN
        // on the version it was saved under (Board Pricing Freeze).
        pricingVersionId: it.pricing_version_id || null,
        pricingVersionLabel: it.pricing_version_label || null,
        pricingIsCurrent: it.pricing_is_current,
      } : {}),
    };
    // Open in a NEW tab (keeps the current working tab open). For a DRAFT we
    // pass its backend id so auto-save updates it rather than duplicating it;
    // a saved quote loads as a fresh working tab bound to its quoteId.
    loadIntoTab(stateWithMeta, tab === "saved" ? {} : { draftId: it.id });
    pushToast(`Loaded ${it.est_num || it.label || "draft"}${it.owner_id !== myUserId ? ` (view only — ${it.owner_name})` : ""}`, "ok");
    onClose();
  };

  const onTakeOver = async (it) => {
    try {
      const updated = await takeOverQuote(it.id);
      loadIntoTab({ ...(updated.state || {}), quoteId: updated.id, quoteStatus: updated.status || "draft",
        viewOnly: false, ownerName: null,
        pricingVersionId: updated.pricing_version_id || null });
      pushToast(`Took over ${updated.est_num} — you are now the owner`, "ok");
      onClose();
    } catch (e) {
      pushToast(`Take Over failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  const onCopy = async (it) => {
    try {
      const copy = await copyQuote(it.id);
      // A copy is the RE-PRICE path — backend pins it to the ACTIVE version.
      loadIntoTab({ ...(copy.state || {}), quoteId: copy.id, quoteStatus: copy.status || "draft",
        pricingVersionId: copy.pricing_version_id || null });
      pushToast(`Copied ${it.est_num} → new draft (${copy.est_num})`, "ok");
      onClose();
    } catch (e) {
      pushToast(`Copy failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  };

  // Duplicate a quote into a fresh tab WITH A BRAND-NEW estimate number (used by
  // the sent-quote warning + LOQ re-submission flows). Re-prices at current.
  const onDuplicateFresh = async (it) => {
    try {
      const copy = await copyQuote(it.id);
      const initials = (it.state?.estInitials
        || (currentUser?.name || "").split(/\s+/).map((w) => w[0]).join("").slice(0, 4)
        || "SPC").toUpperCase();
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
      pushToast(`Duplicated ${it.est_num} → new quote ${freshEst}`, "ok");
      onClose();
    } catch (e) {
      pushToast(`Duplicate failed: ${e?.response?.data?.detail || e.message}`, "err");
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

  const isAdmin = currentUser?.role === "admin";
  const onDeleteQuoteAdmin = async (it, e) => {
    e?.stopPropagation();
    if (!window.confirm(
      `Permanently DELETE saved quote "${it.est_num}"${it.customer_name ? ` (${it.customer_name})` : ""}?\n\n` +
      `This also removes any attached RFQ files and cannot be undone.`
    )) return;
    try {
      const res = await deleteQuote(it.id);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      pushToast(`Deleted ${it.est_num}${res?.files_purged ? ` + ${res.files_purged} file(s)` : ""}`, "ok");
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
    <Modal title="Load Quote / Draft" onClose={onClose} width={1080} data-testid="modal-load-quote">
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

        <input className="sp-input" placeholder="Search est#, iQuote#, customer, ident, project, item, team, owner…"
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
              display: "grid", gridTemplateColumns: "1fr 0.7fr 1.3fr 0.85fr 1fr 1fr 1fr 0.95fr 200px",
              gap: 8, padding: "6px 10px", borderBottom: "2px solid var(--spot-line)",
              fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em",
            }}>
              <div>Est #</div>
              <div>iQuote #</div>
              <div>Customer</div>
              <div>Owner</div>
              <div>Created</div>
              <div>Updated</div>
              <div>Pricing Version</div>
              <div>Status</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
          )}

          {filtered.map((it) => {
            const isMine = !it.owner_id || it.owner_id === myUserId;
            return tab === "saved" ? (
              <div key={it.id} data-testid={`load-row-${it.id}`}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 0.7fr 1.3fr 0.85fr 1fr 1fr 1fr 0.95fr 200px",
                  gap: 8, padding: "8px 10px",
                  borderBottom: "1px solid var(--spot-line)", alignItems: "center",
                  background: "transparent", transition: "background .12s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--spot-bg3)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <div style={{ fontWeight: 700, color: "var(--spot-text)", fontSize: 11,
                  display: "flex", alignItems: "center", gap: 5, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ wordBreak: "break-all" }} title={it.est_num || ""}>
                    {it.est_num || "(no est#)"}
                  </span>
                  {it.file_count > 0 && (
                    <span data-testid={`load-files-badge-${it.id}`}
                      title={`${it.file_count} attached file${it.file_count === 1 ? "" : "s"}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                        fontSize: 10, fontWeight: 700, color: "#06b6d4",
                        background: "#06b6d418", border: "1px solid #06b6d455",
                        borderRadius: 10, padding: "1px 6px" }}>
                      <Paperclip size={11} /> {it.file_count}
                    </span>
                  )}
                </div>
                <div data-testid={`load-iquote-${it.id}`}
                  style={{ fontSize: 12, color: "var(--spot-text2)", fontVariantNumeric: "tabular-nums",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={(it.state || {}).iquoteNum != null ? String((it.state || {}).iquoteNum) : ""}>
                  {(() => {
                    const v = (it.state || {}).iquoteNum;
                    return v === undefined || v === null || v === "" ? "—" : String(v);
                  })()}
                </div>
                <div style={{ fontSize: 12, color: "var(--spot-text2)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={it.customer_name || (it.state || {}).custName || ""}>
                  {it.customer_name || (it.state || {}).custName || "—"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: ownerTint(it.owner_id) }} />
                  <span style={{ color: isMine ? "var(--spot-accent)" : "var(--spot-text2)",
                    fontWeight: isMine ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isMine ? "You" : (it.owner_name || it.owner_id)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--spot-text3)", whiteSpace: "nowrap" }}>
                  {fmtDT(it.created_at)}
                </div>
                <div style={{ fontSize: 11, color: "var(--spot-text3)", whiteSpace: "nowrap" }}>
                  {fmtDT(it.updated_at)}
                </div>
                <div>
                  {it.pricing_version_label ? (
                    <span data-testid={`load-pricing-badge-${it.id}`}
                      title={it.pricing_is_current
                        ? `Priced on the current board-pricing list (${it.pricing_version_label})`
                        : `Priced on an older board-pricing list (${it.pricing_version_label}). Duplicate to re-price at current rates.`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 11, fontWeight: 600,
                        color: it.pricing_is_current ? "var(--spot-text2)" : "#b8860b",
                        background: it.pricing_is_current ? "transparent" : "#b8860b18",
                        border: `1px solid ${it.pricing_is_current ? "var(--spot-border)" : "#b8860b66"}`,
                        borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>
                      {!it.pricing_is_current && <AlertTriangle size={11} />}
                      {it.pricing_version_label}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>—</span>
                  )}
                </div>
                <div>
                  <StatusPill status={it.status} />
                  {it.status === "sent" && fmtDur(it.created_at, it.sent_at) && (
                    <div data-testid={`load-time-to-send-${it.id}`}
                      style={{ fontSize: 9, color: "var(--spot-text3)", marginTop: 3 }}
                      title={`Created ${fmtDT(it.created_at)} → Sent ${fmtDT(it.sent_at)}`}>
                      {fmtDur(it.created_at, it.sent_at)} to send
                    </div>
                  )}
                </div>
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
                  {isAdmin && (
                    <button className="sp-btn sp-btn-sm" onClick={(e) => onDeleteQuoteAdmin(it, e)}
                      data-testid={`load-action-delete-${it.id}`}
                      title="Admin: permanently delete this quote + its files"
                      style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444",
                               border: "1px solid rgba(239,68,68,0.4)",
                               display: "flex", alignItems: "center", padding: "0 8px" }}>
                      <Trash2 size={13} strokeWidth={2.2} />
                    </button>
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
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--spot-err)"; }}
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

      <SentWarnConfirm
        row={sentRow}
        onCancel={() => setSentRow(null)}
        onDuplicate={() => { const r = sentRow; setSentRow(null); if (r) onDuplicateFresh(r); }}
        onEditAnyway={() => { const r = sentRow; setSentRow(null); if (r) openInPlace(r, true); }} />
    </Modal>
  );
}
