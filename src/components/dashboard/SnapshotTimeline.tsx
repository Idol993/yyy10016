import { RotateCcw, Clock } from 'lucide-react'
import { useFileStore } from '@/stores/files'

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SnapshotTimeline() {
  const { snapshots, rollbackSnapshot } = useFileStore()
  const recentSnapshots = snapshots.slice(0, 5)

  return (
    <div className="panel-bg rounded-lg p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Recent Snapshots</h3>

      {recentSnapshots.length === 0 ? (
        <div className="text-xs text-[var(--text-secondary)] text-center py-4">No snapshots yet</div>
      ) : (
        <div className="relative pl-4">
          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[var(--border)]" />
          <div className="space-y-3">
            {recentSnapshots.map((snapshot) => (
              <div key={snapshot.id} className="relative flex items-start gap-2">
                <div className="absolute left-[-11px] top-1.5 w-2.5 h-2.5 rounded-full bg-[var(--accent-blue)] border-2 border-[var(--bg-secondary)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--text-primary)] truncate">{snapshot.label}</div>
                  <div className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] mt-0.5">
                    <Clock size={10} />
                    {formatTime(snapshot.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => rollbackSnapshot(snapshot.sandbox_id, snapshot.id)}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors shrink-0"
                  title="Rollback"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshots.length > 5 && (
        <button className="mt-3 text-xs text-[var(--accent-blue)] hover:underline w-full text-center">
          View All
        </button>
      )}
    </div>
  )
}
