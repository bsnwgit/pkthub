import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { FileText, RefreshCw } from 'lucide-react'
import HelpButton from '../components/HelpButton'

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100]
// Backend caps `limit` at 500 and has no total-count field on this endpoint,
// so pagination is done client-side over the most recent 500 matching entries
// rather than a true server-paginated total.
const FETCH_CAP = 500

/**
 * Page-number bar: shows every page when there are 5 or fewer, otherwise
 * pages 1-5, an ellipsis, then the last page — plus prev/next buttons.
 */
function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  const blockStart = Math.floor((page - 1) / 5) * 5 + 1
  const blockEnd   = Math.min(blockStart + 4, totalPages)
  const pages = Array.from({ length: blockEnd - blockStart + 1 }, (_, i) => blockStart + i)
  const btn = (p: number) => [
    'text-xs min-w-[1.75rem] px-2 py-1 rounded-lg border transition-colors',
    p === page
      ? 'bg-blue-600/30 border-blue-500 text-blue-200'
      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white',
  ].join(' ')
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ← Prev
      </button>
      {blockStart > 1 && (
        <>
          <button onClick={() => onChange(1)} className={btn(1)}>1</button>
          <span className="px-1 text-gray-500 text-xs">..</span>
        </>
      )}
      {pages.map(p => <button key={p} onClick={() => onChange(p)} className={btn(p)}>{p}</button>)}
      {blockEnd < totalPages && (
        <>
          <span className="px-1 text-gray-500 text-xs">..</span>
          <button onClick={() => onChange(totalPages)} className={btn(totalPages)}>{totalPages}</button>
        </>
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next →
      </button>
    </div>
  )
}

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ action: '', username: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const load = () => {
    api.auditLog({ limit: FETCH_CAP, action: filter.action || undefined, username: filter.username || undefined })
      .then(entries => { setEntries(entries); setPage(1) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const changePageSize = (size: number) => { setPageSize(size); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const pagedEntries = entries.slice((pageClamped - 1) * pageSize, pageClamped * pageSize)

  const ACTION_COLOR: Record<string, string> = {
    login: '#8ad8ea', logout: '#a9a294', register_app: '#9aeabd',
    deregister_app: '#ff8478', rotate_token: '#f3c265', create_user: '#9aeabd',
    delete_user: '#ff8478', update_user: '#8ad8ea', create_kiosk: '#b0a0dd',
    delete_kiosk: '#ff8478', publish_kiosk: '#9aeabd', mode_change: '#f3c265',
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">Audit Log</h1>
            <HelpButton title="Audit Log — How It Works">
              <p>Records pktHub-level actions only — login/logout, app registration and token rotation, user management, and NOC publish/mode changes. Activity inside a proxied app (e.g. changes made in pktSNMP) is logged by that app itself, not here.</p>
              <p>The most recent 500 matching entries are fetched and paginated client-side, so filters narrow within that window rather than a true server-side search.</p>
            </HelpButton>
          </div>
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

      {!loading && entries.length > 0 && (
        <div className="flex items-center justify-center gap-6">
          <Pagination page={pageClamped} totalPages={totalPages} onChange={setPage} />
          <div className="flex items-center gap-2">
            <label htmlFor="audit-per-page" className="text-xs text-gray-400">Entries per page:</label>
            <select
              id="audit-per-page"
              value={pageSize}
              onChange={e => changePageSize(Number(e.target.value))}
              className="text-sm bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 focus:outline-none focus:border-sky-500"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="f-tbl-scroll rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#0d1219' }}>
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
            {pagedEntries.map((e, i) => {
              const color = ACTION_COLOR[e.action] || '#a9a294'
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

      {!loading && entries.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {((pageClamped - 1) * pageSize + 1).toLocaleString()}–{((pageClamped - 1) * pageSize + pagedEntries.length).toLocaleString()} of {entries.length.toLocaleString()} entries
            {entries.length === FETCH_CAP && <> (most recent {FETCH_CAP})</>}
          </span>
          <Pagination page={pageClamped} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  )
}
