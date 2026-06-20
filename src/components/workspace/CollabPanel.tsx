import { useState, useRef, useEffect } from 'react'
import { Share2, Send, MessageSquare, Eye, Edit3, X, Crown } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useSandbox } from '@/contexts/SandboxContext'

interface CollabPanelProps {
  onClose?: () => void
}

export default function CollabPanel({ onClose }: CollabPanelProps) {
  const { user } = useAuthStore()
  const { users, chatMessages, sendChat, isConnected } = useSandbox()
  const [inputValue, setInputValue] = useState('')
  const [copied, setCopied] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSend = () => {
    if (!inputValue.trim()) return
    sendChat(inputValue.trim())
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleShare = () => {
    const url = window.location.href
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const onlineUsers = users.length > 0 ? users : [
    { id: 1, username: user?.username || 'you', email: user?.email || '', permission: 'edit' as const, color: '#58A6FF' },
  ]

  return (
    <div className="h-full flex flex-col bg-[#161B22]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[#58A6FF]" />
          <h2 className="font-semibold text-sm text-[#E6EDF3]">Collaboration</h2>
          {isConnected && (
            <span className="w-2 h-2 rounded-full bg-[#3FB950]" />
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-[#30363D]">
        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] rounded-md text-sm font-medium text-[#E6EDF3] transition-colors"
        >
          <Share2 size={14} />
          {copied ? 'Copied!' : 'Share Link'}
        </button>
      </div>

      <div className="px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#8B949E] uppercase tracking-wider">
            Online
          </span>
          <span className="text-xs text-[#8B949E]">{onlineUsers.length}</span>
        </div>
        <div className="space-y-1">
          {onlineUsers.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[#21262D] transition-colors"
            >
              <div className="relative">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-sm"
                  style={{ backgroundColor: u.color || '#58A6FF' }}
                >
                  {u.username.charAt(0).toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#3FB950] border-2 border-[#161B22]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#E6EDF3] truncate">
                  {u.username}
                  {u.id === user?.id && <span className="text-[#8B949E] ml-1">(you)</span>}
                </div>
              </div>
              <div
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                  u.permission === 'edit' || u.permission === 'owner'
                    ? 'bg-[#3FB950]/10 text-[#3FB950]'
                    : 'bg-[#8B949E]/10 text-[#8B949E]'
                }`}
              >
                {u.permission === 'owner' ? (
                  <Crown size={10} />
                ) : u.permission === 'edit' ? (
                  <Edit3 size={10} />
                ) : (
                  <Eye size={10} />
                )}
                <span className="capitalize">{u.permission}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-[#8B949E] uppercase tracking-wider">
            Chat
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#8B949E]">
              <MessageSquare size={24} className="mb-2 opacity-50" />
              <p className="text-xs">No messages yet</p>
              <p className="text-xs opacity-70">Start the conversation!</p>
            </div>
          ) : (
            chatMessages.map((msg, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#58A6FF]">
                    {msg.userId === user?.id ? 'You' : msg.username}
                  </span>
                  <span className="text-xs text-[#8B949E]">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-[#E6EDF3] pl-0">{msg.message}</p>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="p-3 border-t border-[#30363D]">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 text-sm bg-[#0D1117] border border-[#30363D] rounded-md text-[#E6EDF3] placeholder-[#8B949E] outline-none focus:border-[#58A6FF] transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="p-2 bg-[#58A6FF] hover:bg-[#4493e8] text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
