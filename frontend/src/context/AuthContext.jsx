/* eslint-disable */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authLogin, authMe, authConfig, seedAdmin } from "../api/spot";

const AuthCtx = createContext(null);

// On every app load, check if Microsoft Entra redirected us to /auth/callback
// with ?token=...; if so, persist the token like the password flow does, then
// scrub the URL so the token isn't visible in the address bar.
function captureSsoTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const isCallback = url.pathname.endsWith("/auth/callback") || url.searchParams.has("token");
  if (!isCallback) return null;
  const tok = url.searchParams.get("token");
  if (tok) {
    localStorage.setItem("spot_token", tok);
    // Clean URL: strip query + the /auth/callback path so the SPA lands at "/"
    window.history.replaceState({}, "", "/");
    return tok;
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [authCfg, setAuthCfg] = useState({ sso_enabled: false, sso_required: false });

  useEffect(() => {
    (async () => {
      // 1. Capture SSO token from /auth/callback if present
      captureSsoTokenFromUrl();
      // 2. Load auth config (drives the login screen UI)
      try { setAuthCfg(await authConfig()); } catch (_) { /* keep defaults */ }
      // 3. Seed the local admin only when SSO is NOT required (legacy break-glass)
      try { await seedAdmin(); } catch (_) {}
      // 4. Resume session via stored JWT, same as before
      const tok = localStorage.getItem("spot_token");
      if (!tok) { setReady(true); return; }
      try {
        const me = await authMe();
        setUser(me);
      } catch (_) {
        localStorage.removeItem("spot_token");
      } finally { setReady(true); }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const { access_token, user: u } = await authLogin(email, password);
    localStorage.setItem("spot_token", access_token);
    setUser(u);
    return u;
  }, []);

  const loginWithEntra = useCallback(() => {
    // Top-level navigation to the backend OIDC initiator. The backend will
    // 302 to login.microsoftonline.com, then back to /api/auth/entra/callback,
    // and finally to /auth/callback?token=... which we capture above.
    window.location.href = "/api/auth/entra/login";
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("spot_token");
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, ready, login, loginWithEntra, logout, authCfg }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
