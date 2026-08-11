import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { TriangleAlert, WifiOff, CircleCheck, History, X, Filter, KeyRound } from 'lucide-react'

interface AppAlert {
  id: number
  app_id: number
  app_name: string
  event_type: 'connection_lost' | 'unhealthy' | 'token_mismatch'
  status: 'active' | 'resolved'
  resolved_at: string | null
  acked_by: string | null
  acked_at: string | null
  created_at: string
  details: string
}

function fmtTime(ts: string) {
  if (!ts) return ''
  return ts.slice(0, 19).replace('T', ' ')
}

// ── History Modal ─────────────────────────────────────────────────────────────
interface HistoryModalProps { onClose: () => void; apps: string[] }
function HistoryModal({ onClose, apps }: HistoryModalProps) {
  const [rows, setRows]           = useState<AppAlert[]>([])
  const [loading, setLoading]     = useState(true)
  const [appFilter, setAppFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [start, setStart]         = useState('')
  const [end, setEnd]             = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.alertHistory({
      app_id:     appFilter ? parseInt(appFilter) : undefined,
      event_type: typeFilter   || undefined,
      status:     statusFilter || undefined,
      start:      start        || undefined,
      end:        end          || undefined,
      limit:      500,
    }).then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [appFilter, typeFilter, statusFilter, start, end])

  useEffect(() => { load() }, [load])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 rounded-xl border border-gray-700 flex flex-col max-h-[85vh] w-full max-w-4xl mx-4 shadow-2xl"
           style={{ background: '#0d1219' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <History size={15} className="text-gray-400" />
            <span className="text-sm font-semibold text-white">Alert History</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-800 flex flex-wrap gap-2 items-end">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Filter size={12} /> Filters:
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="">All types</option>
            <option value="connection_lost">Connection Lost</option>
            <option value="unhealthy">Unhealthy</option>
            <option value="token_mismatch">Token Mismatch</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-blue-500">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
          </select>
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
            title="From"
            className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-blue-500" />
          <span className="text-xs text-gray-600">→</span>
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}
            title="To"
            className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-blue-500" />
          {(typeFilter || statusFilter || start || end) && (
            <button onClick={() => { setTypeFilter(''); setStatusFilter(''); setStart(''); setEnd('') }}
              className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500">
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="text-xs text-gray-600 py-8 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-gray-600 py-8 text-center">No alerts match the current filters.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0" style={{ background: '#0d1219' }}>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-5 py-2.5 text-gray-500 font-medium">Time</th>
                  <th className="text-left px-3 py-2.5 text-gray-500 font-medium">App</th>
                  <th className="text-left px-3 py-2.5 text-gray-500 font-medium">Event</th>
                  <th className="text-left px-3 py-2.5 text-gray-500 font-medium">Status</th>
                  <th className="text-left px-3 py-2.5 text-gray-500 font-medium">Resolved</th>
                  <th className="text-left px-3 py-2.5 text-gray-500 font-medium">Acked by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="px-5 py-2.5 font-mono text-gray-500 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 text-gray-300 font-semibold">{r.app_name}</td>
                    <td className="px-3 py-2.5">
                      <EventBadge type={r.event_type} />
                    </td>
                    <td className="px-3 py-2.5">
                      {r.status === 'active'
                        ? <span className="text-red-400">Active</span>
                        : <span className="text-green-400">Resolved</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">
                      {r.resolved_at ? fmtTime(r.resolved_at) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">
                      {r.acked_by ? `${r.acked_by} @ ${fmtTime(r.acked_at!)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-2 border-t border-gray-800 text-xs text-gray-600">
          {rows.length} record{rows.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}

// ── Shared badge ──────────────────────────────────────────────────────────────
function EventBadge({ type }: { type: string }) {
  if (type === 'token_mismatch') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/30 text-red-300 border border-red-700/40">
        <KeyRound size={10} /> Token Mismatch
      </span>
    )
  }
  if (type === 'connection_lost') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/30 text-red-300 border border-red-800/30">
        <WifiOff size={10} /> Connection Lost
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/30 text-amber-300 border border-amber-800/30">
      <TriangleAlert size={10} /> Unhealthy
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AlertLogSection() {
  const [alerts, setAlerts]         = useState<AppAlert[]>([])
  const [loading, setLoading]       = useState(true)
  const [acking, setAcking]         = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [appNames, setAppNames]     = useState<string[]>([])

  const load = useCallback(() => {
    api.listAlerts()
      .then(data => {
        setAlerts(data)
        setAppNames([...new Set(data.map((a: AppAlert) => a.app_name))])
      })
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const ack = async (id: number) => {
    setAcking(id)
    try { await api.ackAlert(id); load() }
    catch { /* swallow */ }
    finally { setAcking(null) }
  }

  return (
    <>
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} apps={appNames} />}

      <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#0d1219' }}>
        {/* Section header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <TriangleAlert size={14} className={alerts.some(a => a.status === 'active') ? 'text-red-400' : 'text-gray-500'} />
            <span className="text-sm font-semibold text-white">App Alerts</span>
            {!loading && alerts.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-800/30 font-medium">
                {alerts.length}
              </span>
            )}
          </div>
          <button onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2.5 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
            <History size={12} /> History
          </button>
        </div>

        {/* Alert list */}
        {loading ? (
          <div className="text-xs text-gray-600 py-6 text-center">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="flex items-center gap-2 justify-center py-6 text-xs text-gray-600">
            <CircleCheck size={14} className="text-green-700" />
            No active alerts
          </div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {alerts.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/20 transition-colors">
                {/* Timestamp */}
                <span className="text-xs font-mono text-gray-600 shrink-0 w-36">
                  {fmtTime(a.created_at)}
                </span>

                {/* App name */}
                <span className="text-xs font-semibold text-gray-300 w-20 shrink-0 truncate">
                  {a.app_name}
                </span>

                {/* Event badge */}
                <EventBadge type={a.event_type} />

                {/* Resolved badge — same line */}
                {a.status === 'resolved' && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-900/25 text-green-400 border border-green-800/30">
                    <CircleCheck size={10} /> Resolved {a.resolved_at ? fmtTime(a.resolved_at) : ''}
                  </span>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Ack button */}
                <button
                  onClick={() => ack(a.id)}
                  disabled={acking === a.id}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-40 shrink-0">
                  {acking === a.id ? '…' : 'Ack'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
