import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { X, Terminal as TerminalIcon, AlertCircle, Code2 } from 'lucide-react'
import { useSandbox } from '@/contexts/SandboxContext'

type TabType = 'terminal' | 'compile' | 'problems'

export default function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('terminal')
  const { terminalOutput, sendInput, isConnected, permission } = useSandbox()
  const isReadOnly = permission === 'read'
  const outputRef = useRef('')

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const term = new XTerminal({
      theme: {
        background: '#000000',
        foreground: '#E6EDF3',
        cursor: '#3FB950',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(63, 185, 80, 0.3)',
        black: '#0D1117',
        red: '#F85149',
        green: '#3FB950',
        yellow: '#D29922',
        blue: '#58A6FF',
        magenta: '#BC8CFF',
        cyan: '#39C5CF',
        white: '#E6EDF3',
        brightBlack: '#30363D',
        brightRed: '#FF7B72',
        brightGreen: '#56D364',
        brightYellow: '#E3B341',
        brightBlue: '#79C0FF',
        brightMagenta: '#D2A8FF',
        brightCyan: '#56D4DD',
        brightWhite: '#F0F6FC',
      },
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.6,
      cursorBlink: !isReadOnly,
      cursorStyle: isReadOnly ? 'underline' : 'block',
      scrollback: 1000,
      convertEol: true,
      allowTransparency: true,
      disableStdin: isReadOnly,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const handleResize = () => {
      fitAddon.fit()
    }
    window.addEventListener('resize', handleResize)

    term.onData((data) => {
      if (isConnected && !isReadOnly) {
        sendInput(data)
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [sendInput, isConnected])

  useEffect(() => {
    if (!xtermRef.current || terminalOutput === outputRef.current) return

    const newContent = terminalOutput.slice(outputRef.current.length)
    if (newContent) {
      xtermRef.current.write(newContent)
    }
    outputRef.current = terminalOutput
  }, [terminalOutput])

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear()
    }
  }

  const tabs = [
    { id: 'terminal' as TabType, label: 'Terminal', icon: TerminalIcon },
    { id: 'compile' as TabType, label: 'Compile Output', icon: Code2 },
    { id: 'problems' as TabType, label: 'Problems', icon: AlertCircle },
  ]

  return (
    <div className="flex flex-col h-full bg-[#161B22] border-t border-[#30363D]">
      <div className="flex items-center justify-between px-4 border-b border-[#30363D] bg-[#0D1117]">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-[#3FB950] border-[#3FB950]'
                  : 'text-[#8B949E] border-transparent hover:text-[#E6EDF3]'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="p-1.5 text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#30363D] rounded transition-colors"
            title="Clear"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'terminal' && (
          <div ref={terminalRef} className="w-full h-full" style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)' }} />
        )}
        {activeTab === 'compile' && (
          <div className="p-4 text-[#8B949E] text-sm">
            No compile output yet.
          </div>
        )}
        {activeTab === 'problems' && (
          <div className="p-4 text-[#8B949E] text-sm">
            No problems detected.
          </div>
        )}
      </div>
    </div>
  )
}
