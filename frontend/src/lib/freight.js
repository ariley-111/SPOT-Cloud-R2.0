// ─── Freight allocation + LTL-minimum helpers ──────────────────────────
// Mirrors the BACKEND engine allocator (routes/engine_routes.py::_alloc_job)
// so the Freight Dashboard DISPLAY matches the priced allocation exactly.
//
// Methods (all three are functionally distinct — D-140 / option-b):
//   • "By MSF"   (default) → proportional to each component's board MSF (oMSF)
//   • "Equal"             → split equally across components
//   • "By Weight"         → proportional to each component's shipped weight
// Fallback to Equal when the chosen basis has no data (matches backend).

// Local delivery = our own truck, determined by destination ZIP (legacy parity).
// When the freight quote resolves the carrier to our local-delivery service we
// NEVER apply a freight markup — it's a flat published rate. This is the single
// source of truth for "is this shipment local?" on the frontend.
export function isLocalCarrier(carrier) {
  const c = (carrier || "").trim();
  return c === "SPC Local Delivery" || c === "Local Delivery";
}

export function allocateJobCost(comps, total, method) {
  const n = (comps || []).length;
  const out = new Array(n).fill(0);
  if (n === 0 || !(total > 0)) return out;

  if (method === "Equal") {
    const share = total / n;
    return out.map(() => share);
  }

  const basisKey = method === "By Weight" ? "weight" : "oMSF";
  const totalBasis = comps.reduce((a, c) => a + (Number(c[basisKey]) || 0), 0);
  if (totalBasis <= 0) {
    const share = total / n; // no basis data → equal (legacy/backend parity)
    return out.map(() => share);
  }
  return comps.map((c) => total * ((Number(c[basisKey]) || 0) / totalBasis));
}

// Detect a carrier LTL-minimum situation: when ≥2 shipments of DIFFERENT
// weights come back at the SAME dollar amount, the carrier floor (minimum
// charge) is in play. Returns { amount, carrier } for the lowest repeated
// amount, or null when freight scales with weight.
export function detectFreightMinimum(quotes) {
  const valid = (quotes || []).filter(
    (q) => Number(q.totalAmount) > 0 && Number(q.weight) > 0
  );
  if (valid.length < 2) return null;
  const byAmt = {};
  valid.forEach((q) => {
    const amt = Number(q.totalAmount).toFixed(2);
    (byAmt[amt] = byAmt[amt] || new Set()).add(Math.round(Number(q.weight)));
  });
  const repeats = Object.entries(byAmt)
    .filter(([, wset]) => wset.size >= 2)
    .map(([amt]) => Number(amt));
  if (repeats.length === 0) return null;
  const amount = Math.min(...repeats);
  const hit = valid.find((v) => Number(v.totalAmount).toFixed(2) === amount.toFixed(2));
  return { amount, carrier: hit?.carrier || "" };
}
