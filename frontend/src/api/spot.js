/* eslint-disable */
import api from "./client";

// ─── Auth ───────────────────────────────────────────────
export const authLogin = (email, password) =>
  api.post("/auth/login", { email, password }).then((r) => r.data);

export const authMe = () => api.get("/auth/me").then((r) => r.data);

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

export const engineDefaults = () =>
  api.get("/engine/defaults").then((r) => r.data);

// ─── Drafts ────────────────────────────────────────────
export const listDrafts = () =>
  api.get("/drafts").then((r) => r.data);
export const createDraft = (body) =>
  api.post("/drafts", body).then((r) => r.data);
export const updateDraft = (id, body) =>
  api.put(`/drafts/${id}`, body).then((r) => r.data);
export const deleteDraft = (id) =>
  api.delete(`/drafts/${id}`).then((r) => r.data);

// ─── Quotes ─────────────────────────────────────────────
export const listQuotes = (limit = 50) =>
  api.get("/quotes", { params: { limit } }).then((r) => r.data);
export const createQuote = (body) =>
  api.post("/quotes", body).then((r) => r.data);
export const getQuote = (id) =>
  api.get(`/quotes/${id}`).then((r) => r.data);
export const updateQuote = (id, body) =>
  api.put(`/quotes/${id}`, body).then((r) => r.data);

// ─── Freight ────────────────────────────────────────────
export const freightQuote = (body) =>
  api.post("/freight/quote", body).then((r) => r.data);
export const freightZones = () =>
  api.get("/freight/zones").then((r) => r.data);

// ─── Parser ─────────────────────────────────────────────
export const parserBudget = () =>
  api.get("/parser/budget").then((r) => r.data);
export const parseRfq = (files, emailBody, notes) => {
  const fd = new FormData();
  for (const f of files || []) fd.append("files", f);
  if (emailBody) fd.append("email_body", emailBody);
  if (notes) fd.append("notes", notes);
  return api
    .post("/parser/parse-rfq", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180000,
    })
    .then((r) => r.data);
};

// ─── PDF ────────────────────────────────────────────────
export const previewPdfBlob = (quote, results, opts = {}) =>
  api
    .post("/pdf/preview-quote", { quote, results, ...opts }, { responseType: "blob" })
    .then((r) => r.data);
