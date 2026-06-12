/* eslint-disable */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATE, applyState, deriveInitials } from "../lib/defaults";
import { listDrafts, createDraft, updateDraft, deleteDraft } from "../api/spot";
import { useAuth } from "./AuthContext";
import { generateEstNum } from "../lib/format";
import {
  gatherItemState, freshItemState, makeBomItem, applyItemStateTo,
} from "../lib/mpSchema";

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
        const currSnap = (s.bomItems || []).length > 0 ? gatherItemState(s) : null;
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

  // Defensive backfill: if any tab is missing an est#, stamp one. This catches
  // the rare case (reported by Rich in prod, Edge browser) where a tab was
  // created during the initials-resolve window and never got an est#.
  useEffect(() => {
    setTabs((cur) => {
      let changed = false;
      const next = cur.map((t) => {
        if (t.state?.estNum) return t;
        changed = true;
        return { ...t, state: { ...t.state, estNum: generateEstNum(initials), estNumAuto: true } };
      });
      return changed ? next : cur;
    });
  }, [activeId, initials]);

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
      const snap = gatherItemState(t.state);
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
      const snap = gatherItemState(t.state);
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
      const snap = gatherItemState(t.state);
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
        const seed = {
          flute: snap.flute, boardGrade: snap.boardGrade,
          outsideLiner: snap.outsideLiner, insideLiner: snap.insideLiner, medium: snap.medium,
          printReq: snap.printReq, printMode: snap.printMode, printSides: snap.printSides,
          colorsFront: snap.colorsFront, colorsBack: snap.colorsBack, whiteInk: snap.whiteInk,
          cadDifficulty: snap.cadDifficulty,
          qtys: opts.defaultQtys || snap.qtys || ["", "", "", "", ""],
        };
        items = bomDraft.map((row, i) => makeBomItem({
          desc: row.desc || `Item ${i + 1}`,
          type: row.type || "Manufactured",
          pcsPerSet: row.pcsPerSet || row.pcs || 1,
          custIdent: row.custIdent || "",
          state: freshItemState({ ...seed, itemDesc: row.desc || `Item ${i + 1}` }),
        }));
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
    newState.estNum = initials ? generateEstNum(initials) : "";
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
    setField, setManyFields, replaceState, setPricingMode,
    // Multi-Part actions
    switchBomItem, addBomItem, duplicateBomItem, removeBomItem,
    reorderBomItem, updateBomItem, updateBomItemState, convertToMultiPart, convertToSimple,
    spinOffBomItem,
    initials, initialsGateOpen, setInitialsGateOpen, commitInitials,
    sec, toggleSec, expandAll, collapseAll,
    toasts, pushToast,
  };
  return <QuoteCtx.Provider value={value}>{children}</QuoteCtx.Provider>;
}

export const useQuote = () => useContext(QuoteCtx);
