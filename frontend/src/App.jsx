import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Holdings from './pages/Holdings'
import Transactions from './pages/Transactions'
import Performance from './pages/Performance'
import CapitalGains from './pages/CapitalGains'
import Dividends from './pages/Dividends'
import FamilyMembers from './pages/admin/FamilyMembers'
import Accounts from './pages/admin/Accounts'
import ImportCSV from './pages/admin/ImportCSV'
import Settings from './pages/admin/Settings'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="holdings" element={<Holdings />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="performance" element={<Performance />} />
        <Route path="capital-gains" element={<CapitalGains />} />
        <Route path="dividends" element={<Dividends />} />
        <Route path="admin/family" element={<FamilyMembers />} />
        <Route path="admin/accounts" element={<Accounts />} />
        <Route path="admin/import" element={<ImportCSV />} />
        <Route path="admin/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App