import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  Server, Plus, Trash2, RefreshCw, ExternalLink, ChevronDown, ShieldCheck, Eye
} from 'lucide-react'

const APP_COLORS: Record<string, string> = {
  pktflow: '#60a5fa', pktsnmp: '#2dd4bf', pktlog: '#4ade80', pktpcap: '#a78bfa',
}
function appColor(name: string) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#6b7280'
}

const STATUS_COLOR: Record<string, string> = {
  healthy: '#4ade80', degraded: '#f59e0b', unreachable: '#f87171', unknown: '#6b7280',
}

export default function AppManagerPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [apps, setApps] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', base_url: '', description: '' })
  const [registering, setRegistering] = useState(false)
  const [regError, setRegError] = useState('')
  const [tokenMap, setTokenMap] = useState<Record<number, string>>({})

  const load = () => {
    api.listApps().then(setApps).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const register = async () => {
    setRegError('')
    setRegistering(true)
    try {
      await api.registerApp(form)
      setForm({ name: '', base_url: '', description: '' })
      setShowForm(false)
      load()
    } catch (e: any) {
      setRegError(e.message)
    } finally {
      setRegistering(false)
    }
  }

  const deregister = async (id: number, name: string) => {
    if (!confirm(`Deregister ${name}? This removes the suite token and restores direct access.`)) return
    try {
      await api.deregisterApp(id)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const rotateToken = async (id: number) => {
    try {
      const res = await api.rotateToken(id)
      setTokenMap(m => ({ ...m, [id]: res.suite_token }))
      setTimeout(() => setTokenMap(m => { const n = { ...m }; delete n[id]; return n }), 30000)
    } catch (e: any) {
      alert(e.message)
    }
  }

  const toggleMode = async (app: any) => {
    const newMode = app.status === 'managed' ? 'observe' : 'managed'
    if (newMode === 'managed' && !confirm(`Switch ${app.name} to MANAGED mode?\n\nThis blocks direct access — all traffic must go through pktHub.`)) return
    try {
      await api.setAppStatus(app.id, newMode)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">App Manager</h1>
          <p className="text-sm text-gray-400 mt-0.5">Register, monitor, and control pktApps</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
            <RefreshCw size={13} />
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity"
              style={{ background: 'linear-gradient(90deg,#60a5fa,#2dd4bf)' }}
            >
              <Plus size={13} /> Register App
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-900/15 border border-red-800/20 rounded-lg px-4 py-3">{error}</div>}

      {/* Register form */}
      {showForm && isAdmin && (
        <div className="rounded-xl border border-blue-500/20 p-5 space-y-4" style={{ background: '#111827' }}>
          <h2 className="text-sm font-semibold text-white">Register New App</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">App Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="pktAPP" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Base URL</label>
              <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="https://172.23.80.5:8766" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="Real-time NetFlow analysis" />
            </div>
          </div>
          {regError && <div className="text-xs text-red-400">{regError}</div>}
          <div className="flex gap-2">
            <button onClick={register} disabled={registering || !form.name || !form.base_url}
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

      {/* App list */}
      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
      {!loading && apps.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-gray-800 rounded-xl" style={{ background: '#111827' }}>
          No apps registered. Click "Register App" to add one.
        </div>
      )}

      <div className="space-y-3">
        {apps.map(app => {
          const color = appColor(app.name)
          const statusColor = STATUS_COLOR[app.health_status] || '#6b7280'
          return (
            <div key={app.id} className="rounded-xl border p-4" style={{ background: '#111827', borderColor: color + '25' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <div className="w-3 h-3 rounded-full" style={{ background: statusColor }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">{app.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${app.status === 'managed' ? 'bg-orange-900/30 text-orange-300' : 'bg-blue-900/20 text-blue-300'}`}>
                        {app.status === 'managed' ? '🔒 Managed' : '👁 Observe'}
                      </span>
                    </div>
                    {app.description && <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>}
                    <p className="text-xs text-gray-600 mt-1 font-mono">{app.base_url}</p>
                    {tokenMap[app.id] && (
                      <div className="mt-2 p-2 rounded-lg bg-gray-800 border border-gray-700">
                        <p className="text-xs text-yellow-400 mb-1">Suite token (shown once — copy now):</p>
                        <code className="text-xs text-gray-200 break-all">{tokenMap[app.id]}</code>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => navigate(`/proxy/${app.id}`)}
                    title="Open in proxy"
                    className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    <ExternalLink size={14} />
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => toggleMode(app)}
                        title={app.status === 'managed' ? 'Switch to Observe' : 'Switch to Managed'}
                        className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        {app.status === 'managed' ? <Eye size={14} /> : <ShieldCheck size={14} />}
                      </button>
                      <button
                        onClick={() => rotateToken(app.id)}
                        title="Rotate suite token"
                        className="p-1.5 text-gray-400 hover:text-yellow-400 rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => deregister(app.id, app.name)}
                        title="Deregister"
                        className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
