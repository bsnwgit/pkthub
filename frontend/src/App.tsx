import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ReactNode } from 'react'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AppManagerPage from './pages/AppManagerPage'
import NOCBuilderPage from './pages/NOCBuilderPage'
import NOCEditorPage from './pages/NOCEditorPage'
import SettingsPage from './pages/SettingsPage'
import AuditPage from './pages/AuditPage'
import ProxyShell from './pages/ProxyShell'
import NOCDisplayPage from './pages/NOCDisplayPage'
import ContextViewerPage from './pages/ContextViewerPage'
import Layout from './components/Layout'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
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
          <Route path="/context" element={<RequireAuth><ContextViewerPage /></RequireAuth>} />

          {/* Authenticated app shell */}
          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="apps" element={<AppManagerPage />} />
            <Route path="noc" element={<NOCBuilderPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="users" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
            <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          </Route>

          {/* Proxied pktApps — thin top bar mode */}
          <Route path="/proxy/:appId/*" element={<RequireAuth><ProxyShell /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
