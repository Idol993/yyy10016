import { useEffect, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth'
import { useCollabStore } from '@/stores/collab'

export interface CollabUser {
  id: number
  username: string
  color: string
  permission: 'edit' | 'read' | 'owner'
  cursor?: {
    path: string
    line: number
    column: number
  }
}

export interface ChatMessage {
  userId: number
  username: string
  message: string
  timestamp: number
}

export interface TerminalOutput {
  stream: 'stdout' | 'stderr' | 'system'
  data: string
  timestamp: number
}

export interface UseSandboxWSReturn {
  ydoc: Y.Doc | null
  isConnected: boolean
  terminalOutput: string
  permission: 'read' | 'edit' | 'owner'
  sendExecute: (command: string, args?: string[]) => void
  sendRun: () => void
  sendInput: (input: string) => void
  sendResize: (cols: number, rows: number) => void
  sendEdit: (update: Uint8Array) => void
  sendCursor: (path: string, line: number, column: number) => void
  sendChat: (message: string) => void
  users: CollabUser[]
  chatMessages: ChatMessage[]
}

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
]

function getUserColor(userId: number): string {
  return USER_COLORS[userId % USER_COLORS.length]
}

export function useSandboxWS(sandboxId: number | null): UseSandboxWSReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const ydocRef = useRef<Y.Doc | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [terminalOutput, setTerminalOutput] = useState('')
  const [users, setUsers] = useState<CollabUser[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [permission, setPermission] = useState<'read' | 'edit' | 'owner'>('edit')
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id)
  const username = useAuthStore((s) => s.user?.username)
  const setChatHistory = useCollabStore((s) => s.setChatHistory)

  const connect = useCallback(() => {
    if (!sandboxId || !token) return

    if (ydocRef.current) {
      ydocRef.current.destroy()
    }
    ydocRef.current = new Y.Doc()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/sandbox/${sandboxId}?token=${encodeURIComponent(token)}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; payload: Record<string, unknown> }
        const ydoc = ydocRef.current

        switch (msg.type) {
          case 'output': {
            const payload = msg.payload as { stream: string; data: string; timestamp: number }
            setTerminalOutput((prev) => prev + payload.data)
            break
          }
          case 'collab_init': {
            if (ydoc) {
              const update = new Uint8Array(msg.payload.update as number[])
              Y.applyUpdate(ydoc, update)
            }
            break
          }
          case 'collab_edit': {
            if (ydoc) {
              const update = new Uint8Array(msg.payload.update as number[])
              Y.applyUpdate(ydoc, update)
            }
            break
          }
          case 'cursor': {
            const uid = msg.payload.userId as number
            const path = msg.payload.path as string
            const line = msg.payload.line as number
            const column = msg.payload.column as number

            setUsers((prev) =>
              prev.map((u) =>
                u.id === uid
                  ? { ...u, cursor: { path, line, column } }
                  : u
              )
            )
            break
          }
          case 'chat': {
            const chatMsg = msg.payload as unknown as ChatMessage
            setChatMessages((prev) => [...prev, chatMsg])
            break
          }
          case 'chat_history': {
            const history = (msg.payload.history as unknown as ChatMessage[]) || []
            setChatMessages(history)
            setChatHistory(history)
            break
          }
          case 'users': {
            const userList = (msg.payload.users as unknown as CollabUser[]) || []
            setUsers(userList)
            break
          }
          case 'user_join': {
            const newUser = msg.payload.user as unknown as CollabUser
            setUsers((prev) => {
              if (prev.find((u) => u.id === newUser.id)) return prev
              return [...prev, newUser]
            })
            break
          }
          case 'user_leave': {
            const leaveUserId = msg.payload.userId as number
            setUsers((prev) => prev.filter((u) => u.id !== leaveUserId))
            break
          }
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [sandboxId, token, setChatHistory])

  useEffect(() => {
    if (sandboxId && token) {
      connect()
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (ydocRef.current) {
        ydocRef.current.destroy()
        ydocRef.current = null
      }
      setTerminalOutput('')
      setUsers([])
      setChatMessages([])
    }
  }, [sandboxId, token, connect])

  const send = useCallback((type: string, payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  const sendExecute = useCallback((command: string, args?: string[]) => {
    send('execute', { command, args: args || [] })
  }, [send])

  const sendRun = useCallback(() => {
    send('run', {})
  }, [send])

  const sendInput = useCallback((input: string) => {
    if (permission === 'read') return
    send('input', { data: input })
  }, [send, permission])

  const sendResize = useCallback((cols: number, rows: number) => {
    send('resize', { cols, rows })
  }, [send])

  const sendEdit = useCallback((update: Uint8Array) => {
    if (permission === 'read') return
    send('collab_edit', { update: Array.from(update) })
  }, [send, permission])

  const sendCursor = useCallback((path: string, line: number, column: number) => {
    if (permission === 'read') return
    send('cursor', { path, line, column })
  }, [send, permission])

  const sendChat = useCallback((message: string) => {
    send('chat', { message })
  }, [send])

  useEffect(() => {
    if (userId && username) {
      const color = getUserColor(userId)
      setUsers((prev) => {
        if (prev.find((u) => u.id === userId)) {
          const me = prev.find((u) => u.id === userId)!
          setPermission(me.permission)
          return prev
        }
        setPermission('owner')
        return [{ id: userId, username, color, permission: 'owner' }, ...prev]
      })
    }
  }, [userId, username])

  useEffect(() => {
    const me = users.find((u) => u.id === userId)
    if (me) {
      setPermission(me.permission)
    }
  }, [users, userId])

  return {
    ydoc: ydocRef.current,
    isConnected,
    terminalOutput,
    permission,
    sendExecute,
    sendRun,
    sendInput,
    sendResize,
    sendEdit,
    sendCursor,
    sendChat,
    users,
    chatMessages,
  }
}
