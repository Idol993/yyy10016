import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Terminal, LogOut, Settings, ChevronRight, ChevronLeft } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'
import { useAuthStore } from '@/stores/auth'
import SandboxCard from '@/components/dashboard/SandboxCard'
import CreateSandboxModal from '@/components/dashboard/CreateSandboxModal'
import ResourceMonitor from '@/components/dashboard/ResourceMonitor'
import SnapshotTimeline from '@/components/dashboard/SnapshotTimeline'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { sandboxes, fetchSandboxes } = useSandboxStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    fetchSandboxes()
  }, [fetchSandboxes])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      <header className="h-14 panel-bg flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={20} className="text-[var(--accent-blue)]" />
          <span className="font-bold text-lg tracking-tight">SandboxOS</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--text-secondary)]">{user?.username}</span>
          <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <Settings size={16} />
          </button>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-red)] transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold">My Sandboxes</h1>
            <button
              onClick={() => setModalOpen(true)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/80 transition-colors flex items-center gap-1.5"
            >
              <Plus size={14} />
              Create
            </button>
          </div>

          {sandboxes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Terminal size={48} className="text-[var(--border)] mb-4" />
              <p className="text-[var(--text-secondary)] mb-4">No sandboxes yet</p>
              <button
                onClick={() => setModalOpen(true)}
                className="px-4 py-2 rounded text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/80 transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} />
                Create your first sandbox
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sandboxes.map((sandbox) => (
                <SandboxCard key={sandbox.id} sandbox={sandbox} />
              ))}
            </div>
          )}
        </main>

        <div
          className={`shrink-0 border-l border-[var(--border)] bg-[var(--bg-secondary)] transition-all duration-300 ${
            sidebarOpen ? 'w-72' : 'w-0'
          } overflow-hidden`}
        >
          <div className="w-72 p-4 space-y-4 h-full overflow-y-auto">
            <ResourceMonitor />
            <SnapshotTimeline />
          </div>
        </div>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="shrink-0 w-6 flex items-center justify-center bg-[var(--bg-secondary)] border-l border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          {sidebarOpen ? (
            <ChevronRight size={14} className="text-[var(--text-secondary)]" />
          ) : (
            <ChevronLeft size={14} className="text-[var(--text-secondary)]" />
          )}
        </button>
      </div>

      <CreateSandboxModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
