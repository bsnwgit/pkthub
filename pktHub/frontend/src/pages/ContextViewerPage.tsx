import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { PktSuiteIcon } from '../components/Logo'
import { Home, ChevronDown, Check } from 'lucide-react'

const APP_COLORS: Record<string, string> = {
  pktflow: '#60a5fa', pktsnmp: '#2dd4bf', pktlog: '#4ade80', pktpcap: '#a78bfa',
}
function appColor(name: string) {
  return APP_COLORS[(name || '').toLowerCase().replace(/[^a-z]/g, '')] || '#6b7280'
}

export default function ContextViewerPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [apps, setApps] = useState<any[]>([])
  const [selectedApp, setSelectedApp] = useState<any>(null)
  const [iframeSrc, setIframeSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.listApps().then(setApps).catch(() => {})
  }, [])

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

  const color = selectedApp ? appColor(selectedApp.name) : '#6b7280'

  return (
    <div className="flex flex-col h-screen" style={{ background: '#0a1628' }}>
      {/* Thin 44px top bar — matches ProxyShell style */}
      <header
        className="flex items-center justify-between px-4 shrink-0 border-b border-gray-800/80 z-50"
        style={{ height: 44, background: '#0d1f3c' }}
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
                color: selectedApp ? color : '#9ca3af',
                borderColor: selectedApp ? `${color}40` : '#374151',
                background: selectedApp ? `${color}10` : 'transparent',
              }}
            >
              <span>{selectedApp ? selectedApp.name : 'Select App'}</span>
              <ChevronDown size={12} />
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg border border-gray-700 py-1 shadow-xl z-50 min-w-[160px]"
                style={{ background: '#111827' }}
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
                        <span className="flex-1" style={{ color: isActive ? c : '#d1d5db' }}>
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
