import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  Plus, Trash2, RefreshCw, ExternalLink, ChevronDown,
  ShieldCheck, Eye, X, CircleCheck, CircleAlert
} from 'lucide-react'
import AlertLogSection from '../components/AlertLogSection'

// ── Styled confirmation modal ─────────────────────────────────────────────────
interface ModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}
function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 rounded-xl border border-gray-700 p-6 max-w-md w-full mx-4 shadow-2xl" style={{ background: '#0d1117' }}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 ml-4"><X size={16} /></button>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line mb-6">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const APP_COLORS: Record<string, string> = {
  pktflow: '#60a5fa', pktsnmp: '#2dd4bf', pktlog: '#4ade80', pktpcap: '#a78bfa',
}
function appColor(name: string) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#6b7280'
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
      <path d="M3 3 H19 L13 10.5 V18 L9 20 V10.5 Z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}
function AppLogoIcon({ name, color }: { name: string; color: string }) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  if (key === 'pktlog')  return <PktLogIcon  color={color} />
  if (key === 'pktflow') return <PktFlowIcon color={color} />
  if (key === 'pktsnmp') return <PktSnmpIcon color={color} />
  if (key === 'pktpcap') return <PktPcapIcon color={color} />
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
           style={{ background: statusColor, borderColor: '#111827' }} />
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = {
  healthy: '#4ade80', degraded: '#f59e0b', unreachable: '#f87171', unknown: '#6b7280',
}

interface FeedbackState { appId: number; status: 'verifying' | 'ok' | 'fail'; message: string }
interface ModalState {
  open: boolean; title: string; message: string
  confirmLabel: string; danger: boolean; onConfirm: () => void
}

export default function AppManagerPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [apps, setApps]             = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({ name: '', base_url: '', description: '', suite_token: '' })
  const [registering, setRegistering] = useState(false)
  const [regError, setRegError]     = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle'|'checking'|'ok'|'fail'>('idle')
  const [tokenMap, setTokenMap]     = useState<Record<number, string>>({})
  const [feedback, setFeedback]     = useState<FeedbackState | null>(null)
  const [modal, setModal]           = useState<ModalState>({
    open: false, title: '', message: '', confirmLabel: 'Confirm', danger: false, onConfirm: () => {}
  })
  const [expandedApp, setExpandedApp] = useState<number | null>(null)
  const [auditLogs, setAuditLogs]   = useState<Record<number, any[]>>({})
  const [logsLoading, setLogsLoading] = useState<Record<number, boolean>>({})
  const [bulkWorking, setBulkWorking] = useState(false)
  const [alerts, setAlerts] = useState<any[]>([])

  const closeModal = () => setModal(m => ({ ...m, open: false }))

  const showConfirm = (opts: {
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void
  }) => {
    setModal({
      open: true,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      danger: opts.danger ?? false,
      onConfirm: () => { closeModal(); opts.onConfirm() },
    })
  }

  const load = () => {
    setLoading(true)
    Promise.all([api.listApps(), api.listAlerts()])
      .then(([appsData, alertsData]) => { setApps(appsData); setAlerts(alertsData) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const showFeedback = (appId: number, status: FeedbackState['status'], message: string) => {
    setFeedback({ appId, status, message })
    if (status !== 'verifying') {
      setTimeout(() => setFeedback(f => f?.appId === appId ? null : f), 6000)
    }
  }

  const register = async () => {
    setRegError(''); setRegistering(true)
    try {
      await api.registerApp(form)
      setForm({ name: '', base_url: '', description: '', suite_token: '' })
      setShowForm(false); load()
    } catch (e: any) { setRegError(e.message) }
    finally { setRegistering(false) }
  }

  const verifyUrl = async (url: string) => {
    if (!url) return
    setVerifyStatus('checking')
    try {
      await fetch(`${url.replace(/\/$/, '')}/api/health`, {
        method: 'GET', mode: 'no-cors', signal: AbortSignal.timeout(6000),
      })
      setVerifyStatus('ok')
    } catch { setVerifyStatus('fail') }
  }

  const deregister = (id: number, name: string) => {
    showConfirm({
      title: `Deregister ${name}?`,
      message: 'This removes the suite token and restores direct access to the app.\nThe app will no longer be accessible through pktHub proxy.',
      confirmLabel: 'Deregister', danger: true,
      onConfirm: async () => {
        try { await api.deregisterApp(id); load() }
        catch (e: any) { setError(e.message) }
      },
    })
  }

  const rotateToken = async (id: number) => {
    try {
      const res = await api.rotateToken(id)
      setTokenMap(m => ({ ...m, [id]: res.suite_token }))
      setTimeout(() => setTokenMap(m => { const n = { ...m }; delete n[id]; return n }), 30000)
    } catch (e: any) { setError(e.message) }
  }

  const resyncTokenHandler = async (appId: number, appName: string) => {
    showFeedback(appId, 'verifying', 'Syncing token from app…')
    try {
      await api.resyncToken(appId)
      showFeedback(appId, 'ok', 'Token synced — mismatch resolved ✓')
      load()
    } catch (e: any) {
      showFeedback(appId, 'fail', e.message || 'Token sync failed')
    }
  }

  const toggleMode = (app: any) => {
    const toLocked = app.access_mode !== 'managed'
    showConfirm({
      title: toLocked ? `Enable Managed Mode — ${app.name}` : `Disable Managed Mode — ${app.name}`,
      message: toLocked
        ? `This will block direct URL access to ${app.name}.\nAll users must go through pktHub.\n\nA hub_redirect_url must be configured in the app's Settings → Integrations.\nThe hub will verify the lock took effect before confirming.`
        : `This will restore direct URL access to ${app.name}.\nUsers will be able to bypass pktHub again.`,
      confirmLabel: toLocked ? 'Enable Managed Mode' : 'Disable Managed Mode',
      onConfirm: async () => {
        showFeedback(app.id, 'verifying', toLocked ? 'Applying lock…' : 'Removing lock…')
        try {
          const res = await api.setDirectAccess(app.id, toLocked)
          if (res.verified === false) {
            showFeedback(app.id, 'fail', res.detail || 'Lock command sent but verification failed')
          } else {
            showFeedback(app.id, 'ok', toLocked ? 'Managed mode active — lock verified ✓' : 'Direct access restored')
          }
          load()
        } catch (e: any) { showFeedback(app.id, 'fail', e.message || 'Failed') }
      },
    })
  }

  const bulkSetManaged = (toLocked: boolean) => {
    showConfirm({
      title: toLocked ? 'Set All Apps to Managed?' : 'Restore Direct Access for All Apps?',
      message: toLocked
        ? 'This will attempt to enable managed mode on all registered apps.\nEach app must have a hub_redirect_url configured in Settings → Integrations.'
        : 'This will restore direct URL access on all registered apps.',
      confirmLabel: toLocked ? 'Enable All' : 'Restore All', danger: !toLocked,
      onConfirm: async () => {
        setBulkWorking(true)
        try { await api.bulkDirectAccess(toLocked); load() }
        catch (e: any) { setError(e.message) }
        finally { setBulkWorking(false) }
      },
    })
  }

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
      <ConfirmModal
        open={modal.open} title={modal.title} message={modal.message}
        confirmLabel={modal.confirmLabel} danger={modal.danger}
        onConfirm={modal.onConfirm} onCancel={closeModal}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">App Registry</h1>
          <p className="text-sm text-gray-400 mt-0.5">Register, monitor, and control pktApps</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && apps.length > 0 && (
            <>
              <button onClick={() => bulkSetManaged(true)} disabled={bulkWorking}
                className="text-xs px-3 py-1.5 rounded-lg border border-orange-700/50 text-orange-300 hover:border-orange-500 hover:text-orange-200 transition-colors disabled:opacity-40">
                {bulkWorking ? '…' : 'Set All Managed'}
              </button>
              <button onClick={() => bulkSetManaged(false)} disabled={bulkWorking}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40">
                Restore All Direct
              </button>
            </>
          )}
          <button onClick={load}
            className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
            <RefreshCw size={13} />
          </button>
          {isAdmin && (
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
              style={{ background: 'linear-gradient(90deg,#60a5fa,#2dd4bf)' }}>
              <Plus size={13} /> Register App
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/15 border border-red-800/20 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Register form */}
      {showForm && isAdmin && (
        <div className="rounded-xl border border-blue-500/20 p-5 space-y-4" style={{ background: '#111827' }}>
          <h2 className="text-sm font-semibold text-white">Register New App</h2>
          <p className="text-xs text-blue-300/80 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2">
            Get the Suite Token from the pktApp: <strong>Settings → Integrations → pktHub Integration → Copy Token</strong>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">App Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="pktLog" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="Real-time log analysis" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Base URL</label>
              <div className="flex gap-2">
                <input value={form.base_url}
                  onChange={e => { setForm(f => ({ ...f, base_url: e.target.value })); setVerifyStatus('idle') }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="https://172.23.80.5:8766" />
                <button onClick={() => verifyUrl(form.base_url)}
                  disabled={!form.base_url || verifyStatus === 'checking'}
                  className="px-3 py-2 rounded-lg text-xs border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 disabled:opacity-40 whitespace-nowrap bg-gray-800">
                  {verifyStatus === 'checking' ? '…' : verifyStatus === 'ok' ? '✓ OK' : verifyStatus === 'fail' ? '✗ Fail' : 'Verify'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Suite Token <span className="text-red-400">*</span></label>
              <input value={form.suite_token} onChange={e => setForm(f => ({ ...f, suite_token: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500 font-mono"
                placeholder="Paste token from pktApp Settings → Integrations" />
            </div>
          </div>
          {regError && <div className="text-xs text-red-400">{regError}</div>}
          <div className="flex gap-2">
            <button onClick={register} disabled={registering || !form.name || !form.base_url || !form.suite_token}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#60a5fa' }}>
              {registering ? 'Registering…' : 'Register'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
      {!loading && apps.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-gray-800 rounded-xl" style={{ background: '#111827' }}>
          No apps registered. Click "Register App" to add one.
        </div>
      )}

      {/* App list */}
      <div className="space-y-3">
        {apps.map(app => {
          const color      = appColor(app.name)
          const statusColor = STATUS_COLOR[app.health_status] || '#6b7280'
          const isManaged  = app.access_mode === 'managed'
          const hasMismatch = alerts.some(
            (a: any) => a.app_id === app.id && a.event_type === 'token_mismatch' && a.status === 'active'
          )
          const fb         = feedback?.appId === app.id ? feedback : null
          const logs       = auditLogs[app.id] || []
          const logsOpen   = expandedApp === app.id

          return (
            <div key={app.id} className="rounded-xl border overflow-hidden" style={{ background: '#111827', borderColor: color + '25' }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: status dot + info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <AppLogo name={app.name} statusColor={statusColor} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-white">{app.name}</h3>
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
                            ⚠️ Token Mismatch
                          </span>
                        )}
                      </div>
                      {app.description && <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>}
                      <p className="text-xs text-gray-600 mt-1 font-mono truncate">{app.base_url}</p>

                      {/* Inline feedback */}
                      {fb && (
                        <div className={`mt-2 flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
                          fb.status === 'ok'       ? 'bg-green-900/20 text-green-400 border border-green-800/20' :
                          fb.status === 'fail'     ? 'bg-red-900/20 text-red-400 border border-red-800/20' :
                                                     'bg-blue-900/20 text-blue-400 border border-blue-800/20'
                        }`}>
                          {fb.status === 'ok'       && <CircleCheck size={12} />}
                          {fb.status === 'fail'     && <CircleAlert size={12} />}
                          {fb.status === 'verifying' && <RefreshCw size={12} className="animate-spin" />}
                          <span>{fb.message}</span>
                        </div>
                      )}

                      {/* Rotated token display */}
                      {tokenMap[app.id] && (
                        <div className="mt-2 p-2 rounded-lg bg-gray-800 border border-gray-700">
                          <p className="text-xs text-yellow-400 mb-1">Suite token (shown once — copy now):</p>
                          <code className="text-xs text-gray-200 break-all">{tokenMap[app.id]}</code>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => navigate(`/proxy/${app.id}`)} title="Open in proxy"
                      className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors">
                      <ExternalLink size={14} />
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => toggleMode(app)}
                          title={isManaged ? 'Disable Managed Mode' : 'Enable Managed Mode'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isManaged
                              ? 'text-orange-400 hover:text-orange-200 hover:bg-orange-900/20'
                              : 'text-gray-400 hover:text-white hover:bg-gray-700'
                          }`}>
                          {isManaged ? <Eye size={14} /> : <ShieldCheck size={14} />}
                        </button>
                        <button onClick={() => toggleAuditLog(app.id)} title="Access log"
                          className={`p-1.5 rounded-lg transition-colors ${logsOpen ? 'text-blue-400 bg-blue-900/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                          <ChevronDown size={14} className={`transition-transform duration-200 ${logsOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {hasMismatch && isAdmin && (
                          <button
                            onClick={() => resyncTokenHandler(app.id, app.name)}
                            title="Re-sync suite token from app"
                            className="p-1.5 text-red-400 hover:text-red-200 rounded-lg hover:bg-red-900/20 transition-colors">
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button onClick={() => rotateToken(app.id)} title="Rotate suite token"
                          className="p-1.5 text-gray-400 hover:text-yellow-400 rounded-lg hover:bg-gray-700 transition-colors">
                          <RefreshCw size={14} />
                        </button>
                        <button onClick={() => deregister(app.id, app.name)} title="Deregister"
                          className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-700 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
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

      {/* App Alert Log */}
      <AlertLogSection />
    </div>
  )
}
