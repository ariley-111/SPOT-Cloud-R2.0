/* Shipment/freight weight & skid math — verbatim port of legacy spot_r1_5.jsx
 * L1118-1248 (calcBoardWeight, autoSelectSkid, calcPiecesPerSkidLayer, calcShipment).
 *
 * Used by FreightPanel in RightDashboard.jsx to keep cloud parity with legacy's
 * per-component "compute own skids then sum into one combined LTL quote"
 * pattern (legacy `updateAllFreight`, L4314).
 */

const FLUTE_CALIPERS = { E: 0.0625, B: 0.125, C: 0.1875, "B/C": 0.236 };
const FLUTE_TAKEUP = { B: 1.36, C: 1.44, E: 1.27 };

// Default liner basis weights (lbs/MSF) by Mullen grade.
const GRADE_LINER_DEFAULTS = {
  "125": { outer: 26, inner: 26, medium: 23 },
  "150": { outer: 33, inner: 26, medium: 23 },
  "175": { outer: 42, inner: 26, medium: 23 },
  "200": { outer: 42, inner: 42, medium: 23 },
  "250": { outer: 69, inner: 42, medium: 23 },
  "275": { outer: 69, inner: 69, medium: 26 },
  "350": { outer: 90, inner: 90, medium: 26 },
};

// ECT → Mullen equivalent (legacy ECT_GRADE_FALLBACK keys present in calcShipment context).
const ECT_GRADE_FALLBACK = {
  "ECT 23": "125", "ECT 26": "150", "ECT 29": "175",
  "ECT 32": "200", "ECT 40": "250", "ECT 44": "275",
  "ECT 55": "350",
  "23": "125", "26": "150", "29": "175",
  "32": "200", "40": "250", "44": "275", "55": "350",
};

const SKID_SIZES = {
  S:  { label: "Small (40×48)",  w: 40, l: 48, weight: 75 },
  L:  { label: "Large (51×72)",  w: 51, l: 72, weight: 100 },
  WF: { label: "Wide Format (60×96)", w: 60, l: 96, weight: 200 },
};
const SKID_GRIPPER = 0.5;
const SKID_SIDE_GUIDE = 0.5;
const SKID_MAX_PRODUCT_HEIGHT = 44;

const TRAILER_FEET = {
  S:  [4,4,8,8,12,12,16,16,20,20,24,24,28,28,32,32,36,36,40,40,44,44,52,52],
  L:  [5,9,13,17,22,26,30,34,39,43,47,51],
  WF: [8,16,24,32,40,48],
};

export function calcBoardWeight(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade) {
  let mullenGrade = boardGrade;
  if (boardGrade && boardGrade.indexOf("ECT") === 0) {
    const ectNum = boardGrade.replace("ECT ", "").replace("ECT", "");
    const fb = ECT_GRADE_FALLBACK[ectNum] || ECT_GRADE_FALLBACK[boardGrade];
    if (fb) mullenGrade = String(fb);
  }
  const defaults = GRADE_LINER_DEFAULTS[mullenGrade] || GRADE_LINER_DEFAULTS["200"];
  let outerWt = defaults.outer;
  if (outsideLiner && outsideLiner !== "None") {
    const m = String(outsideLiner).match(/^(\d+)#/);
    if (m) outerWt = parseInt(m[1], 10);
  }
  let innerWt = defaults.inner;
  if (insideLiner && insideLiner !== "None") {
    const m = String(insideLiner).match(/^(\d+)#/);
    if (m) innerWt = parseInt(m[1], 10);
  }
  let medWt = defaults.medium;
  if (mediumUpgrade && mediumUpgrade !== "None") {
    const m = String(mediumUpgrade).match(/^(\d+)/);
    if (m) medWt = parseInt(m[1], 10);
  }
  if (flute === "B/C") {
    return outerWt + innerWt + (medWt * FLUTE_TAKEUP.B) + (medWt * FLUTE_TAKEUP.C);
  }
  const takeup = FLUTE_TAKEUP[flute] || 1.36;
  return outerWt + innerWt + (medWt * takeup);
}

export function autoSelectSkid(pieceW, pieceL) {
  const sizes = ["S", "L", "WF"];
  for (let i = 0; i < sizes.length; i++) {
    const sk = SKID_SIZES[sizes[i]];
    const usableW = sk.w - SKID_SIDE_GUIDE;
    const usableL = sk.l - SKID_GRIPPER;
    if ((pieceW <= usableW && pieceL <= usableL) || (pieceL <= usableW && pieceW <= usableL)) {
      return sizes[i];
    }
  }
  return "WF";
}

export function calcPiecesPerSkidLayer(pieceW, pieceL, skidKey) {
  const sk = SKID_SIZES[skidKey];
  if (!sk) return 1;
  const usableW = sk.w - SKID_SIDE_GUIDE;
  const usableL = sk.l - SKID_GRIPPER;
  const countA = Math.floor(usableW / pieceW) * Math.floor(usableL / pieceL);
  const countB = Math.floor(usableW / pieceL) * Math.floor(usableL / pieceW);
  return Math.max(countA, countB, 1);
}

// Per-component shipment. Matches legacy calcShipment(...) verbatim.
export function calcShipment(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade,
                              totalMSF, pieceW, pieceL, qty, skidOverride) {
  const boardLbsMSF = calcBoardWeight(boardGrade, flute, outsideLiner, insideLiner, mediumUpgrade);
  const productWeight = boardLbsMSF * totalMSF * 1.05;  // 5% ink adder
  const skidKey = skidOverride || autoSelectSkid(pieceW, pieceL);
  const pcsPerLayer = calcPiecesPerSkidLayer(pieceW, pieceL, skidKey);
  const fluteCal = FLUTE_CALIPERS[flute] || 0.125;
  const layers = qty > 0 ? Math.ceil(qty / pcsPerLayer) : 0;
  const stackHeight = layers * fluteCal;
  const skidCount = stackHeight > 0 ? Math.ceil(stackHeight / SKID_MAX_PRODUCT_HEIGHT) : 1;
  const skidTotalWeight = (SKID_SIZES[skidKey] || { weight: 75 }).weight * skidCount;
  const totalWeight = productWeight + skidTotalWeight;
  const ftTable = TRAILER_FEET[skidKey] || TRAILER_FEET.S;
  const trailerFeet = skidCount <= ftTable.length ? ftTable[skidCount - 1]
    : (ftTable[ftTable.length - 1] || 52);
  return {
    boardLbsMSF,
    productWeight: Math.round(productWeight),
    skidKey,
    skidLabel: (SKID_SIZES[skidKey] || {}).label || skidKey,
    pcsPerLayer,
    layers,
    stackHeight: Math.round(stackHeight * 10) / 10,
    skidCount,
    skidTotalWeight,
    totalWeight: Math.round(totalWeight),
    trailerFeet,
  };
}
