import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { FileText, RefreshCw } from 'lucide-react'

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ action: '', username: '' })

  const load = () => {
    api.auditLog({ limit: 200, action: filter.action || undefined, username: filter.username || undefined })
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const ACTION_COLOR: Record<string, string> = {
    login: '#60a5fa', logout: '#6b7280', register_app: '#4ade80',
    deregister_app: '#f87171', rotate_token: '#f59e0b', create_user: '#4ade80',
    delete_user: '#f87171', update_user: '#60a5fa', create_kiosk: '#a78bfa',
    delete_kiosk: '#f87171', publish_kiosk: '#4ade80', mode_change: '#f59e0b',
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Audit Log</h1>
          <p className="text-sm text-gray-400 mt-0.5">Platform activity — stored in pktHub only</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-gray-200 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        {[
          { label: 'Action', key: 'action', placeholder: 'e.g. login' },
          { label: 'Username', key: 'username', placeholder: 'Filter by user' },
        ].map(f => (
          <div key={f.key}>
            <input
              value={(filter as any)[f.key]}
              onChange={e => setFilter(p => ({ ...p, [f.key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder={f.placeholder}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
        <button onClick={load} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 border border-gray-700 hover:border-gray-500 transition-colors">
          Filter
        </button>
      </div>

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}

      <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#111827' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              {['Timestamp', 'User', 'Action', 'Detail'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {entries.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">No entries found.</td></tr>
            )}
            {entries.map((e, i) => {
              const color = ACTION_COLOR[e.action] || '#6b7280'
              return (
                <tr key={i} className="hover:bg-white/2 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-gray-500 font-mono whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-300">{e.username}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium font-mono"
                      style={{ color, background: color + '18' }}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs truncate">{e.detail || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
