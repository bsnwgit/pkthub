import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Monitor, Plus, Trash2, Globe, EyeOff, Copy, ExternalLink, Pencil } from 'lucide-react'
import HelpButton from '../components/HelpButton'

export default function NOCBuilderPage() {
  const { isAdmin, isAnalyst } = useAuth()
  const navigate = useNavigate()
  const [nocList, setNocList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const load = () => api.listNOC().then(setNocList).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const create = async () => {
    setCreating(true)
    try {
      const k = await api.createNOC({ ...form, layout: [] })
      setShowForm(false)
      setForm({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
      // Go straight to editor after creation
      navigate(`/noc/${k.id}/edit`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete NOC display "${name}"?`)) return
    await api.deleteNOC(id).then(load).catch(e => alert(e.message))
  }

  const publish = async (k: any) => {
    try {
      if (k.is_published) {
        await api.unpublishNOC(k.id)
      } else {
        await api.publishNOC(k.id)
      }
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const copyLink = (k: any) => {
    const url = `${window.location.origin}/display/${k.display_token}`
    navigator.clipboard.writeText(url)
    setCopied(k.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const canCreate = isAdmin || isAnalyst

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">NOC Builder</h1>
            <HelpButton title="NOC Builder — How It Works">
              <p>Each layout is a canvas of widgets pulled live from registered apps' own dashboards — build it in the editor, then Publish to get a public, unauthenticated link for a wall display or TV.</p>
              <p><span className="text-gray-300 font-medium">Static</span> mode shows one live-refreshing layout; <span className="text-gray-300 font-medium">Rotating</span> cycles through multiple slides on a timer you set per slide.</p>
              <p>Unpublishing immediately invalidates the display link — anyone with it loses access until you publish again.</p>
            </HelpButton>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">Create and publish wall display layouts</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
            style={{ background: 'linear-gradient(90deg,#a78bfa,#60a5fa)' }}
          >
            <Plus size={13} /> New NOC Display
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <div className="rounded-xl border border-purple-500/20 p-5 space-y-4" style={{ background: '#111827' }}>
          <h2 className="text-sm font-semibold text-white">New NOC Display Layout</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500"
                placeholder="NOC Wall Display" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Display Mode</label>
              <select value={form.display_mode} onChange={e => setForm(f => ({ ...f, display_mode: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500">
                <option value="static">Static (live refresh)</option>
                <option value="rotating">Rotating Slides</option>
              </select>
            </div>
            {form.display_mode === 'rotating' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Dwell Time (seconds)</label>
                <input type="number" min={5} max={300} value={form.dwell_seconds}
                  onChange={e => setForm(f => ({ ...f, dwell_seconds: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500" />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-purple-500"
                placeholder="Optional description" />
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button onClick={create} disabled={creating || !form.name}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#a78bfa' }}>
              {creating ? 'Creating…' : 'Create & Edit Layout'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
      {!loading && nocList.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-gray-800 rounded-xl" style={{ background: '#111827' }}>
          No NOC displays yet. Create one to get started.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {nocList.map(k => (
          <div key={k.id} className="rounded-xl border border-purple-500/15 p-4 space-y-3" style={{ background: '#111827' }}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">{k.name}</h3>
                {k.description && <p className="text-xs text-gray-500 mt-0.5">{k.description}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-gray-500 capitalize">{k.display_mode}</span>
                  {k.display_mode === 'rotating' && (
                    <span className="text-xs text-gray-500">{k.dwell_seconds}s</span>
                  )}
                  <span className="text-xs text-gray-600">
                    {Array.isArray(k.layout) ? `${k.layout.length} slide${k.layout.length !== 1 ? 's' : ''}` : '0 slides'}
                  </span>
                </div>
              </div>
              {canCreate && (
                <button onClick={() => del(k.id, k.name)} className="p-1.5 text-gray-600 hover:text-red-400 rounded-lg transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {/* Edit Layout button */}
            {canCreate && (
              <button
                onClick={() => navigate(`/noc/${k.id}/edit`)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors border"
                style={{ background: '#1e293b', borderColor: '#334155', color: '#94a3b8' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#6366f1'; (e.currentTarget as HTMLElement).style.color = '#a5b4fc' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#334155'; (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}
              >
                <Pencil size={11} /> Edit Layout
              </button>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-800">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${k.is_published ? 'bg-green-900/25 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                {k.is_published ? 'Published' : 'Draft'}
              </span>
              <div className="flex items-center gap-1">
                {k.is_published && k.display_token && (
                  <>
                    <button onClick={() => copyLink(k)} title="Copy display URL"
                      className="p-1.5 text-gray-400 hover:text-green-400 rounded-lg transition-colors">
                      {copied === k.id ? <span className="text-xs text-green-400">Copied!</span> : <Copy size={13} />}
                    </button>
                    <a href={`/display/${k.display_token}`} target="_blank" rel="noreferrer"
                      className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors">
                      <ExternalLink size={13} />
                    </a>
                  </>
                )}
                {canCreate && (
                  <button onClick={() => publish(k)}
                    className="p-1.5 text-gray-400 hover:text-green-400 rounded-lg transition-colors"
                    title={k.is_published ? 'Unpublish' : 'Publish'}>
                    {k.is_published ? <EyeOff size={13} /> : <Globe size={13} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Widget manifest info callout */}
      <div className="rounded-xl border border-blue-800/30 p-4 text-sm" style={{ background: '#0f1f38' }}>
        <p className="text-blue-300 font-medium mb-1">Widget Library</p>
        <p className="text-gray-400 text-xs">
          When a pktAPP app is registered, pktHub reads its <code className="text-blue-300">/api/widgets/manifest</code> endpoint
          to discover available widgets. Registered widget types appear in the editor's library for drag-and-drop placement.
          Widgets auto-update when pktApps add new ones — no hub changes needed.
        </p>
      </div>
    </div>
  )
}
