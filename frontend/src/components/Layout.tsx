import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PktSuiteLockup } from './Logo'
import {
  LayoutDashboard, Monitor, Settings, FileText, LogOut, MonitorPlay, Server, TriangleAlert, BookOpen
} from 'lucide-react'
import clsx from 'clsx'
import AiAssistant from './AiAssistant'
import { api } from '../api/client'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/context', label: 'Context Viewer', icon: MonitorPlay },
  { to: '/noc', label: 'NOC Builder', icon: Monitor },
  { to: '/apps', label: 'App Registry', icon: Server },
  { to: '/alerts', label: 'App Alerts', icon: TriangleAlert, analystOk: true },
  { to: '/audit', label: 'Audit Log', icon: FileText, analystOk: true },
  { to: '/settings', label: 'Hub Settings', icon: Settings, adminOnly: true, dividerBefore: true },
]

export default function Layout() {
  const { user, logout, isAdmin, isAnalyst } = useAuth()
  const [regApps, setRegApps] = useState<{ id: number; name: string; display_name: string }[]>([])

  useEffect(() => {
    if (!isAdmin) return
    const load = () => api.listApps().then(setRegApps).catch(() => {})
    load()
    // Nav labels are display_name straight from the registry — re-poll so a
    // rename made elsewhere shows up here without a full page reload. The
    // 'pkthub:reg-apps-changed' event (dispatched by SettingsPage right after
    // register/edit/deregister) forces an immediate refresh instead of
    // waiting for the next poll tick.
    window.addEventListener('pkthub:reg-apps-changed', load)
    const t = setInterval(load, 30_000)
    return () => {
      window.removeEventListener('pkthub:reg-apps-changed', load)
      clearInterval(t)
    }
  }, [isAdmin])

  const visible = navItems.filter(item => {
    if (item.adminOnly) return isAdmin
    if (item.analystOk) return isAnalyst
    return true
  })

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a1628' }}>
      {/* Sidebar */}
      <aside className="flex flex-col w-60 shrink-0 border-r border-gray-800" style={{ background: '#0d1f3c' }}>
        {/* Logo */}
        <div className="flex items-center px-3 py-3 border-b border-gray-800">
          <PktSuiteLockup height={44} />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {visible.map(item => (
            <div key={item.to}>
              {item.dividerBefore && <div className="h-0.5 bg-gray-600 mx-1 my-2 rounded-full" />}
              <NavLink
                to={item.to}
                end={item.exact}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                )}
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            </div>
          ))}

          {isAdmin && regApps.length > 0 && (
            <>
              <div className="h-0.5 bg-gray-600 mx-1 my-2 rounded-full" />
              <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Reg App Settings
              </div>
              {regApps.map(app => (
                <NavLink
                  key={app.id}
                  to={`/app-settings/${app.id}`}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  )}
                >
                  <Settings size={16} />
                  <span className="truncate">{app.display_name} - Settings</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Documentation */}
        <div className="px-2 pt-2">
          <NavLink
            to="/documentation"
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-500/15 text-blue-400'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            )}
          >
            <BookOpen size={16} />
            Documentation
          </NavLink>
        </div>

        {/* User footer */}
        <div className="border-t border-gray-800 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{user?.username}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="p-1.5 text-gray-500 hover:text-red-400 rounded transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <AiAssistant />
    </div>
  )
}
