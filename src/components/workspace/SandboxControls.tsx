import { Play, Square, RotateCw, Cpu, MemoryStick, HardDrive } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'
import { useSandbox } from '@/contexts/SandboxContext'
import { LANGUAGES } from '@/utils/languages'

export default function SandboxControls() {
  const { currentSandbox, startSandbox, stopSandbox, metrics } = useSandboxStore()
  const { sendRun, isConnected, permission } = useSandbox()
  const isReadOnly = permission === 'read'

  const statusConfig = {
    running: { color: 'bg-[#3FB950]', label: 'Running', pulse: true },
    starting: { color: 'bg-[#D29922]', label: 'Starting', pulse: true },
    stopping: { color: 'bg-[#D29922]', label: 'Stopping', pulse: true },
    stopped: { color: 'bg-[#8B949E]', label: 'Stopped', pulse: false },
    error: { color: 'bg-[#F85149]', label: 'Error', pulse: false },
  }

  const status = currentSandbox?.status ?? 'stopped'
  const config = statusConfig[status]

  const handleStart = () => {
    if (currentSandbox) {
      startSandbox(currentSandbox.id)
    }
  }

  const handleStop = () => {
    if (currentSandbox) {
      stopSandbox(currentSandbox.id)
    }
  }

  const handleRestart = () => {
    if (currentSandbox) {
      stopSandbox(currentSandbox.id).then(() => {
        startSandbox(currentSandbox.id)
      })
    }
  }

  const handleRun = () => {
    if (currentSandbox && isConnected && !isReadOnly) {
      sendRun()
    }
  }

  const resourceBars = [
    { label: 'CPU', value: metrics?.cpu ?? 0, icon: Cpu, color: 'bg-[#58A6FF]' },
    { label: 'Memory', value: metrics?.memory ?? 0, icon: MemoryStick, color: 'bg-[#3FB950]' },
    { label: 'Disk', value: metrics?.disk ?? 0, icon: HardDrive, color: 'bg-[#D29922]' },
  ]

  const language = currentSandbox ? LANGUAGES[currentSandbox.language] : null

  return (
    <div className="flex flex-col gap-4 p-4 bg-[#161B22] border border-[#30363D] rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className={`w-2.5 h-2.5 rounded-full ${config.color} ${config.pulse ? 'pulse-dot' : ''}`} />
            {config.pulse && (
              <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${config.color} animate-ping opacity-40`} />
            )}
          </div>
          <span className="text-sm font-medium text-[#E6EDF3]">{config.label}</span>
        </div>

        {language && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-[#21262D] rounded-md border border-[#30363D]">
            <span className="text-sm">{language.icon}</span>
            <span className="text-xs font-medium text-[#E6EDF3]">{language.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleStart}
          disabled={status === 'running' || status === 'starting' || isReadOnly}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-[#30363D] bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Start"
        >
          <Play size={16} />
        </button>
        <button
          onClick={handleStop}
          disabled={status === 'stopped' || status === 'stopping' || isReadOnly}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-[#30363D] bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Stop"
        >
          <Square size={16} />
        </button>
        <button
          onClick={handleRestart}
          disabled={isReadOnly}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-[#30363D] bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Restart"
        >
          <RotateCw size={16} />
        </button>

        <div className="flex-1" />

        {isReadOnly && (
          <span className="text-xs text-[#F85149] font-medium px-2 py-1 bg-[#21262D] rounded-md border border-[#F85149]/30">
            Read-Only
          </span>
        )}

        <button
          onClick={handleRun}
          disabled={!isConnected || status !== 'running' || isReadOnly}
          className="flex items-center gap-2 px-4 py-2 bg-[#3FB950] hover:bg-[#2EA043] text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed glow-green"
        >
          <Play size={16} fill="currentColor" />
          Run
        </button>
      </div>

      <div className="space-y-3 pt-2 border-t border-[#30363D]">
        {resourceBars.map((bar) => (
          <div key={bar.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <bar.icon size={12} className="text-[#8B949E]" />
                <span className="text-xs text-[#8B949E]">{bar.label}</span>
              </div>
              <span className="text-xs font-medium text-[#E6EDF3]">{Math.round(bar.value)}%</span>
            </div>
            <div className="h-1.5 bg-[#21262D] rounded-full overflow-hidden">
              <div
                className={`h-full ${bar.color} rounded-full transition-all duration-300`}
                style={{ width: `${Math.min(Math.max(bar.value, 0), 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
