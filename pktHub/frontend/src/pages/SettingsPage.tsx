import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { UserPlus, Trash2, Plus, Pencil, RefreshCw, ExternalLink, ShieldCheck, Eye, Monitor, Globe, EyeOff, Copy } from 'lucide-react'

// ── Generic helpers ────────────────────────────────────────────────────────────
type Settings = Record<string, string>

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-start py-4 border-b border-gray-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {hint && <p className="text-xs text-white mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  )
}

function TextInput({ value, onChange, placeholder = '', secret = false, mono = false, readOnly = false }: {
  value: string; onChange?: (v: string) => void
  placeholder?: string; secret?: boolean; mono?: boolean; readOnly?: boolean
}) {
  return (
    <input
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 ${mono ? 'font-mono' : ''} ${readOnly ? 'cursor-default text-gray-400 bg-gray-900' : ''}`}
    />
  )
}

function NumberInput({ value, onChange, min, max }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  return (
    <input
      type="number" min={min} max={max}
      value={value}
      onChange={e => onChange(parseInt(e.target.value) || 0)}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-700'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function SelectInput({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function RestartServiceRow() {
  const [state, setState] = useState<'idle' | 'restarting' | 'done' | 'error'>('idle')
  const restart = async () => {
    if (state === 'restarting') return
    setState('restarting')
    try {
      await fetch('/api/maintenance/restart', { method: 'POST' })
      setState('done')
      setTimeout(() => setState('idle'), 8000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 4000)
    }
  }
  return (
    <div className="grid grid-cols-3 gap-4 items-start py-4 border-b border-gray-800">
      <div>
        <p className="text-sm font-medium text-white">Restart Service</p>
        <p className="text-xs text-white mt-0.5">Apply backend changes or recover from errors</p>
      </div>
      <div className="col-span-2 flex items-center gap-3">
        <button
          onClick={restart}
          disabled={state === 'restarting'}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {state === 'restarting' ? 'Restarting…' : 'Restart Service'}
        </button>
        {state === 'done' && <span className="text-sm text-amber-400">Restarting — reload in ~5 s</span>}
        {state === 'error' && <span className="text-sm text-red-400">Restart failed — check server logs</span>}
      </div>
    </div>
  )
}

// ── Section wrapper with Save ─────────────────────────────────────────────────
function Section({
  title, children, onSave, saving, saved, error,
}: {
  title: string
  children: React.ReactNode
  onSave: () => Promise<void>
  saving: boolean
  saved: boolean
  error: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="px-6 py-2">
        {children}
      </div>
      <div className="px-6 py-4 border-t border-gray-800 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-green-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}

// ── Send Test button ──────────────────────────────────────────────────────────
function SendTestButton({ channel }: { channel: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'failed' | 'skipped'>('idle')
  const [detail, setDetail] = useState('')
  const run = async () => {
    setStatus('loading')
    setDetail('')
    try {
      const res = await api.testNotification(channel)
      setStatus(res.status as 'sent' | 'failed' | 'skipped')
      setDetail(res.detail || '')
    } catch (e) {
      setStatus('failed')
      setDetail(String(e))
    }
  }
  return (
    <div className="flex items-center gap-3 mt-2 mb-1">
      <button
        onClick={run}
        disabled={status === 'loading'}
        className="px-3 py-1.5 text-xs rounded-lg border border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === 'loading' ? 'Sending…' : 'Send Test'}
      </button>
      {status === 'sent'    && <span className="text-xs text-green-400">✓ Sent{detail ? ` — ${detail}` : ''}</span>}
      {status === 'skipped' && <span className="text-xs text-yellow-400">⚠ Skipped — {detail}</span>}
      {status === 'failed'  && <span className="text-xs text-red-400">✗ Failed — {detail}</span>}
    </div>
  )
}

// ── useSave ───────────────────────────────────────────────────────────────────
interface SaveState { saving: boolean; saved: boolean; error: string }
const INIT: SaveState = { saving: false, saved: false, error: '' }

function useSave(keys: string[], settings: Settings, onSuccess: () => void) {
  const [state, setState] = useState<SaveState>(INIT)
  const save = async () => {
    setState({ saving: true, saved: false, error: '' })
    try {
      const subset: Record<string, string> = {}
      for (const k of keys) if (k in settings) subset[k] = settings[k]
      await api.bulkUpdateSettings(subset)
      setState({ saving: false, saved: true, error: '' })
      onSuccess()
      setTimeout(() => setState(s => ({ ...s, saved: false })), 3000)
    } catch (e: any) {
      setState({ saving: false, saved: false, error: e.message || 'Save failed' })
    }
  }
  return { ...state, save }
}

// ── CertTextarea ──────────────────────────────────────────────────────────────
function CertTextarea({ value, onChange, rows = 4, placeholder = 'MIIDp…', secret = false }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const stripPem = (raw: string) =>
    raw.replace(/-----BEGIN[^-]+-----/g, '').replace(/-----END[^-]+-----/g, '').replace(/\s+/g, '')

  if (secret && value && !revealed) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-green-400 font-mono">
          ✓ Certificate saved
        </div>
        <button type="button" onClick={() => setRevealed(true)}
          className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap px-2 py-1 border border-gray-700 rounded-lg bg-gray-800">
          Replace
        </button>
        <button type="button" onClick={() => onChange('')}
          className="text-xs text-red-400 hover:text-red-300 whitespace-nowrap px-2 py-1 border border-gray-700 rounded-lg bg-gray-800">
          Clear
        </button>
      </div>
    )
  }
  return (
    <div>
      {secret && revealed && (
        <div className="flex justify-end mb-1">
          <button type="button" onClick={() => setRevealed(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
        </div>
      )}
      <textarea
        value={value}
        onChange={e => onChange(stripPem(e.target.value))}
        rows={rows}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
      />
      <p className="text-xs text-gray-600 mt-1">Paste content or drag a .pem / .crt / .cer file</p>
    </div>
  )
}

// ── SAML IdP metadata paste box ───────────────────────────────────────────────
function MetadataPasteBox({ onParsed }: {
  onParsed: (r: { entity_id: string; sso_url: string; cert: string }) => void
}) {
  const [xml, setXml]       = useState('')
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [msg, setMsg]       = useState('')

  const handleChange = (raw: string) => {
    setXml(raw)
    if (!raw.trim()) { setStatus('idle'); setMsg(''); return }
    const result = parseIdpMetadata(raw)
    if (result.error) { setStatus('error'); setMsg(result.error) }
    else { onParsed(result); setStatus('ok'); setMsg('Entity ID, SSO URL, and certificate populated below.') }
  }

  return (
    <div className="space-y-1.5">
      <textarea
        value={xml}
        onChange={e => handleChange(e.target.value)}
        rows={5}
        placeholder={'<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" …>'}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
      />
      {status === 'ok'    && <p className="text-xs text-emerald-400">✓ {msg}</p>}
      {status === 'error' && <p className="text-xs text-red-400">✗ {msg}</p>}
    </div>
  )
}

function parseIdpMetadata(xml: string): { entity_id: string; sso_url: string; cert: string; error?: string } {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.querySelector('parsererror')) return { entity_id: '', sso_url: '', cert: '', error: 'Invalid XML — check the metadata and try again.' }
    const root = doc.querySelector('EntityDescriptor') ?? doc.documentElement
    const entity_id = root.getAttribute('entityID') ?? ''
    const ssoNodes = Array.from(doc.querySelectorAll('SingleSignOnService'))
    const redirect = ssoNodes.find(n => (n.getAttribute('Binding') ?? '').includes('HTTP-Redirect'))
    const sso_url = (redirect ?? ssoNodes[0])?.getAttribute('Location') ?? ''
    const keyDescs = Array.from(doc.querySelectorAll('KeyDescriptor'))
    const signingKd = keyDescs.find(kd => !kd.getAttribute('use') || kd.getAttribute('use') === 'signing')
    const x509El = signingKd?.querySelector('X509Certificate') ?? doc.querySelector('X509Certificate')
    const cert = x509El?.textContent?.replace(/\s+/g, '') ?? ''
    if (!entity_id && !sso_url && !cert) return { entity_id: '', sso_url: '', cert: '', error: 'No SAML IdP data found in this XML.' }
    return { entity_id, sso_url, cert }
  } catch {
    return { entity_id: '', sso_url: '', cert: '', error: 'Failed to parse XML.' }
  }
}

// ── SSL Panel ────────────────────────────────────────────────────────────────
function SslDropZone({ label, accept, file, onFile, dragging, onDrag }: {
  label: string; accept: string; file: File | null
  onFile: (f: File) => void; dragging: boolean; onDrag: (v: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`flex-1 border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors select-none ${
        dragging ? 'border-blue-500 bg-blue-500/10' : file ? 'border-green-600 bg-green-600/10' : 'border-gray-700 hover:border-gray-600'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); onDrag(true) }}
      onDragLeave={() => onDrag(false)}
      onDrop={e => { e.preventDefault(); onDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      {file ? (
        <>
          <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p className="text-xs font-medium text-green-400 text-center break-all">{file.name}</p>
          <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
        </>
      ) : (
        <>
          <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
          </svg>
          <p className="text-xs font-medium text-gray-300 text-center">{label}</p>
          <p className="text-xs text-gray-500">Drop or click to browse</p>
        </>
      )}
    </div>
  )
}

function SslPanel() {
  const [status, setStatus]       = useState<any | null>(null)
  const [mode, setMode]           = useState<'pfx' | 'pem'>('pfx')
  const [certFile, setCertFile]   = useState<File | null>(null)
  const [keyFile,  setKeyFile]    = useState<File | null>(null)
  const [certDrag, setCertDrag]   = useState(false)
  const [keyDrag,  setKeyDrag]    = useState(false)
  const [pfxFile,  setPfxFile]    = useState<File | null>(null)
  const [pfxDrag,  setPfxDrag]    = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [uploading, setUploading] = useState(false)
  const [removing,  setRemoving]  = useState(false)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  const loadStatus = () => api.getSslStatus().then(setStatus).catch(() => setStatus({ installed: false }))
  useEffect(() => { loadStatus() }, [])

  const uploadPem = async () => {
    if (!certFile || !keyFile) return
    setUploading(true); setMsg(null)
    try {
      const s = await api.uploadSsl(certFile, keyFile)
      setStatus(s); setCertFile(null); setKeyFile(null)
      setMsg({ ok: true, text: 'Certificate installed. Restart the service (Maintenance tab) to apply.' })
    } catch (e: any) { setMsg({ ok: false, text: e.message ?? 'Upload failed' }) }
    finally { setUploading(false) }
  }

  const uploadPfx = async () => {
    if (!pfxFile || !passphrase) return
    setUploading(true); setMsg(null)
    try {
      const s = await api.uploadSslPfx(pfxFile, passphrase)
      setStatus(s); setPfxFile(null); setPassphrase('')
      setMsg({ ok: true, text: 'Certificate installed from PFX. Restart the service (Maintenance tab) to apply.' })
    } catch (e: any) { setMsg({ ok: false, text: e.message ?? 'Upload failed' }) }
    finally { setUploading(false) }
  }

  const remove = async () => {
    setRemoving(true); setMsg(null)
    try {
      await api.deleteSsl()
      setStatus({ installed: false })
      setMsg({ ok: true, text: 'Certificate removed. Restart service to disable HTTPS.' })
    } catch (e: any) { setMsg({ ok: false, text: e.message ?? 'Remove failed' }) }
    finally { setRemoving(false) }
  }

  const daysLeft = status?.days_until_expiry ?? 9999
  const expColor = daysLeft < 0 ? 'text-red-400' : daysLeft < 30 ? 'text-yellow-400' : 'text-green-400'
  const expBadge = daysLeft < 0 ? 'Expired' : daysLeft < 30 ? `Expires in ${daysLeft}d` : `Valid · ${daysLeft}d left`

  return (
    <div className="space-y-4">
      {/* Current cert status */}
      {status?.installed ? (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              <span className="text-sm font-medium text-white">Certificate installed</span>
            </div>
            <span className={`text-xs font-medium ${expColor}`}>{expBadge}</span>
          </div>
          {status.subject && <p className="text-xs text-gray-300 font-mono">{status.subject}</p>}
          {status.issuer  && <p className="text-xs text-gray-400">Issued by: {status.issuer}</p>}
          {status.expires && <p className="text-xs text-gray-400">Expires: {status.expires}</p>}
          {status.error   && <p className="text-xs text-red-400">Warning: {status.error}</p>}
          <button onClick={remove} disabled={removing}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 pt-1">
            {removing ? 'Removing…' : '× Remove certificate'}
          </button>
        </div>
      ) : status !== null ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0" />
          No certificate installed · running HTTP
        </div>
      ) : null}

      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 w-fit">
        <button onClick={() => setMode('pfx')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'pfx' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
          PFX / P12
        </button>
        <button onClick={() => setMode('pem')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'pem' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
          PEM (cert + key)
        </button>
      </div>

      {mode === 'pfx' ? (
        <div className="space-y-3">
          <SslDropZone label="PFX / P12 file (.pfx, .p12)" accept=".pfx,.p12"
            file={pfxFile} onFile={setPfxFile} dragging={pfxDrag} onDrag={setPfxDrag} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Passphrase</label>
            <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
              placeholder="PFX passphrase"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={uploadPfx} disabled={!pfxFile || !passphrase || uploading}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-40 transition-colors">
              {uploading ? 'Uploading…' : 'Upload & Install'}
            </button>
            {(!pfxFile || !passphrase) && (
              <span className="text-xs text-gray-500">{!pfxFile ? 'Drop a PFX file above' : 'Enter the passphrase'}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3">
            <SslDropZone label="Certificate (.crt / .pem)" accept=".crt,.pem,.cer"
              file={certFile} onFile={setCertFile} dragging={certDrag} onDrag={setCertDrag} />
            <SslDropZone label="Private Key (.key / .pem)" accept=".key,.pem"
              file={keyFile} onFile={setKeyFile} dragging={keyDrag} onDrag={setKeyDrag} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={uploadPem} disabled={!certFile || !keyFile || uploading}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-40 transition-colors">
              {uploading ? 'Uploading…' : 'Upload & Install'}
            </button>
            {(!certFile || !keyFile) && (
              <span className="text-xs text-gray-500">Drop both cert and key files above</span>
            )}
          </div>
        </div>
      )}

      {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}

      <p className="text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 leading-relaxed">
        After uploading, restart the service from the <strong className="text-gray-300">Maintenance</strong> tab to enable HTTPS.
      </p>
    </div>
  )
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function roleBadge(role: string) {
  const map: Record<string, string> = {
    admin:   'bg-blue-900/40 text-blue-300 border border-blue-700/40',
    analyst: 'bg-purple-900/40 text-purple-300 border border-purple-700/40',
    viewer:  'bg-gray-800 text-gray-300 border border-gray-700',
  }
  return map[role] ?? 'bg-gray-800 text-gray-300 border border-gray-700'
}

function statusBadge(active: boolean) {
  return active
    ? 'bg-green-900/40 text-green-400 border border-green-700/40'
    : 'bg-gray-800 text-gray-400 border border-gray-700'
}

// User create/edit modal
function UserModal({ user, onClose, onSaved }: { user?: any | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!user
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email:    user?.email    ?? '',
    role:     user?.role     ?? 'viewer',
    password: '',
  })
  const [error, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && !form.password) { setSaveErr('Password required for new users'); return }
    setSaving(true); setSaveErr('')
    try {
      if (editing) await api.updateUser(user!.id, { email: form.email, role: form.role })
      else         await api.createUser(form)
      onSaved()
    } catch (err: any) { setSaveErr(err.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-5">{editing ? `Edit — ${user!.username}` : 'New User'}</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Username</label>
            <input value={form.username} onChange={e => set('username', e.target.value)} required disabled={editing}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          {!editing && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Password</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder="Required"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          )}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Role</label>
            <select value={form.role} onChange={e => set('role', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="viewer">Viewer</option>
              <option value="analyst">Analyst</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Reset password modal
function ResetPwModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [pw, setPw]         = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw.length < 6) { setErr('Minimum 6 characters'); return }
    if (pw !== confirm) { setErr('Passwords do not match'); return }
    setSaving(true); setErr('')
    try {
      await api.resetUserPassword(user.id, pw)
      onClose()
    } catch (e: any) { setErr(e.message ?? 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-1">Reset Password</h2>
        <p className="text-sm text-gray-400 mb-5">Set a new password for <span className="text-white font-medium">{user.username}</span></p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">New Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Confirm Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Set Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UsersTab() {
  const { user: me } = useAuth()
  const [users, setUsers]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filter, setFilter]   = useState('')

  // Modals
  const [modal, setModal]     = useState<'create' | any | null>(null)
  const [resetPw, setResetPw] = useState<any | null>(null)
  const [confirmDel, setConfirmDel] = useState<any | null>(null)

  const load = () => {
    setLoading(true)
    api.listUsers().then(setUsers).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const toggle = async (u: any) => {
    try { await api.updateUser(u.id, { is_active: !u.is_active }); load() }
    catch (e: any) { setError(e.message) }
  }

  const del = async (u: any) => {
    try { await api.deleteUser(u.id); setConfirmDel(null); load() }
    catch (e: any) { setError(e.message) }
  }

  const visible = filter.trim()
    ? users.filter(u => u.username.toLowerCase().includes(filter.toLowerCase()) || (u.email || '').toLowerCase().includes(filter.toLowerCase()))
    : users

  return (
    <div className="space-y-4">
      {/* Header — subtitle left, filter + Add User right */}
      <div className="flex items-center justify-between gap-4 min-w-0">
        <p className="text-sm text-gray-400 truncate min-w-0">Local accounts only — SSO users are managed in your identity provider</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter users..."
            className="px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
          <button onClick={() => setModal('create')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
            + Add User
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-lg px-4 py-2 flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} className="ml-4 text-red-600 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Users table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Email</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Last Login</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {visible.map(u => {
                const isMe = u.id === me?.id
                return (
                  <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-blue-700/40 flex items-center justify-center text-sm font-bold text-blue-300 flex-shrink-0">
                          {u.username[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">{u.username}</p>
                          {isMe && <p className="text-xs text-gray-500">you</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-300">{u.email || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleBadge(u.role)}`}>{u.role}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge(u.is_active)}`}>
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-400 text-xs">
                      {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Reset password */}
                        <button onClick={() => setResetPw(u)} title="Reset Password"
                          className="p-1.5 text-gray-500 hover:text-purple-400 hover:bg-purple-900/20 rounded transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/>
                          </svg>
                        </button>
                        {/* Edit */}
                        <button onClick={() => setModal(u)} title="Edit"
                          className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-900/20 rounded transition-colors">
                          <Pencil size={14} />
                        </button>
                        {/* Enable / Disable */}
                        {!isMe && (
                          <button onClick={() => toggle(u)} title={u.is_active ? 'Disable' : 'Enable'}
                            className={`p-1.5 rounded transition-colors ${u.is_active ? 'text-gray-500 hover:text-yellow-400 hover:bg-yellow-900/20' : 'text-gray-500 hover:text-green-400 hover:bg-green-900/20'}`}>
                            {u.is_active
                              ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            }
                          </button>
                        )}
                        {/* Delete */}
                        {!isMe && (
                          <button onClick={() => setConfirmDel(u)} title="Delete"
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Roles: <span className="text-blue-300 font-medium">admin</span> — full access &nbsp;·&nbsp;
        <span className="text-purple-300 font-medium">analyst</span> — read + export &nbsp;·&nbsp;
        <span className="text-gray-300 font-medium">viewer</span> — read-only
      </p>

      {/* Modals */}
      {resetPw && <ResetPwModal user={resetPw} onClose={() => setResetPw(null)} />}

      {modal !== null && (
        <UserModal
          user={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-white font-semibold mb-2">Delete user?</h3>
            <p className="text-gray-400 text-sm mb-5">
              <span className="text-white font-medium">{confirmDel.username}</span> will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
              <button onClick={() => del(confirmDel)} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Alert Rules CRUD ──────────────────────────────────────────────────────────
const EVENT_TYPES = [
  { value: 'app.unreachable',       label: 'App goes unreachable' },
  { value: 'app.degraded',          label: 'App health degraded' },
  { value: 'app.recovered',         label: 'App health recovered' },
  { value: 'app.registered',        label: 'App registered' },
  { value: 'app.deregistered',      label: 'App deregistered' },
  { value: 'app.mode_change',       label: 'App mode changed' },
  { value: 'token.rotated',         label: 'Token rotated' },
  { value: 'break_glass.triggered', label: 'Break-glass triggered' },
  { value: 'user.created',          label: 'User created' },
  { value: 'user.deleted',          label: 'User deleted' },
]
const SEVERITY_OPTS = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning',  label: 'Warning' },
  { value: 'info',     label: 'Info' },
]
const SEV_COLOR: Record<string, string> = {
  critical: '#f87171', warning: '#f59e0b', info: '#60a5fa',
}

function AlertRulesSection() {
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const blankForm = { name: '', event_type: 'app.unreachable', severity: 'warning', description: '', enabled: true }
  const [form, setForm] = useState({ ...blankForm })
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  const load = () => {
    setLoadErr('')
    api.listAlertRules()
      .then(setRules)
      .catch(e => setLoadErr(e.message || 'Failed to load rules'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const openAdd = () => { setEditId(null); setForm({ ...blankForm }); setSaveErr(''); setShowForm(true) }
  const openEdit = (r: any) => {
    setEditId(r.id)
    setForm({ name: r.name, event_type: r.event_type, severity: r.severity, description: r.description, enabled: r.enabled })
    setSaveErr('')
    setShowForm(true)
  }
  const cancel = () => { setShowForm(false); setEditId(null) }

  const submit = async () => {
    setSaving(true); setSaveErr('')
    try {
      if (editId !== null) {
        await api.updateAlertRule(editId, form)
      } else {
        await api.createAlertRule(form)
      }
      setShowForm(false); setEditId(null)
      load()
    } catch (e: any) { setSaveErr(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete rule "${name}"?`)) return
    await api.deleteAlertRule(id).then(load).catch(e => alert(e.message))
  }

  const toggleEnabled = async (r: any) => {
    await api.updateAlertRule(r.id, { enabled: !r.enabled }).then(load).catch(e => alert(e.message))
  }

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white uppercase tracking-wider">Alert Events</p>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          <Plus size={12} /> Add Rule
        </button>
      </div>

      {loadErr && <p className="text-xs text-red-400">{loadErr}</p>}

      {/* inline add/edit form */}
      {showForm && (
        <div className="bg-gray-950 border border-gray-700 rounded-xl p-5 space-y-4">
          <p className="text-sm font-semibold text-white">{editId !== null ? 'Edit Rule' : 'New Alert Rule'}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="App unreachable — critical" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Event type</label>
              <select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {EVENT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Severity</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {SEVERITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-3 pb-0.5">
              <label className="text-xs text-gray-400">Enabled</label>
              <button type="button" onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional description of when this fires" />
            </div>
          </div>
          {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving || !form.name}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
              {saving ? 'Saving…' : editId !== null ? 'Save Changes' : 'Create Rule'}
            </button>
            <button onClick={cancel} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {/* rules table */}
      {!loading && rules.length === 0 && !loadErr && (
        <p className="text-sm text-gray-500 text-center py-4">No alert rules defined.</p>
      )}
      {rules.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Rule</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Event</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Severity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Enabled</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{r.name}</p>
                    {r.description && <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.event_type}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                      style={{ color: SEV_COLOR[r.severity] || '#6b7280', background: (SEV_COLOR[r.severity] || '#6b7280') + '20' }}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => toggleEnabled(r)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-gray-500 hover:text-blue-400 rounded-lg transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => del(r.id, r.name)} className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Module-level settings helpers (usable in sub-components) ──────────────────
const strOf = (s: Record<string,string>, k: string, fallback = '') => s[k] ?? fallback
const numOf = (s: Record<string,string>, k: string, fallback = 0) => parseInt(s[k] || String(fallback)) || fallback

// ── App registry colors / status ──────────────────────────────────────────────
const APP_COLORS: Record<string, string> = {
  pktflow: '#60a5fa', pktsnmp: '#2dd4bf', pktlog: '#4ade80', pktpcap: '#a78bfa',
}
function appColor(name: string) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#6b7280'
}
const HEALTH_COLOR: Record<string, string> = {
  healthy: '#4ade80', degraded: '#f59e0b', unreachable: '#f87171', unknown: '#6b7280',
}

// ── App Registry tab (config + management) ────────────────────────────────────
function AppRegistrySection({ settings, set, save }: {
  settings: Record<string,string>
  set: (k: string, v: string|boolean|number) => void
  save: { save: () => Promise<void>; saving: boolean; saved: boolean; error: string }
}) {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [apps, setApps] = useState<any[]>([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAppId, setEditingAppId] = useState<number | null>(null)
  const blankForm = { name: '', base_url: '', description: '', return_url: '', suite_token: '' }
  const [form, setForm] = useState({ ...blankForm })
  const [registering, setRegistering] = useState(false)
  const [regError, setRegError] = useState('')
  const [tokenMap, setTokenMap] = useState<Record<number, string>>({})

  const loadApps = () => {
    setAppsLoading(true)
    api.listApps().then(setApps).catch(() => {}).finally(() => setAppsLoading(false))
  }
  useEffect(() => { loadApps() }, [])

  const register = async () => {
    setRegError(''); setRegistering(true)
    try {
      if (editingAppId !== null) {
        await api.updateApp(editingAppId, { name: form.name, base_url: form.base_url, display_name: form.name, return_url: form.return_url || null })
      } else {
        await api.registerApp({ ...form, return_url: form.return_url || null })
      }
      setForm({ name: '', base_url: '', description: '', return_url: '', suite_token: '' })
      setEditingAppId(null)
      setShowForm(false)
      loadApps()
    } catch (e: any) { setRegError(e.message) }
    finally { setRegistering(false) }
  }

  const deregister = async (id: number, name: string) => {
    if (!confirm(`Deregister ${name}? This removes the suite token and restores direct access.`)) return
    await api.deregisterApp(id).then(loadApps).catch((e: any) => alert(e.message))
  }

  const rotateToken = async (id: number) => {
    try {
      const res = await api.rotateToken(id)
      setTokenMap(m => ({ ...m, [id]: res.suite_token }))
      setTimeout(() => setTokenMap(m => { const n = { ...m }; delete n[id]; return n }), 30000)
    } catch (e: any) { alert(e.message) }
  }

  const toggleMode = async (app: any) => {
    const toLocked = app.access_mode !== 'managed'
    const msg = toLocked
      ? `Enable managed mode on ${app.name}?\n\nThis blocks direct access — all traffic must go through pktHub.`
      : `Restore direct access to ${app.name}?\n\nUsers will be able to bypass pktHub.`
    if (!confirm(msg)) return
    try {
      const res = await api.setDirectAccess(app.id, toLocked)
      if (res.verified === false) alert(res.detail || 'Lock command sent but verification failed')
      loadApps()
    }
    catch (e: any) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      <Section title="App Registry" onSave={save.save} saving={save.saving} saved={save.saved} error={save.error}>
        <Field label="Default mode on register" hint="Mode assigned to a pktAPP app when it is first registered">
          <SelectInput value={strOf(settings,'default_app_mode','observe')} onChange={v => set('default_app_mode', v)}
            options={[{value:'observe',label:'Observe (read-only)'},{value:'managed',label:'Managed (full control)'}]} />
        </Field>
        <div className="pt-4 pb-1"><p className="text-xs font-semibold text-white uppercase tracking-wider">Health Polling</p></div>
        <Field label="Poll interval" hint="How often pktHub checks /api/health on each registered app">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'health_poll_interval',30)} onChange={v => set('health_poll_interval', v)} min={5} max={300} />
            <span className="text-sm text-white">seconds</span>
          </div>
        </Field>
        <Field label="Timeout" hint="Seconds to wait for a health response before marking the app unreachable">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'health_timeout',5)} onChange={v => set('health_timeout', v)} min={1} max={30} />
            <span className="text-sm text-white">seconds</span>
          </div>
        </Field>
        <div className="pt-4 pb-1"><p className="text-xs font-semibold text-white uppercase tracking-wider">Suite-Token Rotation</p></div>
        <Field label="Auto-rotate every N days" hint="0 = manual rotation only">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'auto_rotate_days',0)} onChange={v => set('auto_rotate_days', v)} min={0} max={365} />
            <span className="text-sm text-white">days</span>
          </div>
        </Field>
      </Section>

      <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#111827' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <p className="text-sm font-semibold text-white">Registered Apps</p>
          <div className="flex gap-2">
            <button onClick={loadApps} className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"><RefreshCw size={13} /></button>
            {isAdmin && (
              <button onClick={() => setShowForm(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                style={{ background: 'linear-gradient(90deg,#60a5fa,#2dd4bf)' }}>
                <Plus size={13} /> Register App
              </button>
            )}
          </div>
        </div>

        {showForm && isAdmin && (
          <div className="px-5 py-4 border-b border-gray-800 space-y-3">
            <p className="text-xs font-semibold text-white">{editingAppId !== null ? 'Edit App' : 'Register New App'}</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">App Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="pktFlow" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Base URL</label>
                <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white font-mono focus:outline-none focus:border-blue-500"
                  placeholder="https://172.23.80.5:8766" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Real-time NetFlow analysis" />
              </div>
                            <div className="col-span-3">
                <p className="text-xs text-blue-300/80 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2 mb-3">
                  Get the Suite Token from the pktApp: <strong>Settings &rarr; Integrations &rarr; pktHub Integration &rarr; Copy Token</strong>
                </p>
                <label className="block text-xs text-gray-400 mb-1">
                  Suite Token <span className="text-red-400">*</span>
                </label>
                <input value={form.suite_token} onChange={e => setForm(f => ({ ...f, suite_token: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white font-mono focus:outline-none focus:border-blue-500"
                  placeholder="Paste token from pktApp Settings → Integrations" />
              </div>
<div className="col-span-3">
                <label className="block text-xs text-gray-400 mb-1">
                  Hub Return URL <span className="text-gray-600">(optional — only set if the app server cannot resolve the pktHub hostname; use IP-based URL)</span>
                </label>
                <input value={form.return_url} onChange={e => setForm(f => ({ ...f, return_url: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white font-mono focus:outline-none focus:border-blue-500"
                  placeholder="Leave blank unless DNS issues — e.g. https://172.23.80.5:8760" />
              </div>
            </div>
            {regError && <p className="text-xs text-red-400">{regError}</p>}
            <div className="flex gap-2">
              <button onClick={register} disabled={registering || !form.name || !form.base_url || (editingAppId === null && !form.suite_token)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#60a5fa' }}>
                {registering ? 'Saving…' : editingAppId !== null ? 'Save Changes' : 'Register'}
              </button>
              <button onClick={() => { setShowForm(false); setEditingAppId(null); setForm({ name: '', base_url: '', description: '', return_url: '', suite_token: '' }) }} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">Cancel</button>
            </div>
          </div>
        )}

        {appsLoading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
        {!appsLoading && apps.length === 0 && (
          <div className="text-sm text-gray-500 py-10 text-center">No apps registered. Click "Register App" to add one.</div>
        )}
        <div className="divide-y divide-gray-800">
          {apps.map(app => {
            const color = appColor(app.name)
            const statusColor = HEALTH_COLOR[app.health_status] || '#6b7280'
            return (
              <div key={app.id} className="flex items-center gap-3 px-5 py-3" style={{ borderLeft: `3px solid ${color}30` }}>
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{app.display_name || app.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${app.access_mode === 'managed' ? 'bg-orange-900/30 text-orange-300' : 'bg-blue-900/20 text-blue-300'}`}>
                      {app.access_mode === 'managed' ? '🔒 Managed' : '👁 Observe'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono truncate">{app.base_url}</p>
                  {app.return_url && <p className="text-xs text-blue-500/70 font-mono truncate">hub: {app.return_url}</p>}
                  {tokenMap[app.id] && (
                    <div className="mt-1.5 p-2 rounded bg-gray-800 border border-yellow-800/40">
                      <p className="text-xs text-yellow-400 mb-0.5">Suite token — copy now, shown once:</p>
                      <code className="text-xs text-gray-200 break-all">{tokenMap[app.id]}</code>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => navigate(`/proxy/${app.id}`)} title="Open in proxy"
                    className="p-1.5 text-gray-500 hover:text-white rounded transition-colors"><ExternalLink size={13} /></button>
                  {isAdmin && (
                    <>
                      <button onClick={() => toggleMode(app)} title={app.access_mode === 'managed' ? 'Disable Managed Mode' : 'Enable Managed Mode'}
                        className="p-1.5 text-gray-500 hover:text-white rounded transition-colors">
                        {app.access_mode === 'managed' ? <Eye size={13} /> : <ShieldCheck size={13} />}
                      </button>
                      <button onClick={() => rotateToken(app.id)} title="Rotate suite token"
                        className="p-1.5 text-gray-500 hover:text-blue-400 rounded transition-colors"><RefreshCw size={13} /></button>
                      <button onClick={() => { setEditingAppId(app.id); setForm({ name: app.name, base_url: app.base_url, description: app.description || '', return_url: app.return_url || '', suite_token: '' }); setRegError(''); setShowForm(true) }} title="Edit app"
                        className="p-1.5 text-gray-500 hover:text-yellow-400 rounded transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => deregister(app.id, app.display_name || app.name)} title="Deregister"
                        className="p-1.5 text-gray-500 hover:text-red-400 rounded transition-colors"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── NOC tab (config + management) ──────────────────────────────────────────
function NOCSection({ settings, set, save }: {
  settings: Record<string,string>
  set: (k: string, v: string|boolean|number) => void
  save: { save: () => Promise<void>; saving: boolean; saved: boolean; error: string }
}) {
  const { isAdmin, isAnalyst } = useAuth()
  const [noc, setNOC Displays] = useState<any[]>([])
  const [nocLoading, setNOC DisplaysLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const loadNOC Displays = () => {
    setNOC DisplaysLoading(true)
    api.listNOC().then(setNOC Displays).catch(() => {}).finally(() => setNOC DisplaysLoading(false))
  }
  useEffect(() => { loadNOC Displays() }, [])

  const canCreate = isAdmin || isAnalyst

  const create = async () => {
    setCreating(true); setCreateError('')
    try {
      await api.createNOC({ ...form, slides: [] })
      setShowForm(false)
      setForm({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
      loadNOC Displays()
    } catch (e: any) { setCreateError(e.message) }
    finally { setCreating(false) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete noc "${name}"?`)) return
    await api.deleteNOC(id).then(loadNOC Displays).catch((e: any) => alert(e.message))
  }

  const publish = async (k: any) => {
    try {
      if (k.is_published) await api.unpublishNOC(k.id)
      else await api.publishNOC(k.id)
      loadNOC Displays()
    } catch (e: any) { alert(e.message) }
  }

  const copyLink = (k: any) => {
    navigator.clipboard.writeText(`${window.location.origin}/display/${k.display_token}`)
    setCopied(k.id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      <Section title="NOC" onSave={save.save} saving={save.saving} saved={save.saved} error={save.error}>
        <Field label="Default dwell time" hint="Default slide dwell for new rotating noc">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'noc_default_dwell',30)} onChange={v => set('noc_default_dwell', v)} min={5} max={3600} />
            <span className="text-sm text-white">seconds</span>
          </div>
        </Field>
        <Field label="Widget refresh interval" hint="How often noc widgets poll for fresh data">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'noc_widget_refresh',60)} onChange={v => set('noc_widget_refresh', v)} min={10} max={3600} />
            <span className="text-sm text-white">seconds</span>
          </div>
        </Field>
        <Field label="Display token expiry" hint="Days until signed display URLs expire. 0 = never.">
          <div className="flex items-center gap-3">
            <NumberInput value={numOf(settings,'display_token_expire_days',0)} onChange={v => set('display_token_expire_days', v)} min={0} max={3650} />
            <span className="text-sm text-white">days</span>
          </div>
        </Field>
      </Section>

      <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#111827' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <p className="text-sm font-semibold text-white">NOC Layouts</p>
          {canCreate && (
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
              style={{ background: 'linear-gradient(90deg,#a78bfa,#60a5fa)' }}>
              <Plus size={13} /> New NOC Display
            </button>
          )}
        </div>

        {showForm && canCreate && (
          <div className="px-5 py-4 border-b border-gray-800 space-y-3">
            <p className="text-xs font-semibold text-white">New NOC Display Layout</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="NOC Wall Display" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Main NOC display" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Mode</label>
                <select value={form.display_mode} onChange={e => setForm(f => ({ ...f, display_mode: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500">
                  <option value="static">Static</option>
                  <option value="rotating">Rotating</option>
                </select>
              </div>
              {form.display_mode === 'rotating' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Dwell (seconds)</label>
                  <input type="number" value={form.dwell_seconds}
                    onChange={e => setForm(f => ({ ...f, dwell_seconds: parseInt(e.target.value) || 30 }))}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                    min={5} max={3600} />
                </div>
              )}
            </div>
            {createError && <p className="text-xs text-red-400">{createError}</p>}
            <div className="flex gap-2">
              <button onClick={create} disabled={creating || !form.name}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#a78bfa' }}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">Cancel</button>
            </div>
          </div>
        )}

        {nocLoading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
        {!nocLoading && noc.length === 0 && (
          <div className="text-sm text-gray-500 py-10 text-center">No noc yet. Click "New NOC Display" to create one.</div>
        )}
        <div className="divide-y divide-gray-800">
          {noc.map(k => (
            <div key={k.id} className="flex items-center gap-3 px-5 py-3">
              <Monitor size={14} className="text-purple-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{k.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${k.is_published ? 'bg-green-900/30 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                    {k.is_published ? '● Live' : '○ Draft'}
                  </span>
                  <span className="text-xs text-gray-600 capitalize">{k.display_mode}</span>
                </div>
                {k.description && <p className="text-xs text-gray-500 truncate">{k.description}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {k.is_published && k.display_token && (
                  <button onClick={() => copyLink(k)} title="Copy display URL"
                    className="p-1.5 text-gray-500 hover:text-blue-400 rounded transition-colors">
                    {copied === k.id ? <span className="text-xs text-green-400">✓</span> : <Copy size={13} />}
                  </button>
                )}
                {(isAdmin || isAnalyst) && (
                  <>
                    <button onClick={() => publish(k)} title={k.is_published ? 'Unpublish' : 'Publish'}
                      className="p-1.5 text-gray-500 hover:text-green-400 rounded transition-colors">
                      {k.is_published ? <EyeOff size={13} /> : <Globe size={13} />}
                    </button>
                    {isAdmin && (
                      <button onClick={() => del(k.id, k.name)} title="Delete"
                        className="p-1.5 text-gray-500 hover:text-red-400 rounded transition-colors"><Trash2 size={13} /></button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Backup section ────────────────────────────────────────────────────────────
function BackupSection({ settings, set, save }: {
  settings: Settings
  set: (k: string, v: string | number | boolean) => void
  save: ReturnType<typeof useSave>
}) {
  const str = (k: string, d = '') => settings[k] ?? d
  const num = (k: string, d = 0) => parseInt(settings[k] ?? String(d)) || d
  const bool = (k: string, d = false) => { const v = settings[k]; return v === undefined ? d : v === 'true' }

  const token = () => localStorage.getItem('pkthub_token') ?? ''

  const [runState,  setRunState]  = useState<'idle'|'running'|'done'|'error'>('idle')
  const [runMsg,    setRunMsg]    = useState('')
  const [snapshots, setSnapshots] = useState<Array<{name:string;size_mb:number;created:string}>>([])
  const [showSnaps, setShowSnaps] = useState(false)
  const [snapsLoading, setSnapsLoading] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File|null>(null)
  const [restoreState, setRestoreState] = useState<'idle'|'running'|'done'|'error'>('idle')
  const [restoreMsg,   setRestoreMsg]   = useState('')

  const runBackup = async () => {
    setRunState('running')
    try {
      const res = await fetch('/api/backup/run', { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
      const data = await res.json()
      setRunState(res.ok ? 'done' : 'error')
      setRunMsg(data.message ?? (res.ok ? 'Backup created' : 'Backup failed'))
    } catch (e: any) { setRunState('error'); setRunMsg(e.message) }
    setTimeout(() => setRunState('idle'), 6000)
  }

  const loadSnapshots = async () => {
    setSnapsLoading(true)
    try {
      const res = await fetch('/api/backup/snapshots', { headers: { Authorization: `Bearer ${token()}` } })
      setSnapshots(await res.json())
    } catch {}
    setSnapsLoading(false)
  }

  const toggleSnaps = () => {
    const next = !showSnaps
    setShowSnaps(next)
    if (next && snapshots.length === 0) loadSnapshots()
  }

  const downloadExport = () => {
    const a = document.createElement('a')
    a.href = `/api/backup/export`
    a.click()
  }

  const doRestore = async () => {
    if (!restoreFile) return
    setRestoreState('running')
    const form = new FormData()
    form.append('file', restoreFile)
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      })
      const data = await res.json()
      setRestoreState(res.ok ? 'done' : 'error')
      setRestoreMsg(data.message ?? data.detail ?? (res.ok ? 'Restore complete' : 'Restore failed'))
    } catch (e: any) { setRestoreState('error'); setRestoreMsg(e.message) }
  }

  return (
    <Section title="Backup" onSave={save.save} saving={save.saving} saved={save.saved} error={save.error}>
      {/* Auto backup */}
      <Field label="Auto backup" hint="Run a scheduled backup on the server at the configured interval.">
        <Toggle value={bool('backup_auto_enabled')} onChange={v => set('backup_auto_enabled', v)} />
      </Field>

      {/* Interval */}
      <Field label="Interval" hint="Hours between automatic backup runs.">
        <div className="flex items-center gap-3">
          <NumberInput value={num('backup_interval_hours', 24)} onChange={v => set('backup_interval_hours', v)} min={1} max={720} />
          <span className="text-sm text-gray-400">hours</span>
        </div>
      </Field>

      {/* Rotation count */}
      <Field label="Rotation count" hint="Number of snapshots to keep — oldest deleted when exceeded.">
        <NumberInput value={num('backup_retain_count', 5)} onChange={v => set('backup_retain_count', v)} min={1} max={100} />
      </Field>

      {/* Backup path */}
      <Field label="Backup path" hint="Directory on the server where snapshots are stored.">
        <TextInput value={str('backup_path', '/mnt/software/pkthub_backups')} onChange={v => set('backup_path', v)} mono />
      </Field>

      {/* Manual backup */}
      <Field label="Manual backup" hint="Trigger a backup run immediately using current settings.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button" onClick={runBackup} disabled={runState === 'running'}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white transition-colors"
            >
              {runState === 'running' ? 'Running…' : 'Run Backup Now'}
            </button>
            <button
              type="button" onClick={toggleSnaps}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showSnaps ? 'Hide snapshots' : 'Show snapshots'}
            </button>
            {runMsg && (
              <span className={`text-sm ${runState === 'done' ? 'text-green-400' : 'text-red-400'}`}>{runMsg}</span>
            )}
          </div>
          {showSnaps && (
            <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900 divide-y divide-gray-800 text-sm">
              {snapsLoading && <div className="px-4 py-3 text-gray-400">Loading…</div>}
              {!snapsLoading && snapshots.length === 0 && <div className="px-4 py-3 text-gray-500">No snapshots found.</div>}
              {snapshots.map(s => (
                <div key={s.name} className="px-4 py-2.5 flex justify-between items-center">
                  <span className="font-mono text-xs text-gray-300">{s.name}</span>
                  <span className="text-gray-500 text-xs">{s.size_mb} MB · {s.created}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>

      {/* Export bundle */}
      <Field label="Export bundle" hint="Download pkthub.db + config.yaml as a .tar.gz bundle.">
        <button
          type="button" onClick={downloadExport}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
        >
          Download Export
        </button>
      </Field>

      {/* Restore from bundle */}
      <Field label="Restore from bundle" hint="Upload a pktHub export .tar.gz to restore the database and config. Restart the service after restore.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <label className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white cursor-pointer transition-colors">
              {restoreFile ? restoreFile.name : 'Choose .tar.gz…'}
              <input type="file" accept=".tar.gz,.gz" className="hidden" onChange={e => { setRestoreFile(e.target.files?.[0] ?? null); setRestoreMsg('') }} />
            </label>
            <button
              type="button" onClick={doRestore} disabled={!restoreFile || restoreState === 'running'}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors"
            >
              {restoreState === 'running' ? 'Restoring…' : 'Restore'}
            </button>
          </div>
          {restoreMsg && (
            <span className={`text-sm ${restoreState === 'done' ? 'text-green-400' : 'text-red-400'}`}>{restoreMsg}</span>
          )}
        </div>
      </Field>
    </Section>
  )
}

// ── Storage section ───────────────────────────────────────────────────────────
function StorageSection({ settings, set, save }: {
  settings: Settings
  set: (k: string, v: string | number | boolean) => void
  save: ReturnType<typeof useSave>
}) {
  const str = (k: string, d = '') => settings[k] ?? d
  const num = (k: string, d = 0) => parseInt(settings[k] ?? String(d)) || d

  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg,   setTestMsg]   = useState('')
  const [cleanState, setCleanState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [cleanMsg,   setCleanMsg]   = useState('')

  const testConnection = async () => {
    setTestState('testing')
    try {
      const token = localStorage.getItem('pkthub_token') ?? ''
      const res = await fetch('/api/settings/storage/test', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setTestState(data.ok ? 'ok' : 'error')
      setTestMsg(data.message ?? '')
    } catch (e: any) {
      setTestState('error')
      setTestMsg(e.message ?? 'Request failed')
    }
    setTimeout(() => setTestState('idle'), 5000)
  }

  const runCleanup = async () => {
    setCleanState('running')
    try {
      const token = localStorage.getItem('pkthub_token') ?? ''
      const res = await fetch('/api/settings/storage/cleanup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setCleanState(data.ok ? 'done' : 'error')
      setCleanMsg(data.message ?? '')
    } catch (e: any) {
      setCleanState('error')
      setCleanMsg(e.message ?? 'Request failed')
    }
    setTimeout(() => setCleanState('idle'), 6000)
  }

  return (
    <Section title="Storage" onSave={save.save} saving={save.saving} saved={save.saved} error={save.error}>
      {/* Database (readonly info row) */}
      <Field label="Database" hint="pktHub uses an embedded SQLite database. No external backend required.">
        <input
          type="text" readOnly value="SQLite (built-in)"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 cursor-default"
        />
      </Field>

      {/* Test connection */}
      <Field label="Test connection" hint="Verify the database is reachable and the schema is intact.">
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={testConnection} disabled={testState === 'testing'}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white transition-colors"
          >
            {testState === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
          {testMsg && (
            <span className={`text-sm ${testState === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{testMsg}</span>
          )}
        </div>
      </Field>

      {/* Audit log retention */}
      <Field label="Audit log retention" hint="Days to keep audit log entries. 0 = keep forever.">
        <div className="flex items-center gap-3">
          <NumberInput value={num('audit_retention_days', 90)} onChange={v => set('audit_retention_days', v)} min={0} max={3650} />
          <span className="text-sm text-gray-400">days</span>
        </div>
      </Field>

      {/* Alert event retention */}
      <Field label="Alert event retention" hint="Days to keep fired alert events and notification logs before auto-purge.">
        <div className="flex items-center gap-3">
          <NumberInput value={num('alert_retention_days', 90)} onChange={v => set('alert_retention_days', v)} min={0} max={3650} />
          <span className="text-sm text-gray-400">days</span>
        </div>
      </Field>

      {/* Manual cleanup */}
      <Field label="Manual cleanup" hint="Immediately apply current retention settings — old records are deleted permanently.">
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={runCleanup} disabled={cleanState === 'running'}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white transition-colors"
          >
            {cleanState === 'running' ? 'Running…' : 'Run Cleanup Now'}
          </button>
          {cleanMsg && (
            <span className={`text-sm ${cleanState === 'done' ? 'text-green-400' : 'text-red-400'}`}>{cleanMsg}</span>
          )}
        </div>
      </Field>
    </Section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
type TabId = 'general' | 'storage' | 'backup' | 'auth' | 'notifications' | 'audit' | 'integrations' | 'users' | 'registry' | 'noc' | 'maintenance'

const TABS: Array<{ id: TabId; label: string; adminOnly?: boolean }> = [
  { id: 'general',       label: 'General' },
  { id: 'storage',       label: 'Storage' },
  { id: 'backup',        label: 'Backup' },
  { id: 'auth',          label: 'Auth' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'audit',         label: 'Audit' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'users',         label: 'Users', adminOnly: true },
  { id: 'registry',      label: 'App Registry' },
  { id: 'noc',         label: 'NOC' },
  { id: 'maintenance',   label: 'Maintenance' },
]

export default function SettingsPage() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [tab, setTab] = useState<TabId>('general')
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const dirtyRef = useRef(false)

  const load = async () => {
    setLoading(true)
    try { setSettings(await api.getSettings()) } finally {
      setLoading(false)
      dirtyRef.current = false
    }
  }
  const silentLoad = async () => {
    if (dirtyRef.current) return
    try { setSettings(await api.getSettings()) } catch {}
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(silentLoad, 60_000)
    return () => clearInterval(t)
  }, [])

  const set = (key: string, value: string | boolean | number) => {
    dirtyRef.current = true
    setSettings(s => ({ ...s, [key]: String(value) }))
  }

  const str  = (k: string, fallback = '') => settings[k] ?? fallback
  const num  = (k: string, fallback = 0)  => parseInt(settings[k] || String(fallback)) || fallback
  const bool = (k: string, fallback = false) => {
    const v = settings[k]
    if (v === undefined) return fallback
    return v === 'true'
  }

  // Per-tab save helpers
  const generalSave  = useSave(['app_name', 'base_url', 'timezone'], settings, load)
  const storageSave  = useSave(['audit_retention_days', 'alert_retention_days', 'log_level'], settings, load)
  const backupSave   = useSave(['backup_auto_enabled', 'backup_interval_hours', 'backup_path', 'backup_retain_count'], settings, load)
  const registrySave = useSave(['default_app_mode', 'health_poll_interval', 'health_timeout', 'auto_rotate_days'], settings, load)
  const nocSave    = useSave(['noc_default_dwell', 'noc_widget_refresh', 'display_token_expire_days'], settings, load)
  const authSave     = useSave([
    'auth_local_enabled', 'session_timeout_minutes',
    'okta_saml_enabled', 'okta_saml_idp_entity_id', 'okta_saml_idp_sso_url',
    'okta_saml_idp_cert', 'okta_saml_sp_entity_id', 'okta_saml_sp_cert', 'okta_saml_sp_key',
  ], settings, load)
  const notifySave   = useSave([
    'notify_slack_enabled', 'notify_slack_webhook_url', 'notify_slack_channel',
    'notify_email_enabled', 'notify_email_smtp_host', 'notify_email_smtp_port',
    'notify_email_smtp_tls', 'notify_email_username', 'notify_email_password',
    'notify_email_from', 'notify_email_default_to',
    'notify_pagerduty_enabled', 'notify_pagerduty_integration_key',
    'notify_webhook_enabled', 'notify_webhook_url', 'notify_webhook_method', 'notify_webhook_payload_template',
    'notify_tracecat_enabled', 'notify_tracecat_webhook_url', 'notify_tracecat_api_token',
  ], settings, load)
  const integrationsSave = useSave(['lucid_api_token'], settings, load)
  const maintSave    = useSave(['listen_port', 'ssl_cert_path', 'ssl_key_path', 'trusted_cidrs', 'maintenance_mode'], settings, load)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-white">
        <p className="text-sm">Loading settings…</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit overflow-x-auto">
        {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <Section title="General" onSave={generalSave.save} saving={generalSave.saving} saved={generalSave.saved} error={generalSave.error}>
          <Field label="App name" hint="Displayed in the browser tab and header">
            <TextInput value={str('app_name', 'pktHub')} onChange={v => set('app_name', v)} />
          </Field>
          <Field label="Base URL" hint="Canonical URL for this pktHub instance — used for SAML ACS and notification links">
            <TextInput value={str('base_url')} onChange={v => set('base_url', v)} placeholder="https://172.23.80.5:8760" mono />
          </Field>
          <Field label="Timezone" hint="Affects display of timestamps in the UI">
            <SelectInput
              value={str('timezone', 'UTC')}
              onChange={v => set('timezone', v)}
              options={[
                { value: 'UTC', label: 'UTC' },
                { value: 'America/New_York', label: 'Eastern (ET)' },
                { value: 'America/Chicago', label: 'Central (CT)' },
                { value: 'America/Denver', label: 'Mountain (MT)' },
                { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
              ]}
            />
          </Field>
          <RestartServiceRow />
        </Section>
      )}

      {/* Storage */}
      {tab === 'storage' && <StorageSection settings={settings} set={set} save={storageSave} />}

      {/* Backup */}
      {tab === 'backup' && <BackupSection settings={settings} set={set} save={backupSave} />}

      {/* App Registry */}
      {tab === 'registry' && (
        <AppRegistrySection settings={settings} set={set} save={registrySave} />
      )}

      {/* NOC */}
      {tab === 'noc' && (
        <NOCSection settings={settings} set={set} save={nocSave} />
      )}

      {/* Auth */}
      {tab === 'auth' && (
        <Section title="Authentication" onSave={authSave.save} saving={authSave.saving} saved={authSave.saved} error={authSave.error}>
          <Field label="Local auth" hint="Username/password login using local accounts">
            <Toggle value={bool('auth_local_enabled', true)} onChange={v => set('auth_local_enabled', v)} />
          </Field>
          <Field label="Session timeout">
            <div className="flex items-center gap-3">
              <NumberInput value={num('session_timeout_minutes', 480)} onChange={v => set('session_timeout_minutes', v)} min={5} max={10080} />
              <span className="text-sm text-white">minutes</span>
            </div>
          </Field>

          <div className="pt-4 pb-2">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Okta SAML 2.0 SSO</p>
          </div>
          <Field label="Enable SAML SSO">
            <Toggle value={bool('okta_saml_enabled')} onChange={v => set('okta_saml_enabled', v)} />
          </Field>
          {bool('okta_saml_enabled') && (
            <>
              <Field label="Paste IdP Metadata XML" hint="Paste the full XML from Okta → Sign On → Identity Provider metadata. Fields below will auto-fill.">
                <MetadataPasteBox onParsed={(r) => {
                  if (r.entity_id) set('okta_saml_idp_entity_id', r.entity_id)
                  if (r.sso_url)   set('okta_saml_idp_sso_url', r.sso_url)
                  if (r.cert)      set('okta_saml_idp_cert', r.cert)
                }} />
              </Field>
              <Field label="IdP Entity ID" hint="From Okta metadata: Identity Provider Issuer">
                <TextInput value={str('okta_saml_idp_entity_id')} onChange={v => set('okta_saml_idp_entity_id', v)} placeholder="http://www.okta.com/..." mono />
              </Field>
              <Field label="IdP SSO URL" hint="From Okta metadata: Identity Provider Single Sign-On URL">
                <TextInput value={str('okta_saml_idp_sso_url')} onChange={v => set('okta_saml_idp_sso_url', v)} placeholder="https://yourorg.okta.com/app/.../sso/saml" mono />
              </Field>
              <Field label="IdP X.509 Certificate" hint="PEM headers are stripped automatically">
                <CertTextarea value={str('okta_saml_idp_cert')} onChange={v => set('okta_saml_idp_cert', v)} rows={4} secret />
              </Field>
              <Field label="SP Entity ID" hint="Leave blank to use the auto-generated metadata URL">
                <TextInput value={str('okta_saml_sp_entity_id')} onChange={v => set('okta_saml_sp_entity_id', v)} placeholder={`${str('base_url')}/api/auth/saml/metadata`} mono />
              </Field>
              <Field label="ACS URL (read-only)" hint="Register this URL as the Single Sign-On URL in your Okta app">
                <div className="flex items-center gap-2">
                  <TextInput value={`${str('base_url')}/api/auth/saml/callback`} readOnly mono />
                  <a href={`${str('base_url')}/api/auth/saml/metadata`} target="_blank" rel="noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap">
                    View SP metadata ↗
                  </a>
                </div>
              </Field>
              <Field label="SP Certificate" hint="Optional: for signed authentication requests">
                <CertTextarea value={str('okta_saml_sp_cert')} onChange={v => set('okta_saml_sp_cert', v)} rows={3} placeholder="Leave blank if not signing requests" secret />
              </Field>
              <Field label="SP Private Key" hint="Optional: private key for signing requests">
                <CertTextarea value={str('okta_saml_sp_key')} onChange={v => set('okta_saml_sp_key', v)} rows={3} placeholder="Leave blank if not signing requests" secret />
              </Field>
            </>
          )}
        </Section>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <Section title="Notifications" onSave={notifySave.save} saving={notifySave.saving} saved={notifySave.saved} error={notifySave.error}>

          {/* Slack */}
          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Slack</p>
          </div>
          <Field label="Enable Slack">
            <Toggle value={bool('notify_slack_enabled')} onChange={v => set('notify_slack_enabled', v)} />
          </Field>
          {bool('notify_slack_enabled') && (
            <>
              <Field label="Webhook URL">
                <TextInput value={str('notify_slack_webhook_url')} onChange={v => set('notify_slack_webhook_url', v)} placeholder="https://hooks.slack.com/services/…" secret mono />
              </Field>
              <Field label="Channel" hint="Override channel (optional)">
                <TextInput value={str('notify_slack_channel', '#alerts')} onChange={v => set('notify_slack_channel', v)} placeholder="#alerts" />
              </Field>
              <SendTestButton channel="slack" />
            </>
          )}

          {/* Email */}
          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Email (SMTP)</p>
          </div>
          <Field label="Enable email">
            <Toggle value={bool('notify_email_enabled')} onChange={v => set('notify_email_enabled', v)} />
          </Field>
          {bool('notify_email_enabled') && (
            <>
              <Field label="SMTP host">
                <TextInput value={str('notify_email_smtp_host')} onChange={v => set('notify_email_smtp_host', v)} placeholder="smtp.yourorg.com" mono />
              </Field>
              <Field label="SMTP port">
                <NumberInput value={num('notify_email_smtp_port', 587)} onChange={v => set('notify_email_smtp_port', v)} min={1} max={65535} />
              </Field>
              <Field label="Use TLS">
                <Toggle value={bool('notify_email_smtp_tls', true)} onChange={v => set('notify_email_smtp_tls', v)} />
              </Field>
              <Field label="Username">
                <TextInput value={str('notify_email_username')} onChange={v => set('notify_email_username', v)} mono />
              </Field>
              <Field label="Password">
                <TextInput value={str('notify_email_password')} onChange={v => set('notify_email_password', v)} secret />
              </Field>
              <Field label="From address">
                <TextInput value={str('notify_email_from')} onChange={v => set('notify_email_from', v)} placeholder="pkthub@yourorg.com" />
              </Field>
              <Field label="Default to" hint="Comma-separated email addresses">
                <TextInput value={str('notify_email_default_to')} onChange={v => set('notify_email_default_to', v)} placeholder="noc@yourorg.com, security@yourorg.com" />
              </Field>
              <SendTestButton channel="email" />
            </>
          )}

          {/* PagerDuty */}
          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">PagerDuty</p>
          </div>
          <Field label="Enable PagerDuty">
            <Toggle value={bool('notify_pagerduty_enabled')} onChange={v => set('notify_pagerduty_enabled', v)} />
          </Field>
          {bool('notify_pagerduty_enabled') && (
            <>
              <Field label="Integration key" hint="Events API v2 integration key">
                <TextInput value={str('notify_pagerduty_integration_key')} onChange={v => set('notify_pagerduty_integration_key', v)} secret mono />
              </Field>
              <SendTestButton channel="pagerduty" />
            </>
          )}

          {/* Webhook */}
          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Webhook</p>
          </div>
          <Field label="Enable webhook">
            <Toggle value={bool('notify_webhook_enabled')} onChange={v => set('notify_webhook_enabled', v)} />
          </Field>
          {bool('notify_webhook_enabled') && (
            <>
              <Field label="URL">
                <TextInput value={str('notify_webhook_url')} onChange={v => set('notify_webhook_url', v)} placeholder="https://yourservice.com/pkthub-alert" mono />
              </Field>
              <Field label="Method">
                <SelectInput value={str('notify_webhook_method', 'POST')} onChange={v => set('notify_webhook_method', v)}
                  options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]} />
              </Field>
              <Field label="Payload template" hint="Jinja2 template; vars: alert_name, message, severity, fired_at">
                <textarea value={str('notify_webhook_payload_template')} onChange={e => set('notify_webhook_payload_template', e.target.value)}
                  rows={4} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </Field>
              <SendTestButton channel="webhook" />
            </>
          )}

          {/* TraceCat */}
          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">TraceCat SOAR</p>
          </div>
          <Field label="Enable TraceCat">
            <Toggle value={bool('notify_tracecat_enabled')} onChange={v => set('notify_tracecat_enabled', v)} />
          </Field>
          {bool('notify_tracecat_enabled') && (
            <>
              <Field label="Webhook URL" hint="Paste the workflow webhook URL from TraceCat → Workflow → Trigger">
                <TextInput value={str('notify_tracecat_webhook_url')} onChange={v => set('notify_tracecat_webhook_url', v)} placeholder="https://tracecat.yourorg.com/api/v1/webhooks/…" mono />
              </Field>
              <Field label="API token" hint="Bearer token for TraceCat API authentication (optional if webhook is public)">
                <TextInput value={str('notify_tracecat_api_token')} onChange={v => set('notify_tracecat_api_token', v)} secret />
              </Field>
              <SendTestButton channel="tracecat" />
            </>
          )}

        </Section>
      )}

      {/* Integrations */}
      {tab === 'integrations' && (
        <Section title="Integrations" onSave={integrationsSave.save} saving={integrationsSave.saving} saved={integrationsSave.saved} error={integrationsSave.error}>

          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Lucidchart</p>
          </div>
          <Field label="API token" hint="Personal Access Token from lucid.co → Account → API Tokens. Required for topology export to Lucidchart.">
            <TextInput
              value={str('lucid_api_token')}
              onChange={v => set('lucid_api_token', v)}
              placeholder="eyJ…"
              secret
              mono
            />
          </Field>

          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">SSL / TLS</p>
          </div>
          <div className="py-3">
            <SslPanel />
          </div>

        </Section>
      )}

      {/* Audit */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <AlertRulesSection />
          <p className="text-xs text-gray-500">Audit log viewer available on the Audit Log page in the navigation.</p>
        </div>
      )}

      {/* Maintenance */}
      {tab === 'maintenance' && (
        <Section title="Maintenance" onSave={maintSave.save} saving={maintSave.saving} saved={maintSave.saved} error={maintSave.error}>
          <div className="pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Network</p>
          </div>
          <Field label="Listen port" hint="Port pktHub listens on. Restart required after change.">
            <div className="flex items-center gap-3">
              <NumberInput value={num('listen_port', 8760)} onChange={v => set('listen_port', v)} min={1} max={65535} />
            </div>
          </Field>

          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">TLS</p>
          </div>
          <Field label="Certificate path" hint="Absolute path to the TLS certificate file on the server">
            <TextInput value={str('ssl_cert_path')} onChange={v => set('ssl_cert_path', v)} placeholder="/etc/ssl/pkthub/cert.pem" mono />
          </Field>
          <Field label="Private key path" hint="Absolute path to the TLS private key file on the server">
            <TextInput value={str('ssl_key_path')} onChange={v => set('ssl_key_path', v)} placeholder="/etc/ssl/pkthub/key.pem" mono />
          </Field>

          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">Access Control</p>
          </div>
          <Field label="Trusted CIDRs" hint="Comma-separated IP ranges allowed to access this instance. Leave blank to allow all.">
            <TextInput value={str('trusted_cidrs')} onChange={v => set('trusted_cidrs', v)} placeholder="10.0.0.0/8, 172.16.0.0/12" mono />
          </Field>

          <div className="pt-4 pb-1">
            <p className="text-xs font-semibold text-white uppercase tracking-wider">System</p>
          </div>
          <Field label="Maintenance mode" hint="Blocks non-admin access and shows a maintenance banner">
            <Toggle value={bool('maintenance_mode')} onChange={v => set('maintenance_mode', v)} />
          </Field>
          <RestartServiceRow />
        </Section>
      )}

      {/* Users */}
      {tab === 'users' && isAdmin && <UsersTab />}
    </div>
  )
}