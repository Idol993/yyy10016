import { create } from 'zustand'
import type { Sandbox, SandboxStatus, Language } from '@/types'
import { apiGet, apiPost, apiDelete } from '@/utils/api'
import type { ApiResponse } from '@/utils/api'

interface SandboxState {
  sandboxes: Sandbox[]
  currentSandbox: Sandbox | null
  status: SandboxStatus | null
  metrics: { cpu: number; memory: number; disk: number } | null
  wsUrl: string | null
  fetchSandboxes: () => Promise<void>
  createSandbox: (name: string, language: Language) => Promise<void>
  startSandbox: (id: number) => Promise<void>
  stopSandbox: (id: number) => Promise<void>
  deleteSandbox: (id: number) => Promise<void>
  setCurrentSandbox: (sandbox: Sandbox) => void
}

export const useSandboxStore = create<SandboxState>()((set) => ({
  sandboxes: [],
  currentSandbox: null,
  status: null,
  metrics: null,
  wsUrl: null,

  fetchSandboxes: async () => {
    const response = await apiGet<ApiResponse & { sandboxes: Sandbox[] }>('/sandboxes')
    set({ sandboxes: response.sandboxes })
  },

  createSandbox: async (name: string, language: Language) => {
    const response = await apiPost<ApiResponse & { sandbox: Sandbox }>('/sandboxes', { name, language })
    set((state) => ({ sandboxes: [...state.sandboxes, response.sandbox] }))
  },

  startSandbox: async (id: number) => {
    const response = await apiPost<ApiResponse & { sandbox: Sandbox; wsUrl: string }>(`/sandboxes/${id}/start`)
    set((state) => ({
      sandboxes: state.sandboxes.map((s) =>
        s.id === id ? response.sandbox : s
      ),
      currentSandbox:
        state.currentSandbox?.id === id
          ? response.sandbox
          : state.currentSandbox,
      wsUrl: response.wsUrl,
    }))
  },

  stopSandbox: async (id: number) => {
    const response = await apiPost<ApiResponse & { sandbox: Sandbox }>(`/sandboxes/${id}/stop`)
    set((state) => ({
      sandboxes: state.sandboxes.map((s) =>
        s.id === id ? response.sandbox : s
      ),
      currentSandbox:
        state.currentSandbox?.id === id
          ? response.sandbox
          : state.currentSandbox,
    }))
  },

  deleteSandbox: async (id: number) => {
    const response = await apiDelete<ApiResponse>(`/sandboxes/${id}`)
    if (response.success) {
      set((state) => ({
        sandboxes: state.sandboxes.filter((s) => s.id !== id),
        currentSandbox: state.currentSandbox?.id === id ? null : state.currentSandbox,
      }))
    }
  },

  setCurrentSandbox: (sandbox: Sandbox) => {
    set({ currentSandbox: sandbox, status: sandbox.status })
  },
}))
