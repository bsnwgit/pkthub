import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { InstrumentHead } from './instrument'

// Any widget a registered app publishes to the NOC Builder can also sit on the
// Dashboard. Tiles are the same server-rendered pages the NOC loads, reached
// through the authenticated proxy, so they cannot drift from the NOC's version.

interface ParamOption { value: string; label: string }
interface Param { key: string; label: string; options?: ParamOption[]; options_path?: string }
interface ManifestEntry {
  id: string; title: string; description?: string; category?: string; params?: Param[]
}
interface AppWithWidgets { id: number; name: string; widget_manifest: ManifestEntry[] }
interface Saved {
  app_id: number; app_name: string | null; widget_id: string; title: string
  view_path: string | null; size: 's' | 'm' | 'l'; config: Record<string, string>; missing: boolean
}

const HEIGHT: Record<string, number> = { s: 240, m: 320, l: 440 }
const SPAN: Record<string, string> = { s: '', m: '', l: 'md:col-span-2' }

function resolvePath(template: string, cfg: Record<string, string>): string | null {
  let unresolved = false
  const path = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!cfg[k]) { unresolved = true; return '' }
    return encodeURIComponent(cfg[k])
  })
  return unresolved ? null : path
}

function frameSrc(w: Saved, refresh: number): string | null {
  if (!w.view_path) return null
  const qs = new URLSearchParams()
  Object.entries(w.config).forEach(([k, v]) => { if (v !== '') qs.set(k, v) })
  qs.set('refresh', String(refresh))
  return `/proxy/${w.app_id}${w.view_path}?${qs.toString()}`
}

export default function DashboardWidgets() {
  const { isAdmin } = useAuth()
  const [saved, setSaved]     = useState<Saved[] | null>(null)
  const [refresh, setRefresh] = useState(30)
  const [ready, setReady]     = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)

  const load = () => api.dashboardWidgets()
    .then((d: any) => { setSaved(d.widgets); setRefresh(d.widget_refresh || 30) })
    .catch(() => setSaved([]))
  useEffect(() => { load() }, [])

  // Each app's tiles load through a proxy session that has to exist first.
  useEffect(() => {
    if (!saved) return
    saved.forEach(w => {
      if (ready.has(w.app_id) || !w.view_path) return
      api.createProxySession(w.app_id)
        .then(() => setReady(prev => new Set(prev).add(w.app_id)))
        .catch(() => {})
    })
  }, [saved])

  // Nothing placed and nobody who can place anything: show nothing, not a box.
  if (saved === null || (saved.length === 0 && !isAdmin)) return null

  return (
    <section className="space-y-3">
      <InstrumentHead right={isAdmin ? (
        <button onClick={() => setEditing(true)} className="f-chip f-chip-gold px-2.5 py-1 text-xs flex items-center gap-1.5">
          <SlidersHorizontal size={12} /> Edit widgets
        </button>
      ) : undefined}>Live widgets</InstrumentHead>

      {saved.length === 0 && (
        <div className="f-panel p-6 text-center text-sm text-gray-400">
          No widgets yet. Use <span className="text-white">Edit widgets</span> to place any graph an app publishes.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {saved.map((w, i) => {
          const src = ready.has(w.app_id) ? frameSrc(w, refresh) : null
          return (
            <div key={`${w.app_id}-${w.widget_id}-${i}`} className={`f-panel overflow-hidden ${SPAN[w.size]}`}
                 style={{ height: HEIGHT[w.size] }}>
              {w.missing ? (
                <div className="h-full grid place-items-center text-center px-4 text-xs text-yellow-400">
                  {w.title} is no longer published by {w.app_name ?? `app ${w.app_id}`}
                </div>
              ) : src ? (
                <iframe src={src} title={w.title} className="w-full h-full block border-0" />
              ) : (
                <div className="h-full grid place-items-center text-xs text-gray-500">{w.title}</div>
              )}
            </div>
          )
        })}
      </div>

      {editing && <Editor initial={saved} onClose={() => setEditing(false)}
                          onSaved={(w) => { setSaved(w); setEditing(false) }} />}
    </section>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────
function Editor({ initial, onClose, onSaved }: {
  initial: Saved[]; onClose: () => void; onSaved: (w: Saved[]) => void
}) {
  const [apps, setApps]   = useState<AppWithWidgets[]>([])
  const [rows, setRows]   = useState<Saved[]>(initial.filter(w => !w.missing))
  const [q, setQ]         = useState('')
  const [opts, setOpts]   = useState<Record<string, ParamOption[]>>({})
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)

  useEffect(() => {
    api.listApps().then(list => setApps(
      list.filter((a: any) => Array.isArray(a.widget_manifest) && a.widget_manifest.length > 0)))
      .catch(() => setErr('Could not load the widget library'))
  }, [])

  const manifestOf = (w: Saved) =>
    apps.find(a => a.id === w.app_id)?.widget_manifest.find(m => m.id === w.widget_id)

  // Dynamic pickers (devices, ports, captures …) come from the owning app,
  // keyed by resolved path so a picker narrowed by another param caches per value.
  const depKey = JSON.stringify(rows.map(r => [r.app_id, r.config]))
  useEffect(() => {
    rows.forEach(w => (manifestOf(w)?.params ?? []).filter(p => p.options_path).forEach(p => {
      const path = resolvePath(p.options_path!, w.config)
      if (!path) return
      const key = `${w.app_id}:${path}`
      if (opts[key]) return
      api.getWidgetOptions(w.app_id, path)
        .then(o => setOpts(prev => ({ ...prev, [key]: o })))
        .catch(() => setOpts(prev => ({ ...prev, [key]: [] })))
    }))
  }, [depKey, apps])

  const library = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apps.map(a => ({
      ...a,
      widget_manifest: a.widget_manifest.filter(m => !needle ||
        `${a.name} ${m.title} ${m.description ?? ''} ${m.category ?? ''}`.toLowerCase().includes(needle)),
    })).filter(a => a.widget_manifest.length > 0)
  }, [apps, q])

  const add = (a: AppWithWidgets, m: ManifestEntry) => {
    if (rows.length >= 24) { setErr('A dashboard holds at most 24 widgets'); return }
    setErr('')
    setRows(r => [...r, {
      app_id: a.id, app_name: a.name, widget_id: m.id, title: m.title,
      view_path: null, size: 'm', config: {}, missing: false,
    }])
  }
  const patch = (i: number, f: Partial<Saved>) => setRows(r => r.map((w, j) => j === i ? { ...w, ...f } : w))
  const move  = (i: number, d: number) => setRows(r => {
    const j = i + d; if (j < 0 || j >= r.length) return r
    const c = [...r]; [c[i], c[j]] = [c[j], c[i]]; return c
  })

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const res = await api.saveDashboardWidgets(rows.map(w => ({
        app_id: w.app_id, widget_id: w.widget_id, size: w.size, config: w.config })))
      onSaved(res.widgets)
    } catch (e: any) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 f-panel w-full max-w-5xl max-h-[88vh] flex flex-col" style={{ background: '#0d1219' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <span className="f-lbl f-lbl-gold">Dashboard widgets</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-0 min-h-0 flex-1 overflow-hidden">
          <div className="p-4 overflow-y-auto border-b md:border-b-0 md:border-r border-gray-800 space-y-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search widgets…"
                   className="w-full bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-white outline-none" />
            {library.length === 0 && <p className="text-xs text-gray-500">No widgets match.</p>}
            {library.map(a => (
              <div key={a.id}>
                <p className="f-lbl mb-1.5">{a.name}</p>
                <ul className="space-y-1">
                  {a.widget_manifest.map(m => (
                    <li key={m.id}>
                      <button onClick={() => add(a, m)} title={m.description}
                              className="w-full text-left flex items-center gap-2 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-white">
                        <Plus size={12} className="shrink-0 text-gray-500" />
                        <span className="truncate">{m.title}</span>
                        {m.category && <span className="ml-auto text-[10px] text-gray-600 shrink-0">{m.category}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="p-4 overflow-y-auto space-y-3">
            <p className="f-lbl">On the dashboard · {rows.length}</p>
            {rows.length === 0 && <p className="text-xs text-gray-500">Pick widgets from the library.</p>}
            {rows.map((w, i) => {
              const m = manifestOf(w)
              return (
                <div key={i} className="border border-gray-800 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white truncate flex-1">{w.app_name} · {w.title}</span>
                    <select value={w.size} onChange={e => patch(i, { size: e.target.value as Saved['size'] })}
                            className="bg-gray-900 border border-gray-700 text-xs text-white px-1 py-0.5">
                      <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option>
                    </select>
                    <button onClick={() => move(i, -1)} className="text-gray-500 hover:text-white"><ArrowUp size={13} /></button>
                    <button onClick={() => move(i, 1)} className="text-gray-500 hover:text-white"><ArrowDown size={13} /></button>
                    <button onClick={() => setRows(r => r.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400"><X size={14} /></button>
                  </div>
                  {(m?.params ?? []).map(p => {
                    const path = p.options_path ? resolvePath(p.options_path, w.config) : null
                    const options = p.options ?? (path ? opts[`${w.app_id}:${path}`] : undefined) ?? []
                    return (
                      <label key={p.key} className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="w-24 shrink-0">{p.label}</span>
                        <select value={w.config[p.key] ?? ''} disabled={!!p.options_path && !path}
                                onChange={e => patch(i, { config: { ...w.config, [p.key]: e.target.value } })}
                                className="flex-1 min-w-0 bg-gray-900 border border-gray-700 text-white px-1 py-0.5">
                          <option value="">{p.options_path && !path ? 'Choose the field above first' : 'Select…'}</option>
                          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pl-5 pr-24 py-3 border-t border-gray-800">
          <span className="text-xs text-red-400 truncate">{err}</span>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="f-chip px-3 py-1 text-xs">Cancel</button>
            <button onClick={save} disabled={busy} className="f-chip f-chip-gold px-3 py-1 text-xs">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
