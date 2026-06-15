// SheetLibraryModal — legacy-parity table (spot_r1_5.jsx L8277-8392, 2026-06-12)
//
// Replaces the previous 18-sheet card grid with the full APPROVED_SHEETS table
// from the backend, enriched per-row with pcs/sh, sheets needed, waste %,
// $/MSF, cost/pc, total PO via /api/engine/sheet-library. Adds:
//   - Search box  (filter by W×L / grade / liner / "kemi" etc.)
//   - Current Spec ↔ All Specs toggle
//   - Add Stock W × L  → adds a STOCK row that gets priced like an approved sheet
//   - Sortable columns
//   - Use This / Remove / Del actions
//
// Per-quote `stockSheets` state lives on `s.stockSheets` (legacy parity) and is
// passed to the engine so saved/exported quotes preserve any added stocks.
import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { useQuote } from "../../context/QuoteContext";
import { fmtMoney, fmtInt } from "../../lib/format";
import { sheetLibraryPriced } from "../../api/spot";

const STOCK_PREFIX = "STK-";

const Th = ({ children, right, col, sortCol, sortDir, onSort }) => (
  <th
    onClick={col ? () => onSort(col) : undefined}
    style={{
      padding: "6px 8px", textAlign: right ? "right" : "left",
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em",
      color: sortCol === col ? "var(--spot-accent)" : "var(--spot-text3)",
      borderBottom: "1px solid var(--spot-line)", cursor: col ? "pointer" : "default",
      userSelect: "none", whiteSpace: "nowrap", background: "var(--spot-bg3)",
      position: "sticky", top: 0, zIndex: 1,
    }}
  >
    {children}{col && (sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : "")}
  </th>
);

export default function SheetLibraryModal({ open = true, onClose }) {
  const { active, setField, pushToast } = useQuote();
  const s = active?.state || {};

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState("total");
  const [sortDir, setSortDir] = useState("asc");
  const [stkW, setStkW] = useState("");
  const [stkL, setStkL] = useState("");

  const oneUpW = Number(s.oneUpW || 0);
  const oneUpL = Number(s.oneUpL || 0);
  // LEGACY PARITY (spot_r1_5.jsx L8256): selQty = qtys[selSlot] || qtys[0].
  // Legacy stores qtys PRE-multiplied by pcsPerSet at BOM commit (L2071-2075),
  // so its `qtys[0]` = 15,000 for a Bot Disk 1 (pps=6) at 2,500 sets. Cloud
  // stores raw set qtys; multiply here for multi-part components so the Sheet
  // Library prices the right component qty (sheets needed, $/MSF, cost/pc).
  const _rawQty = Number((s.qtys || [])[s.activeQtyTier || 0] || (s.qtys || [])[0] || 0);
  const _isMP = (s.quoteType || "Simple") === "Multi-Part" && (s.bomItems || []).length > 0;
  const _activeBom = _isMP ? (s.bomItems || [])[s.activeItemIdx ?? 0] : null;
  const _pps = Math.max(1, Number(_activeBom?.pcsPerSet) || 1);
  const activeQty = _isMP ? _rawQty * _pps : _rawQty;
  const overrideId = s.overrideSheetId || null;
  const stockSheets = s.stockSheets || [];

  // Fetch enriched sheet rows whenever the modal opens or spec changes
  const stockKey = JSON.stringify(stockSheets);
  useEffect(() => {
    if (!open || oneUpW <= 0 || oneUpL <= 0 || activeQty <= 0) {
      setRows([]); return;
    }
    let cancel = false;
    setLoading(true); setErr("");
    const body = {
      oneUpW, oneUpL, qty: activeQty,
      boardGrade: s.boardGrade, flute: s.flute,
      outsideLiner: s.outsideLiner, insideLiner: s.insideLiner,
      medium: s.medium || "None",
      fscEnabled: !!s.fscEnabled,
      fscFee: Number(s.fscFee || 25), kemiTariff: Number(s.kemiTariff || 2.5),
      palletPrepFee: Number(s.palletPrepFee || 17.5),
      under5MsfFee: Number(s.under5MsfFee || 0),
      stockSheets,
    };
    sheetLibraryPriced(body)
      .then((d) => { if (!cancel) setRows(d.sheets || []); })
      .catch((e) => { if (!cancel) setErr(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, oneUpW, oneUpL, activeQty, s.boardGrade, s.flute,
      s.outsideLiner, s.insideLiner, s.medium, stockKey]);

  // Search + spec-mode filter. Stock sheets always visible (legacy parity —
  // they're added with the current spec at add-time, so they're by definition
  // relevant; never hide them in "Current Spec" mode even if the spec is
  // partially empty on a freshly-loaded quote).
  const visibleRows = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    let r = rows;
    if (!showAll) r = r.filter((x) => x.specMatch || x.isStock);
    if (q) {
      r = r.filter((x) => {
        const hay = `${x.w}x${x.l} ${x.g} ${x.f} ${x.ol} ${x.il} ${x.md}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      // Stock first, then spec matches, then by chosen column
      if (a.isStock !== b.isStock) return a.isStock ? -1 : 1;
      if (a.specMatch !== b.specMatch) return a.specMatch ? -1 : 1;
      const ka = a[sortCol] ?? 0, kb = b[sortCol] ?? 0;
      if (sortCol === "sheet") return dir * (`${a.w}×${a.l}`.localeCompare(`${b.w}×${b.l}`));
      return dir * (Number(ka) - Number(kb));
    });
  }, [rows, search, showAll, sortCol, sortDir]);

  // Best match = lowest priced spec-matching row (engine already sorts that way)
  const bestRow = useMemo(() => rows.find((r) => r.specMatch && r.pricable), [rows]);

  const onSort = (col) => {
    if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir(col === "sheet" ? "asc" : "asc"); }
  };

  const handleUseThis = (row) => {
    setField("overrideSheetId", row.id);
    onClose && onClose();
  };
  const handleRemoveOverride = () => setField("overrideSheetId", null);
  const handleAddStock = () => {
    const w = parseFloat(stkW), l = parseFloat(stkL);
    if (!(w > 0 && l > 0)) {
      pushToast && pushToast("Enter both W and L (>0)", "warn");
      return;
    }
    // LEGACY PARITY (spot_r1_5.jsx L2470): id = "STK-" + Date.now(). Always
    // unique; legacy permits same-dimension stock entries (estimator decision).
    const newRow = {
      id: `${STOCK_PREFIX}${Date.now()}`,
      w, l,
      g: s.boardGrade || "", f: s.flute || "",
      ol: s.outsideLiner || "None", il: s.insideLiner || "None",
      md: s.medium || "None", isStock: true,
    };
    setField("stockSheets", [...stockSheets, newRow]);
    setStkW(""); setStkL("");
    pushToast && pushToast(`Added stock sheet ${w}×${l}`, "ok");
  };
  const handleDelStock = (id) => {
    setField("stockSheets", stockSheets.filter((x) => x.id !== id));
    if (overrideId === id) setField("overrideSheetId", null);
  };
  const handleClearAllStock = () => {
    setField("stockSheets", []);
    if ((overrideId || "").startsWith(STOCK_PREFIX)) setField("overrideSheetId", null);
  };

  const stockCount = rows.filter((r) => r.isStock).length;
  const matchCount = rows.filter((r) => r.specMatch).length;

  return (
    <Modal onClose={onClose} title="" width={1100} data-testid="sheet-library-modal-backdrop">
      <div data-testid="sheet-library-modal">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--spot-text)" }}>Sheet Library</div>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", marginTop: 3 }}>
              {showAll ? "All specs" :
                `Current: ${s.flute || "—"} / ${s.boardGrade || "—"} / ${s.outsideLiner === "None" ? "Kraft" : s.outsideLiner} / ${s.insideLiner === "None" ? "Kraft" : s.insideLiner}`}
              {activeQty > 0 ? ` — Qty ${fmtInt(activeQty)}` : ""}
              {bestRow && activeQty > 0 ? ` — Best: ${fmtMoney(bestRow.costPc)}/pc` : ""}
            </div>
          </div>
          <button onClick={() => setShowAll(!showAll)} data-testid="sheetlib-toggle-all"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
              padding: "5px 12px", borderRadius: 4,
              background: showAll ? "var(--spot-accent)" : "var(--spot-bg3)",
              color: showAll ? "#fff" : "var(--spot-text2)",
              border: `1px solid ${showAll ? "var(--spot-accent)" : "var(--spot-border)"}` }}>
            {showAll ? "Current Spec" : "All Specs"}
          </button>
        </div>

        {/* Search + Add Stock */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end",
          flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input className="sp-input" placeholder="Search sheets… (e.g. 63x126, Kemi, ECT 44)"
              value={search} onChange={(e) => setSearch(e.target.value)}
              data-testid="sheetlib-search"
              style={{ width: "100%", padding: "5px 10px", fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--spot-text3)",
              textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>
              Add Stock:
            </span>
            <input className="sp-input" type="number" step="0.25" min="1" placeholder="W"
              value={stkW} onChange={(e) => setStkW(e.target.value)}
              data-testid="sheetlib-stk-w"
              style={{ width: 56, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
            <span style={{ fontSize: 11, color: "var(--spot-text3)" }}>×</span>
            <input className="sp-input" type="number" step="0.25" min="1" placeholder="L"
              value={stkL} onChange={(e) => setStkL(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddStock(); }}
              data-testid="sheetlib-stk-l"
              style={{ width: 56, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
            <button onClick={handleAddStock} data-testid="sheetlib-stk-add"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                padding: "5px 10px", borderRadius: 4, background: "var(--spot-green, #22c55e)",
                color: "#fff", whiteSpace: "nowrap" }}>+ Add</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ maxHeight: 480, overflowY: "auto",
          border: "1px solid var(--spot-line)", borderRadius: 4 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <Th col="sheet" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Sheet</Th>
                {showAll && <Th>Flute</Th>}
                {showAll && <Th>Grade</Th>}
                {showAll && <Th>Outside</Th>}
                {showAll && <Th>Inside</Th>}
                <Th>Type</Th>
                <Th right col="pcsPerSheet" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Pcs/Sh</Th>
                <Th right col="sheetsReq" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Sheets</Th>
                <Th right col="wastePct" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Waste</Th>
                <Th right col="costMsf" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>$/MSF</Th>
                <Th right col="costPc" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Cost/Pc</Th>
                <Th right col="total" sortCol={sortCol} sortDir={sortDir} onSort={onSort}>Total PO</Th>
                <Th right></Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={showAll ? 13 : 9} style={{ padding: 22, textAlign: "center",
                  color: "var(--spot-text3)" }}>Loading…</td></tr>
              )}
              {!loading && err && (
                <tr><td colSpan={showAll ? 13 : 9} style={{ padding: 14, textAlign: "center",
                  color: "var(--spot-err)" }}>Error: {err}</td></tr>
              )}
              {!loading && !err && visibleRows.length === 0 && (
                <tr><td colSpan={showAll ? 13 : 9} style={{ padding: 22, textAlign: "center",
                  color: "var(--spot-text3)" }}>
                  No matching sheets{!showAll ? " for current spec" : ""}
                </td></tr>
              )}
              {visibleRows.map((row, i) => {
                const isOverride = row.id === overrideId;
                const isBest = row === bestRow;
                const stripe = i % 2 === 1 ? "var(--spot-bg2)" : "transparent";
                const dimmed = !row.specMatch;
                return (
                  <tr key={row.id + (row.isStock ? "s" : "")}
                    data-testid={`sheetlib-row-${row.id}`}
                    style={{
                      background: isOverride ? "var(--spot-accent-soft, #06b6d418)"
                        : isBest ? "rgba(34,197,94,.12)" : stripe,
                      borderBottom: "1px solid var(--spot-line)",
                      opacity: dimmed ? 0.55 : 1,
                    }}>
                    <td style={{ padding: "5px 8px", fontWeight: isBest || isOverride ? 700 : 400,
                      whiteSpace: "nowrap" }}>
                      {row.w}×{row.l}
                      {isBest && <span style={{ marginLeft: 5, fontSize: 9,
                        padding: "2px 5px", borderRadius: 3, background: "#22c55e",
                        color: "#fff", fontWeight: 700 }}>BEST</span>}
                      {isOverride && <span style={{ marginLeft: 5, fontSize: 9,
                        padding: "2px 5px", borderRadius: 3, background: "var(--spot-accent)",
                        color: "#fff", fontWeight: 700 }}>ACTIVE</span>}
                    </td>
                    {showAll && <td style={{ padding: "5px 8px", fontSize: 11 }}>{row.f}</td>}
                    {showAll && <td style={{ padding: "5px 8px", fontSize: 11 }}>{row.g}</td>}
                    {showAll && <td style={{ padding: "5px 8px", fontSize: 11 }}>{row.ol === "None" ? "Kraft" : row.ol.replace("42# ", "")}</td>}
                    {showAll && <td style={{ padding: "5px 8px", fontSize: 11 }}>{row.il === "None" ? "Kraft" : row.il.replace("42# ", "")}</td>}
                    <td style={{ padding: "5px 8px", fontSize: 11 }}>
                      {row.isStock
                        ? <span style={{ padding: "2px 6px", borderRadius: 3,
                            background: "#f59e0b22", color: "#f59e0b", fontWeight: 700 }}>STOCK</span>
                        : <span style={{ padding: "2px 6px", borderRadius: 3,
                            background: "var(--spot-bg3)", color: "var(--spot-text3)", fontWeight: 600 }}>Approved</span>}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.pcsPerSheet ?? "—"}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{row.sheetsReq ?? "—"}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>
                      {row.wastePct != null ? `${(row.wastePct * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>
                      {row.pricable ? fmtMoney(row.costMsf) : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>
                      {row.pricable ? fmtMoney(row.costPc, 4) : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>
                      {row.pricable ? fmtMoney(row.total)
                        : row.hasPrice ? <span style={{ color: "#f59e0b" }}>Below Min</span> : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}
                      onClick={(e) => e.stopPropagation()}>
                      {(row.specMatch || row.isStock) && !isOverride && (
                        <button onClick={() => handleUseThis(row)}
                          data-testid={`sheetlib-use-${row.id}`}
                          style={{ all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
                            padding: "4px 10px", borderRadius: 3,
                            background: "var(--spot-accent)", color: "#fff", whiteSpace: "nowrap" }}>
                          Use This
                        </button>
                      )}
                      {isOverride && (
                        <button onClick={handleRemoveOverride}
                          data-testid={`sheetlib-remove-${row.id}`}
                          style={{ all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 700,
                            padding: "4px 10px", borderRadius: 3,
                            background: "var(--spot-err)22", color: "var(--spot-err)" }}>
                          Remove
                        </button>
                      )}
                      {row.isStock && !isOverride && (
                        <button onClick={() => handleDelStock(row.id)}
                          data-testid={`sheetlib-del-${row.id}`}
                          style={{ all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 600,
                            color: "var(--spot-err)", padding: "4px 6px", marginLeft: 4 }}>
                          Del
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {overrideId && (
              <button onClick={() => { handleRemoveOverride(); onClose && onClose(); }}
                data-testid="sheetlib-clear-override"
                style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  color: "var(--spot-err)" }}>
                Clear Override
              </button>
            )}
            {stockCount > 0 && (
              <button onClick={handleClearAllStock} data-testid="sheetlib-clear-stock"
                style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  color: "#f59e0b" }}>
                Clear All Stock ({stockCount})
              </button>
            )}
            <button onClick={() => {
                // Legacy-parity CSV export (spot_r1_5.jsx L8262-8271)
                const hdr = ["Sheet W","Sheet L","Flute","Grade","Outside","Inside","Medium","Type","Pcs/Sh","Sheets","Waste%","$/MSF","Cost/Pc","Total PO","Spec Match"];
                const lines = [hdr.join(",")];
                visibleRows.forEach((x) => {
                  lines.push([x.w, x.l, x.f, x.g,
                    x.ol === "None" ? "Kraft" : x.ol, x.il === "None" ? "Kraft" : x.il,
                    x.md === "None" ? "None" : x.md, x.isStock ? "Stock" : "Approved",
                    x.pcsPerSheet || "", x.sheetsReq || "",
                    x.wastePct != null ? `${(x.wastePct * 100).toFixed(1)}%` : "",
                    x.pricable ? (x.costMsf ?? 0).toFixed(2) : "",
                    x.pricable ? (x.costPc ?? 0).toFixed(4) : "",
                    x.pricable ? (x.total ?? 0).toFixed(2) : "",
                    x.specMatch ? "Yes" : "No",
                  ].map((v) => `"${v}"`).join(","));
                });
                const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `Sheet_Library_${s.flute || "spec"}_${s.boardGrade || ""}.csv`.replace(/[\\/:*?"<>|]/g, "_");
                a.click(); URL.revokeObjectURL(a.href);
              }} data-testid="sheetlib-export-csv"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700,
                padding: "4px 10px", border: "1px solid var(--spot-accent)", borderRadius: 4,
                color: "var(--spot-accent)" }}>
              Export CSV
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--spot-text3)" }} data-testid="sheetlib-counts">
            {visibleRows.length} sheet{visibleRows.length === 1 ? "" : "s"}
            {showAll && matchCount > 0 ? ` (${matchCount} match)` : ""}
            {stockCount > 0 ? ` · ${stockCount} stock` : ""}
          </div>
        </div>
      </div>
    </Modal>
  );
}
