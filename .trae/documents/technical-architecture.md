## 1. 架构设计

```mermaid
graph TB
    subgraph "前端层 Frontend"
        FE["React SPA<br/>Monaco + xterm.js"]
    end
    subgraph "API网关层 Gateway"
        GW["Express.js<br/>REST + WebSocket"]
        AUTH["JWT认证中间件"]
        RATE["速率限制中间件"]
    end
    subgraph "沙箱管理层 Sandbox Manager"
        SM["沙箱编排器<br/>池化管理"]
        POOL["预热沙箱池<br/>Firecracker/gVisor"]
        FS["虚拟文件系统<br/>写时复制 + 快照"]
    end
    subgraph "安全层 Security"
        SEC["seccomp过滤器"]
        CGROUP["cgroup资源限制"]
        PT["性能计数器监控"]
    end
    subgraph "协作层 Collaboration"
        CRDT["Yjs CRDT引擎"]
        WS["WebSocket广播"]
    end
    subgraph "数据层 Data"
        DB["SQLite<br/>用户/沙箱元数据"]
        STORE["文件存储<br/>快照数据"]
    end

    FE --> GW
    GW --> AUTH
    AUTH --> RATE
    RATE --> SM
    SM --> POOL
    SM --> FS
    POOL --> SEC
    POOL --> CGROUP
    POOL --> PT
    FE --> WS
    WS --> CRDT
    SM --> DB
    FS --> STORE
```

## 2. 技术说明

- **前端**：React@18 + TypeScript + TailwindCSS@3 + Vite
- **初始化工具**：vite-init (react-express-ts模板)
- **后端**：Express@4 + TypeScript (ESM)
- **数据库**：SQLite (better-sqlite3)
- **代码编辑器**：@monaco-editor/react
- **终端模拟器**：xterm.js + xterm-addon-fit + xterm-addon-web-links
- **CRDT引擎**：yjs + y-websocket
- **图表库**：chart.js + react-chartjs-2
- **图标库**：lucide-react
- **状态管理**：zustand
- **实时通信**：ws (WebSocket)

## 3. 路由定义

| 路由 | 用途 |
|------|------|
| `/` | 登录/注册页面 |
| `/dashboard` | 仪表盘 - 沙箱列表、资源监控、快照管理 |
| `/workspace/:id` | 工作区 - IDE编辑器、文件树、终端 |
| `/workspace/:id/collab` | 协作工作区 - 多人编辑+共享终端 |

## 4. API定义

### 4.1 认证API

```typescript
interface AuthAPI {
  POST /api/auth/register: {
    body: { email: string; password: string; username: string }
    response: { token: string; user: User }
  }
  POST /api/auth/login: {
    body: { email: string; password: string }
    response: { token: string; user: User }
  }
  GET /api/auth/github: {
    response: { redirectUrl: string }
  }
}
```

### 4.2 沙箱API

```typescript
interface SandboxAPI {
  GET /api/sandboxes: {
    response: { sandboxes: Sandbox[] }
  }
  POST /api/sandboxes: {
    body: { name: string; language: "python" | "nodejs" | "cpp" | "rust" }
    response: { sandbox: Sandbox }
  }
  POST /api/sandboxes/:id/start: {
    response: { sandbox: Sandbox; wsUrl: string }
  }
  POST /api/sandboxes/:id/stop: {
    response: { sandbox: Sandbox }
  }
  DELETE /api/sandboxes/:id: {
    response: { success: boolean }
  }
  GET /api/sandboxes/:id/status: {
    response: { status: SandboxStatus; metrics: ResourceMetrics }
  }
}
```

### 4.3 文件系统API

```typescript
interface FileSystemAPI {
  GET /api/sandboxes/:id/files?path=:path: {
    response: { files: FileNode[] }
  }
  GET /api/sandboxes/:id/files/content?path=:path: {
    response: { content: string }
  }
  PUT /api/sandboxes/:id/files/content: {
    body: { path: string; content: string }
    response: { success: boolean }
  }
  POST /api/sandboxes/:id/files/mkdir: {
    body: { path: string; name: string }
    response: { node: FileNode }
  }
  DELETE /api/sandboxes/:id/files?path=:path: {
    response: { success: boolean }
  }
  POST /api/sandboxes/:id/snapshots: {
    body: { label: string }
    response: { snapshot: Snapshot }
  }
  POST /api/sandboxes/:id/snapshots/:sid/rollback: {
    response: { success: boolean }
  }
  GET /api/sandboxes/:id/snapshots: {
    response: { snapshots: Snapshot[] }
  }
}
```

### 4.4 WebSocket协议

```typescript
interface WSMessage {
  type: "execute" | "output" | "input" | "resize" | "collab_edit" | "cursor" | "chat"
  payload: Record<string, unknown>
}

interface ExecutePayload {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

interface OutputPayload {
  stream: "stdout" | "stderr" | "compile"
  data: string
  timestamp: number
}
```

### 4.5 协作API

```typescript
interface CollaborationAPI {
  POST /api/sandboxes/:id/collab/invite: {
    body: { email: string; permission: "edit" | "read" }
    response: { inviteUrl: string }
  }
  GET /api/sandboxes/:id/collab/users: {
    response: { users: CollabUser[] }
  }
}
```

## 5. 服务端架构图

```mermaid
graph LR
    subgraph "Controller层"
        AC["AuthController"]
        SC["SandboxController"]
        FC["FileSystemController"]
        CC["CollabController"]
    end
    subgraph "Service层"
        AS["AuthService"]
        SS["SandboxService"]
        FSS["FileSystemService"]
        CS["CollabService"]
        SEC_S["SecurityService"]
    end
    subgraph "Repository层"
        UR["UserRepository"]
        SR["SandboxRepository"]
        FR["FileRepository"]
        SNR["SnapshotRepository"]
    end
    subgraph "基础设施层"
        DB["SQLite"]
        POOL_M["沙箱池管理器"]
        VFS["虚拟文件系统"]
        WS_H["WebSocket处理器"]
    end

    AC --> AS --> UR --> DB
    SC --> SS --> SR --> DB
    SS --> POOL_M
    SS --> SEC_S
    FC --> FSS --> FR --> VFS
    FSS --> SNR --> DB
    CC --> CS --> WS_H
```

## 6. 数据模型

### 6.1 数据模型定义

```mermaid
erDiagram
    User {
        int id PK
        string email UK
        string username UK
        string password_hash
        string role
        int storage_limit_mb
        int sandbox_limit
        datetime created_at
    }
    Sandbox {
        int id PK
        int user_id FK
        string name
        string language
        string status
        string vm_id
        int cpu_limit_percent
        int memory_limit_mb
        int disk_limit_mb
        datetime created_at
        datetime last_active_at
    }
    FileNode {
        int id PK
        int sandbox_id FK
        string path
        string name
        string type
        string content
        datetime modified_at
    }
    Snapshot {
        int id PK
        int sandbox_id FK
        string label
        string tree_hash
        datetime created_at
    }
    Collaboration {
        int id PK
        int sandbox_id FK
        int user_id FK
        string permission
        datetime joined_at
    }

    User ||--o{ Sandbox : "owns"
    Sandbox ||--o{ FileNode : "contains"
    Sandbox ||--o{ Snapshot : "has"
    Sandbox ||--o{ Collaboration : "shared_with"
    User ||--o{ Collaboration : "participates"
```

### 6.2 数据定义语言

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'pro', 'admin')),
  storage_limit_mb INTEGER NOT NULL DEFAULT 500,
  sandbox_limit INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sandboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('python', 'nodejs', 'cpp', 'rust')),
  status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting', 'running', 'stopping', 'stopped', 'error')),
  vm_id TEXT,
  cpu_limit_percent INTEGER NOT NULL DEFAULT 50,
  memory_limit_mb INTEGER NOT NULL DEFAULT 256,
  disk_limit_mb INTEGER NOT NULL DEFAULT 500,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE file_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id INTEGER NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('file', 'directory')),
  content TEXT,
  modified_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sandbox_id, path)
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id INTEGER NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tree_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE collaborations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id INTEGER NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'edit' CHECK(permission IN ('edit', 'read')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sandbox_id, user_id)
);

CREATE INDEX idx_sandboxes_user_id ON sandboxes(user_id);
CREATE INDEX idx_file_nodes_sandbox_id ON file_nodes(sandbox_id);
CREATE INDEX idx_snapshots_sandbox_id ON snapshots(sandbox_id);
CREATE INDEX idx_collaborations_sandbox_id ON collaborations(sandbox_id);
CREATE INDEX idx_collaborations_user_id ON collaborations(user_id);
```
