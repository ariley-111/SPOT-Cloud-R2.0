/* eslint-disable */
/** Default quote state — matches what the engine runner expects.
 *  Reset-first pattern: applyState REPLACES (after merging defaults), never merges into old. */

export const DEFAULT_STATE = Object.freeze({
  // ─── Estimate Info ───
  estNum: "",
  custName: "",
  custCode: "",
  custRef: "",
  projectName: "",
  poNumber: "",
  quoteFOB: "Origin",
  quoteTerms: "Net 30",
  shipTo: "",
  destZip: "",
  dueDate: "",
  notes: "",

  // ─── Item Setup ───
  quoteType: "Simple", // Simple | Multi-Part
  itemDesc: "",
  boxStyle: "",
  oneUpW: "",
  oneUpL: "",
  qtys: ["", "", "", "", ""],

  // ─── Board ───
  flute: "C",
  boardGrade: "200",
  outsideLiner: "42# Kemi-Lite",
  insideLiner: "None",
  medium: "None",
  fscEnabled: false,

  // ─── Production ───
  printReq: "Yes",
  printMode: "Satin",
  printSides: "1-Sided",
  whiteInk: "No",
  colorsFront: "4",
  colorsBack: "0",

  routeOverride: "Auto",
  cadDifficulty: "Standard",
  crestComplexity: "Standard",
  totalRuleInches: "0",
  perfPct: "0",
  productMats: "No",

  saber: "No",
  saberCuts: "1",
  saberBlanksOut: "1",

  // ─── Assembly ───
  handStripping: "No",
  perimeterStripping: "No",
  strippingComplexity: "Standard",
  handGluing: "No",
  jointsPerPiece: "1",
  gluingComplexity: "Standard",
  tape: "No",
  tapeType: "Clear",

  // ─── Charges ───
  freightCost: "0",
  freightTreatment: "Separate Line",
  freightMarkup: "0.15",
  cuttingDieCost: "0",
  dieTreatment: "None",
  dieMarkup: "0.15",
  prepressCost: "50",
  prepressTreatment: "Auto",
  miscCharges: [],
  miscChargeMarkup: "0.15",
  pricingBasis: "Gross Margin %",

  // ─── Multi-Part ───
  bomItems: [],
  activeItemIdx: 0,
  pricingMode: "Individual",
  setMarginOverride: false,
  setMarginPct: "0.40",
  fulfillmentMarginPct: "0.45",
  purchasedMarginPct: "0.40",
});

/** Reset-first state apply (Rule 7). */
export function applyState(partial) {
  return { ...DEFAULT_STATE, ...(partial || {}) };
}

export const FLUTES = ["B", "C", "E", "B/C"];
export const GRADES = ["125", "150", "175", "200", "250", "275", "350",
  "ECT 23", "ECT 26", "ECT 29", "ECT 32", "ECT 40", "ECT 44", "ECT 55"];
export const LINERS = ["None", "42# Kemi-Lite", "42# Kla-White", "Bleached White", "White"];
export const BOX_STYLES = ["RSC", "FOL", "D/C Tray", "Mailer", "5PF"];
export const ROUTE_OPTIONS = ["Auto", "CAD", "Crest", "Bobst", "Saber+DC"];
export const DIFFICULTY = ["Simple", "Straight", "Standard", "Complex"];
export const PRINT_MODES = ["Satin", "Gloss", "OnQ Stylus", "OnQ Lightbox"];
export const PRINT_SIDES = ["1-Sided", "2-Sided"];
