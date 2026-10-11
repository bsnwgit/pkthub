import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Small strip above the page when the hub, or any registered app, has a newer
// release. /api/system/suite-updates asks every app for its own status (each
// re-checks GitHub, rate-limited) so this covers the whole suite on load.
// Failure means no banner — it is a hint, never an error.

interface SuiteUpdates {
  hub: { current_version: string; latest_tag: string | null; update_available: boolean }
  apps: { app_id: string; display_name: string; latest_tag: string | null; update_available: boolean }[]
}

export default function HubUpdateBanner() {
  const { user } = useAuth()
  const [st, setSt] = useState<SuiteUpdates | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/system/suite-updates')
      .then(res => (res.ok ? res.json() : null))
      .then(s => { if (live && s) setSt(s) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  if (!st) return null
  const items = [
    ...(st.hub.update_available ? [`pktHub ${st.hub.latest_tag}`] : []),
    ...st.apps.filter(a => a.update_available).map(a => `${a.display_name} ${a.latest_tag}`),
  ]
  if (items.length === 0) return null

  return (
    <div role="status" className="flex-shrink-0 flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-yellow-400">
      <span>Update available: {items.join(' · ')}</span>
      {user?.role === 'admin' && (
        <Link to="/settings?tab=system" className="ml-auto text-blue-400 hover:text-blue-300 underline">View</Link>
      )}
    </div>
  )
}
