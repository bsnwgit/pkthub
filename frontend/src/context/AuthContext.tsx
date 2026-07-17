import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, setMemoryToken, clearMemoryToken } from '../api/client'

interface User {
  id: number
  username: string
  email: string
  role: 'admin' | 'analyst' | 'viewer'
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  isAnalyst: boolean
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Public display pages don't need auth — skip the check entirely so
    // an expired/missing token doesn't redirect a kiosk viewer to /login.
    if (window.location.pathname.startsWith('/display/')) {
      setLoading(false)
      return
    }

    const token = localStorage.getItem('pkthub_token')
    if (token) {
      setMemoryToken(token)
      api.me()
        .then(u => setUser(u as User))
        .catch(() => {
          clearMemoryToken()
          localStorage.removeItem('pkthub_token')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }

    // Poll session every 60 s — if the server returns 401, client.ts
    // clears the token and redirects to /login automatically.
    const interval = setInterval(() => {
      if (window.location.pathname.startsWith('/display/')) return
      if (localStorage.getItem('pkthub_token')) {
        api.me().catch(() => {}) // 401 handled in client.ts
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password)
    setMemoryToken(res.access_token)
    localStorage.setItem('pkthub_token', res.access_token)
    const me = await api.me()
    setUser(me as User)
  }

  const logout = () => {
    clearMemoryToken()
    localStorage.removeItem('pkthub_token')
    setUser(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout,
      isAdmin: user?.role === 'admin',
      isAnalyst: user?.role === 'analyst' || user?.role === 'admin',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
