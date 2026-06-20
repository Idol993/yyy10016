import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { User, Sandbox, FileNode, Snapshot, Collaboration } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

interface DbSchema {
  users: User[];
  sandboxes: Sandbox[];
  file_nodes: FileNode[];
  snapshots: Snapshot[];
  collaborations: Collaboration[];
  _counters: {
    users: number;
    sandboxes: number;
    file_nodes: number;
    snapshots: number;
    collaborations: number;
  };
}

const DEFAULT_DB: DbSchema = {
  users: [],
  sandboxes: [],
  file_nodes: [],
  snapshots: [],
  collaborations: [],
  _counters: {
    users: 0,
    sandboxes: 0,
    file_nodes: 0,
    snapshots: 0,
    collaborations: 0,
  },
};

let db: DbSchema;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDb(): DbSchema {
  ensureDataDir();
  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw) as DbSchema;
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function saveDb(): void {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function initStore(): void {
  db = loadDb();
  if (db.users.length === 0) {
    const now = new Date().toISOString();
    db._counters.users = 1;
    db.users.push({
      id: 1,
      email: 'demo@sandboxos.io',
      username: 'demo',
      password_hash: '$2a$10$placeholder_will_be_replaced_by_bcrypt',
      role: 'user',
      storage_limit_mb: 500,
      sandbox_limit: 3,
      created_at: now,
    });
    saveDb();
  }
}

export function setDemoPasswordHash(hash: string): void {
  const demo = db.users.find((u) => u.email === 'demo@sandboxos.io');
  if (demo) {
    demo.password_hash = hash;
    saveDb();
  }
}

function nextId(table: keyof DbSchema['_counters']): number {
  db._counters[table] += 1;
  saveDb();
  return db._counters[table];
}

const now = () => new Date().toISOString();

export const Users = {
  findAll(): User[] {
    return db.users;
  },
  findById(id: number): User | undefined {
    return db.users.find((u) => u.id === id);
  },
  findByEmail(email: string): User | undefined {
    return db.users.find((u) => u.email === email);
  },
  findByUsername(username: string): User | undefined {
    return db.users.find((u) => u.username === username);
  },
  create(data: Omit<User, 'id' | 'created_at'>): User {
    const user: User = {
      id: nextId('users'),
      ...data,
      created_at: now(),
    };
    db.users.push(user);
    saveDb();
    return user;
  },
  update(id: number, data: Partial<User>): User | undefined {
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    db.users[idx] = { ...db.users[idx], ...data };
    saveDb();
    return db.users[idx];
  },
  delete(id: number): boolean {
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    db.users.splice(idx, 1);
    saveDb();
    return true;
  },
};

export const Sandboxes = {
  findAll(): Sandbox[] {
    return db.sandboxes;
  },
  findByUserId(user_id: number): Sandbox[] {
    return db.sandboxes.filter((s) => s.user_id === user_id);
  },
  findById(id: number): Sandbox | undefined {
    return db.sandboxes.find((s) => s.id === id);
  },
  create(data: Omit<Sandbox, 'id' | 'created_at' | 'last_active_at'>): Sandbox {
    const sandbox: Sandbox = {
      id: nextId('sandboxes'),
      ...data,
      created_at: now(),
      last_active_at: now(),
    };
    db.sandboxes.push(sandbox);
    saveDb();
    return sandbox;
  },
  update(id: number, data: Partial<Sandbox>): Sandbox | undefined {
    const idx = db.sandboxes.findIndex((s) => s.id === id);
    if (idx === -1) return undefined;
    db.sandboxes[idx] = { ...db.sandboxes[idx], ...data };
    saveDb();
    return db.sandboxes[idx];
  },
  delete(id: number): boolean {
    const idx = db.sandboxes.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    db.sandboxes.splice(idx, 1);
    db.file_nodes = db.file_nodes.filter((f) => f.sandbox_id !== id);
    db.snapshots = db.snapshots.filter((s) => s.sandbox_id !== id);
    db.collaborations = db.collaborations.filter((c) => c.sandbox_id !== id);
    saveDb();
    return true;
  },
};

export const FileNodes = {
  findBySandboxId(sandbox_id: number): FileNode[] {
    return db.file_nodes.filter((f) => f.sandbox_id === sandbox_id);
  },
  findBySandboxIdAndPath(sandbox_id: number, path: string): FileNode | undefined {
    return db.file_nodes.find((f) => f.sandbox_id === sandbox_id && f.path === path);
  },
  findBySandboxIdAndParent(sandbox_id: number, parentPath: string): FileNode[] {
    const prefix = parentPath === '/' ? '/' : parentPath + '/';
    const depth = parentPath === '/' ? 1 : parentPath.split('/').length;
    return db.file_nodes.filter((f) => {
      if (f.sandbox_id !== sandbox_id) return false;
      if (!f.path.startsWith(prefix) && f.path !== parentPath) return false;
      if (f.path === parentPath) return false;
      const remaining = f.path.slice(prefix.length);
      return !remaining.includes('/');
    });
  },
  findById(id: number): FileNode | undefined {
    return db.file_nodes.find((f) => f.id === id);
  },
  create(data: Omit<FileNode, 'id' | 'modified_at'>): FileNode {
    const node: FileNode = {
      id: nextId('file_nodes'),
      ...data,
      modified_at: now(),
    };
    db.file_nodes.push(node);
    saveDb();
    return node;
  },
  update(id: number, data: Partial<FileNode>): FileNode | undefined {
    const idx = db.file_nodes.findIndex((f) => f.id === id);
    if (idx === -1) return undefined;
    db.file_nodes[idx] = { ...db.file_nodes[idx], ...data, modified_at: now() };
    saveDb();
    return db.file_nodes[idx];
  },
  delete(id: number): boolean {
    const idx = db.file_nodes.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    db.file_nodes.splice(idx, 1);
    saveDb();
    return true;
  },
  deleteByPath(sandbox_id: number, filePath: string): boolean {
    const before = db.file_nodes.length;
    db.file_nodes = db.file_nodes.filter((f) => {
      if (f.sandbox_id !== sandbox_id) return true;
      return f.path !== filePath && !f.path.startsWith(filePath + '/');
    });
    saveDb();
    return db.file_nodes.length < before;
  },
  cloneForSnapshot(sandbox_id: number): FileNode[] {
    return db.file_nodes
      .filter((f) => f.sandbox_id === sandbox_id)
      .map((f) => ({ ...f, content: f.content ? String(f.content) : null }));
  },
  replaceFromSnapshot(sandbox_id: number, nodes: FileNode[]): void {
    db.file_nodes = db.file_nodes.filter((f) => f.sandbox_id !== sandbox_id);
    for (const node of nodes) {
      db.file_nodes.push({ ...node, id: nextId('file_nodes'), modified_at: now() });
    }
    saveDb();
  },
};

export const Snapshots = {
  findBySandboxId(sandbox_id: number): Snapshot[] {
    return db.snapshots.filter((s) => s.sandbox_id === sandbox_id);
  },
  findById(id: number): Snapshot | undefined {
    return db.snapshots.find((s) => s.id === id);
  },
  create(data: Omit<Snapshot, 'id' | 'created_at'>): Snapshot {
    const snapshot: Snapshot = {
      id: nextId('snapshots'),
      ...data,
      created_at: now(),
    };
    db.snapshots.push(snapshot);
    saveDb();
    return snapshot;
  },
  delete(id: number): boolean {
    const idx = db.snapshots.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    db.snapshots.splice(idx, 1);
    saveDb();
    return true;
  },
};

export const Collaborations = {
  findBySandboxId(sandbox_id: number): Collaboration[] {
    return db.collaborations.filter((c) => c.sandbox_id === sandbox_id);
  },
  findBySandboxIdAndUserId(sandbox_id: number, user_id: number): Collaboration | undefined {
    return db.collaborations.find((c) => c.sandbox_id === sandbox_id && c.user_id === user_id);
  },
  findByUserId(user_id: number): Collaboration[] {
    return db.collaborations.filter((c) => c.user_id === user_id);
  },
  create(data: Omit<Collaboration, 'id' | 'joined_at'>): Collaboration {
    const collab: Collaboration = {
      id: nextId('collaborations'),
      ...data,
      joined_at: now(),
    };
    db.collaborations.push(collab);
    saveDb();
    return collab;
  },
  delete(id: number): boolean {
    const idx = db.collaborations.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    db.collaborations.splice(idx, 1);
    saveDb();
    return true;
  },
};
