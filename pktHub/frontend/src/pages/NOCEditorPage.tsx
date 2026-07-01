import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WidgetManifestEntry {
  id: string
  title: string
  description?: string
  view_path: string
  default_w: number
  default_h: number
  min_w?: number
  min_h?: number
}

interface AppWithWidgets {
  id: number
  name: string
  base_url: string
  widget_manifest: WidgetManifestEntry[]
}

interface PlacedWidget {
  id: string
  app_id: number
  widget_id: string
  view_path: string
  title: string
  x: number
  y: number
  w: number
  h: number
}

interface Slide {
  id: string
  title: string
  dwell_seconds: number
  widgets: PlacedWidget[]
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
function uid() { return 'w-' + Math.random().toString(36).slice(2, 9) }
function slideUid() { return 'slide-' + Math.random().toString(36).slice(2, 9) }

// ─── Component ─────────────────────────────────────────────────────────────────
export default function NOCEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [noc, setNOC] = useState<any>(null)
  const [apps, setApps] = useState<AppWithWidgets[]>([])
  const [slides, setSlides] = useState<Slide[]>([])
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0)
  const [displayMode, setDisplayMode] = useState<'static' | 'rotating'>('static')
  const [nocDwell, setNOCDwell] = useState(30)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saveMsg, setSaveMsg] = useState('')

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragDataRef = useRef<{ appId: number; manifest: WidgetManifestEntry } | null>(null)
  const dragMoveRef = useRef<{ widgetId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeMoveRef = useRef<{ widgetId: string; startX: number; startY: number; origW: number; origH: number; minW: number; minH: number } | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.getNOC(Number(id)), api.listApps()]).then(([k, appList]) => {
      setNOC(k)
      setDisplayMode(k.display_mode || 'static')
      setNOCDwell(k.dwell_seconds || 30)
      const layout: Slide[] = Array.isArray(k.layout) && k.layout.length > 0
        ? k.layout
        : [{ id: slideUid(), title: 'Slide 1', dwell_seconds: 30, widgets: [] }]
      setSlides(layout)
      const withWidgets = (appList as any[]).filter(
        (a: any) => Array.isArray(a.widget_manifest) && a.widget_manifest.length > 0
      )
      setApps(withWidgets)
      setLoading(false)
    }).catch(err => {
      console.error(err)
      setLoading(false)
    })
  }, [id])

  const currentSlide = slides[currentSlideIdx] ?? slides[0]
  const selectedWidget = currentSlide?.widgets.find(w => w.id === selectedWidgetId) ?? null

  // ── Slide management ────────────────────────────────────────────────────────
  const addSlide = () => {
    const s: Slide = { id: slideUid(), title: `Slide ${slides.length + 1}`, dwell_seconds: 30, widgets: [] }
    const next = slides.length
    setSlides(prev => [...prev, s])
    setCurrentSlideIdx(next)
    setSelectedWidgetId(null)
  }

  const removeSlide = (idx: number) => {
    if (slides.length <= 1) return
    setSlides(prev => prev.filter((_, i) => i !== idx))
    setCurrentSlideIdx(c => Math.min(c, slides.length - 2))
    setSelectedWidgetId(null)
  }

  const updateSlide = (fields: Partial<Slide>) =>
    setSlides(prev => prev.map((s, i) => i === currentSlideIdx ? { ...s, ...fields } : s))

  // ── Widget helpers ──────────────────────────────────────────────────────────
  const updateWidget = useCallback((widgetId: string, fields: Partial<PlacedWidget>) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx
        ? { ...s, widgets: s.widgets.map(w => w.id === widgetId ? { ...w, ...fields } : w) }
        : s
    ))
  }, [currentSlideIdx])

  const removeWidget = (widgetId: string) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: s.widgets.filter(w => w.id !== widgetId) } : s
    ))
    setSelectedWidgetId(null)
  }

  // ── Library → canvas DnD ────────────────────────────────────────────────────
  const onLibraryDragStart = (appId: number, m: WidgetManifestEntry) => {
    dragDataRef.current = { appId, manifest: m }
  }

  const onCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragDataRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.round(e.clientX - rect.left - dragDataRef.current.manifest.default_w / 2))
    const y = Math.max(0, Math.round(e.clientY - rect.top - dragDataRef.current.manifest.default_h / 2))
    const { appId, manifest: m } = dragDataRef.current
    const placed: PlacedWidget = {
      id: uid(), app_id: appId, widget_id: m.id, view_path: m.view_path,
      title: m.title, x, y, w: m.default_w, h: m.default_h,
    }
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: [...s.widgets, placed] } : s
    ))
    setSelectedWidgetId(placed.id)
    dragDataRef.current = null
  }

  // ── Widget drag-to-move ──────────────────────────────────────────────────────
  const onWidgetMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation()
    setSelectedWidgetId(w.id)
    dragMoveRef.current = { widgetId: w.id, startX: e.clientX, startY: e.clientY, origX: w.x, origY: w.y }
  }

  // ── Corner resize ───────────────────────────────────────────────────────────
  const onResizeMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation()
    const m = apps.flatMap(a => a.widget_manifest.map(wm => ({ ...wm, appId: a.id })))
                  .find(wm => wm.appId === w.app_id && wm.id === w.widget_id)
    resizeMoveRef.current = {
      widgetId: w.id, startX: e.clientX, startY: e.clientY,
      origW: w.w, origH: w.h, minW: m?.min_w ?? 150, minH: m?.min_h ?? 100,
    }
  }

  // ── Unified canvas mouse handlers ───────────────────────────────────────────
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (resizeMoveRef.current) {
      const r = resizeMoveRef.current
      updateWidget(r.widgetId, {
        w: Math.max(r.minW, r.origW + e.clientX - r.startX),
        h: Math.max(r.minH, r.origH + e.clientY - r.startY),
      })
      return
    }
    if (dragMoveRef.current) {
      const d = dragMoveRef.current
      updateWidget(d.widgetId, {
        x: Math.max(0, d.origX + e.clientX - d.startX),
        y: Math.max(0, d.origY + e.clientY - d.startY),
      })
    }
  }

  const onCanvasMouseUp = () => { dragMoveRef.current = null; resizeMoveRef.current = null }

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    try {
      await api.updateNOC(Number(id), { layout: slides, display_mode: displayMode, dwell_seconds: nocDwell })
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch (err) {
      setSaveMsg('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ height: '100vh', background: '#0a1628', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '14px' }}>
      Loading editor…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a1628', overflow: 'hidden' }}>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', height: '52px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#0d1b2e' }}>
        <button onClick={() => navigate('/noc')} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '4px 0' }}>
          ← Back
        </button>
        <span style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 500 }}>{noc?.name}</span>

        {/* Slide tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, overflowX: 'auto', paddingLeft: '8px' }}>
          {slides.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <button
                onClick={() => { setCurrentSlideIdx(i); setSelectedWidgetId(null) }}
                style={{
                  padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                  background: i === currentSlideIdx ? '#4338ca' : '#1e293b',
                  color: i === currentSlideIdx ? '#fff' : '#94a3b8',
                  border: i === currentSlideIdx ? '1px solid #6366f1' : '1px solid transparent',
                  transition: 'all 0.15s',
                }}
              >{s.title}</button>
              {slides.length > 1 && (
                <button onClick={() => removeSlide(i)} style={{ color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addSlide} style={{ color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', flexShrink: 0 }}>+ Slide</button>
        </div>

        {saveMsg && <span style={{ fontSize: '12px', color: saveMsg === 'Saved' ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
        <button
          onClick={save} disabled={saving}
          style={{ padding: '6px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#374151' : '#4338ca', color: '#fff', border: 'none', flexShrink: 0 }}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {/* ── 3-panel body ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: Widget library */}
        <div style={{ width: '210px', flexShrink: 0, borderRight: '1px solid #1e293b', background: '#0d1b2e', overflowY: 'auto' }}>
          <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #1e293b' }}>
            Widgets
          </div>
          {apps.length === 0 ? (
            <div style={{ padding: '16px 14px', fontSize: '12px', color: '#475569' }}>
              No apps with widgets.<br />Check that apps are online and have a <code style={{ fontFamily: 'monospace' }}>/api/widgets/manifest</code> endpoint.
            </div>
          ) : apps.map(app => (
            <div key={app.id}>
              <div style={{ padding: '10px 14px 4px', fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{app.name}</div>
              {app.widget_manifest.map(m => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={() => onLibraryDragStart(app.id, m)}
                  style={{
                    margin: '0 8px 6px', padding: '8px 10px', borderRadius: '6px', cursor: 'grab',
                    background: '#1e293b', border: '1px solid #334155', userSelect: 'none',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#6366f1')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#334155')}
                >
                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0' }}>{m.title}</div>
                  {m.description && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: '1.3' }}>{m.description}</div>}
                  <div style={{ fontSize: '10px', color: '#334155', marginTop: '4px', fontFamily: 'monospace' }}>{m.default_w}×{m.default_h}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Center: Free canvas */}
        <div
          ref={canvasRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onCanvasDrop}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          onClick={() => setSelectedWidgetId(null)}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'auto',
            backgroundImage: 'radial-gradient(circle, #1a2744 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            backgroundColor: '#0c1629',
            cursor: 'default',
            minWidth: 0,
          }}
        >
          {/* Canvas sizing — enough room to place widgets below viewport */}
          <div style={{ minWidth: '1800px', minHeight: '1000px', position: 'relative' }}>
            {currentSlide?.widgets.map(w => {
              const isSel = w.id === selectedWidgetId
              return (
                <div
                  key={w.id}
                  onMouseDown={e => onWidgetMouseDown(e, w)}
                  onClick={e => { e.stopPropagation(); setSelectedWidgetId(w.id) }}
                  style={{
                    position: 'absolute', left: w.x, top: w.y, width: w.w, height: w.h,
                    border: isSel ? '2px solid #6366f1' : '1px solid #334155',
                    borderRadius: '8px', overflow: 'hidden', cursor: 'grab',
                    userSelect: 'none', zIndex: isSel ? 10 : 1, boxSizing: 'border-box',
                    boxShadow: isSel ? '0 0 0 1px #4338ca' : 'none',
                  }}
                >
                  {/* Drag handle bar */}
                  <div style={{ height: '26px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', padding: '0 10px', gap: '6px' }}>
                    <span style={{ flex: 1, fontSize: '11px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                    <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace', flexShrink: 0 }}>{w.w}×{w.h}</span>
                  </div>
                  {/* Live preview iframe (pointer-events blocked while editing) */}
                  <iframe
                    src={`/proxy/${w.app_id}${w.view_path}`}
                    title={w.title}
                    style={{ width: '100%', height: `calc(100% - 26px)`, border: 'none', pointerEvents: 'none', background: '#0f172a', display: 'block' }}
                  />
                  {/* Resize handle — bottom-right corner */}
                  <div
                    onMouseDown={e => onResizeMouseDown(e, w)}
                    style={{
                      position: 'absolute', right: 0, bottom: 0, width: '18px', height: '18px',
                      cursor: 'nwse-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
                      padding: '3px', zIndex: 20,
                    }}
                  >
                    <svg width="9" height="9" viewBox="0 0 9 9">
                      <path d="M1 9L9 1M5 9L9 5M9 9" stroke={isSel ? '#6366f1' : '#475569'} strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
              )
            })}

            {(!currentSlide || currentSlide.widgets.length === 0) && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: '13px', color: '#334155' }}>Drag widgets from the left panel onto the canvas</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Config panel */}
        <div style={{ width: '240px', flexShrink: 0, borderLeft: '1px solid #1e293b', background: '#0d1b2e', overflowY: 'auto' }}>
          {selectedWidget ? (
            <>
              <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #1e293b' }}>Widget</div>
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(['title'] as const).map(field => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Title</span>
                    <input
                      value={selectedWidget.title}
                      onChange={e => updateWidget(selectedWidget.id, { title: e.target.value })}
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                  </label>
                ))}
                {(['x', 'y', 'w', 'h'] as const).map(field => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>{field.toUpperCase()}</span>
                    <input
                      type="number"
                      value={selectedWidget[field] as number}
                      onChange={e => updateWidget(selectedWidget.id, { [field]: Math.max(0, parseInt(e.target.value) || 0) })}
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                  </label>
                ))}
                <button
                  onClick={() => removeWidget(selectedWidget.id)}
                  style={{ marginTop: '8px', padding: '7px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', background: '#3f1515', color: '#f87171', border: '1px solid #7f1d1d' }}
                >Remove Widget</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #1e293b' }}>Slide</div>
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Slide Title</span>
                  <input
                    value={currentSlide?.title ?? ''}
                    onChange={e => updateSlide({ title: e.target.value })}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Dwell (seconds)</span>
                  <input
                    type="number" min={5}
                    value={currentSlide?.dwell_seconds ?? 30}
                    onChange={e => updateSlide({ dwell_seconds: Math.max(5, parseInt(e.target.value) || 30) })}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </label>
              </div>

              <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b' }}>Display</div>
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Mode</span>
                  <select
                    value={displayMode}
                    onChange={e => setDisplayMode(e.target.value as 'static' | 'rotating')}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  >
                    <option value="static">Static (single slide)</option>
                    <option value="rotating">Auto-Rotate</option>
                  </select>
                </label>
                {displayMode === 'rotating' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Default dwell (sec)</span>
                    <input
                      type="number" min={5}
                      value={nocDwell}
                      onChange={e => setNOCDwell(Math.max(5, parseInt(e.target.value) || 30))}
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
