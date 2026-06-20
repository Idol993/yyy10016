import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Sandboxes, FileNodes } from '../db/store.js';
import type { Sandbox, ResourceMetrics } from '../types.js';

interface ActiveSandbox {
  sandboxId: number;
  vmId: string;
  process: ChildProcess | null;
  language: string;
  startedAt: string;
  metrics: ResourceMetrics;
}

const activeSandboxes = new Map<number, ActiveSandbox>();

const POOL_SIZE = 2;
const pool: string[] = [];

const LANGUAGE_EXECUTORS: Record<string, { cmd: string; args: string[] }> = {
  python: { cmd: 'python', args: ['-i'] },
  nodejs: { cmd: 'node', args: ['--interactive'] },
  cpp: { cmd: 'bash', args: [] },
  rust: { cmd: 'bash', args: [] },
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

export async function startSandbox(sandboxId: number): Promise<Sandbox | null> {
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return null;

  if (sandbox.status === 'running') return sandbox;

  Sandboxes.update(sandboxId, { status: 'starting', last_active_at: new Date().toISOString() });

  const vmId = allocateVmId();
  const executor = LANGUAGE_EXECUTORS[sandbox.language] || LANGUAGE_EXECUTORS.nodejs;

  try {
    const childProcess = spawn(executor.cmd, executor.args, {
      env: { ...process.env, SANDBOX_ID: String(sandboxId), VM_ID: vmId },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const active: ActiveSandbox = {
      sandboxId,
      vmId,
      process: childProcess,
      language: sandbox.language,
      startedAt: new Date().toISOString(),
      metrics: { cpu_percent: 0, memory_used_mb: 0, disk_used_mb: 0 },
    };

    activeSandboxes.set(sandboxId, active);

    childProcess.on('error', () => {
      Sandboxes.update(sandboxId, { status: 'error', vm_id: null });
      activeSandboxes.delete(sandboxId);
    });

    childProcess.on('exit', () => {
      const current = Sandboxes.findById(sandboxId);
      if (current && current.status !== 'stopped') {
        Sandboxes.update(sandboxId, { status: 'stopped', vm_id: null });
      }
      activeSandboxes.delete(sandboxId);
    });

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
      // process already dead
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
    const cpuPercent = Math.random() * 15;
    const memUsed = 32 + Math.random() * 64;
    const diskUsed = 10 + Math.random() * 20;
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

export function initDefaultFiles(sandboxId: number, language: string): void {
  const now = new Date().toISOString();
  const rootDir = FileNodes.create({
    sandbox_id: sandboxId,
    path: '/',
    name: '/',
    type: 'directory',
    content: null,
  });

  FileNodes.create({
    sandbox_id: sandboxId,
    path: '/src',
    name: 'src',
    type: 'directory',
    content: null,
  });

  let entryPath = '/src/index.js';
  let entryContent = 'console.log("Hello from SandboxOS!");\n';

  switch (language) {
    case 'python':
      entryPath = '/src/main.py';
      entryContent = 'print("Hello from SandboxOS!")\n';
      break;
    case 'nodejs':
      entryPath = '/src/index.js';
      entryContent = 'console.log("Hello from SandboxOS!");\n';
      break;
    case 'cpp':
      entryPath = '/src/main.cpp';
      entryContent = '#include <iostream>\nint main() {\n  std::cout << "Hello from SandboxOS!" << std::endl;\n  return 0;\n}\n';
      break;
    case 'rust':
      entryPath = '/src/main.rs';
      entryContent = 'fn main() {\n  println!("Hello from SandboxOS!");\n}\n';
      break;
  }

  FileNodes.create({
    sandbox_id: sandboxId,
    path: entryPath,
    name: pathBasename(entryPath),
    type: 'file',
    content: entryContent,
  });

  FileNodes.create({
    sandbox_id: sandboxId,
    path: '/README.md',
    name: 'README.md',
    type: 'file',
    content: '# My Sandbox\n\nCreated with SandboxOS.\n',
  });
}

function pathBasename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}
