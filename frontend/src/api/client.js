/* eslint-disable */
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

// ─── Global API status bus (for toolbar "calling X..." indicator) ─────
// Subscribers receive {kind, label, t} events. kind: "start"|"end"|"err"
const subs = new Set();
export function onApiStatus(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(ev) { for (const fn of subs) try { fn(ev); } catch (_) {} }

// Manual sustained-status control — for long-running flows that are NOT a
// single in-flight request (e.g. the async RFQ parse, which submits fast then
// polls every 3s). Without this the poll requests would blink the pill on/off.
// Usage: const done = apiStatusBusy("Anthropic · parsing RFQ"); ... done();
export function apiStatusBusy(label) {
  emit({ kind: "start", label });
  let ended = false;
  return (failed = false) => {
    if (ended) return;
    ended = true;
    emit({ kind: failed ? "err" : "end", label });
  };
}

function labelForUrl(url, method) {
  if (!url) return method;
  if (url.includes("/parser/parse-rfq")) return "Anthropic · parsing RFQ";
  if (url.includes("/freight/quote"))    return "UTS · quoting freight";
  if (url.includes("/freight/"))         return "UTS";
  if (url.includes("/engine/"))          return "engine";
  if (url.includes("/pdf/"))             return "PDF · rendering";
  if (url.includes("/parser/"))          return "Anthropic";
  if (url.includes("/customers/"))       return "customers";
  if (url.includes("/drafts"))           return "drafts · saving";
  if (url.includes("/quotes"))           return "quotes";
  return method;
}

const client = axios.create({ baseURL: API_BASE, timeout: 60000 });

client.interceptors.request.use((cfg) => {
  const tok = localStorage.getItem("spot_token");
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  cfg.metadata = { label: labelForUrl(cfg.url, cfg.method), t0: Date.now() };
  // Suppress noisy status pills for fast/frequent calls (drafts auto-save, engine ticks, customer search).
  // Async-parse submit + status polls are also suppressed — the parseRfqPolling
  // helper drives ONE sustained pill via apiStatusBusy() instead, so the pill
  // stays solid for the whole parse rather than blinking on each 3s poll.
  const quiet = /\/drafts|\/engine\/|\/customers\/search|\/auth\/|\/parser\/jobs|\/parser\/parse-rfq-async/.test(cfg.url || "");
  if (!quiet) emit({ kind: "start", label: cfg.metadata.label, url: cfg.url });
  cfg.metadata.quiet = quiet;
  return cfg;
});

client.interceptors.response.use(
  (r) => {
    const m = r.config.metadata;
    if (m && !m.quiet) emit({ kind: "end", label: m.label, ms: Date.now() - m.t0 });
    return r;
  },
  (err) => {
    if (err.response?.status === 401) localStorage.removeItem("spot_token");
    const m = err.config?.metadata;
    if (m && !m.quiet) emit({ kind: "err", label: m.label, ms: Date.now() - (m.t0 || 0) });
    return Promise.reject(err);
  }
);

export default client;
