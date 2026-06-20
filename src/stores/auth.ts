import { create } from 'zustand'
import type { User } from '@/types'
import { apiPost, apiGet } from '@/utils/api'
import type { ApiResponse } from '@/utils/api'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),

  login: async (email: string, password: string) => {
    const response = await apiPost<ApiResponse & { token: string; user: User }>('/auth/login', { email, password })
    localStorage.setItem('token', response.token)
    set({ token: response.token as string, user: response.user as User, isAuthenticated: true })
  },

  register: async (email: string, username: string, password: string) => {
    const response = await apiPost<ApiResponse & { token: string; user: User }>('/auth/register', { email, username, password })
    localStorage.setItem('token', response.token)
    set({ token: response.token as string, user: response.user as User, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null, isAuthenticated: false })
  },

  loadUser: async () => {
    try {
      const response = await apiGet<ApiResponse & { user: User }>('/auth/me')
      set({ user: response.user as User, isAuthenticated: true })
    } catch {
      localStorage.removeItem('token')
      set({ token: null, user: null, isAuthenticated: false })
    }
  },
}))
