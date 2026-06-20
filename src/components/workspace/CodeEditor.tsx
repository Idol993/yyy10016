import { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useFileStore } from '@/stores/files'
import { useSandboxStore } from '@/stores/sandbox'
import { useAuthStore } from '@/stores/auth'
import { useSandbox } from '@/contexts/SandboxContext'
import { LANGUAGES } from '@/utils/languages'
import type { FileNode } from '@/types'
import type { editor } from 'monaco-editor'

function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.extension === `.${ext}`) {
      return lang.monacoLanguage
    }
  }
  const extMap: Record<string, string> = {
    json: 'json',
    md: 'markdown',
    txt: 'plaintext',
  }
  return extMap[ext] || 'plaintext'
}

function getLanguageName(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  for (const lang of Object.values(LANGUAGES)) {
    if (lang.extension === `.${ext}`) {
      return lang.name
    }
  }
  const nameMap: Record<string, string> = {
    json: 'JSON',
    md: 'Markdown',
    txt: 'Plain Text',
  }
  return nameMap[ext] || ext.toUpperCase()
}

interface RemoteCursor {
  userId: number
  username: string
  color: string
  position: { lineNumber: number; column: number }
}

export default function CodeEditor() {
  const { openFiles, currentFile, setCurrentFile, removeOpenFile, saveFile } = useFileStore()
  const { currentSandbox } = useSandboxStore()
  const { user } = useAuthStore()
  const { ydoc, users, sendEdit, sendCursor, isConnected, permission } = useSandbox()
  const isReadOnly = permission === 'read'

  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([])
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const isApplyingRemoteChange = useRef(false)
  const decorationsRef = useRef<string[]>([])
  const yTextMap = useRef<Map<string, import('yjs').Text>>(new Map())
  const contentSynced = useRef<Set<string>>(new Set())

  const getYText = useCallback((path: string) => {
    if (!ydoc) return null
    if (!yTextMap.current.has(path)) {
      const ytext = ydoc.getText(`file:${path}`)
      yTextMap.current.set(path, ytext)
    }
    return yTextMap.current.get(path)!
  }, [ydoc])

  const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = editor
    monacoRef.current = monaco

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        line: e.position.lineNumber,
        column: e.position.column,
      })
      if (currentFile && isConnected) {
        sendCursor(currentFile.path, e.position.lineNumber, e.position.column)
      }
    })

    editor.onDidChangeModelContent(() => {
      if (isApplyingRemoteChange.current || !currentFile || !ydoc || !isConnected) return

      const ytext = getYText(currentFile.path)
      if (!ytext) return

      const model = editor.getModel()
      if (!model) return

      const newValue = model.getValue()
      const ytextValue = ytext.toString()

      if (newValue !== ytextValue) {
        isApplyingRemoteChange.current = true
        ytext.delete(0, ytext.length)
        ytext.insert(0, newValue)
        isApplyingRemoteChange.current = false

        const update = import('yjs').then((Y) => {
          const updateArr = Y.encodeStateAsUpdate(ydoc)
          sendEdit(updateArr)
        })
      }
    })
  }

  useEffect(() => {
    if (!currentFile || !ydoc) return

    const ytext = getYText(currentFile.path)
    if (!ytext) return

    if (!contentSynced.current.has(currentFile.path)) {
      const initialContent = currentFile.content || ''
      if (ytext.length === 0 && initialContent) {
        ytext.insert(0, initialContent)
      }
      contentSynced.current.add(currentFile.path)
    }

    const observer = () => {
      if (!editorRef.current || isApplyingRemoteChange.current) return

      const model = editorRef.current.getModel()
      if (!model) return

      const ytextValue = ytext.toString()
      const currentValue = model.getValue()

      if (ytextValue !== currentValue) {
        isApplyingRemoteChange.current = true
        model.setValue(ytextValue)
        isApplyingRemoteChange.current = false
      }
    }

    ytext.observe(observer)

    return () => {
      ytext.unobserve(observer)
    }
  }, [currentFile, ydoc, getYText])

  useEffect(() => {
    if (!currentFile || !editorRef.current) return

    const ytext = getYText(currentFile.path)
    if (!ytext) return

    const ytextValue = ytext.toString()
    const model = editorRef.current.getModel()
    if (model && ytext.length > 0 && model.getValue() !== ytextValue) {
      isApplyingRemoteChange.current = true
      model.setValue(ytextValue)
      isApplyingRemoteChange.current = false
    }
  }, [currentFile?.path, ydoc, getYText])

  useEffect(() => {
    if (!currentFile || !monacoRef.current || !editorRef.current) {
      setRemoteCursors([])
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current

    const remotes: RemoteCursor[] = []
    for (const u of users) {
      if (u.id === user?.id) continue
      if (u.cursor?.path !== currentFile.path) continue
      remotes.push({
        userId: u.id,
        username: u.username,
        color: u.color,
        position: {
          lineNumber: u.cursor.line,
          column: u.cursor.column,
        },
      })
    }

    setRemoteCursors(remotes)

    const newDecorations: editor.IModelDeltaDecoration[] = remotes.map((rc) => ({
      range: new monaco.Range(
        rc.position.lineNumber,
        rc.position.column,
        rc.position.lineNumber,
        rc.position.column
      ),
      options: {
        isWholeLine: false,
        className: 'remote-cursor',
        beforeContentClassName: 'remote-cursor-before',
        hoverMessage: { value: rc.username },
      },
    }))

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations)
  }, [users, currentFile?.path, user?.id])

  const handleTabClick = (file: FileNode) => {
    setCurrentFile(file)
  }

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    removeOpenFile(path)
  }

  const handleSave = useCallback(async () => {
    if (!currentSandbox || !currentFile || isReadOnly) return
    const content = editorRef.current?.getValue() || currentFile.content || ''
    await saveFile(currentSandbox.id, currentFile.path, content)
  }, [currentSandbox, currentFile, saveFile, isReadOnly])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (!isReadOnly) handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, isReadOnly])

  const language = currentFile ? getMonacoLanguage(currentFile.name) : 'plaintext'
  const languageName = currentFile ? getLanguageName(currentFile.name) : ''

  return (
    <div className="h-full flex flex-col bg-[#0D1117]">
      <style>{`
        .remote-cursor {
          border-left: 2px solid;
          margin-left: -1px;
          position: relative;
        }
        .remote-cursor-before {
          position: absolute;
          top: -20px;
          left: -2px;
          font-size: 10px;
          padding: 2px 4px;
          border-radius: 2px;
          color: white;
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
        }
      `}</style>

      <div className="flex items-center bg-[#161B22] border-b border-[#30363D] overflow-x-auto">
        {openFiles.map((file) => {
          const isActive = currentFile?.path === file.path
          return (
            <div
              key={file.path}
              onClick={() => handleTabClick(file)}
              className={`flex items-center gap-2 px-3 py-2 border-r border-[#30363D] cursor-pointer text-sm whitespace-nowrap transition-colors
                ${isActive ? 'bg-[#0D1117] text-[#E6EDF3]' : 'bg-[#161B22] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D]'}`}
            >
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button
                onClick={(e) => handleCloseTab(e, file.path)}
                className="p-0.5 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {isConnected && (
          <div className="ml-auto px-3 py-2 text-xs text-[#3FB950] flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#3FB950]" />
            协作中
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        {currentFile ? (
          <>
            <Editor
              height="100%"
              theme="vs-dark"
              language={language}
              value={currentFile.content || ''}
              onMount={handleEditorDidMount}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                padding: { top: 8, bottom: 8 },
                readOnly: isReadOnly,
                domReadOnly: isReadOnly,
                renderValidationDecorations: 'on',
              }}
            />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {remoteCursors.map((rc) => (
                <RemoteCursorLabel key={rc.userId} cursor={rc} editor={editorRef.current} />
              ))}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[#8B949E]">
            <div className="text-center">
              <p className="text-lg mb-2">No file open</p>
              <p className="text-sm">Select a file from the explorer to start editing</p>
            </div>
          </div>
        )}
      </div>

      {currentFile && (
        <div className="flex items-center justify-between px-3 py-1 bg-[#161B22] border-t border-[#30363D] text-xs text-[#8B949E]">
          <span>{languageName}</span>
          <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
        </div>
      )}
    </div>
  )
}

function RemoteCursorLabel({ cursor, editor }: { cursor: RemoteCursor; editor: editor.IStandaloneCodeEditor | null }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!editor) return

    const updatePosition = () => {
      const model = editor.getModel()
      if (!model) return

      const position_ = editor.getScrolledVisiblePosition({
        lineNumber: cursor.position.lineNumber,
        column: cursor.position.column,
      })

      if (position_) {
        setPosition({ top: position_.top, left: position_.left })
      }
    }

    updatePosition()
    const disposable = editor.onDidScrollChange(updatePosition)

    return () => {
      disposable.dispose()
    }
  }, [cursor.position, editor])

  if (!position) return null

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateY(-100%)',
      }}
    >
      <div
        className="px-1.5 py-0.5 text-[10px] font-medium text-white rounded-sm whitespace-nowrap"
        style={{ backgroundColor: cursor.color }}
      >
        {cursor.username}
      </div>
      <div
        className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent"
        style={{ borderTopColor: cursor.color }}
      />
    </div>
  )
}
