import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Users, Settings } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'
import { useFileStore } from '@/stores/files'
import { useAuthStore } from '@/stores/auth'
import { SandboxProvider } from '@/contexts/SandboxContext'
import FileTree from '@/components/workspace/FileTree'
import CodeEditor from '@/components/workspace/CodeEditor'
import Terminal from '@/components/workspace/Terminal'
import SandboxControls from '@/components/workspace/SandboxControls'
import CollabPanel from '@/components/workspace/CollabPanel'
import { LANGUAGES } from '@/utils/languages'

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { sandboxes, fetchSandboxes, startSandbox, setCurrentSandbox, currentSandbox } = useSandboxStore()
  const { fetchFiles } = useFileStore()
  const { user } = useAuthStore()

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [collabOpen, setCollabOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [terminalHeight, setTerminalHeight] = useState(250)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingTerminal, setIsResizingTerminal] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const sandboxId = id ? parseInt(id, 10) : null
  const sandbox = sandboxes.find((s) => s.id === sandboxId) || currentSandbox
  const language = sandbox ? LANGUAGES[sandbox.language] : null

  const statusConfig = {
    running: { color: 'bg-[#3FB950]', label: 'Running', pulse: true },
    starting: { color: 'bg-[#D29922]', label: 'Starting', pulse: true },
    stopping: { color: 'bg-[#D29922]', label: 'Stopping', pulse: true },
    stopped: { color: 'bg-[#8B949E]', label: 'Stopped', pulse: false },
    error: { color: 'bg-[#F85149]', label: 'Error', pulse: false },
  }

  const status = sandbox?.status ?? 'stopped'
  const statusInfo = statusConfig[status]

  useEffect(() => {
    fetchSandboxes()
  }, [fetchSandboxes])

  useEffect(() => {
    if (sandbox) {
      setCurrentSandbox(sandbox)
      fetchFiles(sandbox.id)
      if (sandbox.status === 'stopped') {
        startSandbox(sandbox.id)
      }
    }
  }, [sandbox, setCurrentSandbox, fetchFiles, startSandbox])

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingSidebar(true)
  }, [])

  const handleTerminalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingTerminal(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const newWidth = e.clientX - rect.left
        setSidebarWidth(Math.max(180, Math.min(400, newWidth)))
      }
      if (isResizingTerminal && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const newHeight = rect.bottom - e.clientY
        setTerminalHeight(Math.max(100, Math.min(500, newHeight)))
      }
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
      setIsResizingTerminal(false)
    }

    if (isResizingSidebar || isResizingTerminal) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingSidebar, isResizingTerminal])

  const handleBack = () => {
    navigate('/dashboard')
  }

  return (
    <SandboxProvider sandboxId={sandboxId}>
      {!sandbox ? (
        <div className="h-screen bg-[#0D1117] text-[#E6EDF3] flex items-center justify-center">
          <div className="text-[#8B949E]">Loading sandbox...</div>
        </div>
      ) : (
        <div ref={containerRef} className="h-screen bg-[#0D1117] text-[#E6EDF3] flex flex-col overflow-hidden">
      <header className="h-[50px] bg-[#161B22] border-b border-[#30363D] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-[#E6EDF3]">{sandbox.name}</h1>
            {language && (
              <span className="px-2 py-0.5 text-xs font-medium bg-[#21262D] text-[#8B949E] rounded border border-[#30363D]">
                {language.name}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <div className={`w-2 h-2 rounded-full ${statusInfo.color} ${statusInfo.pulse ? 'pulse-dot' : ''}`} />
                {statusInfo.pulse && (
                  <div className={`absolute inset-0 w-2 h-2 rounded-full ${statusInfo.color} animate-ping opacity-40`} />
                )}
              </div>
              <span className="text-xs text-[#8B949E]">{statusInfo.label}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollabOpen(!collabOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              collabOpen
                ? 'bg-[#58A6FF]/20 text-[#58A6FF] border border-[#58A6FF]/30'
                : 'bg-[#21262D] text-[#E6EDF3] border border-[#30363D] hover:bg-[#30363D]'
            }`}
          >
            <Users size={14} />
            Collab
          </button>
          <button
            className="p-1.5 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <div className="w-8 h-8 rounded-full bg-[#58A6FF] flex items-center justify-center text-white font-medium text-sm">
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div
          className={`shrink-0 bg-[#161B22] border-r border-[#30363D] flex flex-col transition-all duration-200 ${
            sidebarOpen ? '' : 'w-0 overflow-hidden'
          }`}
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        >
          <div className="flex-1 overflow-hidden">
            <FileTree />
          </div>
          <div className="border-t border-[#30363D] p-3">
            <SandboxControls />
          </div>
        </div>

        {sidebarOpen && (
          <div
            onMouseDown={handleSidebarMouseDown}
            className={`w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-[#58A6FF] transition-colors ${
              isResizingSidebar ? 'bg-[#58A6FF]' : ''
            }`}
          />
        )}

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="shrink-0 w-6 flex items-center justify-center bg-[#161B22] border-r border-[#30363D] hover:bg-[#21262D] transition-colors"
        >
          {sidebarOpen ? (
            <ChevronLeft size={14} className="text-[#8B949E]" />
          ) : (
            <ChevronRight size={14} className="text-[#8B949E]" />
          )}
        </button>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <CodeEditor />
          </div>

          {terminalOpen && (
            <div
              onMouseDown={handleTerminalMouseDown}
              className={`h-1 cursor-row-resize bg-transparent hover:bg-[#58A6FF] transition-colors ${
                isResizingTerminal ? 'bg-[#58A6FF]' : ''
              }`}
            />
          )}

          {terminalOpen ? (
            <div className="shrink-0 bg-[#161B22] border-t border-[#30363D]" style={{ height: terminalHeight }}>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#30363D]">
                <span className="text-xs font-medium text-[#8B949E] uppercase tracking-wider">Terminal</span>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="p-0.5 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                  title="Hide Terminal"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="h-[calc(100%-32px)]">
                <Terminal />
              </div>
            </div>
          ) : (
            <button
              onClick={() => setTerminalOpen(true)}
              className="shrink-0 h-6 flex items-center justify-center bg-[#161B22] border-t border-[#30363D] hover:bg-[#21262D] transition-colors"
            >
              <ChevronUp size={14} className="text-[#8B949E]" />
            </button>
          )}
        </div>

        {collabOpen && (
          <div className="shrink-0 w-[280px] border-l border-[#30363D] bg-[#161B22]">
            <CollabPanel onClose={() => setCollabOpen(false)} />
          </div>
        )}
      </div>
    </div>
      )}
    </SandboxProvider>
  )
}
