import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Activity, Server, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react'
import AlertLogSection from '../components/AlertLogSection'
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
  const key = name?.toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#a9a294'
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: any }> = {
    healthy: { label: 'Healthy', color: '#9aeabd', icon: CheckCircle },
    degraded: { label: 'Degraded', color: '#f3c265', icon: AlertTriangle },
    unreachable: { label: 'Unreachable', color: '#ff8478', icon: XCircle },
    unknown: { label: 'Unknown', color: '#a9a294', icon: Clock },
  }
  const s = map[status] || map.unknown
  const Icon = s.icon
  return (
    <span className="flex items-center gap-1 text-xs font-medium" style={{ color: s.color }}>
      <Icon size={12} />
      {s.label}
    </span>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const load = () => api.dashboard().then(setData).catch(e => setError(e.message))

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const stats = data ? [
    { label: 'Total Apps', value: data.summary?.total_apps ?? 0, color: '#8ad8ea' },
    { label: 'Healthy', value: data.summary?.healthy ?? 0, color: '#9aeabd' },
    { label: 'Degraded', value: data.summary?.degraded ?? 0, color: '#f3c265' },
    { label: 'Unreachable', value: data.summary?.unreachable ?? 0, color: '#ff8478' },
  ] : []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">Dashboard</h1>
            <HelpButton title="Dashboard — How It Works">
              <p>Health status is polled from each registered app's own health endpoint every refresh — <span className="text-gray-300 font-medium">Degraded</span> means it responded but reported a problem, <span className="text-gray-300 font-medium">Unreachable</span> means pktHub couldn't reach it at all.</p>
              <p>Click an app card to open that app inside pktHub, on its own first page and without a separate login. An app that publishes a menu also has it mirrored under <span className="text-gray-300 font-medium">Apps</span> in the sidebar, so you can move around it without coming back here.</p>
            </HelpButton>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">Platform overview — live health across all registered pktApps</p>
        </div>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm text-red-400 bg-red-900/15 border border-red-800/20">
          {error}
        </div>
      )}

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl p-4 border border-gray-800" style={{ background: '#0d1219' }}>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-3xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Audit events 24h */}
      {data?.summary?.audit_events_24h !== undefined && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Activity size={14} />
          <span><strong className="text-white">{data.summary.audit_events_24h}</strong> audit events in the last 24h</span>
        </div>
      )}

      {/* App cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Registered Apps</h2>
        {!data && !error && (
          <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
        )}
        {data?.apps?.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center border border-gray-800 rounded-xl" style={{ background: '#0d1219' }}>
            No apps registered yet. Go to <button onClick={() => navigate('/apps')} className="text-blue-400 hover:underline">App Manager</button> to add one.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data?.apps?.map((app: any) => {
            const color = appColor(app.name)
            return (
              <div
                key={app.id}
                className="rounded-xl border p-4 cursor-pointer hover:border-opacity-60 transition-colors"
                style={{ background: '#0d1219', borderColor: color + '33' }}
                onClick={() => navigate(`/app/${app.id}/`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <h3 className="text-sm font-semibold text-white">{app.name}</h3>
                  </div>
                  <StatusBadge status={app.health_status || 'unknown'} />
                </div>
                <p className="text-xs text-gray-500 mb-2">{app.base_url}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${app.access_mode === 'managed' ? 'bg-orange-900/30 text-orange-400' : 'bg-blue-900/20 text-blue-400'}`}>
                    {app.access_mode === 'managed' ? 'Managed' : 'Observe'}
                  </span>
                  <span className="text-xs text-gray-500">Open &rarr;</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* App Alert Log */}
      <AlertLogSection />
    </div>
  )
}
