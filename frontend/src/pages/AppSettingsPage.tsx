import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
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

  useEffect(() => {
    if (!id) return
    api.listApps().then((apps: RegApp[]) => setApp(apps.find(a => a.id === id) ?? null)).catch(() => {})
    api.createProxySession(id).then(() => setReady(true)).catch(e => setError(e.message || 'Failed to start session'))
  }, [id])

  return (
    <div className="p-6 h-full flex flex-col space-y-4">
      {error && (
        <div className="px-4 py-2.5 rounded-lg border border-red-800/40 bg-red-900/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {ready ? (
        <iframe
          src={`/proxy/${id}/settings?chromeless=1`}
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
