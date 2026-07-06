import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { PktSuiteIcon } from '../components/Logo'

// ─── Reference canvas size ────────────────────────────────────────────────────
// Widgets are positioned in this coordinate space in the editor.
// The display page scales the entire canvas to fit the actual screen.
const CANVAS_W = 1920
const CANVAS_H = 1080
const HEADER_H = 44

interface NOCWidget {
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

interface NOCSlide {
  id: string
  title?: string
  dwell_seconds?: number
  widgets: NOCWidget[]
}

export default function NOCDisplayPage() {
  const { token } = useParams()
  const [noc, setNOC] = useState<any>(null)
  const [error, setError] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const [scale, setScale] = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Scale-to-fit: recompute whenever window is resized ────────────────────
  useEffect(() => {
    const compute = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight - HEADER_H
      setScale(Math.max(vw / CANVAS_W, vh / CANVAS_H))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  // ── Load NOC layout ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    const load = () => api.getNOCDisplay(token).then(setNOC).catch(e => setError(e.message))
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [token])

  const slides: NOCSlide[] = Array.isArray(noc?.layout) ? noc.layout : []

  // ── Rotation timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!noc || noc.display_mode !== 'rotating' || slides.length < 2) return
    const dwell = ((slides[currentSlide]?.dwell_seconds ?? noc.dwell_seconds ?? 30)) * 1000
    timerRef.current = setTimeout(() => {
      setCurrentSlide(i => (i + 1) % slides.length)
    }, dwell)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [noc, currentSlide, slides])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-sm text-red-400" style={{ background: '#0a1628' }}>
      {error === 'Not Found' ? 'Display token not found or revoked.' : error}
    </div>
  )

  if (!noc) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a1628' }}>
      <PktSuiteIcon size={48} />
    </div>
  )

  const slide = slides[currentSlide]

  return (
    <div className="flex flex-col" style={{ background: '#0a1628', height: '100vh', overflow: 'hidden' }}>

      {/* Minimal header bar */}
      <div className="flex items-center justify-between px-6 border-b border-gray-800/60"
        style={{ height: `${HEADER_H}px`, flexShrink: 0 }}>
        <div className="flex items-center gap-2">
          <PktSuiteIcon size={18} />
          <span className="text-xs text-gray-400 font-mono">{noc.name}</span>
          {noc.display_mode === 'rotating' && slides.length > 1 && slide?.title && (
            <span className="text-xs text-gray-600 ml-1">{slide.title}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {noc.display_mode === 'rotating' && slides.length > 1 && (
            <div className="flex gap-1.5">
              {slides.map((_: NOCSlide, i: number) => (
                <div key={i} onClick={() => setCurrentSlide(i)}
                  className="w-1.5 h-1.5 rounded-full cursor-pointer transition-all"
                  style={{ background: i === currentSlide ? '#a78bfa' : '#1e293b' }} />
              ))}
            </div>
          )}
          <div className="flex gap-1">
            {['#60a5fa', '#2dd4bf', '#4ade80', '#a78bfa'].map(c => (
              <div key={c} className="w-1 h-1 rounded-full" style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>

      {/* Canvas area — scale the reference canvas to fit the screen, centered */}
      <div className="flex-1" style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {slides.length === 0 ? (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-sm text-gray-600">No slides configured for this display.</div>
          </div>
        ) : !slide || !slide.widgets || slide.widgets.length === 0 ? (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-sm text-gray-600">No widgets on this slide.</div>
          </div>
        ) : (
          // Zoom wrapper — sized to actual visual footprint so flex centering works correctly.
          <div style={{ width: `${CANVAS_W * scale}px`, height: `${CANVAS_H * scale}px`, position: 'relative', flexShrink: 0 }}>
          {/* Reference canvas — fixed 1920×1080, CSS-scaled from top-left */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${CANVAS_W}px`,
            height: `${CANVAS_H}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}>
            {slide.widgets.map((w: NOCWidget) => (
              <iframe
                key={`${currentSlide}-${w.id}`}
                src={`/proxy-display/${token}/${w.app_id}${w.view_path}`}
                title={w.title || w.widget_id}
                style={{
                  position: 'absolute',
                  left: w.x,
                  top: w.y,
                  width: w.w,
                  height: w.h,
                  border: 'none',
                  borderRadius: '8px',
                  background: '#111827',
                }}
              />
            ))}
          </div>
          </div>
        )}
      </div>
    </div>
  )
}
