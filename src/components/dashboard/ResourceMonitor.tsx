import { Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { useSandboxStore } from '@/stores/sandbox'

function Gauge({ value, label, icon: Icon, color }: { value: number; label: string; icon: React.ElementType; color: string }) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const angle = (clamped / 100) * 360

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-16 h-16 rounded-full"
        style={{ background: `conic-gradient(${color} ${angle}deg, var(--bg-tertiary) ${angle}deg)` }}
      >
        <div className="absolute inset-2 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--text-secondary)]" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{Math.round(value)}%</div>
        <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      </div>
    </div>
  )
}

export default function ResourceMonitor() {
  const { metrics, sandboxes } = useSandboxStore()
  const cpu = metrics?.cpu ?? 0
  const memory = metrics?.memory ?? 0
  const disk = metrics?.disk ?? 0
  const activeCount = sandboxes.filter((s) => s.status === 'running').length

  return (
    <div className="panel-bg rounded-lg p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">System Resources</h3>

      <div className="flex justify-around mb-4">
        <Gauge value={cpu} label="CPU" icon={Cpu} color="var(--accent-blue)" />
        <Gauge value={memory} label="Memory" icon={MemoryStick} color="var(--accent-green)" />
        <Gauge value={disk} label="Disk" icon={HardDrive} color="var(--accent-yellow)" />
      </div>

      <div className="space-y-2 pt-3 border-t border-[var(--border)]">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--text-secondary)]">Active Sandboxes</span>
          <span className="text-[var(--text-primary)] font-medium">{activeCount}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-2 h-2 rounded-full bg-[var(--accent-green)] pulse-dot" />
          <span className="text-[var(--text-secondary)]">Pool:</span>
          <span className="text-[var(--accent-green)] font-medium">Ready</span>
        </div>
      </div>
    </div>
  )
}
