import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { PktSuiteLockup } from '../components/Logo'

const SSO_ERROR_MESSAGES: Record<string, string> = {
  missing_params:          'SSO login failed: missing code or state.',
  invalid_state:           'SSO login failed: invalid state (possible CSRF). Please try again.',
  user_inactive:           'Your account is inactive. Contact an administrator.',
  saml_disabled:           'SAML SSO is not currently enabled.',
  saml_init_failed:        'Failed to initiate SAML login. Check your IdP configuration.',
  saml_processing_failed:  'SAML response could not be processed. Check your IdP configuration.',
  saml_invalid_response:   'SAML response validation failed. Check IdP certificate and entity IDs.',
  not_authenticated:       'SAML authentication was not confirmed by the IdP.',
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function clearCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/; samesite=lax`
}


// Where to land after authenticating. Only a same-origin *relative* path is
// accepted — an absolute or protocol-relative URL here would make the login page
// an open redirect, and this app is the front door to the whole suite.
function safeNext(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'                 // absolute / scheme-relative
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw.startsWith('/login')) return '/'             // never bounce back to itself
  return raw
}

export default function LoginPage() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeNext(searchParams.get('next'))

  // If auto-login (all auth methods disabled) already established a session
  // in the background, leave immediately instead of showing a login form.
  useEffect(() => {
    if (user) navigate(next, { replace: true })
  }, [user])

  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [samlEnabled, setSamlEnabled]   = useState(false)
  const [localEnabled, setLocalEnabled] = useState(true)
  const [samlLoading, setSamlLoading]   = useState(false)

  useEffect(() => {
    // Handle SSO token dropped by SAML callback
    if (searchParams.get('sso') === '1') {
      const token    = getCookie('sso_access_token')
      const role     = getCookie('sso_role')
      const uname    = getCookie('sso_username')
      if (token) {
        clearCookie('sso_access_token')
        clearCookie('sso_role')
        clearCookie('sso_username')
        localStorage.setItem('pkthub_token', token)
        if (role)  localStorage.setItem('pkthub_role', role)
        if (uname) localStorage.setItem('pkthub_username', uname)
        window.location.href = '/'
        return
      }
    }

    const ssoError = searchParams.get('sso_error')
    if (ssoError) {
      setError(SSO_ERROR_MESSAGES[ssoError] ?? `SSO error: ${ssoError}`)
    }

    api.authConfig()
      .then(data => {
        if (data.saml_enabled) setSamlEnabled(true)
        setLocalEnabled(data.local_enabled !== false)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate(next, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSamlLogin = () => {
    setSamlLoading(true)
    window.location.href = '/api/auth/saml/login'
  }

  return (
    <div className="min-h-dvh bg-gray-950 flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <PktSuiteLockup height={52} />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-5">

          {/* SAML SSO button — shown when configured */}
          {samlEnabled && (
            <>
              <button
                type="button"
                onClick={handleSamlLogin}
                disabled={samlLoading}
                className="w-full flex items-center justify-center gap-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-colors"
              >
                <svg viewBox="0 0 28 28" className="w-5 h-5 flex-shrink-0" fill="currentColor">
                  <circle cx="14" cy="14" r="14" fill="white"/>
                  <circle cx="14" cy="14" r="6" fill="#007DC1"/>
                </svg>
                {samlLoading ? 'Redirecting…' : 'Sign in with Okta'}
              </button>

              {localEnabled && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-700" />
                  <span className="text-xs text-gray-500">or</span>
                  <div className="flex-1 h-px bg-gray-700" />
                </div>
              )}
            </>
          )}

          {/* Local login form */}
          {localEnabled && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5">Username or Email</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
