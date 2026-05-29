/* eslint-disable */
import React, { useEffect, useState } from "react";
import Modal from "./Modal";
import { freightQuote, freightZones } from "../../api/spot";
import { useQuote } from "../../context/QuoteContext";
import { fmtMoney } from "../../lib/format";

export default function FreightModal({ onClose }) {
  const { active, setField, pushToast } = useQuote();
  const s = active.state;
  const [destZip, setDestZip] = useState(s.destZip || "");
  const [weight, setWeight] = useState("1000");
  const [freightClass, setFreightClass] = useState("70");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [zones, setZones] = useState(null);

  useEffect(() => { freightZones().then(setZones).catch(() => {}); }, []);

  const runQuote = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await freightQuote({ destZip, weightLbs: Number(weight), freightClass });
      setResult(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const apply = () => {
    if (!result?.totalAmount) return;
    setField("freightCost", String(result.totalAmount));
    setField("quoteFOB", "Destination");
    pushToast(`Freight applied — ${fmtMoney(result.totalAmount)} via ${result.carrier}`, "ok");
    onClose();
  };

  return (
    <Modal title="Freight Dashboard · UTS + SPCOC" onClose={onClose} width={760} data-testid="modal-freight"
      footer={
        <>
          {result && <button className="sp-btn sp-btn-green" onClick={apply} data-testid="freight-apply-btn">Apply to Quote</button>}
          <button className="sp-btn sp-btn-primary" onClick={runQuote} disabled={busy || !destZip} data-testid="freight-quote-btn">
            {busy ? "Quoting…" : "Get Quote"}
          </button>
        </>
      }>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label className="sp-label">Destination ZIP</label>
          <input className="sp-input" value={destZip} onChange={(e) => setDestZip(e.target.value)}
            data-testid="freight-dest-zip-input" placeholder="44104" />
        </div>
        <div>
          <label className="sp-label">Weight (lbs)</label>
          <input className="sp-input" value={weight} onChange={(e) => setWeight(e.target.value)}
            data-testid="freight-weight-input" />
        </div>
        <div>
          <label className="sp-label">Freight Class</label>
          <input className="sp-input" value={freightClass} onChange={(e) => setFreightClass(e.target.value)}
            data-testid="freight-class-input" />
        </div>
      </div>

      {zones && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--spot-text3)" }}>
          Origin <strong>{zones.origin_zip}</strong> (Canton, OH) — SPCOC local zones flat-rate up to 10k lbs, otherwise UTS multi-carrier.
        </div>
      )}

      {err && <div style={{ color: "var(--spot-err)", marginTop: 12, fontSize: 12 }} data-testid="freight-error">{err}</div>}

      {result && (
        <div style={{ marginTop: 18 }} data-testid="freight-result">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="sp-badge sp-badge-blue">{result.source?.toUpperCase()}</span>
            <strong style={{ color: "var(--spot-green)", fontSize: 18 }}>{fmtMoney(result.totalAmount)}</strong>
            <span style={{ color: "var(--spot-text3)" }}>{result.carrier} · {result.transitDays}d transit</span>
          </div>
          {result.allCarriers?.length > 0 && (
            <table style={{ width: "100%", marginTop: 12, fontSize: 12 }} data-testid="freight-carriers">
              <thead>
                <tr style={{ color: "var(--spot-text3)" }}>
                  <th style={{ textAlign: "left", padding: 4 }}>Carrier</th>
                  <th style={{ textAlign: "right", padding: 4 }}>Total</th>
                  <th style={{ textAlign: "right", padding: 4 }}>Fuel</th>
                  <th style={{ textAlign: "right", padding: 4 }}>Transit</th>
                </tr>
              </thead>
              <tbody>
                {result.allCarriers.map((c, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--spot-line)" }}>
                    <td style={{ padding: 4 }}>{c.name}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{fmtMoney(c.total)}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{fmtMoney(c.fuel)}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{c.transit}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.note && <div style={{ marginTop: 8, fontSize: 11, color: "var(--spot-text3)" }}>{result.note}</div>}
          {result.utsError && <div style={{ marginTop: 8, fontSize: 11, color: "var(--spot-warn)" }}>UTS unavailable: {result.utsError}</div>}
        </div>
      )}
    </Modal>
  );
}
