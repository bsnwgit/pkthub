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
      <path d="M3 5 H19" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.45"/>
      <path d="M3 9 H19" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.7"/>
      <path d="M3 13 H14" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M3 17 H10" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="11.5" cy="17" r="1.3" fill={color}/>
    </svg>
  )
}
function PktFlowIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7 H15" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M12 4 L15 7 L12 10" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M19 15 H7" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.7"/>
      <path d="M10 12 L7 15 L10 18" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7"/>
    </svg>
  )
}
function PktSnmpIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="6" r="3.1" stroke={color} strokeWidth="1.3"/>
      <circle cx="11" cy="6" r="1.1" fill={color}/>
      <path d="M11 9.2 L4.5 15" stroke={color} strokeWidth="1.1" opacity="0.55"/>
      <path d="M11 9.2 L17.5 15" stroke={color} strokeWidth="1.1" opacity="0.55"/>
      <path d="M11 9.2 V15" stroke={color} strokeWidth="1.1" opacity="0.55"/>
      <circle cx="4.5" cy="17" r="1.7" stroke={color} strokeWidth="1.1"/>
      <circle cx="11" cy="17" r="1.7" stroke={color} strokeWidth="1.1"/>
      <circle cx="17.5" cy="17" r="1.7" stroke={color} strokeWidth="1.1"/>
    </svg>
  )
}
function PktPcapIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="1.3"/>
      <rect x="5.8" y="7.4" width="6.4" height="3.4" stroke={color} strokeWidth="1"/>
      <path d="M6.8 8.6 H11.2" stroke={color} strokeWidth="0.9" strokeLinecap="round"/>
      <path d="M6.8 9.9 H10" stroke={color} strokeWidth="0.9" strokeLinecap="round" opacity="0.6"/>
      <path d="M13.6 13.6 L18.4 18.4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function PktWifiIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8.4" y="15" width="5.2" height="5.2" stroke={color} strokeWidth="1.2"/>
      <circle cx="11" cy="17.6" r="0.9" fill={color}/>
      <path d="M7.6 12.6 a5 5 0 0 1 6.8 0" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M5.3 9.6 a8.6 8.6 0 0 1 11.4 0" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.65"/>
      <path d="M3 6.6 a12.4 12.4 0 0 1 16 0" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.4"/>
    </svg>
  )
}
function PktIpamIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="4.6" height="4.6" stroke={color} strokeWidth="1.2" fill={color} fillOpacity="0.16"/>
      <rect x="8.7" y="3" width="4.6" height="4.6" stroke={color} strokeWidth="1.1" opacity="0.5"/>
      <rect x="14.4" y="3" width="4.6" height="4.6" stroke={color} strokeWidth="1.2" fill={color} fillOpacity="0.16"/>
      <rect x="3" y="8.7" width="4.6" height="4.6" stroke={color} strokeWidth="1.1" opacity="0.5"/>
      <rect x="8.7" y="8.7" width="4.6" height="4.6" stroke={color} strokeWidth="1.3" fill={color} fillOpacity="0.28"/>
      <rect x="14.4" y="8.7" width="4.6" height="4.6" stroke={color} strokeWidth="1.1" opacity="0.5"/>
      <rect x="3" y="14.4" width="4.6" height="4.6" stroke={color} strokeWidth="1.2" fill={color} fillOpacity="0.16"/>
      <rect x="8.7" y="14.4" width="4.6" height="4.6" stroke={color} strokeWidth="1.1" opacity="0.5"/>
      <rect x="14.4" y="14.4" width="4.6" height="4.6" stroke={color} strokeWidth="1.2" fill={color} fillOpacity="0.16"/>
    </svg>
  )
}
function PktNodeIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.6" y="4" width="16.8" height="10.4" stroke={color} strokeWidth="1.3"/>
      <path d="M5.4 7 H11" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.55"/>
      <path d="M5.4 9.4 H8.6" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.55"/>
      <circle cx="15.4" cy="10.6" r="1.5" stroke={color} strokeWidth="1"/>
      <path d="M11 14.4 V17" stroke={color} strokeWidth="1.2"/>
      <path d="M6.6 19 H15.4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function PktSecurityIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 2.6 L18.4 5.6 V11.2 C18.4 15.4 15 18.4 11 19.8 C7 18.4 3.6 15.4 3.6 11.2 V5.6 Z"
            stroke={color} strokeWidth="1.3" strokeLinejoin="round" fill={color} fillOpacity="0.08"/>
      <path d="M7.8 11 L10 13.2 L14.4 8.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
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
                <div className="border-t px-4 py-3" style={{ borderColor: color + '20', background: '#0d1219' }}>
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
