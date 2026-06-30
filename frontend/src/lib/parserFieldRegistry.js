/* eslint-disable */
// Maps parser ask-field paths (internal code variables the model emits, e.g.
// "bomItems[0].state.printMode", "qtys (top-level)", "fscEnabled") to the
// PLAIN UI field names estimators recognize + the right inline editor control,
// so the Review modal can let them fix flagged fields without leaving the modal.
import {
  BOX_STYLES, FLUTES, GRADES, LINERS, MEDIUMS,
  PRINT_MODES, PRINT_SIDES, DIFFICULTY, STRIP_COMP, GLUE_COMP,
} from "./defaults";

const YES_NO = ["Yes", "No"];

// control: text | number | select | customer | qtys | textarea
// section: the UI section where this field lives (shown as a breadcrumb hint)
export const FIELD_META = {
  // ── Estimate Info / identity ──
  custName:    { label: "Customer Name",        section: "Estimate Info",     control: "text" },
  custCode:    { label: "Customer Code / Branch", section: "Estimate Info",   control: "customer" },
  custRef:     { label: "Project / Reference",  section: "Estimate Info",     control: "text" },
  custIdent:   { label: "Customer Part / SKU",  section: "Item Setup",        control: "text" },
  poNumber:    { label: "PO Number",            section: "Quote Header",      control: "text" },
  itemDesc:    { label: "Item Description",     section: "Item Setup",        control: "text" },
  dueDate:     { label: "Due Date",             section: "Quote Header",      control: "text" },
  quoteNotes:  { label: "Notes",               section: "Quote Header",      control: "textarea" },

  // ── Item Setup / board ──
  boxStyle:    { label: "Box Style",            section: "Item Setup",        control: "select", options: BOX_STYLES },
  oneUpW:      { label: "One-Up Width (in)",    section: "Item Setup",        control: "number" },
  oneUpL:      { label: "One-Up Length (in)",   section: "Item Setup",        control: "number" },
  oneUpD:      { label: "One-Up Depth (in)",    section: "Item Setup",        control: "number" },
  flute:       { label: "Flute",                section: "Item Setup",        control: "select", options: FLUTES },
  boardGrade:  { label: "Board Grade",          section: "Item Setup",        control: "select", options: GRADES },
  outsideLiner:{ label: "Outside Liner",        section: "Item Setup",        control: "select", options: LINERS },
  insideLiner: { label: "Inside Liner",         section: "Item Setup",        control: "select", options: LINERS },
  medium:      { label: "Medium",               section: "Item Setup",        control: "select", options: MEDIUMS },

  // ── Quantities ──
  qtys:        { label: "Quantities",           section: "Estimate Info",     control: "qtys" },

  // ── Production Specs ──
  printReq:    { label: "Print Required",       section: "Production Specs",  control: "select", options: YES_NO },
  printMode:   { label: "Print Mode",           section: "Production Specs",  control: "select", options: PRINT_MODES },
  printSides:  { label: "Print Sides",          section: "Production Specs",  control: "select", options: PRINT_SIDES },
  whiteInk:    { label: "White Ink",            section: "Production Specs",  control: "select", options: YES_NO },
  colorsFront: { label: "Colors — Front",       section: "Production Specs",  control: "number" },
  colorsBack:  { label: "Colors — Back",        section: "Production Specs",  control: "number" },
  cadDifficulty:{ label: "CAD Difficulty",      section: "Production Specs",  control: "select", options: DIFFICULTY },
  totalRuleInches:{ label: "Rule Inches",       section: "Production Specs",  control: "number" },
  handStripping:{ label: "Hand Stripping",      section: "Production Specs",  control: "select", options: YES_NO },
  strippingComplexity:{ label: "Stripping Complexity", section: "Production Specs", control: "select", options: STRIP_COMP },
  handGluing:  { label: "Hand Gluing",          section: "Production Specs",  control: "select", options: YES_NO },
  gluingComplexity:{ label: "Gluing Complexity", section: "Production Specs",  control: "select", options: GLUE_COMP },
  jointsPerPiece:{ label: "Joints per Piece",   section: "Production Specs",  control: "number" },
  tape:        { label: "Tape",                 section: "Production Specs",  control: "select", options: YES_NO },
  fscEnabled:  { label: "FSC / SFI Certified",  section: "Production Specs",  control: "select", options: YES_NO, bool: true },

  // ── Freight ──
  quoteFOB:    { label: "FOB",                  section: "Freight",           control: "select", options: ["Origin", "Destination", "Will-Call", "Ship"] },
  destZip:     { label: "Destination ZIP",      section: "Freight",           control: "text" },

  // ── Pricing / Multi-Part ──
  pricingMode: { label: "Pricing Mode",         section: "Pricing Strategy",  control: "select", options: ["Matched Set", "Individual"] },
  setMarginPct:{ label: "Set Margin (fraction, e.g. 0.40)", section: "Pricing Strategy", control: "number" },
  type:        { label: "Component Type",       section: "BOM",               control: "select", options: ["Manufactured", "Purchased", "Fulfillment"] },
  pcsPerSet:   { label: "Pcs per Set",          section: "BOM",               control: "number" },
};

// Aliases — parser sometimes emits alternate names for the same field.
const ALIAS = {
  customerName: "custName", customerCode: "custCode", projectName: "custRef",
  po: "poNumber", notes: "quoteNotes", fobMode: "quoteFOB",
  stripReq: "handStripping", glueReq: "handGluing", tapeReq: "tape",
};

export function canonField(key) {
  return ALIAS[key] || key;
}

// Numeric fields stored as STRINGS in our state schema.
export const NUMERIC_KEYS = new Set([
  "oneUpW", "oneUpL", "oneUpD", "colorsFront", "colorsBack",
  "totalRuleInches", "setMarginPct", "pcsPerSet", "jointsPerPiece",
]);

// Humanize ANY field key into a plain-English label (best effort). Falls back
// to splitting camelCase / snake_case and Title-casing — so even keys we don't
// have an explicit entry for never show as raw code (e.g. "strippingComplexity"
// → "Stripping Complexity"). A few common abbreviations are spelled out.
const ABBR = {
  cust: "Customer", qty: "Quantity", qtys: "Quantities", po: "PO", ref: "Reference",
  fob: "FOB", fsc: "FSC", cad: "CAD", desc: "Description", num: "Number",
  pcs: "Pieces", zip: "ZIP", sku: "SKU", id: "ID", w: "Width", l: "Length", d: "Depth",
};
export function labelForKey(key) {
  const k = canonField(key);
  if (FIELD_META[k]) return FIELD_META[k].label;
  const words = String(k)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")  // camelCase → spaced
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => ABBR[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)));
  return words.join(" ") || k;
}

// Turn a full ask path into a friendly label, e.g.
//   "bomItems[0].state.strippingComplexity" → "Component 1 · Stripping Complexity"
//   "qtys (top-level)"                       → "Quantities"
export function humanizeFieldPath(raw) {
  const norm = parseAskField(raw);
  if (!norm) return raw;
  const base = labelForKey(norm.key);
  return norm.scope === "item" ? `Component ${norm.itemIdx + 1} · ${base}` : base;
}

// Parse a raw ask field path into a normalized descriptor.
//  "bomItems[0].state.printMode" → { scope:"item", itemIdx:0, key:"printMode" }
//  "bomItems[1].oneUpD"          → { scope:"item", itemIdx:1, key:"oneUpD" }
//  "qtys (top-level)"            → { scope:"job",  itemIdx:null, key:"qtys" }
//  "custCode"                    → { scope:"job",  itemIdx:null, key:"custCode" }
export function parseAskField(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Strip any trailing parenthetical hint, e.g. "(top-level)".
  let s = raw.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const m = s.match(/^bomItems\[(\d+)\]\.(?:state\.)?(.+)$/);
  if (m) {
    return { scope: "item", itemIdx: Number(m[1]), key: canonField(m[2].trim()) };
  }
  return { scope: "job", itemIdx: null, key: canonField(s) };
}

export function metaFor(key) {
  return FIELD_META[canonField(key)] || null;
}
