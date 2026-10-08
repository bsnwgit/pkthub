import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api, type AppNavItem } from '../api/client'

interface RegApp {
  id: number
  name: string
  display_name: string
  nav_manifest?: AppNavItem[]
}

/**
 * One page of a registered app, rendered inside pktHub's own shell.
 *
 * The route is /app/:appId/<the app's own path>, so the sidebar's APPS entries
 * map straight onto the app's routes. What lands in the frame is that app's
 * real page — proxied, with ?chromeless=1 so it drops its own sidebar and
 * header — leaving pktHub's menu as the only navigation on screen. Same
 * mechanism as AppSettingsPage, generalised from /settings to any path the
 * app publishes in its nav manifest.
 */
export default function AppViewPage() {
  const params = useParams()
  const id = Number(params.appId)
  const appPath = `/${params['*'] ?? ''}`

  const [app, setApp] = useState<RegApp | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // The proxy session is per app, not per page — establish it when the app
  // changes and let menu clicks within the same app just re-point the frame.
  useEffect(() => {
    if (!id) return
    setReady(false)
    setError('')
    api.listApps().then((apps: RegApp[]) => setApp(apps.find(a => a.id === id) ?? null)).catch(() => {})
    api.createProxySession(id)
      .then(() => setReady(true))
      .catch(e => setError(e.message || 'Failed to start session'))
  }, [id])

  const refresh = useCallback(() => {
    if (!id) return
    setRefreshing(true)
    setError('')
    api.createProxySession(id)
      .then(() => { setReady(true); setRefreshNonce(n => n + 1) })
      .catch(e => setError(e.message || 'Failed to refresh session'))
      .finally(() => setRefreshing(false))
  }, [id])

  const item = app?.nav_manifest?.find(i => i.path === appPath)
  const src = `/proxy/${id}${appPath}?chromeless=1${refreshNonce ? `&_r=${refreshNonce}` : ''}`

  return (
    <div className="p-3 md:p-6 h-full flex flex-col space-y-3 md:space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-300">
          {item?.label || app?.display_name || 'App'}
        </h1>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Refresh"
          className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="px-4 py-2.5 border border-red-800/40 bg-red-900/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {ready ? (
        <iframe
          src={src}
          className="flex-1 w-full border border-gray-800"
          style={{ background: '#04060a' }}
          title={item?.label || app?.display_name || 'App'}
          allow="fullscreen"
        />
      ) : !error ? (
        <div className="px-4 py-3 border border-gray-800 text-gray-400 text-sm">Loading…</div>
      ) : null}
    </div>
  )
}
