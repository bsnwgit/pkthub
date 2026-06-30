import { useEffect, useState, ReactNode } from 'react'
import { api } from '../api/client'
import {
  Fingerprint, Palette, Clock, Network, Lock, Key, AppWindow,
  Monitor, Bell, FileText, Wrench, Save, Info, AlertTriangle
} from 'lucide-react'

// ---------- types ----------
interface Setting { key: string; label: string; description?: string; type?: 'text' | 'number' | 'toggle' | 'select'; options?: string[] }
interface Group { id: string; label: string; icon: any; sections: { id: string; title: string; settings: Setting[] }[] }

// ---------- nav structure ----------
const NAV_GROUPS: Group[] = [
  {
    id: 'platform', label: 'Platform', icon: Fingerprint,
    sections: [
      {
        id: 'identity', title: 'Identity',
        settings: [
          { key: 'platform_name', label: 'Platform Name', description: 'Displayed in the top bar and emails.', type: 'text' },
          { key: 'platform_url', label: 'Platform URL', description: 'Canonical HTTPS URL for this pktSuite instance.', type: 'text' },
        ]
      },
      {
        id: 'theme', title: 'Theme',
        settings: [
          { key: 'theme_accent', label: 'Accent Override', description: 'Leave blank to use per-app colors.', type: 'text' },
        ]
      },
      {
        id: 'timezone', title: 'Timezone',
        settings: [
          { key: 'timezone', label: 'Timezone', type: 'text', description: 'e.g. America/New_York. Used for audit log timestamps.' },
        ]
      },
    ]
  },
  {
    id: 'network', label: 'Network', icon: Network,
    sections: [
      {
        id: 'port', title: 'Port',
        settings: [
          { key: 'listen_port', label: 'Listen Port', type: 'number', description: 'Restart required after change. Default: 8760.' },
        ]
      },
      {
        id: 'tls', title: 'TLS',
        settings: [
          { key: 'ssl_cert_path', label: 'Certificate Path', type: 'text' },
          { key: 'ssl_key_path', label: 'Private Key Path', type: 'text' },
        ]
      },
      {
        id: 'cidrs', title: 'Trusted CIDRs',
        settings: [
          { key: 'trusted_cidrs', label: 'Allowed CIDRs', type: 'text', description: 'Comma-separated. Empty = allow all. e.g. 10.0.0.0/8,172.16.0.0/12' },
        ]
      },
    ]
  },
  {
    id: 'auth', label: 'Authentication', icon: Key,
    sections: [
      {
        id: 'local', title: 'Local Auth',
        settings: [
          { key: 'local_auth_enabled', label: 'Local Auth Enabled', type: 'toggle' },
          { key: 'min_password_length', label: 'Minimum Password Length', type: 'number' },
        ]
      },
      {
        id: 'okta', title: 'Okta / OIDC',
        settings: [
          { key: 'okta_enabled', label: 'Okta/OIDC Enabled', type: 'toggle' },
          { key: 'okta_domain', label: 'Okta Domain', type: 'text', description: 'e.g. company.okta.com' },
          { key: 'okta_client_id', label: 'Client ID', type: 'text' },
          { key: 'okta_client_secret', label: 'Client Secret', type: 'text' },
        ]
      },
      {
        id: 'jwt', title: 'JWT Policy',
        settings: [
          { key: 'jwt_expire_minutes', label: 'Token Expiry (minutes)', type: 'number', description: 'Default: 60' },
        ]
      },
    ]
  },
  {
    id: 'registry', label: 'App Registry', icon: AppWindow,
    sections: [
      {
        id: 'reg-defaults', title: 'Registration Defaults',
        settings: [
          { key: 'default_app_mode', label: 'Default Mode on Register', type: 'select', options: ['observe', 'managed'] },
        ]
      },
      {
        id: 'health', title: 'Health Polling',
        settings: [
          { key: 'health_poll_interval', label: 'Poll Interval (seconds)', type: 'number', description: 'How often to ping /api/health on each app. Default: 30.' },
          { key: 'health_timeout', label: 'Timeout (seconds)', type: 'number' },
        ]
      },
      {
        id: 'token-rotation', title: 'Suite-Token Rotation',
        settings: [
          { key: 'auto_rotate_days', label: 'Auto-Rotate Every N Days', type: 'number', description: '0 = manual only.' },
        ]
      },
    ]
  },
  {
    id: 'kiosk', label: 'Kiosk', icon: Monitor,
    sections: [
      {
        id: 'kiosk-defaults', title: 'Default Intervals',
        settings: [
          { key: 'kiosk_default_dwell', label: 'Default Dwell Time (seconds)', type: 'number', description: 'Default slide dwell for new kiosks. Default: 30.' },
          { key: 'kiosk_widget_refresh', label: 'Widget Refresh Interval (seconds)', type: 'number' },
        ]
      },
      {
        id: 'display-tokens', title: 'Display Token Policy',
        settings: [
          { key: 'display_token_expire_days', label: 'Display Token Expiry (days)', type: 'number', description: '0 = never expire.' },
        ]
      },
    ]
  },
  {
    id: 'notifications', label: 'Notifications', icon: Bell,
    sections: [
      {
        id: 'smtp', title: 'SMTP',
        settings: [
          { key: 'smtp_host', label: 'SMTP Host', type: 'text' },
          { key: 'smtp_port', label: 'SMTP Port', type: 'number' },
          { key: 'smtp_username', label: 'Username', type: 'text' },
          { key: 'smtp_password', label: 'Password', type: 'text' },
          { key: 'smtp_from', label: 'From Address', type: 'text' },
        ]
      },
      {
        id: 'webhooks', title: 'Webhooks',
        settings: [
          { key: 'webhook_url', label: 'Webhook URL', type: 'text', description: 'POST JSON payload on alert events.' },
        ]
      },
      {
        id: 'alert-events', title: 'Alert Events',
        settings: [
          { key: 'notify_on_unreachable', label: 'Notify when app goes unreachable', type: 'toggle' },
          { key: 'notify_on_break_glass', label: 'Notify on break-glass unlock', type: 'toggle' },
          { key: 'notify_on_mode_change', label: 'Notify on mode change', type: 'toggle' },
        ]
      },
    ]
  },
  {
    id: 'audit', label: 'Audit & Logging', icon: FileText,
    sections: [
      {
        id: 'retention', title: 'Retention',
        settings: [
          { key: 'audit_retention_days', label: 'Audit Log Retention (days)', type: 'number', description: 'Entries older than this are purged. 0 = keep forever.' },
        ]
      },
      {
        id: 'log-level', title: 'Log Level',
        settings: [
          { key: 'log_level', label: 'Log Level', type: 'select', options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'] },
        ]
      },
    ]
  },
  {
    id: 'maintenance', label: 'Maintenance', icon: Wrench,
    sections: [
      {
        id: 'backup', title: 'Backup',
        settings: [
          { key: 'backup_path', label: 'Backup Directory', type: 'text' },
          { key: 'backup_retain_count', label: 'Retain Last N Backups', type: 'number' },
        ]
      },
      {
        id: 'maint-mode', title: 'Maintenance Mode',
        settings: [
          { key: 'maintenance_mode', label: 'Maintenance Mode Active', type: 'toggle', description: 'Blocks non-admin access and shows a maintenance banner.' },
        ]
      },
    ]
  },
]

// ---------- sub-components ----------
function ToggleInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const on = value === 'true'
  return (
    <button
      onClick={() => onChange(on ? 'false' : 'true')}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-500' : 'bg-gray-700'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function SettingRow({ s, value, onChange }: { s: Setting; value: string; onChange: (k: string, v: string) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-800/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-gray-200">{s.label}</p>
        {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
      </div>
      <div className="shrink-0">
        {s.type === 'toggle' ? (
          <ToggleInput value={value} onChange={v => onChange(s.key, v)} />
        ) : s.type === 'select' ? (
          <select
            value={value}
            onChange={e => onChange(s.key, e.target.value)}
            className="text-sm px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
          >
            {s.options?.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={s.type === 'number' ? 'number' : 'text'}
            value={value}
            onChange={e => onChange(s.key, e.target.value)}
            className="text-sm px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500 w-52"
          />
        )}
      </div>
    </div>
  )
}

// ---------- main page ----------
export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState('platform')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSettings().then(c => { setConfig(c); setDirty({}) }).finally(() => setLoading(false))
  }, [])

  const merged = { ...config, ...dirty }

  const onChange = (key: string, value: string) => {
    setDirty(d => ({ ...d, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const items = Object.entries(dirty).map(([key, value]) => ({ key, value }))
      await api.setSettingsBulk(items)
      setConfig(m => ({ ...m, ...dirty }))
      setDirty({})
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const group = NAV_GROUPS.find(g => g.id === activeGroup)!

  return (
    <div className="flex h-full" style={{ background: '#0a1628' }}>
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-gray-800 overflow-y-auto sticky top-0 h-screen" style={{ background: '#0d1f3c' }}>
        <div className="px-4 py-5 border-b border-gray-800">
          <h1 className="text-sm font-bold text-white">Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Platform configuration</p>
        </div>
        <nav className="p-2 space-y-0.5">
          {NAV_GROUPS.map(g => (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                activeGroup === g.id ? 'bg-blue-500/15 text-blue-400' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <g.icon size={15} />
              {g.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-8 max-w-2xl">
        {loading ? (
          <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <group.icon size={20} className="text-blue-400" />
                <h2 className="text-lg font-bold text-white">{group.label}</h2>
              </div>
              {Object.keys(dirty).length > 0 && (
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                  style={{ background: '#60a5fa' }}
                >
                  <Save size={13} />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
              {saved && <span className="text-xs text-green-400">Saved!</span>}
            </div>

            <div className="space-y-6">
              {group.sections.map(sec => (
                <div key={sec.id} className="rounded-xl border border-gray-800 p-5" style={{ background: '#111827' }}>
                  <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-4">{sec.title}</h3>
                  <div>
                    {sec.settings.map(s => (
                      <SettingRow key={s.key} s={s} value={merged[s.key] ?? ''} onChange={onChange} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Restart callout for network changes */}
            {activeGroup === 'network' && (
              <div className="mt-4 rounded-xl border border-yellow-800/30 p-4 flex gap-3" style={{ background: '#1a1500' }}>
                <AlertTriangle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-300">Network and TLS changes require a service restart: <code className="text-yellow-400">sudo systemctl restart pktsuite</code></p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
