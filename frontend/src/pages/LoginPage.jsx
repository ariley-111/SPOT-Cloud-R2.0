/* eslint-disable */
import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@standardprinting.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await login(email, password); }
    catch (ex) { setErr(ex?.response?.data?.detail || "Invalid credentials"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at 30% 0%, rgba(59,130,246,0.08) 0%, transparent 50%), var(--spot-bg)",
    }} data-testid="login-page">
      <form onSubmit={onSubmit} style={{
        width: 380, background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
        borderRadius: 8, padding: 28, boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 6, background: "var(--spot-accent)",
            display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 18,
          }}>S</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>SPOT</h1>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Cloud · R2.0</div>
          </div>
        </div>

        <label className="sp-label">Email</label>
        <input className="sp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
          data-testid="login-email-input" required />

        <div style={{ height: 12 }} />
        <label className="sp-label">Password</label>
        <input className="sp-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          data-testid="login-password-input" required />

        {err && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--spot-err)", background: "var(--spot-err-bg)",
            border: "1px solid var(--spot-err)", borderRadius: 4, padding: "6px 10px" }} data-testid="login-error">
            {err}
          </div>
        )}

        <button type="submit" disabled={busy} className="sp-btn sp-btn-primary"
          data-testid="login-submit-btn"
          style={{ width: "100%", marginTop: 18, padding: "10px 0", fontSize: 13 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ marginTop: 18, fontSize: 11, color: "var(--spot-text3)", textAlign: "center", lineHeight: 1.6 }}>
          Standard Printing Company · Canton, OH<br />
          Dev JWT auth · Entra SSO coming Phase 5
        </p>
      </form>
    </div>
  );
}
