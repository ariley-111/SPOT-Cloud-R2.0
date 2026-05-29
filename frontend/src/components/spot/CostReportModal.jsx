/* eslint-disable */
import React from "react";
import Modal from "./Modal";
import { useQuote } from "../../context/QuoteContext";
import { useEngine } from "../../hooks/useEngine";
import { fmtMoney, fmtPct, fmtInt, fmtNum } from "../../lib/format";

export default function CostReportModal({ onClose }) {
  const { active } = useQuote();
  const { results, loading } = useEngine(active.state);
  const valid = (results || []).filter((r) => !r.error);

  return (
    <Modal title="Internal Cost Report" onClose={onClose} width={1000} data-testid="modal-cost-report"
      footer={<button className="sp-btn" onClick={onClose} data-testid="cost-report-close-btn">Close</button>}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--spot-text)" }}>
          {active.state.estNum || "(draft)"} · {active.state.custName || "Customer"}
        </div>
        <div style={{ fontSize: 12, color: "var(--spot-text3)" }}>
          {active.state.projectName} · {active.state.oneUpW || "—"}″ × {active.state.oneUpL || "—"}″
          · {active.state.boardGrade} {active.state.flute}
          · {active.state.outsideLiner} / {active.state.insideLiner}
        </div>
      </div>

      {loading && <div data-testid="cost-report-loading" style={{ color: "var(--spot-text3)" }}>Calculating…</div>}

      {valid.length > 0 && (
        <table style={{ width: "100%", fontSize: 12 }} data-testid="cost-report-table">
          <thead>
            <tr style={{ color: "var(--spot-text3)", borderBottom: "1px solid var(--spot-line)" }}>
              <Th>Qty</Th><Th>Route</Th><Th right>Sheets</Th><Th right>MSF</Th>
              <Th right>Board</Th><Th right>Press</Th><Th right>Cut</Th><Th right>Asm</Th>
              <Th right>Direct</Th><Th right>Total Cost</Th>
              <Th right>Sell</Th><Th right>GM%</Th>
            </tr>
          </thead>
          <tbody>
            {valid.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--spot-line)" }} data-testid={`cost-row-${i}`}>
                <Td><strong>{fmtInt(r.qty)}</strong></Td>
                <Td><span className="sp-badge sp-badge-blue">{r.route}</span></Td>
                <Td right>{fmtInt(r.sheetsReq)}</Td>
                <Td right>{fmtNum(r.oMSF, 2)}</Td>
                <Td right>{fmtMoney(r.matTotal, 0)}</Td>
                <Td right>{fmtMoney(r.printDirect, 0)}</Td>
                <Td right>{fmtMoney(r.cutterDirect, 0)}</Td>
                <Td right>{fmtMoney(r.assemblyCost, 0)}</Td>
                <Td right>{fmtMoney(r.totalDirect, 0)}</Td>
                <Td right>{fmtMoney(r.totalMfg, 0)}</Td>
                <Td right style={{ color: "var(--spot-green)", fontWeight: 700 }}>{fmtMoney(r.sellTotal, 0)}</Td>
                <Td right>{fmtPct(r.gmPct, 1)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {valid.length > 0 && (
        <div style={{ marginTop: 20, fontSize: 11, color: "var(--spot-text3)" }}>
          Engine version: <span style={{ color: "var(--spot-text2)" }}>Python port · D-110 baseline</span>{" "}
          · Generated {new Date().toLocaleString()}
        </div>
      )}
    </Modal>
  );
}

const Th = ({ children, right }) => (
  <th style={{ padding: "5px 8px", textAlign: right ? "right" : "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>{children}</th>
);
const Td = ({ children, right, style }) => (
  <td style={{ padding: "5px 8px", textAlign: right ? "right" : "left", fontVariantNumeric: "tabular-nums", color: "var(--spot-text2)", ...style }}>{children}</td>
);
