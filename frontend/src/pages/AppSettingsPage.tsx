import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '../api/client'

interface RegApp {
  id: number
  name: string
  display_name: string
}

export default function AppSettingsPage() {
  const { appId } = useParams<{ appId: string }>()
  const id = Number(appId)

  const [app, setApp] = useState<RegApp | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [refreshNonce, setRefreshNonce] = useState(() => Date.now())
  const [refreshing, setRefreshing] = useState(false)

  // Re-establish the proxy session and force a fresh iframe load every time
  // the user lands on a (possibly different) app's settings — the route
  // component isn't remounted when just switching between apps, so this
  // effect is what makes the page "auto refresh" on first arrival.
  useEffect(() => {
    if (!id) return
    setReady(false)
    setError('')
    api.listApps().then((apps: RegApp[]) => setApp(apps.find(a => a.id === id) ?? null)).catch(() => {})
    api.createProxySession(id)
      .then(() => { setReady(true); setRefreshNonce(Date.now()) })
      .catch(e => setError(e.message || 'Failed to start session'))
  }, [id])

  const refresh = useCallback(() => {
    if (!id) return
    setRefreshing(true)
    setError('')
    api.createProxySession(id)
      .then(() => { setReady(true); setRefreshNonce(Date.now()) })
      .catch(e => setError(e.message || 'Failed to refresh session'))
      .finally(() => setRefreshing(false))
  }, [id])

  return (
    <div className="p-6 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-300">
          {app?.display_name || app?.name || 'App'} Settings
        </h1>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Refresh"
          className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-lg border border-red-800/40 bg-red-900/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {ready ? (
        <iframe
          key={refreshNonce}
          src={`/proxy/${id}/settings?chromeless=1&_r=${refreshNonce}`}
          className="flex-1 w-full"
          style={{ border: '1px solid #1f2937', borderRadius: '0.75rem', background: '#0a1628' }}
          title={`${app?.display_name || app?.name || 'App'} Settings`}
        />
      ) : !error ? (
        <div className="px-4 py-3 rounded-lg border border-gray-800 bg-gray-900 text-gray-400 text-sm">Loading…</div>
      ) : null}
    </div>
  )
}
