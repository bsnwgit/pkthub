import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PktSuiteLockup } from './Logo'
import {
  LayoutDashboard, Server, Monitor, Users, Settings, FileText, LogOut, ChevronRight
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/apps', label: 'App Manager', icon: Server },
  { to: '/kiosks', label: 'Kiosk Builder', icon: Monitor },
  { to: '/audit', label: 'Audit Log', icon: FileText, analystOk: true },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
]

export default function Layout() {
  const { user, logout, isAdmin, isAnalyst } = useAuth()
  const navigate = useNavigate()

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
        <div className="flex items-center px-4 py-4 border-b border-gray-800">
          <PktSuiteLockup height={36} />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {visible.map(item => (
            <NavLink
              key={item.to}
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
          ))}
        </nav>

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
    </div>
  )
}
