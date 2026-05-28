# D-119 — Freight Zone Routing: SPCOC Local Zones + UTS Gate

**Status:** CODED
**Date:** 2026-04-25
**Affects:** `DEV_spot_server.js`, `spot_r1_5.jsx` (minor — adds trailerFeet to request body)

---

## 1. What This Changes

The `/api/freight` endpoint gains a local-zone routing layer. Before calling UTS, the server checks whether the destination ZIP falls inside one of SPC's 3 local delivery zones. If it does AND the shipment is within SPCOC truck capacity, SPOT returns a flat zone rate immediately — no UTS API call, no carrier comparison, instant result.

If the shipment exceeds SPCOC capacity or the ZIP is outside local zones, the existing UTS → fallback path is unchanged.

---

## 2. SPCOC Local Zone Table (Phase 1 — ZIP-prefix approximation)

Built from the Freight_Rates_Local.xlsx map screenshot. 3-digit ZIP prefix mapping. Approximate — estimator can override at the freight panel.

| Zone | Rate (post-uplift) | 3-digit prefixes | Coverage |
|------|-------------------|------------------|----------|
| 1 | **$45** | 447 | Canton, North Canton, Massillon, Louisville, Hartville |
| 2 | **$70** | 443, 444, 446, 448 | Akron, Cuyahoga Falls, Wadsworth, Medina, Alliance, Minerva, Orrville, Wooster |
| 3 | **$95** | 440, 441, 442, 445, 449 | Cleveland, Youngstown, Niles, Salem, Mansfield |
| Out | UTS path | all others | Existing UTS API → fallback |

Rates per Michael's uplift directive: +$10 across the board from the 2022-06-06 rates ($35/$60/$85 → $45/$70/$95).

Phase 2 (future): convert Google My Maps polygons to GeoJSON for proper point-in-polygon tests. Higher accuracy for borderline ZIPs.

---

## 3. SPCOC-vs-UTS Routing Gate

```
IF destZip in SPCOC_ZONES (zone 1/2/3)
  AND weightLbs ≤ 10,000
  AND trailerFeet ≤ 24 (when provided; weight-only gate when not)
THEN → SPCOC flat rate (no UTS call)
ELSE → UTS API (existing path, unchanged)
  FALLBACK → zipToZone() fallback rates (existing, unchanged)
```

Source: backlog Q6 (10K lb gate from freight docs) + Q7 (24 trailer-feet = SPCOC truck capacity from skid calculator).

---

## 4. Wide-Format Note

The freight rates image footer says local rates don't necessarily apply to wide-format. For Phase 1: same rules apply to all product sizes. The SPCOC gate uses weight + trailer-feet which already accounts for WF skid sizes (WF skids = 8 trailer-feet each, so 3 WF skids = 24 ft = truck capacity). If the shipment exceeds the gate, it routes to UTS regardless of product type. This is effectively option (a) from the Q20 analysis — the gate self-enforces via physics.

---

## 5. Server Changes (`spot_server.js`)

1. Add `SPCOC_ZONES` lookup table (ZIP prefix → zone 1/2/3)
2. Add `SPCOC_RATES` table (zone → flat rate)
3. Add `SPCOC_MAX_WEIGHT = 10000` and `SPCOC_MAX_TRAILER_FT = 24`
4. New function `spcLocalRate(destZip, weightLbs, trailerFeet)` — returns rate object or null
5. `/api/freight` handler: accept optional `trailerFeet` in request body; call `spcLocalRate()` first; if null, fall through to UTS → fallback (unchanged)

Response shape for SPCOC hits:
```json
{
  "source": "spcoc",
  "zone": 2,
  "zoneLabel": "Zone 2 — Akron/Alliance",
  "carrier": "SPC Local Delivery",
  "transitDays": 1,
  "totalAmount": 70.00,
  "fuelSurcharge": 0,
  "allCarriers": [],
  "note": "SPCOC local zone rate"
}
```

---

## 6. JSX Changes (`spot_r1_5.jsx`)

Minimal. Three fetch calls to `/api/freight` gain an optional `trailerFeet` field in the request body:
1. Single-slot fetch — add `trailerFeet` from `calcShipment()` result
2. `recalcAllFreight` loop — `rs.ft` already computed, add to body
3. `updateAllFreight` combined — compute combined trailer feet, add to body

Display: when `source === "spcoc"`, the carrier info shows "SPC Local Delivery" + zone badge. No other UI changes needed — the freight panel already handles flat rates.

---

## 7. Calibration Impact

None to existing fleet regression. Local zone rates are a new pricing path that didn't exist before — no historical iQuote comparison is possible. Treat as a P-class planned deviation per the D-110 framework: document in future fleet reports but do not flag as out-of-tolerance.

---

## 8. What's NOT in this D-119

- Phase 2 GeoJSON polygon boundaries (future)
- Multi-stop routing (one ship-to per quote per Q8)
- Will-Call special handling (FOB Origin = no freight per Q9)
- Customer-specific zone overrides (future)
