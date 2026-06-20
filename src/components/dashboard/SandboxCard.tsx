import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, Trash2 } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'
import { LANGUAGES } from '@/utils/languages'
import type { Sandbox, SandboxStatus } from '@/types'

const statusConfig: Record<SandboxStatus, { label: string; color: string; dot: string }> = {
  running: { label: 'Running', color: 'text-[#3FB950]', dot: 'bg-[#3FB950]' },
  stopped: { label: 'Stopped', color: 'text-[#8B949E]', dot: 'bg-[#8B949E]' },
  error: { label: 'Error', color: 'text-[#F85149]', dot: 'bg-[#F85149]' },
  starting: { label: 'Starting', color: 'text-[#D29922]', dot: 'bg-[#D29922]' },
  stopping: { label: 'Stopping', color: 'text-[#D29922]', dot: 'bg-[#D29922]' },
}

function formatTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function SandboxCard({ sandbox }: { sandbox: Sandbox }) {
  const navigate = useNavigate()
  const { startSandbox, stopSandbox, deleteSandbox } = useSandboxStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const lang = LANGUAGES[sandbox.language]
  const status = statusConfig[sandbox.status]

  const handleAction = (e: React.MouseEvent, action: () => Promise<void>) => {
    e.stopPropagation()
    action()
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete) {
      deleteSandbox(sandbox.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div
      onClick={() => navigate(`/workspace/${sandbox.id}`)}
      className="group card-bg p-4 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-[rgba(88,166,255,0.1)] hover:border-[#58A6FF]/30 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{lang.icon}</span>
          <h3 className="font-semibold text-[var(--text-primary)] truncate">{sandbox.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className={`w-2 h-2 rounded-full ${status.dot} ${sandbox.status === 'running' ? 'pulse-dot' : ''}`} />
          <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
        </div>
      </div>

      <div className="text-xs text-[var(--text-secondary)] mb-3">
        {lang.name} · {formatTime(sandbox.last_active_at)}
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="w-8">CPU</span>
          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)]">
            <div
              className="h-full rounded-full bg-[var(--accent-blue)] transition-all"
              style={{ width: `${Math.min(sandbox.cpu_limit_percent, 100)}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="w-8">MEM</span>
          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)]">
            <div
              className="h-full rounded-full bg-[var(--accent-green)] transition-all"
              style={{ width: `${Math.min((sandbox.memory_limit_mb / 512) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {sandbox.status === 'running' ? (
          <button
            onClick={(e) => handleAction(e, () => stopSandbox(sandbox.id))}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-yellow)] transition-colors"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={(e) => handleAction(e, () => startSandbox(sandbox.id))}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-green)] transition-colors"
          >
            <Play size={14} />
          </button>
        )}
        <button
          onClick={handleDelete}
          className={`p-1.5 rounded transition-colors ${
            confirmDelete
              ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]'
              : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-red)]'
          }`}
        >
          <Trash2 size={14} />
        </button>
        {confirmDelete && <span className="text-xs text-[var(--accent-red)]">Confirm?</span>}
      </div>
    </div>
  )
}
