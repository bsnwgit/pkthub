import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import HelpButton from '../components/HelpButton'

// ─── Canvas reference dimensions ───────────────────────────────────────────────
const CANVAS_W = 1920
const CANVAS_H = 1080

// ─── Types ─────────────────────────────────────────────────────────────────────
interface WidgetParamOption { value: string; label: string }
interface WidgetParam {
  key: string
  label: string
  type: 'select'
  options?: WidgetParamOption[]
  // Relative path on the owning app, fetched through pkthub's widget-options
  // proxy, for params whose choices depend on that app's live data (devices,
  // subnets, APs, etc.) rather than a fixed enum.
  options_path?: string
}
interface WidgetManifestEntry {
  id: string
  title: string
  description?: string
  view_path: string
  default_w: number
  default_h: number
  min_w?: number
  min_h?: number
  params?: WidgetParam[]
  // Optional grouping label within the owning app's section of the library.
  // Apps that predate it fall back to UNGROUPED, so the contract stays additive.
  category?: string
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
  config?: Record<string, string | number | boolean>
}
interface Slide {
  id: string; title: string; dwell_seconds: number; widgets: PlacedWidget[]
}

// ─── App color palette ──────────────────────────────────────────────────────────
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
function appColor(name: string): string {
  return APP_COLORS[name.toLowerCase().replace(/[^a-z]/g, '')] ?? '#d2ccc0'
}

// ─── Widget iframe src ── appends config params as query string ─────────────
function widgetIframeSrc(w: PlacedWidget, proxyBase: string, refresh?: number): string {
  const cfg = w.config || {}
  const qs  = new URLSearchParams()
  Object.entries(cfg).forEach(([k, v]) => { if (v !== '' && v !== undefined) qs.set(k, String(v)) })
  // Settings -> NOC -> Widget refresh. Each widget page reloads itself on this
  // interval; without it every tile falls back to its own hardcoded 30s.
  if (refresh) qs.set('refresh', String(refresh))
  const q = qs.toString()
  return `${proxyBase}${w.view_path}${q ? '?' + q : ''}`
}

// ─── Shared styles ──────────────────────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  background: '#1c2430', border: '1px solid #7f8a9b', borderRadius: '6px',
  padding: '6px 8px', fontSize: '13px', color: '#f2eee6', outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

// ─── Zoom levels ────────────────────────────────────────────────────────────────
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

// ─── Snap grid ──────────────────────────────────────────────────────────────────
const SNAP_GRID = 24

function uid()      { return 'w-'     + Math.random().toString(36).slice(2, 9) }
function slideUid() { return 'slide-' + Math.random().toString(36).slice(2, 9) }

// ─── Library grouping ───────────────────────────────────────────────────────────
const UNGROUPED = 'Other'

/** Split an app's manifest into ordered category buckets, preserving the order
 *  the app declared them in so each app controls how its own library reads. */
function groupByCategory(entries: WidgetManifestEntry[]): [string, WidgetManifestEntry[]][] {
  const buckets = new Map<string, WidgetManifestEntry[]>()
  entries.forEach(m => {
    const key = m.category?.trim() || UNGROUPED
    const bucket = buckets.get(key)
    if (bucket) bucket.push(m)
    else buckets.set(key, [m])
  })
  return [...buckets.entries()]
}

/** Match on title, category and description so searching "throughput" or
 *  "interface" finds a widget whose title alone wouldn't say so. */
function matchesQuery(m: WidgetManifestEntry, q: string): boolean {
  if (!q) return true
  const hay = `${m.title} ${m.category ?? ''} ${m.description ?? ''}`.toLowerCase()
  return q.split(/\s+/).every(term => hay.includes(term))
}

// ─── Dependent param pickers ───────────────────────────────────────────────────
/** An options_path may reference other params of the same widget as `{key}` —
 *  e.g. `/api/widgets/options/interfaces?device_id={device_id}`. Substituting
 *  from the widget's own config is what lets one manifest entry cover whatever
 *  devices, interfaces or metrics the app happens to have at the time: the app
 *  answers from live state, so hardware added or removed later needs no manifest
 *  change here. Returns null while any referenced param is still unset. */
function resolveOptionsPath(
  template: string,
  config: Record<string, string | number | boolean> | undefined,
): string | null {
  let unresolved = false
  const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = config?.[key]
    if (v === undefined || v === '') { unresolved = true; return '' }
    return encodeURIComponent(String(v))
  })
  return unresolved ? null : path
}

/** The params a picker's path depends on, so the editor knows when to re-fetch. */
function optionsDeps(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1])
}

// ─── Compositor layer promotion ────────────────────────────────────────────────
// On some macOS/GPU combinations the browser fails to paint this page's main
// layer entirely: the DOM is correct and hit-testable, but nothing appears
// except elements that already have their own compositor layer (the scaled
// canvas, and drag images). Promoting the chrome to its own layer puts it on
// the same path that demonstrably paints. Harmless everywhere else — these are
// three static, non-scrolling panels.
const LAYER: React.CSSProperties = { transform: 'translateZ(0)', willChange: 'transform' }

// ─── Component ──────────────────────────────────────────────────────────────────
export default function NOCEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [noc,             setNOC]             = useState<any>(null)
  const [apps,            setApps]            = useState<AppWithWidgets[]>([])
  const [slides,          setSlides]          = useState<Slide[]>([])
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0)
  const [displayMode,     setDisplayMode]     = useState<'static'|'rotating'|'manual'>('static')
  const [nocDwell,        setNOCDwell]        = useState(30)
  const [selectedWidgetId,setSelectedWidgetId]= useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [saveMsg, setSaveMsg] = useState('')
  const [proxyReady, setProxyReady] = useState<Set<number>>(new Set())
  const [zoom, setZoom] = useState(0.5)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [libQuery,     setLibQuery]     = useState('')
  const [collapsedApps,setCollapsedApps]= useState<Set<number>>(new Set())
  const [refreshing,   setRefreshing]   = useState(false)

  const canvasRef     = useRef<HTMLDivElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const dragDataRef   = useRef<{ appId: number; manifest: WidgetManifestEntry } | null>(null)
  const dragMoveRef   = useRef<{
    widgetId: string; startX: number; startY: number
    origX: number; origY: number; origW: number; origH: number
  } | null>(null)
  const resizeMoveRef = useRef<{
    widgetId: string; startX: number; startY: number
    origW: number; origH: number; origX: number; origY: number
    minW: number; minH: number
  } | null>(null)
  const zoomRef = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  const snapRef = useRef(false)
  useEffect(() => { snapRef.current = snapEnabled }, [snapEnabled])

  // ── Fit-to-canvas ────────────────────────────────────────────────────────
  const calcFitZoom = useCallback(() => {
    if (!canvasAreaRef.current) return 0.5
    const { clientWidth: w, clientHeight: h } = canvasAreaRef.current
    return Math.min((w - 40) / CANVAS_W, (h - 40) / CANVAS_H)
  }, [])

  const fitCanvas = useCallback(() => setZoom(calcFitZoom()), [calcFitZoom])

  // ── Snap helper ──────────────────────────────────────────────────────────
  const snapVal = (v: number) => snapRef.current ? Math.round(v / SNAP_GRID) * SNAP_GRID : v

  // ── Zoom step helpers ────────────────────────────────────────────────────
  const zoomIn = () => setZoom(z => {
    const i = ZOOM_LEVELS.findIndex(l => l > z + 0.001)
    return i < 0 ? ZOOM_LEVELS[ZOOM_LEVELS.length - 1] : ZOOM_LEVELS[i]
  })
  const zoomOut = () => setZoom(z => {
    const found = [...ZOOM_LEVELS].reverse().find(l => l < z - 0.001)
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

  // ── Auto-fit zoom once canvas area has rendered ──────────────────────────
  useEffect(() => {
    if (loading) return
    const raf = requestAnimationFrame(() => fitCanvas())
    return () => cancelAnimationFrame(raf)
  }, [loading, fitCanvas])

  // ── Delete / Backspace removes selected widget ────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          !(e.target as HTMLElement).closest('input,textarea,select')) {
        setSelectedWidgetId(curr => {
          if (curr) {
            setSlides(prev => prev.map((s, i) =>
              i === currentSlideIdx
                ? { ...s, widgets: s.widgets.filter(w => w.id !== curr) }
                : s
            ))
            return null
          }
          return curr
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentSlideIdx])

  const currentSlide   = slides[currentSlideIdx] ?? slides[0]
  const selectedWidget = currentSlide?.widgets.find(w => w.id === selectedWidgetId) ?? null
  const selectedApp    = selectedWidget ? apps.find(a => a.id === selectedWidget.app_id) : null
  const selColor       = selectedApp ? appColor(selectedApp.name) : '#d2ccc0'

  // Min-size for selected widget config panel clamping
  const selectedWidgetManifest = selectedWidget
    ? apps.flatMap(a => a.widget_manifest).find(wm => wm.id === selectedWidget.widget_id)
    : null
  const selMinW = selectedWidgetManifest?.min_w ?? 150
  const selMinH = selectedWidgetManifest?.min_h ?? 100

  // ── Dynamic param options (device/subnet/AP/metric pickers etc.) ─────────
  // Keyed by the *resolved* path, so a picker that narrows by another param
  // caches one entry per parent value rather than one per widget.
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, WidgetParamOption[]>>({})

  // Config of the selected widget, serialised — dependent pickers must re-fetch
  // when the param they narrow by changes.
  const selectedConfigKey = JSON.stringify(selectedWidget?.config ?? {})

  useEffect(() => {
    const dynamicParams = (selectedWidgetManifest?.params ?? []).filter(p => p.options_path)
    if (!selectedWidget || dynamicParams.length === 0) return
    dynamicParams.forEach(p => {
      const resolved = resolveOptionsPath(p.options_path!, selectedWidget.config)
      if (!resolved) return                       // parent param not chosen yet
      const cacheKey = `${selectedWidget.app_id}:${resolved}`
      if (dynamicOptions[cacheKey]) return
      api.getWidgetOptions(selectedWidget.app_id, resolved)
        .then(opts => setDynamicOptions(prev => ({ ...prev, [cacheKey]: opts })))
        .catch(() => setDynamicOptions(prev => ({ ...prev, [cacheKey]: [] })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWidget?.app_id, selectedWidgetManifest, selectedConfigKey])

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

  const updateWidgetConfig = useCallback((widgetId: string, key: string, value: string | number | boolean) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx
        ? { ...s, widgets: s.widgets.map(w => w.id === widgetId ? { ...w, config: { ...w.config, [key]: value } } : w) }
        : s
    ))
  }, [currentSlideIdx])

  const removeWidget = (widgetId: string) => {
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: s.widgets.filter(w => w.id !== widgetId) } : s
    ))
    setSelectedWidgetId(null)
  }

  // ── Library ──────────────────────────────────────────────────────────────
  const onLibraryDragStart = (appId: number, m: WidgetManifestEntry) => {
    dragDataRef.current = { appId, manifest: m }
  }

  const toggleAppCollapsed = (appId: number) =>
    setCollapsedApps(prev => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })

  /** Pull fresh manifests from every app — an app that has just gained widgets
   *  otherwise stays stale in the library until the next hub health poll. Also
   *  drops the cached param options, so devices/interfaces added or removed
   *  since the editor opened are picked up without a reload. */
  const refreshLibrary = async () => {
    setRefreshing(true)
    try {
      await api.refreshManifests()
      const appList = await api.listApps()
      setApps((appList as any[]).filter(
        (a: any) => Array.isArray(a.widget_manifest) && a.widget_manifest.length > 0
      ))
      setDynamicOptions({})
    } catch { /* leave the cached library in place */ } finally { setRefreshing(false) }
  }

  // Search narrows each app to its matching widgets; apps left with none drop out.
  const q = libQuery.trim().toLowerCase()
  const filteredApps = apps
    .map(a => ({ ...a, widget_manifest: a.widget_manifest.filter(m => matchesQuery(m, q)) }))
    .filter(a => a.widget_manifest.length > 0)
  const totalWidgets = apps.reduce((n, a) => n + a.widget_manifest.length, 0)

  const onCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragDataRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const z = zoomRef.current
    const m = dragDataRef.current.manifest
    // Center widget on cursor, clamped to canvas boundary
    const x = Math.max(0, Math.min(CANVAS_W - m.default_w,
      snapVal(Math.round((e.clientX - rect.left) / z - m.default_w / 2))))
    const y = Math.max(0, Math.min(CANVAS_H - m.default_h,
      snapVal(Math.round((e.clientY - rect.top) / z - m.default_h / 2))))
    const { appId } = dragDataRef.current
    const placed: PlacedWidget = {
      id: uid(), app_id: appId, widget_id: m.id, view_path: m.view_path,
      title: m.title, x, y, w: m.default_w, h: m.default_h,
    }
    setSlides(prev => prev.map((s, i) =>
      i === currentSlideIdx ? { ...s, widgets: [...s.widgets, placed] } : s
    ))
    setSelectedWidgetId(placed.id); dragDataRef.current = null
  }

  // ── Widget drag-move ──────────────────────────────────────────────────────
  const onWidgetMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation(); setSelectedWidgetId(w.id)
    dragMoveRef.current = {
      widgetId: w.id, startX: e.clientX, startY: e.clientY,
      origX: w.x, origY: w.y, origW: w.w, origH: w.h,
    }
  }

  // ── Widget resize ─────────────────────────────────────────────────────────
  const onResizeMouseDown = (e: React.MouseEvent, w: PlacedWidget) => {
    e.preventDefault(); e.stopPropagation()
    const m = apps.flatMap(a => a.widget_manifest.map(wm => ({ ...wm, appId: a.id })))
                  .find(wm => wm.appId === w.app_id && wm.id === w.widget_id)
    resizeMoveRef.current = {
      widgetId: w.id, startX: e.clientX, startY: e.clientY,
      origW: w.w, origH: w.h, origX: w.x, origY: w.y,
      minW: m?.min_w ?? 150, minH: m?.min_h ?? 100,
    }
  }

  // ── Mouse move: drag + resize with hard boundary clamping ─────────────────
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const z = zoomRef.current
    if (resizeMoveRef.current) {
      const r = resizeMoveRef.current
      updateWidget(r.widgetId, {
        w: Math.max(r.minW, Math.min(CANVAS_W - r.origX, snapVal(r.origW + (e.clientX - r.startX) / z))),
        h: Math.max(r.minH, Math.min(CANVAS_H - r.origY, snapVal(r.origH + (e.clientY - r.startY) / z))),
      })
      return
    }
    if (dragMoveRef.current) {
      const d = dragMoveRef.current
      updateWidget(d.widgetId, {
        x: Math.max(0, Math.min(CANVAS_W - d.origW, snapVal(d.origX + (e.clientX - d.startX) / z))),
        y: Math.max(0, Math.min(CANVAS_H - d.origH, snapVal(d.origY + (e.clientY - d.startY) / z))),
      })
    }
  }
  const onCanvasMouseUp = () => { dragMoveRef.current = null; resizeMoveRef.current = null }

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    try {
      await api.updateNOC(Number(id), { layout: slides, display_mode: displayMode, dwell_seconds: nocDwell })
      setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
    } catch { setSaveMsg('Save failed') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ height: '100vh', background: '#0e131c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7f8a9b', fontSize: '14px' }}>
      Loading editor…
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0e131c', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', height: '52px', borderBottom: '1px solid rgba(255,255,255,0.15)', flexShrink: 0, background: '#19212d', ...LAYER }}>
        <button onClick={() => navigate('/noc')} style={{ color: '#d2ccc0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '4px 0' }}>← Back</button>
        <span style={{ color: '#f2eee5', fontSize: '14px', fontWeight: 500 }}>{noc?.name}</span>
        <HelpButton title="NOC Editor — How It Works">
          <p>Drag widgets from a registered app's manifest onto the canvas — each one is a live iframe of that app's own dashboard view, positioned and sized on a {CANVAS_W}×{CANVAS_H} reference canvas that scales to fit whatever screen the display ends up on.</p>
          <p>Multiple slides only matter in Rotating mode, where the display cycles through them on the per-slide dwell timer. Snap constrains dragging to a {SNAP_GRID}px grid for cleaner alignment.</p>
        </HelpButton>

        {/* Slide tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, overflowX: 'auto', paddingLeft: '8px' }}>
          {slides.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <button
                onClick={() => { setCurrentSlideIdx(i); setSelectedWidgetId(null) }}
                style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s', border: i === currentSlideIdx ? '1px solid #466cc8' : '1px solid transparent', background: i === currentSlideIdx ? '#466cc8' : '#1c2430', color: i === currentSlideIdx ? '#fff' : '#d2ccc0' }}
              >{s.title}</button>
              {slides.length > 1 && (
                <button onClick={() => removeSlide(i)} style={{ color: '#7f8a9b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addSlide} style={{ color: '#b0a0dd', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', flexShrink: 0 }}>+ Slide</button>
        </div>

        {/* Display mode pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '20px', padding: '3px 8px', flexShrink: 0 }}>
          {(['static','rotating','manual'] as const).map(m => (
            <button key={m} onClick={() => setDisplayMode(m)} style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', border: 'none', transition: 'all 0.15s', background: displayMode === m ? 'rgba(167,139,250,0.18)' : 'transparent', color: displayMode === m ? '#b0a0dd' : '#d2ccc0' }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          {displayMode === 'rotating' && (
            <>
              <span style={{ color: '#7f8a9b', fontSize: '11px', margin: '0 2px' }}>·</span>
              <input type="number" min={5} value={nocDwell} onChange={e => setNOCDwell(Math.max(5, parseInt(e.target.value) || 30))}
                style={{ width: '40px', background: 'transparent', border: 'none', fontSize: '11px', color: '#b0a0dd', outline: 'none', textAlign: 'center' }} />
              <span style={{ fontSize: '11px', color: '#7f8a9b' }}>s</span>
            </>
          )}
        </div>

        {/* Snap toggle */}
        <button
          onClick={() => setSnapEnabled(s => !s)}
          title="Snap to 24px grid"
          style={{ color: snapEnabled ? '#b0a0dd' : '#7f8a9b', background: snapEnabled ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.10)', border: `1px solid ${snapEnabled ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.18)'}`, borderRadius: '20px', padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
        >Snap</button>

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '20px', padding: '3px 8px', flexShrink: 0 }}>
          <button onClick={fitCanvas} title="Fit canvas to screen" style={{ color: '#b0a0dd', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: '0 6px', lineHeight: 1 }}>Fit</button>
          <span style={{ color: '#7f8a9b', fontSize: '11px', userSelect: 'none' }}>·</span>
          <button onClick={zoomOut} title="Zoom out" style={{ color: '#d2ccc0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}>−</button>
          <span style={{ fontSize: '11px', color: '#d2ccc0', minWidth: '36px', textAlign: 'center', fontFamily: 'monospace', userSelect: 'none' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} title="Zoom in" style={{ color: '#d2ccc0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}>+</button>
        </div>

        {saveMsg && <span style={{ fontSize: '12px', color: saveMsg === 'Saved' ? '#9aeabd' : '#ff8478', flexShrink: 0 }}>{saveMsg}</span>}
        <button onClick={save} disabled={saving} style={{ padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', border: 'none', color: '#fff', flexShrink: 0, background: saving ? '#2a2418' : 'linear-gradient(90deg,#b0a0dd,#8ad8ea)', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── 3-panel body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: Widget library ── */}
        <div style={{ width: '248px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.15)', background: '#0e131c', display: 'flex', flexDirection: 'column', ...LAYER }}>

          {/* Library header — title, count, manifest resync */}
          <div style={{ padding: '12px 10px 8px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', paddingLeft: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#7f8a9b', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                Widget Library
              </span>
              <span style={{ fontSize: '10px', color: '#7f8a9b', fontFamily: 'monospace' }}>{totalWidgets}</span>
              <button
                onClick={refreshLibrary}
                disabled={refreshing}
                title="Re-fetch widget manifests from every registered app"
                style={{ color: refreshing ? '#7f8a9b' : '#d2ccc0', background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer', fontSize: '12px', lineHeight: 1, padding: '0 2px' }}
              >⟳</button>
            </div>
            <input
              type="text"
              value={libQuery}
              onChange={e => setLibQuery(e.target.value)}
              placeholder="Search widgets…"
              style={{ ...inputSt, padding: '5px 8px', fontSize: '12px' }}
            />
          </div>

          {/* Library body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {filteredApps.map(app => {
              const clr        = appColor(app.name)
              const ready      = proxyReady.has(app.id)
              // A search result is always expanded — collapsing only applies to browsing.
              const collapsed  = !q && collapsedApps.has(app.id)
              const categories = groupByCategory(app.widget_manifest)

              return (
                <div key={app.id} style={{ marginBottom: '12px' }}>
                  <button
                    onClick={() => toggleAppCollapsed(app.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', padding: '2px 4px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ready ? clr : '#7f8a9b', display: 'inline-block', flexShrink: 0, transition: 'background 0.3s' }} />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: clr, letterSpacing: '0.03em', flex: 1 }}>{app.name}</span>
                    <span style={{ fontSize: '10px', color: '#7f8a9b', fontFamily: 'monospace' }}>{app.widget_manifest.length}</span>
                    <span style={{ fontSize: '9px', color: '#7f8a9b' }}>{collapsed ? '▸' : '▾'}</span>
                  </button>

                  {!collapsed && categories.map(([cat, entries]) => (
                    <div key={cat} style={{ marginBottom: '6px' }}>
                      {/* A single unnamed bucket needs no header — it is the whole app */}
                      {!(categories.length === 1 && cat === UNGROUPED) && (
                        <div style={{ fontSize: '9px', color: '#7f8a9b', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '6px 0 4px', paddingLeft: '6px' }}>{cat}</div>
                      )}
                      {entries.map(m => (
                        <div
                          key={m.id}
                          draggable
                          onDragStart={() => onLibraryDragStart(app.id, m)}
                          title={m.description ?? m.title}
                          style={{ padding: '7px 10px', marginBottom: '4px', borderRadius: '6px', fontSize: '12px', cursor: 'grab', background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.15)', color: '#d2ccc0', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.18)'; (e.currentTarget as HTMLDivElement).style.color = '#f2eee6' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.16)'; (e.currentTarget as HTMLDivElement).style.color = '#f2eee6' }}
                        >
                          <span style={{ fontSize: '9px', color: '#7f8a9b', flexShrink: 0 }}>⠿</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )
            })}

            {apps.length === 0 && (
              <div style={{ fontSize: '12px', color: '#7f8a9b', padding: '8px 4px', textAlign: 'center' }}>No apps with widgets</div>
            )}
            {apps.length > 0 && filteredApps.length === 0 && (
              <div style={{ fontSize: '12px', color: '#7f8a9b', padding: '8px 4px', textAlign: 'center' }}>No widgets match “{libQuery.trim()}”</div>
            )}
          </div>
        </div>

        {/* ── Center: Canvas area ── */}
        <div
          ref={canvasAreaRef}
          onDragOver={e => e.preventDefault()} onDrop={onCanvasDrop}
          onMouseMove={onCanvasMouseMove} onMouseUp={onCanvasMouseUp} onMouseLeave={onCanvasMouseUp}
          onClick={() => setSelectedWidgetId(null)}
          style={{ flex: 1, overflow: 'auto', minWidth: 0, backgroundColor: '#0e131c', padding: '20px', boxSizing: 'border-box' }}
        >
          {/* Zoom wrapper — sized to match the visual canvas footprint so scroll is correct */}
          <div style={{ width: `${CANVAS_W * zoom}px`, height: `${CANVAS_H * zoom}px`, position: 'relative', flexShrink: 0 }}>
            {/* Canvas — fixed 1920×1080, CSS scaled, with visible boundary */}
            <div
              ref={canvasRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: `${CANVAS_W}px`,
                height: `${CANVAS_H}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                backgroundImage: 'radial-gradient(circle, rgba(96,113,138,0.75) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
                backgroundColor: '#121822',
                border: '2px solid rgba(99,102,241,0.5)',
                boxSizing: 'border-box',
                cursor: 'default',
                overflow: 'hidden',
                boxShadow: '0 0 0 1px rgba(99,102,241,0.15), 0 8px 40px rgba(0,0,0,0.6)',
              }}
            >
              {currentSlide?.widgets.map(w => {
                const wApp = apps.find(a => a.id === w.app_id)
                const clr  = wApp ? appColor(wApp.name) : '#d2ccc0'
                const isSel = w.id === selectedWidgetId
                const proxyBase = wApp && proxyReady.has(w.app_id) ? `/proxy/${w.app_id}` : null
                const frameSrc  = proxyBase ? widgetIframeSrc(w, proxyBase, noc?.widget_refresh) : null

                return (
                  <div
                    key={w.id}
                    onMouseDown={ev => onWidgetMouseDown(ev, w)}
                    onClick={ev => ev.stopPropagation()}
                    style={{
                      position: 'absolute', left: w.x, top: w.y, width: w.w, height: w.h,
                      border: isSel ? `2px solid ${clr}` : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px', overflow: 'hidden', cursor: 'move',
                      boxShadow: isSel ? `0 0 0 1px ${clr}33, 0 4px 20px rgba(0,0,0,0.5)` : '0 2px 12px rgba(0,0,0,0.4)',
                      background: '#0e131c', userSelect: 'none', transition: 'border-color 0.1s',
                    }}
                  >
                    {frameSrc ? (
                      <iframe
                        src={frameSrc}
                        style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }}
                        title={w.title}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7f8a9b', fontSize: '12px' }}>
                        {w.title}
                      </div>
                    )}

                    {/* Title bar (selected only) */}
                    {isSel && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '22px', background: `${clr}22`, borderBottom: `1px solid ${clr}44`, display: 'flex', alignItems: 'center', padding: '0 6px', gap: '4px' }}>
                        <span style={{ fontSize: '10px', color: clr, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={ev => { ev.stopPropagation(); removeWidget(w.id) }}
                          style={{ color: '#d2ccc0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                        >×</button>
                      </div>
                    )}

                    {/* Resize handle */}
                    <div
                      onMouseDown={ev => onResizeMouseDown(ev, w)}
                      style={{ position: 'absolute', bottom: 0, right: 0, width: '16px', height: '16px', cursor: 'se-resize', background: isSel ? `${clr}33` : 'transparent', borderTop: isSel ? `1px solid ${clr}55` : 'none', borderLeft: isSel ? `1px solid ${clr}55` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSel && <span style={{ fontSize: '8px', color: clr, lineHeight: 1 }}>⊡</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Config panel ── */}
        <div style={{ width: '240px', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', background: '#0e131c', overflowY: 'auto', padding: '12px', ...LAYER }}>

          {/* Selected widget config */}
          {selectedWidget ? (
            <>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#7f8a9b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>Widget</div>
              <div style={{ fontSize: '12px', color: selColor, marginBottom: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedWidget.title}</div>

              {/* Position */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '10px', color: '#7f8a9b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>Position</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {(['x','y'] as const).map(f => (
                    <label key={f} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ fontSize: '10px', color: '#d2ccc0' }}>{f.toUpperCase()}</span>
                      <input
                        type="number" min={0}
                        max={f === 'x' ? CANVAS_W - selectedWidget.w : CANVAS_H - selectedWidget.h}
                        value={Math.round(selectedWidget[f])}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 0
                          updateWidget(selectedWidget.id, {
                            [f]: f === 'x'
                              ? Math.max(0, Math.min(CANVAS_W - selectedWidget.w, val))
                              : Math.max(0, Math.min(CANVAS_H - selectedWidget.h, val))
                          })
                        }}
                        style={inputSt}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '10px', color: '#7f8a9b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>Size</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {(['w','h'] as const).map(f => (
                    <label key={f} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ fontSize: '10px', color: '#d2ccc0' }}>{f === 'w' ? 'W' : 'H'}</span>
                      <input
                        type="number"
                        min={f === 'w' ? selMinW : selMinH}
                        max={f === 'w' ? CANVAS_W - selectedWidget.x : CANVAS_H - selectedWidget.y}
                        value={Math.round(selectedWidget[f])}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 0
                          updateWidget(selectedWidget.id, {
                            [f]: f === 'w'
                              ? Math.max(selMinW, Math.min(CANVAS_W - selectedWidget.x, val))
                              : Math.max(selMinH, Math.min(CANVAS_H - selectedWidget.y, val))
                          })
                        }}
                        style={inputSt}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Widget-declared params — device/subnet/AP pickers, filters, etc. */}
              {(selectedWidgetManifest?.params ?? []).length > 0 && (
                <>
                  <div style={{ paddingTop: '14px', paddingBottom: '4px' }}>
                    <p style={{ fontSize: '10px', fontWeight: 600, color: '#d2ccc0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filters</p>
                  </div>
                  {selectedWidgetManifest!.params!.map(p => {
                    const resolved = p.options_path
                      ? resolveOptionsPath(p.options_path, selectedWidget.config)
                      : null
                    const opts = p.options_path
                      ? (resolved ? dynamicOptions[`${selectedWidget.app_id}:${resolved}`] ?? [] : [])
                      : (p.options ?? [])
                    // A picker that narrows by another param can't be filled until
                    // that one is chosen — say so instead of showing "Loading…".
                    const blockedBy = p.options_path && !resolved
                      ? optionsDeps(p.options_path)
                          .filter(d => {
                            const v = selectedWidget.config?.[d]
                            return v === undefined || v === ''
                          })
                          .map(d => selectedWidgetManifest!.params!.find(x => x.key === d)?.label ?? d)
                      : []

                    return (
                      <label key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                        <span style={{ fontSize: '10px', color: '#d2ccc0' }}>{p.label}</span>
                        <select
                          value={String(selectedWidget.config?.[p.key] ?? '')}
                          disabled={blockedBy.length > 0}
                          onChange={e => {
                            updateWidgetConfig(selectedWidget.id, p.key, e.target.value)
                            // Clear any param narrowed by this one — its old value
                            // belongs to the previous parent and would silently
                            // point the widget at data from the wrong device.
                            selectedWidgetManifest!.params!
                              .filter(c => c.options_path && optionsDeps(c.options_path).includes(p.key))
                              .forEach(c => updateWidgetConfig(selectedWidget.id, c.key, ''))
                          }}
                          style={{ ...inputSt, opacity: blockedBy.length > 0 ? 0.5 : 1 }}
                        >
                          {!p.options_path && <option value="">All</option>}
                          {blockedBy.length > 0 && <option value="">Choose {blockedBy.join(' & ')} first</option>}
                          {p.options_path && !blockedBy.length && opts.length === 0 && <option value="">Loading…</option>}
                          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                    )
                  })}
                </>
              )}

              <button
                onClick={() => removeWidget(selectedWidget.id)}
                style={{ width: '100%', padding: '7px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: '#ff8478' }}
              >Remove Widget</button>
            </>
          ) : (
            <>
              {/* Slide config */}
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#7f8a9b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>Slide</div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                <span style={{ fontSize: '10px', color: '#d2ccc0' }}>Title</span>
                <input type="text" value={currentSlide?.title ?? ''} onChange={e => updateSlide({ title: e.target.value })} style={inputSt} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                <span style={{ fontSize: '10px', color: '#d2ccc0' }}>Dwell (seconds)</span>
                <input type="number" min={5} value={currentSlide?.dwell_seconds ?? 30} onChange={e => updateSlide({ dwell_seconds: Math.max(5, parseInt(e.target.value) || 30) })} style={inputSt} />
              </label>

              {/* Canvas info */}
              <div style={{ padding: '10px', borderRadius: '6px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: '#466cc8', fontWeight: 600, marginBottom: '6px', letterSpacing: '0.04em' }}>Canvas</div>
                <div style={{ fontSize: '11px', color: '#7f8a9b' }}>1920 × 1080 px</div>
                <div style={{ fontSize: '11px', color: '#7f8a9b', marginTop: '3px' }}>{currentSlide?.widgets.length ?? 0} widget{(currentSlide?.widgets.length ?? 0) !== 1 ? 's' : ''}</div>
              </div>

              <div style={{ fontSize: '11px', color: '#7f8a9b', lineHeight: 1.5, padding: '0 2px' }}>
                Drag widgets from the library onto the canvas. Click a widget to select and configure it.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
