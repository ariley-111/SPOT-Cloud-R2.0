/* eslint-disable */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATE, applyState, deriveInitials } from "../lib/defaults";
import { listDrafts, createDraft, updateDraft, deleteDraft } from "../api/spot";
import { useAuth } from "./AuthContext";
import { generateEstNum } from "../lib/format";

const QuoteCtx = createContext(null);

const INITIALS_KEY = "wf_est_initials";   // matches legacy localStorage key
const ACTIVE_KEY = "spot_active_tab";

const DEFAULT_SEC = {
  job: true, bom: true, qty: true, prod: true, quoteTable: true,
  pricing: false, rates: false, engine: false, files: true,
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
  const saveTimers = useRef({});

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
      // Backfill: any tab that has no est# yet gets one stamped with these initials.
      setTabs((cur) => cur.map((t) => {
        if (t.state.estNum) return t;
        return { ...t, state: { ...t.state, estInitials: resolved, estNum: generateEstNum(resolved) } };
      }));
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
          const remoteTabs = drafts.slice(0, 8).map((d) => {
            const st = applyState(d.state || {});
            // Backfill: stamp est# on any draft missing one
            if (!st.estNum && initialsNow) {
              st.estNum = generateEstNum(initialsNow);
              st.estInitials = initialsNow;
            }
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
  }, [activeId]);

  const setManyFields = useCallback((patch) => {
    setTabs((cur) => cur.map((t) =>
      t.id === activeId ? { ...t, state: { ...t.state, ...patch }, updatedAt: Date.now() } : t
    ));
  }, [activeId]);

  /** Reset-first state apply: replace the active tab's state completely. */
  const replaceState = useCallback((nextState) => {
    setTabs((cur) => cur.map((t) =>
      t.id === activeId ? { ...t, state: applyState(nextState), updatedAt: Date.now() } : t
    ));
  }, [activeId]);

  // ─── Auto-save (debounced 1.5s) ─────────────────────────────
  useEffect(() => {
    if (!active) return;
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
        }
      } catch (_) {}
    }, 1500);
    return () => clearTimeout(saveTimers.current[active.id]);
  }, [active]);

  // ─── Tab actions ────────────────────────────────────────────
  /** Create a TRULY blank new tab — no state carryover from any other tab.
   *  Only the user's initials and a fresh est# are pre-stamped. */
  const newTab = useCallback(() => {
    const fresh = {
      id: "local-" + Math.random().toString(36).slice(2, 10),
      persisted: false,
      label: "New Quote",
      state: {
        ...DEFAULT_STATE,                                    // EXPLICIT blank — no merging
        estInitials: initials || "",
        estNum: initials ? generateEstNum(initials) : "",
        estNumAuto: true,
      },
      updatedAt: Date.now(),
    };
    setTabs((cur) => [...cur, fresh]);
    setActiveId(fresh.id);
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

  const duplicateTab = useCallback(() => {
    if (!active) return;
    const tab = {
      id: "local-" + Math.random().toString(36).slice(2, 10),
      persisted: false,
      label: `${active.label} (copy)`,
      state: { ...active.state, estNum: initials ? generateEstNum(initials) : "" },
      updatedAt: Date.now(),
    };
    setTabs((cur) => [...cur, tab]);
    setActiveId(tab.id);
    pushToast("Duplicated", "ok");
  }, [active, initials, pushToast]);

  // ─── Initials commit ────────────────────────────────────────
  const commitInitials = useCallback((raw) => {
    const v = (raw || "").trim().toUpperCase().slice(0, 4);
    if (v.length < 2) return false;
    if (v === "SPC") { pushToast("SPC is reserved for system estimates", "warn"); return false; }
    setInitialsState(v);
    localStorage.setItem(INITIALS_KEY, v);
    setInitialsGateOpen(false);
    // Push into active tab if it has no estNum
    setTabs((cur) => cur.map((t) => {
      const next = { ...t.state, estInitials: v };
      if (!t.state.estNum) next.estNum = generateEstNum(v);
      return { ...t, state: next, updatedAt: Date.now() };
    }));
    return true;
  }, [pushToast]);

  // ─── Sections expand/collapse ───────────────────────────────
  const toggleSec = useCallback((key) => setSec((s) => ({ ...s, [key]: !s[key] })), []);
  const expandAll = useCallback(() => setSec((s) => Object.fromEntries(Object.keys(s).map((k) => [k, true]))), []);
  const collapseAll = useCallback(() => setSec((s) => Object.fromEntries(Object.keys(s).map((k) => [k, false]))), []);

  const value = {
    tabs, activeId, active,
    setActiveId, newTab, closeTab, duplicateTab,
    setField, setManyFields, replaceState,
    initials, initialsGateOpen, setInitialsGateOpen, commitInitials,
    sec, toggleSec, expandAll, collapseAll,
    toasts, pushToast,
  };
  return <QuoteCtx.Provider value={value}>{children}</QuoteCtx.Provider>;
}

export const useQuote = () => useContext(QuoteCtx);
