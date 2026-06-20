import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useSandboxWS, type UseSandboxWSReturn } from '@/hooks/useSandboxWS'

const SandboxContext = createContext<UseSandboxWSReturn | null>(null)

export function SandboxProvider({ sandboxId, children }: { sandboxId: number | null; children: ReactNode }) {
  const ws = useSandboxWS(sandboxId)

  const value = useMemo(() => ws, [ws])

  return (
    <SandboxContext.Provider value={value}>
      {children}
    </SandboxContext.Provider>
  )
}

export function useSandbox(): UseSandboxWSReturn {
  const context = useContext(SandboxContext)
  if (!context) {
    throw new Error('useSandbox must be used within a SandboxProvider')
  }
  return context
}
