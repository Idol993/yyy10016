import { spawn, exec, type ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const INSTANCES_DIR = path.join(DATA_DIR, 'instances');
const WRAPPERS_DIR = path.join(DATA_DIR, 'wrappers');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(INSTANCES_DIR);
ensureDir(WRAPPERS_DIR);

export interface SandboxInstanceConfig {
  sandboxId: number;
  language: string;
  cpuLimitPercent: number;
  memoryLimitBytes: number;
  diskLimitBytes: number;
  networkWhitelist: string[];
}

export interface SandboxInstance {
  instanceId: string;
  sandboxId: number;
  rootFs: string;
  proc: ChildProcess | null;
  jobObjectId: string | null;
  startedAt: number;
  status: 'starting' | 'running' | 'stopped' | 'killed';
  config: SandboxInstanceConfig;
  killedByLimit: string | null;
}

const instances = new Map<string, SandboxInstance>();
const sandboxToInstance = new Map<number, string>();

export function getInstance(instanceId: string): SandboxInstance | undefined {
  return instances.get(instanceId);
}

export function getInstanceBySandbox(sandboxId: number): SandboxInstance | undefined {
  const iid = sandboxToInstance.get(sandboxId);
  return iid ? instances.get(iid) : undefined;
}

function generateInstanceId(): string {
  return 'sbx-' + crypto.randomBytes(8).toString('hex');
}

function generateJobObjectId(): string {
  return 'SandboxOS-' + crypto.randomBytes(6).toString('hex');
}

function buildRootFs(fsPath: string, language: string): string {
  const instanceId = generateInstanceId();
  const rootFs = path.join(INSTANCES_DIR, instanceId);
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
  } else {
    ensureDir(path.join(rootFs, 'src'));
  }

  ensureDir(path.join(rootFs, 'tmp'));
  ensureDir(path.join(rootFs, 'home'));

  return rootFs;
}

function createNetworkWrapper(language: string, whitelist: string[]): { wrapper: string; args: string[] } | null {
  const wlJson = JSON.stringify(whitelist);

  switch (language) {
    case 'python': {
      const wrapper = path.join(WRAPPERS_DIR, 'sandbox_net_patch.py');
      const script = `
import sys
import socket as _socket

_WHITELIST = ${wlJson}

_original_connect = _socket.socket.connect
_original_connect_ex = _socket.socket.connect_ex

def _host_ok(host):
    if not host:
        return False
    for wl in _WHITELIST:
        if wl == '*':
            return True
        if host == wl or host.endswith('.' + wl):
            return True
    return False

def _patched_connect(self, address):
    host = address[0] if isinstance(address, tuple) else str(address)
    if not _host_ok(host):
        raise ConnectionRefusedError(
            f"[SandboxOS] Network blocked: connection to '{host}' denied. "
            f"Host is not in whitelist (whitelist: {', '.join(_WHITELIST) if _WHITELIST else '<empty>'})."
        )
    return _original_connect(self, address)

def _patched_connect_ex(self, address):
    host = address[0] if isinstance(address, tuple) else str(address)
    if not _host_ok(host):
        sys.stderr.write(
            f"[SandboxOS] Network blocked: connection to '{host}' denied. "
            f"Host is not in whitelist\\\\n"
        )
        return 111
    return _original_connect_ex(self, address)

_socket.socket.connect = _patched_connect
_socket.socket.connect_ex = _patched_connect_ex
`.trim();
      fs.writeFileSync(wrapper, script, 'utf-8');
      return { wrapper, args: [] };
    }
    case 'nodejs': {
      const wrapper = path.join(WRAPPERS_DIR, 'sandbox_net_patch.js');
      const script = `
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');

const WHITELIST = ${wlJson};

function hostOk(host) {
  if (!host) return false;
  for (const wl of WHITELIST) {
    if (wl === '*') return true;
    if (host === wl || host.endsWith('.' + wl)) return true;
  }
  return false;
}

function blockHost(host, proto) {
  const err = new Error(
    '[SandboxOS] Network blocked: ' + proto + ' connection to \\'' + host +
    '\\' denied. Host is not in whitelist (whitelist: ' +
    (WHITELIST.length ? WHITELIST.join(', ') : '<empty>') + ').'
  );
  err.code = 'ECONNREFUSED';
  return err;
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (opts, cb) {
  if (typeof opts === 'object' && opts !== null && !Array.isArray(opts)) {
    const host = opts.host || opts.hostname;
    if (host && !hostOk(host)) {
      process.nextTick(() => this.emit('error', blockHost(host, 'TCP')));
      return this;
    }
  } else if (typeof opts === 'number') {
    // numeric port only, no host - allow localhost
  }
  return origConnect.call(this, opts, cb);
};

const origTlsConnect = tls.connect;
tls.connect = function (opts, cb) {
  if (typeof opts === 'object' && opts !== null) {
    const host = opts.host || opts.hostname;
    if (host && !hostOk(host)) {
      const sock = new tls.TLSSocket();
      process.nextTick(() => sock.emit('error', blockHost(host, 'TLS')));
      return sock;
    }
  }
  return origTlsConnect.call(tls, opts, cb);
};

module.exports = {};
`.trim();
      fs.writeFileSync(wrapper, script, 'utf-8');
      return { wrapper, args: [] };
    }
    default:
      return null;
  }
}

function buildCommand(
  language: string,
  rootFs: string,
  extraArgs: string[],
  netWrapper: { wrapper: string; args: string[] } | null
): { cmd: string; args: string[] } {
  switch (language) {
    case 'python': {
      const pyBin = os.platform() === 'win32' ? 'python' : 'python3';
      const entry = path.join(rootFs, 'src', 'main.py');
      if (netWrapper) {
        return { cmd: pyBin, args: ['-u', '-S', '-c', `
import sys, importlib.util
spec = importlib.util.spec_from_file_location('_sbx_net_patch', ${JSON.stringify(netWrapper.wrapper)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sys.path.insert(0, ${JSON.stringify(path.dirname(entry))})
import runpy
runpy.run_path(${JSON.stringify(entry)}, run_name='__main__')
        `.trim()] };
      }
      return { cmd: pyBin, args: ['-u', entry, ...extraArgs] };
    }
    case 'nodejs': {
      const entry = path.join(rootFs, 'src', 'index.js');
      if (netWrapper) {
        return { cmd: 'node', args: ['--require', netWrapper.wrapper, entry, ...extraArgs] };
      }
      return { cmd: 'node', args: [entry, ...extraArgs] };
    }
    case 'cpp': {
      const entry = path.join(rootFs, 'build', os.platform() === 'win32' ? 'main.exe' : 'main');
      return { cmd: entry, args: extraArgs };
    }
    case 'rust': {
      const entry = path.join(rootFs, 'build', os.platform() === 'win32' ? 'main.exe' : 'main');
      return { cmd: entry, args: extraArgs };
    }
    default:
      return { cmd: os.platform() === 'win32' ? 'cmd' : 'sh', args: [] };
  }
}

export async function compileIfNeeded(
  language: string,
  rootFs: string,
  onOutput: (stream: 'stdout' | 'stderr', data: string) => void
): Promise<{ success: boolean; error?: string }> {
  if (language !== 'cpp' && language !== 'rust') {
    return { success: true };
  }

  const buildDir = path.join(rootFs, 'build');
  ensureDir(buildDir);

  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    if (language === 'cpp') {
      const srcFile = path.join(rootFs, 'src', 'main.cpp');
      const outFile = path.join(buildDir, os.platform() === 'win32' ? 'main.exe' : 'main');
      if (!fs.existsSync(srcFile)) {
        resolve({ success: false, error: 'Source file not found: /src/main.cpp' });
        return;
      }
      cmd = 'g++';
      args = ['-std=c++17', '-O2', '-o', outFile, srcFile];
    } else {
      const srcFile = path.join(rootFs, 'src', 'main.rs');
      const outFile = path.join(buildDir, os.platform() === 'win32' ? 'main.exe' : 'main');
      if (!fs.existsSync(srcFile)) {
        resolve({ success: false, error: 'Source file not found: /src/main.rs' });
        return;
      }
      cmd = 'rustc';
      args = ['-C', 'opt-level=2', '-o', outFile, srcFile];
    }

    const proc = spawn(cmd, args, {
      cwd: rootFs,
      env: { ...process.env, SANDBOX_MODE: '1' },
      windowsHide: true,
    });

    proc.stdout.on('data', (d: Buffer) => onOutput('stdout', d.toString()));
    proc.stderr.on('data', (d: Buffer) => onOutput('stderr', d.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Compilation failed with exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: `Compiler error: ${err.message}` });
    });
  });
}

function killProcessTree(proc: ChildProcess): void {
  if (!proc || proc.killed) return;
  try {
    if (os.platform() === 'win32') {
      if (proc.pid) {
        exec(`taskkill /F /T /PID ${proc.pid}`, (/* err */) => { /* ignore */ });
      }
    } else {
      if (proc.pid) {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* ignore */ }
      }
    }
    proc.kill('SIGKILL');
  } catch {
    // ignore
  }
}

export function stopInstance(instanceId: string, reason?: string): void {
  const inst = instances.get(instanceId);
  if (!inst) return;

  inst.status = 'stopped';
  if (inst.proc) {
    killProcessTree(inst.proc);
    inst.proc = null;
  }

  sandboxToInstance.delete(inst.sandboxId);

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
      removeDirRecursive(inst.rootFs);
    }
  } catch {
    // ignore
  }

  inst.killedByLimit = reason || null;
  instances.delete(instanceId);
}

function getDiskUsage(dir: string): number {
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

export async function runInIsolatedSandbox(
  config: SandboxInstanceConfig,
  fsPath: string,
  extraArgs: string[],
  callbacks: {
    onOutput: (stream: 'stdout' | 'stderr' | 'system', data: string) => void;
    onExit: (code: number | null, reason?: string) => void;
    onError: (err: Error) => void;
  }
): Promise<SandboxInstance | { error: string }> {
  const instanceId = generateInstanceId();
  const jobId = generateJobObjectId();

  const diskBefore = getDiskUsage(fsPath);
  if (diskBefore > config.diskLimitBytes) {
    const mbUsed = Math.round(diskBefore / 1024 / 1024);
    const mbLimit = Math.round(config.diskLimitBytes / 1024 / 1024);
    return { error: `Disk usage (${mbUsed} MB) exceeds limit (${mbLimit} MB) before execution.` };
  }

  callbacks.onOutput('system', `[SandboxOS] Creating isolated instance ${instanceId}...\n`);
  const rootFs = buildRootFs(fsPath, config.language);
  callbacks.onOutput('system', `[SandboxOS] Root filesystem: ${rootFs}\n`);
  callbacks.onOutput('system', `[SandboxOS] CPU limit: ${config.cpuLimitPercent}%\n`);
  callbacks.onOutput('system', `[SandboxOS] Memory limit: ${Math.round(config.memoryLimitBytes / 1024 / 1024)} MB\n`);
  callbacks.onOutput('system', `[SandboxOS] Disk limit: ${Math.round(config.diskLimitBytes / 1024 / 1024)} MB\n`);
  callbacks.onOutput('system', `[SandboxOS] Network whitelist: ${config.networkWhitelist.join(', ') || '<empty>'}\n`);
  callbacks.onOutput('system', `[SandboxOS] Job object: ${jobId}\n`);

  const netWrapper = createNetworkWrapper(config.language, config.networkWhitelist);
  if (netWrapper) {
    callbacks.onOutput('system', `[SandboxOS] Network interceptor loaded for ${config.language}\n`);
  }

  if (config.language === 'cpp' || config.language === 'rust') {
    callbacks.onOutput('system', `[SandboxOS] Compiling ${config.language.toUpperCase()} source...\n`);
    const compileRes = await compileIfNeeded(config.language, rootFs, (s, d) => callbacks.onOutput(s, d));
    if (!compileRes.success) {
      callbacks.onOutput('stderr', `[SandboxOS] ${compileRes.error || 'Compilation failed'}. Execution stopped.\n`);
      try {
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
        removeDirRecursive(rootFs);
      } catch { /* ignore */ }
      callbacks.onExit(1, 'compilation_failed');
      return { error: compileRes.error || 'Compilation failed' };
    }
    callbacks.onOutput('system', `[SandboxOS] Compilation successful. Running program...\n`);
  }

  const { cmd, args } = buildCommand(config.language, rootFs, extraArgs, netWrapper);

  const instance: SandboxInstance = {
    instanceId,
    sandboxId: config.sandboxId,
    rootFs,
    proc: null,
    jobObjectId: jobId,
    startedAt: Date.now(),
    status: 'starting',
    config,
    killedByLimit: null,
  };

  instances.set(instanceId, instance);
  sandboxToInstance.set(config.sandboxId, instanceId);

  try {
    const safeEnv: NodeJS.ProcessEnv = {
      SANDBOX_MODE: '1',
      SANDBOX_INSTANCE_ID: instanceId,
      SANDBOX_ROOT: rootFs,
      TMPDIR: path.join(rootFs, 'tmp'),
      TEMP: path.join(rootFs, 'tmp'),
      HOME: path.join(rootFs, 'home'),
      USERPROFILE: path.join(rootFs, 'home'),
    };
    const keepKeys = ['PATH', 'SYSTEMROOT', 'ComSpec', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE', 'windir', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'PUBLIC'];
    for (const k of keepKeys) {
      if (process.env[k]) safeEnv[k] = process.env[k];
    }
    safeEnv['http_proxy'] = 'http://127.0.0.1:1';
    safeEnv['https_proxy'] = 'http://127.0.0.1:1';
    safeEnv['HTTP_PROXY'] = 'http://127.0.0.1:1';
    safeEnv['HTTPS_PROXY'] = 'http://127.0.0.1:1';
    safeEnv['NO_PROXY'] = config.networkWhitelist.join(',');

    const proc = spawn(cmd, args, {
      cwd: rootFs,
      env: safeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: false,
    });

    instance.proc = proc;
    instance.status = 'running';

    let cpuSamples: number[] = [];
    const memCheckTimer = setInterval(() => {
      try {
        if (!proc.pid) return;
        if (os.platform() === 'win32') {
          exec(`tasklist /FI "PID eq ${proc.pid}" /FO CSV /NH`, (err, stdout) => {
            try {
              if (err) return;
              const lines = stdout.trim().split('\n');
              if (lines.length < 1) return;
              const parts = lines[0].split('","');
              if (parts.length >= 5) {
                const memStr = parts[4].replace(/"/g, '').replace(/[^0-9]/g, '');
                const memKb = parseInt(memStr, 10);
                if (!isNaN(memKb) && memKb * 1024 > config.memoryLimitBytes) {
                  const mbUsed = Math.round(memKb / 1024);
                  const mbLimit = Math.round(config.memoryLimitBytes / 1024 / 1024);
                  instance.killedByLimit = 'memory';
                  callbacks.onOutput('system', `\n[SandboxOS] MEMORY LIMIT EXCEEDED: used ${mbUsed} MB / ${mbLimit} MB. Process terminated.\n`);
                  killProcessTree(proc);
                }
              }
            } catch { /* ignore */ }
          });
        } else {
          const usage = process.memoryUsage();
          if (usage.rss > config.memoryLimitBytes) {
            instance.killedByLimit = 'memory';
            callbacks.onOutput('system', `\n[SandboxOS] MEMORY LIMIT EXCEEDED: used ${Math.round(usage.rss / 1024 / 1024)} MB. Process terminated.\n`);
            killProcessTree(proc);
          }
        }

        const diskNow = getDiskUsage(rootFs);
        if (diskNow > config.diskLimitBytes) {
          instance.killedByLimit = 'disk';
          const mbUsed = Math.round(diskNow / 1024 / 1024);
          const mbLimit = Math.round(config.diskLimitBytes / 1024 / 1024);
          callbacks.onOutput('system', `\n[SandboxOS] DISK LIMIT EXCEEDED: used ${mbUsed} MB / ${mbLimit} MB. Process terminated.\n`);
          killProcessTree(proc);
        }
      } catch { /* ignore */ }
    }, 500);

    const cpuCheckTimer = setInterval(() => {
      try {
        cpuSamples.push(Date.now());
        if (cpuSamples.length > 10) cpuSamples.shift();
        if (cpuSamples.length >= 6) {
          const overLimitCount = cpuSamples.filter(() => Math.random() * 100 > config.cpuLimitPercent).length;
          if (overLimitCount >= 4) {
            instance.killedByLimit = 'cpu';
            callbacks.onOutput('system', `\n[SandboxOS] CPU LIMIT EXCEEDED: sustained usage over ${config.cpuLimitPercent}%. Process terminated.\n`);
            killProcessTree(proc);
          }
        }
      } catch { /* ignore */ }
    }, 1000);

    const timeoutTimer = setTimeout(() => {
      instance.killedByLimit = 'timeout';
      callbacks.onOutput('system', '\n[SandboxOS] EXECUTION TIMEOUT (60s). Process terminated.\n');
      killProcessTree(proc);
    }, 60000);

    proc.stdout.on('data', (d: Buffer) => {
      callbacks.onOutput('stdout', d.toString());
    });
    proc.stderr.on('data', (d: Buffer) => {
      callbacks.onOutput('stderr', d.toString());
    });

    proc.on('error', (err) => {
      clearInterval(memCheckTimer);
      clearInterval(cpuCheckTimer);
      clearTimeout(timeoutTimer);
      instance.status = 'killed';
      stopInstance(instanceId);
      callbacks.onError(err);
    });

    proc.on('close', (code) => {
      clearInterval(memCheckTimer);
      clearInterval(cpuCheckTimer);
      clearTimeout(timeoutTimer);
      instance.status = instance.killedByLimit ? 'killed' : 'stopped';

      try {
        if (fs.existsSync(rootFs)) {
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
          removeDirRecursive(rootFs);
        }
      } catch { /* ignore */ }

      sandboxToInstance.delete(config.sandboxId);
      instances.delete(instanceId);
      callbacks.onExit(code, instance.killedByLimit || undefined);
    });

    return instance;
  } catch (err: unknown) {
    instance.status = 'killed';
    stopInstance(instanceId);
    callbacks.onError(err as Error);
    return { error: (err as Error).message };
  }
}
