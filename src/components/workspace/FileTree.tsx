import { useState, useMemo } from 'react'
import { File, Folder, FolderOpen, Plus, Trash2, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import { useFileStore } from '@/stores/files'
import { useSandboxStore } from '@/stores/sandbox'
import { useSandbox } from '@/contexts/SandboxContext'
import type { FileNode } from '@/types'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  node?: FileNode
}

const fileColors: Record<string, string> = {
  py: '#3FB950',
  js: '#F7DF1E',
  cpp: '#00599C',
  rs: '#DEA584',
  json: '#CBCB41',
  md: '#519ABA',
}

function buildTree(files: FileNode[]): TreeNode[] {
  const root: TreeNode[] = []
  const map = new Map<string, TreeNode>()

  for (const file of files) {
    if (file.path === '/') continue
    const parts = file.path.split('/').filter(Boolean)
    let currentPath = ''
    let parentArray = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`
      const isLast = i === parts.length - 1

      if (map.has(currentPath)) {
        const existing = map.get(currentPath)!
        if (isLast) {
          existing.node = file
          existing.type = file.type
        }
        parentArray = existing.children || []
        continue
      }

      const newNode: TreeNode = {
        name: part,
        path: currentPath,
        type: isLast ? file.type : 'directory',
        children: isLast ? undefined : [],
        node: isLast ? file : undefined,
      }

      map.set(currentPath, newNode)
      parentArray.push(newNode)

      if (!isLast) {
        parentArray = newNode.children!
      }
    }
  }

  return sortTree(root)
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type === 'directory' && b.type === 'file') return -1
    if (a.type === 'file' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return fileColors[ext] || '#8B949E'
}

interface TreeItemProps {
  node: TreeNode
  depth: number
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
  onFileClick: (file: FileNode) => void
  onDelete: (path: string) => void
  currentPath: string | null
  isReadOnly: boolean
}

function TreeItem({ node, depth, expandedDirs, toggleDir, onFileClick, onDelete, currentPath, isReadOnly }: TreeItemProps) {
  const isExpanded = expandedDirs.has(node.path)
  const isActive = currentPath === node.path && node.type === 'file'

  const handleClick = () => {
    if (node.type === 'directory') {
      toggleDir(node.path)
    } else if (node.node) {
      onFileClick(node.node)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isReadOnly) onDelete(node.path)
  }

  return (
    <div className="group">
      <div
        onClick={handleClick}
        className={`flex items-center gap-1 py-1 px-2 cursor-pointer text-sm transition-colors
          ${isActive ? 'bg-[#58A6FF]/20 text-[#58A6FF]' : 'text-[#E6EDF3] hover:bg-[#30363D]/30'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.type === 'directory' ? (
          isExpanded ? (
            <ChevronDown size={14} className="text-[#8B949E] shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-[#8B949E] shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {node.type === 'directory' ? (
          isExpanded ? (
            <FolderOpen size={16} className="text-[#D29922] shrink-0" />
          ) : (
            <Folder size={16} className="text-[#D29922] shrink-0" />
          )
        ) : (
          <File size={16} className="shrink-0" style={{ color: getFileColor(node.name) }} />
        )}
        <span className="truncate flex-1">{node.name}</span>
        {!isReadOnly && (
          <button
            onClick={handleDelete}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#30363D] text-[#8B949E] hover:text-[#F85149] transition-all"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="relative">
          <div
            className="absolute left-0 top-0 bottom-0 w-px bg-[#30363D]"
            style={{ left: `${depth * 16 + 16}px` }}
          />
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              onFileClick={onFileClick}
              onDelete={onDelete}
              currentPath={currentPath}
              isReadOnly={isReadOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree() {
  const { files, currentFile, fetchFiles, addOpenFile, setCurrentFile, createFile, deleteFile } = useFileStore()
  const { currentSandbox } = useSandboxStore()
  const { permission } = useSandbox()
  const isReadOnly = permission === 'read'
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/src']))
  const [showNewFile, setShowNewFile] = useState(false)
  const [showNewDir, setShowNewDir] = useState(false)
  const [newName, setNewName] = useState('')

  const tree = useMemo(() => buildTree(files), [files])

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleFileClick = async (file: FileNode) => {
    if (!currentSandbox) return
    addOpenFile(file)
    setCurrentFile(file)
    if (!file.content) {
      await useFileStore.getState().fetchFileContent(currentSandbox.id, file.path)
    }
  }

  const handleRefresh = () => {
    if (currentSandbox) {
      fetchFiles(currentSandbox.id)
    }
  }

  const handleCreateFile = async () => {
    if (!currentSandbox || !newName.trim() || isReadOnly) return
    await createFile(currentSandbox.id, '/', newName.trim(), 'file')
    await fetchFiles(currentSandbox.id)
    setNewName('')
    setShowNewFile(false)
  }

  const handleCreateDir = async () => {
    if (!currentSandbox || !newName.trim() || isReadOnly) return
    await createFile(currentSandbox.id, '/', newName.trim(), 'directory')
    await fetchFiles(currentSandbox.id)
    setNewName('')
    setShowNewDir(false)
  }

  const handleDelete = async (path: string) => {
    if (!currentSandbox || isReadOnly) return
    await deleteFile(currentSandbox.id, path)
  }

  return (
    <div className="h-full flex flex-col bg-[#161B22] border-r border-[#30363D]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363D]">
        <span className="text-xs font-medium text-[#8B949E] uppercase tracking-wider">Explorer</span>
        <div className="flex items-center gap-0.5">
          {!isReadOnly && (
            <>
              <button
                onClick={() => { setShowNewFile(true); setShowNewDir(false); setNewName('') }}
                className="p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                title="New File"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => { setShowNewDir(true); setShowNewFile(false); setNewName('') }}
                className="p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                title="New Folder"
              >
                <Folder size={14} />
              </button>
            </>
          )}
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {showNewFile && (
          <div className="px-2 py-1">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFile()
                if (e.key === 'Escape') { setShowNewFile(false); setNewName('') }
              }}
              onBlur={() => { setShowNewFile(false); setNewName('') }}
              placeholder="filename"
              className="w-full px-2 py-1 text-sm bg-[#0D1117] border border-[#58A6FF] rounded text-[#E6EDF3] outline-none"
            />
          </div>
        )}
        {showNewDir && (
          <div className="px-2 py-1">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateDir()
                if (e.key === 'Escape') { setShowNewDir(false); setNewName('') }
              }}
              onBlur={() => { setShowNewDir(false); setNewName('') }}
              placeholder="folder name"
              className="w-full px-2 py-1 text-sm bg-[#0D1117] border border-[#58A6FF] rounded text-[#E6EDF3] outline-none"
            />
          </div>
        )}
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            onFileClick={handleFileClick}
            onDelete={handleDelete}
            currentPath={currentFile?.path || null}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  )
}
