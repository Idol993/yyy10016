import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const SANDBOXES_DIR = path.join(DATA_DIR, 'sandboxes');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(SANDBOXES_DIR);
ensureDir(SNAPSHOTS_DIR);

export function getSandboxFsPath(sandboxId: number): string {
  const p = path.join(SANDBOXES_DIR, String(sandboxId), 'fs');
  ensureDir(p);
  return p;
}

export function getSnapshotDir(snapshotId: number): string {
  const p = path.join(SNAPSHOTS_DIR, String(snapshotId));
  ensureDir(p);
  return p;
}

function toAbsPath(sandboxId: number, filePath: string): string {
  const base = getSandboxFsPath(sandboxId);
  const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const resolved = path.join(base, '.' + normalized);
  if (!resolved.startsWith(base)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDir(p: string): void {
  if (!fs.existsSync(p)) return;
  const entries = fs.readdirSync(p, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(p, entry.name);
    if (entry.isDirectory()) {
      removeDir(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
  fs.rmdirSync(p);
}

export function initSandboxFs(sandboxId: number, files: Array<{ path: string; content: string | null; type: 'file' | 'directory' }>): void {
  const base = getSandboxFsPath(sandboxId);
  for (const f of files) {
    const abs = toAbsPath(sandboxId, f.path);
    if (f.type === 'directory') {
      ensureDir(abs);
    } else if (f.content !== null && f.content !== undefined) {
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, f.content, 'utf-8');
    }
  }
  void base;
}

export function readFileFromFs(sandboxId: number, filePath: string): string | null {
  try {
    const abs = toAbsPath(sandboxId, filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

export function writeFileToFs(sandboxId: number, filePath: string, content: string): boolean {
  try {
    const abs = toAbsPath(sandboxId, filePath);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function createFileFs(sandboxId: number, filePath: string, type: 'file' | 'directory', content?: string): boolean {
  try {
    const abs = toAbsPath(sandboxId, filePath);
    if (type === 'directory') {
      ensureDir(abs);
    } else {
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, content || '', 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

export function deleteFromFs(sandboxId: number, filePath: string): boolean {
  try {
    const abs = toAbsPath(sandboxId, filePath);
    if (!fs.existsSync(abs)) return true;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      removeDir(abs);
    } else {
      fs.unlinkSync(abs);
    }
    return true;
  } catch {
    return false;
  }
}

export function renameInFs(sandboxId: number, oldPath: string, newPath: string): boolean {
  try {
    const absOld = toAbsPath(sandboxId, oldPath);
    const absNew = toAbsPath(sandboxId, newPath);
    if (!fs.existsSync(absOld)) return false;
    ensureDir(path.dirname(absNew));
    fs.renameSync(absOld, absNew);
    return true;
  } catch {
    return false;
  }
}

export interface FsEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified_at: string;
}

export function listDir(sandboxId: number, dirPath: string): FsEntry[] {
  try {
    const base = getSandboxFsPath(sandboxId);
    const abs = toAbsPath(sandboxId, dirPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return [];
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const result: FsEntry[] = [];
    for (const entry of entries) {
      const entryPath = path.join(abs, entry.name);
      const stat = fs.statSync(entryPath);
      const rel = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;
      result.push({
        path: rel,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      });
    }
    return result;
  } catch {
    return [];
  }
}

export function listAllFs(sandboxId: number): FsEntry[] {
  const result: FsEntry[] = [];
  function walk(dirPath: string): void {
    const entries = listDir(sandboxId, dirPath);
    for (const e of entries) {
      result.push(e);
      if (e.type === 'directory') {
        walk(e.path);
      }
    }
  }
  walk('/');
  return result;
}

export function createSnapshotFs(sandboxId: number, snapshotId: number): boolean {
  try {
    const src = getSandboxFsPath(sandboxId);
    const dest = getSnapshotDir(snapshotId);
    removeDir(dest);
    copyDir(src, dest);
    return true;
  } catch {
    return false;
  }
}

export function rollbackFromSnapshotFs(sandboxId: number, snapshotId: number): boolean {
  try {
    const src = getSnapshotDir(snapshotId);
    if (!fs.existsSync(src)) return false;
    const dest = getSandboxFsPath(sandboxId);
    removeDir(dest);
    copyDir(src, dest);
    return true;
  } catch {
    return false;
  }
}

export function deleteSnapshotFs(snapshotId: number): boolean {
  try {
    const p = getSnapshotDir(snapshotId);
    if (fs.existsSync(p)) {
      removeDir(p);
    }
    return true;
  } catch {
    return false;
  }
}

export function getSandboxDiskUsage(sandboxId: number): number {
  try {
    let total = 0;
    function walk(p: string): void {
      if (!fs.existsSync(p)) return;
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const e of entries) {
        const ep = path.join(p, e.name);
        if (e.isDirectory()) {
          walk(ep);
        } else if (e.isFile()) {
          total += fs.statSync(ep).size;
        }
      }
    }
    walk(getSandboxFsPath(sandboxId));
    return total;
  } catch {
    return 0;
  }
}
