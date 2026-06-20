import { create } from 'zustand'
import type { FileNode, Snapshot } from '@/types'
import { apiGet, apiPost, apiPut, apiDelete } from '@/utils/api'
import type { ApiResponse } from '@/utils/api'

interface FileState {
  files: FileNode[]
  currentFile: FileNode | null
  openFiles: FileNode[]
  snapshots: Snapshot[]
  fetchFiles: (sandboxId: number, path?: string) => Promise<void>
  fetchFileContent: (sandboxId: number, path: string) => Promise<void>
  saveFile: (sandboxId: number, path: string, content: string) => Promise<void>
  createFile: (sandboxId: number, path: string, name: string, type: 'file' | 'directory') => Promise<void>
  deleteFile: (sandboxId: number, path: string) => Promise<void>
  createSnapshot: (sandboxId: number, label: string) => Promise<void>
  fetchSnapshots: (sandboxId: number) => Promise<void>
  rollbackSnapshot: (sandboxId: number, snapshotId: number) => Promise<void>
  setCurrentFile: (file: FileNode | null) => void
  addOpenFile: (file: FileNode) => void
  removeOpenFile: (path: string) => void
}

export const useFileStore = create<FileState>()((set, get) => ({
  files: [],
  currentFile: null,
  openFiles: [],
  snapshots: [],

  fetchFiles: async (sandboxId: number, path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}&all=true` : '?all=true'
    const response = await apiGet<ApiResponse & { files: FileNode[] }>(`/sandboxes/${sandboxId}/files${query}`)
    set({ files: response.files })
  },

  fetchFileContent: async (sandboxId: number, path: string) => {
    const query = `?path=${encodeURIComponent(path)}`
    const response = await apiGet<ApiResponse & { content: string; node: FileNode }>(`/sandboxes/${sandboxId}/files/content${query}`)
    const node = { ...response.node, content: response.content }
    set({ currentFile: node })
  },

  saveFile: async (sandboxId: number, path: string, content: string) => {
    const response = await apiPut<ApiResponse & { node: FileNode }>(`/sandboxes/${sandboxId}/files/content`, { path, content })
    const updatedNode = { ...response.node, content }
    set((state) => ({
      currentFile: state.currentFile?.path === path ? updatedNode : state.currentFile,
      openFiles: state.openFiles.map((f) =>
        f.path === path ? updatedNode : f
      ),
    }))
  },

  createFile: async (sandboxId: number, path: string, name: string, type: 'file' | 'directory') => {
    const response = await apiPost<ApiResponse & { node: FileNode }>(`/sandboxes/${sandboxId}/files`, { path, name, type })
    set((state) => ({ files: [...state.files, response.node] }))
  },

  deleteFile: async (sandboxId: number, path: string) => {
    const query = `?path=${encodeURIComponent(path)}`
    const response = await apiDelete<ApiResponse>(`/sandboxes/${sandboxId}/files${query}`)
    if (response.success) {
      set((state) => ({
        files: state.files.filter((f) => f.path !== path),
        currentFile: state.currentFile?.path === path ? null : state.currentFile,
        openFiles: state.openFiles.filter((f) => f.path !== path),
      }))
    }
  },

  createSnapshot: async (sandboxId: number, label: string) => {
    const response = await apiPost<ApiResponse & { snapshot: Snapshot }>(`/sandboxes/${sandboxId}/files/snapshots`, { label })
    set((state) => ({ snapshots: [...state.snapshots, response.snapshot] }))
  },

  fetchSnapshots: async (sandboxId: number) => {
    const response = await apiGet<ApiResponse & { snapshots: Snapshot[] }>(`/sandboxes/${sandboxId}/files/snapshots`)
    set({ snapshots: response.snapshots })
  },

  rollbackSnapshot: async (sandboxId: number, snapshotId: number) => {
    await apiPost<ApiResponse>(`/sandboxes/${sandboxId}/files/snapshots/${snapshotId}/rollback`)
    await get().fetchFiles(sandboxId)
    if (get().currentFile) {
      await get().fetchFileContent(sandboxId, get().currentFile!.path)
    }
  },

  setCurrentFile: (file: FileNode | null) => {
    set({ currentFile: file })
  },

  addOpenFile: (file: FileNode) => {
    const { openFiles } = get()
    if (openFiles.some((f) => f.path === file.path)) return
    set({ openFiles: [...openFiles, file] })
  },

  removeOpenFile: (path: string) => {
    set((state) => ({
      openFiles: state.openFiles.filter((f) => f.path !== path),
      currentFile: state.currentFile?.path === path ? state.openFiles[0] || null : state.currentFile,
    }))
  },
}))
