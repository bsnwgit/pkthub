import { useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PktSuiteLockup } from './Logo'
import {
  LayoutDashboard, Monitor, Settings, FileText, LogOut, Server, TriangleAlert, BookOpen,
  LayoutGrid, AppWindow, ChevronDown, ChevronRight
} from 'lucide-react'
import clsx from 'clsx'
import { api, getToken, type AppNavItem } from '../api/client'
import ResonanceMount from '../resonance/ResonanceMount'

interface RegApp {
  id: number
  name: string
  display_name: string
  nav_manifest?: AppNavItem[]
}

// Dashboard renders above the APPS section; everything from App Registry down
// renders below it — see the nav block in the render.
const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/apps', label: 'App Registry', icon: Server },
  { to: '/alerts', label: 'App Alerts', icon: TriangleAlert, analystOk: true },
  // Rule here: everything above is about the registered apps, everything from
  // here down is the hub's own tooling.
  { to: '/noc', label: 'NOC Screens', icon: Monitor, dividerBefore: true },
  { to: '/audit', label: 'Audit Log', icon: FileText, analystOk: true },
  { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
]

export default function Layout() {
  const { user, logout, isAdmin, isAnalyst } = useAuth()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  // A phone tab holding the hub, a second app in an iframe and the assistant's
  // socket and audio is enough for iOS to discard and reload it — which is what
  // the Compliance page was doing every seven seconds. CSS cannot help here: a
  // hidden component is still mounted and still holds its memory, so the mount
  // itself has to be conditional.
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // A NavLink does not unmount this component, so without this the drawer
  // stays open on top of the page it has just navigated to.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  const [regApps, setRegApps] = useState<RegApp[]>([])
  const [regAppsExpanded, setRegAppsExpanded] = useState(
    () => localStorage.getItem('pkthub_reg_app_settings_expanded') === '1'
  )
  // One APPS group open at a time — opening another closes the first, so a
  // long menu can't push the rest of the nav off screen. Holds a registry id
  // rather than a name: the same app can be registered twice from two
  // locations, and each gets its own group.
  const [expandedApp, setExpandedApp] = useState<number | null>(() => {
    const stored = localStorage.getItem('pkthub_app_nav_expanded')
    return stored ? Number(stored) : null
  })
  // The whole APPS band collapses too, for when the hub's own tools are what
  // you want in view. Defaults open — the apps are the point of the section.
  const [appsExpanded, setAppsExpanded] = useState(
    () => localStorage.getItem('pkthub_apps_section_expanded') !== '0'
  )
  const onRegAppSettingsRoute = location.pathname.startsWith('/app-settings/')
  // Note '/app/' with the trailing slash — '/app-settings/…' must not match.
  const onAnyAppRoute = location.pathname.startsWith('/app/')

  const toggleAppsSection = () => {
    setAppsExpanded(prev => {
      const next = !prev
      localStorage.setItem('pkthub_apps_section_expanded', next ? '1' : '0')
      return next
    })
  }

  const toggleAppNav = (id: number) => {
    setExpandedApp(prev => {
      const next = prev === id ? null : id
      if (next === null) localStorage.removeItem('pkthub_app_nav_expanded')
      else localStorage.setItem('pkthub_app_nav_expanded', String(next))
      return next
    })
  }

  const toggleRegAppsExpanded = () => {
    setRegAppsExpanded(prev => {
      const next = !prev
      localStorage.setItem('pkthub_reg_app_settings_expanded', next ? '1' : '0')
      return next
    })
  }

  useEffect(() => {
    const load = () => api.listApps().then((apps: RegApp[]) => {
      setRegApps(apps)
      // The remembered group may have been deregistered while away — drop it
      // rather than leaving a stale id nothing can close.
      setExpandedApp(prev => (prev !== null && !apps.some(a => a.id === prev) ? null : prev))
    }).catch(() => {})
    load()
    // Both the APPS groups and the Reg App Settings list are built from the
    // registry — display_name for the labels, nav_manifest for the menu the
    // health poller last read off each app. Re-poll so a rename or a newly
    // published manifest shows up without a full page reload. The
    // 'pkthub:reg-apps-changed' event (dispatched by SettingsPage right after
    // register/edit/deregister) forces an immediate refresh instead of
    // waiting for the next poll tick.
    window.addEventListener('pkthub:reg-apps-changed', load)
    const t = setInterval(load, 30_000)
    return () => {
      window.removeEventListener('pkthub:reg-apps-changed', load)
      clearInterval(t)
    }
  }, [])

  const visible = navItems.filter(item => {
    if (item.adminOnly) return isAdmin
    if (item.analystOk) return isAnalyst
    return true
  })

  // An app that publishes a nav manifest gets its own menu under APPS. One that
  // doesn't is still reachable from its Dashboard card, and still needs its
  // Settings surfaced, so it stays in the Reg App Settings list.
  const navApps      = regApps.filter(a => (a.nav_manifest?.length ?? 0) > 0)
  const settingsApps = regApps.filter(a => !a.nav_manifest?.length)

  // APPS sits directly under Dashboard, above the hub's own tools — the apps
  // are what most of a shift is spent in, so they get the top of the nav.
  const [dashboardItem, ...hubItems] = visible

  const renderNavItem = (item: typeof navItems[number]) => (
    <div key={item.to}>
      {item.dividerBefore && <div className="h-px bg-blue-500/25 mx-3 my-3" />}
      <NavLink
        to={item.to}
        end={item.exact}
        className={({ isActive }) => clsx(
          'flex items-center gap-3 px-3 py-3.5 md:py-2.5 text-[13px] md:text-[11.5px] uppercase tracking-[0.1em] md:tracking-[0.13em] transition-colors',
          isActive
            ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
            : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
        )}
      >
        <item.icon size={16} />
        {item.label}
      </NavLink>
    </div>
  )

  return (
    <div className="relative z-10 flex h-dvh overflow-hidden text-white">
      {/* Sidebar */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={clsx(
          'f-drawer flex flex-col w-[min(82vw,320px)] md:w-60 shrink-0 border-r border-gray-800',
          // Off-canvas overlay on a phone, the desk rail from md up. This nav
          // is the whole suite's navigation — Apps expands into every
          // registered app's own menu — so as a drawer it is also what the
          // embedded app needs, which is why chromeless stays correct.
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200',
          'md:static md:z-auto md:translate-x-0 md:transition-none',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'linear-gradient(180deg, rgba(216,180,110,.025), transparent 40%)' }}
      >
        {/* Logo */}
        <div className="flex items-center px-5 py-4 border-b border-gray-800">
          <PktSuiteLockup height={44} />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {dashboardItem && renderNavItem(dashboardItem)}

          {/* APPS — each registered app's own menu, mirrored from the manifest
              it publishes. Selecting a row opens that app's real page inside
              this shell, so the hub's sidebar is the only navigation present. */}
          {navApps.length > 0 && (
            <>
              <div className="h-px bg-blue-500/25 mx-3 my-3" />
              <button
                onClick={toggleAppsSection}
                className={clsx(
                  'flex items-center gap-3 w-full px-3 py-3.5 md:py-2.5 text-[13px] md:text-[11.5px] uppercase tracking-[0.1em] md:tracking-[0.13em] transition-colors',
                  onAnyAppRoute && !appsExpanded
                    ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                    : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
                )}
              >
                <LayoutGrid size={16} />
                <span className="flex-1 text-left">Apps</span>
                {appsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {appsExpanded && navApps.map(app => {
                const expanded = expandedApp === app.id
                const onThisApp = location.pathname.startsWith(`/app/${app.id}`)
                const items = (app.nav_manifest ?? []).filter(i => !i.admin_only || isAdmin)
                return (
                  <div key={app.id}>
                    <button
                      onClick={() => toggleAppNav(app.id)}
                      className={clsx(
                        'flex items-center gap-3 w-full pl-6 pr-3 py-3 md:py-2 text-[12.5px] md:text-[11px] uppercase tracking-[0.1em] transition-colors',
                        onThisApp && !expanded
                          ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                          : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
                      )}
                    >
                      <AppWindow size={14} />
                      <span className="flex-1 text-left truncate">{app.display_name}</span>
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>

                    {expanded && items.map(item => (
                      <div key={item.path}>
                        {item.divider_before && <div className="h-px bg-blue-500/15 ml-11 mr-3 my-2" />}
                        <NavLink
                          to={`/app/${app.id}${item.path}`}
                          end={item.path === '/'}
                          className={({ isActive }) => clsx(
                            'flex items-center gap-3 pl-11 pr-3 py-2.5 md:py-1.5 text-[12px] md:text-[10.5px] uppercase tracking-[0.1em] transition-colors',
                            isActive
                              ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                              : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
                          )}
                        >
                          {item.icon && <span className="text-xs w-3.5 text-center leading-none">{item.icon}</span>}
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </div>
                    ))}
                  </div>
                )
              })}
            </>
          )}

          {/* App Registry and App Alerts continue the apps band; the rule that
              starts the hub's own tools is carried by NOC Screens itself. */}
          {hubItems.map(renderNavItem)}

          {isAdmin && settingsApps.length > 0 && (
            <>
              <div className="h-px bg-blue-500/25 mx-3 my-3" />
              <button
                onClick={toggleRegAppsExpanded}
                className={clsx(
                  'flex items-center gap-3 w-full px-3 py-3.5 md:py-2.5 text-[13px] md:text-[11.5px] uppercase tracking-[0.1em] md:tracking-[0.13em] transition-colors',
                  onRegAppSettingsRoute && !regAppsExpanded
                    ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                    : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
                )}
              >
                <Settings size={16} />
                <span className="flex-1 text-left truncate">Reg App Settings</span>
                {regAppsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {regAppsExpanded && settingsApps.map(app => (
                <NavLink
                  key={app.id}
                  to={`/app-settings/${app.id}`}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 pl-9 pr-3 py-3 md:py-2 text-[12.5px] md:text-[11px] tracking-[0.1em] transition-colors',
                    isActive
                      ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                      : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
                  )}
                >
                  <span className="truncate">{app.display_name}</span>
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
              'flex items-center gap-3 px-3 py-3.5 md:py-2.5 text-[13px] md:text-[11.5px] uppercase tracking-[0.1em] md:tracking-[0.13em] transition-colors',
              isActive
                ? 'bg-gradient-to-r from-blue-500/[0.12] to-transparent text-blue-300 border-l-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-blue-500/[0.04] border-l-2 border-transparent'
            )}
          >
            <BookOpen size={16} />
            Documentation
          </NavLink>
        </div>

        {/* User footer */}
        <div className="f-safe-b border-t border-gray-800 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{user?.username}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="f-tap p-1.5 text-gray-500 hover:text-red-400 rounded transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="md:hidden h-12 flex-shrink-0 border-b border-gray-800 flex items-center px-4 gap-3">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="f-tap -ml-2 text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <PktSuiteLockup height={26} />
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* One mount for the whole authenticated shell, so a route change does not
          cost a new resonance session. Deliberately here and not in App.tsx: the
          public NOC display and the login page render outside this Layout, and
          neither should ever carry an assistant. */}
      {!isPhone && <ResonanceMount getToken={getToken} />}
    </div>
  )
}
