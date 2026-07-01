import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { PktSuiteIcon } from '../components/Logo'

export default function KioskDisplayPage() {
  const { token } = useParams()
  const [kiosk, setKiosk] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    const load = () => api.getKioskDisplay(token).then(setKiosk).catch(e => setError(e.message))
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [token])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-sm text-red-400" style={{ background: '#0a1628' }}>
      {error === 'Not Found' ? 'Display token not found or revoked.' : error}
    </div>
  )

  if (!kiosk) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a1628' }}>
      <PktSuiteIcon size={48} />
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#0a1628' }}>
      {/* Minimal header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <PktSuiteIcon size={20} />
          <span className="text-xs text-gray-400 font-mono">{kiosk.name}</span>
        </div>
        <div className="flex gap-1">
          {['#60a5fa', '#2dd4bf', '#4ade80', '#a78bfa'].map(c => (
            <div key={c} className="w-1 h-1 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>

      <div className="p-6">
        {kiosk.slides?.length === 0 ? (
          <div className="text-sm text-gray-500 text-center mt-20">
            No slides configured for this kiosk.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kiosk.slides?.map((slide: any, i: number) => (
              <div key={i} className="rounded-xl border border-gray-800 p-4" style={{ background: '#111827' }}>
                <h3 className="text-sm font-semibold text-white mb-3">{slide.title || `Slide ${i + 1}`}</h3>
                <div className="grid gap-3">
                  {slide.widgets?.map((w: any, j: number) => (
                    <div key={j} className="rounded-lg border border-gray-700/50 p-3 text-xs text-gray-400">
                      {w.title || w.widget_type || 'Widget'}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
