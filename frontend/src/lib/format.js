/* eslint-disable */
export const fmtMoney = (n, dec = 2) => {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dec, maximumFractionDigits: dec });
};

export const fmtInt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
};

export const fmtPct = (n, dec = 1) => {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return (v * 100).toFixed(dec) + "%";
};

export const fmtNum = (n, dec = 2) => {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

export const fmtBytes = (b) => {
  const v = Number(b);
  if (!isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1048576).toFixed(2)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
};

export const generateEstNum = (initials) => {
  // Allow empty initials — fall back to "SPC" so the est# is always generated.
  // The backfill effect in QuoteContext re-stamps with real initials once they resolve.
  const pre = (initials || "SPC").toUpperCase();
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mn = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${pre}-${yy}${mm}${dd}-${hh}${mn}${ss}`;
};
