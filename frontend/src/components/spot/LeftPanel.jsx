/* eslint-disable */
import React from "react";
import { useQuote } from "../../context/QuoteContext";
import Sec, { OptGroup, Field } from "./Sec";
import CustomerTypeahead from "./CustomerTypeahead";
import {
  FLUTES, GRADES, LINERS, BOX_STYLES, ROUTE_OPTIONS, DIFFICULTY,
  PRINT_MODES, PRINT_SIDES,
} from "../../lib/defaults";
import BomStrip from "./BomStrip";

export default function LeftPanel({ result }) {
  const { active, setField, setManyFields, pushToast } = useQuote();
  const s = active.state;

  const onCustomerSelect = (cust) => {
    setManyFields({
      custName: cust.name, custCode: cust.code,
      destZip: cust.zip || "", shipTo: [cust.city, cust.state, cust.zip].filter(Boolean).join(", "),
    });
    pushToast(`Loaded ${cust.code}`, "ok");
  };

  const onBoxStyle = (style) => {
    const cur = s.boxStyle === style ? "" : style;
    const descs = { RSC: "Regular Slotted Container", FOL: "Full Overlap Slotted Container",
      "D/C Tray": "Die Cut Tray", Mailer: "Mailer", "5PF": "Five Panel Folder" };
    const patch = { boxStyle: cur, itemDesc: cur ? descs[cur] : s.itemDesc };
    // Assembly defaults — RSC + Mailer get glue
    if (cur === "RSC" || cur === "Mailer") {
      patch.handGluing = "Yes"; patch.jointsPerPiece = "1"; patch.tape = "No";
    }
    setManyFields(patch);
  };

  const setQty = (i, v) => {
    const next = [...(s.qtys || [])];
    while (next.length < 5) next.push("");
    next[i] = v;
    setField("qtys", next);
  };

  return (
    <div data-testid="left-panel" style={{
      flex: 1, overflow: "auto", padding: 12,
      background: "var(--spot-bg)",
    }}>
      {/* ─── ESTIMATE INFO ─── */}
      <Sec title="Estimate Info" hue="var(--spot-accent)" data-testid="sec-estimate-info">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1.5fr", gap: 10 }}>
          <Field label="Estimate #">
            <input className="sp-input" value={s.estNum || ""}
              data-testid="input-est-num"
              onChange={(e) => setField("estNum", e.target.value)} />
          </Field>
          <Field label="Customer">
            <CustomerTypeahead value={s.custName} onSelect={onCustomerSelect}
              onChangeName={(v) => setField("custName", v)}
              data-testid="input-customer" />
          </Field>
          <Field label="Project Name">
            <input className="sp-input" value={s.projectName || ""}
              data-testid="input-project-name"
              onChange={(e) => setField("projectName", e.target.value)} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          <Field label="PO #">
            <input className="sp-input" value={s.poNumber || ""}
              data-testid="input-po"
              onChange={(e) => setField("poNumber", e.target.value)} />
          </Field>
          <Field label="FOB">
            <OptGroup value={s.quoteFOB} onChange={(v) => setField("quoteFOB", v)}
              options={["Origin", "Destination"]} data-testid="opt-fob" />
          </Field>
          <Field label="Terms">
            <input className="sp-input" value={s.quoteTerms || ""}
              data-testid="input-terms"
              onChange={(e) => setField("quoteTerms", e.target.value)} />
          </Field>
          <Field label="Ship-to ZIP">
            <input className="sp-input" value={s.destZip || ""}
              data-testid="input-dest-zip"
              onChange={(e) => setField("destZip", e.target.value)} />
          </Field>
          <Field label="Due">
            <input className="sp-input" type="date" value={s.dueDate || ""}
              data-testid="input-due-date"
              onChange={(e) => setField("dueDate", e.target.value)} />
          </Field>
        </div>
      </Sec>

      {/* ─── ITEM SETUP ─── */}
      <Sec title="Item Setup" hue="var(--spot-green)" data-testid="sec-item-setup"
        right={<span className={`sp-badge ${result && !result.error ? "sp-badge-green" : "sp-badge-muted"}`}>
          {result?.error ? "INCOMPLETE" : (result ? "READY" : "—")}
        </span>}>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Field label="Quote">
            <OptGroup value={s.quoteType} onChange={(v) => setField("quoteType", v)}
              options={["Simple", "Multi-Part"]} data-testid="opt-quote-type" color="purple" />
          </Field>
        </div>

        {s.quoteType === "Multi-Part" && <BomStrip />}

        <Field label="Item Description">
          <input className="sp-input" value={s.itemDesc || ""}
            data-testid="input-item-desc"
            onChange={(e) => setField("itemDesc", e.target.value)} placeholder="e.g. 4-sided Rollover Tray" />
        </Field>

        <div style={{ marginTop: 10 }}>
          <label className="sp-label">Box Style</label>
          <OptGroup value={s.boxStyle} onChange={onBoxStyle} options={BOX_STYLES} data-testid="opt-box-style" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Field label="Width (in)">
            <input className="sp-input" value={s.oneUpW || ""}
              data-testid="input-one-up-w"
              onChange={(e) => setField("oneUpW", e.target.value)} placeholder="0.000" />
          </Field>
          <Field label="Length (in)">
            <input className="sp-input" value={s.oneUpL || ""}
              data-testid="input-one-up-l"
              onChange={(e) => setField("oneUpL", e.target.value)} placeholder="0.000" />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="sp-label">Quantities (up to 5)</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <input key={i} className="sp-input" value={(s.qtys || [])[i] || ""}
                placeholder={i === 0 ? "Qty 1" : ""}
                data-testid={`input-qty-${i}`}
                onChange={(e) => setQty(i, e.target.value)} />
            ))}
          </div>
        </div>

        {result && !result.error && (
          <div style={{
            marginTop: 10, padding: "6px 10px", background: "var(--spot-bg3)",
            border: "1px solid var(--spot-line)", borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--spot-text2)",
          }} data-testid="layout-summary">
            {result.numUp}×{result.numOut} → {result.pcsPerSheet} out on {result.sheetW}×{result.sheetL}
            {" "}→ <span style={{ color: "var(--spot-accent)", fontWeight: 700 }}>{result.route}</span>
            <span style={{ marginLeft: 8, color: "var(--spot-text3)" }}>
              {(result.wastePct * 100).toFixed(1)}% waste · {result.sheetsReq} sheets
            </span>
          </div>
        )}
      </Sec>

      {/* ─── BOARD ─── */}
      <Sec title="Board" hue="var(--spot-orange)" data-testid="sec-board">
        <Field label="Flute"><OptGroup value={s.flute} onChange={(v) => setField("flute", v)}
          options={FLUTES} data-testid="opt-flute" /></Field>
        <div style={{ marginTop: 10 }}>
          <label className="sp-label">Grade</label>
          <OptGroup value={s.boardGrade} onChange={(v) => setField("boardGrade", v)}
            options={GRADES} data-testid="opt-grade" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          <Field label="Outside Liner">
            <select className="sp-input" value={s.outsideLiner}
              data-testid="select-outside-liner"
              onChange={(e) => setField("outsideLiner", e.target.value)}>
              {LINERS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Inside Liner">
            <select className="sp-input" value={s.insideLiner}
              data-testid="select-inside-liner"
              onChange={(e) => setField("insideLiner", e.target.value)}>
              {LINERS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Medium">
            <select className="sp-input" value={s.medium}
              data-testid="select-medium"
              onChange={(e) => setField("medium", e.target.value)}>
              {LINERS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "var(--spot-text2)" }}>
          <input type="checkbox" checked={!!s.fscEnabled}
            data-testid="checkbox-fsc"
            onChange={(e) => setField("fscEnabled", e.target.checked)} />
          FSC certified ($25 fee)
        </label>
      </Sec>

      {/* ─── PRODUCTION SPECS ─── */}
      <Sec title={`Production Specs ${result?.route ? `· ${result.route}` : ""}`}
           hue="var(--spot-accent)" data-testid="sec-production">

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center", rowGap: 12 }}>
          <span className="sp-label" style={{ margin: 0 }}>Print</span>
          <OptGroup value={s.printReq} onChange={(v) => setField("printReq", v)}
            options={[{ value: "Yes", label: "On" }, { value: "No", label: "Off" }]}
            data-testid="opt-print-req" />

          {s.printReq === "Yes" && (
            <>
              <span className="sp-label" style={{ margin: 0 }}>Mode</span>
              <OptGroup value={s.printMode} onChange={(v) => setField("printMode", v)}
                options={PRINT_MODES} data-testid="opt-print-mode" />

              <span className="sp-label" style={{ margin: 0 }}>Sides</span>
              <OptGroup value={s.printSides} onChange={(v) => setField("printSides", v)}
                options={PRINT_SIDES} data-testid="opt-print-sides" />

              <span className="sp-label" style={{ margin: 0 }}>White Ink</span>
              <OptGroup value={s.whiteInk} onChange={(v) => setField("whiteInk", v)}
                options={["No", "Yes"]} data-testid="opt-white-ink" />

              <span className="sp-label" style={{ margin: 0 }}>Colors</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="sp-input" style={{ width: 70 }} value={s.colorsFront}
                  data-testid="input-colors-front"
                  onChange={(e) => setField("colorsFront", e.target.value)} />
                <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>front</span>
                <input className="sp-input" style={{ width: 70 }} value={s.colorsBack}
                  data-testid="input-colors-back"
                  onChange={(e) => setField("colorsBack", e.target.value)} />
                <span style={{ color: "var(--spot-text3)", fontSize: 11 }}>back</span>
              </div>
            </>
          )}

          <span className="sp-label" style={{ margin: 0 }}>Route</span>
          <OptGroup value={s.routeOverride} onChange={(v) => setField("routeOverride", v)}
            options={ROUTE_OPTIONS} data-testid="opt-route-override" />

          <span className="sp-label" style={{ margin: 0 }}>Difficulty</span>
          <OptGroup value={s.cadDifficulty} onChange={(v) => setField("cadDifficulty", v)}
            options={DIFFICULTY} data-testid="opt-cad-difficulty" color="green" />

          <span className="sp-label" style={{ margin: 0 }}>Rule (in)</span>
          <input className="sp-input" style={{ maxWidth: 110 }} value={s.totalRuleInches}
            data-testid="input-rule-inches"
            onChange={(e) => setField("totalRuleInches", e.target.value)} />

          <span className="sp-label" style={{ margin: 0 }}>Perf %</span>
          <input className="sp-input" style={{ maxWidth: 110 }} value={s.perfPct}
            data-testid="input-perf-pct"
            onChange={(e) => setField("perfPct", e.target.value)} />

          <span className="sp-label" style={{ margin: 0 }}>Mats</span>
          <OptGroup value={s.productMats} onChange={(v) => setField("productMats", v)}
            options={["No", "Yes"]} data-testid="opt-mats" />
        </div>
      </Sec>

      {/* ─── ASSEMBLY ─── */}
      <Sec title="Assembly" hue="var(--spot-purple)" defaultOpen={false} data-testid="sec-assembly">
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center", rowGap: 12 }}>
          <span className="sp-label" style={{ margin: 0 }}>Strip</span>
          <OptGroup value={s.handStripping} onChange={(v) => setField("handStripping", v)}
            options={["No", "Yes"]} data-testid="opt-strip" />

          <span className="sp-label" style={{ margin: 0 }}>Glue</span>
          <OptGroup value={s.handGluing} onChange={(v) => setField("handGluing", v)}
            options={["No", "Yes"]} data-testid="opt-glue" />

          <span className="sp-label" style={{ margin: 0 }}>Tape</span>
          <OptGroup value={s.tape} onChange={(v) => setField("tape", v)}
            options={["No", "Yes"]} data-testid="opt-tape" />

          {s.tape === "Yes" && (
            <>
              <span className="sp-label" style={{ margin: 0 }}>Type</span>
              <OptGroup value={s.tapeType} onChange={(v) => setField("tapeType", v)}
                options={["Clear", "Reinforced"]} data-testid="opt-tape-type" />
            </>
          )}
        </div>
      </Sec>

      {/* ─── CHARGES ─── */}
      <Sec title="Charges & Misc" hue="var(--spot-warn)" defaultOpen={false} data-testid="sec-charges">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Freight $">
            <input className="sp-input" value={s.freightCost}
              data-testid="input-freight-cost"
              onChange={(e) => setField("freightCost", e.target.value)} />
          </Field>
          <Field label="Cutting Die $">
            <input className="sp-input" value={s.cuttingDieCost}
              data-testid="input-die-cost"
              onChange={(e) => setField("cuttingDieCost", e.target.value)} />
          </Field>
          <Field label="Prepress $">
            <input className="sp-input" value={s.prepressCost}
              data-testid="input-prepress-cost"
              onChange={(e) => setField("prepressCost", e.target.value)} />
          </Field>
        </div>
      </Sec>
    </div>
  );
}
