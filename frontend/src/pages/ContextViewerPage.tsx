import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { PktSuiteIcon } from '../components/Logo'
import { Home, ChevronDown, Check, ShieldAlert, RefreshCw } from 'lucide-react'
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
  return APP_COLORS[(name || '').toLowerCase().replace(/[^a-z]/g, '')] || '#a9a294'
}

export default function ContextViewerPage() {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [apps, setApps] = useState<any[]>([])
  const [selectedApp, setSelectedApp] = useState<any>(null)
  const [iframeSrc, setIframeSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [alerts, setAlerts] = useState<any[]>([])
  const [resyncing, setResyncing] = useState(false)
  const [searchParams] = useSearchParams()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selectedAppRef = useRef<any>(null)

  useEffect(() => {
    api.listApps().then(setApps).catch(() => {})
  }, [])


  // Auto-select app when navigated from Dashboard card (?app=ID in URL)
  useEffect(() => {
    const appId = searchParams.get('app')
    if (!appId || apps.length === 0 || selectedApp) return
    const found = apps.find((a: any) => String(a.id) === appId)
    if (found) selectApp(found)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])


  // Keep ref in sync with selectedApp state for use in message handler closure
  useEffect(() => {
    selectedAppRef.current = selectedApp
  }, [selectedApp])

  // Handle PKT_NAVIGATE messages from proxied pktApp iframes
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'PKT_NAVIGATE') return
      const app = selectedAppRef.current
      if (!app) return
      const path = (event.data.path as string) || ''
      if (!path) return
      window.open(`/proxy/${app.id}${path}`, '_blank', 'noopener')
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Poll alerts for selected app — detect token mismatch
  useEffect(() => {
    if (!selectedApp) { setAlerts([]); return }
    const fetchAlerts = () => api.listAlerts().then(setAlerts).catch(() => {})
    fetchAlerts()
    const t = setInterval(fetchAlerts, 30_000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApp?.id])

  const hasTokenMismatch = selectedApp != null && alerts.some(
    (a: any) => a.app_id === selectedApp.id && a.event_type === 'token_mismatch' && a.status === 'active'
  )

  const resyncToken = async () => {
    if (!selectedApp) return
    setResyncing(true)
    try {
      await api.resyncToken(selectedApp.id)
      api.listAlerts().then(setAlerts).catch(() => {})
    } catch { /* swallow */ }
    finally { setResyncing(false) }
  }

  async function selectApp(app: any) {
    setDropdownOpen(false)
    if (selectedApp?.id === app.id) return
    setSelectedApp(app)
    setIframeSrc(null)
    setLoading(true)
    try {
      await api.createProxySession(Number(app.id))
    } catch (_) { /* existing cookie may be valid */ }
    setIframeSrc(`/proxy/${app.id}/`)
    setLoading(false)
  }

  const color = selectedApp ? appColor(selectedApp.name) : '#a9a294'

  return (
    <div className="flex flex-col h-screen" style={{ background: '#04060a' }}>
      {/* Thin 44px top bar — matches ProxyShell style */}
      <header
        className="flex items-center justify-between px-4 shrink-0 border-b border-gray-800/80 z-50"
        style={{ height: 44, background: '#080b11' }}
      >
        {/* Left: icon + app name */}
        <div className="flex items-center gap-3">
          <PktSuiteIcon size={20} />
          <div className="h-4 w-px bg-gray-700" />
          {selectedApp ? (
            <span className="text-sm font-bold font-mono" style={{ color }}>
              {selectedApp.name.toUpperCase()}
            </span>
          ) : (
            <span className="text-sm text-gray-500">Context Viewer</span>
          )}
          <HelpButton title="Context Viewer — How It Works">
            <p>This proxies a registered app's own UI through pktHub, using a session pktHub establishes for you — no separate login to that app.</p>
            <p>If the token badge shows a mismatch, that app's stored suite token has drifted out of sync with what pktHub has on file — Resync fixes it without re-registering the app.</p>
          </HelpButton>
        </div>

        {/* Right: username · app switcher · home */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 px-2">{user?.username}</span>

          {/* App switcher dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors border"
              style={{
                color: selectedApp ? color : '#a9a294',
                borderColor: selectedApp ? `${color}40` : '#2a2418',
                background: selectedApp ? `${color}10` : 'transparent',
              }}
            >
              <span>{selectedApp ? selectedApp.name : 'Select App'}</span>
              <ChevronDown size={12} />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg border border-gray-700 py-1 shadow-xl z-50 min-w-[160px]"
                style={{ background: '#0d1219' }}
              >
                {apps.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500">No apps registered</div>
                ) : (
                  apps.map(app => {
                    const c = appColor(app.name)
                    const isActive = selectedApp?.id === app.id
                    return (
                      <button
                        key={app.id}
                        onClick={() => selectApp(app)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-white/5"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                        <span className="flex-1" style={{ color: isActive ? c : '#dcd6c9' }}>
                          {app.name}
                        </span>
                        {isActive && <Check size={12} style={{ color: c }} />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Home — back to pktHub */}
          <button
            onClick={() => navigate('/')}
            title="pktHub Home"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <Home size={16} />
          </button>
        </div>
      </header>

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">
        {!selectedApp && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <PktSuiteIcon size={40} />
            <p className="text-sm text-gray-500">Select an app from the dropdown above</p>
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-500">Connecting…</p>
          </div>
        )}
        {hasTokenMismatch && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-center px-6"
            style={{ background: 'rgba(10,22,40,0.95)', backdropFilter: 'blur(4px)' }}
          >
            <div className="p-3 rounded-full" style={{ background: '#a8342a' }}>
              <ShieldAlert size={32} className="text-red-300" />
            </div>
            <div>
              <p className="text-base font-bold text-red-300">Suite Token Mismatch</p>
              <p className="text-sm text-gray-400 mt-1 max-w-sm">
                The token stored for{' '}
                <span className="font-semibold text-white">{selectedApp?.name}</span>{' '}
                doesn&apos;t match the app&apos;s current token. Proxy requests will fail until resolved.
              </p>
            </div>
            <button
              onClick={resyncToken}
              disabled={resyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: '#e04a3c' }}
            >
              <RefreshCw size={14} className={resyncing ? 'animate-spin' : ''} />
              {resyncing ? 'Syncing…' : 'Re-sync Token from App'}
            </button>
            <p className="text-xs text-gray-600">Fetches the live token from the app and updates pktHub&apos;s registry.</p>
          </div>
        )}
        {iframeSrc && (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            className="absolute inset-0 w-full h-full border-none"
            title={selectedApp?.name || 'App'}
            allow="fullscreen"
          />
        )}
      </div>
    </div>
  )
}
