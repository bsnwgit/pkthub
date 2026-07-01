const BASE = '/api'

// ── In-memory token store ─────────────────────────────────────────────────────
// Intentionally NOT in localStorage — survives the session tab but is gone on
// tab close/reload.  The server's HttpOnly pkthub_session cookie covers reloads.
let _memoryToken: string | null = null

export function setMemoryToken(token: string | null): void {
  _memoryToken = token
}

export function clearMemoryToken(): void {
  _memoryToken = null
}

function getToken(): string | null {
  return _memoryToken
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  })
  if (res.status === 401) {
    clearMemoryToken()
    // Do NOT redirect here — AuthContext.me() catches 401 and sets user=null,
    // RequireAuth then redirects to /login. A hard redirect here causes an
    // infinite reload loop on the login page itself.
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  if (res.status === 204) return null as T
  return res.json()
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ access_token: string; role: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ id: number; username: string; email: string; role: string }>('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  authConfig: () => request<{ saml_enabled: boolean; local_enabled: boolean }>('/auth/config'),
  createProxySession: (appId: number) =>
    request<{ ok: boolean }>(`/auth/proxy-session/${appId}`, { method: 'POST' }),

  // Dashboard
  dashboard: () => request<any>('/dashboard'),

  // Apps
  listApps: () => request<any[]>('/apps'),
  registerApp: (body: any) => request<any>('/apps', { method: 'POST', body: JSON.stringify(body) }),
  updateApp: (id: number, body: any) =>
    request<any>(`/apps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deregisterApp: (id: number) => request(`/apps/${id}`, { method: 'DELETE' }),
  setAppStatus: (id: number, status: string) =>
    request<any>(`/apps/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  rotateToken: (id: number) =>
    request<any>(`/apps/${id}/rotate-token`, { method: 'POST' }),

  // Users
  listUsers: () => request<any[]>('/users'),
  createUser: (body: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: number, body: any) =>
    request<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteUser: (id: number) => request(`/users/${id}`, { method: 'DELETE' }),
  changePassword: (body: any) =>
    request('/users/me/password', { method: 'POST', body: JSON.stringify(body) }),
  resetUserPassword: (id: number, password: string) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  // Kiosks
  listKiosks: () => request<any[]>('/kiosks'),
  createKiosk: (body: any) => request<any>('/kiosks', { method: 'POST', body: JSON.stringify(body) }),
  updateKiosk: (id: number, body: any) =>
    request<any>(`/kiosks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteKiosk: (id: number) => request(`/kiosks/${id}`, { method: 'DELETE' }),
  publishKiosk: (id: number) => request<any>(`/kiosks/${id}/publish`, { method: 'POST' }),
  unpublishKiosk: (id: number) => request<any>(`/kiosks/${id}/unpublish`, { method: 'POST' }),
  getKioskDisplay: (token: string) => request<any>(`/kiosks/display/${token}`),

  // Audit
  auditLog: (params?: { limit?: number; offset?: number; action?: string; username?: string }) => {
    const q = new URLSearchParams()
    if (params?.limit)    q.set('limit',    String(params.limit))
    if (params?.offset)   q.set('offset',   String(params.offset))
    if (params?.action)   q.set('action',   params.action)
    if (params?.username) q.set('username', params.username)
    return request<any[]>(`/audit?${q}`)
  },

  // Settings
  getSettings: () => request<Record<string, string>>('/settings'),
  setSetting: (key: string, value: string) =>
    request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ key, value }) }),
  setSettingsBulk: (items: { key: string; value: string }[]) =>
    request('/settings/bulk', { method: 'POST', body: JSON.stringify(items) }),
  bulkUpdateSettings: (settings: Record<string, unknown>) =>
    request('/settings/bulk', {
      method: 'POST',
      body: JSON.stringify(
        Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }))
      ),
    }),

  // Notifications
  testNotification: (channel: string) =>
    request<{ status: string; detail?: string }>(`/notifications/test/${channel}`, { method: 'POST' }),

  // SSL
  getSslStatus: () => request<any>('/ssl/status'),
  uploadSsl: (certFile: File, keyFile: File) => {
    const fd = new FormData()
    fd.append('cert_file', certFile)
    fd.append('key_file', keyFile)
    const token = getToken()
    return fetch(`${BASE}/ssl/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
      body: fd,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail) }
      return r.json()
    })
  },
  uploadSslPfx: (pfxFile: File, passphrase: string) => {
    const fd = new FormData()
    fd.append('pfx_file', pfxFile)
    fd.append('passphrase', passphrase)
    const token = getToken()
    return fetch(`${BASE}/ssl/upload-pfx`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
      body: fd,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail) }
      return r.json()
    })
  },
  deleteSsl: () => request('/ssl/', { method: 'DELETE' }),

  // Alert Rules
  listAlertRules: () => request<any[]>('/alert-rules'),
  createAlertRule: (body: any) => request<any>('/alert-rules', { method: 'POST', body: JSON.stringify(body) }),
  updateAlertRule: (id: number, body: any) => request<any>(`/alert-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAlertRule: (id: number) => request(`/alert-rules/${id}`, { method: 'DELETE' }),
}
