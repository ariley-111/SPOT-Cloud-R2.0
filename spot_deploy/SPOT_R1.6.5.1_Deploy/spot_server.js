// SPOT R1.6.5 Freight Server with UTS API Integration + Customer Auto-Populate + Drop-Zone Archive
// Serves SPOT HTML + proxies UTS freight + serves customer DB + per-quote file archive
// 2026-05-03 — R1.6.5: D-145 parser quality fixes (server prompt rewrite). Five concrete fixes
//              targeting two-fixture evidence base (Skybox PO 47309 + L'Oreal C4-26):
//              (A) pricingMode default tightened — Matched Set unless RFQ literally says
//                  "individual"; multiple ship-tos / varying qtys do NOT make it Individual.
//              (B) Rule 7 split into 7a printMode (extractable: digital/litho/flexo/Gloss/Satin)
//                  and 7b print finish (Gloss vs Satin specifically — that's the never-default).
//                  Stops printMode null when RFQ says "digital" explicitly.
//              (C) New CAD CALLOUT GRAMMAR block — teaches the 200#K/K vs 200#K/MW vs 32 ECT E
//                  KEMI/MW notation per-component, with worked examples from real SPC CADs.
//                  Stops Body/Base liner homogenization when individual CADs disagree.
//              (D) New EMAIL SIGNATURE EXTRACTION block — instructs destZip extraction from
//                  signature blocks (e.g., "PCA Cheswick / 499 Nixon Road / Cheswick, PA 15024").
//              (E) New PER-COMPONENT RFQ-BODY INSTRUCTIONS block — scans email body for
//                  "remove X from Y" / "add X to Y" / "use new file for Z" patterns and reflects
//                  them in bomItems[N].state.itemDesc. Catches spec changes like the L'Oreal
//                  Riser/Body QR-code swap that R1.6.4.2 missed entirely.
//              Server-only ship; JSX stays at R1.6.4.1. Server restart required (system prompt
//              rebuilt on boot). Validation: re-parse L'Oreal C4-26 fixture, expect Body and
//              Display Base insideLiner = "Kraft" (was MW), pricingMode = "Matched Set" (was
//              Individual), destZip = "15024" (was null), printMode = "Digital" (was null),
//              QR-code spec change captured in bomItems[Riser/Body].state.itemDesc + asks.
//              See DEV_D145_Design_Decision.md.
// 2026-05-03 — R1.6.4.2: D-144 hotfix. Recalibrate D-141 preflight bytes:tokens ratio for PDFs/images
//              from 1:1 to 1:250 (anthropicParseRfqBatch loop). Real Anthropic consumption for
//              image-heavy PDFs is ~200-700 bytes per token; the original 1:1 ratio over-estimated
//              by ~250x and rejected normal-sized RFQs with false 413 PREFLIGHT_OVER_LIMIT (TC-D141.2
//              FAIL on D-143 closure-gate run 2026-05-03). Closure gate: TC-D141.2 PASS on canonical
//              L'Oreal 34-PDF fixture + a representative single-piece RFQ. See DEV_D144_Design_Decision.md.
// 2026-05-02 — R1.6.4: D-140 + D-141 hotfix.
//              D-140: /archive/upload now rejects sha256-duplicate files. Existing meta.files[]
//              entries supply the dedup set; in-batch dups also caught. Reason carried in the
//              existing rejected[] response shape with the matched-file name.
//              D-141: anthropicParseRfqBatch performs a per-call input-token pre-flight before
//              the API request. Refuses with status 413 + code PREFLIGHT_OVER_LIMIT if estimated
//              input > 80% of 450k/min TPM cap. Conservative byte-based heuristic (PDFs/images
//              1:1 bytes:tokens, text bytes/4, system prompt chars/4). Plus /est/parser-budget
//              respects ?clientKeyPresent=1 query param so the JSX badge stops lying that the
//              parser is unconfigured when a working browser key is in play.
// 2026-05-01 — R1.6.3: D-136 knowledge-aware extraction + UX rename. Server-side knowledge injection now
//              comprehensive: prompts/ folder still primary (override), embedded fallback constants
//              (EMBEDDED_KNOWLEDGE) supply canonical terms, quoting rules, board library, route
//              eligibility, control table defaults, harness M1-M5 derivation when prompts/ is empty.
//              Customer cust_code list injected dynamically into system prompt at parse time from
//              already-loaded customerCache (no separate file load). Extraction prompt extended:
//              source-tag emission per field (RFQ/CAD/DEFAULT/CALC/ASK/REGISTRY), method tag M1-M5,
//              per-component confidence for Multi-Part, cust_code emission when matched. New endpoint
//              POST /est/validate-parsed wraps spot_runner.runEstimate as Layer-2 computational
//              backstop — returns {cost_summary, route_eligibility, violations[], guardrails}.
//              UI rename "Parse RFQ" → "Build Estimate" cascade (15 sites in spot_r1_5.jsx).
//              D-137 fold-in: em-dash JSX-text-content escape bug at jsx L8849. Closure gate TC-D136
//              sub-cases (1)-(5). See DEV_D136_Design_Decision.md.
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PORT = 3100;

// ═══ UTS API Configuration ═══
const UTS_BASE = "https://api.myuts.net/v1";
const UTS_USER = "estimates@standardprinting.com";
const UTS_KEY  = "Quotes330-453-8247";
const UTS_AUTH = "Basic " + Buffer.from(UTS_USER + ":" + UTS_KEY).toString("base64");
const ORIGIN_ZIP = "44704";
let UTS_BILL_TO_ID = 496663;

// ═══ Fallback rates ═══
const FALLBACK_ZONES = [
  { zone: 1, label: "OH local", cwt: 35, min: 175 },
  { zone: 2, label: "OH/PA/WV", cwt: 42, min: 175 },
  { zone: 3, label: "Mid-Atlantic", cwt: 48, min: 200 },
  { zone: 4, label: "SE/NE", cwt: 55, min: 225 },
  { zone: 5, label: "Deep South", cwt: 62, min: 250 },
  { zone: 6, label: "South/Plains", cwt: 72, min: 300 },
  { zone: 7, label: "Mountain", cwt: 85, min: 350 },
  { zone: 8, label: "West Coast", cwt: 98, min: 400 },
];

// ═══ D-119: SPCOC Local Zone Routing ═══
const SPCOC_ZONES = {
  "447": 1,
  "443": 2, "444": 2, "446": 2, "448": 2,
  "440": 3, "441": 3, "442": 3, "445": 3, "449": 3,
};
const SPCOC_RATES = { 1: 45, 2: 70, 3: 95 };
const SPCOC_LABELS = { 1: "Zone 1 — Canton metro", 2: "Zone 2 — Akron/Alliance", 3: "Zone 3 — Cleveland/Youngstown/Mansfield" };
const SPCOC_MAX_WEIGHT = 10000;
const SPCOC_MAX_TRAILER_FT = 24;

// D-120 Phase 1 — Drop-Zone Archive
// Per-quote file vault. Local staging only; Phase 2 will sync to SharePoint
// at https://standardprinting.sharepoint.com/sites/SPOT/SPOT QUOTES/
// Default archive root: <install_folder>/SPOT_QUOTES/ (works on Windows + Linux + Mac).
// Override via SPOT_ARCHIVE_ROOT env var.
const ARCHIVE_ROOT = process.env.SPOT_ARCHIVE_ROOT || path.join(__dirname, "SPOT_QUOTES");
const EXEC_DENYLIST = new Set([".exe", ".bat", ".cmd", ".msi", ".com", ".scr", ".ps1"]);
const RFQ_CLASS_EXTS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".eml", ".msg", ".docx", ".xlsx", ".xls"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;   // 50 MB per file
const MAX_FILES_PER_DROP = 20;
// D-126 hotfix (R1.5.7.3): regex matches generateEstNum() output exactly:
// `${initials}-${YYMMDD}-${HHMMSS}` with optional `-N` suffix from uniqueEstNum() collision dedupe.
// Initials may contain letters, digits, and underscores (e.g. "POP_TST" for personalized initials).
// Bug R1.5.7: regex was /^[A-Z]{2,4}-\d{6}-\d{3}(-\d+)?$/ which rejected POP_TST and the 6-digit time segment.
const EST_NUM_RX = /^[A-Za-z0-9_]{1,16}-\d{6}-\d{6}(-\d+)?$/;

// ═══ D-129 Phase 1B — Anthropic API RFQ Parser ═══
// Reads dropped RFQ-class files (PDF/image/email/docx) and extracts SPOT intake fields.
// API key resolution order:
//   1. process.env.ANTHROPIC_API_KEY
//   2. <install>/.env file with ANTHROPIC_API_KEY=sk-ant-...
//   3. <install>/anthropic_key.txt (single-line file with just the key)
// Until a key is found, the /est/parse-rfq endpoint returns 503 and parsing is skipped silently.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
const ANTHROPIC_MONTHLY_CAP_USD = parseFloat(process.env.ANTHROPIC_MONTHLY_CAP_USD || "500");
// Pricing per million tokens (Opus 4.7 / 4.6 are same tier; Sonnet 4.6 is 5x cheaper).
// We use these for cost estimation only; actual billing is on Anthropic's side.
const PRICING_USD_PER_MTOK = {
  "claude-opus-4-7":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-opus-4-6":   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cacheRead: 0.30, cacheWrite:  3.75 },
};
function loadAnthropicKey() {
  // 1. Env var
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return { key: process.env.ANTHROPIC_API_KEY.trim(), source: "ANTHROPIC_API_KEY env var" };
  }
  // 2. .env file (simple parser — KEY=VALUE lines, # comments)
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const k = trimmed.substring(0, eq).trim();
        let v = trimmed.substring(eq + 1).trim();
        // Strip surrounding quotes if present
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.substring(1, v.length - 1);
        }
        if (k === "ANTHROPIC_API_KEY" && v) {
          return { key: v, source: ".env file" };
        }
      }
    } catch (e) { /* fall through */ }
  }
  // 3. anthropic_key.txt
  const txtPath = path.join(__dirname, "anthropic_key.txt");
  if (fs.existsSync(txtPath)) {
    try {
      const content = fs.readFileSync(txtPath, "utf8").trim();
      if (content && content.startsWith("sk-ant-")) {
        return { key: content, source: "anthropic_key.txt" };
      }
    } catch (e) { /* fall through */ }
  }
  return { key: null, source: null };
}
let anthropicKeyState = loadAnthropicKey();
// Reload key on demand (e.g., after user creates .env post-install)
function reloadAnthropicKey() {
  anthropicKeyState = loadAnthropicKey();
  return anthropicKeyState;
}

// Bundled system prompt — the EST_*.md files that teach Claude the SPOT schema.
// Loaded once at startup; cached on the Anthropic side via cache_control to keep costs down.
function loadSystemPromptDocs() {
  const promptsDir = path.join(__dirname, "prompts");
  if (!fs.existsSync(promptsDir)) return "";
  try {
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith(".md")).sort();
    const parts = [];
    for (const f of files) {
      const body = fs.readFileSync(path.join(promptsDir, f), "utf8");
      parts.push("## File: " + f + "\n\n" + body);
    }
    return parts.join("\n\n---\n\n");
  } catch (e) {
    console.log("  D-129: prompt docs load failed: " + e.message);
    return "";
  }
}
const SYSTEM_PROMPT_DOCS = loadSystemPromptDocs();

// ═══════════════════════════════════════════════════════════════════════════════
// D-136 (R1.6.3): Embedded knowledge fallback. The prompts/ folder above is the
// preferred source (markdown is the single source of truth). When prompts/ is
// empty/missing — common in fresh installs and partial Cowork applies — these
// embedded constants supply the minimum knowledge the parser needs to be
// SPOT-accurate. Per Michael 2026-05-01: "Partial knowledge injection is
// unacceptable." — knowledge MUST be injected regardless of install state.
// ═══════════════════════════════════════════════════════════════════════════════

const EMBEDDED_CANONICAL_TERMS = [
  "## SPC Canonical Terms (embedded fallback)",
  "",
  "These are SPC-specific token meanings that DIVERGE from packaging-industry standard usage.",
  "Training-data inference on these tokens is UNSAFE. If the customer uses one of these terms,",
  "translate ONLY per this registry. If a token is not here and the meaning is uncertain, set",
  "the field to null and add to asks.",
  "",
  "- **CKB** = Corrugated Kraft Board = SPC's `42# Kemi-Lite` outside liner. NOT industry's Clay-Coated Bleached Kraft folding-carton grade.",
  "- **MW / Mottled White** = SPC's `42# Kla-White` liner. NOT industry's Bleached White.",
  "- **Kemi / Kemi-Lite / clay coat** = SPC's `42# Kemi-Lite` (default clay-coated kraft liner).",
  "- **White outside (generic)** = `42# Kla-White` UNLESS customer says \"bleached\" or \"bright white\" (then `42# Bleached White`).",
  "- **Kraft / brown / K** = canonical value `\"None\"` (NOT the literal string \"Kraft\"). Engine maps None\u2194Kraft on display, but the JSON value MUST be \"None\". Applies to outsideLiner, insideLiner, AND medium fields. Emitting the literal string \"Kraft\" is a SHIP-BLOCKING bug \u2014 the engine cannot match it against the stock sheet library and falls back to expensive custom-order pricing.",
  "- **ECT 44** = uncommon at SPC. Substitutes DOWN to Mullen 200# stock (grade fallback). Mill check is manual; do NOT note substitution on customer-facing fields.",
  "- **Crest** = SPC's flat-bed die cutter (route name in SPOT). Specific machine, not generic.",
  "- **CAD** = SPC's rotary die cutter (route name in SPOT). Specific machine, not the design software.",
  "- **Bobst** = SPC's high-speed die cutter (route name in SPOT). E/F flute only, sheet 13.78×15.75 to 41.75×29.125 envelope.",
  "- **Inca** = SPC's digital press. 75 sh/hr Gloss and Satin (equalized D-110 FINAL).",
  "- **Buy Min** = mill minimum order quantity. Stock sheets BYPASS Buy Min (D-067). Custom/forced boards trigger it.",
  "- **Paper uplift** = +10% baked into engine board prices (D-102). Not a user field. Already in all board pricing.",
  "- **FSC/SFI** = $25 amortized into board (D-086). Flag on/off; do NOT emit dollar amount.",
  "- **Gloss / Satin** = print finishes. SPC defaults to **Satin** (D-105/D-114). NEVER default to Gloss.",
  "- **Graphic White** = OPEN registry item (EST-GRPHCWHT). Do NOT resolve from priors. Set null + ask.",
].join("\n");

const EMBEDDED_QUOTING_RULES = [
  "## SPOT Hard Rules (embedded fallback — see EST_SPOT_Quoting_Rules.md)",
  "",
  "1. NEVER set `routeOverride` in extracted JSON. Auto-route only (D-124 cost-winner).",
  "2. `estInitials` is ALWAYS `\"SPC\"` for AI estimates. Field is locked.",
  "3. ALWAYS set `under5MsfFee: \"0\"` — corrugator charge does not apply to WF.",
  "4. ECT grades run on Mullen sheets (grade fallback). Do NOT note substitution on customer-facing values.",
  "5. Stock sheets bypass Buy Min (D-067). Custom/forced boards trigger mill minimums.",
  "6. Rate migration fires on load — do NOT emit rate fields (incaRate, cadRate, crestRate, bobstRate, etc.).",
  "7. `applyState` and `applyItemState` are reset-first (D-080/D-087/D-098).",
  "8. Default print finish is **Satin**. NEVER default to Gloss. If RFQ says nothing, set null + ask.",
  "9. FOB: `\"Origin\"` (ZIP 44704) unless customer explicitly requests Destination.",
  "10. PDF quotes come from SPOT Preview Quote ONLY. No external PDF generation in scope.",
].join("\n");

const EMBEDDED_BOARD_LIBRARY = [
  "## SPOT Board Library + Route Eligibility (embedded — must match spot_engine.js)",
  "",
  "**Singlewall flutes:** B, C, E",
  "**Doublewall flutes:** BC, EB",
  "**Singlewall grades:** 200, ECT 32, ECT 44, ECT 48, ECT 55, ECT 61, ECT 71, ECT 82",
  "**Doublewall grades:** ECT 42, ECT 48, ECT 51, ECT 61, ECT 71, ECT 82",
  "",
  "**Outside liner options (canonical engine values):** None (=kraft), 42# Kla-White, 42# Kemi-Lite, 42# Bleached White, 33# Kla-White, 56# Kla-White. NEVER emit the string \"Kraft\" \u2014 always emit \"None\" for kraft callouts (CAD says K, K/K, brown, kraft, plain \u2192 emit None).",
  "**Inside liner options:** same as outside, with None being the most common (= unbleached kraft, what most CADs spec as \"K\" or \"K/K\").",
  "**Medium options:** None, 26#, 33#, 35HPL#, 40#, 42# Bl",
  "",
  "**Liner upgrade rules (engine `liner_upgrades`):**",
  "- 33# Kla-White: allowed on 175 / ECT 32 only",
  "- 56# Kla-White: allowed on 250 only",
  "- 42# Bleached White: +$17.50/MSF",
  "",
  "**Route eligibility (D-121 / D-124):**",
  "- **CAD** (rotary die): all flutes, all sheet sizes within library. ALWAYS eligible.",
  "- **Crest** (flat-bed die): all flutes, sheet ≤ 60×120. Requires steel die.",
  "- **Bobst** (high-speed die): E or F flute ONLY. Sheet 13.78×15.75 to 41.75×29.125 envelope. 0.060″ caliper limit.",
  "",
  "**Auto-route preference (D-124, R1.6.1):** cost-winner — lowest viable route wins by default.",
  "",
  "**Rule: If proposed flute is B or C, do NOT emit Bobst as a route hint.** Bobst is hard-blocked on B/C flute.",
].join("\n");

const EMBEDDED_CONTROL_DEFAULTS = [
  "## SPOT Control Defaults (embedded — current rates/calibration, DO NOT EMIT THESE FIELDS)",
  "",
  "**Calibrated rates (D-110 FINAL, locked R1.5.3, preserved through R1.6.3):**",
  "- Inca press: $485/hr, 75 sh/hr (Gloss/Satin equalized)",
  "- CAD: $138/hr, 650 in/min, setup Simple 8 / Straight 20 / Standard 25 / Complex 22 min",
  "- Crest: $45/hr, 150 sh/hr, setup Std 45 / Adv 90 min, $1,200 default die",
  "- Bobst: $350/hr (uncalibrated placeholder), 3,000 sh/hr, 45 min flat setup, $250 min charge, $1,800 default die",
  "",
  "**GM curve (D-110 FINAL):** 0-1 MSF: 50% / 1-3: 37% / 3-5: 32% / 5-9: 27% / 10+: 25%",
  "**FSC/SFI fee:** $25 amortized into board",
  "**Paper uplift:** +10% baked into engine.base_matrix (D-102)",
  "**Ink:** $0.05/sqft LOCKED",
  "**under5MsfFee:** $0 always (Rule 3)",
  "**Default print finish:** Satin (Rule 8 / D-105)",
  "**Default FOB:** Origin (ZIP 44704)",
  "**Default initials:** SPC (locked, Rule 2)",
  "",
  "**These are SERVER-SIDE constants. The parser MUST NOT emit any of these fields. Rate migration on load",
  "snaps any included rate fields back to defaults and fires a toast — emitting them is noise.**",
].join("\n");

const EMBEDDED_HARNESS_HIGHLIGHTS = [
  "## Harness Method Derivation M1-M5 (embedded — see EST_SPOT_Intake_Harness.md v2.1+)",
  "",
  "Every parse begins with a BOM Scope inventory pass: count physical pieces in the RFQ. Then derive method:",
  "",
  "- **M1 — Single Simple:** 1 physical piece, single quote. quoteType=\"Simple\". No bomItems[]. Output flat.",
  "- **M2 — Single Multi-Part stub:** 1 piece but customer ordered Multi-Part shape (rare). quoteType=\"Multi-Part\", pricingMode=\"Individual\", bomItems[] with 1 entry.",
  "- **M3 — Multi-Part Matched Set:** 2+ pieces, ALL share a set/display unit (display, kit, multi-part assembly). quoteType=\"Multi-Part\", pricingMode=\"Matched Set\", bomItems[] one per physical piece, top-level qtys mirror item qtys × pcsPerSet.",
  "- **M4 — Multi-Part Individual:** 2+ pieces, customer wants per-item pricing (mixed orders, separate SKUs). quoteType=\"Multi-Part\", pricingMode=\"Individual\", bomItems[] one per piece.",
  "- **M5 — Purchased blend:** mix of manufactured and purchased items. quoteType=\"Multi-Part\", per-item type=\"Manufactured\"|\"Purchased\"|\"Fulfillment\".",
  "",
  "**Emit `method: \"M1\"`..\"M5\" at top level so client knows the shape without inferring from bomItems length.**",
  "",
  "**Source-tag taxonomy (per harness §12, REQUIRED on every emitted field):**",
  "- `RFQ` — value stated explicitly in RFQ email/text body.",
  "- `CAD` — value extracted from a CAD drawing/PDF (dims, die part #).",
  "- `DEFAULT` — system default applied (estimator did NOT specify; use sparingly — prefer null+ask for unspecified non-default fields).",
  "- `CALC` — value derived/computed (e.g., qty × pcsPerSet).",
  "- `ASK` — value missing or unclear; field set to null and entry added to asks[].",
  "- `REGISTRY` — value resolved through canonical-terms registry (e.g., customer wrote \"CKB\", parser writes `42# Kemi-Lite` with REGISTRY tag).",
  "",
  "Source tags emit as a parallel `sources: { fieldPath: \"TAG\" }` object alongside `parsed`.",
  "",
  "**Display vocabulary → boxStyle mapping (Multi-Part display jobs, per harness §10):**",
  "- header card / topper / marquee → `Display Header`",
  "- base / floor / platform → `Display Base`",
  "- product tray / shelf / chute → `D/C Tray`",
  "- riser / column / spacer → `D/C Non-Joined`",
  "- divider / partition / easel → `D/C Non-Joined`",
  "- pallet skirt / side wing → `D/C Non-Joined`",
  "- master shipper / outer case → `RSC` (kraft, printReq:\"No\")",
].join("\n");

const EMBEDDED_KNOWLEDGE = [
  EMBEDDED_CANONICAL_TERMS,
  EMBEDDED_QUOTING_RULES,
  EMBEDDED_BOARD_LIBRARY,
  EMBEDDED_CONTROL_DEFAULTS,
  EMBEDDED_HARNESS_HIGHLIGHTS,
].join("\n\n---\n\n");

// Build the complete knowledge prompt at parse-time. Combines:
// 1. SYSTEM_PROMPT_DOCS (prompts/ folder content — preferred source if populated)
// 2. EMBEDDED_KNOWLEDGE (always present — fallback when prompts/ is empty/partial)
// 3. Customer code list (live from customerCache — refreshed independently)
//
// When prompts/ has files, BOTH are injected (prompts/ first, embedded second) — embedded
// constants serve as a backstop in case prompts/ files don't cover a specific area. When
// prompts/ is empty, EMBEDDED_KNOWLEDGE alone supplies SPOT-accurate context. Per Michael
// 2026-05-01: partial knowledge injection is unacceptable; this guarantees full coverage.
function buildKnowledgePrompt(customerCacheRef) {
  const parts = [];
  if (SYSTEM_PROMPT_DOCS && SYSTEM_PROMPT_DOCS.length > 0) {
    parts.push("\u2550\u2550\u2550 BUNDLED PROMPTS/ DOCUMENTATION \u2550\u2550\u2550");
    parts.push(SYSTEM_PROMPT_DOCS);
    parts.push("");
  }
  parts.push("\u2550\u2550\u2550 EMBEDDED KNOWLEDGE FALLBACK (D-136, R1.6.3) \u2550\u2550\u2550");
  parts.push(EMBEDDED_KNOWLEDGE);
  parts.push("");
  // Inject customer codes from already-loaded cache. Format: cust_code | cust_name (1 per line).
  // This lets the parser emit cust_code directly when it matches the customer name confidently,
  // saving the client-side fuzzy-match round-trip.
  if (customerCacheRef && Array.isArray(customerCacheRef.customers) && customerCacheRef.customers.length > 0) {
    parts.push("\u2550\u2550\u2550 SPC CUSTOMER REGISTRY (" + customerCacheRef.customers.length + " entries — emit cust_code directly when matched) \u2550\u2550\u2550");
    parts.push("Format: <cust_code> | <cust_name>");
    parts.push("");
    const lines = [];
    for (const c of customerCacheRef.customers) {
      const code = (c.cust_code || "").trim();
      const name = (c.cust_name || "").trim();
      if (code && name) lines.push(code + " | " + name);
    }
    parts.push(lines.join("\n"));
    parts.push("");
    parts.push("**Match rules:** exact name match → emit cust_code with REGISTRY source tag. Single fuzzy match → emit cust_code + add note in asks. Multiple matches → leave cust_code null + add to asks. Zero matches → leave cust_code null (customer not in DB; estimator will add).");
  } else {
    parts.push("\u2550\u2550\u2550 SPC CUSTOMER REGISTRY (not loaded — set cust_code to null) \u2550\u2550\u2550");
  }
  return parts.join("\n");
}

// Budget tracking — persisted at <ARCHIVE_ROOT>/parser_budget.json
function getBudgetPath() { return path.join(ARCHIVE_ROOT, "parser_budget.json"); }
function readBudget() {
  const p = getBudgetPath();
  const monthStart = new Date().toISOString().substring(0, 7) + "-01";
  if (!fs.existsSync(p)) {
    return { monthlySpendUsd: 0, monthStart, cap: ANTHROPIC_MONTHLY_CAP_USD, callCount: 0, lastCall: null };
  }
  try {
    const b = JSON.parse(fs.readFileSync(p, "utf8"));
    // Roll over if month has changed
    if (b.monthStart !== monthStart) {
      return { monthlySpendUsd: 0, monthStart, cap: ANTHROPIC_MONTHLY_CAP_USD, callCount: 0, lastCall: null };
    }
    // Always reflect the current cap from env (in case user updated .env)
    b.cap = ANTHROPIC_MONTHLY_CAP_USD;
    return b;
  } catch (e) {
    return { monthlySpendUsd: 0, monthStart, cap: ANTHROPIC_MONTHLY_CAP_USD, callCount: 0, lastCall: null };
  }
}
function writeBudget(b) {
  try {
    if (!fs.existsSync(ARCHIVE_ROOT)) fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
    fs.writeFileSync(getBudgetPath(), JSON.stringify(b, null, 2));
  } catch (e) { console.log("  D-129: budget write failed: " + e.message); }
}
function calcCallCostUsd(model, usage) {
  const p = PRICING_USD_PER_MTOK[model] || PRICING_USD_PER_MTOK["claude-opus-4-7"];
  const inputTokens = (usage.input_tokens || 0);
  const cacheReadTokens = (usage.cache_read_input_tokens || 0);
  const cacheWriteTokens = (usage.cache_creation_input_tokens || 0);
  const outputTokens = (usage.output_tokens || 0);
  // Note: input_tokens does NOT include cache reads or cache writes (they're separate buckets in Anthropic's API)
  const cost =
    (inputTokens / 1_000_000) * p.input +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite +
    (outputTokens / 1_000_000) * p.output;
  return Math.round(cost * 10000) / 10000; // 4 decimal places
}

// Extract text from common RFQ formats so we can send as text vs base64 PDF when possible.
// (PDFs and images are sent natively to the API; .docx/.xlsx/.eml are extracted to text first.)
function extractTextFromFile(filePath, ext) {
  ext = (ext || "").toLowerCase();
  try {
    if (ext === ".txt" || ext === ".md" || ext === ".csv" || ext === ".tsv" || ext === ".log") {
      return fs.readFileSync(filePath, "utf8");
    }
    if (ext === ".eml") {
      // Simple eml parse — we just grab the visible text portion. Good enough for RFQ extraction.
      const raw = fs.readFileSync(filePath, "utf8");
      // Split header and body by first blank line
      const blank = raw.indexOf("\r\n\r\n");
      const blank2 = raw.indexOf("\n\n");
      const splitIdx = blank > -1 ? blank + 4 : (blank2 > -1 ? blank2 + 2 : 0);
      const header = raw.substring(0, splitIdx);
      const body = raw.substring(splitIdx);
      // Pull common headers we want Claude to see
      const subj = (header.match(/^Subject:\s*(.+)$/im) || [])[1] || "";
      const from = (header.match(/^From:\s*(.+)$/im) || [])[1] || "";
      const to   = (header.match(/^To:\s*(.+)$/im) || [])[1] || "";
      const date = (header.match(/^Date:\s*(.+)$/im) || [])[1] || "";
      // Naive multipart strip: take only text/plain section if present
      let plainBody = body;
      const tpStart = body.indexOf("Content-Type: text/plain");
      if (tpStart > -1) {
        const afterHeader = body.indexOf("\r\n\r\n", tpStart);
        const afterHeader2 = body.indexOf("\n\n", tpStart);
        const ahStart = afterHeader > -1 ? afterHeader + 4 : (afterHeader2 > -1 ? afterHeader2 + 2 : tpStart);
        const boundary = body.match(/^--[-_=A-Za-z0-9]+/m);
        const ahEnd = boundary ? body.indexOf(boundary[0], ahStart) : -1;
        plainBody = body.substring(ahStart, ahEnd > -1 ? ahEnd : body.length);
      }
      return `Subject: ${subj}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${plainBody}`.trim();
    }
    // .docx/.xlsx/.xls/.msg need libraries we don't bundle. Return null and let caller fall back to native (binary) send.
    return null;
  } catch (e) {
    console.log("  D-129: text extract failed for " + filePath + ": " + e.message);
    return null;
  }
}

// Anthropic API call. Uses prompt caching on the system prompt so repeat parses are cheap.
// D-129 Phase 1B (R1.5.7.3): Multi-file batch parse. Accepts {filePath, ext, mime, originalName}[]
// and sends ALL files in a single Anthropic API call so Claude has full context across the customer's
// inbound RFQ bundle. Returns one combined parse output covering everything.
// R1.5.10 — accepts optional clientApiKey (sourced from JSX request body, possibly per-customer).
//           When provided, takes precedence over module-loaded env key.
async function anthropicParseRfqBatch(fileList, clientApiKey) {
  let keyState;
  if (clientApiKey && typeof clientApiKey === "string" && clientApiKey.trim()) {
    keyState = { key: clientApiKey.trim(), source: "client (browser)" };
  } else {
    keyState = anthropicKeyState.key ? anthropicKeyState : reloadAnthropicKey();
  }
  if (!keyState.key) {
    const err = new Error("ANTHROPIC_API_KEY not configured");
    err.code = "NO_KEY";
    throw err;
  }
  const budget = readBudget();
  if (budget.monthlySpendUsd >= budget.cap) {
    const err = new Error(`monthly cap reached ($${budget.monthlySpendUsd.toFixed(2)} of $${budget.cap.toFixed(2)})`);
    err.code = "CAP_REACHED";
    throw err;
  }
  if (!fileList || fileList.length === 0) {
    const err = new Error("no files provided to parser");
    err.code = "NO_FILES";
    throw err;
  }

  // Build user message: header + per-file content blocks + instructions
  const userContent = [];
  userContent.push({
    type: "text",
    text: "Below are " + fileList.length + " file(s) from a single customer RFQ for Standard Printing Company. Extract the SPOT intake fields. Use information from across ALL files \u2014 they describe one job, not separate jobs."
  });

  for (const f of fileList) {
    const ext = (f.ext || "").toLowerCase();
    userContent.push({
      type: "text",
      text: "\u2500\u2500\u2500 File: " + (f.originalName || f.filename) + " \u2500\u2500\u2500"
    });
    if (ext === ".pdf") {
      const pdfBytes = fs.readFileSync(f.filePath);
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") }
      });
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
      const imgBytes = fs.readFileSync(f.filePath);
      const mediaType = f.mime || (MIME_BY_EXT[ext] || "image/png");
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: imgBytes.toString("base64") }
      });
    } else {
      const text = extractTextFromFile(f.filePath, ext);
      if (text) {
        userContent.push({ type: "text", text: text });
      } else {
        userContent.push({
          type: "text",
          text: "(binary format " + ext + " \u2014 content not extractable server-side; if this file would have provided values for any field, return null + asks entry)"
        });
      }
    }
  }

  // Final instruction with strict guardrails
  userContent.push({
    type: "text",
    text: [
      "\u2550\u2550\u2550 EXTRACTION INSTRUCTIONS \u2550\u2550\u2550",
      "",
      "Output ONLY valid JSON. No prose. No markdown fences. The JSON MUST match this exact shape:",
      "",
      "{",
      "  \"parsed\": { ... full SPOT intake object per EST_SPOT_Intake_Harness.md ... },",
      "  \"sources\": { \"<fieldPath>\": \"<TAG>\", ... },     // D-136 (R1.6.3) REQUIRED",
      "  \"method\": \"M1\" | \"M2\" | \"M3\" | \"M4\" | \"M5\",  // D-136 (R1.6.3) REQUIRED — see harness",
      "  \"asks\": [ {\"field\": <field path>, \"reason\": <short explanation>} ],",
      "  \"confidence\": <float 0.0 - 1.0>",
      "}",
      "",
      "**Source tags (D-136, R1.6.3) — REQUIRED on every emitted field path:**",
      "  RFQ      — value stated explicitly in RFQ email/text body.",
      "  CAD      — value extracted from a CAD drawing/PDF (dims, die part #, BOM in drawing).",
      "  DEFAULT  — system default applied (use sparingly; prefer null+ask for unspecified non-default fields).",
      "  CALC     — value derived/computed from other RFQ data (e.g., qty × pcsPerSet).",
      "  ASK      — value missing or unclear; field is null, asks[] entry added, NO source tag emitted (parallel to ASK in asks[]).",
      "  REGISTRY — value resolved through canonical-terms registry (e.g., RFQ said \"CKB\", parsed says \"42# Kemi-Lite\" via REGISTRY).",
      "",
      "**Source object format:** flat dotted-path keys for top-level fields and bomItems entries.",
      "  Examples: { \"custName\": \"RFQ\", \"flute\": \"CAD\", \"oneUpW\": \"CAD\", \"printMode\": \"ASK\",",
      "             \"bomItems[0].state.flute\": \"CAD\", \"bomItems[2].state.qtys\": \"CALC\" }",
      "",
      "**method (D-136, R1.6.3) — REQUIRED top-level field:**",
      "  M1 — Single Simple. 1 physical piece, single quote. quoteType=\"Simple\". No bomItems[].",
      "  M2 — Single Multi-Part stub. 1 piece in Multi-Part shape. quoteType=\"Multi-Part\", pricingMode=\"Individual\", bomItems[1].",
      "  M3 — Multi-Part Matched Set. 2+ pieces forming one display/kit. quoteType=\"Multi-Part\", pricingMode=\"Matched Set\".",
      "  M4 — Multi-Part Individual. 2+ pieces, per-item pricing. quoteType=\"Multi-Part\", pricingMode=\"Individual\".",
      "  M5 — Purchased blend. Mix of Manufactured + Purchased + Fulfillment items.",
      "",
      "**Multi-Part also REQUIRES per-component confidence** (in addition to top-level overall):",
      "  parsed.bomItems[i].confidence = 0.0-1.0 per-item certainty.",
      "  This lets the diff modal flag specific components for review independent of the overall score.",
      "",
      "**cust_code emission (D-136, R1.6.3):** When custName matches an entry in the SPC CUSTOMER REGISTRY",
      "block above (exact match preferred; single confident fuzzy match acceptable), emit `parsed.custCode` =",
      "the matched cust_code with sources.custCode = \"REGISTRY\". Multiple ambiguous matches → leave custCode null,",
      "add note in asks. Zero matches → leave custCode null (customer is new — estimator adds to DB).",
      "",
      "\u2550\u2550\u2550 MULTI-PART DETECTION (D-131, R1.5.11) \u2550\u2550\u2550",
      "",
      "STEP 1: Decide if the RFQ describes ONE physical piece or MULTIPLE.",
      "",
      "Multiple-piece signals (any one is sufficient):",
      "  - Display vocabulary: counter display, floor display, PDQ, sidekick, endcap,",
      "    pallet display, half-pallet, header card, topper, marquee, base, riser, column,",
      "    spacer, kicker, tray (multiple), divider, partition, easel, hutch, canopy,",
      "    pallet skirt, side wing, master shipper, shipper case, outer case, master pack",
      "  - Multiple part numbers / SKUs / drawings in a single RFQ describing one job",
      "  - Explicit \"set of N\", \"kit\", \"display unit\" with components listed",
      "",
      "Single-piece signal:",
      "  - One physical piece described, even with multiple decoration zones / colors / dies",
      "",
      "STEP 2: Output shape based on Step 1.",
      "",
      "SINGLE-PIECE \u2192 flat output (current shape, unchanged):",
      "  {parsed: { ...flat fields..., quoteType: \"Simple\" }, asks: [...], confidence: ...}",
      "  Do NOT include bomItems. Do NOT return a 1-row bomItems array.",
      "",
      "MULTI-PIECE \u2192 multi-part output:",
      "  {",
      "    parsed: {",
      "      ...top-level identity + shared fields (custName, custCode, custIdent, custRef,",
      "         itemDesc, estInitials, under5MsfFee, fobMode, destZip, etc.),",
      "      quoteType: \"Multi-Part\",",
      "      pricingMode: \"Matched Set\"   // DEFAULT for any multi-component display/kit. Use \"Individual\" ONLY if the RFQ literally uses the word \"individual\" or \"separate pricing\" or \"price each separately\". Multiple ship-to destinations do NOT make a display Individual — a matched display routinely ships to multiple assembly points and stays Matched Set. Different qtys per component also do NOT make it Individual — that's expected for displays (1 base, 3 shelves, 4 inserts, 1 shipper, etc).",
      "      setMarginPct: \"0.40\",        // Matched Set only; default 0.40",
      "",
      "      // Top-level intake fields MIRROR bomItems[0].state per Channel Reference L177",
      "      // (so the active item's view loads correctly when the file is applied):",
      "      boxStyle, flute, boardGrade, outsideLiner, insideLiner, medium,",
      "      oneUpW, oneUpL, qtys, printReq, printMode, printSides, ...",
      "",
      "      bomItems: [",
      "        {",
      "          id: \"item-1\",                         // \"item-N\" sequence",
      "          desc: \"Header card\",                  // human-readable component name",
      "          custIdent: \"PART-001\",                // component-specific part #/SKU",
      "          type: \"Manufactured\",                 // or Purchased / Fulfillment",
      "          pcsPerSet: 1,                          // pieces of THIS component per set",
      "          state: {",
      "            itemDesc: \"...\",",
      "            boxStyle: \"Display Header\",        // see canonical box styles below",
      "            flute, boardGrade, outsideLiner, insideLiner, medium,",
      "            oneUpW, oneUpL, qtys (5-element array, mirror top-level qtys),",
      "            printReq, printMode, printSides,",
      "            handStripping, strippingComplexity, perimeterStripping,",
      "            handGluing, jointsPerPiece, gluingComplexity, tape, tapeType,",
      "            cadPricingMethod, cadDifficulty, crestComplexity, totalRuleInches, perfPct,",
      "            cuttingDieCost, dieTreatment, prepressTreatment,",
      "            fscEnabled, fscFee, under5MsfFee, productMats, saber, saberCuts, saberBlanksOut,",
      "            whiteInk, dieAmortMethod, freightCost, freightTreatment",
      "          }",
      "        },",
      "        // ...one entry per physical piece, in any order...",
      "      ]",
      "    },",
      "    asks: [...],",
      "    confidence: ...",
      "  }",
      "",
      "STEP 3: Multi-part composition rules (CRITICAL):",
      "",
      "  - Top-level custIdent MUST match bomItems[0].custIdent (D-081 contract).",
      "  - Top-level qtys MUST match each bomItems[i].state.qtys when pricingMode is",
      "    Matched Set (BOM Builder enforces this).",
      "  - One bomItems entry per physical piece, including:",
      "    \u2022 Master shippers / outer cases (ALWAYS get their own entry when mentioned)",
      "    \u2022 Risers, dividers, fillers (even if non-printing)",
      "    \u2022 Pallet skirts, side wings, easels, hutches",
      "  - Pallet itself is NOT an SPC item unless RFQ explicitly says SPC sources it",
      "    (then type: \"Purchased\").",
      "  - Each component can have its own flute / grade / liner / dims / print settings.",
      "  - If a component is described but dimensions are unclear, set its oneUpW/oneUpL",
      "    to null and add to asks. Do NOT infer from \"typical\" display proportions.",
      "  - If a component is litho-laminated / paper-on-board / mounted, set printMode:",
      "    \"Satin\" and add an ask noting non-native process.",
      "",
      "Canonical boxStyle values include: \"RSC\", \"FOL\", \"D/C Tray\", \"D/C Joined\",",
      "\"D/C Non-Joined\", \"Mailer\", \"5PF\", \"Display Header\", \"Display Base\".",
      "",
      "Common display-component \u2192 boxStyle mapping:",
      "  header card / topper / marquee \u2192 Display Header",
      "  base / floor / platform        \u2192 Display Base",
      "  product tray / shelf / chute   \u2192 D/C Tray",
      "  riser / column / spacer        \u2192 D/C Non-Joined",
      "  divider / partition / easel    \u2192 D/C Non-Joined",
      "  pallet skirt / side wing       \u2192 D/C Non-Joined",
      "  master shipper / outer case    \u2192 RSC (kraft, printReq: \"No\")",
      "",
      "\u2550\u2550\u2550 CAD BOARD CALLOUT GRAMMAR (D-145, R1.6.5) \u2014 READ EVERY CAD INDIVIDUALLY \u2550\u2550\u2550",
      "",
      "SPC CAD drawings encode board specs in a compact format. You MUST parse this per-component, not homogenize across the display. Components in the same BOM routinely have DIFFERENT liners.",
      "",
      "Format: \"<grade># <flute> <O/S liner>/<I/S liner> [optional notes]\"",
      "OR:    \"<grade> ECT <flute> <O/S liner>/<I/S liner>\"",
      "",
      "Liner abbreviations:",
      "  K     \u2192 None  (canonical SPC engine value for kraft \u2014 NEVER emit the string \"Kraft\" as the field value)",
      "  MW    \u2192 42# Kla-White (mottled white)",
      "  KEMI  \u2192 42# Kemi-Lite (clay-coated kraft, SPC's default printable liner)",
      "  BL    \u2192 42# Bleached White",
      "",
      "Worked examples (from real SPC CADs):",
      "  \"200 # B KEMI/K\"        \u2192 boardGrade=\"200\",    flute=\"B\", outsideLiner=\"42# Kemi-Lite\", insideLiner=\"None\"  (None = kraft canonical value)",
      "  \"200 # B KEMI/MW\"       \u2192 boardGrade=\"200\",    flute=\"B\", outsideLiner=\"42# Kemi-Lite\", insideLiner=\"42# Kla-White\"",
      "  \"32 ECT E KEMI/MW\"      \u2192 boardGrade=\"ECT 32\", flute=\"E\", outsideLiner=\"42# Kemi-Lite\", insideLiner=\"42# Kla-White\"",
      "  \"32 ECT B K/K OP Cert\"  \u2192 boardGrade=\"ECT 32\", flute=\"B\", outsideLiner=\"None\",         insideLiner=\"None\"   (K/K = both sides kraft = both fields \"None\"; OP Cert = optional certification, ignore)",
      "  \"32 ECT C K/K\"          \u2192 boardGrade=\"ECT 32\", flute=\"C\", outsideLiner=\"None\",         insideLiner=\"None\"",
      "  \"X200 E\"                \u2192 boardGrade=\"200\",    flute=\"E\", outsideLiner=\"42# Kemi-Lite\" (X = clay-coated outside), insideLiner=\"None\" (None = kraft, the default when inside not stated)",
      "",
      "Substrate breakdown line (often present below the main callout):",
      "  \"42KEMI / 23 / 42\"      \u2192 confirms 42# Kemi outside, 23# medium, 42# kraft liner inside (no MW suffix \u2192 insideLiner=\"None\")",
      "  \"42KEMI / 23 / 42MW\"    \u2192 confirms 42# Kemi outside, 23# medium, 42# Kla-White inside (MW suffix)",
      "  Use this to disambiguate: if main callout is K/K but breakdown shows 42MW, trust the breakdown.",
      "",
      "CRITICAL: A display with 10 components can have 10 different board specs. Read each CAD's title block individually. DO NOT fill insideLiner with a single display-wide default. The K/K vs K/MW distinction is real cost difference and matters for board selection.",
      "",
      "Common SPC pattern for displays: front-facing components (riser, body, shelves, inserts visible to shopper) tend to be KEMI/MW (white inside, looks clean when display opens); structural components (base, body backer, shippers) tend to be KEMI/K or K/K. But this is a TENDENCY not a rule \u2014 always read the actual CAD.",
      "",
      "\u2550\u2550\u2550 PER-COMPONENT RFQ-BODY INSTRUCTIONS (D-145, R1.6.5) \u2550\u2550\u2550",
      "",
      "RFQ emails often contain component-specific spec changes hidden in prose body text. Scan the email body explicitly for these patterns and reflect them in the relevant bomItems entry:",
      "",
      "  - \"remove [feature] from [component]\"  \u2192 update bomItems[N].state.itemDesc + add ask if it implies tooling change",
      "  - \"add [feature] to [component]\"        \u2192 update bomItems[N].state.itemDesc + add ask",
      "  - \"use new [file/CAD/ARD] for [component]\" \u2192 update bomItems[N].state.itemDesc; flag die change",
      "  - \"match previous job [number] for [component]\" \u2192 add to itemDesc; existing-die likely (no new die cost)",
      "  - \"glue inside\" / \"glued center seam\" / \"X was missed last time\"  \u2192 update glueReq / glueDifficulty + ask if it's a known production concern",
      "  - \"plain no print\" overriding a CAD that shows printing  \u2192 set printReq=\"No\", note CAD-vs-RFQ override in ask",
      "",
      "Real example from a SPC RFQ email body:",
      "  \"There is a QR code and directions on the side of this riser. We need this removed and transferred to the back of the body. Add QR code to back of tray \u2014 same location and size used in previous job 231146-1.\"",
      "  \u2192 bomItems[Riser].state.itemDesc should note \"QR code REMOVED per RFQ (was on side panel)\"",
      "  \u2192 bomItems[Body].state.itemDesc should note \"QR code ADDED to back per RFQ, location/size matches job 231146-1\"",
      "  \u2192 add 1 ask: \"Riser/Body QR-code spec change \u2014 die/tooling adjustment may be required, confirm cost\"",
      "",
      "These per-component instructions affect die cost and production. Missing them is a real money problem.",
      "",
      "\u2550\u2550\u2550 EMAIL SIGNATURE EXTRACTION (D-145, R1.6.5) \u2550\u2550\u2550",
      "",
      "destZip / ship-to information often appears in email signatures, not just RFQ body. Always scan email signatures for:",
      "  - Street address + city + state + ZIP (e.g., \"PCA Cheswick / 499 Nixon Road / Cheswick, PA 15024\")",
      "  - Company name + branch identifier (e.g., \"PCA Cheswick\" vs \"PCA Hanover\")",
      "  - Phone numbers in xxx-xxx-xxxx format (less critical but useful for routing)",
      "",
      "destZip extraction rules (apply in order, first match wins):",
      "",
      "RULE 1: If the RFQ body states an explicit ship-to ZIP (5-digit number, optionally hyphenated 5+4), use that ZIP. Tag RFQ source.",
      "",
      "RULE 2: If the RFQ body names a destination by company-and-branch (e.g., \"ship to PCA Cheswick\", \"ship to assembly\", \"ship to PCA Hanover\") but does NOT include a ZIP in the body, AND the email signature contains a matching company-and-branch with a clear ZIP, use the signature ZIP. Tag RFQ source. The body is naming the destination; the signature is providing its address. They reinforce each other, they don't conflict.",
      "",
      "RULE 3: If the RFQ body says \"ship to assembly\" / \"ship to assembler\" / \"ship to converter\" without naming the assembler, AND the email is from a single sender whose signature has a clear address, the SIGNATURE address is the ship-to. Tag RFQ source. (Converters/assemblers usually email from the address goods will arrive at.)",
      "",
      "RULE 4: If the RFQ body specifies a PER-COMPONENT ship-to override (e.g., \"Product Box ships to PCA Hanover\" while everything else ships to assembly), populate top-level destZip with the PRIMARY destination (the one receiving the majority of components by line-count or qty), and capture the per-component override as an ASK with the field path \"bomItems[N].destZip\" or as plain prose in asks.[reason]. Do NOT leave top-level destZip null because of a per-component split — the estimator needs a starting ZIP to work the freight, and the ask captures the secondary.",
      "",
      "RULE 5: If only the email signature has any ship-to information and the RFQ body is silent on destination, use the signature ZIP. Tag RFQ source.",
      "",
      "RULE 6: ONLY leave destZip null + ASK when there is GENUINE conflicting destination information that cannot be resolved (e.g., body says \"ship to ZIP 17331\" and signature says ZIP 15024 with no clear primary). This should be rare \u2014 most multi-shipto cases resolve via Rule 4.",
      "",
      "Worked example (the L'Oreal pattern, real fixture):",
      "  - Email body: \"ALL ABOVE WILL SHIP TO PCA ASSEMBLY\" + \"PRODUCT BOX 532 SHIPPING TO PCA HANOVER\"",
      "  - Email signature: \"PCA Cheswick / 499 Nixon Road / Cheswick, PA 15024\"",
      "  - Components: 9 items go to assembly, 1 item (product box) goes to Hanover",
      "  - CORRECT extraction: destZip = \"15024\" (Rule 4 applied: PCA Cheswick is the primary, signature provides ZIP, Hanover is the component-override). Add ask: \"Product Box (qty 532) ships separately to PCA Hanover \u2014 confirm Hanover ZIP and freight breakout.\"",
      "  - INCORRECT: leave destZip null because there are two destinations. The estimator works the assembly freight first, ZIP needs to be populated.",
      "",
      "\u2550\u2550\u2550 STRICT RULES \u2014 violations make the parse useless \u2550\u2550\u2550",
      "",
      "1. Use ONLY canonical SPOT values. Reference EST_SPOT_Canonical_Terms.md for every value you write. If a customer term doesn't map to a canonical SPOT term, set the field null and add to asks.",
      "2. Do NOT infer. If the RFQ doesn't say it, do not guess. Set null + asks.",
      "3. Do NOT generate quote prices, freight numbers, GM percentages, or any economic output. Only intake fields. SPOT will run the engine \u2014 your job is to fill the form.",
      "4. Initials field: ALWAYS \"SPC\" (per Rule 2 in EST_SPOT_Quoting_Rules.md). Never anything else.",
      "5. routeOverride: NEVER include this field. Route is always Auto (Rule 1).",
      "6. under5MsfFee: ALWAYS \"0\" (Rule 3). Never anything else.",
      "7a. printMode: If RFQ says \"digital\" / \"Inca\" / \"direct print on corrugated\" → printMode: \"Digital\". If RFQ says \"litho\" / \"litho-laminate\" / \"paper-on-board\" → printMode: \"Satin\" (litho-laminate maps to digital-Satin equivalent at SPC; add ask noting non-native process). If RFQ says \"flexo\" → printMode: \"Flexo\". If RFQ says \"Gloss\" or \"Satin\" explicitly → use that exactly. ONLY set printMode null + ask when RFQ doesn't specify any of the above process keywords.",
      "7b. Print finish (Gloss vs Satin specifically): When the RFQ says \"digital\" but doesn't pick Gloss vs Satin, set printMode=\"Digital\" AND add an ask noting Gloss-vs-Satin needs estimator pick (Rule 8 / D-114). The printMode field captures the process; Gloss-vs-Satin is a finish sub-question that's separately tracked.",
      "8. FOB: \"Origin\" unless RFQ explicitly says otherwise.",
      "9. ECT grade callouts: write the grade as the customer wrote it (e.g. \"ECT 32\"). Do NOT note that SPOT runs ECT on Mullen \u2014 that's a SPOT-internal substitution, not customer-facing.",
      "10. Confidence: 1.0 means every field came from the RFQ unambiguously. 0.5 means significant guesswork. Below 0.85, the estimator must review (Simple). Below 0.75, the estimator must review (Multi-Part). The auto-apply threshold for Multi-Part is more conservative because there are more fields to get right.",
      "",
      "FIELD COVERAGE \u2014 fill every field in the SPOT intake schema or set null + ask:",
      "  custName, custCode, custIdent, custRef (project name), itemDesc, boxStyle,",
      "  oneUpW, oneUpL, oneUpD (depth/gusset if applicable),",
      "  flute, boardGrade, outsideLiner, insideLiner, medium,",
      "  qtys (array of breaks),",
      "  printReq, printMode, printSides, printColors,",
      "  matsReq, stripReq, stripDifficulty, glueReq, glueJoints, glueDifficulty, tapeReq,",
      "  palletPrep, fscEnabled, kemiTariff,",
      "  destZip, fobMode, freightClass, trailerFeet,",
      "  estInitials (always \"SPC\"), under5MsfFee (always \"0\"),",
      "  quoteType (\"Simple\" or \"Multi-Part\"),",
      "  pricingMode (Multi-Part only — \"Matched Set\" or \"Individual\"),",
      "  setMarginPct (Matched Set only — \"0.40\" default),",
      "  bomItems[] (Multi-Part only — array of per-component entries per shape above)",
      "",
      "Begin extraction now."
    ].join("\n")
  });

  // D-136 (R1.6.3): comprehensive knowledge injection. buildKnowledgePrompt() combines
  // prompts/ folder content (preferred) + EMBEDDED_KNOWLEDGE fallback + customer registry
  // (live cust_code | cust_name list from customerCache). Per Michael 2026-05-01: partial
  // knowledge injection is unacceptable — this guarantees the parser ALWAYS has SPOT-accurate
  // context regardless of install completeness.
  const systemText = [
    "You are the SPOT estimating intake assistant for Standard Printing Company.",
    "Your ONLY job is to fill SPOT's intake form by reading customer RFQ files. You do NOT generate quotes \u2014 SPOT's engine does that after you fill the inputs.",
    "You MUST follow the bundled SPOT documentation exactly. Do not draw on general packaging-industry knowledge that conflicts with SPC-specific definitions (CKB, Crest, CAD, ECT 44 are all SPC-specific terms \u2014 see EST_SPOT_Canonical_Terms.md and the embedded canonical-terms block below).",
    "Every field you emit MUST carry a source tag in the parallel `sources` object: RFQ / CAD / DEFAULT / CALC / ASK / REGISTRY. See harness §12 / embedded-knowledge harness highlights below.",
    "Every parse MUST emit a `method` field at top level: M1 / M2 / M3 / M4 / M5 per harness derivation rules. Do not infer Multi-Part from bomItems[] length alone — emit the explicit method tag.",
    "Multi-Part responses MUST emit per-component confidence in addition to overall: bomItems[i].confidence (0.0-1.0) per item plus top-level confidence.",
    "When the customer name matches a SPC customer registry entry below, emit `cust_code` directly with REGISTRY source tag. This saves the client-side fuzzy-match round-trip.",
    "When in doubt, return null and add to asks. The estimator can fill missing fields manually \u2014 wrong fields cost the company money.",
    "",
    "\u2550\u2550\u2550 BUNDLED SPOT DOCUMENTATION + EMBEDDED KNOWLEDGE + CUSTOMER REGISTRY \u2550\u2550\u2550",
    "",
    buildKnowledgePrompt(customerCache)
  ].join("\n");

  // D-141 (R1.6.4): per-call input-token pre-flight. Refuse the request before hitting Anthropic
  // if our heuristic estimate of input tokens exceeds 80% of the 450,000/min TPM cap. The estimator
  // is conservative (overestimates rather than underestimates) — false positives are recoverable
  // (estimator splits the parse, retries) but false negatives produce 429 rate_limit_error mid-call
  // which is the exact failure mode this guards against.
  // Heuristic: PDFs/images count 1 token per raw byte (Anthropic vision tokenization runs higher
  // in practice but 1:1 floor catches the common overruns). Text counts bytes/4. System prompt
  // counts characters/4 (approximate text tokenization rate).
  const TPM_CAP = 450000;
  const PREFLIGHT_THRESHOLD = Math.floor(TPM_CAP * 0.80); // 360000
  let estimatedInputTokens = Math.ceil(systemText.length / 4);
  for (const f of fileList) {
    let bytes = 0;
    try { bytes = fs.statSync(f.filePath).size; } catch (e) { continue; }
    const ext = (f.ext || "").toLowerCase();
    if (ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
      // D-144 (R1.6.4.2): bytes/250 calibration. PDFs/images convert to per-page-image tokens at the
      // Anthropic API layer (~1600 tokens per image). Real bytes:tokens ratio is 200-700:1 for typical
      // image-heavy scan PDFs (1MB scan = ~2 pages = ~3200 tokens). The R1.6.4 1:1 ratio over-estimated
      // by ~250x and caused TC-D141.2 false-positives on normal-sized RFQs (D-144). 250 is conservative
      // mid-point — over-estimates relative to real consumption but stays well clear of the false-negative
      // path (which 429s mid-call). Text-extracted PDFs land closer to 50-100:1 ratio; the 250 divisor
      // accommodates both modes without per-file-type detection.
      estimatedInputTokens += Math.ceil(bytes / 250);
    } else {
      estimatedInputTokens += Math.ceil(bytes / 4);
    }
  }
  if (estimatedInputTokens > PREFLIGHT_THRESHOLD) {
    const err = new Error(
      "input too large: estimated " + estimatedInputTokens + " tokens exceeds pre-flight threshold "
      + PREFLIGHT_THRESHOLD + " (80% of " + TPM_CAP + "/min TPM cap). "
      + "Reduce file count, split into separate parses, or remove non-RFQ files from the folder."
    );
    err.code = "PREFLIGHT_OVER_LIMIT";
    err.estimatedTokens = estimatedInputTokens;
    err.threshold = PREFLIGHT_THRESHOLD;
    err.tpmCap = TPM_CAP;
    throw err;
  }

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [{ role: "user", content: userContent }],
  };

  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": keyState.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const respBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== 200) {
          const e = new Error("Anthropic API " + res.statusCode + ": " + respBody.substring(0, 500));
          e.code = "API_ERROR";
          e.status = res.statusCode;
          return reject(e);
        }
        try { resolve(JSON.parse(respBody)); }
        catch (parseErr) {
          const e = new Error("Anthropic API returned non-JSON: " + respBody.substring(0, 200));
          e.code = "BAD_RESPONSE";
          reject(e);
        }
      });
    });
    req.on("error", reject);
    // Longer timeout for batch parses (multiple files, larger payload)
    req.setTimeout(180000, () => { req.destroy(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

async function anthropicParseRfq_LEGACY(filePath, ext, mime, originalName) {
  const keyState = anthropicKeyState.key ? anthropicKeyState : reloadAnthropicKey();
  if (!keyState.key) {
    const err = new Error("ANTHROPIC_API_KEY not configured");
    err.code = "NO_KEY";
    throw err;
  }
  // Budget check
  const budget = readBudget();
  if (budget.monthlySpendUsd >= budget.cap) {
    const err = new Error(`monthly cap reached ($${budget.monthlySpendUsd.toFixed(2)} of $${budget.cap.toFixed(2)})`);
    err.code = "CAP_REACHED";
    throw err;
  }

  // Build user message content based on file type
  ext = (ext || "").toLowerCase();
  const userContent = [];
  if (ext === ".pdf") {
    const pdfBytes = fs.readFileSync(filePath);
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") }
    });
  } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
    const imgBytes = fs.readFileSync(filePath);
    const mediaType = mime || (MIME_BY_EXT[ext] || "image/png");
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imgBytes.toString("base64") }
    });
  } else {
    // Text-extractable formats
    const text = extractTextFromFile(filePath, ext);
    if (text) {
      userContent.push({ type: "text", text: "RFQ FILE CONTENT (filename: " + originalName + "):\n\n" + text });
    } else {
      // Fallback: send filename only and let Claude know it can't read the body
      userContent.push({
        type: "text",
        text: "RFQ FILE: " + originalName + " (binary format " + ext + " — content not extractable server-side; please return asks for any field that would have come from this file)"
      });
    }
  }
  // Trailing instruction
  userContent.push({
    type: "text",
    text: [
      "Extract the SPOT intake fields from this RFQ.",
      "Output ONLY valid JSON (no prose, no markdown fences).",
      "Schema: {\"parsed\": <intake object per EST_SPOT_Intake_Harness.md>, \"asks\": [{\"field\": <name>, \"reason\": <string>}], \"confidence\": <float 0-1>}.",
      "For any field not determinable from the RFQ, set the value to null and add an entry to asks explaining why.",
      "Confidence reflects your overall certainty in the parse — penalize aggressive guesses.",
      "Use canonical SPOT terms only (see EST_SPOT_Canonical_Terms.md). Do not invent values."
    ].join(" ")
  });

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: "You are the SPOT estimating assistant for Standard Printing Company. Your job is to read inbound RFQs and extract the SPOT intake schema. Below are the canonical SPOT documents that define every valid field, value, and rule. Extract conservatively \u2014 when in doubt, return null and explain in asks.\n\n" + buildKnowledgePrompt(customerCache),
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [{ role: "user", content: userContent }],
  };

  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": keyState.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const respBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== 200) {
          const e = new Error("Anthropic API " + res.statusCode + ": " + respBody.substring(0, 500));
          e.code = "API_ERROR";
          e.status = res.statusCode;
          return reject(e);
        }
        try {
          resolve(JSON.parse(respBody));
        } catch (parseErr) {
          const e = new Error("Anthropic API returned non-JSON: " + respBody.substring(0, 200));
          e.code = "BAD_RESPONSE";
          reject(e);
        }
      });
    });
    req.on("error", reject);
    // 90 second timeout — RFQ parses can take 20-60s on large multi-page PDFs
    req.setTimeout(90000, () => { req.destroy(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".log": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls":  "application/vnd.ms-excel",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ai":   "application/postscript",
  ".eps":  "application/postscript",
  ".dxf":  "application/dxf",
  ".psd":  "image/vnd.adobe.photoshop",
  ".zip":  "application/zip",
  ".eml":  "message/rfc822",
  ".msg":  "application/vnd.ms-outlook",
};

function mimeForExt(ext) {
  return MIME_BY_EXT[String(ext || "").toLowerCase()] || "application/octet-stream";
}

function classifyFile(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (EXEC_DENYLIST.has(ext)) return "blocked";
  if (RFQ_CLASS_EXTS.has(ext)) return "rfq";
  return "asset";
}

function normalizeCustomerForFolder(custName) {
  // Strip illegal Windows chars, collapse underscores, trim ~30 chars
  let safe = String(custName || "Customer").replace(/[\/\\:*?"<>|]/g, "_");
  safe = safe.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (safe.length > 30) safe = safe.substring(0, 30).replace(/[_\s]+$/, "");
  safe = safe.replace(/\s+$/, "").replace(/_+$/, "");
  if (!safe) safe = "Customer";
  return safe;
}

function buildFolderName(custName, estNum) {
  return normalizeCustomerForFolder(custName) + "_" + estNum;
}

function normalizeFilename(originalName) {
  // Take basename only (strip any path), lowercase extension, spaces->_, trim
  const base = path.basename(String(originalName || "file"));
  const ext = path.extname(base).toLowerCase();
  const stem = base.substring(0, base.length - path.extname(base).length).replace(/\s+/g, "_").replace(/[^A-Za-z0-9._\-]/g, "_");
  const out = (stem || "file") + ext;
  return out;
}

function uniqueFilename(folderPath, desired) {
  // If desired already exists, append _2, _3, ... before the extension
  const ext = path.extname(desired);
  const stem = desired.substring(0, desired.length - ext.length);
  let candidate = desired;
  let n = 2;
  while (fs.existsSync(path.join(folderPath, candidate))) {
    candidate = stem + "_" + n + ext;
    n++;
    if (n > 999) { candidate = stem + "_" + Date.now() + ext; break; }
  }
  return candidate;
}

function archiveYearFolderPath(year) {
  return path.join(ARCHIVE_ROOT, String(year));
}

function archiveQuoteFolderPath(year, folderName) {
  return path.join(archiveYearFolderPath(year), folderName);
}

function ensureArchiveStructure(year, folderName) {
  const quoteDir = archiveQuoteFolderPath(year, folderName);
  fs.mkdirSync(quoteDir, { recursive: true });
  return quoteDir;
}

function readMetaJson(quoteDir) {
  const metaPath = path.join(quoteDir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath, "utf8")); }
  catch (e) { console.log("  D-120: meta.json read failed at " + metaPath + " — " + e.message); return null; }
}

function writeMetaJson(quoteDir, meta) {
  const metaPath = path.join(quoteDir, "meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

function seedMeta(estNum, custName, custCode, folderName) {
  const now = new Date().toISOString();
  return {
    estNum: estNum,
    custName: custName || "",
    custCode: custCode || "",
    folderName: folderName,
    createdAt: now,
    updatedAt: now,
    files: [],
    phase1: true,
    parserStatus: "deferred",
    syncStatus: "local-only",
  };
}

function archiveHealth() {
  let exists = false, writable = false, folderCount = 0;
  try {
    if (!fs.existsSync(ARCHIVE_ROOT)) {
      try { fs.mkdirSync(ARCHIVE_ROOT, { recursive: true }); exists = true; }
      catch (e) { exists = false; }
    } else {
      exists = true;
    }
    if (exists) {
      try {
        // Probe write
        const probe = path.join(ARCHIVE_ROOT, ".probe_" + Date.now());
        fs.writeFileSync(probe, "ok");
        fs.unlinkSync(probe);
        writable = true;
      } catch (e) { writable = false; }
      // Count year folders / quote folders (best-effort)
      try {
        const years = fs.readdirSync(ARCHIVE_ROOT).filter(n => /^\d{4}$/.test(n));
        for (const y of years) {
          try { folderCount += fs.readdirSync(path.join(ARCHIVE_ROOT, y)).filter(n => fs.statSync(path.join(ARCHIVE_ROOT, y, n)).isDirectory()).length; } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
  return { root: ARCHIVE_ROOT, exists: exists, writable: writable, folderCount: folderCount };
}

// ─── Minimal multipart/form-data parser (no external dep) ───
// Streams the request body into a single Buffer, then splits on the boundary.
// Adequate for typical RFQ uploads (PDF, image, art) up to MAX_FILE_BYTES per part.
// For Phase 1 simplicity over streaming optimization. Revisit if needed.
function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on("data", chunk => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new Error("Request body exceeds limit (" + maxBytes + " bytes)"));
        try { req.destroy(); } catch (e) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!aborted) resolve(Buffer.concat(chunks)); });
    req.on("error", err => { if (!aborted) reject(err); });
  });
}

function parseContentDisposition(line) {
  // Content-Disposition: form-data; name="files"; filename="rfq.pdf"
  const out = {};
  const parts = line.split(";").map(s => s.trim());
  for (const p of parts) {
    const m = /^([A-Za-z0-9_-]+)\s*=\s*"?([^"]*)"?$/.exec(p);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function parseMultipart(buf, boundary) {
  // Returns { fields: {name:value}, files: [{fieldName, filename, contentType, data}] }
  const out = { fields: {}, files: [] };
  const dashBoundary = Buffer.from("--" + boundary);
  const CRLF = Buffer.from("\r\n");
  let pos = 0;
  // Find first boundary
  let idx = buf.indexOf(dashBoundary, pos);
  if (idx < 0) return out;
  pos = idx + dashBoundary.length;
  if (buf.slice(pos, pos + 2).equals(CRLF)) pos += 2;
  while (true) {
    // Read headers up to CRLF CRLF
    const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"), pos);
    if (headerEnd < 0) break;
    const headerBlock = buf.slice(pos, headerEnd).toString("utf8");
    pos = headerEnd + 4;
    const headers = {};
    for (const line of headerBlock.split("\r\n")) {
      const c = line.indexOf(":");
      if (c > 0) headers[line.substring(0, c).trim().toLowerCase()] = line.substring(c + 1).trim();
    }
    const disp = parseContentDisposition(headers["content-disposition"] || "");
    const name = disp["name"] || "";
    const filename = disp["filename"] || "";
    const contentType = headers["content-type"] || "";
    // Find next boundary
    const nextIdx = buf.indexOf(dashBoundary, pos);
    if (nextIdx < 0) break;
    // Part data is buf[pos .. nextIdx-2] (strip trailing CRLF)
    let dataEnd = nextIdx;
    if (dataEnd >= 2 && buf[dataEnd - 2] === 0x0D && buf[dataEnd - 1] === 0x0A) dataEnd -= 2;
    const data = buf.slice(pos, dataEnd);
    if (filename) {
      out.files.push({ fieldName: name, filename: filename, contentType: contentType, data: data });
    } else {
      out.fields[name] = data.toString("utf8");
    }
    pos = nextIdx + dashBoundary.length;
    // Trailing -- means end
    if (buf.slice(pos, pos + 2).toString() === "--") break;
    if (buf.slice(pos, pos + 2).equals(CRLF)) pos += 2;
  }
  return out;
}

function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
// ─── End D-120 archive helpers ───


function zipToZone(zip) {
  const p = parseInt(String(zip).substring(0, 3), 10);
  if (p >= 430 && p <= 458) return 1;
  if ((p >= 150 && p <= 196) || (p >= 247 && p <= 268) || (p >= 400 && p <= 429) || (p >= 459 && p <= 479)) return 2;
  if ((p >= 100 && p <= 149) || (p >= 197 && p <= 246) || (p >= 269 && p <= 289)) return 3;
  if ((p >= 290 && p <= 349) || (p >= 10 && p <= 99) || (p >= 480 && p <= 499)) return 4;
  if (p >= 350 && p <= 399) return 5;
  if ((p >= 500 && p <= 599) || (p >= 600 && p <= 699) || (p >= 700 && p <= 799)) return 6;
  if (p >= 800 && p <= 884) return 7;
  if (p >= 885 && p <= 999) return 8;
  return 4;
}

function fallbackRate(destZip, weightLbs) {
  const z = zipToZone(destZip);
  const zoneData = FALLBACK_ZONES[z - 1];
  const cwt = weightLbs / 100;
  const base = Math.max(cwt * zoneData.cwt, zoneData.min);
  return { source: "fallback", zone: z, zoneLabel: zoneData.label, carrier: "Estimated (zone " + z + ")", transitDays: z <= 2 ? 2 : z <= 4 ? 3 : z <= 6 ? 5 : 7, totalAmount: Math.round(base * 100) / 100, fuelSurcharge: 0, note: "Fallback estimate" };
}

function spcLocalRate(destZip, weightLbs, trailerFeet) {
  const prefix = String(destZip).substring(0, 3);
  const zone = SPCOC_ZONES[prefix];
  if (!zone) return null;
  if (weightLbs > SPCOC_MAX_WEIGHT) return null;
  if (trailerFeet !== undefined && trailerFeet !== null && trailerFeet > SPCOC_MAX_TRAILER_FT) return null;
  const rate = SPCOC_RATES[zone];
  return {
    source: "spcoc", zone: zone, zoneLabel: SPCOC_LABELS[zone],
    carrier: "SPC Local Delivery", transitDays: 1,
    totalAmount: rate, fuelSurcharge: 0, allCarriers: [],
    note: "SPCOC local zone rate — flat $" + rate
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// D-118: Customer Database — Network-Drive CSV → JSON cache → search endpoints
// ═══════════════════════════════════════════════════════════════════════════
// Multi-path discovery (D-118 late additions, reapplied 2026-04-26):
//   1) process.env.CUSTOMER_CSV_PATH   (operator override)
//   2) <__dirname>/SPOT/customerList.csv   (server-local SPOT subfolder)
//   3) <__dirname>/customerList.csv         (server's own folder)
//   4) UNC SharePoint mount (corrected path — original guess in D-118 was wrong)
const CUSTOMER_CSV_CANDIDATES = [
  process.env.CUSTOMER_CSV_PATH || null,
  path.join(__dirname, "SPOT", "customerList.csv"),
  path.join(__dirname, "customerList.csv"),
  "\\\\standardprinting.sharepoint.com\\sites\\spcoc.com\\Shared Documents\\General\\SPOT\\customerList.csv",
].filter(Boolean);

function discoverCustomerCsvPath() {
  for (const candidate of CUSTOMER_CSV_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        console.log("  D-118: CSV discovered at " + candidate);
        return candidate;
      }
    } catch (e) {
      // permission/network error — keep walking
    }
  }
  console.log("  D-118: CSV not found in any candidate path; cache will run from disk-cache only");
  return null;
}

// Resolved at boot time; may change on refresh if a path becomes reachable
let CUSTOMER_CSV_PATH = discoverCustomerCsvPath() || CUSTOMER_CSV_CANDIDATES[CUSTOMER_CSV_CANDIDATES.length - 1];
const CUSTOMER_CACHE_DIR = path.join(__dirname, "cache");
const CUSTOMER_CACHE_PATH = path.join(CUSTOMER_CACHE_DIR, "customers.json");
const CUSTOMER_REFRESH_HOUR = 2;
const CUSTOMER_STALE_HOURS = 36;
const CUSTOMER_WATCH_DEBOUNCE_MS = 5000;

// ─── D-118 late additions: Terms-code normalization ───
// Maps common iQuote/AS400 terms codes to display strings the SPOT UI expects in `quoteTerms`.
// Unknown codes pass through unchanged so operators can see the raw value.
const TERMS_MAP = {
  "N30": "Net 30", "N15": "Net 15", "N45": "Net 45", "N60": "Net 60",
  "NET30": "Net 30", "NET15": "Net 15", "NET45": "Net 45", "NET60": "Net 60",
  "2/10N30": "2% 10 Net 30", "2-10-N30": "2% 10 Net 30",
  "COD": "COD", "PRE": "Prepaid", "PREPAID": "Prepaid",
  "CC": "Credit Card", "CREDITCARD": "Credit Card",
};
function normalizeTerms(code) {
  if (!code) return "";
  const key = String(code).toUpperCase().replace(/\s+/g, "");
  return TERMS_MAP[key] || String(code);
}
function normalizeCustomer(c) {
  if (!c) return c;
  return Object.assign({}, c, { quoteTerms: normalizeTerms(c.termsCode) });
}

let customerCache = { refreshedAt: null, sourcePath: CUSTOMER_CSV_PATH, sourceMtime: null, rowCount: 0, customers: [] };
let customerWatcher = null;
let customerWatchDebounce = null;
let customerCronTimer = null;

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = false; }
      } else { cur += ch; }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseBoolean(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toUpperCase();
  return s === "Y" || s === "YES" || s === "TRUE" || s === "1" || s === "T";
}

function parseNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function rowToCustomer(cols) {
  return {
    code: (cols[0] || "").trim(),
    name: (cols[1] || "").trim(),
    address1: (cols[2] || "").trim(),
    address2: (cols[3] || "").trim(),
    address3: (cols[4] || "").trim(),
    city: (cols[5] || "").trim(),
    state: (cols[6] || "").trim(),
    zip: (cols[7] || "").trim(),
    phone: (cols[8] || "").trim(),
    termsCode: (cols[9] || "").trim(),
    salesAgentId: (cols[10] || "").trim(),
    salesTaxCode: (cols[11] || "").trim(),
    poRequired: parseBoolean(cols[12]),
    onCreditHold: parseBoolean(cols[13]),
    creditLimit: parseNumber(cols[14]),
  };
}

function loadCsvFromDisk() {
  if (!fs.existsSync(CUSTOMER_CSV_PATH)) {
    throw new Error("CSV not found at " + CUSTOMER_CSV_PATH);
  }
  const stat = fs.statSync(CUSTOMER_CSV_PATH);
  const raw = fs.readFileSync(CUSTOMER_CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows");

  const header = parseCsvLine(lines[0]);
  if (header.length < 15) {
    throw new Error("CSV column-count mismatch: expected ≥15, got " + header.length + ". Cache untouched.");
  }

  const customers = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    try {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 15) { skipped++; continue; }
      const cust = rowToCustomer(cols);
      if (!cust.code || !cust.name) { skipped++; continue; }
      customers.push(cust);
    } catch (e) {
      console.log("  D-118: skip row " + (i + 1) + ": " + e.message);
      skipped++;
    }
  }
  if (skipped > 0) console.log("  D-118: " + skipped + " row(s) skipped (malformed/empty)");

  return {
    refreshedAt: new Date().toISOString(),
    sourcePath: CUSTOMER_CSV_PATH,
    sourceMtime: stat.mtime.toISOString(),
    rowCount: customers.length,
    customers: customers,
  };
}

function writeCacheToDisk(cache) {
  try {
    if (!fs.existsSync(CUSTOMER_CACHE_DIR)) fs.mkdirSync(CUSTOMER_CACHE_DIR, { recursive: true });
    fs.writeFileSync(CUSTOMER_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
    return true;
  } catch (e) {
    console.log("  D-118: cache write failed (" + e.message + ") — holding in memory only");
    return false;
  }
}

function readCacheFromDisk() {
  try {
    if (!fs.existsSync(CUSTOMER_CACHE_PATH)) return null;
    const raw = fs.readFileSync(CUSTOMER_CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.log("  D-118: cache read failed (" + e.message + ")");
    return null;
  }
}

function refreshCustomers(reason) {
  try {
    console.log("  D-118: refresh triggered (" + reason + ")");
    // Re-discover path each refresh — network mounts can come/go between calls
    const discovered = discoverCustomerCsvPath();
    if (discovered) CUSTOMER_CSV_PATH = discovered;
    const fresh = loadCsvFromDisk();
    customerCache = fresh;
    writeCacheToDisk(fresh);
    console.log("  D-118: " + fresh.rowCount + " customers loaded; cache written");
    return { ok: true, rowCount: fresh.rowCount, refreshedAt: fresh.refreshedAt, sourceMtime: fresh.sourceMtime };
  } catch (e) {
    console.log("  D-118: refresh FAILED (" + e.message + ") — existing cache (rowCount=" + customerCache.rowCount + ") preserved");
    return { ok: false, error: e.message };
  }
}

function customersStale() {
  if (!customerCache.refreshedAt) return true;
  const ageMs = Date.now() - new Date(customerCache.refreshedAt).getTime();
  return ageMs > CUSTOMER_STALE_HOURS * 3600 * 1000;
}

function searchCustomers(query, limit) {
  const q = String(query || "").toLowerCase().trim();
  if (q.length < 2) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  const namePrefix = []; const nameSubstr = []; const codeMatch = [];
  for (const c of customerCache.customers) {
    const nameLower = c.name.toLowerCase();
    const codeLower = c.code.toLowerCase();
    if (nameLower.startsWith(q)) namePrefix.push(c);
    else if (nameLower.indexOf(q) !== -1) nameSubstr.push(c);
    else if (codeLower.indexOf(q) !== -1) codeMatch.push(c);
    if (namePrefix.length + nameSubstr.length + codeMatch.length >= lim * 3) break;
  }

  const sortByName = (a, b) => a.name.localeCompare(b.name);
  namePrefix.sort(sortByName); nameSubstr.sort(sortByName); codeMatch.sort(sortByName);

  const combined = namePrefix.concat(nameSubstr).concat(codeMatch).slice(0, lim);
  return combined.map(c => ({ code: c.code, name: c.name, city: c.city, state: c.state, zip: c.zip, onCreditHold: c.onCreditHold }));
}

function findCustomerByCode(code) {
  const target = String(code || "").trim().toLowerCase();
  return customerCache.customers.find(c => c.code.toLowerCase() === target) || null;
}

function startCustomerWatcher() {
  try {
    if (!fs.existsSync(CUSTOMER_CSV_PATH)) {
      console.log("  D-118: watcher NOT started (CSV path unreachable) — cron + on-demand still active");
      return;
    }
    customerWatcher = fs.watch(CUSTOMER_CSV_PATH, () => {
      if (customerWatchDebounce) clearTimeout(customerWatchDebounce);
      customerWatchDebounce = setTimeout(() => {
        refreshCustomers("fs.watch mtime change");
      }, CUSTOMER_WATCH_DEBOUNCE_MS);
    });
    console.log("  D-118: fs.watch active on " + CUSTOMER_CSV_PATH);
  } catch (e) {
    console.log("  D-118: fs.watch failed (" + e.message + ") — cron + on-demand still active");
  }
}

function scheduleCustomerCron() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CUSTOMER_REFRESH_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next.getTime() - now.getTime();
  customerCronTimer = setTimeout(() => {
    refreshCustomers("nightly 2 AM cron");
    scheduleCustomerCron();
  }, ms);
  console.log("  D-118: next cron refresh at " + next.toISOString());
}

function initCustomers() {
  const cachedDisk = readCacheFromDisk();
  if (cachedDisk && Array.isArray(cachedDisk.customers)) {
    customerCache = cachedDisk;
    console.log("  D-118: loaded " + cachedDisk.rowCount + " customers from cache (" + cachedDisk.refreshedAt + ")");
  } else {
    console.log("  D-118: no cache on disk; will refresh from CSV");
  }
  refreshCustomers("server start");
  startCustomerWatcher();
  scheduleCustomerCron();
}

// ═══ UTS API helpers ═══
function utsRequest(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.myuts.net", port: 443, path: "/v1" + path, method,
      headers: { "Authorization": UTS_AUTH, "Accept": "application/json", "Content-Type": "application/json" }
    };
    if (postData) options.headers["Content-Length"] = Buffer.byteLength(postData);
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 30000, () => { req.destroy(); reject(new Error("timeout")); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function utsRequestRetry(method, path, body) {
  // 30s + 45s timeouts. UTS /rateestimate polls multiple carriers and can legitimately
  // take 15-25s on a normal day. Tighter timeouts cause every quote to fail.
  try {
    return await utsRequest(method, path, body, 30000);
  } catch (e) {
    if (e.message === "timeout") {
      console.log("  UTS timeout on first attempt, retrying with 45s...");
      return await utsRequest(method, path, body, 45000);
    }
    throw e;
  }
}

async function discoverBillToID() {
  try {
    const r = await utsRequest("GET", "/location");
    if (r.status === 200 || r.status === 201) {
      const locs = Array.isArray(r.data) ? r.data : (r.data.locations || r.data.Locations || [r.data]);
      if (locs.length > 0) {
        const canton = locs.find(loc => loc.zip === "44704" || (loc.city && loc.city.toUpperCase().includes("CANTON")));
        const loc = canton || locs[0];
        UTS_BILL_TO_ID = loc.locationID || loc.id || loc.locationId || 0;
        console.log("  UTS Location: " + (loc.name || loc.city || "found") + " (billToID: " + UTS_BILL_TO_ID + ")");
        if (locs.length > 1) console.log("  (" + locs.length + " locations available)");
        return;
      }
    }
    if ((r.status === 200 || r.status === 201) && r.data && (r.data.locationID || r.data.id)) {
      UTS_BILL_TO_ID = r.data.locationID || r.data.id;
      console.log("  UTS Location ID: " + UTS_BILL_TO_ID);
      return;
    }
    console.log("  UTS Location lookup: " + r.status + " — " + JSON.stringify(r.data).substring(0, 200));
    console.log("  Using billToID=0 (may need manual configuration)");
  } catch (e) {
    console.log("  UTS Location lookup failed: " + e.message);
  }
}

async function utsRateEstimate(destZip, weightLbs, freightClass) {
  const body = {
    paymentType: "PREPAID",
    billToID: UTS_BILL_TO_ID,
    includeGuaranteedRates: false,
    origin: { locationID: UTS_BILL_TO_ID, zip: ORIGIN_ZIP },
    destination: { locationID: 0, zip: String(destZip) },
    feetOfTrailer: 0,
    lineItems: [{ weight: weightLbs, freightClass: String(freightClass || "70"), isStackable: true }]
  };
  const r = await utsRequestRetry("POST", "/rateestimate", body);
  if ((r.status === 200 || r.status === 201) && r.data.CarrierRates && r.data.CarrierRates.length > 0) {
    const rates = r.data.CarrierRates.filter(cr => cr.charges && cr.charges.totalAmount > 0);
    rates.sort((a, b) => (a.charges.totalAmount + (a.charges.fuelSurcharge || 0)) - (b.charges.totalAmount + (b.charges.fuelSurcharge || 0)));
    const best = rates[0];
    const carrierCost = best.charges.totalAmount + (best.charges.fuelSurcharge || 0);
    return {
      source: "uts", carrier: best.carrierName, transitDays: best.transitDays || 0,
      totalAmount: Math.round(carrierCost * 100) / 100, utsRaw: Math.round(carrierCost * 100) / 100,
      fuelSurcharge: Math.round((best.charges.fuelSurcharge || 0) * 100) / 100,
      estimateNumber: r.data.estimateNumber,
      allCarriers: rates.slice(0, 5).map(cr => ({ name: cr.carrierName, total: Math.round((cr.charges.totalAmount + (cr.charges.fuelSurcharge || 0)) * 100) / 100, transit: cr.transitDays, fuel: cr.charges.fuelSurcharge || 0 })),
      destination: r.data.destination
    };
  }
  throw new Error("UTS " + r.status + ": " + JSON.stringify(r.data).substring(0, 200));
}

// ═══ HTTP Server ═══
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const htmlFiles = fs.readdirSync(__dirname).filter(f => f.endsWith(".html"));
    const spotFile = htmlFiles.find(f => f.includes("SPOT") || f.includes("spot")) || htmlFiles[0];
    if (spotFile) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(fs.readFileSync(path.join(__dirname, spotFile), "utf8")); }
    else { res.writeHead(404); res.end("No SPOT HTML file found."); }
    return;
  }

  if (req.method === "POST" && req.url === "/api/freight") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { destZip, weightLbs, freightClass, trailerFeet } = JSON.parse(body);
        if (!destZip || !weightLbs) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "destZip and weightLbs required" })); return; }
        const spcRate = spcLocalRate(destZip, weightLbs, trailerFeet);
        if (spcRate) {
          console.log("SPCOC: " + ORIGIN_ZIP + " -> " + destZip + " (" + spcRate.zoneLabel + "), " + weightLbs + " lbs" + (trailerFeet ? ", " + trailerFeet + " ft" : "") + " = $" + spcRate.totalAmount);
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(spcRate)); return;
        }
        let result;
        try {
          result = await utsRateEstimate(destZip, weightLbs, freightClass || "70");
          console.log("UTS rate: " + ORIGIN_ZIP + " -> " + destZip + ", " + weightLbs + " lbs = $" + result.totalAmount + " via " + result.carrier);
        } catch (utsErr) {
          console.log("UTS error (" + utsErr.message.substring(0, 100) + "), using fallback for " + destZip);
          result = fallbackRate(destZip, weightLbs);
        }
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // ───── D-118: Customer endpoints ─────
  if (req.method === "GET" && req.url.startsWith("/customers/search")) {
    if (customerCache.rowCount === 0) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "customer database unavailable", refreshedAt: customerCache.refreshedAt }));
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const q = u.searchParams.get("q") || "";
    const limit = u.searchParams.get("limit");
    const results = searchCustomers(q, limit);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results));
    return;
  }

  if (req.method === "POST" && req.url === "/customers/refresh") {
    const result = refreshCustomers("on-demand POST");
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/customers/")) {
    const code = decodeURIComponent(req.url.replace("/customers/", "").split("?")[0]);
    if (!code) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "code required" })); return; }
    const cust = findCustomerByCode(code);
    if (!cust) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "not found" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    // ─── D-118 late additions: server-side terms normalization (adds quoteTerms field) ───
    res.end(JSON.stringify(normalizeCustomer(cust)));
    return;
  }

  // ───── D-120: Archive endpoints (Phase 1) ─────
  if (req.method === "POST" && req.url === "/archive/upload") {
    let body;
    try {
      body = await readRequestBuffer(req, MAX_FILE_BYTES * MAX_FILES_PER_DROP + 1024 * 1024);
    } catch (e) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request too large: " + e.message }));
      return;
    }
    const ctype = req.headers["content-type"] || "";
    const m = /boundary=("?)([^";]+)\1/.exec(ctype);
    if (!m) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "multipart/form-data with boundary required" }));
      return;
    }
    let parsed;
    try { parsed = parseMultipart(body, m[2]); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "multipart parse failed: " + e.message }));
      return;
    }
    const estNum = (parsed.fields.estNum || "").trim();
    const custName = (parsed.fields.custName || "").trim();
    const custCode = (parsed.fields.custCode || "").trim();
    if (!estNum || !EST_NUM_RX.test(estNum)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "valid estNum required (format SPC-YYMMDD-NNN)" }));
      return;
    }
    if (!custName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "custName required" }));
      return;
    }
    if (parsed.files.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no files in upload" }));
      return;
    }
    if (parsed.files.length > MAX_FILES_PER_DROP) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "max " + MAX_FILES_PER_DROP + " files per drop" }));
      return;
    }
    // Check archive root writable
    const health = archiveHealth();
    if (!health.exists || !health.writable) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "archive root unavailable", root: ARCHIVE_ROOT }));
      return;
    }
    // Build paths
    const year = String(new Date().getFullYear());
    const folderName = buildFolderName(custName, estNum);
    let quoteDir;
    try { quoteDir = ensureArchiveStructure(year, folderName); }
    catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder create failed: " + e.message }));
      return;
    }
    // Load or seed meta
    let meta = readMetaJson(quoteDir);
    if (!meta) meta = seedMeta(estNum, custName, custCode, folderName);
    else {
      // Refresh identity fields if changed (e.g., customer was renamed in ERP)
      meta.custName = custName;
      if (custCode) meta.custCode = custCode;
    }
    // D-140 (R1.6.4): sha256-based duplicate rejection. Build set of sha256s already on disk
    // for this folder + a per-batch set so two copies of the same file in one drop are also caught.
    // Existing meta.files[] may have entries without sha256 (pre-D-140 uploads); those are skipped
    // from the existing-set (legacy files cannot dedup against new ones until they're re-hashed).
    const existingSha = new Set();
    const existingShaToFilename = new Map();
    for (const ef of (meta.files || [])) {
      if (ef.sha256) {
        existingSha.add(ef.sha256);
        existingShaToFilename.set(ef.sha256, ef.filename || ef.originalName || "(unknown)");
      }
    }
    const batchSha = new Set();
    const accepted = [];
    const rejected = [];
    for (const f of parsed.files) {
      const orig = f.filename || "file";
      const ext = path.extname(orig).toLowerCase();
      if (EXEC_DENYLIST.has(ext)) {
        rejected.push({ originalName: orig, reason: "executable extension blocked (" + ext + ")" });
        continue;
      }
      if (f.data.length > MAX_FILE_BYTES) {
        rejected.push({ originalName: orig, reason: "file exceeds " + MAX_FILE_BYTES + " bytes" });
        continue;
      }
      // D-140: hash and check before write
      const sha = sha256OfBuffer(f.data);
      if (existingSha.has(sha)) {
        rejected.push({ originalName: orig, reason: "duplicate (sha256 matches existing file " + existingShaToFilename.get(sha) + " in folder)", sha256: sha });
        continue;
      }
      if (batchSha.has(sha)) {
        rejected.push({ originalName: orig, reason: "duplicate within this drop (sha256 already accepted earlier in batch)", sha256: sha });
        continue;
      }
      let diskName = normalizeFilename(orig);
      diskName = uniqueFilename(quoteDir, diskName);
      const fullPath = path.join(quoteDir, diskName);
      try {
        fs.writeFileSync(fullPath, f.data);
      } catch (e) {
        rejected.push({ originalName: orig, reason: "write failed: " + e.message });
        continue;
      }
      const entry = {
        filename: diskName,
        originalName: orig,
        size: f.data.length,
        mime: f.contentType || mimeForExt(ext),
        class: classifyFile(orig),
        uploadedAt: new Date().toISOString(),
        sha256: sha,
      };
      meta.files.push(entry);
      batchSha.add(sha);
      existingSha.add(sha);
      existingShaToFilename.set(sha, diskName);
      accepted.push(entry);
    }
    meta.updatedAt = new Date().toISOString();
    try { writeMetaJson(quoteDir, meta); }
    catch (e) {
      // Files are on disk; meta write failed. Log but return what we got.
      console.log("  D-120: meta write failed at " + quoteDir + " — " + e.message);
    }
    console.log("  D-120: upload " + folderName + " — " + accepted.length + " accepted, " + rejected.length + " rejected");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      folder: folderName,
      year: year,
      files: meta.files,
      accepted: accepted,
      rejected: rejected,
    }));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/archive/list")) {
    const u = new URL(req.url, "http://localhost");
    const folder = u.searchParams.get("folder") || "";
    const yearArg = u.searchParams.get("year");
    if (!folder) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder required" }));
      return;
    }
    // Search recent years if year not given (current + previous)
    const candidates = yearArg ? [yearArg] : [String(new Date().getFullYear()), String(new Date().getFullYear() - 1)];
    let found = null;
    for (const y of candidates) {
      const qd = archiveQuoteFolderPath(y, folder);
      if (fs.existsSync(qd)) {
        const meta = readMetaJson(qd);
        if (meta) { found = { year: y, meta: meta }; break; }
      }
    }
    if (!found) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ folder: folder, files: [], year: null, exists: false }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ folder: folder, year: found.year, exists: true, files: found.meta.files, meta: found.meta }));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/archive/file")) {
    const u = new URL(req.url, "http://localhost");
    const folder = u.searchParams.get("folder") || "";
    const filename = u.searchParams.get("filename") || "";
    const yearArg = u.searchParams.get("year");
    if (!folder || !filename) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder and filename required" }));
      return;
    }
    // Path traversal guard
    if (filename.indexOf("..") >= 0 || filename.indexOf("/") >= 0 || filename.indexOf("\\") >= 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid filename" }));
      return;
    }
    const candidates = yearArg ? [yearArg] : [String(new Date().getFullYear()), String(new Date().getFullYear() - 1)];
    let filePath = null;
    for (const y of candidates) {
      const fp = path.join(archiveQuoteFolderPath(y, folder), filename);
      if (fs.existsSync(fp)) { filePath = fp; break; }
    }
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      res.writeHead(200, {
        "Content-Type": mimeForExt(ext),
        "Content-Length": buf.length,
        "Content-Disposition": "inline; filename=\"" + filename.replace(/"/g, "") + "\"",
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "read failed: " + e.message }));
    }
    return;
  }

  if (req.method === "DELETE" && req.url.startsWith("/archive/file")) {
    const u = new URL(req.url, "http://localhost");
    const folder = u.searchParams.get("folder") || "";
    const filename = u.searchParams.get("filename") || "";
    const yearArg = u.searchParams.get("year");
    if (!folder || !filename) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder and filename required" }));
      return;
    }
    if (filename.indexOf("..") >= 0 || filename.indexOf("/") >= 0 || filename.indexOf("\\") >= 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid filename" }));
      return;
    }
    const candidates = yearArg ? [yearArg] : [String(new Date().getFullYear()), String(new Date().getFullYear() - 1)];
    let quoteDir = null, filePath = null;
    for (const y of candidates) {
      const qd = archiveQuoteFolderPath(y, folder);
      const fp = path.join(qd, filename);
      if (fs.existsSync(fp)) { quoteDir = qd; filePath = fp; break; }
    }
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    try { fs.unlinkSync(filePath); }
    catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "delete failed: " + e.message }));
      return;
    }
    // Update meta.json — remove this file's entry
    const meta = readMetaJson(quoteDir);
    if (meta) {
      meta.files = (meta.files || []).filter(f => f.filename !== filename);
      meta.updatedAt = new Date().toISOString();
      try { writeMetaJson(quoteDir, meta); } catch (e) { console.log("  D-120: meta write after delete failed: " + e.message); }
    }
    console.log("  D-120: delete " + folder + "/" + filename);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, folder: folder, filename: filename, files: meta ? meta.files : [] }));
    return;
  }

  if (req.method === "GET" && req.url === "/archive/health") {
    const h = archiveHealth();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(h));
    return;
  }

  // D-127 (R1.5.7.3): Bulk folder listing for Load Estimate modal paperclip badge.
  // Returns an array of every per-quote folder name that has a meta.json on disk,
  // across the current and previous year. Used to compute "this estimate has files"
  // membership lookups in O(1) on the client.
  if (req.method === "GET" && req.url.startsWith("/archive/folders")) {
    const u = new URL(req.url, "http://localhost");
    const yearArg = u.searchParams.get("year");
    const years = yearArg
      ? [yearArg]
      : [String(new Date().getFullYear()), String(new Date().getFullYear() - 1)];
    const folders = [];
    try {
      for (const y of years) {
        const yearDir = archiveYearFolderPath(y);
        if (!fs.existsSync(yearDir)) continue;
        let entries = [];
        try { entries = fs.readdirSync(yearDir); } catch (e) { continue; }
        for (const name of entries) {
          const dir = path.join(yearDir, name);
          let isDir = false;
          try { isDir = fs.statSync(dir).isDirectory(); } catch (e) { continue; }
          if (!isDir) continue;
          const metaPath = path.join(dir, "meta.json");
          if (!fs.existsSync(metaPath)) continue;
          // Only report folders that actually contain files. A folder with meta.json but
          // an empty meta.files array means the folder was seeded but no files landed —
          // we don't want the paperclip badge to lie about that.
          let fileCount = 0;
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
            fileCount = Array.isArray(meta.files) ? meta.files.length : 0;
          } catch (e) {
            // Bad meta.json — fall back to counting actual files in dir (excluding meta.json)
            try {
              fileCount = fs.readdirSync(dir).filter(fn => fn !== "meta.json").length;
            } catch (e2) { fileCount = 0; }
          }
          if (fileCount > 0) {
            folders.push({ folder: name, year: y, fileCount: fileCount });
          }
        }
      }
    } catch (e) {
      console.log("  D-127: /archive/folders walk failed: " + e.message);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ folders: folders, count: folders.length }));
    return;
  }

  // ═══ D-134 (R1.6.2) — POST /archive/rename ═══
  // Migrates a quote folder when parser auto-resolves the customer name.
  // Body: { fromFolder, toFolder, custName, custCode?, year? }
  // - 200 + folder/files on success
  // - 404 if fromFolder doesn't exist on disk (e.g. drop happened but no files were ever written;
  //        client tolerates 404 silently — nothing to migrate)
  // - 409 if toFolder already exists (refuses to clobber; client toasts and continues)
  // - 503 if archive root is unwritable
  // - 400 on validation failure
  // Reuses buildFolderName / archiveQuoteFolderPath / readMetaJson / writeMetaJson helpers.
  if (req.method === "POST" && req.url === "/archive/rename") {
    let body;
    try {
      body = await readRequestBuffer(req, 16 * 1024);
    } catch (e) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request too large" }));
      return;
    }
    let payload;
    try { payload = JSON.parse(body.toString("utf8") || "{}"); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json: " + e.message }));
      return;
    }
    const fromFolder = String(payload.fromFolder || "").trim();
    const toFolder = String(payload.toFolder || "").trim();
    const custName = String(payload.custName || "").trim();
    const custCode = String(payload.custCode || "").trim();
    const year = String(payload.year || new Date().getFullYear());
    // Validate inputs. Folder names must be non-empty and free of path separators / nulls.
    if (!fromFolder || !toFolder) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fromFolder and toFolder required" }));
      return;
    }
    if (fromFolder === toFolder) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fromFolder and toFolder must differ" }));
      return;
    }
    if (/[\/\\\0]/.test(fromFolder) || /[\/\\\0]/.test(toFolder)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder names may not contain path separators" }));
      return;
    }
    if (!/^\d{4}$/.test(year)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "year must be 4-digit" }));
      return;
    }
    if (!custName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "custName required (for meta.json update)" }));
      return;
    }
    // Check archive root health
    const health = archiveHealth();
    if (!health.exists || !health.writable) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "archive root unavailable", root: ARCHIVE_ROOT }));
      return;
    }
    const fromPath = archiveQuoteFolderPath(year, fromFolder);
    const toPath = archiveQuoteFolderPath(year, toFolder);
    if (!fs.existsSync(fromPath)) {
      // Nothing to migrate. Client should treat 404 as benign no-op.
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "source folder does not exist", fromFolder: fromFolder, year: year }));
      return;
    }
    if (fs.existsSync(toPath)) {
      // Refuse to clobber existing folder. Operator must reconcile manually.
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "target folder already exists", toFolder: toFolder, year: year }));
      return;
    }
    // Ensure year directory exists (matches /archive/upload pattern)
    try { fs.mkdirSync(archiveYearFolderPath(year), { recursive: true }); }
    catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "year folder create failed: " + e.message }));
      return;
    }
    // Atomic rename. Filesystem-level operation; preserves all files + meta.json by default.
    try { fs.renameSync(fromPath, toPath); }
    catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rename failed: " + e.message, fromFolder: fromFolder, toFolder: toFolder }));
      return;
    }
    // Update meta.json identity fields. If meta is missing or unreadable, seed a fresh one
    // (defensive — meta.json should exist post-/archive/upload, but a missing/corrupt file
    // shouldn't fail the rename since the files have already moved).
    let meta = readMetaJson(toPath);
    if (!meta) {
      // Re-derive estNum from the new folder name (everything after the LAST underscore).
      const lastUs = toFolder.lastIndexOf("_");
      const derivedEstNum = lastUs >= 0 ? toFolder.substring(lastUs + 1) : toFolder;
      meta = seedMeta(derivedEstNum, custName, custCode, toFolder);
      // List files now in the renamed folder (best-effort; preserves disk truth).
      try {
        const entries = fs.readdirSync(toPath).filter(n => n !== "meta.json");
        for (const fname of entries) {
          try {
            const full = path.join(toPath, fname);
            const stat = fs.statSync(full);
            if (stat.isFile()) {
              meta.files.push({
                filename: fname,
                originalName: fname,
                size: stat.size,
                mime: mimeForExt(path.extname(fname).toLowerCase()),
                class: classifyFile(fname),
                uploadedAt: stat.mtime.toISOString(),
                sha256: sha256OfBuffer(fs.readFileSync(full)),
              });
            }
          } catch (e) { /* skip unreadable file */ }
        }
      } catch (e) { /* dir read failed; ship empty files[] */ }
    } else {
      // Update identity fields; keep files[] / createdAt / phase1 / etc untouched.
      meta.custName = custName;
      if (custCode) meta.custCode = custCode;
      meta.folderName = toFolder;
      // Re-derive estNum from new folder name in case operator edited estNum prior to rename.
      const lastUs = toFolder.lastIndexOf("_");
      if (lastUs >= 0) meta.estNum = toFolder.substring(lastUs + 1);
    }
    meta.updatedAt = new Date().toISOString();
    try { writeMetaJson(toPath, meta); }
    catch (e) {
      // Files have already moved; meta write failed. Log and return what we got.
      console.log("  D-134: meta write failed at " + toPath + " — " + e.message);
    }
    console.log("  D-134: rename " + fromFolder + " → " + toFolder + " (" + meta.files.length + " files)");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      fromFolder: fromFolder,
      toFolder: toFolder,
      year: year,
      files: meta.files,
      fileCount: meta.files.length,
    }));
    return;
  }

  // ═══ D-129 Phase 1B — Parser endpoints ═══

  // GET /est/parser-budget — current month spend + cap. Used by JSX badge in Files panel.
  // D-141 (R1.6.4): respect ?clientKeyPresent=1 query param. JSX poller sets this when any
  // wf_anthropic_key_* exists in localStorage. When set and no server-side key is loaded, the
  // response reports `configured: true` + `keySource: "client (browser)"` because parses WILL
  // succeed via the body.apiKey fallback path. Pre-D-141 the endpoint reported configured:false
  // whenever the server-side key was absent, which lied to the JSX badge whenever a working
  // browser key was in play.
  if (req.method === "GET" && req.url.startsWith("/est/parser-budget")) {
    const b = readBudget();
    const u = new URL(req.url, "http://localhost");
    const clientKeyPresent = u.searchParams.get("clientKeyPresent") === "1";
    const serverKeyState = anthropicKeyState.key ? anthropicKeyState : reloadAnthropicKey();
    const effectiveConfigured = !!serverKeyState.key || clientKeyPresent;
    const effectiveKeySource = serverKeyState.key
      ? serverKeyState.source
      : (clientKeyPresent ? "client (browser)" : (serverKeyState.source || "(none)"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ...b,
      configured: effectiveConfigured,
      keySource: effectiveKeySource,
      serverKeyConfigured: !!serverKeyState.key,
      clientKeyPresent: clientKeyPresent,
      model: ANTHROPIC_MODEL,
      remainingUsd: Math.max(0, b.cap - b.monthlySpendUsd),
      pctUsed: b.cap > 0 ? Math.round((b.monthlySpendUsd / b.cap) * 100) : 0,
    }));
    return;
  }

  // POST /est/parse-rfq — parse RFQ-class files in a folder. Body: {folder, filenames?, year?}
  // If filenames is omitted, parses ALL rfq-class files in the folder.
  // Sends them all in one Anthropic call with shared context across files.
  if (req.method === "POST" && req.url.startsWith("/est/parse-rfq")) {
    let body;
    try {
      body = await readRequestBuffer(req, 64 * 1024);
    } catch (e) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request too large" }));
      return;
    }
    let req_;
    try { req_ = JSON.parse(body.toString("utf8")); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    const folder = (req_.folder || "").trim();
    const requestedFilenames = Array.isArray(req_.filenames) ? req_.filenames.map(s => String(s).trim()).filter(Boolean) : null;
    const year = (req_.year || "").trim() || String(new Date().getFullYear());
    if (!folder) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder required" }));
      return;
    }
    const yearDir = archiveYearFolderPath(year);
    const quoteDir = path.join(yearDir, folder);
    const resolved = path.resolve(quoteDir);
    if (!resolved.startsWith(path.resolve(ARCHIVE_ROOT))) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path outside archive root" }));
      return;
    }
    if (!fs.existsSync(quoteDir)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "folder not found: " + folder }));
      return;
    }

    // Resolve which files to parse: explicit list or all RFQ-class files in the folder
    const meta = readMetaJson(quoteDir) || { files: [] };
    let toParse = [];
    if (requestedFilenames && requestedFilenames.length > 0) {
      for (const fn of requestedFilenames) {
        const fileEntry = (meta.files || []).find(f => f.filename === fn);
        if (!fileEntry) continue; // silently skip missing entries
        const fp = path.join(quoteDir, fn);
        if (!fs.existsSync(fp)) continue;
        toParse.push({
          filename: fn,
          filePath: fp,
          ext: path.extname(fn).toLowerCase(),
          mime: fileEntry.mime || mimeForExt(path.extname(fn).toLowerCase()),
          originalName: fileEntry.originalName || fn,
        });
      }
    } else {
      for (const fileEntry of (meta.files || [])) {
        if (fileEntry.class !== "rfq") continue;
        const fp = path.join(quoteDir, fileEntry.filename);
        if (!fs.existsSync(fp)) continue;
        toParse.push({
          filename: fileEntry.filename,
          filePath: fp,
          ext: path.extname(fileEntry.filename).toLowerCase(),
          mime: fileEntry.mime || mimeForExt(path.extname(fileEntry.filename).toLowerCase()),
          originalName: fileEntry.originalName || fileEntry.filename,
        });
      }
    }
    if (toParse.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no RFQ-class files in folder to parse" }));
      return;
    }

    // Cached parse: if all requested files were already parsed in the last call, return cached
    const u = new URL(req.url, "http://localhost");
    const force = u.searchParams.get("force") === "true";
    const cachedPath = path.join(quoteDir, "parser_output.json");
    if (!force && fs.existsSync(cachedPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachedPath, "utf8"));
        const cachedNames = (cached.sourceFiles || []).sort().join(",");
        const requestedNames = toParse.map(f => f.filename).sort().join(",");
        if (cachedNames === requestedNames && cached.parsedAt) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...cached, cached: true }));
          return;
        }
      } catch (e) { /* fall through */ }
    }

    // Fresh parse — single API call with all files
    // R1.5.10 — pass through optional client-side API key from request body (per-customer override)
    const startedAt = Date.now();
    let apiResp;
    try {
      apiResp = await anthropicParseRfqBatch(toParse, req_.apiKey);
    } catch (e) {
      const status = e.code === "NO_KEY" ? 503 :
                     e.code === "CAP_REACHED" ? 429 :
                     e.code === "PREFLIGHT_OVER_LIMIT" ? 413 :
                     e.code === "API_ERROR" ? 502 : 500;
      console.log("  D-129: batch parse failed for " + folder + " (" + toParse.length + " files) — " + e.message);
      const errBody = { error: e.message, code: e.code || "UNKNOWN" };
      if (e.code === "PREFLIGHT_OVER_LIMIT") {
        errBody.estimatedTokens = e.estimatedTokens;
        errBody.threshold = e.threshold;
        errBody.tpmCap = e.tpmCap;
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(errBody));
      return;
    }
    const elapsedMs = Date.now() - startedAt;

    // Extract JSON from response
    let parsedJson = null;
    let rawText = "";
    try {
      const blocks = apiResp.content || [];
      for (const block of blocks) {
        if (block.type === "text") rawText += block.text;
      }
      let candidate = rawText.trim();
      if (candidate.startsWith("```")) {
        const fenceEnd = candidate.indexOf("\n");
        candidate = candidate.substring(fenceEnd + 1);
        const closingFence = candidate.lastIndexOf("```");
        if (closingFence > -1) candidate = candidate.substring(0, closingFence);
        candidate = candidate.trim();
      }
      parsedJson = JSON.parse(candidate);
    } catch (e) {
      console.log("  D-129: failed to parse batch response as JSON: " + e.message);
      parsedJson = {
        parsed: {},
        asks: [{ field: "_raw_response", reason: "model returned non-JSON: " + rawText.substring(0, 500) }],
        confidence: 0
      };
    }

    // Cost & budget
    const usage = apiResp.usage || {};
    const costUsd = calcCallCostUsd(ANTHROPIC_MODEL, usage);
    const budget = readBudget();
    budget.monthlySpendUsd = Math.round((budget.monthlySpendUsd + costUsd) * 10000) / 10000;
    budget.callCount = (budget.callCount || 0) + 1;
    budget.lastCall = new Date().toISOString();
    writeBudget(budget);

    const output = {
      parsed: parsedJson.parsed || {},
      asks: parsedJson.asks || [],
      confidence: typeof parsedJson.confidence === "number" ? parsedJson.confidence : null,
      parsedAt: new Date().toISOString(),
      costUsd: costUsd,
      model: ANTHROPIC_MODEL,
      elapsedMs: elapsedMs,
      tokensIn: usage.input_tokens || 0,
      tokensOut: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheWriteTokens: usage.cache_creation_input_tokens || 0,
      sourceFiles: toParse.map(f => f.filename),
      sourceFileCount: toParse.length,
      sourceFolder: folder,
    };
    try {
      fs.writeFileSync(path.join(quoteDir, "parser_output.json"), JSON.stringify(output, null, 2));
    } catch (e) { console.log("  D-129: parser_output write failed: " + e.message); }

    // Stamp every parsed file's meta entry
    for (const f of toParse) {
      const fileEntry = (meta.files || []).find(x => x.filename === f.filename);
      if (fileEntry) {
        fileEntry.parsedAt = output.parsedAt;
        fileEntry.parserCostUsd = Math.round((costUsd / toParse.length) * 10000) / 10000;
        fileEntry.parserModel = ANTHROPIC_MODEL;
      }
    }
    try { writeMetaJson(quoteDir, meta); } catch (e) { /* ignore */ }

    console.log("  D-129: batch-parsed " + folder + " (" + toParse.length + " files) in " + elapsedMs + "ms, $" + costUsd.toFixed(4) + ", confidence=" + (output.confidence !== null ? output.confidence.toFixed(2) : "n/a"));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...output, cached: false }));
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /est/validate-parsed — D-136 (R1.6.3) Layer-2 computational backstop
  // ═══════════════════════════════════════════════════════════════════════════
  // Body: { proposed_json: { ... full SPOT intake JSON ... } }
  // Wraps spot_runner.runEstimate to run the actual SPOT engine on the proposed
  // JSON BEFORE the parser returns. Returns cost summary, route eligibility check,
  // violations[] (errors that should re-prompt the parser to self-correct), and
  // guardrails[] (toggle states the parser should know about — FSC, Buy Min, etc.).
  //
  // Per Michael 2026-05-01: "I want my SPOT logic in the parser otherwise I CAN'T
  // USE IT." This endpoint IS that SPOT logic — running the same calc pipeline the
  // app uses, server-side, against parsed JSON. Layer 1 (knowledge injection) makes
  // the parser knowledgeable; Layer 2 (this endpoint) makes the parser verifiable.
  //
  // Caller pattern: parser drafts JSON → POSTs to /est/validate-parsed → on
  // violations re-drafts; on guardrails annotates fields with WATCH flags; returns
  // validated output to the client.
  if (req.method === "POST" && req.url === "/est/validate-parsed") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      let req_;
      try { req_ = JSON.parse(body); } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      const proposed = req_.proposed_json;
      if (!proposed || typeof proposed !== "object") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing proposed_json" }));
        return;
      }

      // Lazy-load spot_runner. If unavailable, fall back to schema-only validation
      // (still useful — catches route eligibility and guardrail issues without engine math).
      let runner = null;
      try {
        runner = require("./spot_runner.js");
      } catch (e) {
        console.log("  D-136: spot_runner.js not loadable (" + e.message + ") — schema-only validation");
      }

      const violations = [];
      const guardrails = [];
      const cost_summary = { ok: false, perSlot: [], engine_ran: false };

      // ─── Schema-level checks (always run, no engine needed) ───
      const flute = (proposed.flute || "").toUpperCase();
      const boardGrade = String(proposed.boardGrade || "");

      // Check rule violations from EMBEDDED_QUOTING_RULES
      if (proposed.routeOverride !== undefined && proposed.routeOverride !== null && proposed.routeOverride !== "") {
        violations.push({ level: "error", field: "routeOverride", msg: "routeOverride MUST be omitted (Rule 1). Auto-route only." });
      }
      if (proposed.estInitials && proposed.estInitials !== "SPC") {
        violations.push({ level: "error", field: "estInitials", msg: "estInitials MUST be \"SPC\" (Rule 2). Got: " + proposed.estInitials });
      }
      if (proposed.under5MsfFee !== undefined && String(proposed.under5MsfFee) !== "0") {
        violations.push({ level: "error", field: "under5MsfFee", msg: "under5MsfFee MUST be \"0\" (Rule 3). Got: " + proposed.under5MsfFee });
      }
      if (proposed.printMode === "Gloss" && (!proposed.printReq || proposed.printReq === "Yes")) {
        // Gloss is valid when customer requests it, but flag for review
        guardrails.push({ field: "printMode", state: "Gloss", note: "Default is Satin (Rule 8). Verify customer explicitly asked for Gloss." });
      }
      if (proposed.fobMode && proposed.fobMode !== "Origin" && proposed.fobMode !== "Destination") {
        violations.push({ level: "warn", field: "fobMode", msg: "fobMode should be \"Origin\" or \"Destination\". Got: " + proposed.fobMode });
      }

      // ─── Route eligibility (Bobst hard-block on B/C flute) ───
      const flutesEligibleForBobst = ["E", "F"];
      if (flute && !flutesEligibleForBobst.includes(flute)) {
        // If the parser hinted at Bobst routing anywhere, flag it
        const proposedRoute = String(proposed.preferredRoute || proposed.routeHint || "").toLowerCase();
        if (proposedRoute.includes("bobst")) {
          violations.push({ level: "error", field: "flute/route", msg: "Bobst route hinted but flute " + flute + " is not Bobst-eligible (E or F only). Drop the route hint or change flute." });
        }
      }

      // ─── Board grade validity ───
      const validSinglewall = ["200", "ECT 32", "ECT 44", "ECT 48", "ECT 55", "ECT 61", "ECT 71", "ECT 82"];
      const validDoublewall = ["ECT 42", "ECT 48", "ECT 51", "ECT 61", "ECT 71", "ECT 82"];
      const allValidGrades = new Set([...validSinglewall, ...validDoublewall]);
      if (boardGrade && !allValidGrades.has(boardGrade)) {
        violations.push({ level: "warn", field: "boardGrade", msg: "boardGrade '" + boardGrade + "' is not in the SPOT library. Valid singlewall: " + validSinglewall.join(", ") + ". Valid doublewall: " + validDoublewall.join(", ") + ". SPOT will substitute DOWN to nearest Mullen-equivalent stock sheet." });
      }

      // ─── ECT 44 manual-substitute reminder ───
      if (boardGrade === "ECT 44") {
        guardrails.push({ field: "boardGrade", state: "ECT 44", note: "ECT 44 is uncommon at SPC. Substitutes DOWN to Mullen 200# stock; mill check is manual (DEV-011)." });
      }

      // ─── FSC + paper uplift state (always-on signals) ───
      guardrails.push({ field: "fscFee", state: String(proposed.fscFee || "25.00"), note: "FSC/SFI $25 amortized into board (D-086). Migration $15 → $25 fires on load." });
      guardrails.push({ field: "paperUplift", state: "+10% in engine.base_matrix", note: "Paper uplift is BAKED IN (D-102). Do NOT add a separate paper-cost field." });

      // ─── Engine math (if runner is available) ───
      if (runner && typeof runner.runEstimate === "function") {
        try {
          const qtys = Array.isArray(proposed.qtys) ? proposed.qtys : [];
          for (let slot = 0; slot < qtys.length; slot++) {
            const qty = parseInt(qtys[slot], 10);
            if (!qty || qty <= 0) continue;
            try {
              const r = runner.runEstimate(proposed, slot);
              cost_summary.perSlot.push({
                slot, qty,
                sellPerPc: r.sellPerPc,
                gmPct: r.gmPct,
                totalCost: r.totalCost,
                totalSell: r.totalSell,
                route: (r.routing && r.routing.route) || null,
                msf: r.oMSF || null,
              });
            } catch (slotErr) {
              violations.push({ level: "warn", field: "qtys[" + slot + "]", msg: "Engine threw for qty " + qty + ": " + slotErr.message });
            }
          }
          cost_summary.engine_ran = true;
          cost_summary.ok = cost_summary.perSlot.length > 0;
        } catch (e) {
          violations.push({ level: "warn", field: "engine", msg: "Engine load/run failed: " + e.message + " — schema-only validation returned." });
        }
      } else {
        violations.push({ level: "info", field: "engine", msg: "spot_runner.js not loaded — engine math skipped, schema-only checks returned." });
      }

      // ─── Build response ───
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: violations.filter(v => v.level === "error").length === 0,
        cost_summary,
        violations,
        guardrails,
        engine_available: !!(runner && typeof runner.runEstimate === "function"),
      }));
    });
    return;
  }

  // POST /est/reload-key — reload the API key from disk (after user creates/edits .env)
  if (req.method === "POST" && req.url === "/est/reload-key") {
    const state = reloadAnthropicKey();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      configured: !!state.key,
      source: state.source,
    }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    const arch = archiveHealth();
    const budget = readBudget();
    const keyState = anthropicKeyState.key ? anthropicKeyState : reloadAnthropicKey();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok", version: "R1.6.5",
      uts: "configured", billToID: UTS_BILL_TO_ID, origin: ORIGIN_ZIP,
      customersLoaded: customerCache.rowCount,
      customersRefreshedAt: customerCache.refreshedAt,
      customersSourceMtime: customerCache.sourceMtime,
      customersStale: customersStale(),
      customersSourcePath: CUSTOMER_CSV_PATH,
      archiveRoot: arch.root,
      archiveExists: arch.exists,
      archiveWritable: arch.writable,
      archiveFolderCount: arch.folderCount,
      parserConfigured: !!keyState.key,
      parserKeySource: keyState.source,
      parserModel: ANTHROPIC_MODEL,
      parserMonthlySpendUsd: budget.monthlySpendUsd,
      parserCap: budget.cap,
    }));
    return;
  }

  res.writeHead(404); res.end("Not Found");
});

// ═══ Start ═══
// ─── D-118 late additions: listen-first boot ───
// Bind the port BEFORE async work (UTS bill-to discovery, customer CSV load) so /api/health
// responds immediately even if a network mount is slow or unreachable. Async init logs to
// stdout in the background; failures don't block server availability.
server.listen(PORT, () => {
  console.log("\n  SPOT R1.6.5 Server running at http://localhost:" + PORT);
  console.log("  UTS API: configured (" + UTS_USER + ")");
  console.log("  Origin: " + ORIGIN_ZIP + " (Canton, OH)");
  console.log("  Freight: POST /api/freight { destZip, weightLbs, freightClass, trailerFeet? }");
  console.log("  Customers: GET /customers/search?q=&limit=, GET /customers/:code, POST /customers/refresh");
  console.log("  Archive:   POST /archive/upload (multipart), GET /archive/list?folder=, GET /archive/folders, GET/DELETE /archive/file?folder=&filename=");
  console.log("  Archive root: " + ARCHIVE_ROOT);
  // D-129 parser status
  const _ks = anthropicKeyState.key ? anthropicKeyState : reloadAnthropicKey();
  if (_ks.key) {
    const _b = readBudget();
    console.log("  Parser:    POST /est/parse-rfq, GET /est/parser-budget, POST /est/reload-key, POST /est/validate-parsed");
    console.log("  Parser API: configured (" + _ks.source + "), model=" + ANTHROPIC_MODEL + ", spent $" + _b.monthlySpendUsd.toFixed(2) + " of $" + _b.cap.toFixed(2) + " this month");
    // D-136 (R1.6.3) knowledge injection state
    const _kbSize = (SYSTEM_PROMPT_DOCS && SYSTEM_PROMPT_DOCS.length) || 0;
    const _kbState = _kbSize > 0 ? "prompts/ + embedded fallback" : "embedded fallback only (prompts/ empty)";
    console.log("  Knowledge: " + _kbState + " (" + _kbSize + " char prompts/ + " + EMBEDDED_KNOWLEDGE.length + " char embedded + customer registry from cache)");
  } else {
    console.log("  Parser:    not configured (drop a key into .env or anthropic_key.txt to enable RFQ auto-parsing)");
  }
  // Async init — fire-and-forget; server stays responsive throughout
  (async () => {
    try { await discoverBillToID(); } catch (e) { console.log("  UTS bill-to discovery failed (non-fatal): " + e.message); }
    initCustomers();
    // D-120: ensure archive root exists; non-fatal if not (endpoints return 503)
    try {
      if (!fs.existsSync(ARCHIVE_ROOT)) fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
      console.log("  D-120: archive root ready at " + ARCHIVE_ROOT);
    } catch (e) {
      console.log("  D-120: archive root unavailable (" + e.message + ") — uploads will return 503");
    }
    console.log("");
  })();
});

