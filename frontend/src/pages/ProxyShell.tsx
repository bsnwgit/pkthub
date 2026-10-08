import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { PktSuiteIcon } from '../components/Logo'
import { Home, LogOut, ChevronDown } from 'lucide-react'
import HelpButton from '../components/HelpButton'

const APP_COLORS: Record<string, string> = {
  pktflow: '#ab9017',
  pktsnmp: '#007dab',
  pktlog: '#d86353',
  pktpcap: '#00a49e',
  pktwifi: '#8561bd',
  pktipam: '#007b43',
  pktnode: '#466cc8',
  pktsecurity: '#be7125',
}
function appColor(name: string) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#a9a294'
}

export default function ProxyShell() {
  const { appId } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [app, setApp] = useState<any>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)

  useEffect(() => {
    api.listApps().then(apps => {
      const found = apps.find(a => String(a.id) === appId)
      if (!found) return
      // Establish proxy session cookie BEFORE creating the iframe.
      // Ignore failures — a leftover cookie may already be valid.
      api.createProxySession(Number(appId)).catch(() => {}).finally(() => setApp(found))
    })
  }, [appId])

  const color = app ? appColor(app.name) : '#8ad8ea'
  const proxyUrl = app ? `/proxy/${appId}/` : null

  return (
    <div className="flex flex-col h-dvh" style={{ background: '#04060a' }}>
      {/* Thin 44px top bar */}
      <header
        className="flex items-center justify-between px-4 shrink-0 border-b border-gray-800/80 z-50"
        style={{ height: 44, background: '#080b11' }}
      >
        {/* Left: logo */}
        <div className="flex items-center gap-3">
          <PktSuiteIcon size={24} />
          <div className="h-4 w-px bg-gray-700" />
          {app && (
            <span className="text-sm font-bold font-mono" style={{ color }}>
              {app.name.toUpperCase()}
            </span>
          )}
          <HelpButton title="App View — How It Works">
            <p>This is {app?.name || 'the app'}'s own UI, proxied through pktHub using a session pktHub establishes for you — no separate login. Links inside the app that open a new tab route back through this same proxy.</p>
          </HelpButton>
        </div>

        {/* Right: nav */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/')}
            title="pktHub Home"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <Home size={16} />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <span>{user?.username}</span>
              <ChevronDown size={12} />
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-700 py-1 shadow-xl z-50" style={{ background: '#0d1219' }}>
                <div className="px-3 py-1.5 border-b border-gray-700">
                  <p className="text-xs text-gray-300">{user?.username}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                >
                  <LogOut size={12} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Proxy iframe — full remaining height */}
      <div className="flex-1 relative">
        {proxyUrl ? (
          <iframe
            src={proxyUrl}
            className="absolute inset-0 w-full h-full border-none"
            title={app?.name || 'App'}
            allow="fullscreen"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            {appId ? 'Loading app…' : 'App not found'}
          </div>
        )}
      </div>
    </div>
  )
}
