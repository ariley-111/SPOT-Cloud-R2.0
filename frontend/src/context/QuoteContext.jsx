/* eslint-disable */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATE, applyState } from "../lib/defaults";
import { listDrafts, createDraft, updateDraft, deleteDraft } from "../api/spot";
import { generateEstNum } from "../lib/format";

const QuoteCtx = createContext(null);

const TAB_STORAGE_KEY = "spot_open_tabs";
const ACTIVE_KEY = "spot_active_tab";
const INITIALS_KEY = "spot_initials";

function makeBlankTab(label = "New Quote") {
  return {
    id: "local-" + Math.random().toString(36).slice(2, 10),
    persisted: false,
    label,
    state: { ...DEFAULT_STATE },
    updatedAt: Date.now(),
  };
}

function loadInitials() { return localStorage.getItem(INITIALS_KEY) || ""; }
function saveInitials(v) { localStorage.setItem(INITIALS_KEY, v); }

export function QuoteProvider({ children }) {
  const [tabs, setTabs] = useState(() => [makeBlankTab("New Quote")]);
  const [activeId, setActiveId] = useState(() => null);
  const [initials, setInitials] = useState(loadInitials);
  const [toasts, setToasts] = useState([]);
  const saveTimers = useRef({});

  // Load drafts on first mount
  useEffect(() => {
    (async () => {
      try {
        const drafts = await listDrafts();
        if (drafts && drafts.length > 0) {
          const remoteTabs = drafts.slice(0, 8).map((d) => ({
            id: d.id, persisted: true,
            label: d.label || d.est_num || "Draft",
            state: applyState(d.state || {}),
            updatedAt: Date.parse(d.updated_at || "") || Date.now(),
          }));
          setTabs(remoteTabs);
          setActiveId(remoteTabs[0].id);
        } else {
          const blank = makeBlankTab("New Quote");
          setTabs([blank]);
          setActiveId(blank.id);
        }
      } catch (_) {
        const blank = makeBlankTab("New Quote");
        setTabs([blank]);
        setActiveId(blank.id);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const active = useMemo(() => tabs.find((t) => t.id === activeId) || tabs[0], [tabs, activeId]);

  const pushToast = useCallback((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, msg, kind }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  }, []);

  /** RESET-FIRST state apply (Rule 7) — replaces the entire state. */
  const replaceState = useCallback((partial) => {
    setTabs((cur) => cur.map((t) => t.id === active.id ? { ...t, state: applyState(partial), updatedAt: Date.now() } : t));
  }, [active]);

  /** Patch a single field — convenience wrapper that still keeps reset-first semantics
   *  by re-applying the new full state through applyState. */
  const setField = useCallback((key, value) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== active.id) return t;
      const next = { ...t.state, [key]: value };
      return { ...t, state: next, updatedAt: Date.now() };
    }));
  }, [active]);

  const setManyFields = useCallback((patch) => {
    setTabs((cur) => cur.map((t) => {
      if (t.id !== active.id) return t;
      return { ...t, state: { ...t.state, ...patch }, updatedAt: Date.now() };
    }));
  }, [active]);

  // ─── Auto-save debounced ───────────────────────────────
  useEffect(() => {
    if (!active) return;
    if (saveTimers.current[active.id]) clearTimeout(saveTimers.current[active.id]);
    saveTimers.current[active.id] = setTimeout(async () => {
      try {
        if (active.persisted) {
          await updateDraft(active.id, {
            label: active.label, est_num: active.state.estNum || null, state: active.state,
          });
        } else if (active.state.estNum || active.state.itemDesc || (active.state.oneUpW && active.state.oneUpL)) {
          const created = await createDraft({ label: active.label, state: active.state });
          setTabs((cur) => cur.map((t) => t.id === active.id ? { ...t, id: created.id, persisted: true } : t));
        }
      } catch (_) {}
    }, 1500);
    return () => clearTimeout(saveTimers.current[active.id]);
  }, [active]);

  const newTab = useCallback(() => {
    const tab = makeBlankTab(`Quote ${tabs.length + 1}`);
    if (initials) tab.state.estNum = generateEstNum(initials);
    setTabs((cur) => [...cur, tab]);
    setActiveId(tab.id);
  }, [tabs.length, initials]);

  const closeTab = useCallback(async (id) => {
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    if (target.persisted) {
      try { await deleteDraft(id); } catch (_) {}
    }
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id);
      if (next.length === 0) return [makeBlankTab("New Quote")];
      return next;
    });
    setActiveId((cur) => cur === id ? null : cur);
  }, [tabs]);

  // After tab list changes, ensure an active id
  useEffect(() => {
    if (!activeId && tabs.length > 0) setActiveId(tabs[0].id);
  }, [tabs, activeId]);

  const renameTab = useCallback((id, label) => {
    setTabs((cur) => cur.map((t) => t.id === id ? { ...t, label } : t));
  }, []);

  const setInitialsPersist = useCallback((v) => {
    const upper = (v || "").toUpperCase();
    if (upper === "SPC") { pushToast("SPC is reserved for system estimates", "warn"); return; }
    setInitials(upper);
    saveInitials(upper);
    // Auto-generate est# if active tab has none
    if (active && (!active.state.estNum || active.state.estNumAuto !== false)) {
      setField("estNum", generateEstNum(upper));
    }
  }, [active, setField, pushToast]);

  const loadDraftIntoActive = useCallback((draftState) => {
    replaceState(draftState);
    pushToast("Quote loaded", "ok");
  }, [replaceState, pushToast]);

  const value = {
    tabs, activeId, active,
    setActiveId, newTab, closeTab, renameTab,
    replaceState, setField, setManyFields,
    initials, setInitials: setInitialsPersist,
    toasts, pushToast,
    loadDraftIntoActive,
  };
  return <QuoteCtx.Provider value={value}>{children}</QuoteCtx.Provider>;
}

export const useQuote = () => useContext(QuoteCtx);
