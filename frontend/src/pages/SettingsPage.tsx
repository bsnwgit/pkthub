import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type UserApiKey } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { UserPlus, Trash2, Plus, Pencil, RefreshCw, ExternalLink, ShieldCheck, Eye, Monitor, Globe, EyeOff, Copy } from 'lucide-react'
import HelpButton from '../components/HelpButton'
import ConfirmModal from '../components/ConfirmModal'

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

// ── Port field — lives in config.yaml, not the SQLite-backed settings; value
// is lifted to the parent so it saves through the General tab's one Save button ──
function PortField({ value, onChange, loaded }: { value: number; onChange: (v: number) => void; loaded: boolean }) {
  return (
    <Field label="Port" hint="Port the app listens on. Requires a service restart — the browser will need to follow the app to the new port/URL afterward.">
      {!loaded ? (
        <p className="text-xs text-white">Loading…</p>
      ) : (
        <NumberInput value={value} onChange={onChange} min={1} max={65535} />
      )}
    </Field>
  )
}

// ── Section wrapper with Save ─────────────────────────────────────────────────
function Section({
  title, children, onSave, saving, saved, error, help,
}: {
  title: string
  children: React.ReactNode
  onSave: () => Promise<void>
  saving: boolean
  saved: boolean
  error: string
  help?: { title: string; content: React.ReactNode }
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {help && <HelpButton title={help.title}>{help.content}</HelpButton>}
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

  const makeDefaultAdmin = async (u: any) => {
    if (u.is_default_admin || u.role !== 'admin' || !u.is_active) return
    try { await api.setDefaultAdmin(u.id); load() }
    catch (e: any) { setError(e.message) }
  }

  const visible = filter.trim()
    ? users.filter(u => u.username.toLowerCase().includes(filter.toLowerCase()) || (u.email || '').toLowerCase().includes(filter.toLowerCase()))
    : users

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-white">Users</p>
        <HelpButton title="Users — How It Works">
          <p>This tab only manages <span className="text-gray-300 font-medium">local accounts</span> — SAML/Okta SSO users are auto-provisioned on first login and managed in your identity provider, not here.</p>
          <p>The <span className="text-yellow-400">★</span> marks the <span className="text-gray-300 font-medium">default admin</span> — when every auth method on the Auth tab ends up disabled or misconfigured, the app skips the login page entirely and signs everyone in as this account instead of locking everyone out. Click the star on any active admin to reassign it.</p>
        </HelpButton>
      </div>
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
                          <div className="flex items-center gap-1.5">
                            <p className="text-white font-medium">{u.username}</p>
                            <button
                              onClick={() => makeDefaultAdmin(u)}
                              disabled={u.is_default_admin || u.role !== 'admin' || !u.is_active}
                              title={u.is_default_admin
                                ? 'Default admin — auto-logged-in when all auth methods are disabled'
                                : (u.role === 'admin' && u.is_active ? 'Make default admin' : 'Only active admins can be the default admin')}
                              className={`text-sm leading-none ${u.is_default_admin ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300 disabled:hover:text-gray-500'}`}
                            >
                              {u.is_default_admin ? '★' : '☆'}
                            </button>
                          </div>
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

// ── Personal API Keys — per-user vault for external lookup providers ─────────
// Scoped to the logged-in user (by username), separate from the app-wide
// Lucidchart token below. Store/list/test only — nothing consumes these keys yet.
// Providers whose response the user can filter down to specific sections in
// the IP Lookup modal. Keyed by provider id; each entry's field keys match
// what the backend's IPINFO_FIELDS / IPAPI_IS_FIELDS constants accept.
const FIELD_SETS: Record<string, { key: string; label: string }[]> = {
  ipinfo: [
    { key: 'geolocation', label: 'Geolocation' },
    { key: 'asn',         label: 'ASN / Org' },
    { key: 'company',     label: 'Company' },
    { key: 'privacy',     label: 'Privacy Detection (VPN/Proxy/Tor)' },
    { key: 'abuse',       label: 'Abuse Contact' },
    { key: 'domains',     label: 'Hosted Domains' },
  ],
  ipapi_is: [
    { key: 'geolocation', label: 'Geolocation' },
    { key: 'asn',         label: 'ASN / Org' },
    { key: 'company',     label: 'Company' },
    { key: 'detection',   label: 'Threat Detection (VPN/Proxy/Tor/Datacenter)' },
    { key: 'abuse',       label: 'Abuse Contact' },
  ],
  mxtoolbox: [
    { key: 'ptr',       label: 'Reverse DNS (PTR)' },
    { key: 'asn',       label: 'ASN' },
    { key: 'blacklist', label: 'Blacklist Check' },
  ],
}
const setFieldsApi: Record<string, (fields: string[]) => Promise<UserApiKey>> = {
  ipinfo: api.setIpinfoFields,
  ipapi_is: api.setIpapiIsFields,
  mxtoolbox: api.setMxtoolboxFields,
}
// The 5 providers with a section in the IP Lookup modal — AbuseIPDB and
// IPQualityScore have no per-field checkboxes (single score, not multiple
// sections) but still get the modal-section on/off toggle.
const MODAL_PROVIDERS = ['ipinfo', 'ipapi_is', 'abuseipdb', 'mxtoolbox', 'ipqualityscore']

function ApiKeyRow({ apiKey, draft, onDraftChange, onSave, onTest, saving, saved, error, testing, testResult, onToggleField, fieldsError, onToggleFreeTier, onToggleEnabled }: {
  apiKey: UserApiKey
  draft: string
  onDraftChange: (v: string) => void
  onSave: () => void
  onTest: () => void
  saving: boolean
  saved: boolean
  error: string
  testing: boolean
  testResult?: { ok: boolean; detail: string }
  onToggleField?: (fieldKey: string, checked: boolean) => void
  fieldsError?: string
  onToggleFreeTier?: (checked: boolean) => void
  onToggleEnabled?: (checked: boolean) => void
}) {
  const isFreeTier = apiKey.provider === 'ipapi_is' && apiKey.free_tier
  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono'
  return (
    <div>
      <label className="block text-xs text-white mb-1">{apiKey.label}</label>
      {onToggleEnabled && MODAL_PROVIDERS.includes(apiKey.provider) && (
        <label className="flex items-center gap-2 text-xs text-white cursor-pointer mb-1.5">
          <input
            type="checkbox"
            checked={apiKey.enabled}
            onChange={e => onToggleEnabled(e.target.checked)}
            className="accent-blue-600"
          />
          Show this provider in the IP Lookup modal
        </label>
      )}
      {apiKey.provider === 'ipapi_is' && onToggleFreeTier && (
        <label className="flex items-center gap-2 text-xs text-white cursor-pointer mb-1.5">
          <input
            type="checkbox"
            checked={apiKey.free_tier}
            onChange={e => onToggleFreeTier(e.target.checked)}
            className="accent-blue-600"
          />
          Use free tier (no key required, ~1,000 lookups/day)
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          placeholder="Not set"
          disabled={isFreeTier}
          className={`${inp} ${isFreeTier ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
        <button
          onClick={onTest}
          disabled={isFreeTier || testing || !draft}
          className="shrink-0 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button
          onClick={onSave}
          disabled={isFreeTier || saving}
          className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {saved && <p className="text-xs text-green-400 mt-1">Saved</p>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {testResult && (
        <p className={`text-xs mt-1 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
          {testResult.ok ? '✓ ' : '✗ '}{testResult.detail}
        </p>
      )}
      {FIELD_SETS[apiKey.provider] && onToggleField && (
        <div className="mt-3 pl-1">
          <p className="text-xs text-gray-500 mb-1.5">Shown in the IP Lookup modal:</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {FIELD_SETS[apiKey.provider].map(f => (
              <label key={f.key} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={apiKey.enabled_fields ? apiKey.enabled_fields.includes(f.key) : true}
                  onChange={e => onToggleField(f.key, e.target.checked)}
                  className="accent-blue-600"
                />
                {f.label}
              </label>
            ))}
          </div>
          {fieldsError && <p className="text-xs text-red-400 mt-1">{fieldsError}</p>}
        </div>
      )}
    </div>
  )
}

function PersonalApiKeysSection() {
  const { user: me } = useAuth()
  const [keys, setKeys]         = useState<UserApiKey[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadErr, setLoadErr]   = useState('')
  const [drafts, setDrafts]     = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState<Record<string, boolean>>({})
  const [saved, setSaved]       = useState<Record<string, boolean>>({})
  const [error, setError]       = useState<Record<string, string>>({})
  const [testing, setTesting]   = useState<Record<string, boolean>>({})
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string } | undefined>>({})
  const [fieldsError, setFieldsError] = useState('')

  const load = () => {
    setLoading(true); setLoadErr('')
    api.getUserApiKeys()
      .then(rows => { setKeys(rows); setDrafts(Object.fromEntries(rows.map(r => [r.provider, r.api_key]))) })
      .catch(e => setLoadErr(e.message || 'Failed to load keys'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleSave = async (provider: string) => {
    setSaving(s => ({ ...s, [provider]: true }))
    setError(e => ({ ...e, [provider]: '' }))
    try {
      const updated = await api.setUserApiKey(provider, drafts[provider] ?? '')
      setKeys(prev => prev.map(k => k.provider === provider ? updated : k))
      setSaved(s => ({ ...s, [provider]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [provider]: false })), 2000)
    } catch (err: any) {
      setError(e => ({ ...e, [provider]: err.message ?? 'Save failed' }))
    } finally {
      setSaving(s => ({ ...s, [provider]: false }))
    }
  }

  const handleTest = async (provider: string) => {
    setTesting(t => ({ ...t, [provider]: true }))
    setTestResult(r => ({ ...r, [provider]: undefined }))
    try {
      const res = await api.testUserApiKey(provider, drafts[provider] ?? '')
      setTestResult(r => ({ ...r, [provider]: { ok: res.status === 'ok', detail: res.detail } }))
    } catch (err: any) {
      setTestResult(r => ({ ...r, [provider]: { ok: false, detail: err.message ?? 'Test failed' } }))
    } finally {
      setTesting(t => ({ ...t, [provider]: false }))
    }
  }

  const handleToggleField = async (provider: string, fieldKey: string, checked: boolean) => {
    const providerKey = keys.find(k => k.provider === provider)
    const current = providerKey?.enabled_fields ?? FIELD_SETS[provider].map(f => f.key)
    const next = checked ? [...current, fieldKey] : current.filter(f => f !== fieldKey)
    setFieldsError('')
    try {
      const updated = await setFieldsApi[provider](next)
      setKeys(prev => prev.map(k => k.provider === provider ? updated : k))
    } catch (err: any) {
      setFieldsError(err.message ?? 'Failed to save')
    }
  }

  const handleToggleFreeTier = async (checked: boolean) => {
    setFieldsError('')
    try {
      const updated = await api.setIpapiIsFreeTier(checked)
      setKeys(prev => prev.map(k => k.provider === 'ipapi_is' ? updated : k))
    } catch (err: any) {
      setFieldsError(err.message ?? 'Failed to save')
    }
  }

  const handleToggleEnabled = async (provider: string, checked: boolean) => {
    setFieldsError('')
    try {
      const updated = await api.setProviderEnabled(provider, checked)
      setKeys(prev => prev.map(k => k.provider === provider ? updated : k))
    } catch (err: any) {
      setFieldsError(err.message ?? 'Failed to save')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white">User Keys</h2>
        <HelpButton title="User Keys — How It Works">
          <p>External API keys for lookup tools (IP reputation, geolocation, etc.) are <span className="text-gray-300 font-medium">personal, not shared</span> — each user stores their own key here under their own account, and only that user's own requests use it. Nobody else, including admins, can see the key's value.</p>
          <p>Leave a field blank and save to clear a key.</p>
        </HelpButton>
      </div>
      <p className="text-sm text-white">
        Signed in as <span className="text-white font-medium">{me?.username}</span> — these keys apply to your account only.
      </p>

      {loading ? (
        <p className="text-sm text-white">Loading…</p>
      ) : loadErr ? (
        <p className="text-sm text-red-400">{loadErr}</p>
      ) : (
        <div className="space-y-4 max-w-lg">
          {keys.map(k => (
            <div key={k.provider} className="pb-4 border-b-2 border-gray-600 last:border-0 last:pb-0">
            <ApiKeyRow
              apiKey={k}
              draft={drafts[k.provider] ?? ''}
              onDraftChange={v => setDrafts(d => ({ ...d, [k.provider]: v }))}
              onSave={() => handleSave(k.provider)}
              onTest={() => handleTest(k.provider)}
              saving={!!saving[k.provider]}
              saved={!!saved[k.provider]}
              error={error[k.provider] || ''}
              testing={!!testing[k.provider]}
              testResult={testResult[k.provider]}
              onToggleField={FIELD_SETS[k.provider] ? (fieldKey, checked) => handleToggleField(k.provider, fieldKey, checked) : undefined}
              fieldsError={fieldsError}
              onToggleFreeTier={k.provider === 'ipapi_is' ? handleToggleFreeTier : undefined}
              onToggleEnabled={checked => handleToggleEnabled(k.provider, checked)}
            />
            </div>
          ))}
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
  pktwifi: '#38bdf8', pktipam: '#f472b6', pktnode: '#facc15', pktsecurity: '#f87171',
}
function appColor(name: string) {
  const key = (name || '').toLowerCase().replace(/[^a-z]/g, '')
  return APP_COLORS[key] || '#6b7280'
}
const HEALTH_COLOR: Record<string, string> = {
  healthy: '#4ade80', degraded: '#f59e0b', unreachable: '#f87171', unknown: '#6b7280',
}

// ── App Registry tab (config only — app management lives in main App Registry page) ─────────
function AppRegistrySection({ settings, set, save }: {
  settings: Record<string,string>
  set: (k: string, v: string|boolean|number) => void
  save: { save: () => Promise<void>; saving: boolean; saved: boolean; error: string }
}) {
  return (
    <div className="space-y-4">
      <Section title="App Registry" onSave={save.save} saving={save.saving} saved={save.saved} error={save.error}>
        <Field label="Default mode on register" hint="Mode assigned to a pktApp when it is first registered">
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
  const [noc, setNocList] = useState<any[]>([])
  const [nocLoading, setNocListLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const loadNocList = () => {
    setNocListLoading(true)
    api.listNOC().then(setNocList).catch(() => {}).finally(() => setNocListLoading(false))
  }
  useEffect(() => { loadNocList() }, [])

  const canCreate = isAdmin || isAnalyst

  const create = async () => {
    setCreating(true); setCreateError('')
    try {
      await api.createNOC({ ...form, layout: [] })
      setShowForm(false)
      setForm({ name: '', description: '', display_mode: 'static', dwell_seconds: 30 })
      loadNocList()
    } catch (e: any) { setCreateError(e.message) }
    finally { setCreating(false) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete NOC display "${name}"?`)) return
    await api.deleteNOC(id).then(loadNocList).catch((e: any) => alert(e.message))
  }

  const publish = async (k: any) => {
    try {
      if (k.is_published) await api.unpublishNOC(k.id)
      else await api.publishNOC(k.id)
      loadNocList()
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

  const ALL_BUNDLE_FILES = ['pkthub.db', 'config.yaml']

  const [runState,  setRunState]  = useState<'idle'|'running'|'done'|'error'>('idle')
  const [runMsg,    setRunMsg]    = useState('')
  const [snapshots, setSnapshots] = useState<Array<{name:string;size_mb:number;created:string}>>([])
  const [showSnaps, setShowSnaps] = useState(false)
  const [snapsLoading, setSnapsLoading] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File|null>(null)
  const [restoreState, setRestoreState] = useState<'idle'|'running'|'done'|'error'>('idle')
  const [restoreMsg,   setRestoreMsg]   = useState('')
  const [restoreFiles, setRestoreFiles] = useState<Set<string>>(new Set(ALL_BUNDLE_FILES))
  const [snapshotRestore, setSnapshotRestore] = useState<Record<string, { expanded: boolean; selected: Set<string>; running: boolean; msg: string }>>({})

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
    if (!restoreFile || restoreFiles.size === 0) return
    setRestoreState('running')
    const form = new FormData()
    form.append('file', restoreFile)
    form.append('files', Array.from(restoreFiles).join(','))
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

  const toggleSnapExpanded = (name: string) => {
    setSnapshotRestore(prev => {
      const cur = prev[name] ?? { expanded: false, selected: new Set(ALL_BUNDLE_FILES), running: false, msg: '' }
      return { ...prev, [name]: { ...cur, expanded: !cur.expanded } }
    })
  }

  const toggleSnapFile = (name: string, f: string) => {
    setSnapshotRestore(prev => {
      const cur = prev[name] ?? { expanded: true, selected: new Set(ALL_BUNDLE_FILES), running: false, msg: '' }
      const next = new Set(cur.selected)
      if (next.has(f)) next.delete(f); else next.add(f)
      return { ...prev, [name]: { ...cur, selected: next } }
    })
  }

  const restoreSnapshot = async (name: string) => {
    const cur = snapshotRestore[name] ?? { expanded: true, selected: new Set(ALL_BUNDLE_FILES), running: false, msg: '' }
    if (cur.selected.size === 0) return
    const which = cur.selected.size === ALL_BUNDLE_FILES.length ? 'all files' : Array.from(cur.selected).join(', ')
    if (!window.confirm(`Restore ${which} from ${name}?\n\nThis overwrites current data and cannot be undone.`)) return
    setSnapshotRestore(prev => ({ ...prev, [name]: { ...cur, running: true, msg: '' } }))
    try {
      const qs = `?files=${encodeURIComponent(Array.from(cur.selected).join(','))}`
      const res = await fetch(`/api/backup/restore-snapshot/${encodeURIComponent(name)}${qs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const data = await res.json()
      const msg = res.ok
        ? Object.entries(data.result ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : (data.detail ?? 'Restore failed')
      setSnapshotRestore(prev => ({ ...prev, [name]: { ...cur, running: false, expanded: !res.ok, msg } }))
    } catch (e: any) {
      setSnapshotRestore(prev => ({ ...prev, [name]: { ...cur, running: false, msg: e.message } }))
    }
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
        <TextInput value={str('backup_path', '')} onChange={v => set('backup_path', v)} mono />
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
              {snapshots.map(s => {
                const sr = snapshotRestore[s.name] ?? { expanded: false, selected: new Set(ALL_BUNDLE_FILES), running: false, msg: '' }
                return (
                  <div key={s.name} className="px-4 py-2.5">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-gray-300">{s.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">{s.size_mb} MB · {s.created}</span>
                        <button type="button" onClick={() => toggleSnapExpanded(s.name)}
                          className="text-xs text-blue-400 hover:text-blue-300 underline">
                          {sr.expanded ? 'Cancel' : 'Restore…'}
                        </button>
                      </div>
                    </div>
                    {sr.expanded && (
                      <div className="mt-2 space-y-2 bg-gray-800/60 rounded-lg p-3">
                        <p className="text-xs text-gray-300">Choose which files to restore:</p>
                        <div className="flex flex-wrap gap-4">
                          {ALL_BUNDLE_FILES.map(f => (
                            <label key={f} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-300">
                              <input type="checkbox" checked={sr.selected.has(f)} onChange={() => toggleSnapFile(s.name, f)} className="accent-orange-600" />
                              <span className="font-mono">{f}</span>
                            </label>
                          ))}
                        </div>
                        <button type="button" onClick={() => restoreSnapshot(s.name)} disabled={sr.running || sr.selected.size === 0}
                          className="bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-xs rounded-lg px-3 py-1.5 transition-colors">
                          {sr.running ? 'Restoring…' : 'Restore Selected'}
                        </button>
                        {sr.msg && <p className="text-xs text-gray-300 mt-1">{sr.msg}</p>}
                      </div>
                    )}
                  </div>
                )
              })}
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
              type="button" onClick={doRestore} disabled={!restoreFile || restoreState === 'running' || restoreFiles.size === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors"
            >
              {restoreState === 'running' ? 'Restoring…' : 'Restore'}
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-gray-300">
            {ALL_BUNDLE_FILES.map(f => (
              <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restoreFiles.has(f)}
                  onChange={() => setRestoreFiles(prev => {
                    const next = new Set(prev)
                    if (next.has(f)) next.delete(f); else next.add(f)
                    return next
                  })}
                  className="accent-orange-600"
                />
                <span className="font-mono">{f}</span>
              </label>
            ))}
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
type TabId = 'general' | 'security' | 'data' | 'notifications' | 'apikeys' | 'audit' | 'registry' | 'noc' | 'maintenance'

const TABS: Array<{ id: TabId; label: string; adminOnly?: boolean; gapBefore?: boolean }> = [
  { id: 'general',       label: 'General' },
  { id: 'security',      label: 'Security' },
  { id: 'data',          label: 'Data' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'apikeys',       label: 'User Keys' },
  { id: 'audit',         label: 'Audit', gapBefore: true },
  { id: 'registry',      label: 'App Registry' },
  { id: 'noc',           label: 'NOC' },
  { id: 'maintenance',   label: 'Maintenance' },
]

// ── Security tab — its own left-hand vertical tab strip ──────────────────────
// pktHub is the parent in the suite, not a member registering with itself, so
// its "Suite Integration" is the reverse of the sibling apps': instead of one
// token to paste elsewhere, it holds the admin actions for every registered
// app's token (register/edit/rotate/resync/deregister/managed-mode). The
// read-only app list, health, context-launch, and access log for all roles
// stays on the main App Registry nav page (AppManagerPage.tsx).
type SecurityTabId = 'users' | 'auth' | 'suite' | 'ai' | 'ssl'
const SECURITY_TABS: Array<{ id: SecurityTabId; label: string; adminOnly?: boolean }> = [
  { id: 'users', label: 'Users', adminOnly: true },
  { id: 'auth',  label: 'Auth' },
  { id: 'suite', label: 'Suite Integration', adminOnly: true },
  { id: 'ai',    label: 'AI Assistant' },
  { id: 'ssl',   label: 'SSL / TLS' },
]

// ── Data tab — its own left-hand vertical tab strip ───────────────────────────
type DataTabId = 'storage' | 'backups'
const DATA_TABS: Array<{ id: DataTabId; label: string }> = [
  { id: 'storage', label: 'Storage' },
  { id: 'backups', label: 'Backups' },
]

// ── Suite Integration — admin actions for registered apps' suite tokens ──────
// The read-only app list (health, context-launch, access log) for all roles
// lives on the App Registry nav page; this panel is only the credential-
// sensitive admin actions, gated behind Settings' adminOnly wrapper.
interface ModalState {
  open: boolean; title: string; message: string
  confirmLabel: string; danger: boolean; onConfirm: () => void
}
function SuiteIntegrationTab() {
  const [apps, setApps]             = useState<any[]>([])
  const [alerts, setAlerts]         = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editingAppId, setEditingAppId] = useState<number | null>(null)
  const [form, setForm]             = useState({ name: '', base_url: '', description: '', suite_token: '', return_url: '' })
  const [registering, setRegistering] = useState(false)
  const [regError, setRegError]     = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [tokenMap, setTokenMap]     = useState<Record<number, string>>({})
  const [feedback, setFeedback]     = useState<{ appId: number; status: 'verifying' | 'ok' | 'fail'; message: string } | null>(null)
  const [bulkWorking, setBulkWorking] = useState(false)
  const [modal, setModal]           = useState<ModalState>({
    open: false, title: '', message: '', confirmLabel: 'Confirm', danger: false, onConfirm: () => {},
  })

  const closeModal = () => setModal(m => ({ ...m, open: false }))
  const showConfirm = (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }) => {
    setModal({
      open: true, title: opts.title, message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm', danger: opts.danger ?? false,
      onConfirm: () => { closeModal(); opts.onConfirm() },
    })
  }

  const load = () => {
    setLoading(true)
    Promise.all([api.listApps(), api.listAlerts()])
      .then(([appsData, alertsData]) => { setApps(appsData); setAlerts(alertsData) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const showFeedback = (appId: number, status: 'verifying' | 'ok' | 'fail', message: string) => {
    setFeedback({ appId, status, message })
    if (status !== 'verifying') setTimeout(() => setFeedback(f => f?.appId === appId ? null : f), 6000)
  }

  const cancelForm = () => {
    setShowForm(false); setEditingAppId(null)
    setForm({ name: '', base_url: '', description: '', suite_token: '', return_url: '' })
    setRegError(''); setVerifyStatus('idle')
  }

  const register = async () => {
    setRegError(''); setRegistering(true)
    try {
      if (editingAppId !== null) {
        await api.updateApp(editingAppId, {
          name: form.name, base_url: form.base_url,
          description: form.description, return_url: form.return_url || null,
        })
      } else {
        await api.registerApp(form)
      }
      cancelForm()
      load()
      window.dispatchEvent(new Event('pkthub:reg-apps-changed'))
    } catch (e: any) { setRegError(e.message) }
    finally { setRegistering(false) }
  }

  const startEdit = (app: any) => {
    setEditingAppId(app.id)
    setForm({ name: app.name, base_url: app.base_url, description: app.description || '', suite_token: '', return_url: app.return_url || '' })
    setRegError(''); setShowForm(true)
  }

  const verifyUrl = async (url: string) => {
    if (!url) return
    setVerifyStatus('checking')
    try {
      await fetch(`${url.replace(/\/$/, '')}/api/health`, { method: 'GET', mode: 'no-cors', signal: AbortSignal.timeout(6000) })
      setVerifyStatus('ok')
    } catch { setVerifyStatus('fail') }
  }

  const deregister = (id: number, name: string) => {
    showConfirm({
      title: `Deregister ${name}?`,
      message: 'This removes the suite token and restores direct access to the app.\nThe app will no longer be accessible through pktHub proxy.',
      confirmLabel: 'Deregister', danger: true,
      onConfirm: async () => {
        try {
          await api.deregisterApp(id)
          load()
          window.dispatchEvent(new Event('pkthub:reg-apps-changed'))
        }
        catch (e: any) { setError(e.message) }
      },
    })
  }

  const rotateToken = (id: number, name: string) => {
    showConfirm({
      title: `Rotate Suite Token — ${name}?`,
      message: `This generates a new suite token and immediately invalidates the current one.\n\nThe new token will be displayed once — copy it before navigating away.\n\nThe app will lose hub connectivity until the token is re-entered in its Settings → Integrations.`,
      confirmLabel: 'Rotate Token', danger: true,
      onConfirm: async () => {
        try {
          const res = await api.rotateToken(id)
          setTokenMap(m => ({ ...m, [id]: res.suite_token }))
          setTimeout(() => setTokenMap(m => { const n = { ...m }; delete n[id]; return n }), 30000)
        } catch (e: any) { setError(e.message) }
      },
    })
  }

  const resyncTokenHandler = async (appId: number, appName: string) => {
    showFeedback(appId, 'verifying', 'Syncing token from app…')
    try {
      await api.resyncToken(appId)
      showFeedback(appId, 'ok', 'Token synced — mismatch resolved ✓')
      load()
    } catch (e: any) {
      showFeedback(appId, 'fail', e.message || 'Token sync failed')
    }
  }

  const toggleMode = (app: any) => {
    const toLocked = app.access_mode !== 'managed'
    showConfirm({
      title: toLocked ? `Enable Managed Mode — ${app.name}` : `Disable Managed Mode — ${app.name}`,
      message: toLocked
        ? `This will block direct URL access to ${app.name}.\nAll users must go through pktHub.\n\nA hub_redirect_url must be configured in the app's Settings → Integrations.\nThe hub will verify the lock took effect before confirming.`
        : `This will restore direct URL access to ${app.name}.\nUsers will be able to bypass pktHub again.`,
      confirmLabel: toLocked ? 'Enable Managed Mode' : 'Disable Managed Mode',
      onConfirm: async () => {
        showFeedback(app.id, 'verifying', toLocked ? 'Applying lock…' : 'Removing lock…')
        try {
          const res = await api.setDirectAccess(app.id, toLocked)
          if (res.verified === false) showFeedback(app.id, 'fail', res.detail || 'Lock command sent but verification failed')
          else showFeedback(app.id, 'ok', toLocked ? 'Managed mode active — lock verified ✓' : 'Direct access restored')
          load()
        } catch (e: any) { showFeedback(app.id, 'fail', e.message || 'Failed') }
      },
    })
  }

  const bulkSetManaged = (toLocked: boolean) => {
    showConfirm({
      title: toLocked ? 'Set All Apps to Managed?' : 'Restore Direct Access for All Apps?',
      message: toLocked
        ? 'This will attempt to enable managed mode on all registered apps.\nEach app must have a hub_redirect_url configured in Settings → Integrations.'
        : 'This will restore direct URL access on all registered apps.',
      confirmLabel: toLocked ? 'Enable All' : 'Restore All', danger: !toLocked,
      onConfirm: async () => {
        setBulkWorking(true)
        try { await api.bulkDirectAccess(toLocked); load() }
        catch (e: any) { setError(e.message) }
        finally { setBulkWorking(false) }
      },
    })
  }

  return (
    <div className="space-y-4">
      <ConfirmModal open={modal.open} title={modal.title} message={modal.message}
        confirmLabel={modal.confirmLabel} danger={modal.danger} onConfirm={modal.onConfirm} onCancel={closeModal} />

      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-white">Suite Integration</p>
        <HelpButton title="Suite Integration — How It Works">
          <p>pktHub is the parent app in the suite, so this works in reverse of the sibling apps' "Suite Integration" tab: instead of showing one token to copy elsewhere, each registered app below gets its own suite token that pktHub uses to call <em>into</em> it (health checks, proxying).</p>
          <p>To register a new app: get its Suite Token from that app's own <span className="text-gray-300 font-medium">Settings → Integrations → Copy Token</span>, then paste it here.</p>
          <p><span className="text-gray-300 font-medium">Managed mode</span> blocks direct URL access to that app — everyone must go through pktHub's proxy. Requires a <span className="text-gray-300 font-medium">hub_redirect_url</span> configured in the app's own Settings first.</p>
          <p>Read-only monitoring (health status, Open in Context, access log) for all roles lives on the <span className="text-gray-300 font-medium">App Registry</span> page in the sidebar — this tab is admin actions only.</p>
        </HelpButton>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">Register, rotate, and control access for every pktApp in the suite</p>
        <div className="flex gap-2 flex-wrap">
          {apps.length > 0 && (
            <>
              <button onClick={() => bulkSetManaged(true)} disabled={bulkWorking}
                className="text-xs px-3 py-1.5 rounded-lg border border-orange-700/50 text-orange-300 hover:border-orange-500 hover:text-orange-200 transition-colors disabled:opacity-40">
                {bulkWorking ? '…' : 'Set All Managed'}
              </button>
              <button onClick={() => bulkSetManaged(false)} disabled={bulkWorking}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40">
                Restore All Direct
              </button>
            </>
          )}
          <button onClick={() => { cancelForm(); setShowForm(v => !v) }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
            style={{ background: 'linear-gradient(90deg,#60a5fa,#2dd4bf)' }}>
            <Plus size={13} /> {editingAppId !== null ? 'Edit App' : 'Register App'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/15 border border-red-800/20 rounded-lg px-4 py-3">{error}</div>
      )}

      {showForm && (
        <div className="rounded-xl border border-blue-500/20 p-5 space-y-4 bg-gray-900">
          <h2 className="text-sm font-semibold text-white">{editingAppId !== null ? 'Edit App' : 'Register New App'}</h2>
          {editingAppId === null && (
            <p className="text-xs text-blue-300/80 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2">
              Get the Suite Token from the pktApp: <strong>Settings → Integrations → pktHub Integration → Copy Token</strong>
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">App Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="pktLog" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="Real-time log analysis" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Base URL</label>
              <div className="flex gap-2">
                <input value={form.base_url}
                  onChange={e => { setForm(f => ({ ...f, base_url: e.target.value })); setVerifyStatus('idle') }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                  placeholder="https://10.0.0.10:8766" />
                <button onClick={() => verifyUrl(form.base_url)}
                  disabled={!form.base_url || verifyStatus === 'checking'}
                  className="px-3 py-2 rounded-lg text-xs border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 disabled:opacity-40 whitespace-nowrap bg-gray-800">
                  {verifyStatus === 'checking' ? '…' : verifyStatus === 'ok' ? '✓ OK' : verifyStatus === 'fail' ? '✗ Fail' : 'Verify'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Return URL <span className="text-gray-600">(optional)</span></label>
              <input value={form.return_url} onChange={e => setForm(f => ({ ...f, return_url: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
                placeholder="https://pkthub.internal/apps" />
            </div>
          </div>
          {editingAppId === null && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Suite Token <span className="text-red-400">*</span></label>
              <input value={form.suite_token} onChange={e => setForm(f => ({ ...f, suite_token: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500 font-mono"
                placeholder="Paste token from pktApp Settings → Integrations" />
            </div>
          )}
          {regError && <div className="text-xs text-red-400">{regError}</div>}
          <div className="flex gap-2">
            <button onClick={register}
              disabled={registering || !form.name || !form.base_url || (editingAppId === null && !form.suite_token)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#60a5fa' }}>
              {registering ? (editingAppId !== null ? 'Saving…' : 'Registering…') : (editingAppId !== null ? 'Save Changes' : 'Register')}
            </button>
            <button onClick={cancelForm} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}
      {!loading && apps.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-gray-800 rounded-xl bg-gray-900">
          No apps registered. Click "Register App" to add one.
        </div>
      )}

      <div className="space-y-2">
        {apps.map(app => {
          const color = appColor(app.name)
          const isManaged = app.access_mode === 'managed'
          const hasMismatch = alerts.some((a: any) => a.app_id === app.id && a.event_type === 'token_mismatch' && a.status === 'active')
          const fb = feedback?.appId === app.id ? feedback : null
          return (
            <div key={app.id} className="rounded-xl border p-4 bg-gray-900" style={{ borderColor: color + '25' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white">{app.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                      isManaged ? 'bg-orange-900/30 text-orange-300 border-orange-700/30' : 'bg-blue-900/20 text-blue-300 border-blue-800/20'
                    }`}>
                      {isManaged ? '🔒 Managed' : '👁 Direct'}
                    </span>
                    {hasMismatch && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium border bg-red-900/30 text-red-300 border-red-700/30 animate-pulse">
                        ⚠️ Token Mismatch
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-1 font-mono truncate">{app.base_url}</p>
                  {fb && (
                    <div className={`mt-2 flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg w-fit ${
                      fb.status === 'ok' ? 'bg-green-900/20 text-green-400 border border-green-800/20' :
                      fb.status === 'fail' ? 'bg-red-900/20 text-red-400 border border-red-800/20' :
                      'bg-blue-900/20 text-blue-400 border border-blue-800/20'
                    }`}>
                      {fb.message}
                    </div>
                  )}
                  {tokenMap[app.id] && (
                    <div className="mt-2 p-2 rounded-lg bg-gray-800 border border-gray-700 w-fit">
                      <p className="text-xs text-yellow-400 mb-1">Suite token (shown once — copy now):</p>
                      <code className="text-xs text-gray-200 break-all">{tokenMap[app.id]}</code>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(app)} title="Edit app"
                    className="p-1.5 text-gray-400 hover:text-blue-400 rounded-lg hover:bg-gray-700 transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => toggleMode(app)} title={isManaged ? 'Disable Managed Mode' : 'Enable Managed Mode'}
                    className={`p-1.5 rounded-lg transition-colors ${isManaged ? 'text-orange-400 hover:text-orange-200 hover:bg-orange-900/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                    {isManaged ? <Eye size={14} /> : <ShieldCheck size={14} />}
                  </button>
                  {hasMismatch && (
                    <button onClick={() => resyncTokenHandler(app.id, app.name)} title="Re-sync suite token from app"
                      className="p-1.5 text-red-400 hover:text-red-200 rounded-lg hover:bg-red-900/20 transition-colors"><RefreshCw size={14} /></button>
                  )}
                  <button onClick={() => rotateToken(app.id, app.name)} title="Rotate suite token"
                    className="p-1.5 text-gray-400 hover:text-yellow-400 rounded-lg hover:bg-gray-700 transition-colors"><RefreshCw size={14} /></button>
                  <button onClick={() => deregister(app.id, app.name)} title="Deregister"
                    className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-700 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') as TabId | null
  const initialSecurityTab = searchParams.get('securityTab') as SecurityTabId | null
  const [tab, setTab] = useState<TabId>(
    initialTab && TABS.some(t => t.id === initialTab) ? initialTab : 'general'
  )
  const [securityTab, setSecurityTab] = useState<SecurityTabId>(
    initialSecurityTab && SECURITY_TABS.some(t => t.id === initialSecurityTab)
      ? initialSecurityTab
      : (isAdmin ? 'users' : 'auth')
  )
  const [dataTab, setDataTab] = useState<DataTabId>('storage')
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
  // General tab's Port field lives in config.yaml (not the SQLite settings
  // blob) so it needs its own fetch, but saves through the same one button.
  const [portValue, setPortValue]   = useState(0)
  const [portLoaded, setPortLoaded] = useState(false)
  useEffect(() => {
    api.getPort().then((r: { port: number }) => setPortValue(r.port)).catch(() => {}).finally(() => setPortLoaded(true))
  }, [])

  const [generalSaving, setGeneralSaving] = useState(false)
  const [generalSaved, setGeneralSaved]   = useState(false)
  const [generalError, setGeneralError]   = useState('')

  const saveGeneral = async () => {
    if (portValue < 1 || portValue > 65535) { setGeneralError('Enter a port between 1 and 65535'); return }
    setGeneralSaving(true); setGeneralSaved(false); setGeneralError('')
    try {
      const subset: Record<string, string> = {}
      for (const k of ['app_name', 'base_url', 'timezone']) if (k in settings) subset[k] = settings[k]
      await api.bulkUpdateSettings(subset)
      await api.setPort(portValue)
      await load()
      setGeneralSaved(true)
      setTimeout(() => setGeneralSaved(false), 3000)
    } catch (e: any) {
      setGeneralError(e.message || 'Save failed')
    } finally {
      setGeneralSaving(false)
    }
  }
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
  const lucidSave = useSave(['lucid_api_token'], settings, load)
  const maintSave = useSave(['trusted_cidrs', 'maintenance_mode'], settings, load)
  const aiAssistantSave = useSave(['anthropic_api_key', 'ai_model'], settings, load)

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
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit overflow-x-auto">
        {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
          <Fragment key={t.id}>
            {t.gapBefore && <div className="w-px self-stretch bg-gray-700 mx-2" />}
            <button
              onClick={() => setTab(t.id)}
              className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-gray-700 text-white' : 'text-white hover:text-white'
              }`}
            >
              {t.label}
            </button>
          </Fragment>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <Section title="General" onSave={saveGeneral} saving={generalSaving} saved={generalSaved} error={generalError}
          help={{
            title: 'General — How It Works',
            content: <>
              <p><span className="text-gray-300 font-medium">Base URL</span> feeds the SAML ACS/metadata URLs on the Auth tab and any links posted in Slack/Email/webhook notifications — set it to the actual externally-reachable address before configuring SSO or notifications, or those will point at the wrong place.</p>
              <p><span className="text-gray-300 font-medium">Port</span> only takes effect after a restart. Changing it moves the app to a new URL; the browser won't follow automatically.</p>
            </>,
          }}
        >
          <Field label="App name" hint="Displayed in the browser tab and header">
            <TextInput value={str('app_name', 'pktHub')} onChange={v => set('app_name', v)} />
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
          <PortField value={portValue} onChange={setPortValue} loaded={portLoaded} />
          <Field label="Base URL" hint="Canonical URL for this pktHub instance — used for SAML ACS and notification links">
            <TextInput value={str('base_url')} onChange={v => set('base_url', v)} placeholder="https://10.0.0.10:8760" mono />
          </Field>
          <RestartServiceRow />
        </Section>
      )}

      {/* Security */}
      {tab === 'security' && (
        <div className="flex gap-4 items-start">
          <div className="flex flex-col gap-1.5 w-48 flex-shrink-0">
            {SECURITY_TABS.filter(st => !st.adminOnly || isAdmin).map(st => (
              <button
                key={st.id}
                onClick={() => setSecurityTab(st.id)}
                className={`text-sm px-4 py-2 rounded-lg border text-left whitespace-nowrap transition-colors ${
                  securityTab === st.id
                    ? 'bg-gray-800 border-blue-500 text-white'
                    : 'bg-gray-900 border-gray-800 text-white hover:border-gray-600'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            {securityTab === 'users' && isAdmin && <UsersTab />}

            {securityTab === 'auth' && (
              <Section title="Authentication" onSave={authSave.save} saving={authSave.saving} saved={authSave.saved} error={authSave.error}
                help={{
                  title: 'Authentication — How It Works',
                  content: <>
                    <p><span className="text-gray-300 font-medium">Local auth</span> and <span className="text-gray-300 font-medium">SAML SSO</span> aren't mutually exclusive — both can be on at once. Turning Local auth off forces everyone through SSO.</p>
                    <p>SAML users are <span className="text-gray-300 font-medium">auto-provisioned</span> on first successful login — no separate "create user" step.</p>
                    <p>Setting this up: paste Okta's IdP metadata XML to auto-fill the IdP fields, then register the <span className="text-gray-300 font-medium">ACS URL</span> shown here as the Single Sign-On URL in your Okta app. Both the ACS URL and SP metadata link derive from <span className="text-gray-300 font-medium">Base URL</span> on the General tab — set that correctly first.</p>
                    <p>If every auth method ends up disabled or misconfigured, the app doesn't lock you out — it signs everyone in as the account marked <span className="text-yellow-400">★</span> on the Users tab. See the Users tab help for details.</p>
                  </>,
                }}
              >
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

            {securityTab === 'suite' && isAdmin && <SuiteIntegrationTab />}

            {securityTab === 'ai' && (
              <Section title="AI Assistant" onSave={aiAssistantSave.save} saving={aiAssistantSave.saving} saved={aiAssistantSave.saved} error={aiAssistantSave.error}
                help={{
                  title: 'AI Assistant — How It Works',
                  content: <>
                    <p><span className="text-gray-300 font-medium">AI Assistant</span> needs its own Anthropic API key (console.anthropic.com, separate from a Claude Enterprise seat) before the in-app chat panel does anything. Haiku is the default: fastest/cheapest for questions about registered apps, NOC status, and the audit log.</p>
                    <p>Unlike the sibling apps' assistants, pktHub's is scoped to <span className="text-gray-300 font-medium">its own data</span> — the app registry, NOC dashboards, and audit log — not any individual pktApp's telemetry.</p>
                  </>,
                }}
              >
                <Field label="Anthropic API key" hint="Required for the in-app AI assistant. Get a key at console.anthropic.com.">
                  <TextInput value={str('anthropic_api_key')} onChange={v => set('anthropic_api_key', v)} placeholder="sk-ant-…" secret mono />
                </Field>
                <Field label="AI model" hint="Model used for the assistant. Haiku is fast and cost-effective.">
                  <SelectInput
                    value={str('ai_model', 'claude-haiku-4-5-20251001')}
                    onChange={v => set('ai_model', v)}
                    options={[
                      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku (fast, low cost)' },
                      { value: 'claude-sonnet-5', label: 'Claude Sonnet (balanced)' },
                      { value: 'claude-opus-4-8', label: 'Claude Opus (most capable)' },
                    ]}
                  />
                </Field>
              </Section>
            )}

            {securityTab === 'ssl' && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-6 py-4">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-sm font-semibold text-white">SSL / TLS</h2>
                  <HelpButton title="SSL/TLS — How It Works">
                    <p>Accepts either a combined PFX/P12 file or a separate PEM cert+key pair — whichever is uploaded gets written to <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">/etc/ssl/pkthub/</code>.</p>
                    <p>Unlike other pkt* apps, there's no separate "Enable HTTPS" toggle here: pktHub auto-detects the cert/key pair at startup and switches to HTTPS automatically if one is present, on the same port. Restart the service (Maintenance tab) after uploading for it to take effect.</p>
                  </HelpButton>
                </div>
                <SslPanel />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data */}
      {tab === 'data' && (
        <div className="flex gap-4 items-start">
          <div className="flex flex-col gap-1.5 w-48 flex-shrink-0">
            {DATA_TABS.map(dt => (
              <button
                key={dt.id}
                onClick={() => setDataTab(dt.id)}
                className={`text-sm px-4 py-2 rounded-lg border text-left whitespace-nowrap transition-colors ${
                  dataTab === dt.id
                    ? 'bg-gray-800 border-blue-500 text-white'
                    : 'bg-gray-900 border-gray-800 text-white hover:border-gray-600'
                }`}
              >
                {dt.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            {dataTab === 'storage' && <StorageSection settings={settings} set={set} save={storageSave} />}
            {dataTab === 'backups' && <BackupSection settings={settings} set={set} save={backupSave} />}
          </div>
        </div>
      )}

      {/* App Registry */}
      {tab === 'registry' && (
        <AppRegistrySection settings={settings} set={set} save={registrySave} />
      )}

      {/* NOC */}
      {tab === 'noc' && (
        <NOCSection settings={settings} set={set} save={nocSave} />
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

      {/* User Keys — per-user vault for external lookup providers, plus the
          app-wide Lucidchart token (admin-configured, shared by everyone) */}
      {tab === 'apikeys' && (
        <div>
          <PersonalApiKeysSection />

          <div className="pt-2 border-t border-gray-800 max-w-lg mt-6">
            <p className="text-xs font-semibold text-white uppercase tracking-wider mt-4 mb-1">Lucidchart</p>
            <label className="block text-xs text-white mb-1">API token</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={str('lucid_api_token')}
                onChange={e => set('lucid_api_token', e.target.value)}
                placeholder="eyJ…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                onClick={lucidSave.save}
                disabled={lucidSave.saving}
                className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                {lucidSave.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {lucidSave.saved && <p className="text-xs text-green-400 mt-1">Saved</p>}
            {lucidSave.error && <p className="text-xs text-red-400 mt-1">{lucidSave.error}</p>}
            <p className="text-xs text-gray-500 mt-1">Personal Access Token from lucid.co → Account → API Tokens. Required for topology export to Lucidchart.</p>
          </div>
        </div>
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
        </Section>
      )}
    </div>
  )
}