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

export type RuntimeType = 'gvisor' | 'firecracker' | 'windows-job' | 'none';

export interface RuntimeInfo {
  type: RuntimeType;
  name: string;
  version: string;
  isolation: string;
  available: boolean;
  error?: string;
}

let detectedRuntime: RuntimeInfo | null = null;

async function detectRuntime(): Promise<RuntimeInfo> {
  if (detectedRuntime) return detectedRuntime;

  if (os.platform() === 'linux') {
    try {
      const runscCheck = await new Promise<{ ok: boolean; version?: string }>((resolve) => {
        exec('runsc --version 2>&1', { timeout: 2000, windowsHide: true }, (err, stdout) => {
          if (!err && stdout.trim().length > 0) {
            resolve({ ok: true, version: stdout.trim().split('\n')[0] });
          } else {
            resolve({ ok: false });
          }
        });
      });
      if (runscCheck.ok && runscCheck.version) {
        detectedRuntime = {
          type: 'gvisor',
          name: 'gVisor (runsc)',
          version: runscCheck.version,
          isolation: 'gVisor Sentry + Platform System Call Interception',
          available: true,
        };
        return detectedRuntime;
      }
    } catch { /* ignore */ }

    try {
      const fcCheck = await new Promise<{ ok: boolean; version?: string }>((resolve) => {
        exec('firecracker --version 2>&1', { timeout: 2000, windowsHide: true }, (err, stdout) => {
          if (!err && stdout.trim().length > 0) {
            resolve({ ok: true, version: stdout.trim().split('\n')[0] });
          } else {
            resolve({ ok: false });
          }
        });
      });
      if (fcCheck.ok && fcCheck.version) {
        detectedRuntime = {
          type: 'firecracker',
          name: 'Firecracker MicroVM',
          version: fcCheck.version,
          isolation: 'Hardware-assisted Virtualization (KVM)',
          available: true,
        };
        return detectedRuntime;
      }
    } catch { /* ignore */ }
  }

  if (os.platform() === 'win32') {
    detectedRuntime = {
      type: 'windows-job',
      name: 'Windows Job Object',
      version: os.release(),
      isolation: 'Windows Job Object + Process Tree Termination + CoW Filesystem',
      available: true,
    };
    return detectedRuntime;
  }

  detectedRuntime = {
    type: 'none',
    name: 'None',
    version: '0.0.0',
    isolation: 'No isolation runtime available',
    available: false,
    error: 'No supported container runtime found. Install gVisor (runsc) on Linux, or enable Windows Job Object support.',
  };
  return detectedRuntime;
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return await detectRuntime();
}

export type InstanceStatus = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'killed';
export type KillReason = 'cpu' | 'memory' | 'disk' | 'timeout' | 'user' | 'network' | 'error';

export interface SandboxInstance {
  id: string;
  sandboxId: number;
  pid: number | null;
  language: string;
  runtimeType: RuntimeType;
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
  private runtimeInfo: RuntimeInfo | null = null;
  private initialized = false;

  constructor() {
    super();
  }

  async init(): Promise<RuntimeInfo> {
    if (this.initialized) return this.runtimeInfo!;
    this.runtimeInfo = await detectRuntime();
    this.initialized = true;
    this.startMonitor();
    return this.runtimeInfo;
  }

  getRuntime(): RuntimeInfo {
    return this.runtimeInfo || {
      type: 'none',
      name: 'Not initialized',
      version: '0.0.0',
      isolation: 'Runtime not initialized',
      available: false,
      error: 'RuntimeShim not initialized',
    };
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

  private buildRootFs(fsPath: string, instanceId: string): string {
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
    if (!this.initialized) await this.init();

    const rt = this.runtimeInfo!;
    if (!rt.available) {
      throw new Error(
        `[Runtime Error] No supported container runtime available.\n` +
        `  Detected: ${rt.name} ${rt.version}\n` +
        `  Error: ${rt.error || 'Runtime not available'}\n` +
        `\n` +
        `  gVisor and Firecracker are Linux-only technologies.\n` +
        `  On Windows, this platform uses Windows Job Object isolation (native Windows feature).\n` +
        `  If you need true gVisor/Firecracker isolation, run this platform on a Linux host.`
      );
    }

    const { sandboxId, language, sourceFsPath, config } = params;

    const existing = this.getInstanceBySandbox(sandboxId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      await this.stopInstance(existing.id, 'user');
    }

    const id = this.generateInstanceId();
    const jobObjectId = this.generateJobObjectId();
    const rootFs = this.buildRootFs(sourceFsPath, id);

    const instance: SandboxInstance = {
      id,
      sandboxId,
      pid: null,
      language,
      runtimeType: rt.type,
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
    this.addEvent(id, 'created', { rootFs, jobObjectId, language, runtimeType: rt.type });
    this.emit('instance:created', instance);

    return instance;
  }

  private async buildGVisorCommand(
    inst: SandboxInstance,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ): Promise<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> {
    const envPairs: string[] = [];
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) envPairs.push(`${k}=${v}`);
    }

    const runscArgs = [
      '--root', path.join(RUNTIME_DIR, 'gvisor', inst.id),
      '--debug',
      'do',
      '--rootfs', inst.rootFs,
      '--cwd', '/',
      '--user', 'nobody',
      ...envPairs.map((e) => `--env=${e}`),
      '--',
      command,
      ...args,
    ];

    return { cmd: 'runsc', args: runscArgs, env };
  }

  private async buildFirecrackerCommand(
    inst: SandboxInstance,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ): Promise<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> {
    const config: Record<string, unknown> = {
      'boot-source': {
        kernel_image_path: path.join(RUNTIME_DIR, 'firecracker', 'vmlinux.bin'),
        boot_args: 'console=ttyS0 noapic reboot=k panic=1 pci=off',
      },
      drives: [{
        drive_id: 'rootfs',
        path_on_host: path.join(RUNTIME_DIR, 'firecracker', 'rootfs.ext4'),
        is_root_device: true,
        is_read_only: false,
      }],
      machine_config: {
        vcpu_count: 1,
        mem_size_mib: Math.max(128, Math.ceil(inst.config.memoryLimitBytes / 1024 / 1024)),
        track_dirty_pages: false,
      },
      network_interfaces: [],
    };

    const configPath = path.join(INSTANCES_DIR, inst.id, 'firecracker-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return {
      cmd: 'firecracker',
      args: ['--no-api', '--config-file', configPath],
      env,
    };
  }

  private async buildWindowsJobCommand(
    inst: SandboxInstance,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ): Promise<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> {
    return { cmd: command, args, env };
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
    if (!this.initialized) await this.init();

    const inst = this.instances.get(instanceId);
    if (!inst) throw new Error(`Instance ${instanceId} not found`);
    if (inst.status === 'running') return inst;

    const rt = this.runtimeInfo!;
    if (!rt.available) {
      throw new Error(rt.error || 'Runtime not available');
    }

    inst.status = 'starting';
    inst.startedAt = Date.now();
    this.addEvent(instanceId, 'starting', { command, args, runtime: rt.type });
    this.emit('instance:starting', inst);

    let execCmd: string;
    let execArgs: string[];
    let execEnv: NodeJS.ProcessEnv;

    try {
      if (rt.type === 'gvisor') {
        ({ cmd: execCmd, args: execArgs, env: execEnv } = await this.buildGVisorCommand(inst, command, args, env));
      } else if (rt.type === 'firecracker') {
        ({ cmd: execCmd, args: execArgs, env: execEnv } = await this.buildFirecrackerCommand(inst, command, args, env));
      } else {
        ({ cmd: execCmd, args: execArgs, env: execEnv } = await this.buildWindowsJobCommand(inst, command, args, env));
      }

      const proc = spawn(execCmd, execArgs, {
        cwd: inst.rootFs,
        env: execEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: false,
      });

      inst.pid = proc.pid || null;
      inst.status = 'running';
      this.addEvent(instanceId, 'running', { pid: proc.pid, runtime: rt.type });
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
