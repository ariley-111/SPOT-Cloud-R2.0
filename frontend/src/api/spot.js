/* eslint-disable */
import api from "./client";

// ─── Auth ───────────────────────────────────────────────
export const authLogin = (email, password) =>
  api.post("/auth/login", { email, password }).then((r) => r.data);

export const authMe = () => api.get("/auth/me").then((r) => r.data);

export const authConfig = () => api.get("/auth/config").then((r) => r.data);

export const seedAdmin = () =>
  api.post("/auth/seed-admin").then((r) => r.data);

// ─── Customers ──────────────────────────────────────────
export const searchCustomers = (q, limit = 20) =>
  api.get("/customers/search", { params: { q, limit } }).then((r) => r.data);

export const getCustomer = (code) =>
  api.get(`/customers/${encodeURIComponent(code)}`).then((r) => r.data);

// ─── Engine ─────────────────────────────────────────────
export const calculateSlot = (payload, slotIndex = 0) =>
  api
    .post("/engine/calculate", payload, { params: { slot_index: slotIndex } })
    .then((r) => r.data);

export const calculateAll = (payload) =>
  api.post("/engine/calculate-all", payload).then((r) => r.data);

// MP-2: Multi-Part — orchestrates per-component pricing + Matched Set / Individual aggregation.
// Body shape: full active state including bomItems[], pricingMode, setMarginPct, etc.
export const calculateMultiPart = (payload) =>
  api.post("/engine/calculate-multi-part", payload).then((r) => r.data);

// ─── Pricing Admin Console (admin only) ────────────────────────────────
export const adminGetRates       = () => api.get("/admin/rates").then((r) => r.data);
export const adminGetCategories  = () => api.get("/admin/rates/categories").then((r) => r.data);
export const adminGetCalibration = () => api.get("/admin/rates/calibration").then((r) => r.data);
export const adminSetRate        = (cat, key, value) =>
  api.put(`/admin/rates/${cat}/${encodeURIComponent(key)}`, { value }).then((r) => r.data);
export const adminResetRate      = (cat, key) =>
  api.delete(`/admin/rates/${cat}/${encodeURIComponent(key)}`).then((r) => r.data);
export const adminResetAll       = (category) =>
  api.post(`/admin/rates/reset-all${category ? `?category=${category}` : ""}`).then((r) => r.data);
export const adminGetAudit       = (params = {}) =>
  api.get("/admin/rates/audit", { params }).then((r) => r.data);

// ─── Integrations admin (Phase 4-A2) ───────────────────────────────────
export const adminGetIntegrations   = () => api.get("/admin/integrations").then((r) => r.data);
export const adminSetIntegration    = (key, value) =>
  api.put(`/admin/integrations/${encodeURIComponent(key)}`, { value }).then((r) => r.data);
export const adminResetIntegration  = (key) =>
  api.delete(`/admin/integrations/${encodeURIComponent(key)}`).then((r) => r.data);
export const adminGetUsage          = (params = {}) =>
  api.get("/admin/usage", { params }).then((r) => r.data);

// ─── Sheet Library admin ───────────────────────────────────────────────
export const adminGetSheets    = () => api.get("/admin/sheets").then((r) => r.data);
export const adminAddSheet     = (body) => api.post("/admin/sheets", body).then((r) => r.data);
export const adminEditSheet    = (id, body) =>
  api.put(`/admin/sheets/${encodeURIComponent(id)}`, body).then((r) => r.data);
export const adminDisableSheet = (id, reason) =>
  api.delete(`/admin/sheets/${encodeURIComponent(id)}`,
    { params: reason ? { reason } : {} }).then((r) => r.data);
export const adminEnableSheet  = (id) =>
  api.post(`/admin/sheets/${encodeURIComponent(id)}/enable`).then((r) => r.data);
export const adminExportSheetsCsv = () =>
  api.get("/admin/sheets/csv", { responseType: "text" }).then((r) => r.data);
export const adminImportSheetsCsv = (file, reason) => {
  const fd = new FormData();
  fd.append("file", file);
  if (reason) fd.append("reason", reason);
  return api.post("/admin/sheets/csv", fd,
    { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};

export const engineDefaults = () =>
  api.get("/engine/defaults").then((r) => r.data);

// ─── Admin: Board Pricing Versions (import / diff / activate) ───────────
export const adminPricingVersions = () =>
  api.get("/admin/pricing/versions").then((r) => r.data);
export const adminPricingGetVersion = (id) =>
  api.get(`/admin/pricing/versions/${encodeURIComponent(id)}`).then((r) => r.data);
export const adminPricingImport = (file, { sheet, label, notes } = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  if (sheet) fd.append("sheet", sheet);
  if (label) fd.append("label", label);
  if (notes) fd.append("notes", notes);
  return api.post("/admin/pricing/import", fd,
    { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};
export const adminPricingActivate = (id) =>
  api.post(`/admin/pricing/versions/${encodeURIComponent(id)}/activate`).then((r) => r.data);
export const adminPricingDeleteDraft = (id) =>
  api.delete(`/admin/pricing/versions/${encodeURIComponent(id)}`).then((r) => r.data);


// Full Board Engine reference data — base matrix, liner/medium upgrades, flute
// rules, dim adders, fixed charges, approved sheet specs. Drives the Board
// Engine viewer panel (Placeholders.jsx → BoardEngineSec). Matches the data
// shape legacy spot_r1_5.jsx L6606-6758 renders from its ENGINE constant.
export const engineManifest = () =>
  api.get("/engine/manifest").then((r) => r.data);

// Returns {outside: [liner names], inside: [liner names]} that have approved
// stock sheets for the given board grade/flute/medium. Used by liner-tile
// stock-availability dots (legacy spot_r1_5.jsx L5983).
export const sheetAvailability = ({ boardGrade, flute, medium = "None" }) =>
  api.get("/engine/sheet-availability", {
    params: { boardGrade, flute, medium },
  }).then((r) => r.data);

// Stock-availability per board grade for the given flute/medium. Returns
// {stocked: [...], viaFallback: [...ECT grades whose Mullen-equiv IS stocked]}.
export const gradeAvailability = ({ flute, medium = "None" }) =>
  api.get("/engine/grade-availability", {
    params: { flute, medium },
  }).then((r) => r.data);

// D-090: side-by-side CAD/Crest/Bobst comparison for one qty. Used by the
// RouteComparison panel.
export const compareRoutes = (payload) =>
  api.post("/engine/compare-routes", payload).then((r) => r.data);

// ─── Drafts ────────────────────────────────────────────
export const listDrafts = () =>
  api.get("/drafts").then((r) => r.data);
export const createDraft = (body) =>
  api.post("/drafts", body).then((r) => r.data);
export const updateDraft = (id, body) =>
  api.put(`/drafts/${id}`, body).then((r) => r.data);
export const deleteDraft = (id) =>
  api.delete(`/drafts/${id}`).then((r) => r.data);
export const deleteAllDrafts = () =>
  api.delete(`/drafts`).then((r) => r.data);

// ─── Quotes ─────────────────────────────────────────────
export const listQuotes = (params = {}) =>
  api.get("/quotes", { params: { limit: 100, scope: "mine", ...params } }).then((r) => r.data);
export const listQuoteOwners = () =>
  api.get("/quotes/_meta/owners").then((r) => r.data);
export const createQuote = (body) =>
  api.post("/quotes", body).then((r) => r.data);
export const getQuote = (id) =>
  api.get(`/quotes/${id}`).then((r) => r.data);
export const updateQuote = (id, body) =>
  api.put(`/quotes/${id}`, body).then((r) => r.data);
export const takeOverQuote = (id, reason) =>
  api.post(`/quotes/${id}/take-over`, { reason: reason || null }).then((r) => r.data);
export const copyQuote = (id) =>
  api.post(`/quotes/${id}/copy`).then((r) => r.data);
export const updateQuoteStatus = (id, status) =>
  api.patch(`/quotes/${id}/status`, { status }).then((r) => r.data);
export const listQuoteAudit = (quoteId) =>
  api.get("/admin/audit/quotes", { params: quoteId ? { quote_id: quoteId } : {} }).then((r) => r.data);

// ─── Freight ────────────────────────────────────────────
export const freightQuote = (body) =>
  api.post("/freight/quote", body).then((r) => r.data);

// Batch freight quoting — server serializes UTS calls behind asyncio.Lock so
// the client sees ONE long-running request instead of N parallel ones (avoids
// 60s axios timeout when N gets above ~6 quotes).
export const freightQuoteBatch = (items) =>
  api.post("/freight/quote-batch", { items }, { timeout: 240000 }).then((r) => r.data);
export const freightZones = () =>
  api.get("/freight/zones").then((r) => r.data);

// ─── Parser ─────────────────────────────────────────────
export const parserBudget = () =>
  api.get("/parser/budget").then((r) => r.data);
export const parseRfq = (files, emailBody, notes, opts = {}) => {
  const fd = new FormData();
  for (const f of files || []) fd.append("files", f);
  if (emailBody) fd.append("email_body", emailBody);
  if (notes) fd.append("notes", notes);
  // Usage-tracking context (admin Usage tab queries by these)
  if (opts.customerCode) fd.append("customer_code", opts.customerCode);
  if (opts.customerName) fd.append("customer_name", opts.customerName);
  if (opts.estInitials)  fd.append("est_initials",  opts.estInitials);
  if (opts.quoteId)      fd.append("quote_id",      opts.quoteId);
  return api
    .post("/parser/parse-rfq", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180000,
    })
    .then((r) => r.data);
};

export const sheetLibraryPriced = (body) =>
  api.post("/engine/sheet-library", body).then((r) => r.data);

// ─── Saved RFQ files (quote-lifetime persistence) ───────
export const listParserFiles = (quoteId) =>
  api.get(`/parser/files?quote_id=${encodeURIComponent(quoteId)}`).then((r) => r.data.files || []);
// Attach files to a quote for reference WITHOUT running the parser.
export const uploadParserFiles = (files, quoteId) => {
  const fd = new FormData();
  for (const f of files || []) fd.append("files", f);
  fd.append("quote_id", quoteId);
  return api.post("/parser/files/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  }).then((r) => r.data);
};
export const reassignParserFiles = (fromId, toId) =>
  api.post("/parser/files/reassign", { from_id: fromId, to_id: toId }).then((r) => r.data);
export const downloadParserFileUrl = (fileId) =>
  `${api.defaults.baseURL}/parser/files/${encodeURIComponent(fileId)}/download`;
// Anchor href downloads fire a plain GET that doesn't carry the JWT
// (axios interceptors set the header on XHR only). Use this helper to
// fetch the blob with auth attached, then OPEN it in a new tab (so PDFs,
// images, text preview inline) — the browser will offer Save As for
// types it can't render (e.g. .msg, .docx). Matches the legacy ↓ UX
// where clicking a saved RFQ row opens the file for the estimator to
// review without forcing a download.
export const openParserFile = async (fileId, filename) => {
  const r = await api.get(
    `/parser/files/${encodeURIComponent(fileId)}/download`,
    { responseType: "blob" },
  );
  // Use the server's media type when available so the browser knows whether
  // to render inline (PDF/image/text) vs prompt Save As (msg/docx/zip).
  const mime = r.data?.type || r.headers?.["content-type"] || "application/octet-stream";
  const blob = mime === r.data?.type ? r.data : new Blob([r.data], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  // Open in a new tab. The browser handles inline render vs Save As based on MIME.
  const w = window.open(blobUrl, "_blank", "noopener,noreferrer");
  // Some browsers ignore filename hints on object URLs — fall back to a hidden
  // anchor with `download` attribute if window.open was blocked.
  if (!w) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || `file-${fileId.slice(0, 8)}`;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke after a delay so the new tab has time to load the blob.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};
export const deleteParserFile = (fileId) =>
  api.delete(`/parser/files/${encodeURIComponent(fileId)}`).then((r) => r.data);

// ─── PDF ────────────────────────────────────────────────
export const previewPdfBlob = (quote, results, opts = {}) =>
  api
    .post("/pdf/preview-quote", { quote, results, ...opts }, { responseType: "blob" })
    .then((r) => r.data);
