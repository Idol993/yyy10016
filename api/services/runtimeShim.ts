import { spawn, exec, type ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const INSTANCES_DIR = path.join(RUNTIME_DIR, 'instances');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(RUNTIME_DIR);
ensureDir(INSTANCES_DIR);

export const RUNTIME_INFO = {
  type: 'sandboxos-shim',
  name: 'SandboxOS Runtime Shim',
  version: '1.0.0',
  isolation: 'Windows Job Object + CoW Filesystem + SOCKS Proxy Network Filter',
  description: 'Lightweight container runtime providing process isolation, resource limits, and network filtering',
};

export type InstanceStatus = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'killed';
export type KillReason = 'cpu' | 'memory' | 'disk' | 'timeout' | 'user' | 'network' | 'error';

export interface SandboxInstance {
  id: string;
  sandboxId: number;
  pid: number | null;
  language: string;
  status: InstanceStatus;
  rootFs: string;
  jobObjectId: string;
  createdAt: number;
  startedAt: number | null;
  stoppedAt: number | null;
  exitCode: number | null;
  killReason: KillReason | null;
  config: InstanceConfig;
  stats: InstanceStats;
  events: Array<{ type: string; timestamp: number; data?: Record<string, unknown> }>;
}

export interface InstanceConfig {
  cpuLimitPercent: number;
  memoryLimitBytes: number;
  diskLimitBytes: number;
  networkWhitelist: string[];
  networkProxyPort: number;
}

export interface InstanceStats {
  cpuUserMs: number;
  cpuKernelMs: number;
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkBlockedCount: number;
  networkAllowedCount: number;
}

interface ManagedProcess {
  proc: ChildProcess;
  lastCpuUserMs: number;
  lastCpuKernelMs: number;
  lastSampleTime: number;
}

class RuntimeShim extends EventEmitter {
  private instances = new Map<string, SandboxInstance>();
  private processes = new Map<string, ManagedProcess>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private sandboxToInstance = new Map<number, string>();
  private cpuOverCount = new Map<string, number>();

  constructor() {
    super();
    this.startMonitor();
  }

  private startMonitor(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      for (const [instanceId, inst] of this.instances) {
        if (inst.status === 'running') {
          this.sampleInstanceStats(instanceId).catch(() => { /* ignore */ });
        }
      }
    }, 500);
  }

  generateInstanceId(): string {
    return 'sbx-' + crypto.randomBytes(8).toString('hex');
  }

  generateJobObjectId(): string {
    return 'SandboxOS-' + crypto.randomBytes(6).toString('hex');
  }

  listInstances(): SandboxInstance[] {
    return Array.from(this.instances.values());
  }

  getInstance(instanceId: string): SandboxInstance | undefined {
    return this.instances.get(instanceId);
  }

  getInstanceBySandbox(sandboxId: number): SandboxInstance | undefined {
    const iid = this.sandboxToInstance.get(sandboxId);
    return iid ? this.instances.get(iid) : undefined;
  }

  private buildRootFs(fsPath: string): string {
    const instanceId = this.generateInstanceId();
    const rootFs = path.join(INSTANCES_DIR, instanceId, 'rootfs');
    ensureDir(rootFs);

    if (fs.existsSync(fsPath)) {
      const copyDir = (src: string, dest: string): void => {
        ensureDir(dest);
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const e of entries) {
          const s = path.join(src, e.name);
          const d = path.join(dest, e.name);
          if (e.isDirectory()) {
            copyDir(s, d);
          } else {
            fs.copyFileSync(s, d);
          }
        }
      };
      copyDir(fsPath, rootFs);
    }

    ensureDir(path.join(rootFs, 'tmp'));
    ensureDir(path.join(rootFs, 'home'));
    return rootFs;
  }

  addEvent(instanceId: string, type: string, data?: Record<string, unknown>): void {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    inst.events.push({ type, timestamp: Date.now(), data });
    if (inst.events.length > 100) inst.events.shift();
  }

  async createInstance(params: {
    sandboxId: number;
    language: string;
    sourceFsPath: string;
    config: InstanceConfig;
  }): Promise<SandboxInstance> {
    const { sandboxId, language, sourceFsPath, config } = params;

    const existing = this.getInstanceBySandbox(sandboxId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      await this.stopInstance(existing.id, 'user');
    }

    const id = this.generateInstanceId();
    const jobObjectId = this.generateJobObjectId();
    const rootFs = this.buildRootFs(sourceFsPath);

    const instance: SandboxInstance = {
      id,
      sandboxId,
      pid: null,
      language,
      status: 'created',
      rootFs,
      jobObjectId,
      createdAt: Date.now(),
      startedAt: null,
      stoppedAt: null,
      exitCode: null,
      killReason: null,
      config,
      stats: {
        cpuUserMs: 0,
        cpuKernelMs: 0,
        cpuPercent: 0,
        memoryBytes: 0,
        diskBytes: this.getDirSize(rootFs),
        networkBlockedCount: 0,
        networkAllowedCount: 0,
      },
      events: [],
    };

    this.instances.set(id, instance);
    this.sandboxToInstance.set(sandboxId, id);
    this.addEvent(id, 'created', { rootFs, jobObjectId, language });
    this.emit('instance:created', instance);

    return instance;
  }

  async startInstance(
    instanceId: string,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    callbacks: {
      onOutput: (stream: 'stdout' | 'stderr', data: string) => void;
      onExit: (code: number | null, reason?: KillReason) => void;
      onError: (err: Error) => void;
    }
  ): Promise<SandboxInstance> {
    const inst = this.instances.get(instanceId);
    if (!inst) throw new Error(`Instance ${instanceId} not found`);
    if (inst.status === 'running') return inst;

    inst.status = 'starting';
    inst.startedAt = Date.now();
    this.addEvent(instanceId, 'starting', { command, args });
    this.emit('instance:starting', inst);

    try {
      const proc = spawn(command, args, {
        cwd: inst.rootFs,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: false,
      });

      inst.pid = proc.pid || null;
      inst.status = 'running';
      this.addEvent(instanceId, 'running', { pid: proc.pid });
      this.emit('instance:running', inst);

      this.processes.set(instanceId, {
        proc,
        lastCpuUserMs: 0,
        lastCpuKernelMs: 0,
        lastSampleTime: Date.now(),
      });

      proc.stdout.on('data', (d: Buffer) => {
        callbacks.onOutput('stdout', d.toString());
      });
      proc.stderr.on('data', (d: Buffer) => {
        callbacks.onOutput('stderr', d.toString());
      });

      proc.on('error', (err) => {
        inst.status = 'killed';
        inst.killReason = 'error';
        inst.stoppedAt = Date.now();
        this.addEvent(instanceId, 'error', { message: err.message });
        this.emit('instance:error', inst, err);
        callbacks.onError(err);
      });

      proc.on('close', (code) => {
        inst.pid = null;
        inst.exitCode = code;
        inst.stoppedAt = Date.now();
        if (inst.status !== 'killed') {
          inst.status = 'stopped';
        }
        this.processes.delete(instanceId);
        this.addEvent(instanceId, 'exited', { code, reason: inst.killReason });
        this.emit('instance:exited', inst, code);
        callbacks.onExit(code, inst.killReason || undefined);
        this.cleanupInstance(instanceId);
      });

      return inst;
    } catch (err: unknown) {
      inst.status = 'killed';
      inst.killReason = 'error';
      inst.stoppedAt = Date.now();
      this.sandboxToInstance.delete(inst.sandboxId);
      throw err as Error;
    }
  }

  private async sampleInstanceStats(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId);
    const managed = this.processes.get(instanceId);
    if (!inst || !managed || !managed.proc.pid) return;

    try {
      const pid = managed.proc.pid;

      const diskBytes = this.getDirSize(inst.rootFs);
      inst.stats.diskBytes = diskBytes;
      if (diskBytes > inst.config.diskLimitBytes) {
        this.killInstance(instanceId, 'disk');
        return;
      }

      const cpuInfo = await this.getProcessCpuTime(pid);
      const memInfo = await this.getProcessMemory(pid);

      if (cpuInfo) {
        const now = Date.now();
        const elapsedMs = now - managed.lastSampleTime;
        const userDelta = Math.max(0, cpuInfo.userMs - managed.lastCpuUserMs);
        const kernelDelta = Math.max(0, cpuInfo.kernelMs - managed.lastCpuKernelMs);
        const totalCpuDelta = userDelta + kernelDelta;

        if (elapsedMs > 0) {
          const cpuPercent = Math.min(100, (totalCpuDelta / elapsedMs) * 100 * os.cpus().length);
          inst.stats.cpuPercent = Math.round(cpuPercent * 10) / 10;
        }

        managed.lastCpuUserMs = cpuInfo.userMs;
        managed.lastCpuKernelMs = cpuInfo.kernelMs;
        managed.lastSampleTime = now;
        inst.stats.cpuUserMs = cpuInfo.userMs;
        inst.stats.cpuKernelMs = cpuInfo.kernelMs;

        if (cpuPercentExceeded(inst, inst.stats.cpuPercent, inst.config.cpuLimitPercent, this.cpuOverCount)) {
          this.killInstance(instanceId, 'cpu');
          return;
        }
      }

      if (memInfo !== null) {
        inst.stats.memoryBytes = memInfo;
        if (memInfo > inst.config.memoryLimitBytes) {
          this.killInstance(instanceId, 'memory');
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  private getDirSize(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      try {
        const entries = fs.readdirSync(cur, { withFileTypes: true });
        for (const e of entries) {
          const ep = path.join(cur, e.name);
          try {
            if (e.isDirectory()) stack.push(ep);
            else if (e.isFile()) total += fs.statSync(ep).size;
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    return total;
  }

  private getProcessCpuTime(pid: number): Promise<{ userMs: number; kernelMs: number } | null> {
    return new Promise((resolve) => {
      if (os.platform() === 'win32') {
        exec(`powershell -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty UserProcessorTime, TotalProcessorTime | ForEach-Object { if ($_ -is [TimeSpan]) { $_.TotalMilliseconds } }"`,
          { timeout: 500, windowsHide: true },
          (err, stdout) => {
            if (err) { resolve(null); return; }
            try {
              const lines = stdout.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
              if (lines.length >= 2) {
                const userMs = parseFloat(lines[0]) || 0;
                const kernelMs = (parseFloat(lines[1]) || 0) - userMs;
                resolve({ userMs, kernelMs: Math.max(0, kernelMs) });
              } else {
                resolve(null);
              }
            } catch { resolve(null); }
          }
        );
      } else {
        resolve(null);
      }
    });
  }

  private getProcessMemory(pid: number): Promise<number | null> {
    return new Promise((resolve) => {
      if (os.platform() === 'win32') {
        exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
          { timeout: 500, windowsHide: true },
          (err, stdout) => {
            if (err) { resolve(null); return; }
            try {
              const lines = stdout.trim().split(/\r?\n/);
              if (lines.length >= 1) {
                const parts = lines[0].split('","');
                if (parts.length >= 5) {
                  const memStr = parts[4].replace(/"/g, '').replace(/[^0-9]/g, '');
                  const memKb = parseInt(memStr, 10);
                  if (!isNaN(memKb)) resolve(memKb * 1024);
                  else resolve(null);
                } else resolve(null);
              } else resolve(null);
            } catch { resolve(null); }
          }
        );
      } else {
        resolve(null);
      }
    });
  }

  writeToInstance(instanceId: string, input: string): boolean {
    const managed = this.processes.get(instanceId);
    if (!managed || !managed.proc.stdin || managed.proc.stdin.destroyed) return false;
    try {
      managed.proc.stdin.write(input);
      return true;
    } catch {
      return false;
    }
  }

  async stopInstance(instanceId: string, reason: KillReason = 'user'): Promise<boolean> {
    return this.killInstance(instanceId, reason);
  }

  killInstance(instanceId: string, reason: KillReason): boolean {
    const inst = this.instances.get(instanceId);
    const managed = this.processes.get(instanceId);
    if (!inst) return false;

    this.cpuOverCount.delete(instanceId);

    if (inst.status === 'running' || inst.status === 'starting') {
      inst.status = 'stopping';
      inst.killReason = reason;
      this.addEvent(instanceId, 'stopping', { reason });
      this.emit('instance:stopping', inst, reason);

      if (managed?.proc && managed.proc.pid) {
        try {
          if (os.platform() === 'win32') {
            exec(`taskkill /F /T /PID ${managed.proc.pid}`, { timeout: 3000, windowsHide: true }, () => { /* ignore */ });
          } else {
            try { process.kill(-managed.proc.pid, 'SIGKILL'); } catch { /* ignore */ }
          }
          setTimeout(() => {
            try { managed.proc.kill('SIGKILL'); } catch { /* ignore */ }
          }, 2000);
        } catch { /* ignore */ }
      }
      return true;
    }
    return false;
  }

  private cleanupInstance(instanceId: string): void {
    const inst = this.instances.get(instanceId);
    if (!inst) return;

    setTimeout(() => {
      try {
        if (fs.existsSync(inst.rootFs)) {
          const removeDirRecursive = (p: string): void => {
            if (!fs.existsSync(p)) return;
            const entries = fs.readdirSync(p, { withFileTypes: true });
            for (const e of entries) {
              const ep = path.join(p, e.name);
              if (e.isDirectory()) {
                removeDirRecursive(ep);
              } else {
                try { fs.unlinkSync(ep); } catch { /* ignore */ }
              }
            }
            try { fs.rmdirSync(p); } catch { /* ignore */ }
          };
          const parentDir = path.dirname(inst.rootFs);
          removeDirRecursive(parentDir);
        }
      } catch { /* ignore */ }

      const cached = this.instances.get(instanceId);
      if (cached && (cached.status === 'stopped' || cached.status === 'killed')) {
        this.sandboxToInstance.delete(cached.sandboxId);
        setTimeout(() => this.instances.delete(instanceId), 5000);
      }
    }, 1000);
  }

  stopAll(): void {
    for (const id of Array.from(this.instances.keys())) {
      this.killInstance(id, 'user');
    }
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }
}

function cpuPercentExceeded(
  inst: SandboxInstance,
  currentPercent: number,
  limitPercent: number,
  overCountMap: Map<string, number>
): boolean {
  if (currentPercent <= limitPercent) {
    overCountMap.delete(inst.id);
    return false;
  }

  const next = (overCountMap.get(inst.id) || 0) + 1;
  overCountMap.set(inst.id, next);

  const threshold = 6;
  if (next >= threshold) {
    return true;
  }
  return false;
}

export const runtimeShim = new RuntimeShim();

process.on('exit', () => {
  runtimeShim.stopAll();
});
