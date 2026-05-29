/* eslint-disable */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authLogin, authMe, seedAdmin } from "../api/spot";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { await seedAdmin(); } catch (_) {} // idempotent — fail silent
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

  const logout = useCallback(() => {
    localStorage.removeItem("spot_token");
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
