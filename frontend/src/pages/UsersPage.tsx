import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { UserPlus, Trash2, Shield } from 'lucide-react'

const ROLE_COLOR: Record<string, string> = {
  admin: '#f87171', analyst: '#60a5fa', viewer: '#6b7280'
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'analyst' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = () => api.listUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const create = async () => {
    setCreating(true)
    setError('')
    try {
      await api.createUser(form)
      setShowForm(false)
      setForm({ username: '', email: '', password: '', role: 'analyst' })
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const del = async (id: number, username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return
    await api.deleteUser(id).then(load).catch(e => alert(e.message))
  }

  const changeRole = async (id: number, role: string) => {
    await api.updateUser(id, { role }).then(load).catch(e => alert(e.message))
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage pktSuite user accounts and roles</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
          style={{ background: 'linear-gradient(90deg,#60a5fa,#4ade80)' }}
        >
          <UserPlus size={13} /> Add User
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-blue-500/20 p-5 space-y-4" style={{ background: '#111827' }}>
          <h2 className="text-sm font-semibold text-white">New User</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Username', key: 'username', type: 'text', placeholder: 'jsmith' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'j.smith@example.com' },
              { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                <input type={f.type} value={(form as any)[f.key]} placeholder={f.placeholder}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500" />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Role</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500">
                <option value="viewer">Viewer</option>
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button onClick={create} disabled={creating || !form.username || !form.password}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#60a5fa' }}>
              {creating ? 'Creating…' : 'Create User'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>}

      <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ background: '#111827' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-white/2 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: ROLE_COLOR[u.role] + '25', color: ROLE_COLOR[u.role] }}>
                      {u.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-white font-medium">{u.username}</span>
                    {u.id === me?.id && <span className="text-xs text-gray-500">(you)</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-400">{u.email || '—'}</td>
                <td className="px-4 py-3">
                  {u.id !== me?.id ? (
                    <select
                      value={u.role}
                      onChange={e => changeRole(u.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-700 bg-gray-800 focus:outline-none"
                      style={{ color: ROLE_COLOR[u.role] }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="analyst">Analyst</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-full" style={{ color: ROLE_COLOR[u.role], background: ROLE_COLOR[u.role] + '20' }}>
                      {u.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== me?.id && (
                    <button onClick={() => del(u.id, u.username)}
                      className="p-1.5 text-gray-600 hover:text-red-400 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
