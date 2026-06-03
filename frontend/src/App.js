/* eslint-disable */
import React from "react";
import "./theme.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { QuoteProvider } from "./context/QuoteContext";
import LoginPage from "./pages/LoginPage";
import SpotApp from "./pages/SpotApp";
import AdminPage from "./pages/AdminPage";

function Shell() {
  const { user, ready } = useAuth();
  const [view, setView] = React.useState("spot");  // "spot" | "admin"
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
      <SpotApp onOpenAdmin={() => setView("admin")} />
      {view === "admin" && <AdminPage onClose={() => setView("spot")} />}
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
