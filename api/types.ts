export interface User {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  role: 'user' | 'pro' | 'admin';
  storage_limit_mb: number;
  sandbox_limit: number;
  created_at: string;
}

export interface Sandbox {
  id: number;
  user_id: number;
  name: string;
  language: 'python' | 'nodejs' | 'cpp' | 'rust';
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  vm_id: string | null;
  cpu_limit_percent: number;
  memory_limit_mb: number;
  disk_limit_mb: number;
  created_at: string;
  last_active_at: string;
}

export interface FileNode {
  id: number;
  sandbox_id: number;
  path: string;
  name: string;
  type: 'file' | 'directory';
  content: string | null;
  modified_at: string;
}

export interface Snapshot {
  id: number;
  sandbox_id: number;
  label: string;
  tree_hash: string;
  created_at: string;
}

export interface Collaboration {
  id: number;
  sandbox_id: number;
  user_id: number;
  permission: 'edit' | 'read';
  joined_at: string;
}

export interface ResourceMetrics {
  cpu_percent: number;
  memory_used_mb: number;
  disk_used_mb: number;
}

export interface WSMessage {
  type: 'execute' | 'output' | 'input' | 'resize' | 'collab_edit' | 'cursor' | 'chat';
  payload: Record<string, unknown>;
}

export interface AuthRequest {
  email: string;
  password: string;
  username?: string;
}

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
}
