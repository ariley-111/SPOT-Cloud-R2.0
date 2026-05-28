#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// fleet_compare.js — 785-job iQuote-vs-SPOT regression harness
// ═══════════════════════════════════════════════════════════════════════════
// Reads WF_Quoting_Tool_Test_Data.xlsx (785 iQuote jobs), maps each row to a
// SPOT estimate JSON, runs it through spot_runner.js / spot_engine.js, and
// writes a results CSV comparing SPOT's totalMfg vs iQuote's TotalActualCost.
//
// This is the tool that unblocks EST-RECALIB-02 (Satin re-baseline) and
// EST-RECALIB-03 (post-D-106 rename re-baseline). Both were blocked on
// DEV-010 (no in-project iquote_compare.js). This replaces that need.
//
// Usage:
//   npm install xlsx               # one-time, installs the xlsx reader
//   node fleet_compare.js          # reads ./WF_Quoting_Tool_Test_Data.xlsx
//   node fleet_compare.js <xlsx>   # or pass an explicit xlsx path
//
// Outputs:
//   fleet_results.csv              — per-job SPOT vs iQuote
//   fleet_summary.json             — fleet-level stats + outlier list
//   fleet_unparseable.csv          — rows dropped for bad board spec etc.
//
// The script is deliberately self-contained. No SPC secrets, no auth, no
// network. Safe to share with Cowork or run locally.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ─── XLSX reader — lightweight, widely available on npm ────────────────────
let XLSX;
try { XLSX = require('xlsx'); }
catch (e) {
  console.error('ERROR: missing "xlsx" package. Install it first:');
  console.error('       npm install xlsx');
  process.exit(1);
}

// ─── SPOT engine/runner — assumed adjacent to this script ──────────────────
let R, E;
try {
  R = require('./spot_runner.js');
  E = require('./spot_engine.js');
} catch (err) {
  console.error('ERROR: spot_runner.js / spot_engine.js must sit next to this file.');
  console.error('       Place all three (engine, runner, this script) + the xlsx in one folder.');
  console.error('       Details:', err.message);
  process.exit(1);
}

// ─── D-106 label migration (matches UI behavior in applyState) ─────────────
// iQuote's dataset was written pre-D-106 using SPOT's old labels. Pre-migrate
// here so the runner sees new labels and the math lands in the right tier.
const CAD_MIG   = E.CAD_DIFF_MIGRATION   || { Simple:"Simple", Standard:"Straight", Complex:"Standard", Extreme:"Complex" };
const STRIP_MIG = E.STRIP_DIFF_MIGRATION || { Simple:"Simple", Standard:"Straight", Complex:"Standard", Extreme:"Complex" };

// iQuote's ComplexityOfCut column uses the new (post-rename) labels directly
// for Simple/Straight/Standard/Complex, so NO migration needed when the column
// value is already one of those. Migration only fires for "Extreme" legacy rows
// and for downstream JSON fields.
function migrateTier(v, map) {
  if (!v) return v;
  if (map[v] && map[v] !== v) return map[v];
  return v;
}

// ─── Board spec parser — pulls grade, flute, liners out of BoardSpecsFull ──
// Examples:
//   "200# SW B Flute Kemi/Kraft 60 corr x 120"
//   "44ect SW C Flute KLA/Kraft 63 corr x 98"
//   "200# SW E Flute Kemi/KLA 48 corr x 96 - FSC Mix Credit"
//   "48 Pt Tango C2S 48 x 96"  (non-corrugated; skip)
function parseBoard(spec, fluteCol) {
  const out = { ok: false, reason: null };
  if (!spec) { out.reason = 'empty spec'; return out; }

  // Grade: "200#" or "250#" or "44ect" (ECT 44) or "ECT 44" or "32ect"
  let grade = null;
  const pctM = spec.match(/(\d+)#/);
  const ectM = spec.match(/(\d+)\s*ect/i) || spec.match(/ECT\s*(\d+)/i);
  if (pctM) grade = pctM[1];
  else if (ectM) grade = 'ECT ' + ectM[1];
  if (!grade) { out.reason = 'no grade (# or ect) found in "' + spec + '"'; return out; }

  // Flute from dedicated column — more reliable than parsing the spec
  // "SW B Flute" / "SW C Flute" / "SW E Flute" / "DW..."
  let flute = null;
  const fM = (fluteCol || '').match(/\b([BCE])\s*Flute/i);
  if (fM) flute = fM[1].toUpperCase();
  if (!flute) {
    const fM2 = spec.match(/\b([BCE])\s*Flute/i);
    if (fM2) flute = fM2[1].toUpperCase();
  }
  if (!flute) { out.reason = 'no flute in "' + (fluteCol||spec) + '"'; return out; }

  // Liners: "Kemi/Kraft", "KLA/Kraft", "Kemi/KLA", "Kemi/Kemi"
  // Note: SPOT's SHEET_GROUPS encodes "Kraft" as liner code "None" — see engine.
  const linerM = spec.match(/(Kemi|KLA|Kraft|Bleached|White)\s*\/\s*(Kemi|KLA|Kraft|Bleached|White)/i);
  const linerMap = {
    Kemi:     '42# Kemi-Lite',
    KLA:      '42# Kla-White',
    Kraft:    'None',                 // SPOT encodes kraft as None in sheet library
    Bleached: '42# Bleached White',
    White:    '42# Kla-White',        // conservative
  };
  let outsideLiner = '42# Kemi-Lite'; // default per SPOT
  let insideLiner  = 'None';          // kraft-inside default
  if (linerM) {
    outsideLiner = linerMap[linerM[1]] || outsideLiner;
    insideLiner  = linerMap[linerM[2]] || insideLiner;
  }

  out.ok = true;
  out.boardGrade   = grade;
  out.flute        = flute;
  out.outsideLiner = outsideLiner;
  out.insideLiner  = insideLiner;
  out.fscEnabled   = /FSC/i.test(spec);
  return out;
}

// ─── Build SPOT JSON from iQuote row ───────────────────────────────────────
function buildSpotJson(row) {
  const qty = parseInt(row.Quantity, 10);
  const W   = parseFloat(row.FinishedWidth);
  const L   = parseFloat(row.FinishedLength);
  if (!qty || !W || !L) return { ok: false, reason: 'missing qty/dims' };

  const parsed = parseBoard(row.BoardSpecsFull, row.Flute);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  // Tier: if iQuote value is one of the new post-D-106 labels, pass through.
  // If it's blank or garbage, default to Standard.
  let cadDifficulty = (row.ComplexityOfCut || '').trim() || 'Standard';
  if (!['Simple','Straight','Standard','Complex'].includes(cadDifficulty)) {
    cadDifficulty = migrateTier(cadDifficulty, CAD_MIG) || 'Standard';
  }

  // Colors → print config
  const cf = parseInt(row.ColorsFront, 10) || 0;
  const cb = parseInt(row.ColorsBack,  10) || 0;
  const printReq   = (cf + cb) > 0 ? 'Yes' : 'No';
  const printSides = cb > 0 ? '2-Sided' : '1-Sided';

  // D-110 FINAL: Rule-inches mode when iQuote provides CuttingInchesPerSheet (679 of 785 jobs)
  // Fall back to difficulty mode for the remainder.
  const cips = parseFloat(row.CuttingInchesPerSheet) || 0;
  const nUp  = parseInt(row.NumberUp, 10) || 1;
  const rulePerPc = cips > 0 ? cips / nUp : 0;
  const useRuleInches = rulePerPc > 0;

  // D-110 FINAL: Per-job hand glue enablement (was uniform 'No' — missed $92K of iQuote glue cost)
  const iqHandGlue = parseFloat(row.ActualHandglueCost) || 0;
  const handGluing = iqHandGlue > 0 ? 'Yes' : 'No';

  return {
    ok: true,
    json: {
      schemaVersion: E.SPOT_SCHEMA_VERSION || 2,
      oneUpW: String(W),
      oneUpL: String(L),
      qtys: [String(qty)],
      flute: parsed.flute,
      boardGrade: parsed.boardGrade,
      outsideLiner: parsed.outsideLiner,
      insideLiner: parsed.insideLiner,
      medium: 'None',
      fscEnabled: parsed.fscEnabled,
      fscFee: parsed.fscEnabled ? '25' : '0',
      under5MsfFee: '0',
      cadPricingMethod: useRuleInches ? 'By Inches of Rule' : 'By Difficulty',
      totalRuleInches: useRuleInches ? String(rulePerPc) : '0',
      cadDifficulty,
      printReq,
      printMode: 'Satin',   // D-110: Gloss/Satin equalized at 75 sh/hr — mode is cosmetic
      printSides,
      whiteInk: 'No',
      handStripping: 'No',
      handGluing,           // D-110 FINAL: per-job enablement based on iQuote ActualHandglueCost
      tape: 'No',
      quoteFOB: 'Origin',
    },
  };
}

// ─── Stats helpers ─────────────────────────────────────────────────────────
function median(vs)   { const s = vs.slice().sort((a,b)=>a-b); return s.length ? s[Math.floor(s.length/2)] : 0; }
function mean(vs)     { return vs.length ? vs.reduce((a,b)=>a+b,0)/vs.length : 0; }
function quantile(vs,q) { const s = vs.slice().sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(s.length*q))]; }

// ─── Main ──────────────────────────────────────────────────────────────────
const xlsxPath = process.argv[2] || './WF_Quoting_Tool_Test_Data.xlsx';
if (!fs.existsSync(xlsxPath)) {
  console.error('ERROR: xlsx not found at', xlsxPath);
  console.error('Pass a path as the first argument, or place the file next to this script.');
  process.exit(1);
}

console.log('Reading', xlsxPath, '...');
const wb = XLSX.readFile(xlsxPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
console.log('  rows:', rows.length);

const results = [];
const unparseable = [];
let okCount = 0, errCount = 0;

// ─── Die adjustment (2026-04-23): iQuote bundles die cost into ActualCuttingCost.
// SPOT separates die as a customer-facing line item. For Crest-routed jobs, add a
// flat $1,000 die estimate to SPOT's comparable total so the comparison is
// apples-to-apples. CAD jobs don't carry die in iQuote's cutting column. ───
const CREST_DIE_ADJUSTMENT = 1200;  // D-110 FINAL: $1,000 → $1,200 to fully account for iQuote die bundling

for (const row of rows) {
  const built = buildSpotJson(row);
  if (!built.ok) {
    unparseable.push({ JobNumber: row.JobNumber, reason: built.reason, spec: row.BoardSpecsFull });
    errCount++;
    continue;
  }
  const r = R.runEstimate(built.json, 0);
  if (r.error) {
    unparseable.push({ JobNumber: row.JobNumber, reason: 'runner: ' + r.error, spec: row.BoardSpecsFull });
    errCount++;
    continue;
  }

  // iQuote's TotalActualCost = Material + Ink + PressSetup + PressRun + Cutting + Handglue.
  // It excludes freight, die, prepress, overhead, misc. To compare apples to apples,
  // we narrow SPOT's cost to the matching component set ("prodOnly" below). totalMfg
  // (the full SPOT cost) is also emitted so Cowork can see both lenses.
  const dieAdj = (r.route === 'Crest') ? CREST_DIE_ADJUSTMENT : 0;
  const spotProd   = (r.matTotal||0) + (r.matMakeready||0) + (r.printDirect||0)
                   + (r.cutterDirect||0) - (r.dieEmbedded||0)    // back out die embedded in cutterDirect
                   + (r.stripCost||0) + (r.assemblyCost||0)
                   + (r.saberCost||0)
                   + dieAdj;                                      // Crest die parity with iQuote
  const spotFull   = r.totalMfg || 0;
  const iqTotal    = parseFloat(row.TotalActualCost) || 0;
  const iqMaterial = parseFloat(row.ActualMaterialCost) || 0;
  const iqInk      = parseFloat(row.ActualInkCost) || 0;
  const iqPress    = (parseFloat(row.ActualPressSetupCost) || 0) + (parseFloat(row.ActualPressRunCost) || 0);
  const iqCut      = parseFloat(row.ActualCuttingCost) || 0;
  const iqGlue     = parseFloat(row.ActualHandglueCost) || 0;

  const deltaProd    = spotProd - iqTotal;
  const deltaProdPct = iqTotal > 0 ? (deltaProd / iqTotal) * 100 : 0;
  const deltaFull    = spotFull - iqTotal;
  const deltaFullPct = iqTotal > 0 ? (deltaFull / iqTotal) * 100 : 0;

  results.push({
    JobNumber: row.JobNumber,
    Customer: row.CustomerName,
    Qty: row.Quantity,
    Flute: built.json.flute,
    Grade: built.json.boardGrade,
    Tier: built.json.cadDifficulty,
    Route: r.route,
    iQuoteTotal: iqTotal.toFixed(2),
    iQuoteMaterial: iqMaterial.toFixed(2),
    iQuoteInk: iqInk.toFixed(2),
    iQuotePress: iqPress.toFixed(2),
    iQuoteCutting: iqCut.toFixed(2),
    iQuoteGlue: iqGlue.toFixed(2),
    SpotMaterial: ((r.matTotal||0) + (r.matMakeready||0)).toFixed(2),  // D-111: include matMakeready in material attribution (was hidden in totals)
    SpotInk: (r.inkCost||0).toFixed(2),
    SpotPress: ((r.pressCost||0)+(r.whiteCost||0)+(r.side2Cost||0)).toFixed(2),
    SpotCutting: Math.max(0, (r.cutterDirect||0) - (r.dieEmbedded||0)).toFixed(2),
    SpotGlue: (r.assemblyCost||0).toFixed(2),
    DieAdj: dieAdj.toFixed(2),
    SpotProdOnly: spotProd.toFixed(2),
    SpotFullMfg: spotFull.toFixed(2),
    DeltaProd: deltaProd.toFixed(2),
    DeltaProdPct: deltaProdPct.toFixed(2),
    DeltaFullPct: deltaFullPct.toFixed(2),
  });
  okCount++;
}

// ─── CSV writers ───────────────────────────────────────────────────────────
function toCsv(rows, cols) {
  const esc = v => { const s = String(v == null ? '' : v); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
  return header + '\n' + body + '\n';
}

fs.writeFileSync('fleet_results.csv',
  toCsv(results, ['JobNumber','Customer','Qty','Flute','Grade','Tier','Route',
    'iQuoteTotal','iQuoteMaterial','iQuoteInk','iQuotePress','iQuoteCutting','iQuoteGlue',
    'SpotMaterial','SpotInk','SpotPress','SpotCutting','SpotGlue','DieAdj','SpotProdOnly','SpotFullMfg',
    'DeltaProd','DeltaProdPct','DeltaFullPct']));
fs.writeFileSync('fleet_unparseable.csv',
  toCsv(unparseable, ['JobNumber','reason','spec']));

// ─── Fleet-level stats — narrow production comparison (apples to apples) ──
const deltas = results.map(r => parseFloat(r.DeltaProd));
const deltaPcts = results.map(r => parseFloat(r.DeltaProdPct));
const spotTotals = results.map(r => parseFloat(r.SpotProdOnly));
const iqTotals   = results.map(r => parseFloat(r.iQuoteTotal));

// R² (narrow SPOT production vs iQuote actual)
const my = mean(iqTotals);
const ssTot = iqTotals.reduce((s, y) => s + (y - my) ** 2, 0);
const ssRes = iqTotals.reduce((s, y, i) => s + (y - spotTotals[i]) ** 2, 0);
const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

// Tier census
const byTier = {};
for (const r of results) {
  byTier[r.Tier] = byTier[r.Tier] || { n: 0, sumDelta: 0, sumDeltaPct: 0, medianPct: 0, dps: [] };
  byTier[r.Tier].n++;
  byTier[r.Tier].sumDelta += parseFloat(r.DeltaProd);
  byTier[r.Tier].sumDeltaPct += parseFloat(r.DeltaProdPct);
  byTier[r.Tier].dps.push(parseFloat(r.DeltaProdPct));
}
for (const t in byTier) {
  byTier[t].medianPct = median(byTier[t].dps);
  byTier[t].meanPct   = byTier[t].sumDeltaPct / byTier[t].n;
  delete byTier[t].dps;
}

const summary = {
  generatedAt: new Date().toISOString(),
  runner: { schema: E.SPOT_SCHEMA_VERSION, cadSetup: E.CAD_SETUP, cadFallback: E.CAD_FALLBACK, crestDieAdjustment: CREST_DIE_ADJUSTMENT },
  counts: { totalRows: rows.length, scored: okCount, unparseable: errCount },
  fleet: {
    medianDelta: median(deltas).toFixed(2),
    meanDelta: mean(deltas).toFixed(2),
    medianDeltaPct: median(deltaPcts).toFixed(2),
    meanDeltaPct: mean(deltaPcts).toFixed(2),
    p5DeltaPct: quantile(deltaPcts, 0.05).toFixed(2),
    p95DeltaPct: quantile(deltaPcts, 0.95).toFixed(2),
    r2: r2.toFixed(4),
    sumSpot: spotTotals.reduce((a,b)=>a+b,0).toFixed(2),
    sumIquote: iqTotals.reduce((a,b)=>a+b,0).toFixed(2),
    fleetTotalPct: (((spotTotals.reduce((a,b)=>a+b,0) - iqTotals.reduce((a,b)=>a+b,0)) / iqTotals.reduce((a,b)=>a+b,0)) * 100).toFixed(2),
  },
  byTier,
};

fs.writeFileSync('fleet_summary.json', JSON.stringify(summary, null, 2));

// ─── Console report ───────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Fleet comparison summary');
console.log('═══════════════════════════════════════════════════════════════');
console.log('Scored:', okCount, '/ Unparseable:', errCount);
console.log('Fleet total SPOT    : $' + summary.fleet.sumSpot);
console.log('Fleet total iQuote  : $' + summary.fleet.sumIquote);
console.log('Fleet total Δ %     :', summary.fleet.fleetTotalPct + '%');
console.log('Median per-job Δ %  :', summary.fleet.medianDeltaPct + '%');
console.log('Mean per-job Δ %    :', summary.fleet.meanDeltaPct + '%');
console.log('R² (SPOT vs iQuote) :', summary.fleet.r2);
console.log('p5 Δ%, p95 Δ%       :', summary.fleet.p5DeltaPct + '%', '/', summary.fleet.p95DeltaPct + '%');
console.log('\nPer-tier (n, median Δ%, mean Δ%):');
for (const t of ['Simple','Straight','Standard','Complex']) {
  if (!byTier[t]) continue;
  console.log('  ' + t.padEnd(10), 'n='+byTier[t].n, 'med='+byTier[t].medianPct.toFixed(2)+'%', 'mean='+byTier[t].meanPct.toFixed(2)+'%');
}
console.log('\nOutputs:');
console.log('  fleet_results.csv       (per-job)');
console.log('  fleet_summary.json      (fleet stats)');
console.log('  fleet_unparseable.csv   (dropped rows)');
console.log('═══════════════════════════════════════════════════════════════\n');
