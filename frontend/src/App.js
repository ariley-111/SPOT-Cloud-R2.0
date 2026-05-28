import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [health, setHealth] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [h, b] = await Promise.all([
          axios.get(`${API}/health`),
          axios.get(`${API}/calibration/baseline`),
        ]);
        setHealth(h.data);
        setBaseline(b.data);
      } catch (e) {
        setError(e.message);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="spot-landing" data-testid="spot-landing-page">
      <div className="spot-landing-inner">
        <header className="spot-header">
          <div className="spot-cmyk-cube" aria-hidden="true">
            <div className="spot-cube-face spot-cube-c"></div>
            <div className="spot-cube-face spot-cube-m"></div>
            <div className="spot-cube-face spot-cube-y"></div>
            <div className="spot-cube-face spot-cube-k"></div>
          </div>
          <div>
            <h1 className="spot-title" data-testid="spot-title">SPOT</h1>
            <p className="spot-subtitle">Standard Printing Optimization Tool</p>
            <p className="spot-edition">Cloud Edition · Phase 0 Foundation</p>
          </div>
        </header>

        <section className="spot-card" data-testid="status-card">
          <h2 className="spot-card-title">System status</h2>
          {error && (
            <div className="spot-error" data-testid="status-error">
              <strong>Connection error:</strong> {error}
            </div>
          )}
          {!error && !health && <p className="spot-loading">Loading…</p>}
          {health && (
            <div className="spot-status-grid">
              <div className="spot-status-row">
                <span className="spot-status-label">Status</span>
                <span className="spot-status-value spot-status-ok" data-testid="health-status">
                  {health.status === "ok" ? "● ONLINE" : "● OFFLINE"}
                </span>
              </div>
              <div className="spot-status-row">
                <span className="spot-status-label">Version</span>
                <span className="spot-status-value" data-testid="health-version">{health.version}</span>
              </div>
              <div className="spot-status-row">
                <span className="spot-status-label">Phase</span>
                <span className="spot-status-value" data-testid="health-phase">{health.phase}</span>
              </div>
              <div className="spot-status-row">
                <span className="spot-status-label">Uptime</span>
                <span className="spot-status-value" data-testid="health-uptime">
                  {Math.round(health.uptime_sec)}s
                </span>
              </div>
            </div>
          )}
        </section>

        {baseline && (
          <section className="spot-card" data-testid="baseline-card">
            <h2 className="spot-card-title">Calibration baseline</h2>
            <p className="spot-card-note">
              D-110 FINAL — locked parity target for the engine port. Phase 1 must achieve these R² values
              on the 785-job iQuote regression dataset.
            </p>
            <div className="spot-baseline-grid">
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Segment Cost R²</div>
                <div className="spot-baseline-value" data-testid="baseline-cost-r2">
                  {baseline.segment_r2_cost.toFixed(4)}
                </div>
              </div>
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Segment Sell R²</div>
                <div className="spot-baseline-value" data-testid="baseline-sell-r2">
                  {baseline.segment_r2_sell.toFixed(4)}
                </div>
              </div>
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Fleet Cost Δ</div>
                <div className="spot-baseline-value">
                  +{baseline.fleet_cost_delta_pct.toFixed(2)}%
                </div>
              </div>
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Fleet Sell Premium</div>
                <div className="spot-baseline-value">
                  +{baseline.fleet_sell_premium_pct.toFixed(2)}%
                </div>
              </div>
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Jobs Scored</div>
                <div className="spot-baseline-value">
                  {baseline.fleet_jobs} / {baseline.fleet_jobs_total}
                </div>
              </div>
              <div className="spot-baseline-cell">
                <div className="spot-baseline-label">Margin Lift</div>
                <div className="spot-baseline-value">
                  +${baseline.margin_lift_usd.toLocaleString()}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="spot-card spot-roadmap-card" data-testid="roadmap-card">
          <h2 className="spot-card-title">Build roadmap</h2>
          <ol className="spot-roadmap">
            <li className="spot-phase spot-phase-active">
              <span className="spot-phase-num">0</span>
              <div>
                <strong>Foundation</strong> — skeleton, dependencies, file moves, PRD
                <span className="spot-phase-tag">IN PROGRESS</span>
              </div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">1</span>
              <div>
                <strong>Engine port + regression</strong> — verbatim port of spot_engine.js; achieve R² ≥ 0.969 on 785 jobs
                <span className="spot-phase-tag spot-phase-tag-critical">CRITICAL · THE GATE</span>
              </div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">2</span>
              <div><strong>Backend APIs</strong> — auth, customers, quotes, engine, freight, parser, archive, PDF</div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">3</span>
              <div><strong>Frontend rebuild</strong> — toolbar, panels, BOM strip, all 44 warning popups, parse review, multi-part editor</div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">4</span>
              <div><strong>Pricing Console</strong> — admin-only UI for rates, GM curve, sheet library, audit log</div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">5</span>
              <div><strong>Integrations</strong> — SharePoint customer sync + PDF archive, Entra SSO</div>
            </li>
            <li className="spot-phase">
              <span className="spot-phase-num">6</span>
              <div><strong>Test pilot</strong> — parallel-run with legacy SPOT; parity-validate 30+ real quotes</div>
            </li>
          </ol>
        </section>

        <footer className="spot-footer">
          Standard Printing Company · Canton, OH · Quoting engine port of SPOT R1.6.5.1
        </footer>
      </div>
    </div>
  );
}

export default App;
