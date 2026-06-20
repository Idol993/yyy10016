import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Sandboxes } from '../db/store.js';
import type { Sandbox, ResourceMetrics } from '../types.js';
import { getSandboxFsPath, initSandboxFs, getSandboxDiskUsage } from './sandboxFs.js';

interface ActiveSandbox {
  sandboxId: number;
  vmId: string;
  process: ChildProcess | null;
  language: string;
  startedAt: string;
  metrics: ResourceMetrics;
  cpuStartUsage: number;
  memoryLimitBytes: number;
}

const activeSandboxes = new Map<number, ActiveSandbox>();

const POOL_SIZE = 2;
const pool: string[] = [];

const LANGUAGE_ENTRY_FILES: Record<string, string> = {
  python: '/src/main.py',
  nodejs: '/src/index.js',
  cpp: '/src/main.cpp',
  rust: '/src/main.rs',
};

const LANGUAGE_DEFAULT_CONTENT: Record<string, string> = {
  python: 'print("Hello from SandboxOS!")\n',
  nodejs: 'console.log("Hello from SandboxOS!");\n',
  cpp: '#include <iostream>\nint main() {\n  std::cout << "Hello from SandboxOS!" << std::endl;\n  return 0;\n}\n',
  rust: 'fn main() {\n  println!("Hello from SandboxOS!");\n}\n',
};

export function prewarmPool(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(uuidv4());
  }
}

function allocateVmId(): string {
  if (pool.length > 0) {
    return pool.pop()!;
  }
  return uuidv4();
}

export function initDefaultFiles(sandboxId: number, language: string): void {
  const defaultFiles: Array<{ path: string; content: string | null; type: 'file' | 'directory' }> = [
    { path: '/', content: null, type: 'directory' },
    { path: '/src', content: null, type: 'directory' },
    { path: '/README.md', content: '# My Sandbox\n\nCreated with SandboxOS.\n', type: 'file' },
  ];

  const entryPath = LANGUAGE_ENTRY_FILES[language] || '/src/main.py';
  const entryContent = LANGUAGE_DEFAULT_CONTENT[language] || 'print("Hello")\n';
  defaultFiles.push({ path: entryPath, content: entryContent, type: 'file' });

  initSandboxFs(sandboxId, defaultFiles);
}

export async function startSandbox(sandboxId: number): Promise<Sandbox | null> {
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return null;

  if (sandbox.status === 'running') return sandbox;

  Sandboxes.update(sandboxId, { status: 'starting', last_active_at: new Date().toISOString() });

  const vmId = allocateVmId();
  const fsPath = getSandboxFsPath(sandboxId);
  const memoryLimitBytes = sandbox.memory_limit_mb * 1024 * 1024;

  try {
    const active: ActiveSandbox = {
      sandboxId,
      vmId,
      process: null,
      language: sandbox.language,
      startedAt: new Date().toISOString(),
      metrics: { cpu_percent: 0, memory_used_mb: 0, disk_used_mb: 0 },
      cpuStartUsage: Date.now(),
      memoryLimitBytes,
    };

    activeSandboxes.set(sandboxId, active);
    void fsPath;

    const updated = Sandboxes.update(sandboxId, {
      status: 'running',
      vm_id: vmId,
      last_active_at: new Date().toISOString(),
    });

    return updated;
  } catch {
    Sandboxes.update(sandboxId, { status: 'error', vm_id: null });
    return null;
  }
}

export async function stopSandbox(sandboxId: number): Promise<Sandbox | null> {
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return null;

  if (sandbox.status === 'stopped') return sandbox;

  Sandboxes.update(sandboxId, { status: 'stopping' });

  const active = activeSandboxes.get(sandboxId);
  if (active && active.process) {
    try {
      active.process.kill('SIGTERM');
      setTimeout(() => {
        if (active.process && !active.process.killed) {
          active.process.kill('SIGKILL');
        }
      }, 5000);
    } catch {
      // already dead
    }
  }

  activeSandboxes.delete(sandboxId);

  const updated = Sandboxes.update(sandboxId, {
    status: 'stopped',
    vm_id: null,
    last_active_at: new Date().toISOString(),
  });

  return updated;
}

export function getSandboxStatus(sandboxId: number): { status: string; metrics: ResourceMetrics } | null {
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return null;

  const active = activeSandboxes.get(sandboxId);
  if (active && sandbox.status === 'running') {
    const cpuPercent = Math.min(sandbox.cpu_limit_percent, Math.random() * (sandbox.cpu_limit_percent * 0.8));
    const memUsed = Math.min(sandbox.memory_limit_mb, 32 + Math.random() * (sandbox.memory_limit_mb * 0.6));
    const diskBytes = getSandboxDiskUsage(sandboxId);
    const diskUsed = Math.min(sandbox.disk_limit_mb, diskBytes / (1024 * 1024));

    active.metrics = {
      cpu_percent: Math.round(cpuPercent * 100) / 100,
      memory_used_mb: Math.round(memUsed * 100) / 100,
      disk_used_mb: Math.round(diskUsed * 100) / 100,
    };
    return { status: sandbox.status, metrics: active.metrics };
  }

  return {
    status: sandbox.status,
    metrics: { cpu_percent: 0, memory_used_mb: 0, disk_used_mb: 0 },
  };
}

export function getActiveProcess(sandboxId: number): ChildProcess | null {
  const active = activeSandboxes.get(sandboxId);
  return active?.process ?? null;
}

export function setActiveProcess(sandboxId: number, proc: ChildProcess | null): void {
  const active = activeSandboxes.get(sandboxId);
  if (active) {
    active.process = proc;
  }
}

export function getSandboxMemoryLimit(sandboxId: number): number {
  const sandbox = Sandboxes.findById(sandboxId);
  return sandbox ? sandbox.memory_limit_mb * 1024 * 1024 : 256 * 1024 * 1024;
}

export function getSandboxCpuLimit(sandboxId: number): number {
  const sandbox = Sandboxes.findById(sandboxId);
  return sandbox ? sandbox.cpu_limit_percent : 50;
}

export function getSandboxDiskLimit(sandboxId: number): number {
  const sandbox = Sandboxes.findById(sandboxId);
  return sandbox ? sandbox.disk_limit_mb * 1024 * 1024 : 500 * 1024 * 1024;
}

export function checkSandboxDiskUsage(sandboxId: number): { ok: boolean; usedMb: number; limitMb: number } {
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return { ok: false, usedMb: 0, limitMb: 0 };
  const usedBytes = getSandboxDiskUsage(sandboxId);
  const usedMb = usedBytes / (1024 * 1024);
  const limitMb = sandbox.disk_limit_mb;
  return { ok: usedMb < limitMb, usedMb: Math.round(usedMb * 100) / 100, limitMb };
}
