/* eslint-disable */
/** Multi-Part schema — ports legacy gatherItemState/applyItemState (spot_r1_5.jsx L2675-2774).
 *
 *  Architecture: top-level `state` always holds the ACTIVE item's values in the item-level keys.
 *  When the user switches BOM tab, we snapshot current item-keys → bomItems[oldIdx].state,
 *  then load target.state into the top-level. This mirrors legacy 1:1 and means the existing
 *  ItemSetupSec / ProductionSpecsSec / QuoteTableSec components keep reading/writing
 *  top-level state — they don't need to know about Multi-Part at all.
 *
 *  Field segregation (per dev_handoff/20_Deep_Dive_Multi_Part.md §"Job-level vs item-level"):
 *   - Job-level: identity (custName, custRef, custIdent, custCode, customerRecord, itemDesc[*]),
 *                estimator (estInitials, estNum, estNumAuto), mode (quoteType, pricingMode,
 *                setMarginPct, setMarginOverride, fulfillmentMarginPct, purchasedMarginPct,
 *                bomItems, activeItemIdx), job freight/prepress, quote header.
 *   - Item-level: everything else — board, dims, qtys, print, finishing, per-item misc, etc.
 *
 *  [*] itemDesc is technically item-level in legacy, but the cloud build's BomSec writes
 *      per-item desc in `bomItems[i].desc`. We treat top-level itemDesc as job-level
 *      (the "active item" label is bomItems[activeItemIdx].desc) — but we also mirror
 *      bomItems[activeItemIdx].desc into top-level itemDesc on tab-switch so the
 *      existing Estimate Info section displays the active item's description. */

import { DEFAULT_STATE } from "./defaults";

/** Keys that DO NOT belong to any single component — they stay at the job level. */
export const JOB_LEVEL_KEYS = new Set([
  // identity
  "estNum", "estInitials", "estNumAuto",
  "custName", "custCode", "custRef", "customerRecord",
  // NOTE: `custIdent` is ITEM-LEVEL per legacy spot_r1_5.jsx L2675 — each component
  // has its own customer SKU / part # in a Multi-Part Individual quote.
  "spinOffOrigin",
  // mode
  "quoteType", "pricingMode",
  "setMarginPct", "setMarginOverride",
  "fulfillmentMarginPct", "purchasedMarginPct",
  "bomItems", "activeItemIdx",
  // job-level freight / prepress
  "freightScope", "prepressScope",
  "jobFreightCost", "jobFreightTreatment",
  "jobPrepressCost", "jobPrepressTreatment",
  "freightAllocMethod", "prepressAllocMethod",
  // shared misc job-level
  "freightByQty", "destZip", "quoteShipTo", "quoteFOB",
  // quote header
  "poNumber", "quoteTerms", "quoteExpDays", "quoteNotes", "dueDate", "shipTo",
]);

/** Keys that DO belong to a single component. Derived from DEFAULT_STATE − JOB_LEVEL_KEYS. */
export const ITEM_LEVEL_KEYS = Object.freeze(
  Object.keys(DEFAULT_STATE).filter((k) => !JOB_LEVEL_KEYS.has(k))
);

/** Snapshot the item-level slice of `state` — used when user switches active BOM item.
 *  Always includes `custIdent` + `miscCharges` (item-level per legacy spot_r1_5.jsx
 *  L2675-2683) even if the schema-driven ITEM_LEVEL_KEYS list misses them during
 *  module bootstrap. */
export function gatherItemState(state) {
  const out = {};
  for (const k of ITEM_LEVEL_KEYS) out[k] = state[k];
  out.custIdent = state.custIdent || "";
  // Defensive: copy the array (don't share refs across items), use fresh array
  // when state has no value yet.
  out.miscCharges = Array.isArray(state.miscCharges) ? [...state.miscCharges] : [];
  return out;
}

/** Build a blank item-level state (reset to DEFAULT_STATE defaults for item-level keys only).
 *  Always seeds `custIdent`/`miscCharges` to a fresh value (item-level per legacy parity).
 *
 *  Multi-Part BOM components additionally auto-populate the Die as
 *  `Separate Line` / `$1,200` / 15% markup so estimators don't have to manually
 *  flip every component to "Line" — they remove the die (treatment=None) on
 *  components that don't need one. This matches the cloud-only product
 *  decision (2026-06-12) that net-new MP components default to billing a die.
 */
export function freshItemState(overrides = {}) {
  const out = {};
  for (const k of ITEM_LEVEL_KEYS) out[k] = DEFAULT_STATE[k];
  out.custIdent = "";
  out.miscCharges = [];  // Fresh array — never share refs with DEFAULT_STATE
  // Die default for net-new BOM components — see comment above.
  out.dieTreatment = "Separate Line";
  out.cuttingDieCost = "1200";
  out.dieMarkup = "0.15";
  return { ...out, ...overrides };
}

/** Build a blank BOM entry. */
export function makeBomItem(opts = {}) {
  const { desc = "", type = "Manufactured", pcsPerSet = 1, custIdent = "", state = null } = opts;
  return {
    id: "it_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36),
    desc,
    custIdent,
    type,                       // Manufactured | Purchased | Fulfillment
    pcsPerSet: Number(pcsPerSet) || 1,
    state: state || freshItemState(),
  };
}

/** Apply an item's saved state into the top-level state.
 *  Reset-first semantics: item-level keys are first set to DEFAULT_STATE values
 *  so leftover fields from the previous active item don't leak.
 *  Always clears + applies `custIdent`/`miscCharges` (item-level per legacy parity). */
export function applyItemStateTo(currentState, itemState) {
  const cleared = {};
  for (const k of ITEM_LEVEL_KEYS) cleared[k] = DEFAULT_STATE[k];
  cleared.custIdent = "";  // Explicit safety net
  cleared.miscCharges = [];  // Fresh empty array — don't leak previous item's misc charges
  const it = itemState || {};
  const finalCust = ("custIdent" in it) ? it.custIdent : "";
  // miscCharges: deep-copy the array so subsequent mutations don't bleed across items
  const finalMisc = Array.isArray(it.miscCharges) ? [...it.miscCharges] : [];
  return { ...currentState, ...cleared, ...it, custIdent: finalCust, miscCharges: finalMisc };
}
