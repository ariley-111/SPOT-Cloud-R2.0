/* eslint-disable */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATE, applyState, deriveInitials } from "../lib/defaults";
import { listDrafts, createDraft, updateDraft, deleteDraft, deleteAllDrafts, reassignParserFiles, copyQuote, takeOverQuote, createQuote, updateQuote, engineManifest, parseRfqPolling, uploadParserFiles } from "../api/spot";
import { useAuth } from "./AuthContext";
import { generateEstNum, uniqueEstNum } from "../lib/format";
import {
  gatherItemState, freshItemState, makeBomItem, applyItemStateTo, healLoadedState,
} from "../lib/mpSchema";

const QuoteCtx = createContext(null);

const INITIALS_KEY = "wf_est_initials";   // matches legacy localStorage key
const ACTIVE_KEY = "spot_active_tab";

// ─── Frozen-quote material-edit detection ───────────────────────────────
// A "frozen" quote is a SAVED quote pinned to an older board-pricing version
// than the currently-active one. Editing a MATERIAL field on it (qty tiers,
// dims, board/production specs, one-time costs, quote type) must warn the
// estimator ONCE per quote-open. Metadata edits (customer, project name,
// notes, est#, status, ship-to) are NOT material and never warn.
const FROZEN_EXCLUDE = new Set([
  // identity / metadata
  "estNum", "estNumAuto", "estInitials", "custName", "custCode", "customerRecord",
  "custRef", "custIdent", "quoteStatus", "quoteId", "pricingVersionId", "rfqContactEmail",
  "pricingVersionLabel", "pricingIsCurrent", "spinOffOrigin", "label",
  // quote-header / address metadata
  "notes", "quoteNotes", "coverLetterNote", "quotePayment", "quoteFOB",
  "quoteValidDays", "quoteExpDays", "quoteShipTo", "shipTo", "destZip",
  "quoteTerms", "quoteValidUntil",
  // UI / transient (anything starting with "_" is also excluded below)
  "activeItemIdx", "exportExclude", "freightDashCache",
]);
const isMaterialKey = (k) =>
  typeof k === "string" && !k.startsWith("_") && !FROZEN_EXCLUDE.has(k);

// A tab is "dirty" (has real estimate work worth keeping) when it carries
// customer / item / dimension / BOM content. A bare est# (auto-stamped on every
// new tab) does NOT count — otherwise blank tabs would prompt on close.
const isTabDirty = (st) => !!(st && (
  st.custName || st.custCode || st.itemDesc || st.custRef || st.poNumber ||
  (st.oneUpW && st.oneUpL) ||
  (Array.isArray(st.bomItems) && st.bomItems.length > 0)
));

const DEFAULT_SEC = {
  job: true, bom: true, qty: true, prod: true, quoteTable: true,
  pricing: false, rates: false, engine: false, files: true, documents: false,
};

function makeBlankTab(label = "New Quote", initials = "") {
  return {
    id: "local-" + Math.random().toString(36).slice(2, 10),
    persisted: false,
    label,
    state: { ...DEFAULT_STATE, estInitials: initials || "" },
    updatedAt: Date.now(),
  };
}

export function QuoteProvider({ children }) {
  const { user } = useAuth();
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [initials, setInitialsState] = useState("");
  const [initialsGateOpen, setInitialsGateOpen] = useState(false);
  const [sec, setSec] = useState(DEFAULT_SEC);
  const [toasts, setToasts] = useState([]);
  // Per-quote RFQ parse jobs, keyed by quoteId. Lifting this above the tabs
  // lets each quote parse INDEPENDENTLY in the background — starting a parse on
  // one quote no longer blocks the others, and switching tabs never cancels an
  // in-flight parse. FilesSec reads/acks its own quote's job. { [qid]:
  // {busy, result, error, matchedQuote, doneAt} }
  const [parseJobs, setParseJobs] = useState({});
  const saveTimers = useRef({});

  // Frozen-quote guardrails: track the active board-pricing version (to detect
  // older-pinned quotes), which tabs have already shown the warning this open,
  // and a brief post-load guard so programmatic recalcs don't false-trigger it.
  const [activePricingVersionId, setActivePricingVersionId] = useState(null);
  const [frozenWarnTabId, setFrozenWarnTabId] = useState(null);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const activeVerRef = useRef(null);
  const frozenWarnedRef = useRef(new Set());
  const frozenGuardRef = useRef({});
  const initialsRef = useRef("");
  const userRef = useRef(null);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { initialsRef.current = initials; }, [initials]);
  useEffect(() => { userRef.current = user; }, [user]);

  // Resolve the currently-active board-pricing version id (manifest with no
  // version arg returns the ACTIVE version). Used to flag frozen (older-pinned)
  // quotes. MUST stay fresh: if an admin activates a new pricing version mid-
  // session, a stale value here inverts the frozen check (new-active quotes
  // would warn, old ones wouldn't). So we also refresh on window focus and
  // expose refreshActiveVersion() for the admin activate flow to call.
  const refreshActiveVersion = useCallback(() => {
    if (!userRef.current) return;
    return engineManifest()
      .then((m) => {
        const id = m?.pricing_version?.id || null;
        activeVerRef.current = id;
        setActivePricingVersionId(id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshActiveVersion();
  }, [user, refreshActiveVersion]);

  useEffect(() => {
    const onFocus = () => refreshActiveVersion();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshActiveVersion]);

  // Fire the frozen-edit warning at most once per quote-open for material edits.
  const checkFrozenEdit = useCallback(() => {
    const av = activeVerRef.current;
    if (!av) return;
    const id = activeIdRef.current;
    const tab = (tabsRef.current || []).find((t) => t.id === id);
    if (!tab) return;
    const st = tab.state || {};
    const frozen = !!st.quoteId && !!st.pricingVersionId && st.pricingVersionId !== av;
    if (!frozen) return;
    if (frozenWarnedRef.current.has(id)) return;
    if (Date.now() < (frozenGuardRef.current[id] || 0)) return;  // post-load settle window
    frozenWarnedRef.current.add(id);
    setFrozenWarnTabId(id);
  }, []);

  const dismissFrozenWarn = useCallback(() => setFrozenWarnTabId(null), []);

  // "Duplicate at current pricing" — clones the quote AS LAST SAVED in the DB
  // (deliberately discarding the in-progress dirty edit) and re-pins it to the
  // ACTIVE pricing version, then loads it into the active tab.
  const duplicateFrozenAtCurrent = useCallback(async () => {
    const id = activeIdRef.current;
    const tab = (tabsRef.current || []).find((t) => t.id === id);
    const qid = tab?.state?.quoteId;
    setFrozenWarnTabId(null);
    if (!qid) return;
    try {
      const copy = await copyQuote(qid);
      // Give the duplicate a FRESH estimate # (don't keep the "-COPY" suffix) and
      // persist it back to the saved copy record so the DB matches the UI.
      const freshEst = uniqueEstNum(initialsRef.current || "", new Set((tabsRef.current || []).map((t) => t.state?.estNum).filter(Boolean)));
      const newState = {
        ...(copy.state || {}),
        estNum: freshEst,
        estNumAuto: false,
        quoteId: copy.id,
        quoteStatus: copy.status || "draft",
        pricingVersionId: copy.pricing_version_id || null,
        pricingVersionLabel: null,
        pricingIsCurrent: true,
      };
      try {
        await updateQuote(copy.id, {
          est_num: freshEst,
          state: newState,
          status: copy.status || "draft",
          customer_code: copy.customer_code || newState.custCode || null,
          customer_name: copy.customer_name || newState.custName || null,
        });
      } catch (_) {}
      // reset warn/guard for this tab (replaceState below also does this)
      replaceStateRef.current(newState);
      pushToast(`Duplicated at current pricing → ${freshEst}`, "ok");
    } catch (e) {
      pushToast(`Duplicate failed — ${e?.response?.data?.detail || e.message}`, "err");
    }
  }, []);
  // replaceState is defined later; hold a ref so the callbacks above can reach it.
  const replaceStateRef = useRef(null);

  // ─── Initials: prefer saved → else derive from user.name → else prompt ───
  useEffect(() => {
    const saved = localStorage.getItem(INITIALS_KEY);
    let resolved = "";
    if (saved && saved !== "SPC") {
      resolved = saved;
    } else if (user?.name) {
      const derived = deriveInitials(user.name);
      if (derived) { resolved = derived; localStorage.setItem(INITIALS_KEY, derived); }
    }
    if (resolved) {
      setInitialsState(resolved);
      // Backfill: any tab that has no est# yet gets one stamped with these
      // initials. Use a running `taken` set so multiple est-less tabs stamped
      // in this single pass don't collide on the same second.
      setTabs((cur) => {
        const taken = new Set(cur.map((t) => t.state?.estNum).filter(Boolean));
        return cur.map((t) => {
          if (t.state.estNum) return t;
          const est = uniqueEstNum(resolved, taken);
          taken.add(est);
          return { ...t, state: { ...t.state, estInitials: resolved, estNum: est } };
        });
      });
    } else {
      setInitialsGateOpen(true);
    }
  }, [user]);

  // ─── Load drafts after initials resolve ───
  useEffect(() => {
    if (!user) return;
    (async () => {
      const initialsNow = localStorage.getItem(INITIALS_KEY) ||
        (user?.name ? deriveInitials(user.name) : "");
      try {
        const drafts = await listDrafts();
        if (drafts && drafts.length > 0) {
          const taken = new Set();
          const remoteTabs = drafts.slice(0, 8).map((d) => {
            const st = healLoadedState(applyState(d.state || {}));
            // Backfill: stamp est# on any draft missing one (running `taken`
            // set prevents same-second collisions across multiple drafts).
            if (!st.estNum && initialsNow) {
              st.estNum = uniqueEstNum(initialsNow, taken);
              st.estInitials = initialsNow;
            }
            if (st.estNum) taken.add(st.estNum);
            return {
              id: d.id, persisted: true,
              label: d.label || d.est_num || "Draft",
              state: st,
              updatedAt: Date.parse(d.updated_at || "") || Date.now(),
            };
          });
          setTabs(remoteTabs);
          setActiveId(remoteTabs[0].id);
        } else {
          const blank = makeBlankTab("New Quote", initialsNow);
          if (initialsNow) blank.state.estNum = generateEstNum(initialsNow);
          blank.state.estInitials = initialsNow;
          setTabs([blank]);
          setActiveId(blank.id);
        }
      } catch (_) {
        const blank = makeBlankTab("New Quote", initialsNow);
        if (initialsNow) blank.state.estNum = generateEstNum(initialsNow);
        blank.state.estInitials = initialsNow;
        setTabs([blank]);
        setActiveId(blank.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);

  const active = useMemo(() => tabs.find((t) => t.id === activeId) || tabs[0], [tabs, activeId]);

  const pushToast = useCallback((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, msg, kind }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  }, []);

  // ─── Field setters ──────────────────────────────────────────
  const setField = useCallback((key, value) => {
    setTabs((cur) => cur.map((t) =>
      t.id === activeId ? { ...t, state: { ...t.state, [key]: value }, updatedAt: Date.now() } : t
    ));
    if (isMaterialKey(key)) checkFrozenEdit();
  }, [activeId, checkFrozenEdit]);

  const setManyFields = useCallback((patch) => {
    setTabs((cur) => cur.map((t) =>
      t.id === activeId ? { ...t, state: { ...t.state, ...patch }, updatedAt: Date.now() } : t
    ));
    if (Object.keys(patch || {}).some(isMaterialKey)) checkFrozenEdit();
  }, [activeId, checkFrozenEdit]);

  // ─── Pricing-mode toggle with smart qty handling ─────────────
  // Individual → Matched Set: gather union of all unique component qtys,
  //   sort ascending, write to top-level qtys. Snapshot prior state.
  // Matched Set → Individual: restore the snapshot if present.
  const setPricingMode = useCallback((next) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const s = t.state || {};
      const curMode = s.pricingMode || "Matched Set";
      if (curMode === next) return t;
      if (next === "Matched Set") {
        // Snapshot current active item's edits FIRST so they don't get lost
        const activeIdx = s.activeItemIdx ?? 0;
        const currSnap = (s.bomItems || []).length > 0
          ? gatherItemState(s, s.bomItems[activeIdx]?.state) : null;
        const items = (s.bomItems || []).map((bi, i) => i === activeIdx && currSnap
          ? { ...bi, state: currSnap, desc: currSnap.itemDesc || bi.desc || "", custIdent: currSnap.custIdent || bi.custIdent || "" }
          : bi);
        const snapshot = {
          qtys: Array.isArray(s.qtys) ? [...s.qtys] : ["", "", "", "", ""],
          bomQtys: items.map((bi) => Array.isArray(bi.state?.qtys) ? [...bi.state.qtys] : []),
        };
        // Union of all unique numeric qtys across all components' state.qtys, sorted ascending
        const seen = new Set();
        items.forEach((bi) => {
          (bi.state?.qtys || []).forEach((q) => {
            const n = Number(q);
            if (n > 0 && Number.isFinite(n)) seen.add(n);
          });
        });
        // Also include any top-level qtys that are already populated
        (s.qtys || []).forEach((q) => {
          const n = Number(q);
          if (n > 0 && Number.isFinite(n)) seen.add(n);
        });
        const unioned = Array.from(seen).sort((a, b) => a - b).map((n) => String(n));
        const padded = [...unioned, ...Array(Math.max(0, 5 - unioned.length)).fill("")];
        return {
          ...t,
          state: {
            ...s,
            bomItems: items,
            pricingMode: "Matched Set",
            qtys: unioned.length > 0 ? padded : snapshot.qtys,
            _individualSnapshot: snapshot,
          },
          updatedAt: Date.now(),
        };
      }
      // Restore individual
      const snap = s._individualSnapshot;
      if (snap && Array.isArray(snap.bomQtys) && snap.bomQtys.length === (s.bomItems || []).length) {
        const restoredBom = (s.bomItems || []).map((bi, i) => ({
          ...bi,
          state: { ...(bi.state || {}), qtys: snap.bomQtys[i] || bi.state?.qtys || ["", "", "", "", ""] },
        }));
        // Also restore the active item's TOP-LEVEL qtys from its restored state
        const activeIdx = s.activeItemIdx ?? 0;
        const activeQtys = restoredBom[activeIdx]?.state?.qtys || snap.qtys;
        return {
          ...t,
          state: {
            ...s,
            pricingMode: "Individual",
            qtys: activeQtys,
            bomItems: restoredBom,
            _individualSnapshot: null,
          },
          updatedAt: Date.now(),
        };
      }
      return { ...t, state: { ...s, pricingMode: "Individual" }, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Reset-first state apply: replace the active tab's state completely. */
  const replaceState = useCallback((nextState) => {
    // Loading a quote resets the frozen-warn state for this tab and starts a
    // brief settle window so the initial recompute/auto-flip doesn't false-fire.
    const id = activeId;
    if (id) {
      frozenWarnedRef.current.delete(id);
      frozenGuardRef.current[id] = Date.now() + 2500;
    }
    setTabs((cur) => cur.map((t) =>
      t.id === activeId ? { ...t, state: applyState(nextState), updatedAt: Date.now() } : t
    ));
  }, [activeId]);
  replaceStateRef.current = replaceState;

  // ─── View-only escape hatches ───────────────────────────────
  //  Take Over (become owner of the same quote) or Copy (clone to a new draft
  //  at current pricing). Both clear viewOnly so the form unlocks.
  const takeOverActive = useCallback(async () => {
    const st = (tabsRef.current || []).find((t) => t.id === activeIdRef.current)?.state || {};
    if (!st.quoteId) return;
    try {
      const updated = await takeOverQuote(st.quoteId);
      replaceStateRef.current({
        ...(updated.state || {}),
        quoteId: updated.id,
        quoteStatus: updated.status || "draft",
        pricingVersionId: updated.pricing_version_id || null,
        viewOnly: false, ownerName: null,
      });
      pushToast(`Took over ${updated.est_num} — you are now the owner`, "ok");
    } catch (e) {
      pushToast(`Take Over failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  }, [pushToast]);

  const copyActive = useCallback(async () => {
    const st = (tabsRef.current || []).find((t) => t.id === activeIdRef.current)?.state || {};
    if (!st.quoteId) return;
    try {
      const copy = await copyQuote(st.quoteId);
      replaceStateRef.current({
        ...(copy.state || {}),
        quoteId: copy.id,
        quoteStatus: copy.status || "draft",
        pricingVersionId: copy.pricing_version_id || null,
        viewOnly: false, ownerName: null,
      });
      pushToast(`Copied to a new draft (${copy.est_num})`, "ok");
    } catch (e) {
      pushToast(`Copy failed: ${e?.response?.data?.detail || e.message}`, "err");
    }
  }, [pushToast]);


  // ─── Auto-save (debounced 1.5s) ─────────────────────────────
  useEffect(() => {
    if (!active) return;
    // View-only (teammate's) quotes never autosave — they must NOT silently
    // fork a personal draft. The estimator clicks Take Over or Copy to edit.
    if (active.state?.viewOnly) return;
    if (saveTimers.current[active.id]) clearTimeout(saveTimers.current[active.id]);
    saveTimers.current[active.id] = setTimeout(async () => {
      try {
        const hasContent = active.state.estNum || active.state.itemDesc || active.state.custName ||
          (active.state.oneUpW && active.state.oneUpL);
        if (active.persisted) {
          await updateDraft(active.id, {
            label: active.label, est_num: active.state.estNum || null, state: active.state,
          });
        } else if (hasContent) {
          const created = await createDraft({ label: active.label, state: active.state });
          const oldId = active.id;
          setTabs((cur) => cur.map((t) => t.id === oldId ? { ...t, id: created.id, persisted: true } : t));
          // Keep activeId in sync if the promoted tab was the active one — otherwise
          // useMemo(active) will fall back to tabs[0] and the new tab will appear to "vanish".
          setActiveId((cur) => cur === oldId ? created.id : cur);
          // Migrate any parser files that were uploaded against the transient
          // local-tab id so they're still findable under the new draft id.
          // (Bug fix 2026-02-15: files orphaned on save+reload.)
          try { await reassignParserFiles(oldId, created.id); } catch (_) {}
        }
      } catch (_) {}
    }, 1500);
    return () => clearTimeout(saveTimers.current[active.id]);
  }, [active]);

  // ─── Tab actions ────────────────────────────────────────────
  /** Create a TRULY blank new tab — no state carryover from any other tab.
   *  Only the user's initials and a fresh est# are pre-stamped. */
  const newTab = useCallback(() => {
    const id = "local-" + Math.random().toString(36).slice(2, 10);
    setTabs((cur) => {
      const taken = new Set(cur.map((t) => t.state?.estNum).filter(Boolean));
      const fresh = {
        id,
        persisted: false,
        label: "New Quote",
        state: {
          ...DEFAULT_STATE,                                    // EXPLICIT blank — no merging
          estInitials: initials || "",
          estNum: initials ? uniqueEstNum(initials, taken) : "",
          estNumAuto: true,
        },
        updatedAt: Date.now(),
      };
      return [...cur, fresh];
    });
    setActiveId(id);
  }, [initials]);

  const closeTab = useCallback(async (id) => {
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    if (target.persisted) { try { await deleteDraft(id); } catch (_) {} }
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id);
      if (next.length === 0) return [makeBlankTab("New Quote", initials)];
      return next;
    });
    setActiveId((cur) => cur === id ? null : cur);
  }, [tabs, initials]);

  useEffect(() => {
    if (!activeId && tabs.length > 0) setActiveId(tabs[0].id);
  }, [tabs, activeId]);

  // Delete a draft by id (works whether or not it's an open tab). Removes the
  // backend draft + its parser files, and drops the tab from the bar if open.
  const deleteDraftById = useCallback(async (id) => {
    try { await deleteDraft(id); } catch (_) {}
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id);
      return next.length === 0 ? [makeBlankTab("New Quote", initials)] : next;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, [initials]);

  // Delete ALL of the user's drafts and reset to a single blank tab.
  const clearAllDrafts = useCallback(async () => {
    try { await deleteAllDrafts(); } catch (_) {}
    const blank = makeBlankTab("New Quote", initials);
    setTabs([blank]);
    setActiveId(blank.id);
  }, [initials]);

  // Defensive backfill: if any tab is missing an est#, stamp one. This catches
  // the rare case (reported by Rich in prod, Edge browser) where a tab was
  // created during the initials-resolve window and never got an est#.
  useEffect(() => {
    setTabs((cur) => {
      let changed = false;
      const taken = new Set(cur.map((t) => t.state?.estNum).filter(Boolean));
      const next = cur.map((t) => {
        if (t.state?.estNum) return t;
        changed = true;
        const est = uniqueEstNum(initials, taken);
        taken.add(est);
        return { ...t, state: { ...t.state, estNum: est, estNumAuto: true } };
      });
      return changed ? next : cur;
    });
  }, [activeId, initials]);

  const duplicateTab = useCallback(() => {
    if (!active) return;
    const id = "local-" + Math.random().toString(36).slice(2, 10);
    setTabs((cur) => {
      const taken = new Set(cur.map((t) => t.state?.estNum).filter(Boolean));
      const tab = {
        id,
        persisted: false,
        label: `${active.label} (copy)`,
        state: { ...active.state, estNum: initials ? uniqueEstNum(initials, taken) : "" },
        updatedAt: Date.now(),
      };
      return [...cur, tab];
    });
    setActiveId(id);
    pushToast("Duplicated", "ok");
  }, [active, initials, pushToast]);

  // ─── Load a quote/draft into a tab (keeps the current working tab open) ──
  //  Smart placement: focus an already-open draft, else reuse the current tab
  //  ONLY if it's an empty/untouched local tab, else open a fresh tab.
  //  `opts.draftId` (set when loading an existing DRAFT) preserves the backend
  //  draft id so auto-save UPDATES it instead of creating a duplicate.
  const loadIntoTab = useCallback((nextState, opts = {}) => {
    const applied = healLoadedState(applyState(nextState));
    const label = nextState.custRef || nextState.itemDesc || nextState.custName || nextState.estNum || "Loaded";
    const settle = (id) => { frozenWarnedRef.current.delete(id); frozenGuardRef.current[id] = Date.now() + 2500; };

    if (opts.draftId) {
      // Already open as a tab → just focus it (no duplicate).
      const existing = (tabsRef.current || []).find((t) => t.id === opts.draftId);
      if (existing) { setActiveId(existing.id); return; }
      // Add a tab bound to the real draft id; drop the current tab if it's an
      // empty local scratch tab so we don't leave a stray blank behind.
      settle(opts.draftId);
      const cur = (tabsRef.current || []).find((t) => t.id === activeId);
      const dropBlank = cur && !cur.persisted && !isTabDirty(cur.state);
      const fresh = { id: opts.draftId, persisted: true, label, state: applied, updatedAt: Date.now() };
      setTabs((list) => [...(dropBlank ? list.filter((t) => t.id !== cur.id) : list), fresh]);
      setActiveId(opts.draftId);
      return;
    }

    // Saved-quote / copy load → reuse a blank untouched local tab if present.
    const cur = (tabsRef.current || []).find((t) => t.id === activeId);
    if (cur && !cur.persisted && !isTabDirty(cur.state)) {
      settle(cur.id);
      setTabs((list) => list.map((t) => t.id === cur.id
        ? { ...t, label, state: applied, updatedAt: Date.now() } : t));
      return;
    }
    const id = "local-" + Math.random().toString(36).slice(2, 10);
    settle(id);
    setTabs((list) => [...list, { id, persisted: false, label, state: applied, updatedAt: Date.now() }]);
    setActiveId(id);
  }, [activeId]);

  // ─── Close-with-prompt ──────────────────────────────────────
  //  TabBar's × calls requestCloseTab. Empty tabs close immediately; tabs with
  //  real content open a Save / Discard / Cancel prompt so work isn't lost.
  const [closePromptId, setClosePromptId] = useState(null);

  const _removeTab = useCallback((id) => {
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id);
      return next.length === 0 ? [makeBlankTab("New Quote", initials)] : next;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, [initials]);

  const requestCloseTab = useCallback((id) => {
    const target = (tabsRef.current || []).find((t) => t.id === id);
    if (!target) return;
    if (!isTabDirty(target.state)) {
      if (target.persisted) { try { deleteDraft(id); } catch (_) {} }
      _removeTab(id);
      return;
    }
    setClosePromptId(id);
  }, [_removeTab]);

  const cancelClose = useCallback(() => setClosePromptId(null), []);

  const discardCloseTab = useCallback((id) => {
    const target = (tabsRef.current || []).find((t) => t.id === id);
    if (target?.persisted) { try { deleteDraft(id); } catch (_) {} }
    _removeTab(id);
    setClosePromptId(null);
  }, [_removeTab]);

  const saveAndCloseTab = useCallback(async (id) => {
    const target = (tabsRef.current || []).find((t) => t.id === id);
    if (!target) { setClosePromptId(null); return; }
    const st = target.state || {};
    try {
      const body = {
        est_num: st.estNum || `DRAFT-${Date.now()}`,
        label: st.custRef || st.itemDesc || st.custName || "Untitled",
        state: st, status: st.quoteStatus || "draft",
        customer_code: st.custCode || null, customer_name: st.custName || null,
      };
      const saved = st.quoteId ? await updateQuote(st.quoteId, body) : await createQuote(body);
      // Migrate any RFQ files staged under the tab id → the saved quote id.
      try { if (!st.quoteId && saved.id && target.id !== saved.id) await reassignParserFiles(target.id, saved.id); } catch (_) {}
      pushToast(`Saved ${saved.est_num || st.estNum || "quote"}`, "ok");
    } catch (e) {
      pushToast(`Save failed: ${e?.response?.data?.detail || e.message}`, "err");
      return;  // keep the tab + prompt open so the user can retry
    }
    if (target.persisted) { try { await deleteDraft(id); } catch (_) {} }
    _removeTab(id);
    setClosePromptId(null);
  }, [_removeTab, pushToast]);

  // ─── Multi-Part actions ─────────────────────────────────────
  //   Active-item mirror: the top-level state always reflects the currently active
  //   BOM item. When the user switches items we snapshot the current item-level
  //   slice into bomItems[oldIdx].state and load target.state at top-level.
  //   See /app/frontend/src/lib/mpSchema.js for field segregation.

  /** Switch which BOM item is active (snapshots current, loads target).
   *
   *  Bug fix (2026-02): when user edits `itemDesc` / `custIdent` they're
   *  written to TOP-LEVEL state only — never to the per-BOM-item
   *  `bi.desc` / `bi.custIdent` fields. On switch-away we now also sync
   *  those fields so the BOM tab labels stay accurate AND so a future
   *  switch-back doesn't fall through to stale `bi.desc`. */
  const switchBomItem = useCallback((newIdx) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      const oldIdx = t.state.activeItemIdx ?? 0;
      if (newIdx === oldIdx || !items[newIdx]) return t;
      // Snapshot current top-level item-level fields into the outgoing item
      const snap = gatherItemState(t.state, items[oldIdx]?.state);
      const target = items[newIdx];
      const itemsSaved = items.map((it, i) => (i === oldIdx ? {
        ...it,
        state: snap,
        // Keep the BOM-item-level desc/custIdent in sync with the user's edits
        // so they don't clobber state on switch-back.
        desc: snap.itemDesc || it.desc || "",
        custIdent: snap.custIdent || it.custIdent || "",
      } : it));
      // Apply target.state at top-level (reset-first), also mirror desc/custIdent.
      // Prefer the saved state values over the BOM-item-level labels — the state
      // is the user's latest input; the BOM label is just a cached display value.
      const next = applyItemStateTo(t.state, target.state || freshItemState());
      next.bomItems = itemsSaved;
      next.activeItemIdx = newIdx;
      next.itemDesc = target.state?.itemDesc || target.desc || "";
      next.custIdent = target.state?.custIdent || target.custIdent || "";
      return { ...t, state: next, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Add a new blank BOM item. Snapshots current active first. */
  const addBomItem = useCallback((opts = {}) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      const oldIdx = t.state.activeItemIdx ?? 0;
      // Snapshot current item-level fields into the outgoing item (if any) and
      // sync the BOM-item-level desc/custIdent so tab labels stay accurate.
      const snap = items.length > 0 ? gatherItemState(t.state) : null;
      const itemsSaved = items.length > 0
        ? items.map((it, i) => (i === oldIdx ? {
            ...it,
            state: snap,
            desc: snap.itemDesc || it.desc || "",
            custIdent: snap.custIdent || it.custIdent || "",
          } : it))
        : items;
      const desc = opts.desc || `Item ${itemsSaved.length + 1}`;
      const fresh = freshItemState({ itemDesc: desc });
      const newItem = makeBomItem({ desc, type: opts.type || "Manufactured",
        pcsPerSet: opts.pcsPerSet || 1, state: fresh });
      const newItems = [...itemsSaved, newItem];
      const next = applyItemStateTo(t.state, fresh);
      next.bomItems = newItems;
      next.activeItemIdx = newItems.length - 1;
      next.itemDesc = desc;
      next.custIdent = "";
      return { ...t, state: next, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Duplicate the currently active BOM item. */
  const duplicateBomItem = useCallback(() => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      const oldIdx = t.state.activeItemIdx ?? 0;
      if (!items[oldIdx]) return t;
      // Snapshot current first — also sync BOM-item-level desc/custIdent.
      const snap = gatherItemState(t.state, items[oldIdx]?.state);
      const itemsSaved = items.map((it, i) => (i === oldIdx ? {
        ...it,
        state: snap,
        desc: snap.itemDesc || it.desc || "",
        custIdent: snap.custIdent || it.custIdent || "",
      } : it));
      const src = itemsSaved[oldIdx];
      const copy = makeBomItem({
        desc: `${src.desc} (copy)`, type: src.type, pcsPerSet: src.pcsPerSet,
        custIdent: src.custIdent, state: { ...src.state },
      });
      const newItems = [...itemsSaved.slice(0, oldIdx + 1), copy, ...itemsSaved.slice(oldIdx + 1)];
      const newIdx = oldIdx + 1;
      const next = applyItemStateTo(t.state, copy.state);
      next.bomItems = newItems;
      next.activeItemIdx = newIdx;
      next.itemDesc = copy.desc;
      next.custIdent = copy.custIdent || "";
      return { ...t, state: next, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Remove a BOM item. Refuses if it's the last one. */
  const removeBomItem = useCallback((idx) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      if (items.length <= 1 || !items[idx]) return t;
      const oldIdx = t.state.activeItemIdx ?? 0;
      // If removing the active item, save current draft into the to-be-removed entry first
      // (no-op) and pick a new active = clamp to remaining length.
      const newItems = items.filter((_, i) => i !== idx);
      const newIdx = idx === oldIdx
        ? Math.min(idx, newItems.length - 1)
        : (idx < oldIdx ? oldIdx - 1 : oldIdx);
      const target = newItems[newIdx];
      const next = applyItemStateTo(t.state, target.state || freshItemState());
      next.bomItems = newItems;
      next.activeItemIdx = newIdx;
      // Prefer the saved state values over BOM-item labels (which can be stale)
      next.itemDesc = target.state?.itemDesc || target.desc || "";
      next.custIdent = target.state?.custIdent || target.custIdent || "";
      return { ...t, state: next, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Reorder a BOM item from `from` index to `to` index. Keeps activeItemIdx pointing
   *  at the same logical item after the move. */
  const reorderBomItem = useCallback((from, to) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = (t.state.bomItems || []).slice();
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return t;
      const oldIdx = t.state.activeItemIdx ?? 0;
      // Snapshot current active first (so we don't lose unsaved edits) — also
      // sync desc/custIdent at the BOM-item level so tab labels stay accurate.
      const snap = gatherItemState(t.state, items[oldIdx]?.state);
      items[oldIdx] = {
        ...items[oldIdx],
        state: snap,
        desc: snap.itemDesc || items[oldIdx].desc || "",
        custIdent: snap.custIdent || items[oldIdx].custIdent || "",
      };
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      // Translate activeItemIdx
      let newActive = oldIdx;
      if (from === oldIdx) newActive = to;
      else if (from < oldIdx && to >= oldIdx) newActive = oldIdx - 1;
      else if (from > oldIdx && to <= oldIdx) newActive = oldIdx + 1;
      return { ...t, state: { ...t.state, bomItems: items, activeItemIdx: newActive }, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Update a property on the active item's BOM entry (desc, type, pcsPerSet, custIdent). */
  const updateBomItem = useCallback((idx, patch) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      if (!items[idx]) return t;
      const next = items.map((it, i) => i === idx ? { ...it, ...patch } : it);
      const upd = { ...t.state, bomItems: next };
      // If we're updating the active item's desc/custIdent, mirror to top-level
      if (idx === (t.state.activeItemIdx ?? 0)) {
        if ("desc" in patch) upd.itemDesc = patch.desc;
        if ("custIdent" in patch) upd.custIdent = patch.custIdent;
      }
      return { ...t, state: upd, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Update per-item STATE fields (e.g. cuttingDieCost, dieTreatment, freightLine)
   *  on any BOM item — active or inactive. For the active item the change is
   *  written to top-level state (where item-level fields live during the active
   *  session); for inactive items it's written to bomItems[idx].state, where it
   *  will load when the user switches to that tab.
   *  Used by BOM-tab inline editors (Die chip, etc.) that match legacy parity. */
  const updateBomItemState = useCallback((idx, patch) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      if (!items[idx]) return t;
      const activeIdx = t.state.activeItemIdx ?? 0;
      if (idx === activeIdx) {
        // Write directly to top-level state for the active item.
        return { ...t, state: { ...t.state, ...patch }, updatedAt: Date.now() };
      }
      // Inactive: merge into bomItems[idx].state.
      const next = items.map((it, i) => i === idx
        ? { ...it, state: { ...(it.state || {}), ...patch } }
        : it);
      return { ...t, state: { ...t.state, bomItems: next }, updatedAt: Date.now() };
    }));
  }, [activeId]);

  /** Convert the current Simple quote → Multi-Part. If `bomDraft` is provided
   *  (array of `{desc, type, pcsPerSet, custIdent?}`), the BOM is built from
   *  the draft and the current intake becomes Item 1's state-template.
   *  Otherwise the current Simple state becomes a single MFG item. */
  const convertToMultiPart = useCallback((bomDraft = null, opts = {}) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const snap = gatherItemState(t.state);
      let items;
      if (Array.isArray(bomDraft) && bomDraft.length > 0) {
        // Build from BOM Builder draft — each row gets a fresh item state,
        // seeded with shared common fields from the current intake so flute,
        // grade, liners, etc. carry through as defaults the estimator can tweak.
        // If a row carries an `existingState` (re-saved from BOM Builder for
        // an existing MP quote), preserve that state verbatim except for the
        // default qtys override — so dimensions / rule inches / box style /
        // print spec are kept across re-saves. (Bug fix 2026-02-15)
        const seed = {
          flute: snap.flute, boardGrade: snap.boardGrade,
          outsideLiner: snap.outsideLiner, insideLiner: snap.insideLiner, medium: snap.medium,
          printReq: snap.printReq, printMode: snap.printMode, printSides: snap.printSides,
          colorsFront: snap.colorsFront, colorsBack: snap.colorsBack, whiteInk: snap.whiteInk,
          cadDifficulty: snap.cadDifficulty,
          qtys: opts.defaultQtys || snap.qtys || ["", "", "", "", ""],
        };
        items = bomDraft.map((row, i) => {
          let nextState;
          if (row.existingState) {
            // Preserve everything from the existing item state, but apply the
            // new default-qtys array if the user changed it in the builder.
            const qtysToUse = opts.defaultQtys
              ? opts.defaultQtys.slice(0, 5)
              : (row.existingState.qtys || ["", "", "", "", ""]);
            nextState = {
              ...row.existingState,
              qtys: qtysToUse,
              itemDesc: row.desc || row.existingState.itemDesc || `Item ${i + 1}`,
            };
          } else {
            nextState = freshItemState({ ...seed, itemDesc: row.desc || `Item ${i + 1}` });
          }
          return makeBomItem({
            desc: row.desc || `Item ${i + 1}`,
            type: row.type || "Manufactured",
            pcsPerSet: row.pcsPerSet || row.pcs || 1,
            custIdent: row.custIdent || "",
            state: nextState,
          });
        });
      } else {
        // Convert existing Simple intake to Item 1
        if (t.state.quoteType === "Multi-Part") return t;
        items = [makeBomItem({
          desc: t.state.itemDesc || "Item 1",
          type: "Manufactured", pcsPerSet: 1,
          custIdent: t.state.custIdent || "",
          state: snap,
        })];
      }
      const newState = applyItemStateTo(t.state, items[0].state);
      newState.quoteType = "Multi-Part";
      newState.pricingMode = t.state.pricingMode || "Matched Set";
      newState.bomItems = items;
      newState.activeItemIdx = 0;
      newState.itemDesc = items[0].desc;
      newState.custIdent = items[0].custIdent || "";
      if (opts.defaultQtys) newState.qtys = opts.defaultQtys.slice(0, 5);
      return { ...t, state: newState, updatedAt: Date.now() };
    }));
    pushToast(bomDraft ? `Built ${bomDraft.length} components` : "Converted to Multi-Part", "ok");
  }, [activeId, pushToast]);

  /** Convert Multi-Part → Simple. Only allowed if there's exactly one item.
   *  If multiple, the user must spin them off or delete first. */
  const convertToSimple = useCallback(() => {
    let blocked = false;
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      if (t.state.quoteType !== "Multi-Part") return t;
      const items = t.state.bomItems || [];
      if (items.length > 1) { blocked = true; return t; }
      // Collapse Item 1 (or empty) into top-level
      const first = items[0]?.state || gatherItemState(t.state);
      const next = applyItemStateTo(t.state, first);
      next.quoteType = "Simple";
      next.pricingMode = "Individual";
      next.bomItems = [];
      next.activeItemIdx = 0;
      next.itemDesc = items[0]?.desc || t.state.itemDesc || "";
      next.custIdent = items[0]?.custIdent || t.state.custIdent || "";
      return { ...t, state: next, updatedAt: Date.now() };
    }));
    if (blocked) {
      pushToast("Cannot convert — remove extra components first", "warn");
      return false;
    }
    pushToast("Converted to Simple", "ok");
    return true;
  }, [activeId, pushToast]);

  /** MP-6: Spin off a single BOM component into a new Simple tab.
   *  Useful when one component of a display should be priced & sent as a standalone
   *  quote. Mirrors legacy spinOffSingleItem (spot_r1_5.jsx ~L3187+). */
  const spinOffBomItem = useCallback((idx) => {
    const cur = tabs.find((t) => t.id === activeId);
    if (!cur) return;
    const items = cur.state.bomItems || [];
    const target = items[idx];
    if (!target) return;
    // Build the Simple-tab state from the item's saved state, carrying over
    // estimator + customer identity from the parent quote.
    const newState = applyItemStateTo({ ...DEFAULT_STATE }, target.state || freshItemState());
    newState.estInitials = cur.state.estInitials || "";
    newState.estNum = initials ? uniqueEstNum(initials, new Set(tabs.map((t) => t.state?.estNum).filter(Boolean))) : "";
    newState.estNumAuto = true;
    newState.custName = cur.state.custName || "";
    newState.custCode = cur.state.custCode || "";
    newState.custRef = cur.state.custRef || "";
    newState.customerRecord = cur.state.customerRecord || null;
    newState.itemDesc = target.desc || newState.itemDesc || "";
    newState.custIdent = target.custIdent || newState.custIdent || "";
    newState.quoteType = "Simple";
    newState.pricingMode = "Individual";
    newState.bomItems = [];
    newState.activeItemIdx = 0;
    newState.spinOffOrigin = `${cur.state.estNum || "—"} · ${target.desc || ""}`;
    const newTabRecord = {
      id: "local-" + Math.random().toString(36).slice(2, 10),
      persisted: false,
      label: `${target.desc || `Item ${idx+1}`} (spin-off)`,
      state: newState,
      updatedAt: Date.now(),
    };
    setTabs((c) => [...c, newTabRecord]);
    setActiveId(newTabRecord.id);
    pushToast(`Spun off "${target.desc || `Item ${idx+1}`}" as new tab`, "ok");
  }, [tabs, activeId, initials, pushToast]);

  // ─── Initials commit ────────────────────────────────────────
  const commitInitials = useCallback((raw) => {
    const v = (raw || "").trim().toUpperCase().slice(0, 4);
    if (v.length < 2) return false;
    if (v === "SPC") { pushToast("SPC is reserved for system estimates", "warn"); return false; }
    setInitialsState(v);
    localStorage.setItem(INITIALS_KEY, v);
    setInitialsGateOpen(false);
    // Push into active tab if it has no estNum
    setTabs((cur) => {
      const taken = new Set(cur.map((t) => t.state?.estNum).filter(Boolean));
      return cur.map((t) => {
        const next = { ...t.state, estInitials: v };
        if (!t.state.estNum) { next.estNum = uniqueEstNum(v, taken); taken.add(next.estNum); }
        return { ...t, state: next, updatedAt: Date.now() };
      });
    });
    return true;
  }, [pushToast]);

  // ─── Sections expand/collapse ───────────────────────────────
  const toggleSec = useCallback((key) => setSec((s) => ({ ...s, [key]: !s[key] })), []);
  const expandAll = useCallback(() => setSec((s) => Object.fromEntries(Object.keys(s).map((k) => [k, true]))), []);
  const collapseAll = useCallback(() => setSec((s) => Object.fromEntries(Object.keys(s).map((k) => [k, false]))), []);

  /** Mirror the current top-level item-level fields into `bomItems[activeItemIdx].state`.
   *  Called before opening the BOM Builder so any unsaved edits on the active
   *  item (e.g. dimensions typed but no tab switch since) are captured in the
   *  per-item state the builder reads from. (Bug fix 2026-02-15) */
  const snapshotActiveItemState = useCallback(() => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== activeId) return t;
      const items = t.state.bomItems || [];
      if (items.length === 0) return t;
      const idx = t.state.activeItemIdx ?? 0;
      if (!items[idx]) return t;
      const snap = gatherItemState(t.state, items[idx]?.state);
      const itemsNext = items.map((it, i) => i === idx ? {
        ...it,
        state: snap,
        desc: snap.itemDesc || it.desc || "",
        custIdent: snap.custIdent || it.custIdent || "",
      } : it);
      return { ...t, state: { ...t.state, bomItems: itemsNext }, updatedAt: Date.now() };
    }));
  }, [activeId]);

  // ─── Per-quote RFQ parse jobs (background, non-blocking) ──────────────
  const _setParseJob = useCallback((qid, patch) => {
    setParseJobs((prev) => ({ ...prev, [qid]: { ...(prev[qid] || {}), ...patch } }));
  }, []);
  const startParse = useCallback(async (quoteId, rfqFiles, extras, opts) => {
    if (!quoteId || !rfqFiles || rfqFiles.length === 0) return;
    _setParseJob(quoteId, { busy: true, error: "", result: null, matchedQuote: null, startedAt: Date.now() });
    try {
      const r = await parseRfqPolling(rfqFiles, "", "", opts || {});
      if (extras && extras.length) { try { await uploadParserFiles(extras, quoteId); } catch (_) {} }
      _setParseJob(quoteId, {
        busy: false, result: r,
        matchedQuote: r?.matchedQuote?.id ? r.matchedQuote : null,
        doneAt: Date.now(),
      });
    } catch (e) {
      _setParseJob(quoteId, {
        busy: false, error: e?.response?.data?.detail || e.message, doneAt: Date.now(),
      });
    }
  }, [_setParseJob]);
  // Called by FilesSec once it has surfaced a completed job's result/error, so
  // it isn't re-shown on the next tab switch (the result is held silently until
  // the user returns to that quote, then consumed exactly once).
  const ackParseJob = useCallback((quoteId) => {
    _setParseJob(quoteId, { result: null, error: null, matchedQuote: null });
  }, [_setParseJob]);

  const value = {
    tabs, activeId, active,
    parseJobs, startParse, ackParseJob,
    setActiveId, newTab, closeTab, duplicateTab,
    loadIntoTab,
    closePromptId, requestCloseTab, cancelClose, discardCloseTab, saveAndCloseTab,
    deleteDraftById, clearAllDrafts,
    setField, setManyFields, replaceState, setPricingMode,
    // View-only (teammate quote) read-only lock + escape hatches
    viewOnly: !!active?.state?.viewOnly,
    viewOnlyOwner: active?.state?.ownerName || null,
    takeOverActive, copyActive,
    // Multi-Part actions
    switchBomItem, addBomItem, duplicateBomItem, removeBomItem,
    reorderBomItem, updateBomItem, updateBomItemState, convertToMultiPart, convertToSimple,
    spinOffBomItem, snapshotActiveItemState,
    initials, initialsGateOpen, setInitialsGateOpen, commitInitials,
    sec, toggleSec, expandAll, collapseAll,
    toasts, pushToast,
    // Frozen-quote guardrails
    activePricingVersionId, frozenWarnTabId, dismissFrozenWarn, duplicateFrozenAtCurrent,
    refreshActiveVersion,
  };
  return <QuoteCtx.Provider value={value}>{children}</QuoteCtx.Provider>;
}

export const useQuote = () => useContext(QuoteCtx);
