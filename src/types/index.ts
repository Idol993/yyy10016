export interface User {
  id: number
  email: string
  username: string
  role: 'user' | 'pro' | 'admin'
  storage_limit_mb: number
  sandbox_limit: number
}

export interface Sandbox {
  id: number
  user_id: number
  name: string
  language: 'python' | 'nodejs' | 'cpp' | 'rust'
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
  vm_id: string | null
  cpu_limit_percent: number
  memory_limit_mb: number
  disk_limit_mb: number
  created_at: string
  last_active_at: string
}

export interface FileNode {
  id: number
  sandbox_id: number
  path: string
  name: string
  type: 'file' | 'directory'
  content: string | null
  modified_at: string
}

export interface Snapshot {
  id: number
  sandbox_id: number
  label: string
  tree_hash: string
  created_at: string
}

export interface CollabUser {
  id: number
  username: string
  email: string
  permission: 'edit' | 'read' | 'owner'
  color: string
  cursor?: {
    path: string
    line: number
    column: number
  }
}

export type Language = 'python' | 'nodejs' | 'cpp' | 'rust'

export type SandboxStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
