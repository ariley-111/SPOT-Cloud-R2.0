/* eslint-disable */
import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import SpotCube from "../components/spot/SpotCube";

export default function LoginPage() {
  const { login, loginWithEntra, authCfg } = useAuth();
  const [email, setEmail] = useState("admin@standardprinting.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Surface any error the backend bounced back from the Entra flow.
  useEffect(() => {
    const u = new URL(window.location.href);
    const ssoErr = u.searchParams.get("sso_error");
    if (ssoErr) {
      setErr(decodeURIComponent(ssoErr));
      u.searchParams.delete("sso_error");
      window.history.replaceState({}, "", u.pathname + (u.search || ""));
    }
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await login(email, password); }
    catch (ex) { setErr(ex?.response?.data?.detail || "Invalid credentials"); }
    finally { setBusy(false); }
  };

  const ssoEnabled = !!authCfg?.sso_enabled;
  const ssoRequired = !!authCfg?.sso_required;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at 30% 0%, rgba(59,130,246,0.08) 0%, transparent 50%), var(--spot-bg)",
    }} data-testid="login-page">
      <form onSubmit={onSubmit} style={{
        width: 380, background: "var(--spot-bg2)", border: "1px solid var(--spot-line)",
        borderRadius: 8, padding: 28, boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <SpotCube size={44} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>SPOT</h1>
            <div style={{ fontSize: 11, color: "var(--spot-text3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Cloud · R2.0</div>
          </div>
        </div>

        {ssoEnabled && (
          <button type="button" onClick={loginWithEntra}
            data-testid="entra-sso-btn"
            style={{
              width: "100%", padding: "10px 12px", fontSize: 13, fontWeight: 700,
              background: "#fff", color: "#1f1f1f", border: "1px solid #2b3348",
              borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 10, marginBottom: ssoRequired ? 0 : 18,
            }}>
            <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
              <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
              <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </button>
        )}

        {ssoEnabled && !ssoRequired && (
          <div style={{ display: "flex", alignItems: "center", margin: "16px 0",
                        gap: 8, color: "var(--spot-text3)", fontSize: 10, letterSpacing: "0.08em" }}>
            <div style={{ flex: 1, height: 1, background: "var(--spot-line)" }} />
            <span>OR EMAIL</span>
            <div style={{ flex: 1, height: 1, background: "var(--spot-line)" }} />
          </div>
        )}

        {!ssoRequired && (
          <>
            <label className="sp-label">Email</label>
            <input className="sp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
              data-testid="login-email-input" required />

            <div style={{ height: 12 }} />
            <label className="sp-label">Password</label>
            <input className="sp-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              data-testid="login-password-input" required />
          </>
        )}

        {err && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--spot-err)", background: "var(--spot-err-bg)",
            border: "1px solid var(--spot-err)", borderRadius: 4, padding: "6px 10px" }} data-testid="login-error">
            {err}
          </div>
        )}

        {!ssoRequired && (
          <button type="submit" disabled={busy} className="sp-btn sp-btn-primary"
            data-testid="login-submit-btn"
            style={{ width: "100%", marginTop: 18, padding: "10px 0", fontSize: 13 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        )}

        {ssoRequired && (
          <p style={{ marginTop: 12, fontSize: 11, color: "var(--spot-text3)", textAlign: "center" }}>
            Password sign-in is disabled — use Microsoft SSO.
          </p>
        )}

        <p style={{ marginTop: 18, fontSize: 11, color: "var(--spot-text3)", textAlign: "center", lineHeight: 1.6 }}>
          Standard Printing Company · Canton, OH<br />
          {ssoEnabled
            ? (ssoRequired ? "Microsoft Entra SSO" : "Microsoft Entra SSO + JWT fallback")
            : "Dev JWT auth · Entra SSO ready (awaiting Entra credentials)"}
        </p>
      </form>
    </div>
  );
}
