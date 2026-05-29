/* eslint-disable */
import React from "react";
import "./theme.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { QuoteProvider } from "./context/QuoteContext";
import LoginPage from "./pages/LoginPage";
import SpotApp from "./pages/SpotApp";

function Shell() {
  const { user, ready } = useAuth();
  React.useEffect(() => { document.body.classList.add("spot-app-body"); }, []);
  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--spot-text3)" }}
           data-testid="auth-loading">
        Initializing SPOT…
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <QuoteProvider>
      <SpotApp />
    </QuoteProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
