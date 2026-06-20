import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'
import { LANGUAGES } from '@/utils/languages'
import type { Language } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

const languageEntries = Object.entries(LANGUAGES) as [Language, (typeof LANGUAGES)[Language]][]

export default function CreateSandboxModal({ open, onClose }: Props) {
  const { createSandbox } = useSandboxStore()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState<Language>('python')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await createSandbox(name.trim(), language)
      onClose()
      setName('')
      setLanguage('python')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative card-bg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create Sandbox</h2>

        <div className="mb-4">
          <label className="block text-sm text-[var(--text-secondary)] mb-1.5">Sandbox Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-sandbox"
            className="w-full px-3 py-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-colors text-sm"
          />
        </div>

        <div className="mb-5">
          <label className="block text-sm text-[var(--text-secondary)] mb-1.5">Language</label>
          <div className="grid grid-cols-2 gap-2">
            {languageEntries.map(([key, config]) => (
              <button
                key={key}
                onClick={() => setLanguage(key)}
                className={`p-3 rounded border text-left transition-all ${
                  language === key
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10'
                    : 'border-[var(--border)] bg-[var(--bg-tertiary)] hover:border-[var(--text-secondary)]'
                }`}
              >
                <span className="text-lg">{config.icon}</span>
                <div className="text-sm font-medium text-[var(--text-primary)] mt-1">{config.name}</div>
                <div className="text-xs text-[var(--text-secondary)]">{config.runCommand.split(' ')[0]}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="px-4 py-2 rounded text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} />
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
