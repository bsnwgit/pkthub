import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

// ─── Types ─────────────────────────────────────────────────────────────────────
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
  id: string; app_id: number; widget_id: string; view_path: string
  title: string; x: number; y: number; w: number; h: number
}
interface Slide {
  id: string; title: string; dwell_seconds: number; widgets: PlacedWidget[]
}

// ─── App color palette (keyed by normalised name) ──────────────────────────────
const APP_COLORS: Record<string, string> = {
  pktflow: '#60a5fa',
  pktlog:  '#4ade80',
  pktsnmp: '#2dd4bf',
  pktpcap: '#a78bfa',
}
function appColor(name: string): string {
  return APP_COLORS[name.toLowerCase().replace(/[^a-z]/g, '')] ?? '#94a3b8'
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  background: '#1a2744', border: '1px solid #334155', borderRadius: '6px',
  padding: '6px 8px', fontSize: '13px', color: '#e2e8f0', outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

// ─── Zoom levels ───────────────────────────────────────────────────────────────
const ZOOM_LEVELS = [0.25, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

function uid()      { return 'w-'     + Math.random().toString(36).slice(2, 9) }
function slideUid() { return 'slide-' + Math.random().toString(36).slice(2, 9) }

// ─── Component ─────────────────────────────────────────────────────────────────
export default function NOCEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [noc,            setNOC]            = useState<any>(null)
  const [apps,           setApps]           = useState<AppWithWidgets[]>([])
  const [slides,         setSlides]         = useState<Slide[]>([])
  const [currentSlideIdx,setCurrentSlideIdx]= useState(0)
  const [displayMode,    setDisplayMode]    = useState<'static'|'rotating'|'manual'>('static')
  const [nocDwell,       setNOCDwell]       = useState(30)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [saveMsg, setSaveMsg] = useState('')
  const [proxyReady, setProxyReady] = useState<Set<number>>(new Set())
  const [zoom, setZoom] = useState(1.0)

  const canvasRef      = useRef<HTMLDivElement>(null)
  const dragDataRef    = useRef<{ appId: number; manifest: WidgetManifestEntry } | null>(null)
  const dragMoveRef    = useRef<{ widgetId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeMoveRef  = useRef<{ widgetId: string; startX: number; startY: number; origW: number; origH: number; minW: number; minH: number } | null>(null)
  const zoomRef        = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // ── Zoom helpers ─────────────────────────────────────────────────────────
  const zoomIn  = () => setZoom(z => {
    const i = ZOOM_LEVELS.findIndex(l => l > z + 0.001)
    return i < 0 ? ZOOM_LEVELS[ZOOM_LEVELS.length - 1] : ZOOM_LEVELS[i]
  })
  const zoomOut = () => setZoom(z => {
    const rev = [...ZOOM_LEVELS].reverse()
    const found = rev.find(l => l < z - 0.001)
    return found ?? ZOOM_LEVELS[0]
  })

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.getNOC(Number(id)), api.listApps()]).then(([k, appList]) => {
      setNOC(k)
      setDisplayMode(k.display_mode || 'static')
      setNOCDwell(k.dwell_seconds || 30)
      const layout: Slide[] = Array.isArray(k.layout) && k.layout.length > 0
        ? k.layout : [{ id: slideUid(), title: 'Slide 1', dwell_seconds: 30, widgets: [] }]
      setSlides(layout)
      const withWidgets = (appList as any[]).filter(
        (a: any) => Array.isArray(a.widget_manifest) && a.widget_manifest.length > 0
      )
      setApps(withWidgets)
      setLoading(false)
      withWidgets.forEach((a: any) => {
        api.createProxySession(a.id)
          .then(() => setProxyReady(prev => new Set(prev).add(a.id)))
          .catch(() => {})
      })
    }).catch(() => setLoading(false))
  }, [id])

  const currentSlide   = slides[currentSlideIdx] ?? slides[0]
  const selectedWidget = currentSlide?.widgets.find(w => w.id === selectedWidgetId) ?? null
  const selectedApp    = selectedWidget ? apps.find(a => a.id === selectedWidget.app_id) : null
  const selColor       = selectedApp ? appColor(selectedApp.name) : '#94a3b8'

  // ── Slide management ─────────────────────────────────────────────────────
  const addSlide = () => {
    const s: Slide = { id: slideUid(), title: `Slide ${slides.length + 1}`, dwell_seconds: 30, widgets: [] }
    setSlides(prev => [...prev, s]); setCurrentSlideIdx(slides.length); setSelectedWidgetId(null)
  }
  const removeSlide = (idx: number) => {
    if (slides.length <= 1) return
    setSlides(prev => prev.filter((_, i) => i !== idx))
    setCurrentSlideIdx(c => Math.min(c, slides.length - 2)); setSelectedWidgetId(null)
  }
  const updateSlide = (fields: Partial<Slide>) =>
    setSlides(prev => prev.map((s, i) => i === currentSlideIdx ? { ...s, ...fields } : s))

  // ── Widget helpers ────────────────────────────────────────────────────────
  const updateWidget = useCallback((widgetId: string, fields: Partial<PlacedWidget>) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx
        ? { ...s, widgets: s.widgets.map(w => w.id === widgetId ? { ...w, ...fields } : w) } : s
    ))
  }, [currentSlideIdx])

  const removeWidget = (widgetId: string) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: s.widgets.filter(w => w.id !== widgetId) } : s
    ))
    setSelectedWidgetId(null)
  }

  // ── DnD from library ─────────────────────────────────────────────────────
  const onLibraryDragStart = (appId: number, m: WidgetManifestEntry) => {
    dragDataRef.current = { appId, manifest: m }
  }
  const onCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragDataRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const z = zoomRef.current
    // Divide by zoom to convert from visual (screen) coords to canvas coords
    const x = Math.max(0, Math.round((e.clientX - rect.left) / z - dragDataRef.current.manifest.default_w / 2))
    const y = Math.max(0, Math.round((e.clientY - rect.top)  / z - dragDataRef.current.manifest.default_h / 2))
    const { appId, manifest: m } = dragDataRef.current
    const placed: PlacedWidget = {
      id: uid(), app_id: appId, widget_id: m.id, view_path: m.view_path,
      title: m.title, x, y, w: m.default_w, h: m.default_h,
    }
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: [...s.widgets, placed] } : s
    ))
    setSelectedWidgetId(placed.id); dragDataRef.current = null
  }

  // ── Drag-move + resize (deltas divided by zoom) ───────────────────────────
  const onWidgetMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation(); setSelectedWidgetId(w.id)
    dragMoveRef.current = { widgetId: w.id, startX: e.clientX, startY: e.clientY, origX: w.x, origY: w.y }
  }
  const onResizeMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation()
    const m = apps.flatMap(a => a.widget_manifest.map(wm => ({ ...wm, appId: a.id })))
                  .find(wm => wm.appId === w.app_id && wm.id === w.widget_id)
    resizeMoveRef.current = {
      widgetId: w.id, startX: e.clientX, startY: e.clientY,
      origW: w.w, origH: w.h, minW: m?.min_w ?? 150, minH: m?.min_h ?? 100,
    }
  }
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const z = zoomRef.current
    if (resizeMoveRef.current) {
      const r = resizeMoveRef.current
      updateWidget(r.widgetId, {
        w: Math.max(r.minW, r.origW + (e.clientX - r.startX) / z),
        h: Math.max(r.minH, r.origH + (e.clientY - r.startY) / z),
      })
      return
    }
    if (dragMoveRef.current) {
      const d = dragMoveRef.current
      updateWidget(d.widgetId, {
        x: Math.max(0, d.origX + (e.clientX - d.startX) / z),
        y: Math.max(0, d.origY + (e.clientY - d.startY) / z),
      })
    }
  }
  const onCanvasMouseUp = () => { dragMoveRef.current = null; resizeMoveRef.current = null }

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    try {
      await api.updateNOC(Number(id), { layout: slides, display_mode: displayMode, dwell_seconds: nocDwell })
      setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
    } catch { setSaveMsg('Save failed') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ height: '100vh', background: '#080d18', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '14px' }}>
      Loading editor…
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#080d18', overflow: 'hidden' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', height: '52px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, background: '#0d1525' }}>
        <button onClick={() => navigate('/noc')} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '4px 0' }}>← Back</button>
        <span style={{ color: '#f1f5f9', fontSize: '14px', fontWeight: 500 }}>{noc?.name}</span>

        {/* Slide tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, overflowX: 'auto', paddingLeft: '8px' }}>
          {slides.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <button
                onClick={() => { setCurrentSlideIdx(i); setSelectedWidgetId(null) }}
                style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s', border: i === currentSlideIdx ? '1px solid #6366f1' : '1px solid transparent', background: i === currentSlideIdx ? '#4338ca' : '#1e293b', color: i === currentSlideIdx ? '#fff' : '#94a3b8' }}
              >{s.title}</button>
              {slides.length > 1 && (
                <button onClick={() => removeSlide(i)} style={{ color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addSlide} style={{ color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', flexShrink: 0 }}>+ Slide</button>
        </div>

        {/* Display mode pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '3px 8px', flexShrink: 0 }}>
          {(['static', 'rotating', 'manual'] as const).map(m => (
            <button key={m} onClick={() => setDisplayMode(m)} style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', border: 'none', transition: 'all 0.15s', background: displayMode === m ? 'rgba(167,139,250,0.18)' : 'transparent', color: displayMode === m ? '#a78bfa' : '#64748b' }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          {displayMode === 'rotating' && (
            <>
              <span style={{ color: '#334155', fontSize: '11px', margin: '0 2px' }}>·</span>
              <input type="number" min={5} value={nocDwell} onChange={e => setNOCDwell(Math.max(5, parseInt(e.target.value) || 30))}
                style={{ width: '40px', background: 'transparent', border: 'none', fontSize: '11px', color: '#a78bfa', outline: 'none', textAlign: 'center' }} />
              <span style={{ fontSize: '11px', color: '#475569' }}>s</span>
            </>
          )}
        </div>

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '3px 8px', flexShrink: 0 }}>
          <button onClick={zoomOut} title="Zoom out" style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}>−</button>
          <span
            onClick={() => setZoom(1.0)}
            title="Reset zoom"
            style={{ fontSize: '11px', color: '#64748b', minWidth: '36px', textAlign: 'center', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'none' }}
          >{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} title="Zoom in" style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}>+</button>
        </div>

        {saveMsg && <span style={{ fontSize: '12px', color: saveMsg === 'Saved' ? '#4ade80' : '#f87171', flexShrink: 0 }}>{saveMsg}</span>}
        <button onClick={save} disabled={saving} style={{ padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', border: 'none', color: '#fff', flexShrink: 0, background: saving ? '#374151' : 'linear-gradient(90deg,#a78bfa,#60a5fa)', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── 3-panel body ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: Widget library ─────────────────────────────────────── */}
        <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', background: '#0d1525', overflowY: 'auto' }}>
          <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Widget Library</span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: '4px', padding: '1px 6px' }}>auto</span>
          </div>
          {apps.length === 0 ? (
            <div style={{ padding: '16px 14px', fontSize: '12px', color: '#475569' }}>No apps with widgets registered.</div>
          ) : apps.map(app => {
            const col = appColor(app.name)
            return (
              <div key={app.id}>
                <div style={{ padding: '10px 14px 4px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: col, flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{app.name}</span>
                </div>
                {app.widget_manifest.map(m => (
                  <div key={m.id} draggable onDragStart={() => onLibraryDragStart(app.id, m)}
                    style={{ margin: '0 8px 5px', padding: '8px 10px', borderRadius: '6px', cursor: 'grab', background: '#131e30', border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${col}`, userSelect: 'none', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a2744')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#131e30')}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#e2e8f0' }}>{m.title}</div>
                    {m.description && <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px', lineHeight: '1.3' }}>{m.description}</div>}
                    <div style={{ marginTop: '4px', display: 'inline-block', fontSize: '10px', color: col, background: `${col}1a`, borderRadius: '3px', padding: '1px 5px', fontFamily: 'monospace' }}>{app.name}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* ── Center: Zoomable free canvas ─────────────────────────────── */}
        {/* Outer div: scroll container; receives mouse/drag events so gestures
            continue even when cursor leaves the canvas content area           */}
        <div
          onDragOver={e => e.preventDefault()} onDrop={onCanvasDrop}
          onMouseMove={onCanvasMouseMove} onMouseUp={onCanvasMouseUp} onMouseLeave={onCanvasMouseUp}
          onClick={() => setSelectedWidgetId(null)}
          style={{ flex: 1, overflow: 'auto', minWidth: 0, backgroundColor: '#070f1e' }}
        >
          {/* Zoom wrapper — sizes the scroll area to match scaled canvas dimensions */}
          <div style={{ width: `${1920 * zoom}px`, minHeight: `${1080 * zoom}px`, position: 'relative' }}>
            {/* Inner canvas — scaled via CSS transform; canvasRef here so
                getBoundingClientRect() returns visual (scaled) position      */}
            <div
              ref={canvasRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '1920px', minHeight: '1080px',
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                backgroundImage: 'radial-gradient(circle, #1a2744 1px, transparent 1px)',
                backgroundSize: '24px 24px',
                backgroundColor: '#070f1e',
                cursor: 'default',
              }}
            >

              {currentSlide?.widgets.map(w => {
                const isSel    = w.id === selectedWidgetId
                const hasProxy = proxyReady.has(w.app_id)
                const wApp     = apps.find(a => a.id === w.app_id)
                const col      = wApp ? appColor(wApp.name) : '#94a3b8'
                return (
                  <div key={w.id}
                    onMouseDown={e => onWidgetMouseDown(e, w)}
                    onClick={e => { e.stopPropagation(); setSelectedWidgetId(w.id) }}
                    style={{ position: 'absolute', left: w.x, top: w.y, width: w.w, height: w.h,
                      border: isSel ? `2px solid ${col}` : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px', overflow: 'hidden', cursor: 'grab', userSelect: 'none',
                      zIndex: isSel ? 10 : 1, boxSizing: 'border-box', background: '#0d1525',
                      boxShadow: isSel ? `0 0 0 1px ${col}30, 0 4px 24px rgba(0,0,0,0.4)` : '0 2px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {/* Header: app badge + title */}
                    <div style={{ height: '28px', background: '#131e30', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 8px', gap: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: col, background: `${col}18`, border: `1px solid ${col}35`, borderRadius: '4px', padding: '1px 6px', flexShrink: 0, fontFamily: 'monospace' }}>
                        {wApp?.name ?? `app:${w.app_id}`}
                      </span>
                      <span style={{ flex: 1, fontSize: '11px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                    </div>
                    {/* Preview iframe */}
                    {hasProxy ? (
                      <iframe src={`/proxy/${w.app_id}${w.view_path}`} title={w.title}
                        style={{ width: '100%', height: 'calc(100% - 28px)', border: 'none', pointerEvents: 'none', background: '#070f1e', display: 'block' }} />
                    ) : (
                      <div style={{ width: '100%', height: 'calc(100% - 28px)', background: '#070f1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '11px', color: '#334155' }}>connecting…</span>
                      </div>
                    )}
                    {/* Resize handle */}
                    <div onMouseDown={e => onResizeMouseDown(e, w)}
                      style={{ position: 'absolute', right: 4, bottom: 4, width: '11px', height: '11px', background: isSel ? '#a78bfa' : '#2d3748', borderRadius: '2px', cursor: 'nwse-resize', zIndex: 20, transition: 'background 0.15s' }}
                    />
                  </div>
                )
              })}

              {(!currentSlide || currentSlide.widgets.length === 0) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: '13px', color: '#1e3a5f' }}>Drag widgets from the left panel onto the canvas</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Config panel ──────────────────────────────────────── */}
        <div style={{ width: '240px', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.07)', background: '#0d1525', overflowY: 'auto' }}>
          {selectedWidget ? (
            <>
              <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>Widget</div>
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Title</span>
                  <input value={selectedWidget.title} onChange={e => updateWidget(selectedWidget.id, { title: e.target.value })} style={inputSt} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Source App</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: selColor }}>{selectedApp?.name ?? `App ${selectedWidget.app_id}`}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Widget Type</span>
                  <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>{selectedWidget.widget_id}</span>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '5px' }}>Position</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {(['x','y'] as const).map(f => (
                      <label key={f}>
                        <span style={{ fontSize: '10px', color: '#475569', display: 'block', marginBottom: '2px' }}>{f.toUpperCase()}</span>
                        <input type="number" value={selectedWidget[f]} onChange={e => updateWidget(selectedWidget.id, { [f]: Math.max(0, parseInt(e.target.value)||0) })} style={inputSt} />
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '5px' }}>Size</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {(['w','h'] as const).map(f => (
                      <label key={f}>
                        <span style={{ fontSize: '10px', color: '#475569', display: 'block', marginBottom: '2px' }}>{f.toUpperCase()}</span>
                        <input type="number" value={selectedWidget[f]} onChange={e => updateWidget(selectedWidget.id, { [f]: Math.max(0, parseInt(e.target.value)||0) })} style={inputSt} />
                      </label>
                    ))}
                  </div>
                </div>
                <button onClick={() => removeWidget(selectedWidget.id)}
                  style={{ marginTop: '4px', padding: '7px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', background: '#3f1515', color: '#f87171', border: '1px solid #7f1d1d' }}>
                  Remove Widget
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '10px 14px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>Slide</div>
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Slide Title</span>
                  <input value={currentSlide?.title ?? ''} onChange={e => updateSlide({ title: e.target.value })} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Dwell (seconds)</span>
                  <input type="number" min={5} value={currentSlide?.dwell_seconds ?? 30}
                    onChange={e => updateSlide({ dwell_seconds: Math.max(5, parseInt(e.target.value)||30) })} style={inputSt} />
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
