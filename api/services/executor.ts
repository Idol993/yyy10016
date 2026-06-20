import { getSandboxFsPath, getSandboxDiskUsage } from './sandboxFs.js';
import { runInIsolatedSandbox, stopInstance, getInstanceBySandbox, type SandboxInstance, type SandboxInstanceConfig } from './isolation.js';
import type { ChildProcess } from 'child_process';

export const NETWORK_WHITELIST = [
  'localhost',
  '127.0.0.1',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'index.crates.io',
];

export interface ExecContext {
  sandboxId: number;
  permission: 'read' | 'edit' | 'owner';
  userId: number;
  username: string;
  language: string;
  cpuLimitPercent: number;
  memoryLimitMb: number;
  diskLimitMb: number;
}

export interface ExecCallbacks {
  onOutput: (stream: 'stdout' | 'stderr' | 'system', data: string) => void;
  onExit: (code: number | null, reason?: string) => void;
  onError: (err: Error) => void;
}

export interface RunCodeResult {
  instance?: SandboxInstance;
  error?: string;
}

export function runEntryFile(
  ctx: ExecContext,
  callbacks: ExecCallbacks
): RunCodeResult {
  if (ctx.permission === 'read') {
    return { error: 'Read-only members cannot execute code' };
  }

  const diskMb = Math.round(getSandboxDiskUsage(ctx.sandboxId) / 1024 / 1024);
  if (diskMb >= ctx.diskLimitMb) {
    return { error: `Disk limit exceeded: used ${diskMb} MB / ${ctx.diskLimitMb} MB` };
  }

  const config: SandboxInstanceConfig = {
    sandboxId: ctx.sandboxId,
    language: ctx.language,
    cpuLimitPercent: ctx.cpuLimitPercent,
    memoryLimitBytes: ctx.memoryLimitMb * 1024 * 1024,
    diskLimitBytes: ctx.diskLimitMb * 1024 * 1024,
    networkWhitelist: NETWORK_WHITELIST,
  };

  const fsPath = getSandboxFsPath(ctx.sandboxId);
  const resultPromise = runInIsolatedSandbox(config, fsPath, [], callbacks);
  resultPromise.then((res) => {
    if ('error' in res && res.error) {
      callbacks.onOutput('stderr', `[SandboxOS] ${res.error}\n`);
    }
  }).catch((err) => {
    callbacks.onError(err);
  });

  return {};
}

export function killRunningSandbox(sandboxId: number): boolean {
  const inst = getInstanceBySandbox(sandboxId);
  if (inst) {
    stopInstance(inst.instanceId, 'user_stopped');
    return true;
  }
  return false;
}

export function getRunningInstance(sandboxId: number): SandboxInstance | undefined {
  return getInstanceBySandbox(sandboxId);
}

export function sendToProcess(proc: ChildProcess | null, input: string): boolean {
  if (!proc || proc.stdin?.destroyed) return false;
  try {
    proc.stdin.write(input);
    return true;
  } catch {
    return false;
  }
}

export function isNetworkAllowed(host: string): boolean {
  return NETWORK_WHITELIST.includes(host);
}
