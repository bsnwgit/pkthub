import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ReactNode } from 'react'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AppManagerPage from './pages/AppManagerPage'
import NOCBuilderPage from './pages/NOCBuilderPage'
import NOCEditorPage from './pages/NOCEditorPage'
import SettingsPage from './pages/SettingsPage'
import AuditPage from './pages/AuditPage'
import AppAlertsPage from './pages/AppAlertsPage'
import AppSettingsPage from './pages/AppSettingsPage'
import ProxyShell from './pages/ProxyShell'
import AppViewPage from './pages/AppViewPage'
import NOCDisplayPage from './pages/NOCDisplayPage'
import DocumentationPage from './pages/DocumentationPage'
import Layout from './components/Layout'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex items-center justify-center h-dvh text-gray-400">Loading…</div>
  // Carry the current route so login returns here rather than the dashboard.
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return null
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Public NOC display — no auth */}
          <Route path="/display/:token" element={<NOCDisplayPage />} />

          {/* Full-screen pages — no nav shell */}
          <Route path="/noc/:id/edit" element={<RequireAuth><NOCEditorPage /></RequireAuth>} />

          {/* Authenticated app shell */}
          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="apps" element={<AppManagerPage />} />
            <Route path="noc" element={<NOCBuilderPage />} />
            <Route path="alerts" element={<AppAlertsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="users" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
            <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
            <Route path="app-settings/:appId" element={<RequireAdmin><AppSettingsPage /></RequireAdmin>} />
            {/* A registered app's own page, embedded chromeless in the hub shell —
                one route per entry in that app's published nav manifest. */}
            <Route path="app/:appId/*" element={<AppViewPage />} />
            <Route path="documentation" element={<DocumentationPage />} />
          </Route>

          {/* Proxied pktApps — thin top bar mode */}
          <Route path="/proxy/:appId/*" element={<RequireAuth><ProxyShell /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
