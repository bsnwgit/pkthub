import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { ExternalLink, ChevronDown, Settings as SettingsIcon } from 'lucide-react'
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

// ── Per-app inline SVG icons ──────────────────────────────────────────────────
function PktLogIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="3.5" width="18" height="2.5" rx="1.25" fill={color} opacity="0.95" />
      <rect x="2" y="9.75" width="13" height="2.5" rx="1.25" fill={color} opacity="0.70" />
      <rect x="2" y="16" width="8" height="2.5" rx="1.25" fill={color} opacity="0.45" />
    </svg>
  )
}
function PktFlowIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 7 H14 L10 3.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95"/>
      <path d="M14 7 L10 10.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95"/>
      <path d="M20 15 H8 L12 11.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.65"/>
      <path d="M8 15 L12 18.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.65"/>
    </svg>
  )
}
function PktSnmpIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="4.5" r="2.5" fill={color} opacity="0.95"/>
      <circle cx="4"  cy="17"  r="2"   fill={color} opacity="0.80"/>
      <circle cx="18" cy="17"  r="2"   fill={color} opacity="0.80"/>
      <circle cx="11" cy="17"  r="2"   fill={color} opacity="0.60"/>
      <line x1="11" y1="7"  x2="4"  y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
      <line x1="11" y1="7"  x2="18" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
      <line x1="11" y1="7"  x2="11" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.35"/>
    </svg>
  )
}
function PktPcapIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="9" r="6.3" stroke={color} strokeWidth="1.7"/>
      <rect x="6" y="7.7" width="6" height="3.1" rx="0.6" stroke={color} strokeWidth="1"/>
      <line x1="6.9" y1="8.5" x2="11.1" y2="8.5" stroke={color} strokeWidth="0.8" strokeLinecap="round"/>
      <line x1="6.9" y1="9.5" x2="11.1" y2="9.5" stroke={color} strokeWidth="0.8" strokeLinecap="round"/>
      <line x1="14" y1="14" x2="18.3" y2="18.3" stroke={color} strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  )
}
function PktWifiIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8.5 C7 3.5, 15 3.5, 20 8.5" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.45"/>
      <path d="M5.5 12 C9 8.75, 13 8.75, 16.5 12" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.70"/>
      <path d="M9 15.5 C10.2 14.3, 11.8 14.3, 13 15.5" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.95"/>
      <circle cx="11" cy="18.5" r="1.4" fill={color} opacity="0.95"/>
    </svg>
  )
}
function PktIpamIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="3" width="7" height="7" rx="1.5" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5"/>
      <rect x="13" y="3" width="7" height="7" rx="1.5" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5"/>
      <rect x="7.5" y="13" width="7" height="7" rx="1.5" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M5.5 10 V13 M16.5 10 V13 M5.5 13 H16.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
    </svg>
  )
}
function PktNodeIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="16" height="10" rx="1.5" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1.5"/>
      <line x1="11" y1="13" x2="11" y2="16.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
      <line x1="6" y1="19" x2="16" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.85"/>
      <circle cx="11" cy="8" r="2" fill={color} opacity="0.6"/>
    </svg>
  )
}
function PktSecurityIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 2.5 L18.5 5.5 V11 C18.5 15.5 15.3 18.7 11 19.8 C6.7 18.7 3.5 15.5 3.5 11 V5.5 Z"
            fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M7.7 11 L9.9 13.2 L14.5 8.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
    </svg>
  )
}
function AppLogoIcon({ name, color }: { name: string; color: string }) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  if (key === 'pktlog')      return <PktLogIcon      color={color} />
  if (key === 'pktflow')     return <PktFlowIcon     color={color} />
  if (key === 'pktsnmp')     return <PktSnmpIcon     color={color} />
  if (key === 'pktpcap')     return <PktPcapIcon     color={color} />
  if (key === 'pktwifi')     return <PktWifiIcon     color={color} />
  if (key === 'pktipam')     return <PktIpamIcon     color={color} />
  if (key === 'pktnode')     return <PktNodeIcon     color={color} />
  if (key === 'pktsecurity') return <PktSecurityIcon color={color} />
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="16" height="16" rx="4" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      <circle cx="11" cy="11" r="3" fill={color} opacity="0.7"/>
    </svg>
  )
}
function AppLogo({ name, statusColor }: { name: string; statusColor: string }) {
  const color = appColor(name)
  return (
    <div className="relative shrink-0">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center"
           style={{ background: color + '16', border: `1px solid ${color}28` }}>
        <AppLogoIcon name={name} color={color} />
      </div>
      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
           style={{ background: statusColor, borderColor: '#0d1219' }} />
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = {
  healthy: '#9aeabd', degraded: '#f3c265', unreachable: '#ff8478', unknown: '#a9a294',
}

// ── Read-only app registry view for all roles ─────────────────────────────────
// Admin actions (register/edit/rotate token/managed-mode/deregister) live in
// Settings → Security → Suite Integration, gated adminOnly there since they
// touch credentials. This page stays the day-to-day view every role uses to
// monitor health and jump into a registered app's context.
export default function AppManagerPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [apps, setApps]             = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [alerts, setAlerts]         = useState<any[]>([])
  const [expandedApp, setExpandedApp] = useState<number | null>(null)
  const [auditLogs, setAuditLogs]   = useState<Record<number, any[]>>({})
  const [logsLoading, setLogsLoading] = useState<Record<number, boolean>>({})

  const load = () => {
    setLoading(true)
    Promise.all([api.listApps(), api.listAlerts()])
      .then(([appsData, alertsData]) => { setApps(appsData); setAlerts(alertsData) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const toggleAuditLog = async (appId: number) => {
    if (expandedApp === appId) { setExpandedApp(null); return }
    setExpandedApp(appId)
    if (auditLogs[appId]) return
    setLogsLoading(l => ({ ...l, [appId]: true }))
    try {
      const logs = await api.getAppAccessLog(appId)
      setAuditLogs(l => ({ ...l, [appId]: logs }))
    } catch { setAuditLogs(l => ({ ...l, [appId]: [] })) }
    finally { setLogsLoading(l => ({ ...l, [appId]: false })) }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">App Registry</h1>
            <HelpButton title="App Registry — How It Works">
              <p>The day-to-day view of every registered app's health and access mode. Registering a new app, rotating its token, or deregistering it are admin actions kept in Settings → Security → Suite Integration since they touch credentials.</p>
              <p>Expand an app to see its recent proxy access log — who opened it and when.</p>
            </HelpButton>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">Monitor and access registered pktApps</p>
        </div>
        {isAdmin && (
          <button onClick={() => navigate('/settings?tab=security&securityTab=suite')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white border border-gray-700 hover:border-gray-500 transition-colors">
            <SettingsIcon size={13} /> Manage in Settings
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/15 border border-red-800/20 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
      {!loading && apps.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-gray-800 rounded-xl" style={{ background: '#0d1219' }}>
          No apps registered.{isAdmin && ' Register one from Settings → Security → Suite Integration.'}
        </div>
      )}

      {/* App list */}
      <div className="space-y-3">
        {apps.map(app => {
          const color      = appColor(app.name)
          const statusColor = STATUS_COLOR[app.health_status] || '#a9a294'
          const isManaged  = app.access_mode === 'managed'
          const hasMismatch = alerts.some(
            (a: any) => a.app_id === app.id && a.event_type === 'token_mismatch' && a.status === 'active'
          )
          const logs       = auditLogs[app.id] || []
          const logsOpen   = expandedApp === app.id

          return (
            <div key={app.id} className="rounded-xl border overflow-hidden" style={{ background: '#0d1219', borderColor: color + '25' }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: status dot + info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <AppLogo name={app.name} statusColor={statusColor} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-white">{app.name}</h3>
                        {/* Health status chip */}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                          app.health_status === 'healthy'     ? 'bg-green-900/25 text-green-400 border-green-800/30' :
                          app.health_status === 'degraded'    ? 'bg-amber-900/30 text-amber-300 border-amber-800/30' :
                          app.health_status === 'unreachable' ? 'bg-red-900/25 text-red-400 border-red-800/30' :
                                                                'bg-gray-800/60 text-gray-500 border-gray-700/30'
                        }`}>
                          {(app.health_status || 'unknown').charAt(0).toUpperCase() + (app.health_status || 'unknown').slice(1)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                          isManaged
                            ? 'bg-orange-900/30 text-orange-300 border-orange-700/30'
                            : 'bg-blue-900/20 text-blue-300 border-blue-800/20'
                        }`}>
                          {isManaged ? '🔒 Managed' : '👁 Direct'}
                        </span>
                        {isManaged && app.lock_verified_at && (
                          <span className="text-xs text-green-600/80">lock verified</span>
                        )}
                        {hasMismatch && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium border bg-red-900/30 text-red-300 border-red-700/30 animate-pulse">
                            ⚠️ Token Mismatch{isAdmin && ' — resolve in Settings'}
                          </span>
                        )}
                      </div>
                      {app.description && <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>}
                      <p className="text-xs text-gray-600 mt-1 font-mono truncate">{app.base_url}</p>
                    </div>
                  </div>

                  {/* Right: action buttons — available to every role */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => navigate(`/context?app=${app.id}`)} title="Open in Context"
                      className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors">
                      <ExternalLink size={14} />
                    </button>
                    <button onClick={() => toggleAuditLog(app.id)} title="Access log"
                      className={`p-1.5 rounded-lg transition-colors ${logsOpen ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${logsOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Expandable audit log */}
              {logsOpen && (
                <div className="border-t px-4 py-3" style={{ borderColor: color + '20', background: '#0d1117' }}>
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Access Mode Audit Log</p>
                  {logsLoading[app.id] ? (
                    <p className="text-xs text-gray-600 py-2">Loading…</p>
                  ) : logs.length === 0 ? (
                    <p className="text-xs text-gray-600 py-2">No direct-access events recorded yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {logs.map((entry: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 text-xs">
                          <span className="text-gray-600 font-mono shrink-0">
                            {(entry.created_at || '').slice(0, 19).replace('T', ' ')}
                          </span>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${
                            (entry.action || '').includes('lock') || (entry.action || '').includes('managed')
                              ? 'bg-orange-900/30 text-orange-300'
                              : 'bg-blue-900/20 text-blue-300'
                          }`}>
                            {(entry.action || '').replace('app.', '')}
                          </span>
                          <span className="text-gray-500">{entry.username}</span>
                          {entry.details && (
                            <span className="text-gray-600 truncate">
                              {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
