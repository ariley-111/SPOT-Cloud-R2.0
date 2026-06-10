/* eslint-disable */
/** Full default state for a SPOT quote tab.
 *  Mirrors all fields the legacy spot_r1_5.jsx exposes for the engine + UI.
 *  Reset-first semantics: applyState() REPLACES the state, never merges. */

export const DEFAULT_STATE = Object.freeze({
  // ─── Estimate Info ─────────────────────────────────────────────
  estNum: "",
  estInitials: "",          // per-tab estimator initials (4 char max)
  estNumAuto: true,
  custName: "",
  custCode: "",
  custRef: "",              // Project name
  custIdent: "",            // Customer SKU / part #
  customerRecord: null,
  spinOffOrigin: null,

  // ─── Item Setup ────────────────────────────────────────────────
  quoteType: "Simple",         // Simple | Multi-Part
  pricingMode: "Individual",   // Individual | Matched Set
  setMarginOverride: false,
  setMarginPct: "0.40",
  fulfillmentMarginPct: "0.45",
  purchasedMarginPct: "0.40",
  bomItems: [],
  activeItemIdx: 0,

  itemDesc: "",
  boxStyle: "",                // RSC | FOL | D/C Tray | Mailer | 5PF | ""
  quoteMode: "One-Up",         // One-Up | Sheet Size
  oneUpW: "",
  oneUpL: "",
  sheetSizeW: "",
  sheetSizeL: "",
  sheetPcsPerSheet: "",
  corrFlipped: false,
  overrideSheetId: null,

  qtys: ["", "", "", "", ""],
  selSlot: 0,
  // Per-quantity exclusion list — qty slot indices that the user has unchecked
  // from the Quote Table. Excluded rows drop out of PDF/Preview/Export.
  // Stored as an array (Set isn't JSON serializable).
  exportExclude: [],

  // ─── Board ─────────────────────────────────────────────────────
  flute: "C",
  boardGrade: "200",
  outsideLiner: "42# Kemi-Lite",
  insideLiner: "None",
  medium: "None",
  fscEnabled: false,
  fscFee: "25",
  buyMinBoard: "Auto",
  boardSubstitution: null,
  boardTilesOpen: false,

  // ─── Production / Routing ─────────────────────────────────────
  printReq: "Yes",
  printMode: "Satin",          // Satin | Gloss | OnQ Styrene | OnQ Lightbox
  printSides: "1-Sided",
  whiteInk: "No",
  colorsFront: "4",
  colorsBack: "0",

  routeOverride: null,         // null=Auto | "CAD"|"Crest"|"Bobst"
  cadDifficulty: "Standard",
  cadPricingMethod: "By Difficulty",   // By Difficulty | By Inches of Rule
  crestComplexity: "Standard",         // Standard | Advanced
  totalRuleInches: "0",
  perfPct: "0",
  productMats: "No",

  saber: "No",
  saberCuts: "1",
  saberBlanksOut: "1",

  // ─── Finishing ────────────────────────────────────────────────
  handStripping: "No",
  perimeterStripping: "No",
  strippingComplexity: "Standard",     // Simple|Straight|Standard|Complex

  handGluing: "No",
  jointsPerPiece: "1",
  gluingComplexity: "Standard",        // Simple|Standard|Complex

  tape: "No",
  tapeType: "Clear",                   // Clear|Reinforced

  // ─── One-Time Costs ───────────────────────────────────────────
  prepressTreatment: "Auto",           // Auto | None | Separate Line | Amortize
  prepressCost: "50",
  prepressScope: "Per Item",           // None | Per Item | Per Job (Lot Charge)
  jobPrepressTreatment: "Separate Line",
  jobPrepressCost: "0",
  defaultPrepressCost: "50",

  dieTreatment: "None",                // None | Separate Line | Amortize
  cuttingDieCost: "0",
  dieMarkup: "0.15",                   // Default 15% markup (legacy RATE_DEFAULTS)
  dieAmortMethod: "Markup",            // Markup | OrderMargin

  miscCharges: [],                     // [{id,name,cost,treatment}]

  // ─── Freight ──────────────────────────────────────────────────
  quoteFOB: "Origin",                  // Origin | Destination | Will-Call | Ship
  freightType: "None",                 // None | Line | Amort
  freightTreatment: "None",            // None | Separate Line | Amortize
  // Local Delivery (FOB = "LocalDelivery"): "Zone 1" | "Zone 2" | "Zone 3"
  localDeliveryZone: null,
  freightCost: "0",
  freightMarkup: "0.15",
  freightScope: "None",                // None | Per Item | Per Job
  jobFreightTreatment: "Separate Line",
  jobFreightCost: "0",
  freightByQty: {},
  quoteShipTo: "",
  destZip: "",

  // ─── Quote Header ─────────────────────────────────────────────
  poNumber: "",
  quoteTerms: "Net 30",
  quoteExpDays: "30",
  quoteNotes: "",
  dueDate: "",
  shipTo: "",
});

/** Reset-first: returns a brand new object based on DEFAULT_STATE merged with patch. */
export function applyState(patch) {
  return { ...DEFAULT_STATE, ...(patch || {}) };
}

// ─── Lookup tables ──────────────────────────────────────────────
export const BOX_STYLES   = ["RSC", "FOL", "D/C Tray", "Mailer", "5PF"];
export const FLUTES       = ["B", "C", "E", "B/C"];

// ─── Board grade lists — legacy parity (spot_r1_5.jsx L100-130) ───
// Singlewall: B/C/E flutes pull from this list.
export const GRADES_SINGLEWALL = ["125","150","175","200","250","275","350",
  "ECT 23","ECT 26","ECT 29","ECT 32","ECT 40","ECT 44","ECT 55","NT"];
// Doublewall: B/C flute pulls from this list. (Backend base_matrix["doublewall"]
// already has these; legacy gates the UI list via getGradesForFlute().)
export const GRADES_DOUBLEWALL = ["200 DW","275 DW","350 DW","400 DW","450 DW","500 DW","600 DW",
  "ECT 42","ECT 48","ECT 51","ECT 61","ECT 71","ECT 82","NT DW"];
// Combined list — kept for places that need every supported grade (admin, validation).
export const GRADES = [...GRADES_SINGLEWALL, ...GRADES_DOUBLEWALL];

// Map flute → wall_type (matches backend `core.py` flute_rules)
export const wallTypeForFlute = (flute) => (flute === "B/C" ? "doublewall" : "singlewall");

// Return the grade list appropriate for the chosen flute. Used to filter the
// grade tile picker so DW-only grades hide behind singlewall flutes and vice
// versa — ports legacy `getGradesForFlute(f)` (spot_r1_5.jsx L263).
export const getGradesForFlute = (flute) =>
  wallTypeForFlute(flute) === "doublewall" ? GRADES_DOUBLEWALL : GRADES_SINGLEWALL;
export const LINERS       = [
  "None","42# Kemi-Lite","42# Kla-White","42# Bleached White","33# Kla-White","56# Kla-White",
];
// ─── Legacy parity: liner grade enforcement (spot_r1_5.jsx L139-140, L265). ───
// Map from liner → restricted board grades (if undefined: liner allowed for ALL grades).
// Legacy semantics: `enforce:true` + `allowed_board_grades:[list]` means liner is
// FILTERED OUT of the tile picker unless current board grade is in the list.
export const LINER_ENFORCE = {
  "33# Kla-White": ["175", "ECT 32"],
  "56# Kla-White": ["250"],
};
export const allowed_liners = (boardGrade) => LINERS.filter((l) =>
  !LINER_ENFORCE[l] || LINER_ENFORCE[l].includes(boardGrade)
);
export const MEDIUMS      = ["None","26# Medium","33# Medium","35# HPL Medium","40# Medium","42# Bleached Medium"];
export const PRINT_MODES  = ["Satin","Gloss","OnQ Styrene","OnQ Lightbox"];
export const PRINT_SIDES  = ["1-Sided","2-Sided"];
export const DIFFICULTY   = ["Simple","Straight","Standard","Complex"];
export const STRIP_COMP   = ["Simple","Straight","Standard","Complex"];
export const GLUE_COMP    = ["Simple","Standard","Complex"];
export const ITEM_TINTS = [
  { hex: "#e8927c" }, { hex: "#b08cf5" }, { hex: "#7dd3c0" },
  { hex: "#e88dc4" }, { hex: "#8cc8e8" }, { hex: "#d4a76a" },
];

// Default initials derived from user.name (e.g., "Ashley Rohr" → "AR")
export function deriveInitials(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  const initials = parts.map((p) => p[0] || "").join("").toUpperCase();
  return initials.slice(0, 4);
}

// Abbreviated liner short-form (for status bars) — legacy fmLnr (spot_r1_5.jsx L1218)
export function liner_short(l) {
  if (!l || l === "None") return "Kraft";
  return String(l).replace(/^\d+#\s*/, "").replace("-Lite", "").replace("-White", "");
}
