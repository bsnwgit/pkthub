const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('pktsuite_token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (res.status === 401) {
    localStorage.removeItem('pktsuite_token')
    window.location.href = '/login'
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

  // Dashboard
  dashboard: () => request<any>('/dashboard'),

  // Apps
  listApps: () => request<any[]>('/apps'),
  registerApp: (body: any) => request<any>('/apps', { method: 'POST', body: JSON.stringify(body) }),
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
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    if (params?.action) q.set('action', params.action)
    if (params?.username) q.set('username', params.username)
    return request<any[]>(`/audit?${q}`)
  },

  // Settings
  getSettings: () => request<Record<string, string>>('/settings'),
  setSetting: (key: string, value: string) =>
    request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ key, value }) }),
  setSettingsBulk: (items: { key: string; value: string }[]) =>
    request('/settings/bulk', { method: 'POST', body: JSON.stringify(items) }),
}
