// Engine extracted from spot_r1_5.jsx — April 15 2026 (R1.5.2 parity sync, D-091)
// R1.5.6 — D-123 Bobst-first sheet sizing + D-121 parity restoration (autoRoute/compareRoutes)

// ═══════════════════════════════════════════════════════════════
// ENGINE — Board pricing (identical baseline math from v5.2)
// ═══════════════════════════════════════════════════════════════
const ENGINE = {
  org_limits: { max_dimension_in: 126, oversize_pair_limit_in: 63 },
  flute_rules: {
    B: { wall_type: "singlewall", flute_upcharge_per_msf: 0 },
    C: { wall_type: "singlewall", flute_upcharge_per_msf: 0 },
    E: { wall_type: "singlewall", flute_upcharge_per_msf: 0 },    // D-110 FINAL: $3 → $0, sheet-efficiency pass-through (P2)
    "B/C": { wall_type: "doublewall", flute_upcharge_per_msf: 0 },
  },
  msf_tiers: [
    { name: "0-9", min: 0, maxExclusive: 10 },
    { name: "10-24", min: 10, maxExclusive: 25 },
    { name: "25-49", min: 25, maxExclusive: 50 },
    { name: "50-74", min: 50, maxExclusive: 75 },
    { name: "75-99", min: 75, maxExclusive: 100 },
    { name: "100+", min: 100, maxExclusive: null },
  ],
  base_matrix: {
    singlewall: {
      125:{"0-9":80.97,"10-24":77.74,"25-49":76.88,"50-74":76.88,"75-99":76.64,"100+":76.64},
      150:{"0-9":95.01,"10-24":92.39,"25-49":91.54,"50-74":91.54,"75-99":90.55,"100+":90.55},
      175:{"0-9":97.71,"10-24":96.32,"25-49":96.11,"50-74":94.76,"75-99":93.12,"100+":93.12},
      200:{"0-9":102.98,"10-24":99.17,"25-49":97.64,"50-74":96.21,"75-99":95.52,"100+":94.19},
      250:{"0-9":122.27,"10-24":120.73,"25-49":120.47,"50-74":117.31,"75-99":117.31,"100+":117.31},
      275:{"0-9":139.58,"10-24":137.84,"25-49":137.6,"50-74":134.55,"75-99":134.55,"100+":134.55},
      350:{"0-9":230.35,"10-24":217.25,"25-49":213.45,"50-74":212.9,"75-99":207.39,"100+":206.09},
      "ECT 23":{"0-9":80.97,"10-24":77.74,"25-49":76.88,"50-74":76.88,"75-99":76.64,"100+":76.64},
      "ECT 26":{"0-9":95.01,"10-24":92.39,"25-49":91.54,"50-74":91.54,"75-99":90.55,"100+":90.55},
      "ECT 29":{"0-9":97.71,"10-24":96.32,"25-49":96.11,"50-74":94.76,"75-99":93.12,"100+":93.12},
      "ECT 32":{"0-9":95.31,"10-24":89.2,"25-49":87.7,"50-74":86.78,"75-99":86.06,"100+":84.78},
      "ECT 40":{"0-9":120.6,"10-24":114.44,"25-49":112.94,"50-74":112.03,"75-99":111.31,"100+":110.02},
      "ECT 44":{"0-9":120.6,"10-24":114.44,"25-49":112.94,"50-74":112.03,"75-99":111.31,"100+":110.02},
      "ECT 55":{"0-9":192.96,"10-24":186.8,"25-49":185.34,"50-74":184.36,"75-99":183.68,"100+":182.38},
      NT:{"0-9":76.88,"10-24":76.88,"25-49":76.88,"50-74":76.88,"75-99":76.64,"100+":76.64},
    },
    doublewall: {
      "200 DW":{"0-9":150.51,"10-24":144.78,"25-49":142.85,"50-74":142.34,"75-99":141.3,"100+":141.3},
      "275 DW":{"0-9":155.14,"10-24":149.58,"25-49":147.65,"50-74":147.13,"75-99":146.46,"100+":146.46},
      "350 DW":{"0-9":165.43,"10-24":159.75,"25-49":157.75,"50-74":157.2,"75-99":156.64,"100+":156.64},
      "400 DW":{"0-9":233.49,"10-24":227.64,"25-49":225.97,"50-74":224.68,"75-99":223.08,"100+":219.62},
      "450 DW":{"0-9":235.78,"10-24":229.95,"25-49":228.21,"50-74":226.99,"75-99":225.42,"100+":221.97},
      "500 DW":{"0-9":277.47,"10-24":266.56,"25-49":264.56,"50-74":264.56,"75-99":263.51,"100+":262.12},
      "600 DW":{"0-9":336.63,"10-24":324.49,"25-49":323.25,"50-74":320.1,"75-99":313.43,"100+":313.43},
      "ECT 42":{"0-9":145.47,"10-24":141.39,"25-49":139.49,"50-74":137.53,"75-99":135.52,"100+":133.47},
      "ECT 48":{"0-9":145.47,"10-24":141.39,"25-49":139.49,"50-74":137.53,"75-99":135.52,"100+":133.47},
      "ECT 51":{"0-9":152.35,"10-24":148.09,"25-49":146.12,"50-74":144.05,"75-99":141.96,"100+":139.83},
      "ECT 61":{"0-9":198.97,"10-24":192.96,"25-49":190.85,"50-74":190.84,"75-99":190.2,"100+":190.2},
      "ECT 71":{"0-9":200.14,"10-24":194.11,"25-49":192.05,"50-74":192.05,"75-99":191.28,"100+":191.28},
      "ECT 82":{"0-9":273.46,"10-24":264.81,"25-49":261.47,"50-74":261.47,"75-99":261.02,"100+":261.02},
      "NT DW":{"0-9":null,"10-24":null,"25-49":142.85,"50-74":142.34,"75-99":141.3,"100+":141.3},
    },
  },
  liner_upgrades: {
    None:{amount_per_msf:0},"33# Kla-White":{amount_per_msf:7.5,allowed_board_grades:["175","ECT 32"],enforce:true},
    "42# Kla-White":{amount_per_msf:8.0},"56# Kla-White":{amount_per_msf:15.0,allowed_board_grades:["250"],enforce:true},
    "42# Bleached White":{amount_per_msf:17.5},"42# Kemi-Lite":{base_amount_per_msf:18.5},
  },
  medium_upgrades: {
    None:{amount_per_msf:0},"26# Medium":{amount_per_msf:3.0,check_availability:true},
    "33# Medium":{amount_per_msf:7.0},"35HPL# Medium":{amount_per_msf:8.6},
    "40# Medium":{amount_per_msf:12.5},"42# Bleached Medium":{amount_per_msf:28.5},
  },
  dimensional_adders: {
    width:[{min:8.875,max:10.0,amount_per_msf:4.5}],
    length:[{min:22.0,max:25.0,amount_per_msf:4.5}],
  },
  fixed_charges: {under_5_msf_setup_fee:{trigger_order_msf_lt:5,amount:0},pallet_prep_fee:{amount:17.5}},
};

// ═══════════════════════════════════════════════════════════════
// APPROVED SHEET LIBRARY — 216 sheets — exact match to vendor library
// ═══════════════════════════════════════════════════════════════
const SHEET_GROUPS = [{"g":"200","f":"B","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"B","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"B","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"B","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"B","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"B","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"B","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"B","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"C","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"250","f":"C","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"42# Kla-White","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"ECT 44","f":"C","ol":"None","il":"None","md":"None","sizes":[[60,120],[63,126],[63,63],[63,98]]},{"g":"200","f":"E","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"200","f":"E","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"200","f":"E","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"200","f":"E","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"200","f":"E","ol":"42# Kla-White","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"200","f":"E","ol":"None","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"42# Kla-White","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"250","f":"E","ol":"None","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"42# Kemi-Lite","il":"42# Kemi-Lite","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"42# Kemi-Lite","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"42# Kemi-Lite","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"42# Kla-White","il":"42# Kla-White","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"42# Kla-White","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]},{"g":"ECT 44","f":"E","ol":"None","il":"None","md":"None","sizes":[[48,96],[60,120],[63,126],[63,63]]}];

// Expand groups into flat sheet list at init time
const APPROVED_SHEETS = [];
let _sid = 1;
SHEET_GROUPS.forEach(g => {
  g.sizes.forEach(([w, l]) => {
    APPROVED_SHEETS.push({ id: `SH-${String(_sid++).padStart(3,'0')}`, g: g.g, f: g.f, ol: g.ol, il: g.il, md: g.md, w, l });
  });
});

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const FLUTE_CALIPERS = { E: 0.0625, B: 0.125, C: 0.1875, "B/C": 0.236 };
const PRINT_SPEEDS = { Gloss: 75, Satin: 75, "OnQ Styrene": 50, "OnQ Lightbox": 40 };  // D-110: equalized Gloss/Satin at 75 sh/hr (was 70/100)
// CAD and Strip complexity tiers: positional rename to iQuote's label space
// (D-106, 2026-04-21). Old SPOT labels Simple/Standard/Complex/Extreme slide
// one slot right to become Simple/Straight/Standard/Complex. Math mostly
// preserved under the new labels; Complex runtime dropped from 6 → 5 min/sh
// (safe adjustment toward iQuote's ~4 min/sh observed, pre-calibration). Glue
// unchanged (3-tier, no positional mapping possible).
//
// Legacy JSON with the old labels is remapped on load via CAD_DIFF_MIGRATION
// below — see applyState() / applyItemState() in spot_r1_5.jsx. Toast fires
// when migration is applied.
const CAD_SETUP    = { Simple: 8,  Straight: 20, Standard: 25, Complex: 22 };  // D-110: fleet-calibrated (was 10/15/25/25)
const CAD_FALLBACK = { Simple: 2,  Straight: 6,  Standard: 2,  Complex: 4  };  // D-110: fleet-calibrated (was 2/3/4/5)
const STRIP_DEFAULTS = { Simple: 0.5, Straight: 1.0, Standard: 3.0, Complex: 5.0 };
const GLUE_DEFAULTS  = { Simple: 1.0, Standard: 1.5, Complex: 2.0 };
// Legacy-label migration map. Loaded estimates with old labels are translated
// to new labels so that a pre-D-106 "Standard" (meant 15 min setup / 3 min/sh)
// becomes post-D-106 "Straight" (same math). An old "Extreme" (25 / 6) becomes
// new "Complex" (25 / 5) — this one carries a minor Δrun −1 min/sh from the
// safe adjustment; estimator is toasted to re-review on load.
const CAD_DIFF_MIGRATION   = { Simple: "Simple", Standard: "Straight", Complex: "Standard", Extreme: "Complex" };
const STRIP_DIFF_MIGRATION = { Simple: "Simple", Standard: "Straight", Complex: "Standard", Extreme: "Complex" };
const SPOT_SCHEMA_VERSION = 2; // bumped from 1 at D-106. Absent field == 1.
// GM tiers — more granular than board pricing tiers (9 tiers, 55→27%)
const GM_MSF_TIERS = [
  { name: "0-1", min: 0, maxExclusive: 1 },
  { name: "1-3", min: 1, maxExclusive: 3 },
  { name: "3-5", min: 3, maxExclusive: 5 },
  { name: "5-9", min: 5, maxExclusive: 10 },
  { name: "10-24", min: 10, maxExclusive: 25 },
  { name: "25-49", min: 25, maxExclusive: 50 },
  { name: "50-74", min: 50, maxExclusive: 75 },
  { name: "75-99", min: 75, maxExclusive: 100 },
  { name: "100+", min: 100, maxExclusive: null },
];
function getGmMsfTier(msf) { return GM_MSF_TIERS.find(t=>msf>=t.min&&(t.maxExclusive===null||msf<t.maxExclusive))?.name||"0-1"; }
const GM_DEFAULTS = { "0-1": 0.50, "1-3": 0.37, "3-5": 0.32, "5-9": 0.27, "10-24": 0.25, "25-49": 0.25, "50-74": 0.25, "75-99": 0.25, "100+": 0.25 };  // D-110 FINAL: 52/46/42/32/28 → 50/37/32/27/25 (fleet sell target +8%, GM floors P5)
const SELL_DEFAULTS = { "0-1": 600, "1-3": 500, "3-5": 450, "5-9": 400, "10-24": 375, "25-49": 325, "50-74": 300, "75-99": 285, "100+": 260 };
// Build a flat gmByTier with single margin for all tiers (used for fulfillment/purchased items)
function flatGm(pct) { const o={}; GM_MSF_TIERS.forEach(t=>{o[t.name]=pct;}); return o; }
const GRADE_ADDER_DEFAULTS = {
  "125":0, "150":0, "175":0, "200":15, "250":46, "275":5, "350":0,
  "ECT 23":0, "ECT 26":0, "ECT 29":0, "ECT 32":15, "ECT 40":46, "ECT 44":2, "ECT 55":0, "NT":0,
  "200 DW":0, "275 DW":0, "350 DW":0, "400 DW":0, "450 DW":0, "500 DW":0, "600 DW":0,
  "ECT 42":0, "ECT 48":0, "ECT 51":8, "ECT 61":0, "ECT 71":0, "ECT 82":0
};
const CREST_MAX_W = 60, CREST_MAX_L = 120;
// ─── D-121: Bobst die-cutter envelope + flute eligibility ───
const BOBST_MIN_W = 13.78, BOBST_MIN_L = 15.75;
const BOBST_MAX_W = 41.75, BOBST_MAX_L = 29.125;
const BOBST_FLUTES = ["E","F"];
const isBobstEligible = (flute, sheetW, sheetL) =>
  BOBST_FLUTES.includes(flute) &&
  sheetW>=BOBST_MIN_W && sheetL>=BOBST_MIN_L &&
  sheetW<=BOBST_MAX_W && sheetL<=BOBST_MAX_L;
const RATE_DEFAULTS = {
  overheadPct:"0", spoilagePct:"0.02", kemiTariff:"2.50", palletPrepFee:"17.50", under5MsfFee:"0",
  freightMarkup:"0.15", dieMarkup:"0.15", miscChargeMarkup:"0.15", purchasedMarginPct:"0.40",
  incaRate:"485", cadRate:"138", crestRate:"45", saberRate:"2", handStripRate:"17", handGlueRate:"23",
  incaMinChg:"0", cadMinChg:"0", crestMinChg:"0", saberMinChg:"0", saberCostPerCut:"0", stripMinChg:"0", glueMinChg:"0",
  regInkRate:"0.05", whiteInkFactor:"0.5", regMR:"5", whiteMR:"15",
  stackHeight:"48", cadRegSpeed:"650", crestSpeedVal:"150",
  clearTapeCost:"0.03", reinfTapeCost:"0.08", tapeFtPerPc:"2", side2Factor:"0.60",
  crestSetupStd:"45", crestSetupAdv:"90", crestAdvSpeedFactor:"0.80",
  perimStripMinPerPallet:"15", cadPerfSpeedFactor:"0.40",
  defaultPrepressCost:"50", defaultPrintMode:"Satin",
  // ─── D-121: Crest default die cost (was hardcoded "0" — estimator placeholder) ───
  crestDieCost:"1200",
  // ─── D-121: Bobst rate parameters (uncalibrated — recalibrate after ~90 days shop-floor data) ───
  bobstRate:"350", bobstSpeed:"3000", bobstSetup:"45", bobstMinChg:"250", bobstDieCost:"1800",
  // ─── D-123: Bobst-first sheet sizing flag (revert to "false" to restore D-121 CAD-shaped sheet selection) ───
  bobstFirstSizing:"true",
};

// ═══════════════════════════════════════════════════════════════
// PURE MATH FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const pn = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ceilInt = v => Math.ceil(Number(v||0));
const fm = n => "$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fn = (n,mx=2,mn=0) => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:mx,minimumFractionDigits:mn});
const fp = (n,d=1) => `${fn((n||0)*100,d,d)}%`;
const fmMed = m => m==="None"?"standard":m.replace("# Medium","#").replace("# Bleached Medium","# Bleached");
const fmMedMsg = (fb,requested) => {
  const got=fb.medium, req=requested;
  if(got==="None") return fb.isHigher?`No medium upgrade in stock — running standard weight`:`No medium upgrade in stock — requested ${fmMed(req)} not available, running standard weight`;
  return fb.isHigher?`Stock has ${fmMed(got)} medium — heavier than requested ${fmMed(req)}, meets spec`:`Stock has ${fmMed(got)} medium — lighter than requested ${fmMed(req)}, verify acceptable`;
};

function getMsfTier(msf) { return ENGINE.msf_tiers.find(t=>msf>=t.min&&(t.maxExclusive===null||msf<t.maxExclusive))?.name||"-"; }
function getDimAdder(v,rules) { const h=rules.find(r=>v>=r.min&&v<=r.max); return h?h.amount_per_msf:0; }
function getLinerRate(name,kemiTariff) {
  const r=ENGINE.liner_upgrades[name]; if(!r) return 0;
  if(name==="42# Kemi-Lite") return (r.base_amount_per_msf||0)+kemiTariff;
  return r.amount_per_msf||0;
}
function getGradesForFlute(f) { return Object.keys(ENGINE.base_matrix[ENGINE.flute_rules[f]?.wall_type||"singlewall"]); }
function getAllowedLiners(bg) {
  return Object.entries(ENGINE.liner_upgrades).filter(([,r])=>!r.enforce||r.allowed_board_grades.includes(bg)).map(([n])=>n);
}

// ECT → Mullen equivalence: 200# meets/exceeds ECT 32, etc.
// "200 meets 32ECT specs, but 32ECT does not meet 200 specs"
const ECT_GRADE_FALLBACK = {
  "ECT 23":"125","ECT 26":"150","ECT 29":"175","ECT 32":"200","ECT 40":"250","ECT 44":"275","ECT 55":"350"
};
// D-059: Mullen grade upgrade chain — always safe to go UP (stronger board meets/exceeds lower spec)
const MULLEN_UPGRADE = {"125":"150","150":"175","175":"200","200":"250","250":"275","275":"350"};
function getGradeFallback(grade) { return ECT_GRADE_FALLBACK[grade]||null; }

// Medium fallback order: if requested medium not in stock, use next higher medium
// If no higher available, use the highest medium we DO have in stock
// Order: None < 26# < 33# < 35HPL# < 40# < 42# Bleached
// NOTE: 42# Bleached is EXCLUDED from auto-fallback — it's white and looks wrong in kraft boards
const MEDIUM_ORDER = ["None","26# Medium","33# Medium","35HPL# Medium","40# Medium","42# Bleached Medium"];
const MEDIUM_FALLBACK_POOL = ["None","26# Medium","33# Medium","35HPL# Medium","40# Medium"]; // No bleached
function getMediumFallback(requestedMedium, availableMediums) {
  if(requestedMedium==="None") return null; // None can't fall back
  // If user requested bleached, don't fall back — bleached is special
  if(requestedMedium==="42# Bleached Medium") return null;
  const reqIdx = MEDIUM_FALLBACK_POOL.indexOf(requestedMedium);
  if(reqIdx<0) return null; // Unknown medium
  // First: try to find next higher medium that's available (excluding bleached)
  for(let i=reqIdx+1; i<MEDIUM_FALLBACK_POOL.length; i++) {
    if(availableMediums.has(MEDIUM_FALLBACK_POOL[i])) return { medium: MEDIUM_FALLBACK_POOL[i], isHigher: true };
  }
  // Second: no higher available — find the highest medium we DO have (excluding bleached)
  for(let i=MEDIUM_FALLBACK_POOL.length-1; i>=0; i--) {
    if(i !== reqIdx && availableMediums.has(MEDIUM_FALLBACK_POOL[i])) return { medium: MEDIUM_FALLBACK_POOL[i], isHigher: i > reqIdx };
  }
  return null; // No fallback available at all
}

// ─── Board pricing calculator (baseline) ───
function calcBoard(bi, qty, isStock) {
  const fr = ENGINE.flute_rules[bi.flute];
  if (!fr) return { qty, sqft:0, oSqFt:0, oMsf:0, tier:"-", base:null, hasPrice:false, olR:0, ilR:0, mdR:0, flR:0, wA:0, lA:0, effRate:0, varCost:0, kemiChg:0, fscAmt:0, setup:0, pp:0, total:0, effWithFsc:0, costPc:0, isKraft:false, minSqFt:25000, minQty:0, meetMin:false, pricable:false };
  const mk = fr.wall_type;
  const sqft = (bi.lengthIn*bi.widthIn)/144;
  const oSqFt = sqft*qty, oMsf = oSqFt/1000;
  const tier = getMsfTier(oMsf);
  const base = ENGINE.base_matrix[mk][bi.boardGrade]?.[tier];
  const hasPrice = base!==null && base!==undefined;
  const olR = getLinerRate(bi.outsideLiner,bi.kemiTariff);
  const ilR = getLinerRate(bi.insideLiner,bi.kemiTariff);
  const kSides = (bi.outsideLiner==="42# Kemi-Lite"?1:0)+(bi.insideLiner==="42# Kemi-Lite"?1:0);
  const mdR = ENGINE.medium_upgrades[bi.medium]?.amount_per_msf||0;
  const flR = fr.flute_upcharge_per_msf||0;
  const wA = getDimAdder(bi.widthIn,ENGINE.dimensional_adders.width);
  const lA = getDimAdder(bi.lengthIn,ENGINE.dimensional_adders.length);
  const gradeAdder = Number.isFinite(bi.gradeAdder)?bi.gradeAdder:0;
  const effRate = (base||0)+olR+ilR+mdR+flR+wA+lA+gradeAdder;
  const varCost = effRate*oMsf;
  const kemiChg = kSides*bi.kemiTariff*oMsf;
  const fscAmt = bi.fscEnabled?(Number.isFinite(bi.fscFee)?bi.fscFee:25):0;
  const setup = oMsf<ENGINE.fixed_charges.under_5_msf_setup_fee.trigger_order_msf_lt?(Number.isFinite(bi.under5MsfFee)?bi.under5MsfFee:0):0;
  const ppRate = Number.isFinite(bi.palletPrepFee)?bi.palletPrepFee:17.5;
  const pp = isStock ? 0 : ppRate*oMsf;
  const total = varCost+fscAmt+setup+pp;
  const isKraft = bi.outsideLiner==="None"&&bi.insideLiner==="None";
  const minSqFt = isKraft?15000:25000;
  const minQty = sqft>0?Math.ceil(minSqFt/sqft):0;
  const meetMin = isStock ? true : (oSqFt>=minSqFt); // D-067: stock sheets are in inventory, no mill minimum
  const pricable = hasPrice&&meetMin;
  return { qty, sqft, oSqFt, oMsf, tier, base, hasPrice, olR, ilR, mdR, flR, wA, lA, effRate, varCost, kemiChg, fscAmt, setup, pp, total, effWithFsc:oMsf>0?total/oMsf:0, costPc:qty>0?total/qty:0, isKraft, minSqFt, minQty, meetMin, pricable };
}

// ─── Layout engine (RULE-005 through RULE-011) ───
function computeLayout(oneUpW, oneUpL, sheetW, sheetL) {
  if (oneUpW<=0||oneUpL<=0) return null;
  const numUp = Math.floor((sheetW-2)/oneUpW);    // RULE-007: 1" trim each side
  const numOut = Math.floor((sheetL-2)/oneUpL);   // RULE-008
  const pcsPerSheet = numUp*numOut;                // RULE-009
  if (pcsPerSheet<1) return null;
  const usedW = numUp*oneUpW, usedL = numOut*oneUpL;
  const sheetArea = sheetW*sheetL;
  const usedArea = usedW*usedL;
  const wastePct = sheetArea>0?1-(usedArea/sheetArea):0;
  return { numUp, numOut, pcsPerSheet, wastePct, sheetW, sheetL };
}

// ─── D-123: Bobst-only sheet selection — custom imposition with mill-min-buy scaling ───
// Returns a sheet result with the same shape as autoSelectSheet's return, scoped to the
// Bobst envelope (13.78×15.75 to 41.75×29.125). E/F flute only (caliper-blocked otherwise).
//
// On below-mill-min custom Bobst sheets, scales cost via min-buy (mirrors autoSelectSheet
// L319-334 stock pattern): pay full mill minimum order, amortize across the actual sheets
// the job needs. The `isMillMinScaled` flag fires so the comparison panel can annotate.
//
// Returns null when not viable; viable result includes `bobstReason: null`.
function selectBobstSheet(oneUpW, oneUpL, boardSpec, totalQty, assumptions) {
  if (!BOBST_FLUTES.includes(boardSpec.flute)) {
    return { viable:false, reason:`${boardSpec.flute} flute exceeds Bobst's 0.060″ caliper limit` };
  }
  const bNup = Math.floor((BOBST_MAX_W - 2) / oneUpW);
  const bNout = Math.floor((BOBST_MAX_L - 2) / oneUpL);
  if (bNup < 1 || bNout < 1) {
    return { viable:false, reason:`piece exceeds Bobst envelope (max ${BOBST_MAX_W}×${BOBST_MAX_L})` };
  }
  const bShW = Math.max(BOBST_MIN_W, bNup * oneUpW + 2);
  const bShL = Math.max(BOBST_MIN_L, bNout * oneUpL + 2);
  if (bShW > BOBST_MAX_W || bShL > BOBST_MAX_L) {
    return { viable:false, reason:`computed sheet exceeds Bobst envelope` };
  }
  const bPps = bNup * bNout;
  const bReq = Math.ceil(totalQty / bPps);
  const bWaste = 1 - ((bNup * oneUpW * bNout * oneUpL) / (bShW * bShL));
  const bLayout = { numUp: bNup, numOut: bNout, pcsPerSheet: bPps, wastePct: bWaste, sheetW: bShW, sheetL: bShL };
  const bSheet = { id:`BOBST-${bNup}x${bNout}`, g:boardSpec.boardGrade, f:boardSpec.flute, ol:boardSpec.outsideLiner, il:boardSpec.insideLiner, md:boardSpec.medium, w:bShW, l:bShL };

  const bBi = { ...boardSpec, widthIn:bShW, lengthIn:bShL };
  const bBc = calcBoard(bBi, bReq);

  // Path A: pricable as-is (mill min met by job qty)
  if (bBc.pricable) {
    return { viable:true, sheet:bSheet, layout:bLayout, sheetsReq:bReq, bc:bBc, totalCost:bBc.total, stockMode:false, customOrder:true, isMillMinScaled:false };
  }

  // Path B: has price but below mill min — D-123 mill-min-buy scale
  if (bBc.hasPrice && !bBc.meetMin) {
    const sheetSqFt = (bShW * bShL) / 144;
    const minBuySheets = Math.max(1, Math.ceil(bBc.minSqFt / sheetSqFt));
    const minBuyCalc = calcBoard(bBi, minBuySheets);
    if (minBuyCalc.pricable) {
      const scale = bReq / minBuySheets;
      const scaledTotal = minBuyCalc.total * scale;
      const scaledBc = {
        ...bBc, pricable:true, meetMin:true, total:scaledTotal,
        effWithFsc: bBc.oMsf>0 ? scaledTotal/bBc.oMsf : 0,
        costPc: totalQty>0 ? scaledTotal/totalQty : 0,
        varCost: minBuyCalc.varCost*scale, fscAmt: minBuyCalc.fscAmt*scale,
        setup:0, pp: minBuyCalc.pp*scale, kemiChg: minBuyCalc.kemiChg*scale,
        stockMode:true, stockMinBuy:minBuySheets, isMillMinScaled:true,
      };
      return { viable:true, sheet:bSheet, layout:bLayout, sheetsReq:bReq, bc:scaledBc, totalCost:scaledTotal, stockMode:false, customOrder:true, isMillMinScaled:true, minBuySheets };
    }
  }

  // Path C: no pricing at any size
  return { viable:false, reason:`no Bobst-eligible board pricing — even at mill minimum` };
}

// ─── Sheet auto-select (RULE-014: best economics, with below-min stock fallback) ───
function autoSelectSheet(oneUpW, oneUpL, boardSpec, totalQty, assumptions) {
  // ─── Helper: compute optimal custom sheet for given max dimensions ───
  function optimalCustom(maxW, maxL, mediumOverride) {
    const useMedium = mediumOverride || boardSpec.medium;
    const nUp = Math.floor((maxW - 2) / oneUpW);
    const nOut = Math.floor((maxL - 2) / oneUpL);
    if (nUp < 1 || nOut < 1) return null;
    const shW = nUp * oneUpW + 2;
    const shL = nOut * oneUpL + 2;
    const pcsPerSheet = nUp * nOut;
    const sheetsReq = Math.ceil(totalQty / pcsPerSheet);
    const bi = { ...boardSpec, medium: useMedium, widthIn: shW, lengthIn: shL };
    const bc = calcBoard(bi, sheetsReq);
    if (!bc.hasPrice) return null;
    const wastePct = 1 - ((nUp * oneUpW * nOut * oneUpL) / (shW * shL));
    const cadFbMin = (CAD_FALLBACK[assumptions.cadDifficulty || "Standard"] || 3) * sheetsReq;
    const cadHrs = ((CAD_SETUP[assumptions.cadDifficulty || "Standard"] || 15) + cadFbMin) / 60;
    const layout = { numUp: nUp, numOut: nOut, pcsPerSheet, wastePct, sheetW: shW, sheetL: shL };
    const sheet = { id: `CUSTOM-${nUp}x${nOut}`, g: boardSpec.boardGrade, f: boardSpec.flute, ol: boardSpec.outsideLiner, il: boardSpec.insideLiner, md: useMedium, w: shW, l: shL };
    const mediumFallback = mediumOverride && mediumOverride !== boardSpec.medium ? mediumOverride : null;
    return { sheet, layout, sheetsReq, bc, cadHrs, totalCost: bc.total, stockMode: false, customOrder: true, pricable: bc.pricable, mediumFallback };
  }

  // ─── Helper: find approved sheets with optional medium fallback ───
  function findApprovedSheets(mediumOverride, isHigherMedium) {
    const useMedium = mediumOverride || boardSpec.medium;
    const results = [];
    const fbGrade = getGradeFallback(boardSpec.boardGrade);
    APPROVED_SHEETS.forEach(sh => {
      const gradeMatch = sh.g===boardSpec.boardGrade || (fbGrade && sh.g===fbGrade);
      if (sh.f!==boardSpec.flute||!gradeMatch||sh.ol!==boardSpec.outsideLiner||sh.il!==boardSpec.insideLiner||sh.md!==useMedium) return;
      const usedGradeFallback = sh.g!==boardSpec.boardGrade;
      const layout = computeLayout(oneUpW, oneUpL, sh.w, sh.l);
      if (!layout) return;
      const sheetsReq = Math.ceil(totalQty/layout.pcsPerSheet);
      const bi = { ...boardSpec, medium: useMedium, widthIn:sh.w, lengthIn:sh.l };
      const bc = calcBoard(bi, sheetsReq, true);
      const cadFallbackMin = (CAD_FALLBACK[assumptions.cadDifficulty||"Standard"]||6)*sheetsReq;
      const cadHrs = ((CAD_SETUP[assumptions.cadDifficulty||"Standard"]||15)+cadFallbackMin)/60;
      const mediumFallback = mediumOverride && mediumOverride !== boardSpec.medium ? { medium: mediumOverride, isHigher: isHigherMedium } : null;
      if (bc.pricable) {
        results.push({ sheet:sh, layout, sheetsReq, bc, cadHrs, totalCost:bc.total, stockMode:true, customOrder:false, gradeFallback:usedGradeFallback?fbGrade:null, mediumFallback });
      } else if (bc.hasPrice && !bc.meetMin) {
        const stockSheetSqFt = (sh.w*sh.l)/144;
        const minBuySheets = Math.max(1, Math.ceil(bc.minSqFt/stockSheetSqFt));
        const stockCalc = calcBoard(bi, minBuySheets, true);
        if (stockCalc.pricable) {
          const scale = sheetsReq / minBuySheets;
          const scaledTotal = stockCalc.total * scale;
          const stockBc = {
            ...bc, pricable:true, meetMin:true, total:scaledTotal,
            effWithFsc:bc.oMsf>0?scaledTotal/bc.oMsf:0, costPc:totalQty>0?scaledTotal/totalQty:0,
            varCost:stockCalc.varCost*scale, fscAmt:stockCalc.fscAmt*scale,
            setup:0, pp:stockCalc.pp*scale, kemiChg:stockCalc.kemiChg*scale,
            stockMode:true, stockSheet:sh, stockMinBuy:minBuySheets,
          };
          results.push({ sheet:sh, layout, sheetsReq, bc:stockBc, cadHrs, totalCost:scaledTotal, stockMode:true, gradeFallback:usedGradeFallback?fbGrade:null, mediumFallback });
        }
      }
    });
    return results;
  }

  // ─── Build set of available mediums from sheets matching other criteria ───
  function getAvailableMediums() {
    const meds = new Set();
    const fbGrade = getGradeFallback(boardSpec.boardGrade);
    APPROVED_SHEETS.forEach(sh => {
      const gradeMatch = sh.g===boardSpec.boardGrade || (fbGrade && sh.g===fbGrade);
      if (sh.f===boardSpec.flute && gradeMatch && sh.ol===boardSpec.outsideLiner && sh.il===boardSpec.insideLiner) {
        meds.add(sh.md);
      }
    });
    return meds;
  }

  // ─── Priority 1: Custom board order at CAD max (126", 63" oversize pair) ───
  const maxDim = ENGINE.org_limits.max_dimension_in;
  const pairLim = ENGINE.org_limits.oversize_pair_limit_in;
  // No rotation: width stays width, so W must be ≤ pairLim (63") or both dims ≤ pairLim
  // Only valid orientation: W up to pairLim, L up to maxDim
  const cadCandidates = [];
  // Standard unrestricted: both dims up to maxDim, pair rule checked after
  const c1 = optimalCustom(maxDim, maxDim);
  if (c1) {
    // Pair rule: at least one dimension must be ≤ pairLim
    if (c1.sheet.w <= pairLim || c1.sheet.l <= pairLim) cadCandidates.push(c1);
  }
  // Constrained: W up to pairLim (63"), L up to maxDim (126") — the standard case
  const c2 = optimalCustom(pairLim, maxDim);
  if (c2) cadCandidates.push(c2);

  // Pricable custom orders only — no below-min custom (stock sheets handle below-min)
  // RULE-014b: Sort by estimated all-in cost (board + production), not board alone.
  // A smaller sheet may cost less board but needs more sheets through the press.
  const _pressPerSh = (assumptions.incaRate||460) / 100; // ~100 sh/hr satin
  const _cutPerSh = (assumptions.cadRate||160) / 240;     // ~240 sh/hr CAD standard
  const _allIn = (c) => c.totalCost + c.sheetsReq * (_pressPerSh + _cutPerSh);
  const pricable = cadCandidates.filter(c => c.pricable);
  if (pricable.length) {
    pricable.sort((a, b) => _allIn(a) - _allIn(b));
    return pricable[0];
  }

  // ─── Priority 2: Below minimum — use approved stock sheets ───
  let belowMin = findApprovedSheets(null, false);
  
  // If no sheets found with exact medium, try medium fallback
  if (belowMin.length === 0 && boardSpec.medium !== "None") {
    const availableMediums = getAvailableMediums();
    const fallbackResult = getMediumFallback(boardSpec.medium, availableMediums);
    if (fallbackResult) {
      belowMin = findApprovedSheets(fallbackResult.medium, fallbackResult.isHigher);
    }
  }
  
  if (belowMin.length) {
    belowMin.sort((a,b) => _allIn(a)-_allIn(b));
    return belowMin[0];
  }

  // ─── D-059: Mullen grade upgrade — try next higher Mullen grade in stock ───
  // Walks 125→150→175→200→250→275→350 until stock sheets are found.
  // Upgrading is always safe (stronger board meets/exceeds lower spec).
  let upgradeGrade = MULLEN_UPGRADE[boardSpec.boardGrade];
  while (upgradeGrade) {
    const upgradeAdder = GRADE_ADDER_DEFAULTS[upgradeGrade] || 0;
    const upgResults = [];
    APPROVED_SHEETS.forEach(sh => {
      if (sh.f!==boardSpec.flute||sh.g!==upgradeGrade||sh.ol!==boardSpec.outsideLiner||sh.il!==boardSpec.insideLiner||sh.md!==boardSpec.medium) return;
      const layout = computeLayout(oneUpW, oneUpL, sh.w, sh.l);
      if (!layout) return;
      const sheetsReq = Math.ceil(totalQty/layout.pcsPerSheet);
      const bi = {...boardSpec, boardGrade:upgradeGrade, gradeAdder:upgradeAdder, medium:boardSpec.medium, widthIn:sh.w, lengthIn:sh.l};
      const bc = calcBoard(bi, sheetsReq, true);
      const cadFbMin = (CAD_FALLBACK[assumptions.cadDifficulty||"Standard"]||6)*sheetsReq;
      const cadHrs = ((CAD_SETUP[assumptions.cadDifficulty||"Standard"]||15)+cadFbMin)/60;
      if (bc.pricable) {
        upgResults.push({sheet:sh, layout, sheetsReq, bc, cadHrs, totalCost:bc.total, stockMode:true, customOrder:false, gradeFallback:upgradeGrade, mullenUpgrade:true});
      } else if (bc.hasPrice && !bc.meetMin) {
        const stockSqFt = (sh.w*sh.l)/144;
        const minBuySheets = Math.max(1, Math.ceil(bc.minSqFt/stockSqFt));
        const stockCalc = calcBoard(bi, minBuySheets, true);
        if (stockCalc.pricable) {
          const scale = sheetsReq / minBuySheets;
          const scaledTotal = stockCalc.total * scale;
          const stockBc = {...bc, pricable:true, meetMin:true, total:scaledTotal,
            effWithFsc:bc.oMsf>0?scaledTotal/bc.oMsf:0, costPc:totalQty>0?scaledTotal/totalQty:0,
            varCost:stockCalc.varCost*scale, fscAmt:stockCalc.fscAmt*scale,
            setup:0, pp:stockCalc.pp*scale, kemiChg:stockCalc.kemiChg*scale,
            stockMode:true, stockSheet:sh, stockMinBuy:minBuySheets};
          upgResults.push({sheet:sh, layout, sheetsReq, bc:stockBc, cadHrs, totalCost:scaledTotal, stockMode:true, gradeFallback:upgradeGrade, mullenUpgrade:true});
        }
      }
    });
    if (upgResults.length) {
      upgResults.sort((a,b) => _allIn(a)-_allIn(b));
      return upgResults[0];
    }
    upgradeGrade = MULLEN_UPGRADE[upgradeGrade]; // try next grade up
  }

  // ─── Fallback: One-up exceeds stock sheet library ───
  // Check if the required sheet can fit through any machine
  // CAD max: 63×126 (pair rule), Crest max: 60×120
  const reqW = oneUpW + 2;  // with trim
  const reqL = oneUpL + 2;
  
  // Check if ANY machine can handle this sheet
  const fitsCad = (reqW <= pairLim && reqL <= maxDim) || (reqL <= pairLim && reqW <= maxDim);
  const fitsCrest = (reqW <= CREST_MAX_W && reqL <= CREST_MAX_L) || (reqL <= CREST_MAX_W && reqW <= CREST_MAX_L);
  
  if (!fitsCad && !fitsCrest) {
    // No machine can handle this size - return with error flag and reason
    return { 
      noSheet: true, 
      exceedsMachineCapacity: true,
      capacityError: `Blank size ${reqW}\u00D7${reqL} (with trim) is too large for any machine. Cannot manufacture.`
    };
  }
  
  // Size fits a machine - calculate with warning
  const fallbackCandidates = [];
  
  function tryOversizeFallback(w, l, label) {
    const bi = { ...boardSpec, widthIn: w, lengthIn: l };
    const bc = calcBoard(bi, totalQty);
    if (!bc.hasPrice) return null;
    const layout = { numUp: 1, numOut: 1, pcsPerSheet: 1, wastePct: 0, sheetW: w, sheetL: l };
    const sheet = { id: label, g: boardSpec.boardGrade, f: boardSpec.flute, ol: boardSpec.outsideLiner, il: boardSpec.insideLiner, md: boardSpec.medium, w, l };
    const cadFbMin = (CAD_FALLBACK[assumptions.cadDifficulty || "Standard"] || 6) * totalQty;
    const cadHrs = ((CAD_SETUP[assumptions.cadDifficulty || "Standard"] || 15) + cadFbMin) / 60;
    const meetsPairRule = w <= pairLim || l <= pairLim;
    return { 
      sheet, layout, sheetsReq: totalQty, bc, cadHrs, totalCost: bc.total || 0, 
      stockMode: false, customOrder: true, meetsPairRule,
      exceedsSheetLibrary: true,
      exceedsWarning: `Piece is larger than any stock sheet. Will need a custom board order.`
    };
  }
  
  // Try with trim allowance
  const fb1 = tryOversizeFallback(reqW, reqL, "CUSTOM-OVERSIZE");
  if (fb1) fallbackCandidates.push(fb1);
  
  // Try rotated orientation
  if (oneUpW !== oneUpL) {
    const fb2 = tryOversizeFallback(reqL, reqW, "CUSTOM-OVERSIZE-R");
    if (fb2) fallbackCandidates.push(fb2);
  }
  
  if (fallbackCandidates.length) {
    fallbackCandidates.sort((a, b) => {
      if (a.meetsPairRule !== b.meetsPairRule) return a.meetsPairRule ? -1 : 1;
      return a.totalCost - b.totalCost;
    });
    return fallbackCandidates[0];
  }

  return null;
}

// ─── Auto-routing (RULE-017 through RULE-021) ───
function autoRoute(cadHrs, selectedSheet, oneUpW, oneUpL, boardSpec, totalQty, assumptions) {
  // ─── D-121 RULE-021 + D-123: Bobst first-preference ───
  // When eligible (E/F flute + envelope) and bobstFirstSizing flag on, try a Bobst-shaped sheet
  // BEFORE checking CAD/Crest. selectBobstSheet handles below-mill-min via stock-min-buy scaling.
  // Bobst pricing is fast & flat: 3000 sh/hr, $350/hr, 45 min setup, $250 min, $1800 default die.
  if (assumptions.bobstFirstSizing !== "false") {
    const bSel = selectBobstSheet(oneUpW, oneUpL, boardSpec, totalQty, assumptions);
    if (bSel && bSel.viable) {
      return { route:"Bobst", sheet:bSel, warning:null, cadHrs };
    }
  }

  // RULE-017: CAD default — if hours fit, keep the sheet as-is
  if (cadHrs<=8) return { route:"CAD", sheet:selectedSheet, warning:null };

  // RULE-018: Crest threshold — re-impose at Crest max (60×120)
  // NOTE: Cannot rotate piece orientation — first dimension is corrugation direction in industry standard.
  // Swapping W↔L would misalign flutes with piece structure (bad for box stacking strength).
  const nUp = Math.floor((CREST_MAX_W - 2) / oneUpW);
  const nOut = Math.floor((CREST_MAX_L - 2) / oneUpL);
  if (nUp >= 1 && nOut >= 1) {
    const shW = nUp * oneUpW + 2;  // exact imposition + trim
    const shL = nOut * oneUpL + 2;
    const pcsPerSheet = nUp * nOut;
    const sheetsReq = Math.ceil(totalQty / pcsPerSheet);
    const bi = { ...boardSpec, widthIn: shW, lengthIn: shL };
    const bc = calcBoard(bi, sheetsReq);
    const wastePct = 1 - ((nUp * oneUpW * nOut * oneUpL) / (shW * shL));
    const layout = { numUp: nUp, numOut: nOut, pcsPerSheet, wastePct, sheetW: shW, sheetL: shL };
    const sheet = { id: `CREST-${nUp}x${nOut}`, g: boardSpec.boardGrade, f: boardSpec.flute, ol: boardSpec.outsideLiner, il: boardSpec.insideLiner, md: boardSpec.medium, w: shW, l: shL };
    const ruleInPerPc = pn(assumptions.totalRuleInches||0);
    const sheetRuleInches = ruleInPerPc>0 ? ruleInPerPc * pcsPerSheet * 1.15 : 0;
    const warning = sheetRuleInches>1000 ? `Crest die has ${Math.round(sheetRuleInches)} rule inches per sheet (over 1,000) — needs approval before ordering die` : null;

    if (bc.pricable) {
      const crestResult = { sheet, layout, sheetsReq, bc, totalCost: bc.total, stockMode: false, customOrder: true };
      return { route:"Crest", sheet:crestResult, warning, cadHrs, sheetRuleInches };
    }

    // Below min for custom Crest sheet — try stock sheets within Crest limits
    const stockCandidates = [];
    const crestFbGrade = getGradeFallback(boardSpec.boardGrade);
    APPROVED_SHEETS.forEach(sh => {
      const crestGradeMatch = sh.g===boardSpec.boardGrade || (crestFbGrade && sh.g===crestFbGrade);
      if (sh.f!==boardSpec.flute||!crestGradeMatch||sh.ol!==boardSpec.outsideLiner||sh.il!==boardSpec.insideLiner||sh.md!==boardSpec.medium) return;
      if (sh.w>CREST_MAX_W||sh.l>CREST_MAX_L) return;
      const sLayout = computeLayout(oneUpW, oneUpL, sh.w, sh.l);
      if (!sLayout) return;
      const sReq = Math.ceil(totalQty/sLayout.pcsPerSheet);
      const sBi = { ...boardSpec, widthIn:sh.w, lengthIn:sh.l };
      const sBc = calcBoard(sBi, sReq, true);
      if (sBc.pricable) {
        const crestUsedFallback = sh.g!==boardSpec.boardGrade;
        stockCandidates.push({ sheet:sh, layout:sLayout, sheetsReq:sReq, bc:sBc, totalCost:sBc.total, stockMode:true, customOrder:false, gradeFallback:crestUsedFallback?crestFbGrade:null });
      } else if (sBc.hasPrice && !sBc.meetMin) {
        const stockSqFt = (sh.w*sh.l)/144;
        const minBuy = Math.max(1, Math.ceil(sBc.minSqFt/stockSqFt));
        const stockCalc = calcBoard(sBi, minBuy, true);
        if (stockCalc.pricable) {
          const scale = sReq/minBuy;
          const scaledTotal = stockCalc.total*scale;
          const stockBc = { ...sBc, pricable:true, meetMin:true, total:scaledTotal, effWithFsc:sBc.oMsf>0?scaledTotal/sBc.oMsf:0, costPc:totalQty>0?scaledTotal/totalQty:0, stockMode:true };
          stockCandidates.push({ sheet:sh, layout:sLayout, sheetsReq:sReq, bc:stockBc, totalCost:scaledTotal, stockMode:true, gradeFallback:sh.g!==boardSpec.boardGrade?crestFbGrade:null });
        }
      }
    });
    if (stockCandidates.length) {
      const _rPrSh = (assumptions.incaRate||460) / 100, _rCtSh = (assumptions.cadRate||160) / 240;
      stockCandidates.sort((a,b) => (a.totalCost+a.sheetsReq*(_rPrSh+_rCtSh))-(b.totalCost+b.sheetsReq*(_rPrSh+_rCtSh)));
      return { route:"Crest", sheet:stockCandidates[0], warning, cadHrs, sheetRuleInches };
    }
  }

  // RULE-020: Saber fallback
  return { route:"Saber + D/C", sheet:selectedSheet, warning:"Too many CAD hours and no Crest die fits — falling back to Saber + die cut", cadHrs };
}

// ─── Allocate job-level cost across MFG items ───
// items: [{type, oMSF}], totalCost: number, method: "By MSF"|"Equal"
// Returns array of allocated $ per item. FUL items always get 0.
function allocateJobCost(items, totalCost, method) {
  if (!items||items.length===0||totalCost<=0) return items?items.map(()=>0):[];
  const mfgIdxs = items.map((it,i)=>it.type==="Manufactured"?i:-1).filter(i=>i>=0);
  if (mfgIdxs.length===0) return items.map(()=>0);
  const alloc = items.map(()=>0);
  if (method==="Equal") {
    const share = totalCost / mfgIdxs.length;
    mfgIdxs.forEach(i=>{ alloc[i]=share; });
  } else {
    // By MSF — proportional
    const totalMSF = mfgIdxs.reduce((sum,i)=>sum+(items[i].oMSF||0),0);
    if (totalMSF<=0) {
      // fallback to equal if no MSF data
      const share = totalCost / mfgIdxs.length;
      mfgIdxs.forEach(i=>{ alloc[i]=share; });
    } else {
      mfgIdxs.forEach(i=>{ alloc[i]=totalCost*(items[i].oMSF||0)/totalMSF; });
    }
  }
  return alloc;
}

// ─── WF Production cost (baseline math, BOBST/Folder removed, tape+2side added) ───
function calcWF(boardCalc, sheetQty, finishedQty, fpps, prod, asmp) {
  if (!boardCalc||sheetQty<=0) return null;
  const b = boardCalc;
  const ordQty = finishedQty||(sheetQty*fpps);
  const oMSF = b.oMsf, matTotal = b.total, matTier = b.tier||"-";
  const shippedMSF = sheetQty * b.sqft / 1000; // D-058: actual shipped MSF (= oMSF unless Buy Min inflates bc)

  const printOn = prod.printRequired==="Yes";
  const whiteInk = printOn&&prod.whiteInk==="Yes";
  const twoSided = printOn&&prod.printSides==="2-Sided";
  const mkSheets = printOn?(whiteInk?asmp.whiteMR:asmp.regularMR):0;
  const spoilSheets = printOn?ceilInt(sheetQty*asmp.spoilagePct):0;
  const printRunSheets = printOn?sheetQty+mkSheets+spoilSheets:0;
  // Board material cost for makeup/spoilage sheets (variable cost scales linearly; setup/FSC are one-time)
  const extraSheets = mkSheets+spoilSheets;
  const matMakeready = extraSheets>0&&sheetQty>0 ? (b.varCost+b.pp)*extraSheets/sheetQty : 0;
  // convSheets defined after Saber section below
  const speed = printOn?(PRINT_SPEEDS[prod.printMode]||100):0;
  const grossSqFt = printOn?printRunSheets*b.sqft:0;
  const pressHrs = printOn&&speed>0?printRunSheets/speed:0;
  const pressCost = printOn?Math.max(pressHrs*asmp.incaRate,asmp.incaMinCharge):0;
  const inkCost = printOn?grossSqFt*asmp.regularInkRate:0;
  const whiteCost = whiteInk?asmp.whiteInkFactor*(matTotal+inkCost+pressCost):0;
  const side1Print = pressCost+inkCost+whiteCost;
  const side2Cost = twoSided?side1Print*asmp.side2PrintFactor:0;
  const printDirect = side1Print+side2Cost;

  const saberOn = prod.saber==="Yes";
  const nCuts = saberOn?Math.max(1,parseInt(prod.saberCuts,10)||1):0;
  const blanksOut = saberOn?Math.max(1,parseInt(prod.saberBlanksOut,10)||1):1;
  // Saber cost based on sheetQty (Saber processes original sheets)
  const saberLifts = saberOn?ceilInt(sheetQty/10):0;
  const saberHrlyCost = saberOn?Math.max((saberLifts*10/60)*asmp.saberRate,asmp.saberMinCharge)*nCuts:0;
  const saberCutAdder = saberOn?(asmp.saberCostPerCut||0)*nCuts*sheetQty:0;
  const saberCost = saberHrlyCost+saberCutAdder;
  // Downstream operations see blanks, not sheets
  const convSheets = saberOn ? sheetQty * blanksOut : sheetQty;

  // Cutter: only CAD or Crest (BOBST removed)
  const route = prod.route||"CAD";
  let cutterDirect=0, cutterBasis="", cadHrs=0;
  if (route==="CAD"||route==="Saber + D/C") {
    const diff = prod.cadDifficulty||"Standard";
    let setupMin = CAD_SETUP[diff]||15;
    const ruleIn = pn(prod.totalRuleInches);
    const perfPct = pn(prod.perfPct);
    const override = pn(prod.cadSheetsPerHourOverride);
    const pMats = prod.productMats==="Yes";
    const cadPerfFactor = asmp.cadPerfSpeedFactor||0.4;
    const cadPerfSpeed = asmp.cadRegularSpeed*cadPerfFactor;
    let runtimeMin = 0;
    if (override>0) {
      runtimeMin = convSheets>0?(convSheets/override)*60:0;
      cutterBasis=`CAD override ${fn(override,0,0)} sh/hr`;
    } else if (prod.cadPricingMethod==="By Inches of Rule"&&ruleIn>0) {
      const effectiveFpps = saberOn&&prod.saberPcsPerBlank?prod.saberPcsPerBlank:fpps;
      const sheetRuleIn = ruleIn * effectiveFpps * 1.15;  // per-piece × outs/blank × 15% trim+breaker knives)
      const totalIn = sheetRuleIn*convSheets;     // total inches across all blanks for runtime
      runtimeMin = (totalIn*(1-perfPct)/asmp.cadRegularSpeed)+(totalIn*perfPct/cadPerfSpeed);
      if(pMats){runtimeMin+=2*convSheets;setupMin=Math.max(setupMin,CAD_SETUP.Standard);}
      cutterBasis=`${fn(ruleIn,0,0)} in/pc \u00D7 ${effectiveFpps} out${saberOn?" /blank":""} \u00D7 1.15 = ${fn(sheetRuleIn,0,0)} in/${saberOn?"blank":"sh"}`;
    } else {
      let bm = CAD_FALLBACK[diff]||6;
      if(pMats){bm=Math.max(bm,5);setupMin=Math.max(setupMin,CAD_SETUP.Standard);}
      runtimeMin = convSheets*bm*((1-perfPct)+(perfPct/cadPerfFactor));
      if(pMats)runtimeMin+=2*convSheets;
      cutterBasis=diff;
    }
    cadHrs = (setupMin+runtimeMin)/60;
    cutterDirect = Math.max(cadHrs*asmp.cadRate,asmp.cadMinCharge);
  } else if (route==="Crest") {
    const cComp = prod.crestComplexity||"Standard";
    const setupMin = asmp.crestSetup?.[cComp]||asmp.crestSetup?.Standard||45;
    const effSpeed = cComp==="Advanced" ? asmp.crestSpeed*(asmp.crestAdvSpeedFactor||0.8) : asmp.crestSpeed;  // Advanced slowdown
    const runtimeHr = convSheets>0&&effSpeed>0?convSheets/effSpeed:0;
    cadHrs = setupMin/60+runtimeHr;
    cutterDirect = Math.max(cadHrs*asmp.crestRate,asmp.crestMinCharge);
    cutterBasis=`Crest ${cComp}${cComp==="Advanced"?` (${fn((asmp.crestAdvSpeedFactor||0.8)*100,0)}% spd)`:""}, ${fn(convSheets,0,0)} ${saberOn?"blanks":"sheets"}`;
  } else if (route==="Bobst") {
    // ─── D-121: Bobst — flat pricing, no Std/Adv buckets ───
    const setupMin = pn(asmp.bobstSetup)||45;
    const effSpeed = pn(asmp.bobstSpeed)||3000;
    const runtimeHr = convSheets>0&&effSpeed>0?convSheets/effSpeed:0;
    cadHrs = setupMin/60+runtimeHr;
    cutterDirect = Math.max(cadHrs*(pn(asmp.bobstRate)||350), pn(asmp.bobstMinCharge)||0);
    cutterBasis=`Bobst flat, ${fn(convSheets,0,0)} ${saberOn?"blanks":"sheets"} @ ${fn(effSpeed,0,0)} sh/hr`;
  }

  // Die cost — markup always applied to base cost
  const dieBase = prod.dieTreatment==="None" ? 0 : pn(prod.cuttingDieCost);
  const dieCost = dieBase * (1 + pn(prod.dieMarkup));
  const dieSep = prod.dieTreatment==="Separate Line"&&dieCost>0;
  const dieLineCost = dieSep?dieCost:0;
  const dieEmbedded = !dieSep?dieCost:0;
  cutterDirect += dieEmbedded;

  // Hand stripping
  let stripCost=0;
  if (prod.handStripping==="Yes") {
    const sh = asmp.stackHeight>0?asmp.stackHeight:48;
    const cal = FLUTE_CALIPERS[prod.flute]||0.125;
    const spp = Math.max(1,Math.floor(sh/cal));
    const perimPallets = prod.perimeterStripping==="Yes"?ceilInt(convSheets/spp):0;
    const perimMin = perimPallets*asmp.perimeterStripMinPallet;
    const intMin = convSheets*(STRIP_DEFAULTS[prod.strippingComplexity]||1);
    stripCost = Math.max(((perimMin+intMin)/60)*asmp.handStrippingRate,asmp.handStrippingMinCharge);
  }

  // Assembly: glue OR tape
  let assemblyCost=0;
  if (prod.handGluing==="Yes") {
    const jppc = pn(prod.jointsPerPiece);
    const perJ = GLUE_DEFAULTS[prod.gluingComplexity]||0.75;
    assemblyCost = Math.max((ordQty*jppc*perJ/60)*asmp.handGluingRate,asmp.handGluingMinCharge);
  } else if (prod.tape==="Yes") {
    const costPerFt = prod.tapeType==="Reinforced"?asmp.reinforcedTapeCostPerFt:asmp.clearTapeCostPerFt;
    const ftPerPc = asmp.tapeFootPerPiece||2;
    assemblyCost = ordQty*ftPerPc*costPerFt;
  }

  // Freight
  const freightAmt = prod.freightTreatment==="None" ? 0 : pn(prod.freightCost) * (1 + pn(prod.freightMarkup));
  const freightSep = prod.freightTreatment==="Separate Line"&&freightAmt>0;
  const freightLine = freightSep?freightAmt:0;
  const freightEmbed = !freightSep?freightAmt:0;

  // Prepress — no markup, separate one-time cost (only when printed)
  const prepressBase = (prod.printRequired==="Yes"&&prod.prepressTreatment!=="None") ? pn(prod.prepressCost) : 0;
  const prepressCost = prepressBase; // no markup on prepress
  const prepressSep = prod.prepressTreatment==="Separate Line"&&prepressCost>0;
  const prepressLineCost = prepressSep?prepressCost:0;
  const prepressEmbedded = !prepressSep?prepressCost:0;

  // Misc charges — each works like die: base × (1 + markup), None/Line/Amort
  const miscItems=(prod.miscCharges||[]);
  let miscLineCost=0, miscEmbedded=0;
  const miscLineItems=[];
  miscItems.forEach(mc=>{
    if(mc.treatment==="None"||pn(mc.cost)<=0) return;
    const marked=pn(mc.cost)*(1+pn(prod.miscChargeMarkup||RATE_DEFAULTS.miscChargeMarkup));
    if(mc.treatment==="Separate Line"){miscLineCost+=marked;miscLineItems.push({name:mc.name,amt:marked});}
    else{miscEmbedded+=marked;}
  });

  // When Markup mode: die/freight/prepress/misc pass through at marked-up cost only — no overhead, no margin
  const totalDirect = matTotal+matMakeready+printDirect+saberCost+cutterDirect+stripCost+assemblyCost+freightEmbed+prepressEmbedded+miscEmbedded;
  const dieAmortMethod = prod.dieAmortMethod||"Markup";
  const markupExclude = dieAmortMethod==="Markup" ? (dieEmbedded + freightEmbed + prepressEmbedded + miscEmbedded) : 0;
  const directForOverhead = totalDirect - markupExclude;
  const overhead = directForOverhead*asmp.overheadPct;
  const totalMfg = totalDirect+overhead;
  const costPc = ordQty>0?totalMfg/ordQty:0;
  const costSh = sheetQty>0?totalMfg/sheetQty:0;
  const costMSF = oMSF>0?totalMfg/oMSF:0;

  const gmTierName = getGmMsfTier(oMSF);
  const _gmTable = prod.gmByTier||GM_DEFAULTS;
  const gmTier = _gmTable[gmTierName]!==undefined ? _gmTable[gmTierName] : (_gmTable[matTier]||0);
  const sellTierName = getGmMsfTier(oMSF);
  const _sellTable = prod.sellByTier||SELL_DEFAULTS;
  const sellTier = _sellTable[sellTierName]!==undefined ? _sellTable[sellTierName] : (_sellTable[matTier]||0);
  let itemSell=0;
  if (prod.pricingBasis==="Gross Margin %") {
    if (dieAmortMethod==="Markup"&&markupExclude>0) {
      // Markup method: GM% applies to mfg MINUS amortized costs, then add them back at cost (markup only, no overhead, no margin)
      const mfgForMargin = totalMfg - markupExclude;
      itemSell = ordQty>0&&gmTier<.9999 ? mfgForMargin/(1-gmTier) + markupExclude : 0;
    } else {
      // Order Margin: GM% applies to everything including amortized die/freight (with overhead)
      itemSell = ordQty>0&&gmTier<.9999 ? totalMfg/(1-gmTier) : 0;
    }
  } else {
    itemSell = sellTier*oMSF;
  }
  // sellTotal = item + line item charges (freight + die + prepress + misc with markup)
  const sellTotal=itemSell+freightLine+dieLineCost+prepressLineCost+miscLineCost;
  const sellPc=ordQty>0?sellTotal/ordQty:0;
  const sellSh=sheetQty>0?sellTotal/sheetQty:0;
  const sellMSF=oMSF>0?itemSell/oMSF:0;
  const gm$=itemSell-totalMfg;
  const gmPct=itemSell>0?gm$/itemSell:0;
  const gmMSF=oMSF>0?gm$/oMSF:0;

  return {
    sheetQty, ordQty, fpps, oSqFt:b.oSqFt, oMSF, shippedMSF, matTier, matTotal, matMakeready, matPerMsf:oMSF>0?matTotal/oMSF:0,
    printRunSheets, convSheets, grossSqFt, pressHrs, pressCost, inkCost, whiteCost, side2Cost, printDirect,
    saberCost, route, cutterDirect, cutterBasis, cadHrs,
    dieLineCost, dieSep, dieEmbedded, dieBase, dieAmortMethod, markupExclude, stripCost, assemblyCost, freightLine, freightEmbed, freightSep, prepressLineCost, prepressSep, prepressEmbedded, prepressBase,
    miscLineCost, miscEmbedded, miscLineItems,
    totalDirect, overhead, totalMfg, costPc, costSh, costMSF,
    itemSell, sellTotal, sellPc, sellSh, sellMSF, gm$, gmPct, gmMSF,
    pricable:b.pricable, status:b.pricable?"Pricable":(!b.hasPrice?"Unavailable":"Below Min"),
  };
}

// ═══════════════════════════════════════════════════════════════
// WEIGHT / SKID / FREIGHT ENGINE
// ═══════════════════════════════════════════════════════════════
// Default liner basis weights (lbs/MSF) by Mullen grade — ECT uses Mullen equivalent via ECT_GRADE_FALLBACK
const GRADE_LINER_DEFAULTS = {
  "125": { outer: 26, inner: 26, medium: 23 },
  "150": { outer: 33, inner: 26, medium: 23 },
  "175": { outer: 42, inner: 26, medium: 23 },
  "200": { outer: 42, inner: 42, medium: 23 },
  "250": { outer: 69, inner: 42, medium: 23 },
  "275": { outer: 69, inner: 69, medium: 26 },
  "350": { outer: 90, inner: 90, medium: 26 },
};
// Flute take-up factors (medium corrugation multiplier)
const FLUTE_TAKEUP = { "B": 1.36, "C": 1.44, "E": 1.27 };
// Skid definitions
const SKID_SIZES = {
  "S":  { label: "Small (40×48)",  w: 40, l: 48, weight: 75 },
  "L":  { label: "Large (51×72)",  w: 51, l: 72, weight: 100 },
  "WF": { label: "Wide Format (60×96)", w: 60, l: 96, weight: 200 },
};
const SKID_GRIPPER = 0.5, SKID_SIDE_GUIDE = 0.5, SKID_MAX_PRODUCT_HEIGHT = 44;
// Skid-count → trailer-feet lookup (from WF Freight spreadsheet)
const TRAILER_FEET = {
  "S":  [4,4,8,8,12,12,16,16,20,20,24,24,28,28,32,32,36,36,40,40,44,44,52,52],
  "L":  [5,9,13,17,22,26,30,34,39,43,47,51],
  "WF": [8,16,24,32,40,48],
};

// Calculate board weight in lbs/MSF from construction spec
function calcBoardWeight(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade) {
  // Resolve ECT → Mullen equivalent for liner defaults
  var mullenGrade = boardGrade;
  if (boardGrade && boardGrade.indexOf("ECT")===0) {
    var ectNum = boardGrade.replace("ECT ","").replace("ECT","");
    var fb = ECT_GRADE_FALLBACK[ectNum] || ECT_GRADE_FALLBACK[boardGrade];
    if (fb) mullenGrade = String(fb);
  }
  var defaults = GRADE_LINER_DEFAULTS[mullenGrade] || GRADE_LINER_DEFAULTS["200"];
  // Outer liner weight
  var outerWt = defaults.outer;
  if (outsideLiner && outsideLiner !== "None") {
    var m = outsideLiner.match(/^(\d+)#/);
    if (m) outerWt = parseInt(m[1]);
  }
  // Inner liner weight
  var innerWt = defaults.inner;
  if (insideLiner && insideLiner !== "None") {
    var m2 = insideLiner.match(/^(\d+)#/);
    if (m2) innerWt = parseInt(m2[1]);
  }
  // Medium weight
  var medWt = defaults.medium;
  if (mediumUpgrade && mediumUpgrade !== "None") {
    var m3 = mediumUpgrade.match(/^(\d+)/);
    if (m3) medWt = parseInt(m3[1]);
  }
  // Flute take-up
  var isDW = flute === "B/C";
  if (isDW) {
    // Doublewall: two medium layers
    var takeB = FLUTE_TAKEUP["B"] || 1.36;
    var takeC = FLUTE_TAKEUP["C"] || 1.44;
    return outerWt + innerWt + (medWt * takeB) + (medWt * takeC);
  }
  var takeup = FLUTE_TAKEUP[flute] || 1.36;
  return outerWt + innerWt + (medWt * takeup);
}

// Auto-select best skid size for given piece dimensions
function autoSelectSkid(pieceW, pieceL) {
  var sizes = ["S", "L", "WF"];
  for (var i = 0; i < sizes.length; i++) {
    var sk = SKID_SIZES[sizes[i]];
    var usableW = sk.w - SKID_SIDE_GUIDE;
    var usableL = sk.l - SKID_GRIPPER;
    // Check if piece fits in either orientation
    if ((pieceW <= usableW && pieceL <= usableL) || (pieceL <= usableW && pieceW <= usableL)) {
      return sizes[i];
    }
  }
  return "WF"; // fallback
}

// Calculate pieces per skid layer (nesting) — tries both orientations, picks best
function calcPiecesPerSkidLayer(pieceW, pieceL, skidKey) {
  var sk = SKID_SIZES[skidKey];
  if (!sk) return 1;
  var usableW = sk.w - SKID_SIDE_GUIDE;
  var usableL = sk.l - SKID_GRIPPER;
  // Orientation A: W along skid width
  var acrossW_A = Math.floor(usableW / pieceW);
  var acrossL_A = Math.floor(usableL / pieceL);
  var countA = acrossW_A * acrossL_A;
  // Orientation B: W along skid length
  var acrossW_B = Math.floor(usableW / pieceL);
  var acrossL_B = Math.floor(usableL / pieceW);
  var countB = acrossW_B * acrossL_B;
  return Math.max(countA, countB, 1);
}

// Full shipment weight calculation
// Liner abbreviation: Kraft (not K), Kemi (not K), Kla, Bleached, White
function fmLnr(l){return !l||l==="None"?"Kraft":l.replace(/\d+# /,"").replace("-Lite","").replace("-White","");}

function calcShipment(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade, totalMSF, pieceW, pieceL, qty, skidOverride) {
  var boardLbsMSF = calcBoardWeight(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade);
  var productWeight = boardLbsMSF * totalMSF * 1.05; // 5% ink adder
  // Skid calculation
  var skidKey = skidOverride || autoSelectSkid(pieceW, pieceL);
  var pcsPerLayer = calcPiecesPerSkidLayer(pieceW, pieceL, skidKey);
  var fluteCal = FLUTE_CALIPERS[flute] || 0.125;
  var layers = qty > 0 ? Math.ceil(qty / pcsPerLayer) : 0;
  var stackHeight = layers * fluteCal;
  var skidCount = stackHeight > 0 ? Math.ceil(stackHeight / SKID_MAX_PRODUCT_HEIGHT) : 1;
  var skidTotalWeight = (SKID_SIZES[skidKey]||{weight:75}).weight * skidCount;
  var totalWeight = productWeight + skidTotalWeight;
  // Trailer feet
  var ftTable = TRAILER_FEET[skidKey] || TRAILER_FEET["S"];
  var trailerFeet = skidCount <= ftTable.length ? ftTable[skidCount - 1] : (ftTable[ftTable.length-1] || 52);
  return {
    boardLbsMSF: boardLbsMSF,
    productWeight: Math.round(productWeight),
    skidKey: skidKey,
    skidLabel: (SKID_SIZES[skidKey]||{}).label||skidKey,
    pcsPerLayer: pcsPerLayer,
    layers: layers,
    stackHeight: Math.round(stackHeight * 10) / 10,
    skidCount: skidCount,
    skidTotalWeight: skidTotalWeight,
    totalWeight: Math.round(totalWeight),
    trailerFeet: trailerFeet,
  };
}

// ─── D-090: Route comparison — side-by-side CAD vs Crest economics ───
function compareRoutes(oneUpW, oneUpL, boardSpec, totalQty, asmp, opts) {
  if(oneUpW<=0||oneUpL<=0||totalQty<=0) return null;
  const printSpeed = PRINT_SPEEDS[opts.printMode]||100;
  const cComp = opts.crestComplexity||"Standard";
  const dieCostIn = pn(opts.dieCost);
  const dieHasInput = opts.dieTreatment!=="None"&&dieCostIn>0;
  const cNup = Math.floor((CREST_MAX_W-2)/oneUpW);
  const cNout = Math.floor((CREST_MAX_L-2)/oneUpL);
  if(cNup<1||cNout<1) return null;
  const cadSel = autoSelectSheet(oneUpW, oneUpL, boardSpec, totalQty, asmp);
  if(!cadSel||!cadSel.bc||!cadSel.bc.pricable) return null;
  const cadShW=cadSel.sheet?.w||0, cadShL=cadSel.sheet?.l||0;
  const cadPps=cadSel.layout.pcsPerSheet, cadReq=cadSel.sheetsReq;
  const cadBoard=cadSel.bc.total;
  const cadPressHrs=opts.printReq==="Yes"&&printSpeed>0?cadReq/printSpeed:0;
  const cadPress=Math.max(cadPressHrs*(asmp.incaRate||460),asmp.incaMinCharge||0);
  const cadCutHrs=cadSel.cadHrs||0;
  const cadCut=Math.max(cadCutHrs*(asmp.cadRate||160),asmp.cadMinCharge||0);
  const cadTotal=cadBoard+cadPress+cadCut;
  const cadSaberNeeded=cadShW>CREST_MAX_W||cadShL>CREST_MAX_L;
  const fbGrade = getGradeFallback(boardSpec.boardGrade);
  const candidates = [];
  const _prSh=(asmp.incaRate||460)/100, _crSh=(asmp.crestRate||45)/(asmp.crestSpeed||150);
  const cShW=cNup*oneUpW+2, cShL=cNout*oneUpL+2;
  const cPps=cNup*cNout, cReq=Math.ceil(totalQty/cPps);
  const cBi={...boardSpec,widthIn:cShW,lengthIn:cShL};
  const cBc=calcBoard(cBi,cReq);
  if(cBc.pricable){
    candidates.push({w:cShW,l:cShL,pps:cPps,req:cReq,bc:cBc,waste:0,isStock:false,
      allIn:cBc.total+cReq*(_prSh+_crSh)});
  }
  APPROVED_SHEETS.forEach(sh=>{
    if(sh.w>CREST_MAX_W||sh.l>CREST_MAX_L) return;
    const gm=sh.g===boardSpec.boardGrade||(fbGrade&&sh.g===fbGrade);
    if(sh.f!==boardSpec.flute||!gm||sh.ol!==boardSpec.outsideLiner||sh.il!==boardSpec.insideLiner||sh.md!==boardSpec.medium) return;
    const ly=computeLayout(oneUpW,oneUpL,sh.w,sh.l);
    if(!ly) return;
    const req=Math.ceil(totalQty/ly.pcsPerSheet);
    const bi={...boardSpec,widthIn:sh.w,lengthIn:sh.l};
    const bc=calcBoard(bi,req,true);
    if(bc.pricable){
      candidates.push({w:sh.w,l:sh.l,pps:ly.pcsPerSheet,req,bc,waste:ly.wastePct,isStock:true,
        allIn:bc.total+req*(_prSh+_crSh)});
    } else if(bc.hasPrice&&!bc.meetMin){
      const sqFt=(sh.w*sh.l)/144;
      const minBuy=Math.max(1,Math.ceil(bc.minSqFt/sqFt));
      const sc=calcBoard(bi,minBuy,true);
      if(sc.pricable){
        const scale=req/minBuy, scaled=sc.total*scale;
        candidates.push({w:sh.w,l:sh.l,pps:ly.pcsPerSheet,req,bc:{...bc,pricable:true,total:scaled,stockMode:true},
          waste:ly.wastePct,isStock:true,allIn:scaled+req*(_prSh+_crSh)});
      }
    }
  });
  if(!candidates.length) return null;
  candidates.sort((a,b)=>a.allIn-b.allIn);
  const cr=candidates[0];
  const crBoard=cr.bc.total;
  const crPressHrs=opts.printReq==="Yes"&&printSpeed>0?cr.req/printSpeed:0;
  const crPress=Math.max(crPressHrs*(asmp.incaRate||460),asmp.incaMinCharge||0);
  const cSetup=(asmp.crestSetup?.[cComp]||45)/60;
  const cEffSpd=cComp==="Advanced"?(asmp.crestSpeed||150)*((asmp.crestAdvSpeedFactor)||0.8):(asmp.crestSpeed||150);
  const crCutHrs=cSetup+(cEffSpd>0?cr.req/cEffSpd:0);
  const crCut=Math.max(crCutHrs*(asmp.crestRate||45),asmp.crestMinCharge||0);
  const ruleIn=pn(asmp.totalRuleInches);
  const estDie=Math.min(3000,Math.max(500,ruleIn*cr.pps*1.15*0.02));
  const dieCost=dieHasInput?dieCostIn:(ruleIn>0?estDie:(pn(asmp.crestDieCost)||1200));
  const dieEstimated=!dieHasInput;
  const crTotal=crBoard+crPress+crCut+dieCost;
  const delta=crTotal-cadTotal;
  const cadProdPerPc=(cadBoard+cadPress+cadCut)/totalQty;
  const crProdPerPc=(crBoard+crPress+crCut)/totalQty;
  const perPcDiff=cadProdPerPc-crProdPerPc;
  const breakevenQty=perPcDiff>0?Math.round(dieCost/perPcDiff):null;
  const breakevenDie=cadTotal-(crBoard+crPress+crCut);

  // ─── D-121 + D-123: Bobst column — flat pricing, E/F flute only, envelope-gated, mill-min-scaled ───
  let bobstViable=false, bobstReason=null, bobstIsMillMinScaled=false, bobstMinBuySheets=0;
  let bShW=0, bShL=0, bPps=0, bReq=0, bBoard=0, bPress=0, bCut=0, bCutHrs=0, bDieCost=0, bDieEstimated=false, bTotal=0;
  if(asmp.bobstFirstSizing !== "false"){
    const bSel = selectBobstSheet(oneUpW, oneUpL, boardSpec, totalQty, asmp);
    if(bSel && bSel.viable){
      bShW=bSel.sheet.w; bShL=bSel.sheet.l; bPps=bSel.layout.pcsPerSheet; bReq=bSel.sheetsReq;
      bBoard=bSel.bc.total;
      const bPressHrs=opts.printReq==="Yes"&&printSpeed>0?bReq/printSpeed:0;
      bPress=Math.max(bPressHrs*(asmp.incaRate||460),asmp.incaMinCharge||0);
      const bSetup=(asmp.bobstSetup||45)/60;
      const bSpeed=asmp.bobstSpeed||3000;
      bCutHrs=bSetup+(bSpeed>0?bReq/bSpeed:0);
      bCut=Math.max(bCutHrs*(asmp.bobstRate||350),asmp.bobstMinCharge||0);
      bDieCost=dieHasInput?dieCostIn:(asmp.bobstDieCost||1800);
      bDieEstimated=!dieHasInput;
      bTotal=bBoard+bPress+bCut+bDieCost;
      bobstViable=true;
      bobstIsMillMinScaled=!!bSel.isMillMinScaled;
      bobstMinBuySheets=bSel.minBuySheets||0;
    } else if(bSel){
      bobstReason=bSel.reason;
    }
  } else {
    bobstReason="Bobst-first sizing disabled";
  }

  return {
    viable:true,
    cad:{w:cadShW,l:cadShL,pps:cadPps,req:cadReq,board:cadBoard,press:cadPress,cut:cadCut,hrs:cadCutHrs,total:cadTotal,saberNeeded:cadSaberNeeded,isStock:!!cadSel.stockMode},
    crest:{w:cr.w,l:cr.l,pps:cr.pps,req:cr.req,board:crBoard,press:crPress,cut:crCut,hrs:crCutHrs,die:dieCost,dieEstimated,total:crTotal,isStock:cr.isStock},
    bobst: bobstViable ? {w:bShW,l:bShL,pps:bPps,req:bReq,board:bBoard,press:bPress,cut:bCut,hrs:bCutHrs,die:bDieCost,dieEstimated:bDieEstimated,total:bTotal,isStock:false,isMillMinScaled:bobstIsMillMinScaled,minBuySheets:bobstMinBuySheets} : null,
    bobstReason: bobstViable ? null : bobstReason,
    delta, // positive = CAD cheaper than Crest
    perPc:(crTotal-cadTotal)/totalQty,
    winner: bobstViable
      ? (bTotal<=cadTotal && bTotal<=crTotal ? "Bobst" : (delta>0 ? "CAD" : "Crest"))
      : (delta>0 ? "CAD" : "Crest"),
    breakeven:{qty:breakevenQty,die:Math.max(0,breakevenDie)},
    cadSaberNeeded,
  };
}

// MODULE EXPORTS
module.exports = {
  ENGINE, SHEET_GROUPS, APPROVED_SHEETS,
  FLUTE_CALIPERS, PRINT_SPEEDS, CAD_SETUP, CAD_FALLBACK,
  STRIP_DEFAULTS, GLUE_DEFAULTS,
  CAD_DIFF_MIGRATION, STRIP_DIFF_MIGRATION, SPOT_SCHEMA_VERSION,
  GM_MSF_TIERS, getGmMsfTier, GM_DEFAULTS, SELL_DEFAULTS,
  GRADE_ADDER_DEFAULTS, ECT_GRADE_FALLBACK, MULLEN_UPGRADE,
  MEDIUM_ORDER, MEDIUM_FALLBACK_POOL,
  CREST_MAX_W, CREST_MAX_L,
  RATE_DEFAULTS,
  pn, ceilInt, fm, fn, fp,
  getMsfTier, getDimAdder, getLinerRate,
  getGradesForFlute, getAllowedLiners,
  getGradeFallback, getMediumFallback,
  calcBoard, computeLayout, autoSelectSheet, selectBobstSheet, autoRoute, compareRoutes,
  calcWF, flatGm, allocateJobCost,
  calcBoardWeight, autoSelectSkid, calcPiecesPerSkidLayer, calcShipment, fmLnr,
  GRADE_LINER_DEFAULTS, FLUTE_TAKEUP, SKID_SIZES, TRAILER_FEET, SKID_MAX_PRODUCT_HEIGHT,
};
