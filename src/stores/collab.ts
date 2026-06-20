import { create } from 'zustand'
import type { CollabUser } from '@/types'
import { apiGet } from '@/utils/api'
import type { ApiResponse } from '@/utils/api'

interface ChatMessage {
  userId: number
  username: string
  message: string
  timestamp: number
}

interface CollabState {
  users: CollabUser[]
  chatMessages: ChatMessage[]
  isConnected: boolean
  ydoc: unknown | null
  fetchUsers: (sandboxId: number) => Promise<void>
  addChatMessage: (userId: number, username: string, message: string, timestamp: number) => void
  setUsers: (users: CollabUser[]) => void
  addUser: (user: CollabUser) => void
  removeUser: (userId: number) => void
  updateUserCursor: (userId: number, path: string, line: number, column: number) => void
  setConnected: (connected: boolean) => void
  setChatHistory: (history: ChatMessage[]) => void
  setYDoc: (ydoc: unknown | null) => void
}

export const useCollabStore = create<CollabState>()((set, get) => ({
  users: [],
  chatMessages: [],
  isConnected: false,
  ydoc: null,

  fetchUsers: async (sandboxId: number) => {
    try {
      const response = await apiGet<ApiResponse & { users: CollabUser[] }>(`/sandboxes/${sandboxId}/collab/users`)
      set({ users: response.users || [] })
    } catch {
      // ignore
    }
  },

  addChatMessage: (userId: number, username: string, message: string, timestamp: number) => {
    const { chatMessages } = get()
    set({
      chatMessages: [
        ...chatMessages,
        { userId, username, message, timestamp },
      ],
    })
  },

  setUsers: (users: CollabUser[]) => {
    set({ users })
  },

  addUser: (user: CollabUser) => {
    const { users } = get()
    if (users.find((u) => u.id === user.id)) return
    set({ users: [...users, user] })
  },

  removeUser: (userId: number) => {
    const { users } = get()
    set({ users: users.filter((u) => u.id !== userId) })
  },

  updateUserCursor: (userId: number, path: string, line: number, column: number) => {
    const { users } = get()
    set({
      users: users.map((u) =>
        u.id === userId
          ? { ...u, cursor: { path, line, column } }
          : u
      ),
    })
  },

  setConnected: (connected: boolean) => {
    set({ isConnected: connected })
  },

  setChatHistory: (history: ChatMessage[]) => {
    set({ chatMessages: history })
  },

  setYDoc: (ydoc: unknown | null) => {
    set({ ydoc })
  },
}))
