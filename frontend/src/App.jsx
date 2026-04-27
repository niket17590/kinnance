import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import Holdings from "./pages/Holdings";
import Transactions from "./pages/Transactions";
import Performance from "./pages/Performance";
import CapitalGains from "./pages/CapitalGains";
import Dividends from "./pages/Dividends";
import FamilyMembers from "./pages/admin/FamilyMembers";
import Accounts from "./pages/admin/Accounts";
import Circles from "./pages/admin/Circles";
import ImportCSV from "./pages/admin/ImportCSV";
import Settings from "./pages/admin/Settings";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import AuthCallback from "./pages/AuthCallback";
import ContributionLimits from "./pages/ContributionLimits";
import PortfolioTools from "./pages/admin/PortfolioTools";
import Rebalancer from "./pages/Rebalancer";
import { RefreshProvider } from "./context/RefreshContext";
import { FilterProvider } from "./context/FilterContext";
import Optimizer from './pages/Optimizer'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--content-bg)",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            border: "3px solid var(--accent-light)",
            borderTop: "3px solid var(--accent)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <RefreshProvider>
      <FilterProvider>{children}</FilterProvider>
    </RefreshProvider>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="holdings" element={<Holdings />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="performance" element={<Performance />} />
        <Route path="capital-gains" element={<CapitalGains />} />
        <Route path="dividends" element={<Dividends />} />
        <Route path="admin/members" element={<FamilyMembers />} />
        <Route path="admin/accounts" element={<Accounts />} />
        <Route path="admin/circles" element={<Circles />} />
        <Route path="admin/import" element={<ImportCSV />} />
        <Route path="admin/settings" element={<Settings />} />
        <Route path="contribution-limits" element={<ContributionLimits />} />
        <Route path="/admin/portfolio-tools" element={<PortfolioTools />} />
        <Route path="rebalancer" element={<Rebalancer />} />
        <Route path="optimizer" element={<Optimizer />} />
      </Route>
    </Routes>
  );
}

export default App;
