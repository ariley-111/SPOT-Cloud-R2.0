#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// SPOT R1.5.6 — runEstimate() — EXACT mirror of app pipeline
// This function replicates the ENTIRE reactive chain:
//   calcResults → auto-flip → auto-BuyMin → re-calc
// ═══════════════════════════════════════════════════════════════
const E = require('./spot_engine.js');

const ASMP_DEFAULTS = {
  overheadPct: 0, regularInkRate: 0.05, whiteInkFactor: 0.5,
  regularMR: 5, whiteMR: 15, spoilagePct: 0.02,
  stackHeight: 48, perimeterStripMinPallet: 15, cadRegularSpeed: 650,
  incaRate: 485, cadRate: 138, crestRate: 45, saberRate: 2,
  handStrippingRate: 17, handGluingRate: 23,
  incaMinCharge: 0, cadMinCharge: 0, crestMinCharge: 0,
  saberMinCharge: 0, saberCostPerCut: 0, handStrippingMinCharge: 0, handGluingMinCharge: 0,
  crestSetup: { Standard: 45, Advanced: 90 }, crestSpeed: 150, crestAdvSpeedFactor: 0.8,
  clearTapeCostPerFt: 0.03, reinforcedTapeCostPerFt: 0.08,
  tapeFootPerPiece: 2, side2PrintFactor: 0.6,
  cadDifficulty: 'Standard', totalRuleInches: '0', under5MsfFee: 0, cadPerfSpeedFactor: 0.4,
  // ─── D-121: Crest default die cost (was hardcoded "0" — estimator placeholder) ───
  crestDieCost: 1200,
  // ─── D-121: Bobst rate parameters (uncalibrated — recalibrate after ~90 days shop-floor data) ───
  bobstRate: 350, bobstSpeed: 3000, bobstSetup: 45, bobstMinCharge: 250, bobstDieCost: 1800,
  // ─── D-123: Bobst-first sheet sizing flag (string-typed — engine compares against "false") ───
  bobstFirstSizing: "true",
};

// ─── Build assumptions object from rate overrides (mirrors app's asmp useMemo) ───
function buildAsmp(rateOverrides = {}) {
  return { ...ASMP_DEFAULTS, ...rateOverrides };
}

// ─── Build boardSpec from JSON fields (mirrors app's boardSpec useMemo) ───
function buildBoardSpec(json) {
  return {
    flute: json.flute || 'B',
    boardGrade: json.boardGrade || '200',
    outsideLiner: json.outsideLiner || '42# Kemi-Lite',
    insideLiner: json.insideLiner || 'None',
    medium: json.medium || 'None',
    fscEnabled: !!json.fscEnabled,
    fscFee: E.pn(json.fscFee || '25'),
    kemiTariff: E.pn(json.kemiTariff || '2.50'),
    palletPrepFee: E.pn(json.palletPrepFee || '17.50'),
    under5MsfFee: E.pn(json.under5MsfFee !== undefined ? json.under5MsfFee : E.RATE_DEFAULTS.under5MsfFee),
    gradeAdder: json.gradeAdder !== undefined ? E.pn(json.gradeAdder) : (E.GRADE_ADDER_DEFAULTS[json.boardGrade || '200'] || 0),
    widthIn: 0, lengthIn: 0,
  };
}

// ─── Build prodInputs from JSON (mirrors app's prodInputs construction at line 2674) ───
function buildProdInputs(json, routeResult, layout, asmp) {
  const prepressTreat = (json.prepressTreatment || 'Auto') === 'Auto' ? 'Amortize' : json.prepressTreatment;
  const prepressCost = (json.prepressTreatment || 'Auto') === 'Auto' ? (json.defaultPrepressCost || '50') : (json.prepressCost || '50');

  return {
    printRequired: json.printReq || json.printRequired || 'Yes',
    printMode: json.printMode || 'Satin',
    printSides: json.printSides || '1-Sided',
    whiteInk: json.whiteInk || 'No',
    saber: json.saber || 'No',
    saberCuts: json.saberCuts || '1',
    saberBlanksOut: json.saberBlanksOut || '1',
    saberPcsPerBlank: layout.pcsPerSheet, // updated below if Saber
    cadPricingMethod: json.cadPricingMethod || 'By Difficulty',
    cadDifficulty: json.cadDifficulty || 'Standard',
    crestComplexity: json.crestComplexity || 'Standard',
    totalRuleInches: json.totalRuleInches || '0',
    perfPct: json.perfPct || '0',
    cadSheetsPerHourOverride: json.cadSheetsPerHourOverride || '0',
    productMats: json.productMats || 'No',
    flute: json.flute || 'B',
    route: routeResult.route,
    handStripping: json.handStripping || 'No',
    perimeterStripping: json.perimeterStripping || 'No',
    strippingComplexity: json.strippingComplexity || 'Standard',
    handGluing: json.handGluing || 'No',
    jointsPerPiece: json.jointsPerPiece || '1',
    gluingComplexity: json.gluingComplexity || 'Standard',
    tape: json.tape || 'No',
    tapeType: json.tapeType || 'Clear',
    // Freight — FOB Origin = no freight cost
    freightCost: (json.quoteFOB || 'Origin') === 'Origin' ? '0'
      : (json.freightByQty && json.freightByQty[json._slotIndex] !== undefined ? json.freightByQty[json._slotIndex] : (json.freightCost || '0')),
    freightTreatment: (json.quoteFOB || 'Origin') === 'Origin' ? 'None' : (json.freightTreatment || 'Separate Line'),
    freightMarkup: json.freightMarkup || '0.15',
    cuttingDieCost: json.cuttingDieCost || '0',
    dieTreatment: json.dieTreatment || 'None',
    dieMarkup: json.dieMarkup || '0.15',
    dieAmortMethod: json.dieAmortMethod || 'Markup',
    miscCharges: json.miscCharges || [],
    miscChargeMarkup: json.miscChargeMarkup || '0.15',
    prepressCost,
    prepressTreatment: (json.prepressTreatment || 'Auto') === 'None' ? 'None' : prepressTreat,
    pricingBasis: json.pricingBasis || 'Gross Margin %',
    gmByTier: json.gmByTier || E.GM_DEFAULTS,
    sellByTier: json.sellByTier || E.SELL_DEFAULTS,
  };
}

// ═══════════════════════════════════════════════════════════════
// runEstimate — THE CORE FUNCTION
// Mirrors the app's FULL reactive pipeline:
//   1. autoSelectSheet (with full fallback chain)
//   2. Auto-flip corrugation (if piece doesn't fit)
//   3. autoRoute (CAD vs Crest, with Crest sheet re-selection)
//   4. Saber yield recalculation
//   5. Auto-enable Buy Min (if below minimum board order)
//   6. calcWF (full production cost)
//   7. GM/pricing
// ═══════════════════════════════════════════════════════════════
function runEstimate(json, slotIndex = 0) {
  const uw = E.pn(json.oneUpW), ul = E.pn(json.oneUpL);
  const qty = parseInt((json.qtys || [])[slotIndex] || json.qty || '0', 10);
  if (uw <= 0 || ul <= 0 || qty <= 0) {
    return { error: 'Invalid dimensions or qty', uw, ul, qty };
  }

  const boardSpec = buildBoardSpec(json);
  const asmp = buildAsmp(json.rateOverrides || {});

  // ═══ STEP 1: Auto-select sheet from approved inventory ═══
  // This is the EXACT function the app calls — no shortcuts
  let best = E.autoSelectSheet(uw, ul, boardSpec, qty, asmp);

  // ═══ STEP 2: Auto-flip corrugation (mirrors useEffect at line 2956) ═══
  // If piece has issues (exceeds sheet library or below min), try swapping W↔L
  let corrFlipped = false;
  if (best && (best.exceedsSheetLibrary || (best.bc && !best.bc.pricable && best.bc.hasPrice && !best.bc.meetMin))) {
    const flippedSel = E.autoSelectSheet(ul, uw, boardSpec, qty, asmp);
    if (flippedSel && flippedSel.bc && (flippedSel.bc.pricable || (flippedSel.bc.hasPrice && flippedSel.stockMode))) {
      // Flipped orientation is better — use it
      best = flippedSel;
      corrFlipped = true;
    }
  }

  // If still no sheet found at all
  if (!best) {
    // Try flipped as last resort
    const flippedLast = E.autoSelectSheet(ul, uw, boardSpec, qty, asmp);
    if (flippedLast) { best = flippedLast; corrFlipped = true; }
    else return { error: 'No sheet found', uw, ul, qty, boardGrade: boardSpec.boardGrade, flute: boardSpec.flute };
  }

  // ═══ STEP 3: Auto-route (mirrors line 2622) ═══
  // autoRoute handles CAD → Crest threshold and Crest sheet re-selection
  const autoR = E.autoRoute(best.cadHrs, best, corrFlipped ? ul : uw, corrFlipped ? uw : ul, boardSpec, qty, asmp);

  // routeOverride: per D-068, JSON should NEVER set routeOverride — always null/auto
  // But we handle it defensively
  const routeOverride = json.routeOverride || null;
  let routing;
  if (routeOverride && routeOverride !== 'Auto') {
    routing = routeOverride !== autoR.route
      ? { route: routeOverride, sheet: best, warning: `Forced to ${routeOverride}`, forced: true }
      : { ...autoR, forced: false };
  } else {
    routing = autoR;
  }

  // ═══ STEP 4: Extract sheet/layout/bc from routing result ═══
  const useSheet = routing.sheet || best;
  const layout = useSheet.layout || best.layout;
  let sheetsReq = useSheet.sheetsReq || best.sheetsReq;
  let bc = useSheet.bc || best.bc;
  const shW = useSheet.sheet?.w || useSheet.w || 0;
  const shL = useSheet.sheet?.l || useSheet.l || 0;

  // ═══ STEP 5: Saber yield recalculation (mirrors line 2644-2654) ═══
  const saberOn = (json.saber || 'No') === 'Yes';
  const saberBo = saberOn ? Math.max(1, parseInt(json.saberBlanksOut || '1', 10)) : 1;
  let saberBlankLayout = null;
  if (saberOn && shW > 0 && shL > 0 && uw > 0 && ul > 0) {
    saberBlankLayout = E.computeLayout(uw, ul, shW, Math.round(shL / saberBo * 100) / 100);
  }
  if (saberOn && saberBo > 1 && saberBlankLayout) {
    const effectivePcs = saberBlankLayout.pcsPerSheet * saberBo;
    if (effectivePcs > 0 && effectivePcs < layout.pcsPerSheet) {
      sheetsReq = Math.ceil(qty / effectivePcs);
      bc = E.calcBoard({ ...boardSpec, widthIn: shW, lengthIn: shL }, sheetsReq, useSheet.stockMode);
    }
  }

  // ═══ STEP 6: Auto-enable Buy Min (mirrors useEffect at line 2975) ═══
  // When bc is below minimum and no stock resolution, Buy Min auto-fires
  let buyMinBoard = json.buyMinBoard || 'Auto';
  const boardSubstitution = json.boardSubstitution || null;

  if (bc && bc.hasPrice && !bc.pricable && !bc.meetMin && buyMinBoard === 'Auto') {
    buyMinBoard = 'Yes'; // Auto-enable — matches the useEffect
  }

  // ═══ STEP 7: Buy Min recalculation (mirrors line 2656-2665) ═══
  const forceCustomOrder = buyMinBoard === 'Yes' && boardSubstitution === 'forced';
  if (buyMinBoard === 'Yes' && bc && bc.hasPrice && ((!bc.pricable && !bc.meetMin) || forceCustomOrder)) {
    const bmSqFt = (shW * shL) / 144;
    const bmMinSheets = Math.max(1, Math.ceil((bc.minSqFt || 15000) / bmSqFt));
    const bmBc = E.calcBoard({ ...boardSpec, widthIn: shW, lengthIn: shL }, bmMinSheets, false);
    if (bmBc && bmBc.pricable) {
      bc = { ...bmBc, pricable: true, meetMin: true, buyMin: true, buyMinSheets: bmMinSheets, actualSheets: sheetsReq };
    }
  }

  // If STILL not pricable after all fallbacks
  if (!bc || !bc.pricable) {
    return {
      error: bc ? (bc.hasPrice ? 'Below minimum (all fallbacks exhausted)' : 'No price for grade/tier') : 'No board calc',
      uw, ul, qty, boardGrade: boardSpec.boardGrade, flute: boardSpec.flute,
      sheet: shW > 0 ? `${shW}x${shL}` : null,
      gradeFallback: best.gradeFallback || null,
      mediumFallback: best.mediumFallback || null,
      corrFlipped,
    };
  }

  // ═══ STEP 8: Build production inputs (mirrors line 2674-2691) ═══
  const prodInputs = buildProdInputs({
    ...json,
    _slotIndex: slotIndex,
    defaultPrepressCost: json.defaultPrepressCost || E.RATE_DEFAULTS.defaultPrepressCost,
  }, routing, layout, asmp);

  // Update saberPcsPerBlank if Saber recalculated
  if (saberBlankLayout) {
    prodInputs.saberPcsPerBlank = saberBlankLayout.pcsPerSheet;
  }

  // ═══ STEP 9: calcWF — full production cost (mirrors line 2692) ═══
  const wf = E.calcWF(bc, sheetsReq, qty, layout.pcsPerSheet, prodInputs, asmp);
  if (!wf) return { error: 'calcWF returned null', uw, ul, qty };

  // ═══ STEP 10: Forced sell override (mirrors line 2694-2704) ═══
  const fsp = E.pn((json.forcedSellPc || {})[slotIndex]);
  if (fsp > 0 && wf.pricable) {
    wf.itemSell = fsp * qty;
    wf.sellTotal = wf.itemSell + wf.freightLine + wf.dieLineCost + (wf.prepressLineCost || 0) + (wf.miscLineCost || 0);
    wf.sellPc = qty > 0 ? wf.sellTotal / qty : 0;
    wf.sellSh = sheetsReq > 0 ? wf.sellTotal / sheetsReq : 0;
    wf.sellMSF = wf.oMSF > 0 ? wf.itemSell / wf.oMSF : 0;
    wf.gm$ = wf.itemSell - wf.totalMfg;
    wf.gmPct = wf.itemSell > 0 ? wf.gm$ / wf.itemSell : 0;
    wf.gmMSF = wf.oMSF > 0 ? wf.gm$ / wf.oMSF : 0;
    wf.forcedPrice = true;
  }

  // ═══ STEP 11: Shipment calculation ═══
  const effW = corrFlipped ? ul : uw;
  const effL = corrFlipped ? uw : ul;
  const ship = E.calcShipment(boardSpec.boardGrade, boardSpec.flute,
    boardSpec.outsideLiner, boardSpec.insideLiner, boardSpec.medium,
    wf.shippedMSF || wf.oMSF, effW, effL, qty);

  // ═══ RETURN — complete result matching app's calcResults row shape ═══
  return {
    // Pipeline trace (for debugging — shows what the engine decided)
    _pipeline: {
      corrFlipped,
      buyMinActive: !!(bc.buyMin),
      buyMinSheets: bc.buyMinSheets || null,
      gradeFallback: best.gradeFallback || null,
      mediumFallback: best.mediumFallback || null,
      mullenUpgrade: !!best.mullenUpgrade,
      stockMode: !!best.stockMode || !!bc.stockMode,
      customOrder: !!best.customOrder,
      exceedsSheetLibrary: !!best.exceedsSheetLibrary,
      routeAuto: autoR.route,
      routeForced: routing.forced || false,
    },

    // Inputs
    oneUpW: effW, oneUpL: effL, qty,
    flute: boardSpec.flute, boardGrade: boardSpec.boardGrade,
    outsideLiner: boardSpec.outsideLiner, insideLiner: boardSpec.insideLiner, medium: boardSpec.medium,

    // Sheet selection
    sheetW: shW, sheetL: shL,
    sheetId: (useSheet.sheet || best.sheet)?.id,
    pcsPerSheet: layout.pcsPerSheet,
    numUp: layout.numUp, numOut: layout.numOut,
    wastePct: layout.wastePct,
    sheetsReq,

    // Board cost
    oMSF: wf.oMSF,
    shippedMSF: wf.shippedMSF,
    msfTier: wf.matTier,
    boardBase: bc.base,
    boardEffRate: bc.effRate,
    boardTotal: bc.total,

    // Route
    route: routing.route || wf.route,
    cadHrs: wf.cadHrs,

    // Cost breakdown
    matTotal: wf.matTotal,
    matMakeready: wf.matMakeready,
    pressCost: wf.pressCost,
    inkCost: wf.inkCost,
    whiteCost: wf.whiteCost,
    side2Cost: wf.side2Cost,
    printDirect: wf.printDirect,
    saberCost: wf.saberCost,
    cutterDirect: wf.cutterDirect,
    dieEmbedded: wf.dieEmbedded,
    dieLineCost: wf.dieLineCost,
    stripCost: wf.stripCost,
    assemblyCost: wf.assemblyCost,
    freightLine: wf.freightLine,
    freightEmbed: wf.freightEmbed,
    prepressLineCost: wf.prepressLineCost,
    prepressEmbedded: wf.prepressEmbedded,
    miscLineCost: wf.miscLineCost,
    overhead: wf.overhead,
    totalDirect: wf.totalDirect,
    totalMfg: wf.totalMfg,
    costPc: wf.costPc,
    costMSF: wf.costMSF,

    // Sell / GM
    itemSell: wf.itemSell,
    sellTotal: wf.sellTotal,
    sellPc: wf.sellPc,
    sellMSF: wf.sellMSF,
    gmDollar: wf.gm$,
    gmPct: wf.gmPct,
    gmMSF: wf.gmMSF,
    pricable: wf.pricable,
    status: wf.status,

    // Shipment
    shipWeight: ship.totalWeight,
    skidCount: ship.skidCount,
    skidKey: ship.skidKey,
    trailerFeet: ship.trailerFeet,
    boardLbsMSF: ship.boardLbsMSF,
  };
}

// ═══════════════════════════════════════════════════════════════
// runFullEstimate — Runs ALL qty slots from a JSON estimate
// Returns array of results matching activeRows shape
// ═══════════════════════════════════════════════════════════════
function runFullEstimate(json) {
  const qtys = json.qtys || [];
  const results = [];
  for (let i = 0; i < qtys.length; i++) {
    const qty = parseInt(qtys[i], 10);
    if (qty <= 0) continue;
    const r = runEstimate(json, i);
    results.push({ slot: i, ...r });
  }
  return results;
}

module.exports = { runEstimate, runFullEstimate, buildBoardSpec, buildAsmp, buildProdInputs, ASMP_DEFAULTS };
