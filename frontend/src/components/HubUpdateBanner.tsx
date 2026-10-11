import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Small strip above the page when what is on screen has a newer release: an
// app's own page shows that app's update, every other pktHub page shows
// pktHub's own. Each is checked once, the first time it is shown after a
// fresh load, and not again while its banner is showing; if the page stays
// open it is asked once every 24 hours. Never every app at once.
// Failure means no banner — it is a hint, never an error.

interface Entry {
  display_name: string
  latest_tag: string | null
  update_available: boolean
}

export default function HubUpdateBanner() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [found, setFound] = useState<Record<string, Entry>>({})
  const [day, setDay] = useState(0)
  const askedDay = useRef<Record<string, number>>({})

  // /app/:id/... is an app's page, /app-settings/:id its Settings.
  const m = pathname.match(/^\/app(?:-settings)?\/(\d+)(?:\/|$)/)
  const appId = m ? m[1] : null
  const key = appId ?? 'hub'

  // One tick per 24 hours the page stays open.
  useEffect(() => {
    const id = setInterval(() => setDay(d => d + 1), 24 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (found[key]?.update_available) return      // already showing: don't ask
    if (askedDay.current[key] === day) return     // asked this round
    askedDay.current[key] = day
    let live = true
    const url = appId ? `/api/system/app-update/${appId}` : '/api/system/update-banner'
    fetch(url)
      .then(res => (res.ok ? res.json() : null))
      .then(s => {
        if (live && s) {
          setFound(prev => ({ ...prev, [key]: {
            display_name: appId ? s.display_name : 'pktHub',
            latest_tag: s.latest_tag,
            update_available: !!s.update_available,
          } }))
        }
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, day])

  const shown = found[key]
  if (!shown || !shown.update_available) return null

  const settings = appId ? `/app-settings/${appId}?tab=system` : '/settings?tab=system'

  return (
    <div role="status" className="flex-shrink-0 flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-yellow-400">
      <span>Update available: {shown.display_name} {shown.latest_tag}</span>
      {user?.role === 'admin' && (
        <Link to={settings} className="ml-auto text-blue-400 hover:text-blue-300 underline">View</Link>
      )}
    </div>
  )
}
